import { test, expect, type Page } from '@playwright/test';
import { type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import {
  cleanupTestData, createConfirmedUser, hasServiceRole, adminClient, authedClient, TEST_PREFIX
} from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.rep.owner.${stamp}@gmail.com`, password: 'Test1234!' };
const staff = { email: `xlerp.test.rep.staff.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}Rep_${stamp}`;

const custAName = `${TEST_PREFIX}RepCustA ${stamp}`;
const custBName = `${TEST_PREFIX}RepCustB ${stamp}`;

// Item with reorder_level=10 (should show in low-stock once qty <= 10).
const lowStockItem = `${TEST_PREFIX}RepLow ${stamp}`;
const REORDER_LEVEL = 10;
const LOW_STOCK_QTY = 4; // seeded below the reorder level

// Item with reorder_level=0 — must NEVER appear in low-stock, even with 0/very low qty.
const noReorderItem = `${TEST_PREFIX}RepNoReorder ${stamp}`;

// Item used purely for the sales-by-item / GST-summary date-range assertions.
// Known gst_rate so gstSummary's taxableAmount/taxAmount are hand-computable.
const saleItemName = `${TEST_PREFIX}RepSaleItem ${stamp}`;
const GST_RATE = 18;

// Dead-stock items: one "fresh" (moved today -> never dead at 60d), one "aged"
// (ledger created_at pushed back beyond the threshold -> must show as dead).
const freshItem = `${TEST_PREFIX}RepFresh ${stamp}`;
const agedItem = `${TEST_PREFIX}RepAged ${stamp}`;

const createdUserIds: string[] = [];

let custAId = '', custBId = '';
let lowStockItemId = '', noReorderItemId = '', saleItemId = '', freshItemId = '', agedItemId = '';
let warehouseId = '';

// ── Date-range window used for the CRITICAL date-filter tests ──
// The window: [rangeFrom, rangeTo]. Two invoices fall INSIDE it (different
// customers, different dates), one invoice is deliberately dated OUTSIDE it.
function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const rangeFrom = isoDaysAgo(20);
const rangeTo = isoDaysAgo(5);
const insideDate1 = isoDaysAgo(15); // invoice A (custA) inside range
const insideDate2 = isoDaysAgo(8);  // invoice B (custB) inside range
const outsideDate = isoDaysAgo(60); // invoice C (custA) OUTSIDE range — must never leak in

// Known qty/rate for the sale item on each in-range invoice line.
const A_QTY = 3, A_RATE = 100;                 // invoice A line: 3 * 100 = 300
const B_QTY = 2, B_RATE = 250;                 // invoice B line: 2 * 250 = 500
const OUT_QTY = 100, OUT_RATE = 1000;          // invoice C (outside range): must NOT leak in

const A_AMOUNT = A_QTY * A_RATE;   // 300
const B_AMOUNT = B_QTY * B_RATE;   // 500
const IN_RANGE_TOTAL_AMOUNT = A_AMOUNT + B_AMOUNT; // 800
const IN_RANGE_TOTAL_QTY = A_QTY + B_QTY;          // 5

// Expected GST figures for the known gst_rate, computed from ONLY the in-range lines.
const EXPECTED_TAXABLE = IN_RANGE_TOTAL_AMOUNT;                 // 800
const EXPECTED_TAX = EXPECTED_TAXABLE * (GST_RATE / 100);       // 144

let invAId = '', invBId = '', invCId = '';

let _client: SupabaseClient | null = null;
async function db(): Promise<SupabaseClient> {
  if (!_client) _client = await authedClient(owner.email, owner.password);
  expect(_client, 'authed client (anon key + sign-in) should be available').not.toBeNull();
  return _client!;
}

async function seedInvoiceWithLine(client: SupabaseClient, opts: {
  invoiceNo: string; customerId: string; customerName: string; invoiceDate: string;
  itemId: string; itemName: string; qty: number; rate: number; gstRate: number;
}): Promise<string> {
  const amount = opts.qty * opts.rate;
  const gstAmt = amount * (opts.gstRate / 100);
  const total = amount + gstAmt;
  const { data: inv, error } = await client.from('erp_invoices').insert({
    invoice_no: opts.invoiceNo,
    customer_id: opts.customerId,
    customer_name: opts.customerName,
    warehouse_id: warehouseId,
    invoice_date: opts.invoiceDate,
    subtotal: amount,
    discount: 0,
    tax_amount: gstAmt,
    total,
    paid: 0,
    balance: total,
    payment_type: 'Credit',
    status: 'active',
    notes: null
  }).select().single();
  expect(error, `seed invoice ${opts.invoiceNo} should succeed`).toBeNull();

  const { error: itemErr } = await client.from('erp_invoice_items').insert({
    invoice_id: inv!.id,
    item_id: opts.itemId,
    variant_id: null,
    name: opts.itemName,
    hsn_code: null,
    qty: opts.qty,
    rate: opts.rate,
    gst_rate: opts.gstRate,
    amount
  });
  expect(itemErr, `seed invoice item for ${opts.invoiceNo} should succeed`).toBeNull();

  return inv!.id;
}

test.beforeAll(async () => {
  const ownerId = await createConfirmedUser(owner.email, owner.password);
  if (ownerId) createdUserIds.push(ownerId);
  const staffId = await createConfirmedUser(staff.email, staff.password);
  if (staffId) createdUserIds.push(staffId);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

test.describe('reports & insight e2e (Phase 7)', () => {
  // ── 1. Setup ───────────────────────────────────────────────────────────────
  test('setup: org, 2 customers, items (reorder_level variants), 3 invoices across dates', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    const client = await db();

    const { data: wh } = await client.from('erp_warehouses')
      .select('id, is_default').order('is_default', { ascending: false });
    expect(wh && wh.length, 'org should have at least one warehouse').toBeTruthy();
    warehouseId = (wh!.find((w: any) => w.is_default) || wh![0]).id;

    // ── Customers ──
    const { data: custA, error: custAErr } = await client.from('erp_customers')
      .insert({ name: custAName, opening_balance: 0 }).select().single();
    expect(custAErr).toBeNull();
    custAId = custA!.id;

    const { data: custB, error: custBErr } = await client.from('erp_customers')
      .insert({ name: custBName, opening_balance: 0 }).select().single();
    expect(custBErr).toBeNull();
    custBId = custB!.id;

    // ── Items ──
    const { data: lowItem, error: lowErr } = await client.from('erp_items')
      .insert({ name: lowStockItem, unit: 'Pcs', gst_rate: GST_RATE, reorder_level: REORDER_LEVEL, status: 'active', pack_size: 1 })
      .select().single();
    expect(lowErr).toBeNull();
    lowStockItemId = lowItem!.id;

    const { data: noReorder, error: noReorderErr } = await client.from('erp_items')
      .insert({ name: noReorderItem, unit: 'Pcs', gst_rate: GST_RATE, reorder_level: 0, status: 'active', pack_size: 1 })
      .select().single();
    expect(noReorderErr).toBeNull();
    noReorderItemId = noReorder!.id;

    const { data: saleItem, error: saleErr } = await client.from('erp_items')
      .insert({ name: saleItemName, unit: 'Pcs', gst_rate: GST_RATE, reorder_level: 0, status: 'active', pack_size: 1 })
      .select().single();
    expect(saleErr).toBeNull();
    saleItemId = saleItem!.id;

    const { data: fresh, error: freshErr } = await client.from('erp_items')
      .insert({ name: freshItem, unit: 'Pcs', gst_rate: GST_RATE, reorder_level: 0, status: 'active', pack_size: 1 })
      .select().single();
    expect(freshErr).toBeNull();
    freshItemId = fresh!.id;

    const { data: aged, error: agedErr } = await client.from('erp_items')
      .insert({ name: agedItem, unit: 'Pcs', gst_rate: GST_RATE, reorder_level: 0, status: 'active', pack_size: 1 })
      .select().single();
    expect(agedErr).toBeNull();
    agedItemId = aged!.id;

    // ── 3 invoices: A & B inside the report date range (different customers,
    // different dates), C deliberately OUTSIDE the range (same customer as A,
    // with a much larger qty/rate so any leak would be obvious). ──
    invAId = await seedInvoiceWithLine(client, {
      invoiceNo: `REP-A-${stamp}`, customerId: custAId, customerName: custAName, invoiceDate: insideDate1,
      itemId: saleItemId, itemName: saleItemName, qty: A_QTY, rate: A_RATE, gstRate: GST_RATE
    });
    invBId = await seedInvoiceWithLine(client, {
      invoiceNo: `REP-B-${stamp}`, customerId: custBId, customerName: custBName, invoiceDate: insideDate2,
      itemId: saleItemId, itemName: saleItemName, qty: B_QTY, rate: B_RATE, gstRate: GST_RATE
    });
    invCId = await seedInvoiceWithLine(client, {
      invoiceNo: `REP-C-${stamp}`, customerId: custAId, customerName: custAName, invoiceDate: outsideDate,
      itemId: saleItemId, itemName: saleItemName, qty: OUT_QTY, rate: OUT_RATE, gstRate: GST_RATE
    });

    expect(invAId).toBeTruthy();
    expect(invBId).toBeTruthy();
    expect(invCId).toBeTruthy();

    // Sanity: rangeFrom/rangeTo actually bracket insideDate1/insideDate2 and exclude outsideDate.
    expect(rangeFrom <= insideDate1 && insideDate1 <= rangeTo).toBe(true);
    expect(rangeFrom <= insideDate2 && insideDate2 <= rangeTo).toBe(true);
    expect(outsideDate < rangeFrom).toBe(true);
  });

  // ── 2. CRITICAL — date-range filtering correctness (nested-join risk) ──────
  test('CRITICAL: Sales by Item and GST Summary respect the date range and exclude out-of-range invoices', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/reports');
    await expect(page.getByText('📈 Reports').first()).toBeVisible({ timeout: 15_000 });

    const fromInput = page.locator('label:has-text("From") + input, label:has-text("From") input').first();
    const toInput = page.locator('label:has-text("To") + input, label:has-text("To") input').first();
    await fromInput.fill(rangeFrom);
    await toInput.fill(rangeTo);

    // ── Sales by Item: row for saleItemName should show qty=5, amount=800 —
    // i.e. ONLY invoice A (3*100) + invoice B (2*250), NOT invoice C (100*1000). ──
    const itemSection = page.locator('div.card', { has: page.getByText('Sales by Item') });
    await expect(itemSection.getByText(saleItemName)).toBeVisible({ timeout: 15_000 });
    const itemRow = itemSection.locator('tr', { has: page.getByText(saleItemName) });
    await expect(itemRow).toContainText(String(IN_RANGE_TOTAL_QTY));
    await expect(itemRow).toContainText(fmtINR(IN_RANGE_TOTAL_AMOUNT));

    // The out-of-range invoice's huge amount (100*1000=100000) must NOT appear
    // anywhere in the Sales by Item table — the smoking gun for a broken/no-op filter.
    await expect(itemSection.getByText(fmtINR(OUT_QTY * OUT_RATE))).toHaveCount(0);

    // ── GST Summary: taxableAmount/taxAmount for GST_RATE match hand-computed
    // totals from ONLY the in-range lines. ──
    const gstSection = page.locator('div.card', { has: page.getByText('GST Summary') });
    await expect(gstSection.getByText(`${GST_RATE}%`)).toBeVisible({ timeout: 15_000 });
    const gstRow = gstSection.locator('tr', { has: page.getByText(`${GST_RATE}%`) });
    await expect(gstRow).toContainText(fmtINR(EXPECTED_TAXABLE));
    await expect(gstRow).toContainText(fmtINR(EXPECTED_TAX));

    // The out-of-range contribution (taxable 100000, tax 18000) must not leak into the total row.
    const totalRow = gstSection.locator('tr', { hasText: 'Total' });
    await expect(totalRow).toContainText(fmtINR(EXPECTED_TAXABLE));
    await expect(totalRow).toContainText(fmtINR(EXPECTED_TAX));
  });

  // ── 3. Sales by customer ────────────────────────────────────────────────────
  test('Sales by Customer: each customer totals correctly, no double-count or cross-attribution', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/reports');
    await expect(page.getByText('📈 Reports').first()).toBeVisible({ timeout: 15_000 });

    const fromInput = page.locator('label:has-text("From") + input, label:has-text("From") input').first();
    const toInput = page.locator('label:has-text("To") + input, label:has-text("To") input').first();
    await fromInput.fill(rangeFrom);
    await toInput.fill(rangeTo);

    const client = await db();
    const { data: invA } = await client.from('erp_invoices').select('total').eq('id', invAId).single();
    const { data: invB } = await client.from('erp_invoices').select('total').eq('id', invBId).single();

    const custSection = page.locator('div.card', { has: page.getByText('Sales by Customer') });
    await expect(custSection.getByText(custAName)).toBeVisible({ timeout: 15_000 });
    await expect(custSection.getByText(custBName)).toBeVisible({ timeout: 15_000 });

    // Customer A: only invoice A's total should count (invoice C is out of range,
    // so it must not be added to A's in-range total — that would be a cross-date leak).
    const rowA = custSection.locator('tr', { has: page.getByText(custAName) });
    await expect(rowA).toContainText(fmtINR(Number(invA!.total)));
    await expect(rowA).toContainText('1'); // invoice count = 1 (only invoice A in range)

    // Customer B: only invoice B's total.
    const rowB = custSection.locator('tr', { has: page.getByText(custBName) });
    await expect(rowB).toContainText(fmtINR(Number(invB!.total)));
    await expect(rowB).toContainText('1');

    // A's total must not accidentally include B's total (cross-attribution check).
    expect(Number(invA!.total)).not.toBe(Number(invB!.total));
  });

  // ── 4. Low stock ─────────────────────────────────────────────────────────────
  test('Low Stock: reorder_level=10 item appears below threshold; reorder_level=0 item never appears', async ({ page }) => {
    const client = await db();

    // Stock the low-stock item to a qty BELOW its reorder level via the sacred RPC.
    const { error: stockErr } = await client.rpc('erp_apply_stock', {
      p_item: lowStockItemId, p_variant: null, p_wh: warehouseId,
      p_change: LOW_STOCK_QTY, p_reason: 'adjustment', p_ref_type: null, p_ref_id: null, p_note: '__TEST__ seed'
    });
    expect(stockErr).toBeNull();
    expect(LOW_STOCK_QTY).toBeLessThan(REORDER_LEVEL);

    // Stock the reorder_level=0 item to an even lower (or equally low) qty — it
    // must be excluded specifically because reorder_level=0, not because it has plenty of stock.
    const { error: stockErr2 } = await client.rpc('erp_apply_stock', {
      p_item: noReorderItemId, p_variant: null, p_wh: warehouseId,
      p_change: 1, p_reason: 'adjustment', p_ref_type: null, p_ref_id: null, p_note: '__TEST__ seed'
    });
    expect(stockErr2).toBeNull();

    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/reports');
    await expect(page.getByText('📈 Reports').first()).toBeVisible({ timeout: 15_000 });

    const lowSection = page.locator('div.card', { has: page.getByText('Low Stock') });
    await expect(lowSection.getByText(lowStockItem)).toBeVisible({ timeout: 15_000 });
    const lowRow = lowSection.locator('tr', { has: page.getByText(lowStockItem) });
    await expect(lowRow).toContainText(String(LOW_STOCK_QTY));
    await expect(lowRow).toContainText(String(REORDER_LEVEL));

    // reorder_level=0 item must NEVER show up in Low Stock, regardless of its (also low) qty.
    await expect(lowSection.getByText(noReorderItem)).toHaveCount(0);
  });

  // ── 5. Dead stock ────────────────────────────────────────────────────────────
  test('Dead Stock: a freshly-moved item is excluded at 60d; an aged-ledger item is included', async ({ page }) => {
    const client = await db();

    // Fresh item: stock-in today via the RPC (reason 'purchase') — recent movement,
    // must NOT show as dead at the default 60-day threshold.
    const { error: freshErr } = await client.rpc('erp_apply_stock', {
      p_item: freshItemId, p_variant: null, p_wh: warehouseId,
      p_change: 5, p_reason: 'purchase', p_ref_type: null, p_ref_id: null, p_note: '__TEST__ fresh stock-in'
    });
    expect(freshErr).toBeNull();

    // Aged item: stock-in via the RPC, then push its ledger row's created_at back
    // beyond the 60-day threshold (mirrors payments.spec.ts's aging technique).
    const { error: agedErr } = await client.rpc('erp_apply_stock', {
      p_item: agedItemId, p_variant: null, p_wh: warehouseId,
      p_change: 5, p_reason: 'purchase', p_ref_type: null, p_ref_id: null, p_note: '__TEST__ aged stock-in'
    });
    expect(agedErr).toBeNull();

    const d = new Date();
    d.setDate(d.getDate() - 90); // 90 days ago -> older than the 60-day default threshold
    const { data: agedLedgerRows, error: findErr } = await client.from('erp_stock_ledger')
      .select('id').eq('item_id', agedItemId).eq('reason', 'purchase');
    expect(findErr).toBeNull();
    expect((agedLedgerRows || []).length, 'aged item should have exactly one purchase ledger row').toBe(1);
    const { error: ageUpdateErr } = await client.from('erp_stock_ledger')
      .update({ created_at: d.toISOString() })
      .eq('id', agedLedgerRows![0].id);
    expect(ageUpdateErr).toBeNull();

    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/reports');
    await expect(page.getByText('📈 Reports').first()).toBeVisible({ timeout: 15_000 });

    const deadSection = page.locator('div.card', { has: page.getByText('Dead Stock') });
    // Default threshold is 60 days — wait for the section to finish its initial load.
    await expect(deadSection.locator('table, text=No dead stock')).toBeVisible({ timeout: 15_000 }).catch(() => {});

    // Fresh item must NOT appear as dead stock at 60d.
    await expect(deadSection.getByText(freshItem)).toHaveCount(0);

    // Aged item (last movement 90 days ago) MUST appear as dead stock at 60d.
    await expect(deadSection.getByText(agedItem)).toBeVisible({ timeout: 15_000 });
  });

  // ── 6. CSV export ────────────────────────────────────────────────────────────
  test('CSV export: Sales by Item and GST Summary downloads contain expected headers and rows', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/reports');
    await expect(page.getByText('📈 Reports').first()).toBeVisible({ timeout: 15_000 });

    const fromInput = page.locator('label:has-text("From") + input, label:has-text("From") input').first();
    const toInput = page.locator('label:has-text("To") + input, label:has-text("To") input').first();
    await fromInput.fill(rangeFrom);
    await toInput.fill(rangeTo);

    // ── Sales by Item export ──
    const itemSection = page.locator('div.card', { has: page.getByText('Sales by Item') });
    await expect(itemSection.getByText(saleItemName)).toBeVisible({ timeout: 15_000 });
    const [itemDownload] = await Promise.all([
      page.waitForEvent('download'),
      itemSection.getByRole('button', { name: '⬇ Export CSV' }).click()
    ]);
    const itemPath = await itemDownload.path();
    expect(itemPath).toBeTruthy();
    const itemCsv = fs.readFileSync(itemPath!, 'utf8');
    expect(itemCsv).toContain('Item');
    expect(itemCsv).toContain('Qty Sold');
    expect(itemCsv).toContain('Amount');
    expect(itemCsv).toContain(saleItemName);
    expect(itemCsv).toContain(String(IN_RANGE_TOTAL_QTY));

    // ── GST Summary export ──
    const gstSection = page.locator('div.card', { has: page.getByText('GST Summary') });
    await expect(gstSection.getByText(`${GST_RATE}%`)).toBeVisible({ timeout: 15_000 });
    const [gstDownload] = await Promise.all([
      page.waitForEvent('download'),
      gstSection.getByRole('button', { name: '⬇ Export CSV' }).click()
    ]);
    const gstPath = await gstDownload.path();
    expect(gstPath).toBeTruthy();
    const gstCsv = fs.readFileSync(gstPath!, 'utf8');
    expect(gstCsv).toContain('GST Rate');
    expect(gstCsv).toContain('Taxable Amount');
    expect(gstCsv).toContain('Tax Amount');
    expect(gstCsv).toContain(`${GST_RATE}`);
    expect(gstCsv).toContain(String(EXPECTED_TAXABLE));
  });

  // ── 7. RoleGate: staff sees the restricted fallback ─────────────────────────
  test('staff role: /reports shows the restricted fallback', async ({ page }) => {
    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: orgRow } = await admin!
      .from('organizations').select('id').eq('name', org).single();
    expect(orgRow, 'the test org should exist').toBeTruthy();
    const orgId = orgRow!.id;

    const { data: authUsers } = await admin!.auth.admin.listUsers({ perPage: 1000 });
    const staffUser = authUsers.users.find(u => u.email === staff.email);
    expect(staffUser, 'staff auth user should exist').toBeTruthy();

    const { error: insErr } = await admin!
      .from('org_members')
      .insert({ org_id: orgId, user_id: staffUser!.id, role: 'staff', is_active: true });
    expect(insErr).toBeNull();

    await signIn(page, staff.email, staff.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/reports');
    await expect(page.getByText('Reports are only visible to an owner or admin.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sales by Item')).toHaveCount(0);
  });

  // ── 8. Teardown verification: no orphaned __TEST__ report data ──────────────
  test('post-run check: cleanup removes all __TEST__ report data', async ({ page: _page }) => {
    await cleanupTestData(createdUserIds);
    _client = null; // signed-in user is deleted; drop the cached client.

    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: orphanCustomers } = await admin!.from('erp_customers')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanCustomers || []).length, 'no __TEST__ customers should remain').toBe(0);

    const { data: orphanItems } = await admin!.from('erp_items')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanItems || []).length, 'no __TEST__ items should remain').toBe(0);

    const { data: orphanInvoices } = await admin!.from('erp_invoices')
      .select('id, invoice_no').like('invoice_no', `REP-%-${stamp}`);
    expect((orphanInvoices || []).length, 'no __TEST__ invoices should remain').toBe(0);

    const { data: orphanOrgs } = await admin!.from('organizations')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanOrgs || []).length, 'no __TEST__ orgs should remain').toBe(0);

    // Explicit sweep of invoice_items / stock / stock_ledger tied to the invoice/item
    // ids we created — should already be gone via org purge, verify rather than trust.
    const invoiceIds = [invAId, invBId, invCId].filter(Boolean);
    if (invoiceIds.length) {
      const { data: leftoverItems } = await admin!.from('erp_invoice_items')
        .select('id').in('invoice_id', invoiceIds);
      expect((leftoverItems || []).length, 'no __TEST__ invoice items should remain').toBe(0);
    }

    const itemIds = [lowStockItemId, noReorderItemId, saleItemId, freshItemId, agedItemId].filter(Boolean);
    if (itemIds.length) {
      const { data: leftoverStock } = await admin!.from('erp_stock')
        .select('id').in('item_id', itemIds);
      expect((leftoverStock || []).length, 'no __TEST__ stock rows should remain').toBe(0);

      const { data: leftoverLedger } = await admin!.from('erp_stock_ledger')
        .select('id').in('item_id', itemIds);
      expect((leftoverLedger || []).length, 'no __TEST__ stock ledger rows should remain').toBe(0);
    }
  });
});

// Mirrors src/components/ui.tsx's fmtCurrency exactly, so UI/CSV text assertions match.
function fmtINR(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

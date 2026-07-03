import { test, expect, type Page } from '@playwright/test';
import { type SupabaseClient } from '@supabase/supabase-js';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import {
  cleanupTestData, createConfirmedUser, hasServiceRole, adminClient, authedClient, TEST_PREFIX
} from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.purch.owner.${stamp}@gmail.com`, password: 'Test1234!' };
const staff = { email: `xlerp.test.purch.staff.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}Purch_${stamp}`;

// Plain item bought in the critical stock-in test.
const plainItem = `${TEST_PREFIX}Bolt ${stamp}`;
const PLAIN_PUR_PRICE = 12;       // erp_items.purchase_price (rate should default to this)
const PLAIN_PUR_QTY = 25;         // qty bought

// Variant item + one variant bought in the variant stock-in test.
const varItem = `${TEST_PREFIX}Cable ${stamp}`;
const redName = `${TEST_PREFIX}Red ${stamp}`;
const RED_PUR_PRICE = 40;
const RED_PUR_QTY = 7;

// Supplier the purchases are bought from.
const supplierName = `${TEST_PREFIX}Acme Supply ${stamp}`;
const SUPPLIER_OPENING = 500;     // opening_balance seeded on the supplier

// Money math for the outstanding/payment test (uses the plain purchase).
// total = qty*rate (+ no tax) = 25*12 = 300. We pay 100 at create -> balance 200.
const PAID_AT_CREATE = 100;
const PAYMENT_OUT = 150;          // later recorded via the ledger UI

const createdUserIds: string[] = [];

// Shared IDs resolved during setup.
let warehouseId = '';
let plainItemId = '';
let varItemId = '';
let redId = '';
let supplierId = '';
let plainPurchaseId = '';

let _client: SupabaseClient | null = null;
async function db(): Promise<SupabaseClient> {
  if (!_client) _client = await authedClient(owner.email, owner.password);
  expect(_client, 'authed client (anon key + sign-in) should be available').not.toBeNull();
  return _client!;
}

async function stockQty(itemId: string, variantId: string | null): Promise<number | null> {
  const client = await db();
  let q = client.from('erp_stock').select('quantity')
    .eq('item_id', itemId).eq('warehouse_id', warehouseId);
  q = variantId === null ? q.is('variant_id', null) : q.eq('variant_id', variantId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data ? Number(data.quantity) : null;
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

// ── UI helper: select the purchase item in the first row via keyboard dropdown ─
async function pickItemInRow(page: Page, search: string, fullName: string) {
  const nameInput = page.locator('input[placeholder="Item name..."]').first();
  await nameInput.click();
  await nameInput.fill(search);
  await expect(page.locator('div.absolute >> text=' + fullName).first()).toBeVisible({ timeout: 10_000 });
  await nameInput.press('ArrowDown');
  await nameInput.press('Enter');
  await expect(nameInput).toHaveValue(fullName);
}

async function setSupplier(page: Page, name: string) {
  const supInput = page.locator('input[placeholder="Type supplier name..."]');
  await supInput.click();
  await supInput.fill(name);
  // Existing supplier should appear in the dropdown (it was created in setup).
  const option = page.locator('div.absolute >> text=' + name).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(supInput).toHaveValue(name);
}

test.describe('purchases & suppliers e2e', () => {
  // ── 1. Setup ───────────────────────────────────────────────────────────────
  test('setup: org, supplier (with opening balance), plain item, variant item', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    // ── Plain item with a known purchase_price (so the row rate defaults to it) ──
    await page.goto('/items');
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(plainItem);
    await page.locator('label:has-text("Purchase Price (₹)") + input').fill(String(PLAIN_PUR_PRICE));
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(plainItem).first()).toBeVisible({ timeout: 15_000 });

    // ── Variant item with one variant (Red) carrying a purchase_price ──
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(varItem);
    await page.getByText('This item has variants (e.g. size / colour)').click();
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(varItem).first()).toBeVisible({ timeout: 15_000 });

    // Reopen to add the variant (VariantEditor needs a saved item_id).
    await page.getByText(varItem).first().click();
    await expect(page.getByText('This item has variants (e.g. size / colour)')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '➕ Add Variant' }).click();
    await page.locator('label:has-text("Variant Name *") + input').fill(redName);
    // Variant editor has a Purchase Price field (owner/admin) — set Red's purchase price.
    await page.locator('label:has-text("Purchase Price (₹)") + input').last().fill(String(RED_PUR_PRICE));
    await page.getByRole('button', { name: '💾 Save Variant' }).click();
    await expect(page.getByText(redName).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();

    // ── Resolve IDs + default warehouse via the authed client ──
    const client = await db();

    const { data: wh } = await client.from('erp_warehouses')
      .select('id, is_default').order('is_default', { ascending: false });
    expect(wh && wh.length, 'org should have at least one warehouse').toBeTruthy();
    warehouseId = (wh!.find((w: any) => w.is_default) || wh![0]).id;

    const { data: plain } = await client.from('erp_items')
      .select('id, has_variants, purchase_price').eq('name', plainItem).single();
    expect(plain).toBeTruthy();
    expect(plain!.has_variants).toBe(false);
    expect(Number(plain!.purchase_price)).toBe(PLAIN_PUR_PRICE);
    plainItemId = plain!.id;

    const { data: vi } = await client.from('erp_items')
      .select('id, has_variants').eq('name', varItem).single();
    expect(vi).toBeTruthy();
    expect(vi!.has_variants, 'variant item should have has_variants=true').toBe(true);
    varItemId = vi!.id;

    const { data: variants } = await client.from('erp_item_variants')
      .select('id, variant_name, purchase_price').eq('item_id', varItemId);
    expect(variants && variants.length, 'one variant should exist').toBe(1);
    redId = variants![0].id;
    expect(redId).toBeTruthy();

    // ── Create the supplier WITH an opening balance via the authed client ──
    // (RLS path: org_id resolves from the signed-in session, same as supplierService.create).
    const { data: sup, error: supErr } = await client.from('erp_suppliers')
      .insert({ name: supplierName, opening_balance: SUPPLIER_OPENING })
      .select().single();
    expect(supErr, 'supplier insert should succeed').toBeNull();
    supplierId = sup!.id;

    // Fresh items: no stock yet. Confirm the baseline is zero/absent before any purchase.
    expect(await stockQty(plainItemId, null)).toBeNull();
    expect(await stockQty(varItemId, redId)).toBeNull();
  });

  // ── 2. THE CRITICAL TEST — purchase stock-IN integrity ──────────────────────
  test('CRITICAL: a received purchase stock-INs the item and writes a positive purchase ledger row', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/purchases/new');
    await expect(page.getByText('➕ New Purchase').first()).toBeVisible({ timeout: 15_000 });

    await setSupplier(page, supplierName);

    // Pick the plain item; rate should auto-default to its purchase_price.
    await pickItemInRow(page, `Bolt ${stamp}`, plainItem);
    const rateInput = page.locator('input[type="number"]').nth(1); // qty, rate, (amount readonly)
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBe(PLAIN_PUR_PRICE);
    }).toPass({ timeout: 5_000 });

    // Qty bought.
    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill(String(PLAIN_PUR_QTY));

    // Partial payment so a balance remains (drives the outstanding/payment test).
    // Charges card: first number input is Tax, second is Amount Paid.
    const paidInput = page.locator('label:has-text("Amount Paid (₹)") + input');
    await paidInput.fill(String(PAID_AT_CREATE));

    await page.getByRole('button', { name: '💾 Save Purchase' }).click();
    await expect(page).toHaveURL(/\/purchases$/, { timeout: 15_000 });

    // ── DB assertions (authed client, RLS-scoped to this org) ──
    const client = await db();

    // The purchase header persisted with correct money math.
    const { data: purchases, error: pErr } = await client.from('erp_purchases')
      .select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false });
    expect(pErr).toBeNull();
    expect((purchases || []).length, 'one purchase should exist for the supplier').toBe(1);
    const pur = purchases![0];
    plainPurchaseId = pur.id;
    expect(pur.status, 'UI must send status=received for stock-in to fire').toBe('received');
    expect(pur.warehouse_id, 'UI must send a warehouse_id for stock-in to fire').toBe(warehouseId);
    const expectedTotal = PLAIN_PUR_QTY * PLAIN_PUR_PRICE; // 25*12 = 300, no tax
    expect(Number(pur.total)).toBe(expectedTotal);
    expect(Number(pur.paid)).toBe(PAID_AT_CREATE);
    expect(Number(pur.balance)).toBe(expectedTotal - PAID_AT_CREATE);

    // erp_purchase_items row persisted with correct item_id, qty, rate.
    const { data: pItems, error: piErr } = await client.from('erp_purchase_items')
      .select('item_id, variant_id, qty, rate').eq('purchase_id', plainPurchaseId);
    expect(piErr).toBeNull();
    expect((pItems || []).length).toBe(1);
    expect(pItems![0].item_id).toBe(plainItemId);
    expect(pItems![0].variant_id).toBeNull();
    expect(Number(pItems![0].qty)).toBe(PLAIN_PUR_QTY);
    expect(Number(pItems![0].rate)).toBe(PLAIN_PUR_PRICE);

    // Stock INCREASED by exactly the purchased qty (from null/0 baseline).
    expect(await stockQty(plainItemId, null)).toBe(PLAIN_PUR_QTY);

    // A POSITIVE purchase ledger row references this purchase.
    const { data: ledger, error: lErr } = await client.from('erp_stock_ledger')
      .select('change_qty, reason, ref_type, ref_id, variant_id')
      .eq('item_id', plainItemId).eq('reason', 'purchase');
    expect(lErr).toBeNull();
    expect((ledger || []).length, 'exactly one purchase ledger row for the plain item').toBe(1);
    const row = ledger![0];
    expect(Number(row.change_qty), 'stock-IN must be a POSITIVE change').toBe(PLAIN_PUR_QTY);
    expect(row.reason).toBe('purchase');
    expect(row.ref_type).toBe('purchase');
    expect(row.ref_id).toBe(plainPurchaseId);
    expect(row.variant_id).toBeNull();
  });

  // ── 3. Variant purchase stock-in ────────────────────────────────────────────
  test('variant purchase stock-INs only that variant with the correct variant_id on the ledger', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/purchases/new');
    await expect(page.getByText('➕ New Purchase').first()).toBeVisible({ timeout: 15_000 });

    await setSupplier(page, supplierName);

    // Pick the variant item, then choose Red from the per-row variant select.
    await pickItemInRow(page, `Cable ${stamp}`, varItem);
    const variantSelect = page.locator('select').filter({ hasText: 'Choose variant…' }).first();
    await expect(variantSelect).toBeVisible({ timeout: 10_000 });
    await variantSelect.selectOption(redId);

    // Rate should default to the variant's purchase_price.
    const rateInput = page.locator('input[type="number"]').nth(1);
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBe(RED_PUR_PRICE);
    }).toPass({ timeout: 5_000 });

    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill(String(RED_PUR_QTY));

    await page.getByRole('button', { name: '💾 Save Purchase' }).click();
    await expect(page).toHaveURL(/\/purchases$/, { timeout: 15_000 });

    const client = await db();

    // Red variant stock increased by exactly the purchased qty.
    expect(await stockQty(varItemId, redId)).toBe(RED_PUR_QTY);
    // The item-level (variant null) stock for the variant item must NOT have been created.
    expect(await stockQty(varItemId, null)).toBeNull();

    // Ledger row tagged with Red's variant_id, positive change, reason purchase.
    const { data: ledger } = await client.from('erp_stock_ledger')
      .select('change_qty, reason, ref_type, variant_id')
      .eq('item_id', varItemId).eq('reason', 'purchase');
    expect((ledger || []).length).toBe(1);
    expect(ledger![0].variant_id, 'ledger row must carry Red variant_id').toBe(redId);
    expect(Number(ledger![0].change_qty)).toBe(RED_PUR_QTY);
    expect(ledger![0].ref_type).toBe('purchase');

    // purchase_items row carries the variant_id.
    const { data: pItems } = await client.from('erp_purchase_items')
      .select('variant_id, qty').eq('item_id', varItemId).eq('variant_id', redId);
    expect((pItems || []).length).toBe(1);
    expect(Number(pItems![0].qty)).toBe(RED_PUR_QTY);
  });

  // ── 4. Supplier outstanding + payment-out via the ledger UI ─────────────────
  test('supplier outstanding reflects opening + purchase balances; recording a payment reduces it', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const client = await db();

    // Before any payment: outstanding = opening + sum(purchase balances).
    // plain purchase balance = 200; variant purchase fully unpaid = total 7*40 = 280.
    const variantTotal = RED_PUR_QTY * RED_PUR_PRICE; // 280
    const plainBalance = PLAIN_PUR_QTY * PLAIN_PUR_PRICE - PAID_AT_CREATE; // 200
    const expectedBefore = SUPPLIER_OPENING + plainBalance + variantTotal; // 500+200+280 = 980

    // Compute the same way supplierService.outstanding does, straight from the DB.
    const computeOutstanding = async () => {
      const { data: sup } = await client.from('erp_suppliers')
        .select('opening_balance').eq('id', supplierId).single();
      const { data: purs } = await client.from('erp_purchases')
        .select('balance').eq('supplier_id', supplierId);
      const opening = Number(sup?.opening_balance ?? 0);
      const billed = (purs || []).reduce((s: number, p: any) => s + Number(p.balance ?? 0), 0);
      return opening + billed;
    };
    expect(await computeOutstanding(), 'outstanding before payment').toBe(expectedBefore);

    // ── Record a payment-out via the Suppliers ledger UI, applied to the plain bill ──
    await page.goto('/suppliers');
    await expect(page.getByText('🏭 Suppliers').first()).toBeVisible({ timeout: 15_000 });

    // Open the ledger for our supplier.
    await page.getByText(supplierName).first().click();
    await expect(page.getByText('Outstanding').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '💵 Record Payment' }).click();
    await expect(page.getByText('💵 Pay').first()).toBeVisible({ timeout: 10_000 });

    // Amount field (autofocused) — overwrite the suggested amount with our test amount.
    const amountInput = page.locator('label:has-text("Amount (₹)") + input');
    await amountInput.fill(String(PAYMENT_OUT));

    // Apply to the specific plain bill so its paid/balance update.
    const billSelect = page.locator('label:has-text("Apply to bill (optional)") + select');
    await billSelect.selectOption(plainPurchaseId);

    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();

    // The modal reloads the ledger; wait for the payment to land in DB.
    await expect(async () => {
      const { data: pmts } = await client.from('erp_payments')
        .select('id').eq('party_id', supplierId).eq('direction', 'out');
      expect((pmts || []).length).toBe(1);
    }).toPass({ timeout: 15_000 });

    // erp_payments row: direction out, party_type supplier, ref_id = the plain purchase.
    const { data: pmts } = await client.from('erp_payments')
      .select('direction, party_type, party_id, ref_type, ref_id, amount')
      .eq('party_id', supplierId);
    expect((pmts || []).length).toBe(1);
    const pmt = pmts![0];
    expect(pmt.direction).toBe('out');
    expect(pmt.party_type).toBe('supplier');
    expect(pmt.party_id).toBe(supplierId);
    expect(pmt.ref_type).toBe('purchase');
    expect(pmt.ref_id, 'payment must reference the plain purchase').toBe(plainPurchaseId);
    expect(Number(pmt.amount)).toBe(PAYMENT_OUT);

    // The plain purchase paid increased / balance decreased by the payment.
    const { data: pur } = await client.from('erp_purchases')
      .select('paid, balance').eq('id', plainPurchaseId).single();
    expect(Number(pur!.paid)).toBe(PAID_AT_CREATE + PAYMENT_OUT);        // 100+150 = 250
    expect(Number(pur!.balance)).toBe(plainBalance - PAYMENT_OUT);       // 200-150 = 50

    // Outstanding dropped by exactly the payment amount.
    expect(await computeOutstanding(), 'outstanding after payment').toBe(expectedBefore - PAYMENT_OUT);
  });

  // ── 5. RoleGate: staff sees the restricted fallback, not the forms ──────────
  test('staff role: /purchases/new and /suppliers show the restricted fallback', async ({ page }) => {
    const admin = adminClient();
    expect(admin).not.toBeNull();

    // Resolve our org by its unique __TEST__ name (unambiguous; avoids relying on
    // listUsers() pagination which can miss a user when many exist in the project).
    const { data: orgRow } = await admin!
      .from('organizations').select('id').eq('name', org).single();
    expect(orgRow, 'the test org should exist').toBeTruthy();
    const orgId = orgRow!.id;

    // Find the staff user id by email (createConfirmedUser created it in beforeAll).
    const { data: authUsers } = await admin!.auth.admin.listUsers({ perPage: 1000 });
    const staffUser = authUsers.users.find(u => u.email === staff.email);
    expect(staffUser, 'staff auth user should exist').toBeTruthy();

    const { error: insErr } = await admin!
      .from('org_members')
      .insert({ org_id: orgId, user_id: staffUser!.id, role: 'staff', is_active: true });
    expect(insErr).toBeNull();

    await signIn(page, staff.email, staff.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    // /purchases/new — fallback copy shown, the purchase form (Save Purchase) is NOT.
    await page.goto('/purchases/new');
    await expect(page.getByText('Purchases can only be created by an owner or admin.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '💾 Save Purchase' })).toHaveCount(0);

    // /suppliers — fallback copy shown, the Add Supplier form is NOT.
    await page.goto('/suppliers');
    await expect(page.getByText('Suppliers are only visible to an owner or admin.')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[placeholder="Supplier name"]')).toHaveCount(0);

    // /purchases (list) — fallback copy shown, no purchase rows or CSV export leak cost/supplier data.
    await page.goto('/purchases');
    await expect(page.getByText('Purchases are only visible to an owner or admin.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '⬇ Export CSV' })).toHaveCount(0);
  });

  // ── 6. Teardown verification: no orphaned __TEST__ purchase data ────────────
  test('post-run check: cleanup removes all __TEST__ purchase/supplier/payment data', async ({ page: _page }) => {
    await cleanupTestData(createdUserIds);
    _client = null; // signed-in user is deleted; drop the cached client.

    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: orphanSuppliers } = await admin!.from('erp_suppliers')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanSuppliers || []).length, 'no __TEST__ suppliers should remain').toBe(0);

    const { data: orphanItems } = await admin!.from('erp_items')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanItems || []).length, 'no __TEST__ items should remain').toBe(0);

    const { data: orphanOrgs } = await admin!.from('organizations')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    const testOrgIds = (orphanOrgs || []).map((o: any) => o.id);
    expect(testOrgIds.length, 'no __TEST__ orgs should remain').toBe(0);

    // No purchases/payments left tied to any test org (sweep by org isn't possible
    // once orgs are gone, so confirm none reference our resolved org's leftovers
    // by checking the test-prefixed supplier set is empty — done above — and that
    // the purchase ids we created are gone).
    if (plainPurchaseId) {
      const { data: leftoverPur } = await admin!.from('erp_purchases')
        .select('id').eq('id', plainPurchaseId);
      expect((leftoverPur || []).length, 'the test purchase should be deleted').toBe(0);
      const { data: leftoverPmt } = await admin!.from('erp_payments')
        .select('id').eq('ref_id', plainPurchaseId);
      expect((leftoverPmt || []).length, 'the test payment should be deleted').toBe(0);
    }
  });
});

import { test, expect, type Page } from '@playwright/test';
import { type SupabaseClient } from '@supabase/supabase-js';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import {
  cleanupTestData, createConfirmedUser, hasServiceRole, authedClient, TEST_PREFIX
} from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.variants.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}Variants_${stamp}`;

// Variant item + its two variants.
const itemName = `${TEST_PREFIX}Tee ${stamp}`;
const redName = `${TEST_PREFIX}Red ${stamp}`;
const blueName = `${TEST_PREFIX}Blue ${stamp}`;
const RED_PRICE = 250;
const BLUE_PRICE = 400;
const RED_OPENING = 30;
const BLUE_OPENING = 17;
const RED_SELL_QTY = 4; // qty of Red sold in the critical test

// A plain (non-variant) item for the regression test.
const plainItem = `${TEST_PREFIX}Plain ${stamp}`;
const PLAIN_PRICE = 99;
const PLAIN_OPENING = 50;
const PLAIN_SELL_QTY = 6;

const custName = `${TEST_PREFIX}VarCust ${stamp}`;
const plainCustName = `${TEST_PREFIX}PlainCust ${stamp}`;
const blockCustName = `${TEST_PREFIX}BlockCust ${stamp}`;

const createdUserIds: string[] = [];

// Shared IDs resolved during setup (via the authed client) and reused by later tests.
let warehouseId = '';
let itemId = '';
let plainItemId = '';
let redId = '';
let blueId = '';

// Lazily-created authed (anon-key, signed-in) client for seeding + DB assertions.
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
  const id = await createConfirmedUser(owner.email, owner.password);
  if (id) createdUserIds.push(id);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

// ── Helpers shared by the billing tests ──────────────────────────────────────

// Pick an item in the first billing row via the keyboard dropdown (matches the
// pattern in billing-keyboard.spec.ts). `search` is a substring of the item name.
async function pickItemInRow(page: Page, search: string, fullName: string) {
  const nameInput = page.locator('input[placeholder="Item name..."]').first();
  await nameInput.click();
  await nameInput.fill(search);
  await expect(page.locator('div.absolute >> text=' + fullName).first()).toBeVisible({ timeout: 10_000 });
  await nameInput.press('ArrowDown');
  await nameInput.press('Enter');
  await expect(nameInput).toHaveValue(fullName);
}

async function setCustomer(page: Page, name: string) {
  const custInput = page.locator('input[placeholder="Type customer name..."]');
  await custInput.click();
  await custInput.fill(name);
  const addNewOption = page.getByText(`+ Add new customer "${name}"`);
  await expect(addNewOption).toBeVisible({ timeout: 10_000 });
  await addNewOption.click();
  await expect(custInput).toHaveValue(name);
}

// ── 1. Setup ─────────────────────────────────────────────────────────────────

test.describe('variants e2e', () => {
  test('setup: org, variant item with two variants, plain item, seeded per-variant stock', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    // ── Create the variant item (has_variants ON) ──
    await page.goto('/items');
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(itemName);
    // Set a base sale price so the (unused) item-level price is distinct from variant prices.
    await page.locator('label:has-text("Sale Price (₹)") + input').first().fill('1');
    // Toggle has_variants. The editor warns to save first before variants can be added.
    await page.getByText('This item has variants (e.g. size / colour)').click();
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 15_000 });

    // Reopen the item to add variants (VariantEditor needs a saved item_id).
    await page.getByText(itemName).first().click();
    await expect(page.getByText('This item has variants (e.g. size / colour)')).toBeVisible({ timeout: 10_000 });

    // Add Red.
    await page.getByRole('button', { name: '➕ Add Variant' }).click();
    await page.locator('label:has-text("Variant Name *") + input').fill(redName);
    await page.locator('label:has-text("Sale Price (₹)") + input').last().fill(String(RED_PRICE));
    await page.getByRole('button', { name: '💾 Save Variant' }).click();
    await expect(page.getByText(redName).first()).toBeVisible({ timeout: 10_000 });

    // Add Blue.
    await page.getByRole('button', { name: '➕ Add Variant' }).click();
    await page.locator('label:has-text("Variant Name *") + input').fill(blueName);
    await page.locator('label:has-text("Sale Price (₹)") + input').last().fill(String(BLUE_PRICE));
    await page.getByRole('button', { name: '💾 Save Variant' }).click();
    await expect(page.getByText(blueName).first()).toBeVisible({ timeout: 10_000 });

    // Close the item editor.
    await page.getByRole('button', { name: 'Cancel' }).click();

    // ── Create a plain (non-variant) item with a base sale price ──
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(plainItem);
    await page.locator('label:has-text("Sale Price (₹)") + input').first().fill(String(PLAIN_PRICE));
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(plainItem).first()).toBeVisible({ timeout: 15_000 });

    // ── Resolve IDs + default warehouse via the authed client ──
    const client = await db();

    const { data: wh } = await client.from('erp_warehouses')
      .select('id, is_default').order('is_default', { ascending: false });
    expect(wh && wh.length, 'org should have at least one warehouse').toBeTruthy();
    warehouseId = (wh!.find((w: any) => w.is_default) || wh![0]).id;

    const { data: variantItem } = await client.from('erp_items')
      .select('id, has_variants').eq('name', itemName).single();
    expect(variantItem).toBeTruthy();
    expect(variantItem!.has_variants, 'variant item should have has_variants=true').toBe(true);
    itemId = variantItem!.id;

    const { data: plain } = await client.from('erp_items')
      .select('id, has_variants').eq('name', plainItem).single();
    expect(plain).toBeTruthy();
    expect(plain!.has_variants).toBe(false);
    plainItemId = plain!.id;

    const { data: variants } = await client.from('erp_item_variants')
      .select('id, variant_name, sale_price').eq('item_id', itemId);
    expect(variants && variants.length, 'two variants should exist').toBe(2);
    redId = variants!.find((v: any) => v.variant_name === redName)!.id;
    blueId = variants!.find((v: any) => v.variant_name === blueName)!.id;
    expect(redId).toBeTruthy();
    expect(blueId).toBeTruthy();

    // ── Seed opening stock through the sacred RPC (per-variant + plain) ──
    // This is the same path the app uses (stockService.applyMovement -> erp_apply_stock),
    // so org_id/auth.uid() resolve from the signed-in session. NEVER write erp_stock directly.
    const seed = async (seedItemId: string, variantId: string | null, change: number) => {
      const { error } = await client.rpc('erp_apply_stock', {
        p_item: seedItemId,
        p_variant: variantId,
        p_wh: warehouseId,
        p_change: change,
        p_reason: 'opening',
        p_ref_type: 'test-seed',
        p_ref_id: null,
        p_note: '__TEST__ opening'
      });
      expect(error, 'erp_apply_stock seed should succeed').toBeNull();
    };
    await seed(itemId, redId, RED_OPENING);
    await seed(itemId, blueId, BLUE_OPENING);
    await seed(plainItemId, null, PLAIN_OPENING); // plain item, variant_id NULL path

    // Confirm the seed landed exactly.
    expect(await stockQty(itemId, redId)).toBe(RED_OPENING);
    expect(await stockQty(itemId, blueId)).toBe(BLUE_OPENING);
    expect(await stockQty(plainItemId, null)).toBe(PLAIN_OPENING);
  });

  // ── 2. THE CRITICAL TEST: per-variant stock integrity ──────────────────────

  test('CRITICAL: selling Red decrements only Red stock and writes a Red-tagged ledger row', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/billing');

    // Pick the variant item.
    await pickItemInRow(page, `Tee ${stamp}`, itemName);

    // The variant <select> appears under the name. Choose Red.
    const variantSelect = page.locator('select').filter({ hasText: 'Choose variant…' }).first();
    await expect(variantSelect).toBeVisible({ timeout: 10_000 });
    // Select by option value (= variant id), robust against currency formatting.
    await variantSelect.selectOption(redId);

    // Row name should become "Item — Red" and rate should be Red's price.
    const nameInput = page.locator('input[placeholder="Item name..."]').first();
    await expect(nameInput).toHaveValue(`${itemName} — ${redName}`);
    const rateInput = page.locator('input[type="number"]').nth(1);
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBe(RED_PRICE);
    }).toPass({ timeout: 5_000 });

    // Set qty.
    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill(String(RED_SELL_QTY));

    await setCustomer(page, custName);

    await page.getByRole('button', { name: '💾 Save Invoice' }).click();
    await expect(page).toHaveURL(/\/sales$/, { timeout: 15_000 });
    await expect(page.getByText(custName).first()).toBeVisible({ timeout: 15_000 });

    // ── DB assertions (authed client, RLS-scoped to this org) ──
    const client = await db();

    // Red decreased by exactly the sold qty.
    expect(await stockQty(itemId, redId)).toBe(RED_OPENING - RED_SELL_QTY);
    // Blue UNCHANGED — the invariant that matters most.
    expect(await stockQty(itemId, blueId)).toBe(BLUE_OPENING);

    // A ledger row exists with Red's variant_id, negative change, reason 'sale'.
    const { data: ledger, error: ledgerErr } = await client.from('erp_stock_ledger')
      .select('variant_id, change_qty, reason').eq('item_id', itemId).eq('reason', 'sale');
    expect(ledgerErr).toBeNull();
    const redSale = (ledger || []).find((l: any) => l.variant_id === redId);
    expect(redSale, 'a sale ledger row tagged with the Red variant_id must exist').toBeTruthy();
    expect(Number(redSale!.change_qty)).toBe(-RED_SELL_QTY);
    // No sale ledger row should ever reference Blue.
    expect((ledger || []).some((l: any) => l.variant_id === blueId)).toBe(false);

    // The invoice_items row carries Red's variant_id.
    const { data: invItems } = await client.from('erp_invoice_items')
      .select('variant_id, qty, name').eq('item_id', itemId).eq('variant_id', redId);
    expect(invItems && invItems.length, 'invoice_items row with Red variant_id must exist').toBeTruthy();
    expect(Number(invItems![0].qty)).toBe(RED_SELL_QTY);
    expect(invItems![0].name).toContain(redName);
  });

  // ── 3. Save-blocking when no variant chosen ────────────────────────────────

  test('save is blocked when a has_variants item has no variant chosen', async ({ page }) => {
    const blockedAlerts: string[] = [];
    page.on('dialog', d => { blockedAlerts.push(d.message()); d.accept().catch(() => {}); });

    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/billing');

    // Pick the variant item but do NOT choose a variant.
    await pickItemInRow(page, `Tee ${stamp}`, itemName);
    await expect(page.locator('select').filter({ hasText: 'Choose variant…' }).first()).toBeVisible({ timeout: 10_000 });

    // Give it a qty and a customer so the only validation failure is the missing variant.
    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill('2');
    await setCustomer(page, blockCustName);

    // Attempt save.
    await page.getByRole('button', { name: '💾 Save Invoice' }).click();

    // Must NOT navigate to /sales, and an alert about choosing a variant must fire.
    await page.waitForTimeout(800);
    await expect(page).not.toHaveURL(/\/sales$/);
    expect(blockedAlerts.some(m => /choose a variant/i.test(m))).toBe(true);

    // And no invoice should have been created for this customer.
    const client = await db();
    const { data: inv } = await client.from('erp_invoices')
      .select('id').eq('customer_name', blockCustName);
    expect((inv || []).length, 'no invoice should be created when variant is missing').toBe(0);
  });

  // ── 4. Non-variant regression ──────────────────────────────────────────────

  test('regression: a plain (non-variant) item still sells and decrements item-level stock', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/billing');

    await pickItemInRow(page, `Plain ${stamp}`, plainItem);

    // No variant select should appear for a plain item.
    await expect(page.locator('select').filter({ hasText: 'Choose variant…' })).toHaveCount(0);

    const rateInput = page.locator('input[type="number"]').nth(1);
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBe(PLAIN_PRICE);
    }).toPass({ timeout: 5_000 });

    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill(String(PLAIN_SELL_QTY));

    await setCustomer(page, plainCustName);

    await page.getByRole('button', { name: '💾 Save Invoice' }).click();
    await expect(page).toHaveURL(/\/sales$/, { timeout: 15_000 });
    await expect(page.getByText(plainCustName).first()).toBeVisible({ timeout: 15_000 });

    // Item-level (variant_id NULL) stock decreased by exactly the sold qty.
    expect(await stockQty(plainItemId, null)).toBe(PLAIN_OPENING - PLAIN_SELL_QTY);

    // The sale ledger row for the plain item has a NULL variant_id.
    const client = await db();
    const { data: ledger } = await client.from('erp_stock_ledger')
      .select('variant_id, change_qty').eq('item_id', plainItemId).eq('reason', 'sale');
    const sale = (ledger || []).find((l: any) => Number(l.change_qty) === -PLAIN_SELL_QTY);
    expect(sale, 'plain item sale ledger row must exist').toBeTruthy();
    expect(sale!.variant_id, 'plain item sale must have NULL variant_id').toBeNull();
  });

  // ── 5. Inventory per-variant display ───────────────────────────────────────

  test('Inventory shows per-variant sub-rows reflecting the Red sale, Blue unchanged', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/inventory');
    await expect(page.getByText('🏬 Inventory').first()).toBeVisible({ timeout: 15_000 });

    // Filter to the variant item so the sub-rows are easy to locate.
    await page.locator('input[placeholder="🔍 Search items..."]').fill(`Tee ${stamp}`);
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 10_000 });

    // Red sub-row: reduced quantity. Blue sub-row: unchanged.
    const redRow = page.locator('tr', { hasText: redName }).first();
    await expect(redRow).toBeVisible({ timeout: 10_000 });
    await expect(redRow).toContainText(String(RED_OPENING - RED_SELL_QTY));

    const blueRow = page.locator('tr', { hasText: blueName }).first();
    await expect(blueRow).toBeVisible();
    await expect(blueRow).toContainText(String(BLUE_OPENING));
  });

  // ── 6. Teardown verification: no orphaned __TEST__ variant data ────────────

  test('post-run check: cleanup removes all __TEST__ variant data (no orphans)', async ({ page: _page }) => {
    // Run the teardown now (afterAll also runs it; running here lets us assert the
    // result within a test so a failure is reported clearly).
    await cleanupTestData(createdUserIds);
    _client = null; // signed-in user is deleted; drop the cached client.

    // Verify with the service-role client that nothing __TEST__ remains.
    const { adminClient } = await import('./helpers/admin');
    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: orphanVariants } = await admin!.from('erp_item_variants')
      .select('id, variant_name').like('variant_name', `${TEST_PREFIX}%`);
    expect((orphanVariants || []).length, 'no __TEST__ variants should remain').toBe(0);

    const { data: orphanItems } = await admin!.from('erp_items')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanItems || []).length, 'no __TEST__ items should remain').toBe(0);

    const { data: orphanInv } = await admin!.from('erp_invoices')
      .select('id, customer_name').like('customer_name', `${TEST_PREFIX}%`);
    expect((orphanInv || []).length, 'no __TEST__ invoices should remain').toBe(0);

    const { data: orphanOrgs } = await admin!.from('organizations')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanOrgs || []).length, 'no __TEST__ orgs should remain').toBe(0);
  });
});

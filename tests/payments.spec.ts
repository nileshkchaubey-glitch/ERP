import { test, expect, type Page } from '@playwright/test';
import { type SupabaseClient } from '@supabase/supabase-js';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import {
  cleanupTestData, createConfirmedUser, hasServiceRole, adminClient, authedClient, TEST_PREFIX
} from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.pay.owner.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}Pay_${stamp}`;

const custName = `${TEST_PREFIX}PayCust ${stamp}`;

// Three invoices with different totals, seeded directly via the authed client
// (matching invoiceService.create's insert shape — see erpServices.ts). Dates
// are set a few days apart so oldest-first allocation ordering is meaningful.
const INV1_TOTAL = 1000; // oldest
const INV2_TOTAL = 600;  // middle
const INV3_TOTAL = 400;  // newest — left untouched in the multi-invoice test

// Multi-invoice payment: covers INV1 fully (1000) + INV2 partially (300) = 1300.
const MULTI_PAYMENT = 1300;
const INV2_ALLOC = 300;

// On-account payment (no allocations).
const ON_ACCOUNT_PAYMENT = 250;

const createdUserIds: string[] = [];

let custId = '';
let inv1Id = '', inv2Id = '', inv3Id = '';
let openingBalance = 0;

let _client: SupabaseClient | null = null;
async function db(): Promise<SupabaseClient> {
  if (!_client) _client = await authedClient(owner.email, owner.password);
  expect(_client, 'authed client (anon key + sign-in) should be available').not.toBeNull();
  return _client!;
}

// Mirrors customerService.outstanding's fixed formula: opening_balance +
// sum(invoice.total) - sum(payments in). Deliberately NOT summing invoice.balance.
async function computeOutstanding(customerId: string): Promise<number> {
  const client = await db();
  const { data: cust } = await client.from('erp_customers')
    .select('opening_balance').eq('id', customerId).single();
  const { data: invoices } = await client.from('erp_invoices')
    .select('total').eq('customer_id', customerId);
  const { data: payments } = await client.from('erp_payments')
    .select('amount').eq('party_type', 'customer').eq('party_id', customerId).eq('direction', 'in');
  const opening = Number(cust?.opening_balance ?? 0);
  const billed = (invoices || []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const paidIn = (payments || []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  return opening + billed - paidIn;
}

async function seedInvoice(client: SupabaseClient, opts: {
  invoiceNo: string; total: number; invoiceDate: string; warehouseId: string;
}): Promise<string> {
  const { data, error } = await client.from('erp_invoices').insert({
    invoice_no: opts.invoiceNo,
    customer_id: custId,
    customer_name: custName,
    warehouse_id: opts.warehouseId,
    invoice_date: opts.invoiceDate,
    subtotal: opts.total,
    discount: 0,
    tax_amount: 0,
    total: opts.total,
    paid: 0,
    balance: opts.total,
    payment_type: 'Credit',
    status: 'active',
    notes: null
  }).select().single();
  expect(error, `seed invoice ${opts.invoiceNo} should succeed`).toBeNull();
  return data!.id;
}

test.beforeAll(async () => {
  const ownerId = await createConfirmedUser(owner.email, owner.password);
  if (ownerId) createdUserIds.push(ownerId);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

test.describe('payments & outstanding e2e (Phase 6)', () => {
  // ── 1. Setup: org, customer, 3 invoices with different totals/dates ─────────
  test('setup: org, customer, 3 invoices seeded with distinct totals and dates', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    const client = await db();

    const { data: wh } = await client.from('erp_warehouses')
      .select('id, is_default').order('is_default', { ascending: false });
    expect(wh && wh.length, 'org should have at least one warehouse').toBeTruthy();
    const warehouseId = (wh!.find((w: any) => w.is_default) || wh![0]).id;

    // Customer with a zero opening balance (keeps the outstanding formula simple).
    const { data: cust, error: custErr } = await client.from('erp_customers')
      .insert({ name: custName, opening_balance: 0 })
      .select().single();
    expect(custErr, 'customer insert should succeed').toBeNull();
    custId = cust!.id;
    openingBalance = 0;

    const today = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };

    // Oldest -> newest: inv1 (20 days ago), inv2 (10 days ago), inv3 (today).
    inv1Id = await seedInvoice(client, { invoiceNo: `PAY-TEST-1-${stamp}`, total: INV1_TOTAL, invoiceDate: daysAgo(20), warehouseId });
    inv2Id = await seedInvoice(client, { invoiceNo: `PAY-TEST-2-${stamp}`, total: INV2_TOTAL, invoiceDate: daysAgo(10), warehouseId });
    inv3Id = await seedInvoice(client, { invoiceNo: `PAY-TEST-3-${stamp}`, total: INV3_TOTAL, invoiceDate: daysAgo(0), warehouseId });

    expect(inv1Id).toBeTruthy();
    expect(inv2Id).toBeTruthy();
    expect(inv3Id).toBeTruthy();

    // Baseline outstanding = sum of totals (no payments yet, opening = 0).
    const expected = INV1_TOTAL + INV2_TOTAL + INV3_TOTAL;
    expect(await computeOutstanding(custId)).toBe(expected);
  });

  // ── 2. CRITICAL — multi-invoice payment allocation ───────────────────────────
  test('CRITICAL: one payment spanning two invoices allocates correctly and outstanding drops by the full amount', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const outstandingBefore = await computeOutstanding(custId);

    await page.goto('/customers');
    await expect(page.getByText('🧑‍🤝‍🧑 Customers').first()).toBeVisible({ timeout: 15_000 });

    await page.getByText(custName).first().click();
    await expect(page.getByText('Outstanding').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '💵 Record Payment' }).click();
    await expect(page.getByText(`💵 Receive Payment — ${custName}`).first()).toBeVisible({ timeout: 10_000 });

    // Amount field auto-fills with suggestedAmount (full outstanding) and
    // auto-distributes oldest-first. Overwrite with our test amount, which
    // triggers onAmountChange -> autoDistribute(unpaid, MULTI_PAYMENT).
    const amountInput = page.locator('label:has-text("Amount (₹)") + input');
    await amountInput.fill(String(MULTI_PAYMENT));

    // Expect auto-distribution: inv1 (oldest, balance 1000) fully paid = 1000,
    // remaining 300 applied to inv2 (balance 600) leaving inv3 (balance 400) untouched.
    // Verify via the allocated total shown in the UI before submitting.
    await expect(page.getByText(`${fmtINR(MULTI_PAYMENT)} / ${fmtINR(MULTI_PAYMENT)}`)).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();

    // Wait for the payment modal to close — RecordPaymentIn only calls onDone()
    // (which closes the modal) AFTER recordCustomerPayment's awaited insert loop
    // fully resolves (payment row + BOTH allocation rows + BOTH invoice updates).
    // Polling erp_payments directly here would race: the parent erp_payments row
    // is written first, before either allocation insert, so checking for it alone
    // can observe a payment with 0/1 of its 2 allocation rows still in flight.
    await expect(page.getByText(`💵 Receive Payment — ${custName}`)).toHaveCount(0, { timeout: 15_000 });

    const client = await db();

    // ── Exactly one erp_payments row, correct shape ──
    const { data: pmts } = await client.from('erp_payments')
      .select('id, direction, party_type, party_id, ref_type, ref_id, amount')
      .eq('party_id', custId).eq('direction', 'in');
    expect((pmts || []).length, 'exactly one payment row').toBe(1);
    const pmt = pmts![0];
    expect(pmt.direction).toBe('in');
    expect(pmt.party_type).toBe('customer');
    expect(pmt.party_id).toBe(custId);
    expect(pmt.ref_type).toBe('invoice_settlement');
    expect(pmt.ref_id).toBeNull();
    expect(Number(pmt.amount)).toBe(MULTI_PAYMENT);

    // ── Exactly 2 allocation rows, matching oldest-first auto-distribute ──
    const { data: allocs } = await client.from('erp_payment_allocations')
      .select('invoice_id, amount').eq('payment_id', pmt.id);
    expect((allocs || []).length, 'exactly 2 allocation rows').toBe(2);

    const byInvoice = Object.fromEntries((allocs || []).map((a: any) => [a.invoice_id, Number(a.amount)]));
    expect(byInvoice[inv1Id], 'inv1 (oldest) should be fully allocated').toBe(INV1_TOTAL);
    expect(byInvoice[inv2Id], 'inv2 (middle) should get the remainder').toBe(INV2_ALLOC);
    expect(byInvoice[inv3Id], 'inv3 (newest) must not be in the allocation set').toBeUndefined();

    // ── Invoice paid/balance updates ──
    const { data: inv1 } = await client.from('erp_invoices').select('paid, balance').eq('id', inv1Id).single();
    expect(Number(inv1!.paid)).toBe(INV1_TOTAL);
    expect(Number(inv1!.balance)).toBe(0);

    const { data: inv2 } = await client.from('erp_invoices').select('paid, balance').eq('id', inv2Id).single();
    expect(Number(inv2!.paid)).toBe(INV2_ALLOC);
    expect(Number(inv2!.balance)).toBe(INV2_TOTAL - INV2_ALLOC);

    // ── Third (unallocated) invoice unchanged ──
    const { data: inv3 } = await client.from('erp_invoices').select('paid, balance').eq('id', inv3Id).single();
    expect(Number(inv3!.paid)).toBe(0);
    expect(Number(inv3!.balance)).toBe(INV3_TOTAL);

    // ── Outstanding formula check: reduced by the FULL payment amount ──
    const outstandingAfter = await computeOutstanding(custId);
    expect(outstandingAfter, 'outstanding must drop by the full payment amount').toBe(outstandingBefore - MULTI_PAYMENT);
  });

  // ── 3. On-account payment (no allocations) ───────────────────────────────────
  test('on-account payment with zero allocations is accepted and reduces outstanding with no invoice touched', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const client = await db();
    const outstandingBefore = await computeOutstanding(custId);

    // Snapshot inv2/inv3 balances before (inv1 is fully paid/zero already).
    const { data: inv2Before } = await client.from('erp_invoices').select('paid, balance').eq('id', inv2Id).single();
    const { data: inv3Before } = await client.from('erp_invoices').select('paid, balance').eq('id', inv3Id).single();

    await page.goto('/customers');
    await expect(page.getByText('🧑‍🤝‍🧑 Customers').first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(custName).first().click();
    await expect(page.getByText('Outstanding').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '💵 Record Payment' }).click();
    await expect(page.getByText(`💵 Receive Payment — ${custName}`).first()).toBeVisible({ timeout: 10_000 });

    const amountInput = page.locator('label:has-text("Amount (₹)") + input');
    await amountInput.fill(String(ON_ACCOUNT_PAYMENT));

    // Zero out every auto-distributed allocation row so the allocations array
    // submitted is empty (RecordPaymentIn filters out amt<=0 entries).
    const applyInputs = page.locator('table').last().locator('tbody tr td:last-child input');
    const rowCount = await applyInputs.count();
    for (let i = 0; i < rowCount; i++) {
      await applyInputs.nth(i).fill('0');
    }

    // Allocated total should now read 0 / <amount>.
    await expect(page.getByText(`${fmtINR(0)} / ${fmtINR(ON_ACCOUNT_PAYMENT)}`)).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();

    // Wait for the modal to close — onDone() only fires after the awaited
    // insert fully resolves (see the CRITICAL test above for why we don't
    // poll erp_payments directly as the readiness signal).
    await expect(page.getByText(`💵 Receive Payment — ${custName}`)).toHaveCount(0, { timeout: 15_000 });

    const { data: pmts } = await client.from('erp_payments')
      .select('id, amount, ref_id, ref_type').eq('party_id', custId).eq('direction', 'in')
      .order('created_at', { ascending: false });
    expect((pmts || []).length, 'two payment rows total').toBe(2);
    const latest = pmts![0];
    expect(Number(latest.amount)).toBe(ON_ACCOUNT_PAYMENT);
    expect(latest.ref_id).toBeNull();

    // No allocation rows for this new payment.
    const { data: allocs } = await client.from('erp_payment_allocations')
      .select('id').eq('payment_id', latest.id);
    expect((allocs || []).length, 'on-account payment must have zero allocation rows').toBe(0);

    // Invoices untouched.
    const { data: inv2After } = await client.from('erp_invoices').select('paid, balance').eq('id', inv2Id).single();
    const { data: inv3After } = await client.from('erp_invoices').select('paid, balance').eq('id', inv3Id).single();
    expect(Number(inv2After!.paid)).toBe(Number(inv2Before!.paid));
    expect(Number(inv2After!.balance)).toBe(Number(inv2Before!.balance));
    expect(Number(inv3After!.paid)).toBe(Number(inv3Before!.paid));
    expect(Number(inv3After!.balance)).toBe(Number(inv3Before!.balance));

    // Outstanding still drops by the full amount — the key formula check
    // (the old buggy sum-of-balances formula would have missed this entirely).
    const outstandingAfter = await computeOutstanding(custId);
    expect(outstandingAfter).toBe(outstandingBefore - ON_ACCOUNT_PAYMENT);
  });

  // ── 4. Over-allocation blocked client-side ──────────────────────────────────
  test('over-allocation is blocked: submit is disabled and no payment is persisted', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const client = await db();
    const { data: pmtsBefore } = await client.from('erp_payments')
      .select('id').eq('party_id', custId).eq('direction', 'in');
    const countBefore = (pmtsBefore || []).length;

    await page.goto('/customers');
    await expect(page.getByText('🧑‍🤝‍🧑 Customers').first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(custName).first().click();
    await expect(page.getByText('Outstanding').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '💵 Record Payment' }).click();
    await expect(page.getByText(`💵 Receive Payment — ${custName}`).first()).toBeVisible({ timeout: 10_000 });

    // Enter a small amount, then push the only remaining unpaid invoice's
    // "Apply Amount" above it, forcing allocatedTotal > amount.
    const amountInput = page.locator('label:has-text("Amount (₹)") + input');
    await amountInput.fill('10');

    const applyInputs = page.locator('table').last().locator('tbody tr td:last-child input');
    const rowCount = await applyInputs.count();
    expect(rowCount, 'at least one unpaid invoice row should remain for over-allocation').toBeGreaterThan(0);
    await applyInputs.first().fill('9999');

    // Warning shown + submit disabled.
    await expect(page.getByText('Allocated amount cannot exceed the payment amount.')).toBeVisible({ timeout: 5_000 });
    const submitBtn = page.getByRole('button', { name: 'Record Payment', exact: true });
    await expect(submitBtn).toBeDisabled();

    // Force-click anyway (disabled buttons no-op in the browser, but confirm
    // via DB that nothing new was written either way).
    await submitBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);

    const { data: pmtsAfter } = await client.from('erp_payments')
      .select('id').eq('party_id', custId).eq('direction', 'in');
    expect((pmtsAfter || []).length, 'no new payment should be persisted when over-allocated').toBe(countBefore);

    // Close the modal without submitting.
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  // ── 5. Aging display ────────────────────────────────────────────────────────
  test('aging: SalesList and Customer ledger show non-zero amounts in the expected buckets', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const client = await db();

    // Push inv3 (currently dated today, balance = INV3_TOTAL, still fully unpaid)
    // back to 40 days ago so it lands in the 31-60 bucket.
    const d = new Date();
    d.setDate(d.getDate() - 40);
    const { error } = await client.from('erp_invoices')
      .update({ invoice_date: d.toISOString().slice(0, 10) })
      .eq('id', inv3Id);
    expect(error).toBeNull();

    // inv2 has a remaining balance (INV2_TOTAL - INV2_ALLOC) dated ~10 days ago -> 0-30 bucket.
    // inv1 is fully paid (balance 0) so it must NOT contribute to any bucket.

    // ── Customers ledger aging chips ──
    await page.goto('/customers');
    await expect(page.getByText('🧑‍🤝‍🧑 Customers').first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(custName).first().click();
    await expect(page.getByText('Outstanding').first()).toBeVisible({ timeout: 10_000 });

    const bucket031 = page.getByText(/^0-30:/);
    const bucket3160 = page.getByText(/^31-60:/);
    await expect(bucket031).toBeVisible({ timeout: 10_000 });
    await expect(bucket3160).toBeVisible({ timeout: 10_000 });
    // 0-30 bucket should reflect inv2's remaining balance (non-zero).
    await expect(bucket031).toContainText(fmtINR(INV2_TOTAL - INV2_ALLOC));
    // 31-60 bucket should reflect inv3's full balance (non-zero, moved to this bucket).
    await expect(bucket3160).toContainText(fmtINR(INV3_TOTAL));

    // Two "Close" buttons exist (the modal's × icon-button and the footer's
    // text button both expose an accessible name of "Close") — target the
    // footer text button specifically to avoid a strict-mode violation.
    await page.locator('button.btn-outline', { hasText: 'Close' }).click();

    // ── SalesList aging breakdown ──
    await page.goto('/sales');
    await expect(page.getByText('📋 Sale List').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder="🔍 Search invoice or customer..."]').fill(custName);
    await expect(page.getByText(custName).first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/0-30:.*31-60:.*60\+:/)).toBeVisible({ timeout: 10_000 });
  });

  // ── 6. Bonus: supplier on-account payment regression (new formula edge case) ─
  test('bonus: supplier on-account payment (no purchaseId) reduces outstanding though no purchase.balance changes', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    const client = await db();

    const supplierName = `${TEST_PREFIX}PaySupplier ${stamp}`;
    const { data: sup, error: supErr } = await client.from('erp_suppliers')
      .insert({ name: supplierName, opening_balance: 0 })
      .select().single();
    expect(supErr).toBeNull();
    const supplierId = sup!.id;

    const computeSupplierOutstanding = async () => {
      const { data: s } = await client.from('erp_suppliers')
        .select('opening_balance').eq('id', supplierId).single();
      const { data: purs } = await client.from('erp_purchases')
        .select('total').eq('supplier_id', supplierId);
      const { data: pays } = await client.from('erp_payments')
        .select('amount').eq('party_type', 'supplier').eq('party_id', supplierId).eq('direction', 'out');
      const opening = Number(s?.opening_balance ?? 0);
      const billed = (purs || []).reduce((sum: number, p: any) => sum + Number(p.total ?? 0), 0);
      const paidOut = (pays || []).reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0);
      return opening + billed - paidOut;
    };

    // No purchases at all for this supplier — outstanding should be 0 before payment.
    expect(await computeSupplierOutstanding()).toBe(0);

    // Record a general (unapplied) payment via paymentService.recordOut's shape:
    // no purchaseId -> ref_type/ref_id null, no purchase.balance touched.
    const GENERAL_PAYMENT = 200;
    const { error: payErr } = await client.from('erp_payments').insert({
      direction: 'out',
      party_type: 'supplier',
      party_id: supplierId,
      ref_type: null,
      ref_id: null,
      amount: GENERAL_PAYMENT,
      mode: 'Cash',
      pay_date: new Date().toISOString().slice(0, 10),
      note: '__TEST__ general advance'
    });
    expect(payErr).toBeNull();

    // Even though no purchase exists/changed, outstanding must go NEGATIVE by
    // the payment amount under the new (total-based) formula — this is exactly
    // the case the old sum-of-balances formula would silently ignore.
    expect(await computeSupplierOutstanding()).toBe(-GENERAL_PAYMENT);
  });

  // ── 7. Teardown verification: no orphaned __TEST__ payment data ─────────────
  test('post-run check: cleanup removes all __TEST__ payment/allocation/customer data', async ({ page: _page }) => {
    await cleanupTestData(createdUserIds);
    _client = null; // signed-in user is deleted; drop the cached client.

    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: orphanCustomers } = await admin!.from('erp_customers')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanCustomers || []).length, 'no __TEST__ customers should remain').toBe(0);

    const { data: orphanSuppliers } = await admin!.from('erp_suppliers')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanSuppliers || []).length, 'no __TEST__ suppliers should remain').toBe(0);

    const { data: orphanInvoices } = await admin!.from('erp_invoices')
      .select('id, invoice_no').like('invoice_no', `PAY-TEST-%${stamp}%`);
    expect((orphanInvoices || []).length, 'no __TEST__ invoices should remain').toBe(0);

    const { data: orphanOrgs } = await admin!.from('organizations')
      .select('id, name').like('name', `${TEST_PREFIX}%`);
    expect((orphanOrgs || []).length, 'no __TEST__ orgs should remain').toBe(0);

    // Explicit sweep of the NEW table this phase — payment_allocations should
    // cascade-delete when erp_payments rows are purged, but verify explicitly
    // rather than trusting the cascade (per the Phase-4/5 tester convention).
    if (inv1Id || inv2Id || inv3Id) {
      const ids = [inv1Id, inv2Id, inv3Id].filter(Boolean);
      const { data: leftoverAllocs } = await admin!.from('erp_payment_allocations')
        .select('id').in('invoice_id', ids);
      expect((leftoverAllocs || []).length, 'no __TEST__ payment allocations should remain').toBe(0);
    }
  });
});

// Mirrors src/components/ui.tsx's fmtCurrency exactly, so UI text assertions match.
function fmtINR(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

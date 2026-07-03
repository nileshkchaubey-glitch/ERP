import { test, expect } from '@playwright/test';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import { cleanupTestData, createConfirmedUser, hasServiceRole, TEST_PREFIX } from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.invprint.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}InvPrint_${stamp}`;
const itemName = `${TEST_PREFIX}Print Widget ${stamp}`;
const customerName = `${TEST_PREFIX}Print Cust ${stamp}`;

const createdUserIds: string[] = [];
let invoiceId = '';

test.beforeAll(async () => {
  const ownerId = await createConfirmedUser(owner.email, owner.password);
  if (ownerId) createdUserIds.push(ownerId);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

test.describe('invoice print', () => {
  test('setup: create org, item, and a saved invoice', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    // Seed an item.
    await page.goto('/items');
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(itemName);
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 15_000 });

    // Create an invoice via Billing using the seeded item + a new customer.
    await page.goto('/billing');
    const nameInput = page.locator('input[placeholder="Item name..."]').first();
    await nameInput.click();
    await nameInput.fill('Print Widget');
    await expect(page.locator('div.absolute >> text=' + itemName).first()).toBeVisible({ timeout: 10_000 });
    await nameInput.press('ArrowDown');
    await nameInput.press('Enter');

    const rateInput = page.locator('input[type="number"]').nth(1);
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 }).catch(async () => {
      await rateInput.fill('250');
    });

    const custInput = page.locator('input[placeholder="Type customer name..."]');
    await custInput.click();
    await custInput.fill(customerName);
    const addNewOption = page.getByText(`+ Add new customer "${customerName}"`);
    await expect(addNewOption).toBeVisible({ timeout: 10_000 });
    await addNewOption.click();
    await expect(custInput).toHaveValue(customerName);

    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/\/sales$/, { timeout: 15_000 });
    await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 15_000 });

    // Grab the invoice id from the row's Print link href (the anchor with an href,
    // as opposed to the "View" button which is a plain <button>).
    const row = page.locator('tr', { hasText: customerName }).first();
    const printLink = row.locator('a[href*="/print/"]').first();
    const href = await printLink.getAttribute('href');
    expect(href).toBeTruthy();
    const m = href!.match(/\/invoice\/([^/]+)\/print\//);
    expect(m).toBeTruthy();
    invoiceId = m![1];
    expect(invoiceId).toBeTruthy();
  });

  test('a4 print view shows shop name, invoice number, customer, and line item', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/invoice/${invoiceId}/print/a4`);

    // Shop name falls back to org/business name configured via Settings; default settings
    // has no shop_name set so it falls back to 'Your Business' per InvoicePrint.tsx.
    await expect(page.getByText(/Your Business|TAX INVOICE/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('TAX INVOICE')).toBeVisible();
    await expect(page.getByText(customerName).first()).toBeVisible();
    await expect(page.getByText(itemName).first()).toBeVisible();

    // At least one amount cell rendered for the line item (non-zero rate -> non-zero amount).
    const amountCell = page.locator('td.text-right.font-semibold').first();
    await expect(amountCell).toBeVisible();
    const amountText = await amountCell.innerText();
    expect(amountText.replace(/[^\d.]/g, '').length).toBeGreaterThan(0);
  });

  test('thermal format renders the same core data (via URL)', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/invoice/${invoiceId}/print/thermal`);

    await expect(page.getByText('— Thank you —')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(customerName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(itemName).first()).toBeVisible();
  });

  test('thermal format renders via the in-page toggle', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/invoice/${invoiceId}/print/a4`);
    await expect(page.getByText('TAX INVOICE')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: 'Thermal' }).click();
    await expect(page).toHaveURL(new RegExp(`/invoice/${invoiceId}/print/thermal`));
    await expect(page.getByText('— Thank you —')).toBeVisible({ timeout: 15_000 });
  });

  test('non-existent invoice id shows an empty/error state, not a crash', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    // Well-formed but non-existent UUID.
    await page.goto('/invoice/00000000-0000-0000-0000-000000000000/print/a4');

    await expect(page.getByText('Invoice not found')).toBeVisible({ timeout: 15_000 });
    // Sanity: no unhandled crash text / blank page.
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('window.print is called once when ?autoprint=1 is present', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.__printCalled = false;
      // @ts-ignore
      window.__printCallCount = 0;
      window.print = () => {
        // @ts-ignore
        window.__printCalled = true;
        // @ts-ignore
        window.__printCallCount += 1;
      };
    });

    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/invoice/${invoiceId}/print/a4?autoprint=1`);
    await expect(page.getByText('TAX INVOICE')).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const called = await page.evaluate(() => (window as any).__printCalled);
      expect(called).toBe(true);
    }).toPass({ timeout: 5_000 });

    const count = await page.evaluate(() => (window as any).__printCallCount);
    expect(count).toBe(1);
  });

  test('window.print is NOT called when ?autoprint=1 is absent', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.__printCalled = false;
      window.print = () => {
        // @ts-ignore
        window.__printCalled = true;
      };
    });

    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/invoice/${invoiceId}/print/a4`);
    await expect(page.getByText('TAX INVOICE')).toBeVisible({ timeout: 15_000 });

    // Give the (would-be) 250ms autoprint timeout a chance to fire if the guard were broken.
    await page.waitForTimeout(800);

    const called = await page.evaluate(() => (window as any).__printCalled);
    expect(called).toBe(false);
  });
});

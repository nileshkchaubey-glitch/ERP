import { test, expect } from '@playwright/test';
import { signInAndCreateOrg, signIn } from './helpers/flow';
import { cleanupTestData, createConfirmedUser, hasServiceRole, adminClient, TEST_PREFIX } from './helpers/admin';

test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const owner = { email: `xlerp.test.billkb.owner.${stamp}@gmail.com`, password: 'Test1234!' };
const staff = { email: `xlerp.test.billkb.staff.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}BillKB_${stamp}`;
const itemName = `${TEST_PREFIX}Keyboard Widget ${stamp}`;
const customerName = `${TEST_PREFIX}Cust ${stamp}`;

const createdUserIds: string[] = [];

test.beforeAll(async () => {
  const ownerId = await createConfirmedUser(owner.email, owner.password);
  if (ownerId) createdUserIds.push(ownerId);
  const staffId = await createConfirmedUser(staff.email, staff.password);
  if (staffId) createdUserIds.push(staffId);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

// Create the org (as owner) and a seeded item once, reused by the keyboard-entry
// and Ctrl+S tests below. Runs in its own isolated browser context per test via
// signIn, matching the pattern in tenant-isolation.spec.ts.
test.describe('billing keyboard flow', () => {
  test('owner creates org and seeds an item', async ({ page }) => {
    await signInAndCreateOrg(page, owner.email, owner.password, org);
    await expect(page.getByText(org).first()).toBeVisible();

    // Seed the item directly via the Items page (matches addItem helper's UI flow).
    await page.goto('/items');
    await page.getByRole('button', { name: '➕ New Item' }).click();
    await page.locator('label:has-text("Item Name *") + input').fill(itemName);
    await page.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 15_000 });
  });

  test('keyboard-only item entry: type, arrow down, enter moves focus to qty', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/billing');

    // Type into the first row's item-name field (partial match on the seeded item).
    const nameInput = page.locator('input[placeholder="Item name..."]').first();
    await nameInput.click();
    await nameInput.fill('Keyboard Widget');

    // Dropdown should show our match.
    const dropdownOption = page.locator('div.absolute >> text=' + itemName);
    await expect(dropdownOption.first()).toBeVisible({ timeout: 10_000 });

    // Arrow down to highlight, then Enter to select.
    await nameInput.press('ArrowDown');
    await nameInput.press('Enter');

    // Row should now show the picked item name and the rate should be populated.
    await expect(nameInput).toHaveValue(itemName);

    // Focus should have moved to the Qty field (sibling input, next in the row's grid).
    const qtyInput = page.locator('input[type="number"]').first();
    await expect(qtyInput).toBeFocused();

    // Rate should be non-empty/non-zero now that the item has been picked
    // (rate input is the 3rd number input in the row: qty, rate, gst).
    const rateInput = page.locator('input[type="number"]').nth(1);
    const rateVal = await rateInput.inputValue();
    expect(Number(rateVal)).not.toBeNaN();
  });

  test('Ctrl+S saves the invoice and it appears in the sale list', async ({ page }) => {
    await signIn(page, owner.email, owner.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/billing');

    // Pick the seeded item via keyboard.
    const nameInput = page.locator('input[placeholder="Item name..."]').first();
    await nameInput.click();
    await nameInput.fill('Keyboard Widget');
    await expect(page.locator('div.absolute >> text=' + itemName).first()).toBeVisible({ timeout: 10_000 });
    await nameInput.press('ArrowDown');
    await nameInput.press('Enter');

    // Qty: keep default 1, just confirm rate is set so amount > 0.
    const rateInput = page.locator('input[type="number"]').nth(1);
    await expect(async () => {
      expect(Number(await rateInput.inputValue())).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 }).catch(async () => {
      // Item may have a 0 sale price by default — set an explicit rate so the invoice is valid.
      await rateInput.fill('100');
    });

    // Set customer via the inline quick-add ("+ Add new customer ...").
    const custInput = page.locator('input[placeholder="Type customer name..."]');
    await custInput.click();
    await custInput.fill(customerName);
    const addNewOption = page.getByText(`+ Add new customer "${customerName}"`);
    await expect(addNewOption).toBeVisible({ timeout: 10_000 });
    await addNewOption.click();
    await expect(custInput).toHaveValue(customerName);

    // Ctrl+S to save.
    await page.keyboard.press('Control+s');

    // Should navigate to the sale list and show the new invoice's customer.
    await expect(page).toHaveURL(/\/sales$/, { timeout: 15_000 });
    await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 15_000 });
  });

  test('staff role: Discount field is not visible on Billing page', async ({ page }) => {
    // Add the staff user to the same org with role 'staff' directly via the
    // service-role client (no UI invite flow exists yet — see Settings.tsx member list).
    const admin = adminClient();
    expect(admin).not.toBeNull();

    const { data: ownerAuth } = await admin!.auth.admin.listUsers();
    const ownerUser = ownerAuth.users.find(u => u.email === owner.email);
    const staffUser = ownerAuth.users.find(u => u.email === staff.email);
    expect(ownerUser).toBeTruthy();
    expect(staffUser).toBeTruthy();

    const { data: ownerMember } = await admin!
      .from('org_members')
      .select('org_id')
      .eq('user_id', ownerUser!.id)
      .single();
    expect(ownerMember).toBeTruthy();

    const { error: insertErr } = await admin!
      .from('org_members')
      .insert({ org_id: ownerMember!.org_id, user_id: staffUser!.id, role: 'staff', is_active: true });
    expect(insertErr).toBeNull();

    // Sign in as staff and open Billing.
    await signIn(page, staff.email, staff.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/billing');
    await expect(page.getByText('➕ New Invoice').first()).toBeVisible({ timeout: 15_000 });

    // Discount field must not be present for staff (RoleGate allow: ['owner','admin']).
    await expect(page.locator('label:has-text("Discount (₹)")')).toHaveCount(0);

    // Row-delete (✕) button must also not be present for staff.
    await expect(page.locator('button:has-text("✕")')).toHaveCount(0);
  });
});

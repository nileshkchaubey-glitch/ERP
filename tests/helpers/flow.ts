import { expect, type Page } from '@playwright/test';

// Sign in an existing (pre-confirmed) user via the Login UI.
export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

// On the "Create your business" step, create the org (caller becomes owner)
// and wait until the app lands on the dashboard (sidebar shows the org name).
export async function createBusiness(page: Page, orgName: string) {
  const bizInput = page.getByPlaceholder('e.g. XL Traders');
  await expect(bizInput).toBeVisible({ timeout: 15_000 });
  await bizInput.fill(orgName);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.getByText(orgName).first()).toBeVisible({ timeout: 15_000 });
}

// Sign in, then create the org (user has none yet -> create-business screen shows).
export async function signInAndCreateOrg(page: Page, email: string, password: string, orgName: string) {
  await signIn(page, email, password);
  await createBusiness(page, orgName);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 15_000 });
}

// Create an item via the Items page UI and wait for it to appear in the list.
export async function addItem(page: Page, name: string) {
  await page.goto('/items');
  await page.getByRole('button', { name: '➕ New Item' }).click();
  await page.locator('label:has-text("Item Name *") + input').fill(name);
  await page.getByRole('button', { name: '💾 Save' }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
}

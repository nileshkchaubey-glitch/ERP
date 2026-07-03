import { test, expect } from '@playwright/test';
import { signInAndCreateOrg, signIn, addItem } from './helpers/flow';
import { cleanupTestData, createConfirmedUser, hasServiceRole, TEST_PREFIX } from './helpers/admin';

const stamp = Date.now();
const user = { email: `xlerp.test.smoke.${stamp}@gmail.com`, password: 'Test1234!' };
const org = `${TEST_PREFIX}Smoke_${stamp}`;
const itemName = `${TEST_PREFIX}Widget ${stamp}`;

const createdUserIds: string[] = [];

test.beforeAll(async () => {
  const id = await createConfirmedUser(user.email, user.password);
  if (id) createdUserIds.push(id);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

// Always runs — no auth needed.
test('login screen renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

test.describe('authenticated flows', () => {
  test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

  test('signup creates org and lands on dashboard', async ({ page }) => {
    await signInAndCreateOrg(page, user.email, user.password, org);
    await expect(page.getByText(org).first()).toBeVisible();
    await expect(page.getByText('Owner').first()).toBeVisible();
  });

  test('created item appears in the list', async ({ page }) => {
    // Isolated context: sign in as the user whose org was created above.
    await signIn(page, user.email, user.password);
    await expect(page.getByText(org).first()).toBeVisible({ timeout: 15_000 });
    await addItem(page, itemName);
    await page.goto('/items');
    await expect(page.getByText(itemName).first()).toBeVisible();
  });
});

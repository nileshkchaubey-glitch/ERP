import { test, expect } from '@playwright/test';
import { signInAndCreateOrg, signOut, addItem } from './helpers/flow';
import { cleanupTestData, createConfirmedUser, hasServiceRole, TEST_PREFIX } from './helpers/admin';

// These tests need the service-role key (to create pre-confirmed users + clean up).
test.skip(!hasServiceRole, 'Set SUPABASE_SERVICE_ROLE_KEY in .env to run the e2e auth tests.');

const stamp = Date.now();
const userA = { email: `xlerp.test.a.${stamp}@gmail.com`, password: 'Test1234!' };
const userB = { email: `xlerp.test.b.${stamp}@gmail.com`, password: 'Test1234!' };
const orgA = `${TEST_PREFIX}OrgA_${stamp}`;
const orgB = `${TEST_PREFIX}OrgB_${stamp}`;
const itemA = `${TEST_PREFIX}Cup A ${stamp}`;

const createdUserIds: string[] = [];

test.beforeAll(async () => {
  const a = await createConfirmedUser(userA.email, userA.password);
  const b = await createConfirmedUser(userB.email, userB.password);
  if (a) createdUserIds.push(a);
  if (b) createdUserIds.push(b);
});

test.afterAll(async () => {
  await cleanupTestData(createdUserIds);
});

test('tenant isolation: org B cannot see org A data', async ({ page }) => {
  // 1. User A creates org A and an item.
  await signInAndCreateOrg(page, userA.email, userA.password, orgA);
  await addItem(page, itemA);

  // 2. Sign out.
  await signOut(page);

  // 3. User B creates org B.
  await signInAndCreateOrg(page, userB.email, userB.password, orgB);

  // 4. As user B, open the items list and let it settle.
  await page.goto('/items');
  await expect(page.getByText('📦 Items').first()).toBeVisible({ timeout: 15_000 });

  // 5. THE assertion: B must NOT see A's item (RLS tenant isolation).
  await expect(page.getByText(itemA)).toHaveCount(0);
});

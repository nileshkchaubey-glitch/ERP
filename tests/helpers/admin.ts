import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

export const TEST_PREFIX = '__TEST__';

// True when a service-role key is configured. The auth-dependent e2e tests
// require it: it lets us create pre-confirmed users (so they work even when
// Supabase email confirmation is ON) and clean everything up afterwards.
export const hasServiceRole = !!(URL && SERVICE_KEY);

// Service-role client (bypasses RLS) used ONLY for test setup/teardown.
export function adminClient(): SupabaseClient | null {
  if (!URL || !SERVICE_KEY) return null;
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// An anon-key client signed in as the given user. Use this for test setup that
// must go through the app's real code path (RLS + current_org_id() + auth.uid()),
// e.g. seeding stock via the sacred erp_apply_stock RPC, and for asserting DB
// state scoped to the signed-in org. Returns null if env is missing or sign-in fails.
export async function authedClient(email: string, password: string): Promise<SupabaseClient | null> {
  if (!URL || !ANON_KEY) return null;
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) { console.error('authedClient signIn', error.message); return null; }
  return client;
}

// Create an already-confirmed auth user (bypasses email confirmation).
// Returns the user id, or null if no service key is available.
export async function createConfirmedUser(email: string, password: string): Promise<string | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) { console.error('createConfirmedUser', error.message); return null; }
  return data.user?.id ?? null;
}

// erp_ tables that carry org_id and must be purged for a deleted test org.
const ERP_TABLES = [
  'erp_payment_allocations', 'erp_invoice_items', 'erp_invoices', 'erp_purchase_items', 'erp_purchases',
  'erp_payments', 'erp_stock_ledger', 'erp_stock', 'erp_item_variants', 'erp_items',
  'erp_custom_field_defs', 'erp_warehouses', 'erp_customers', 'erp_suppliers'
];

// Delete every test org (name starts with __TEST__) and the users that own them.
// Safety: NEVER touches an org whose name lacks the test prefix.
export async function cleanupTestData(extraUserIds: string[] = []): Promise<void> {
  const admin = adminClient();
  if (!admin) {
    console.warn(
      '\n[cleanup] SUPABASE_SERVICE_ROLE_KEY not set — skipping teardown.\n' +
      '          Add it to .env to auto-remove __TEST__ orgs and test auth users.\n'
    );
    return;
  }

  // 1. Find all test organizations.
  const { data: orgs } = await admin
    .from('organizations')
    .select('id, name')
    .like('name', `${TEST_PREFIX}%`);

  const orgIds = (orgs || []).map(o => o.id);

  if (orgIds.length) {
    // 2. Collect the owners/members of those orgs so we can delete their auth users.
    const { data: members } = await admin
      .from('org_members')
      .select('user_id')
      .in('org_id', orgIds);
    const userIds = new Set<string>([...(members || []).map(m => m.user_id), ...extraUserIds]);

    // 3. Purge erp_ data for those orgs (no FK cascade — org_id is a plain column).
    for (const table of ERP_TABLES) {
      await admin.from(table).delete().in('org_id', orgIds);
    }

    // 4. Delete the orgs (cascades org_members + org_settings via FK).
    await admin.from('organizations').delete().in('id', orgIds);

    // 5. Delete the auth users that belonged to test orgs.
    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => { /* already gone */ });
    }
  } else {
    for (const uid of extraUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

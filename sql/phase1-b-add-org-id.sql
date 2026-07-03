-- ============================================================
-- PHASE 1B - Add org_id to all erp_ tables + org-scoped RLS
-- Run AFTER 1a AND after you have signed up once (so an org exists).
-- This attaches your existing data to your org and isolates tenants.
-- Safe to re-run (idempotent).
-- ============================================================

-- 1. Add org_id to every erp_ table (nullable first, backfill, then enforce defaults)
ALTER TABLE erp_items             ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_custom_field_defs ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_warehouses        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_stock             ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_stock_ledger      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_customers         ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_suppliers         ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_invoices          ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_invoice_items     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_purchases         ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_purchase_items    ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE erp_payments          ADD COLUMN IF NOT EXISTS org_id uuid;

-- 2. BACKFILL: attach all existing rows to your first (oldest) org.
DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization exists yet. Sign up once (create your business) before running 1b.';
  END IF;

  UPDATE erp_items             SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_custom_field_defs SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_warehouses        SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_stock             SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_stock_ledger      SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_customers         SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_suppliers         SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_invoices          SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_invoice_items     SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_purchases         SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_purchase_items    SET org_id = v_org WHERE org_id IS NULL;
  UPDATE erp_payments          SET org_id = v_org WHERE org_id IS NULL;
END $$;

-- 3. Default org_id on insert (so service code never has to set it) + per-org index
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_items','erp_custom_field_defs','erp_warehouses','erp_stock','erp_stock_ledger',
    'erp_customers','erp_suppliers','erp_invoices','erp_invoice_items',
    'erp_purchases','erp_purchase_items','erp_payments'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT current_org_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_org ON %I (org_id)', t, t);
  END LOOP;
END $$;

-- 4. Make the old GLOBAL unique constraints PER-ORG.
--    Without this, two tenants both generating XLT-0001 / INV-1001 / WH-MAIN collide.

-- 4a. Items SKU: was unique(sku); now unique per org.
DROP INDEX IF EXISTS idx_erp_items_sku;
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_items_sku
  ON erp_items (org_id, sku) WHERE sku IS NOT NULL;

-- 4b. Invoice number: was unique(invoice_no); now unique per org.
DROP INDEX IF EXISTS idx_erp_inv_no;
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_inv_no
  ON erp_invoices (org_id, invoice_no);

-- 4c. Warehouse code: column-level UNIQUE -> per-org unique.
ALTER TABLE erp_warehouses DROP CONSTRAINT IF EXISTS erp_warehouses_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_warehouses_code
  ON erp_warehouses (org_id, code) WHERE code IS NOT NULL;

-- 4d. Custom field key: column-level UNIQUE -> per-org unique.
ALTER TABLE erp_custom_field_defs DROP CONSTRAINT IF EXISTS erp_custom_field_defs_field_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_cfd_field_key
  ON erp_custom_field_defs (org_id, field_key);

-- 5. Replace the old "authenticated can do anything" policies with org-scoped ones
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_items','erp_custom_field_defs','erp_warehouses','erp_stock','erp_stock_ledger',
    'erp_customers','erp_suppliers','erp_invoices','erp_invoice_items',
    'erp_purchases','erp_purchase_items','erp_payments'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_auth ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_org ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_org ON %I FOR ALL TO authenticated
       USING (org_id = current_org_id())
       WITH CHECK (org_id = current_org_id())', t, t);
  END LOOP;
END $$;

-- 6. Stock function stamps org_id (ledger + balance stay atomic)
CREATE OR REPLACE FUNCTION erp_apply_stock(
  p_item uuid, p_variant uuid, p_wh uuid, p_change numeric,
  p_reason text, p_ref_type text, p_ref_id uuid, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_bal numeric; v_org uuid;
BEGIN
  v_org := current_org_id();
  INSERT INTO erp_stock (item_id, warehouse_id, quantity, org_id)
  VALUES (p_item, p_wh, p_change, v_org)
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET quantity = erp_stock.quantity + p_change, updated_at = now()
  RETURNING quantity INTO v_bal;

  INSERT INTO erp_stock_ledger
    (item_id, warehouse_id, change_qty, balance_after, reason, ref_type, ref_id, note, created_by, org_id)
  VALUES (p_item, p_wh, p_change, v_bal, p_reason, p_ref_type, p_ref_id, p_note, auth.uid(), v_org);
END; $$;

-- 7. Number generators must count within the current org only.
CREATE OR REPLACE FUNCTION erp_next_sku()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(sku,'^XLT-',''))::int),0) INTO v_max
  FROM erp_items
  WHERE org_id = current_org_id() AND sku ~ '^XLT-\d+$';
  RETURN 'XLT-' || LPAD((v_max+1)::text, 4, '0');
END; $$;

CREATE OR REPLACE FUNCTION erp_next_invoice_no()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(invoice_no,'^INV-',''))::int),1000) INTO v_max
  FROM erp_invoices
  WHERE org_id = current_org_id() AND invoice_no ~ '^INV-\d+$';
  RETURN 'INV-' || (v_max+1)::text;
END; $$;

-- 8. New orgs need a default warehouse, otherwise billing has nowhere to move stock.
--    Redefine the signup function to seed one (existing org already has its warehouse
--    via the backfill above).
CREATE OR REPLACE FUNCTION create_org_for_me(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Business name is required';
  END IF;

  INSERT INTO organizations (name, slug)
  VALUES (
    trim(p_name),
    lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6)
  )
  RETURNING id INTO v_org;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org, auth.uid(), 'owner');

  INSERT INTO org_settings (org_id, shop_name) VALUES (v_org, trim(p_name));

  INSERT INTO erp_warehouses (name, code, is_default, org_id)
  VALUES ('Main Warehouse', 'WH-MAIN', true, v_org);

  RETURN v_org;
END; $$;

-- ============================================================
-- Done. Existing data is attached to your org; tenants are isolated.
-- Verify (should match your existing counts, all rows now org-stamped):
--   SELECT count(*) FROM erp_items WHERE org_id IS NULL;        -- expect 0
--   SELECT count(*) FROM erp_invoices WHERE org_id IS NULL;     -- expect 0
-- ============================================================

-- ============================================================
-- PHASE 4A - Item Variants
-- Adds erp_item_variants + variant_id wiring across stock,
-- ledger, and invoice_items. Makes erp_apply_stock variant-aware.
-- Additive + idempotent. Safe to re-run.
-- Postgres 17: uses UNIQUE NULLS NOT DISTINCT so non-variant
-- rows (variant_id = NULL) are still unique per (item, warehouse).
-- ============================================================

-- 1. erp_item_variants -----------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_item_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES erp_items(id) ON DELETE CASCADE,
  org_id         uuid DEFAULT current_org_id(),
  variant_name   text NOT NULL,
  attributes     jsonb DEFAULT '{}',
  sku            text,
  barcode        text,
  sale_price     numeric(12,2) DEFAULT 0,
  purchase_price numeric(12,2) DEFAULT 0,
  mrp            numeric(12,2) DEFAULT 0,
  status         text DEFAULT 'active',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- explicit default (matches phase1-b style; harmless if already set)
ALTER TABLE erp_item_variants ALTER COLUMN org_id SET DEFAULT current_org_id();

-- org-scoped RLS
ALTER TABLE erp_item_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_item_variants_org ON erp_item_variants;
CREATE POLICY erp_item_variants_org ON erp_item_variants
  FOR ALL TO authenticated
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- per-org unique SKU + lookup indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_variants_sku
  ON erp_item_variants (org_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_variants_item ON erp_item_variants (item_id);
CREATE INDEX IF NOT EXISTS idx_erp_variants_org  ON erp_item_variants (org_id);

-- 2. erp_items: has_variants flag ------------------------------------------
ALTER TABLE erp_items ADD COLUMN IF NOT EXISTS has_variants boolean DEFAULT false;

-- 3. erp_stock: variant support + new uniqueness ---------------------------
ALTER TABLE erp_stock
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES erp_item_variants(id) ON DELETE CASCADE;

-- replace the old (item_id, warehouse_id) constraint with the variant-aware one
ALTER TABLE erp_stock DROP CONSTRAINT IF EXISTS erp_stock_item_id_warehouse_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_stock_item_variant_wh_key'
  ) THEN
    ALTER TABLE erp_stock
      ADD CONSTRAINT erp_stock_item_variant_wh_key
      UNIQUE NULLS NOT DISTINCT (item_id, variant_id, warehouse_id);
  END IF;
END $$;

-- 4. erp_stock_ledger: variant_id as PLAIN column (append-only history) -----
ALTER TABLE erp_stock_ledger ADD COLUMN IF NOT EXISTS variant_id uuid;

-- 5. erp_invoice_items: variant_id as PLAIN column (historical record) ------
ALTER TABLE erp_invoice_items ADD COLUMN IF NOT EXISTS variant_id uuid;

-- 6. Variant-aware erp_apply_stock (same signature; search_path pinned) -----
CREATE OR REPLACE FUNCTION erp_apply_stock(
  p_item uuid, p_variant uuid, p_wh uuid, p_change numeric,
  p_reason text, p_ref_type text, p_ref_id uuid, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_bal numeric; v_org uuid;
BEGIN
  v_org := current_org_id();
  INSERT INTO erp_stock (item_id, variant_id, warehouse_id, quantity, org_id)
  VALUES (p_item, p_variant, p_wh, p_change, v_org)
  ON CONFLICT (item_id, variant_id, warehouse_id)
  DO UPDATE SET quantity = erp_stock.quantity + p_change, updated_at = now()
  RETURNING quantity INTO v_bal;

  INSERT INTO erp_stock_ledger
    (item_id, variant_id, warehouse_id, change_qty, balance_after, reason, ref_type, ref_id, note, created_by, org_id)
  VALUES (p_item, p_variant, p_wh, p_change, v_bal, p_reason, p_ref_type, p_ref_id, p_note, auth.uid(), v_org);
END; $$;

-- ============================================================
-- Done. Verify:
--   SELECT count(*) FROM erp_items;        -- expect unchanged (1)
--   SELECT count(*) FROM erp_stock;        -- expect 0
--   SELECT count(*) FROM erp_stock_ledger; -- expect 0
--   constraint erp_stock_item_variant_wh_key exists w/ NULLS NOT DISTINCT
--   RLS enabled on erp_item_variants
-- ============================================================

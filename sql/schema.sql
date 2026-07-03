-- ════════════════════════════════════════════════════════════
-- XL ERP — Complete Supabase Schema (run once in SQL Editor)
-- Fresh project. No connection to any other database.
-- ════════════════════════════════════════════════════════════

-- Enable trigram search (for fast item name search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── ITEMS ───
CREATE TABLE IF NOT EXISTS erp_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  sku            text,
  barcode        text,
  category       text,
  brand          text,
  unit           text DEFAULT 'Pcs',
  pack_size      numeric(14,3) DEFAULT 1,
  hsn_code       text,
  gst_rate       numeric(5,2) DEFAULT 0,
  purchase_price numeric(12,2) DEFAULT 0,
  sale_price     numeric(12,2) DEFAULT 0,
  mrp            numeric(12,2) DEFAULT 0,
  reorder_level  numeric(14,3) DEFAULT 0,
  status         text DEFAULT 'active',          -- active | inactive | discontinued
  tags           text[],
  custom_fields  jsonb DEFAULT '{}',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_items_sku ON erp_items (sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_items_status ON erp_items (status);
CREATE INDEX IF NOT EXISTS idx_erp_items_name_trgm ON erp_items USING gin (name gin_trgm_ops);

-- Operator-defined custom fields (drives the dynamic item form)
CREATE TABLE IF NOT EXISTS erp_custom_field_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key   text NOT NULL UNIQUE,
  field_label text NOT NULL,
  field_type  text DEFAULT 'text',                -- text | number | select | date
  options     text[],
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Auto-SKU generator: XLT-0001, collision-safe
CREATE OR REPLACE FUNCTION erp_next_sku()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(sku,'^XLT-',''))::int),0) INTO v_max
  FROM erp_items WHERE sku ~ '^XLT-\d+$';
  RETURN 'XLT-' || LPAD((v_max+1)::text, 4, '0');
END; $$;

-- ─── WAREHOUSES + STOCK ───
CREATE TABLE IF NOT EXISTS erp_warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text UNIQUE,
  address    text,
  is_default boolean DEFAULT false,
  is_active  boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_stock (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES erp_items(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES erp_warehouses(id) ON DELETE CASCADE,
  quantity     numeric(14,3) NOT NULL DEFAULT 0,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_erp_stock_item ON erp_stock (item_id);

CREATE TABLE IF NOT EXISTS erp_stock_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES erp_items(id),
  warehouse_id  uuid NOT NULL REFERENCES erp_warehouses(id),
  change_qty    numeric(14,3) NOT NULL,
  balance_after numeric(14,3),
  reason        text NOT NULL,    -- sale|purchase|adjustment|transfer_in|transfer_out|opening|return
  ref_type      text,
  ref_id        uuid,
  note          text,
  created_by    uuid,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_item ON erp_stock_ledger (item_id, created_at DESC);

-- Seed default warehouse
INSERT INTO erp_warehouses (name, code, is_default)
SELECT 'Main Warehouse', 'WH-MAIN', true
WHERE NOT EXISTS (SELECT 1 FROM erp_warehouses WHERE is_default = true);

-- THE stock function — never touch erp_stock.quantity any other way
CREATE OR REPLACE FUNCTION erp_apply_stock(
  p_item uuid, p_variant uuid, p_wh uuid, p_change numeric,
  p_reason text, p_ref_type text, p_ref_id uuid, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_bal numeric;
BEGIN
  INSERT INTO erp_stock (item_id, warehouse_id, quantity)
  VALUES (p_item, p_wh, p_change)
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET quantity = erp_stock.quantity + p_change, updated_at = now()
  RETURNING quantity INTO v_bal;

  INSERT INTO erp_stock_ledger
    (item_id, warehouse_id, change_qty, balance_after, reason, ref_type, ref_id, note, created_by)
  VALUES (p_item, p_wh, p_change, v_bal, p_reason, p_ref_type, p_ref_id, p_note, auth.uid());
END; $$;

-- ─── CUSTOMERS + SUPPLIERS ───
CREATE TABLE IF NOT EXISTS erp_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, gstin text, address text, area text,
  opening_balance numeric(12,2) DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS erp_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, gstin text, address text,
  opening_balance numeric(12,2) DEFAULT 0, created_at timestamptz DEFAULT now()
);

-- ─── INVOICES (Sales) ───
CREATE TABLE IF NOT EXISTS erp_invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no   text NOT NULL,
  customer_id  uuid REFERENCES erp_customers(id),
  customer_name text,
  warehouse_id uuid REFERENCES erp_warehouses(id),
  invoice_date date NOT NULL,
  subtotal     numeric(12,2) DEFAULT 0,
  discount     numeric(12,2) DEFAULT 0,
  tax_amount   numeric(12,2) DEFAULT 0,
  total        numeric(12,2) DEFAULT 0,
  paid         numeric(12,2) DEFAULT 0,
  balance      numeric(12,2) DEFAULT 0,
  payment_type text DEFAULT 'Cash',
  status       text DEFAULT 'active',
  notes        text,
  created_by   uuid,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_inv_no ON erp_invoices (invoice_no);
CREATE INDEX IF NOT EXISTS idx_erp_inv_date ON erp_invoices (invoice_date DESC);

CREATE TABLE IF NOT EXISTS erp_invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES erp_invoices(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES erp_items(id),
  name        text NOT NULL,
  hsn_code    text,
  qty         numeric(14,3) NOT NULL,
  rate        numeric(12,2) NOT NULL,
  gst_rate    numeric(5,2) DEFAULT 0,
  amount      numeric(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_erp_inv_items ON erp_invoice_items (invoice_id);

-- Invoice number generator: INV-1001, INV-1002...
CREATE OR REPLACE FUNCTION erp_next_invoice_no()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(invoice_no,'^INV-',''))::int),1000) INTO v_max
  FROM erp_invoices WHERE invoice_no ~ '^INV-\d+$';
  RETURN 'INV-' || (v_max+1)::text;
END; $$;

-- ─── PURCHASES ───
CREATE TABLE IF NOT EXISTS erp_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text, supplier_id uuid REFERENCES erp_suppliers(id),
  warehouse_id uuid REFERENCES erp_warehouses(id), bill_date date NOT NULL,
  subtotal numeric(12,2) DEFAULT 0, tax_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) DEFAULT 0, paid numeric(12,2) DEFAULT 0,
  balance numeric(12,2) DEFAULT 0, status text DEFAULT 'received',
  notes text, created_by uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS erp_purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES erp_purchases(id) ON DELETE CASCADE,
  item_id uuid REFERENCES erp_items(id),
  qty numeric(14,3) NOT NULL, rate numeric(12,2) NOT NULL, amount numeric(12,2) NOT NULL
);

-- ─── PAYMENTS ───
CREATE TABLE IF NOT EXISTS erp_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL,              -- in | out
  party_type text NOT NULL,             -- customer | supplier
  party_id uuid, ref_type text, ref_id uuid,
  amount numeric(12,2) NOT NULL, mode text DEFAULT 'Cash',
  pay_date date NOT NULL, note text, created_by uuid, created_at timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════
-- RLS — authenticated users get full access; anon = nothing
-- (Solo operator. NOTE: plain CREATE POLICY, not IF NOT EXISTS.)
-- ════════════════════════════════════════════════════════════
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
    EXECUTE format('CREATE POLICY %I_auth ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ✅ Done. Tables, functions, RLS ready.
-- Verify: SELECT count(*) FROM erp_warehouses;  -- should be 1 (Main Warehouse)

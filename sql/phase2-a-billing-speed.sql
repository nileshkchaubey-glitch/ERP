-- ============================================================
-- PHASE 2A - Billing speed: last-rate-per-customer lookup
-- Additive, idempotent. Safe to re-run.
-- ============================================================

-- Index to make "last rate this customer paid for this item" fast.
-- Invoice items don't carry customer_id directly, so we join through erp_invoices;
-- this index supports that join + the date ordering used to find the latest one.
CREATE INDEX IF NOT EXISTS idx_erp_invoices_customer_date
  ON erp_invoices (org_id, customer_id, invoice_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_erp_invoice_items_item
  ON erp_invoice_items (org_id, item_id);

-- Returns the rate this customer was last charged for this item, or NULL if none.
-- org-scoped via current_org_id() so it can never leak across tenants.
CREATE OR REPLACE FUNCTION erp_last_rate(p_customer uuid, p_item uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT ii.rate
  FROM erp_invoice_items ii
  JOIN erp_invoices i ON i.id = ii.invoice_id
  WHERE i.org_id = current_org_id()
    AND ii.org_id = current_org_id()
    AND i.customer_id = p_customer
    AND ii.item_id = p_item
  ORDER BY i.invoice_date DESC, i.created_at DESC
  LIMIT 1;
$$;

-- ============================================================
-- Verify after applying:
--   SELECT count(*) FROM erp_invoices;       -- unchanged from before
--   SELECT count(*) FROM erp_invoice_items;   -- unchanged from before
--   SELECT erp_last_rate('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid); -- expect NULL, no error
-- ============================================================

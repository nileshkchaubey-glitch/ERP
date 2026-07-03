-- ============================================================
-- PHASE 7A - Reports & Insight: supporting index
-- Additive, idempotent. Safe to re-run.
--
-- Context: Phase 7 reports (sales by day/month/customer/item, GST
-- summary by tax rate, low-stock, dead-stock) are served by
-- service-layer aggregation, not SQL views (see ADR note in
-- handoff). The one recurring access path introduced by reports
-- that doesn't already have a tight covering index is:
--   "all invoices for this org within a date range"
-- (used by sales-by-day/month and the GST summary, both of which
-- filter by org_id + invoice_date range with no customer_id
-- predicate). Existing indexes don't cover this cleanly:
--   idx_erp_inv_date              (invoice_date DESC)              -- no org_id
--   idx_erp_invoices_org           (org_id)                          -- no date
--   idx_erp_invoices_customer_date (org_id, customer_id, invoice_date DESC, created_at DESC) -- requires customer_id as 2nd key, not usable for an org+date-only scan
--
-- At current row counts (thousands/year) Postgres works fine without
-- this, but it's the correct narrow index for the access pattern the
-- reports module adds, so we add it now rather than let query plans
-- degrade unnoticed as invoice volume grows.
--
-- No other new indexes/views are introduced. See handoff notes for
-- per-report justification (dead-stock and low-stock use existing
-- idx_erp_ledger_item / idx_erp_stock_org / idx_erp_stock_item).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_erp_invoices_org_date
  ON erp_invoices (org_id, invoice_date DESC);

-- ============================================================
-- Verify after applying:
--   SELECT count(*) FROM erp_invoices;        -- unchanged from before migration
--   SELECT count(*) FROM erp_invoice_items;   -- unchanged from before migration
--   \d erp_invoices  -- confirm idx_erp_invoices_org_date present
-- ============================================================

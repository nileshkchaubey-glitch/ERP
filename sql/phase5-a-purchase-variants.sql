-- Phase 5-a: Purchase & Supplier
-- Additive, idempotent. Adds variant_id to purchase line items so a purchase
-- records WHICH variant was bought, consistent with erp_invoice_items.variant_id
-- and erp_stock_ledger.variant_id (added in Phase 4).
--
-- Plain uuid column, NO foreign key: this is a historical record. A variant may
-- later be renamed/removed but the purchase line must keep what was actually
-- purchased. Matches the Phase-4 pattern.
--
-- No bill_no generator (purchase bill numbers are user-entered from the
-- supplier's physical bill). No new tables. No supplier-outstanding VIEW
-- (computed at the service layer; Phase 7 owns reporting views).

ALTER TABLE erp_purchase_items
  ADD COLUMN IF NOT EXISTS variant_id uuid;

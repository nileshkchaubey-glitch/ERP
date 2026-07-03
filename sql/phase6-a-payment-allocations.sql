-- Phase 6-a: Payment Allocations (Money & Outstanding)
-- Additive, idempotent.
--
-- Problem: erp_payments.ref_id is a single uuid, but a customer payment-in
-- event can settle MULTIPLE invoices (e.g. one Rs.10,000 payment covering
-- three older invoices, possibly partially). We need a way to record exactly
-- how much of one payment event was applied to each invoice.
--
-- Fix: erp_payment_allocations join table. One erp_payments row per payment
-- EVENT (direction='in', party_type='customer', party_id=customer,
-- ref_type='invoice_settlement', ref_id=NULL since it may cover N invoices).
-- N erp_payment_allocations rows record how much of that payment went to
-- which invoice. erp_payments.amount remains the single source of truth for
-- "money received"; sum(allocations.amount) for a payment should equal (or be
-- less than, if unallocated/on-account) erp_payments.amount — enforced at the
-- service layer, not by a DB constraint, to allow on-account/advance payments
-- with no invoice allocated yet.
--
-- This does not change erp_payments in any way (no new columns, no dropped
-- columns) — fully backward compatible with existing supplier payment-out
-- usage (single ref_id, no allocations row).
--
-- AGING: no new columns needed. erp_invoices already has invoice_date and a
-- maintained balance column. "Days overdue" = today - invoice_date where
-- balance > 0; bucketing (0-30/31-60/60+) happens at the service layer in
-- Phase 6/7, not in SQL. Confirmed sufficient — nothing else added here.

CREATE TABLE IF NOT EXISTS erp_payment_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES erp_payments(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES erp_invoices(id),
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  org_id      uuid DEFAULT current_org_id(),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_payment_allocations_payment_id
  ON erp_payment_allocations(payment_id);

CREATE INDEX IF NOT EXISTS idx_erp_payment_allocations_invoice_id
  ON erp_payment_allocations(invoice_id);

CREATE INDEX IF NOT EXISTS idx_erp_payment_allocations_org_id
  ON erp_payment_allocations(org_id);

ALTER TABLE erp_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_payment_allocations_org ON erp_payment_allocations;
CREATE POLICY erp_payment_allocations_org ON erp_payment_allocations
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

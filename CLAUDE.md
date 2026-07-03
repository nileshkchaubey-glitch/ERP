# XL ERP — Project Context (for Claude Code)

ERP for XL Traders, a wholesale packaging business. Multi-tenant SaaS-shaped foundation, but built for Nilesh's own business first (SaaS activation is explicitly deferred — see "Not yet built" below).
Stack: React 18 + Vite + TypeScript + Tailwind + Wouter + Supabase (Postgres + Auth + RLS).

## Status: Phases 1–8 SHIPPED (full master-plan roadmap complete)
Build passes, full Playwright suite green (42+ specs across smoke, tenant-isolation, billing, variants, purchases, payments, reports). Every phase below was reviewed by a `reviewer` sub-agent pass before being called done; several real bugs were caught and fixed in-flight (see "Known follow-ups").

- **Phase 1 — Multi-tenant foundation**: `organizations`, `org_members`, `org_settings`; every `erp_` table has `org_id` + org-scoped RLS (Playwright-proven in `tests/tenant-isolation.spec.ts`); signup creates an org; roles `owner`/`admin`/`staff` via `RoleGate`.
- **Phase 2 — Billing speed**: keyboard-first invoice entry in `Billing.tsx` (item AND customer dropdowns both fully arrow-key/Enter navigable — item-row nav shipped in Phase 2, customer-dropdown nav added later as a follow-up fix), in-memory item cache, last-rate-per-customer autofill (`erp_last_rate()`), inline quick-add customer/item, Ctrl+S save / Ctrl+Enter save+print.
- **Phase 3 — Print + GST**: A4 + 80mm thermal invoice templates (`InvoicePrint.tsx`), autoprint via `?autoprint=1`, HSN codes, logo, single GST line (CGST/SGST split deliberately deferred).
- **Phase 4 — Variants**: `erp_item_variants` table, `erp_stock`/`erp_stock_ledger`/`erp_invoice_items` all variant-aware (`variant_id`, `UNIQUE NULLS NOT DISTINCT` constraint so non-variant items still work), `erp_apply_stock()` rewritten to route by variant. Variant picker in Billing, per-variant stock rows in Inventory.
- **Phase 5 — Purchase & Supplier**: `Purchases.tsx` (new purchase → auto stock-IN via `erp_apply_stock` reason `'purchase'`), `Suppliers.tsx` (ledger + outstanding + payment-out), `erp_purchase_items.variant_id` added.
- **Phase 6 — Money & Outstanding**: `erp_payment_allocations` (one payment can settle N invoices), `Customers.tsx` (ledger, aging chips, multi-invoice payment recording with auto-distribute-oldest-first), aging buckets (`src/lib/aging.ts`).
- **Phase 7 — Reports**: `Reports.tsx` — sales by day/month/customer/item, GST summary, low-stock, dead-stock, CSV export everywhere (`src/lib/csv.ts`).
- **Phase 8 — Scale & Polish**: pagination on Items/SalesList/PurchaseList (`listPaged`, 50/page, whole-business stat cards still correct via slim `statsRows()` fetches), route-based code-splitting (`React.lazy` per page in `App.tsx`, main bundle ~378kB), PWA (`vite-plugin-pwa`, installable + offline app-shell view, `autoUpdate`), all nested `<Link><a>` console warnings fixed.

## Architecture rules (NEVER break)
1. **All DB logic in `src/lib/*Service.ts`.** Components never query Supabase directly. One service file per concern (`itemService`, `erpServices` [stock/customer/invoice], `purchaseService`, `supplierService`, `paymentService`, `variantService`, `reportService`, `orgService`).
2. **Stock ONLY via `stockService.applyMovement()`** → `erp_apply_stock` DB function (ledger + balance atomic, variant-aware, org-stamped). Never write `erp_stock.quantity` directly.
3. **Money/outstanding formulas: total minus payments, never `sum(balance)`.** `sum(invoice.balance)` / `sum(purchase.balance)` silently misses on-account/unapplied payments and clamps to 0 on overpayment. The correct pattern everywhere (`customerService.outstanding`, `supplierService.outstanding`, `SalesList`'s Outstanding stat, `PurchaseList`'s Payable stat, `Dashboard`'s Pending Due): `opening_balance + sum(total) − sum(payments)`. This bug was found and fixed multiple times across phases — if you see a new stat summing `.balance`, it's wrong.
4. **One component/function per file. No overrides, no monkey-patching.**
5. **SQL: write a NEW numbered file in `sql/`.** Never edit a shipped one (`phase1-a-tenancy.sql` … `phase7-a-report-indexes.sql`, `schema.sql`). Additive + idempotent (`IF NOT EXISTS` everywhere). New variant/allocation-style columns (`variant_id` on ledger/invoice_items/purchase_items) are plain columns with **no FK, no cascade** — they're historical records that must survive the referenced row being renamed/deleted.
6. **Wouter v3 `<Link>` takes `className`/`onClick` directly** — it renders its own `<a>`. Never nest `<Link><a>...</a></Link>` (produces a DOM-nesting console warning; this was fixed everywhere once already — don't reintroduce it).
7. `pnpm` not required; this project uses `npm`. Keep `package-lock.json`.
8. **RLS + `org_id` are sacred.** Every new table gets `org_id` (default `current_org_id()`), org-scoped RLS (`USING`/`WITH CHECK org_id = current_org_id()`), per-org uniqueness. Never expose data across tenants.
9. **PWA cache is auth-sensitive.** The service worker (`vite.config.ts`) only caches `/rest/v1` GETs (never `/auth/v1`), and `useAuth.ts` purges the `supabase-reads` cache on every sign-in/out — required so one user's cached data can never leak to the next user on a shared device. Don't widen the cache `urlPattern` without re-adding that purge logic.

## Sub-agent team (`.claude/agents/`)
Five sub-agents exist for delegated work: `architect` (schema/migrations — has Supabase MCP write access, applies + verifies its own migrations), `backend` (`src/lib/*Service.ts`), `frontend` (`src/pages/*`, `src/components/*`), `tester` (Playwright specs in `tests/`, self-cleaning with `__TEST__` prefix), `reviewer` (read-only, Blockers/High/Medium/Good report before a phase is called done). Orchestration pattern per phase: architect → backend → frontend → tester → reviewer, sequential across phases, parallel within a phase where safe. Reviewer catches real bugs — don't skip it.

## Tables (all prefixed `erp_`, plus `organizations`/`org_members`/`org_settings`)
erp_items (+ has_variants), erp_item_variants, erp_custom_field_defs, erp_warehouses,
erp_stock (+ variant_id), erp_stock_ledger (+ variant_id),
erp_customers, erp_suppliers, erp_invoices, erp_invoice_items (+ variant_id, hsn_code),
erp_purchases, erp_purchase_items (+ variant_id), erp_payments, erp_payment_allocations.

DB functions: `erp_next_sku()`, `erp_next_invoice_no()`, `erp_apply_stock(...)` (variant + org aware), `erp_last_rate(customer, item)`, `current_org_id()`, `has_role(...)`, `create_org_for_me(...)`.

## File map
- `src/lib/supabase.ts` — client + all TypeScript types
- `src/lib/itemService.ts` — items + custom fields + SKU + `listPaged`
- `src/lib/erpServices.ts` — stock, customer, invoice services (+ `listPaged`/`statsRows`)
- `src/lib/purchaseService.ts`, `supplierService.ts`, `paymentService.ts`, `variantService.ts`, `reportService.ts`, `orgService.ts`
- `src/lib/aging.ts`, `csv.ts` — pure utility helpers
- `src/pages/*` — Dashboard, Items, Inventory, Billing, SalesList, Customers, Purchases, PurchaseList, Suppliers, Reports, Settings, InvoicePrint, Login, CreateBusiness
- `src/components/ui.tsx` — shared UI (PageHeader, Loading, ErrorState, Empty, Stat, Pagination, RoleGate, Modal, fmtCurrency, fmtDate...)
- `src/components/VariantEditor.tsx`
- `sql/schema.sql` + `sql/phase*.sql` — full schema history, apply in numeric order on a fresh DB
- `tests/*.spec.ts` + `tests/helpers/` — Playwright, real Supabase project, self-cleaning

## Known follow-ups (not blockers, logged for whoever picks this up next)
- **List-page polish** (in progress as of this writing, may already be merged): paged reads should throw instead of silently swallowing errors as empty states; search inputs need debounce + request-sequencing; page should clamp when `total` shrinks below the current page.
- **N+1 outstanding queries** on `Customers.tsx`/`Suppliers.tsx` (one query per row) — accepted at current scale (hundreds of parties), revisit if that grows.
- **`function_search_path_mutable`** advisory warnings on a few older DB functions — cosmetic hardening, not a live risk.
- **Full-suite Playwright flakiness** — two tests intermittently fail only in long full-suite runs (never in isolation) against the live hosted Supabase project; suspected real-network latency, not a logic bug.
- **PWA offline install** — implemented and verified via service-worker inspection (registers, activates, precaches), but an actual phone "Add to Home Screen + airplane mode" test hasn't been done by a human yet.

## Not yet built (deferred, explicitly out of scope until asked for)
- SaaS activation (subscriptions, public onboarding, super-admin) — the multi-tenant foundation supports it, but Nilesh wants his own business ERP solid first.
- CGST/SGST split on invoices (single GST line only, by design).
- Website/catalogue integration (`product_id` mapping) — was a "maybe later" idea, never started.

## Build / test
`npm run dev` (localhost:5173) · `npm run build` (must pass) · `npm run test:e2e` (Playwright, needs `SUPABASE_SERVICE_ROLE_KEY` in `.env` for test setup/teardown).

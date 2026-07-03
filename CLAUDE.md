# XL ERP — Project Context (for Claude Code)

Fresh ERP app. **Standalone — no connection to any website or other repo.**
Stack: React 18 + Vite + TypeScript + Tailwind + Wouter + Zustand + Supabase.

## Status: Phase 1 SHIPPED
Items (+ custom fields), multi-warehouse Inventory, Billing, Sale List, Settings, Auth — all working, build passes.

## Architecture rules (NEVER break)
1. **All DB logic in `src/lib/*Service.ts`.** Components never query Supabase directly.
2. **Stock ONLY via `stockService.applyMovement()`** → `erp_apply_stock` DB function (ledger + balance atomic). Never write `erp_stock.quantity` directly.
3. **One component/function per file. No overrides, no monkey-patching.** This is what keeps it bug-free.
4. **SQL: write a NEW numbered file in `sql/`.** Never edit a shipped one. Nilesh runs SQL manually in Supabase SQL Editor — you write it, you don't execute.
5. **Wouter `<Link>`** for nav. Never `<a href>` for internal routes.
6. **New branch → PR → review → merge.** Never push to main directly.
7. `pnpm` not required; this project uses `npm`. Keep `package-lock.json`.

## Tables (all prefixed erp_)
erp_items, erp_custom_field_defs, erp_warehouses, erp_stock, erp_stock_ledger,
erp_customers, erp_suppliers, erp_invoices, erp_invoice_items,
erp_purchases, erp_purchase_items, erp_payments.

DB functions: `erp_next_sku()`, `erp_next_invoice_no()`, `erp_apply_stock(...)`.

## File map
- `src/lib/supabase.ts` — client + all TypeScript types
- `src/lib/itemService.ts` — items + custom fields + SKU
- `src/lib/erpServices.ts` — stock, customer, invoice services
- `src/pages/*` — Dashboard, Items, Inventory, Billing, SalesList, Settings, Login
- `src/components/ui.tsx` — shared UI (PageHeader, Stat, Empty, fmtCurrency...)
- `sql/schema.sql` — complete DB schema (run once)

## Roadmap (next, in order)
1. **Purchase module** — PurchasesPage + erpPurchaseService; on "received" auto stock-in via applyMovement('purchase').
2. **Payments + outstanding** — record payment against invoice; customer ledger.
3. **Reports** — sales / stock / GST summary + CSV export.
4. **Item variants** — erp_item_variants table + sub-editor (toggle has_variants).
5. **Print invoice** — proper A4 print template (currently uses window.print on the modal).
6. **Website link (optional, later)** — add nullable product_id to erp_items mapping to an external catalogue.

## Build / test
`npm run dev` (localhost:5173) · `npm run build` (must pass before PR).

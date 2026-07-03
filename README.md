# XL ERP

Fresh ERP — Items · Stock · Billing. React + Vite + TypeScript + Tailwind + Supabase.
Standalone project, no connection to any website.

## Features (Phase 1)
- **Items** — full item master with Identity / Pricing / Inventory groups + operator-defined **custom fields**
- **Inventory** — multi-warehouse stock, opening stock, adjustments, low-stock flag (every change goes through an atomic ledger function)
- **Billing** — create invoices with item autocomplete; auto stock-out on save
- **Sale List** — all invoices, view detail, print
- **Settings** — manage warehouses, custom item fields, customers
- **Auth** — Supabase email/password login

## Setup (one time)

### 1. Create a Supabase project
- Go to supabase.com → New Project (free tier)
- Copy the **Project URL** and **anon public key** (Settings → API)

### 2. Run the schema
- Supabase dashboard → SQL Editor → New Query
- Paste the entire contents of `sql/schema.sql` → Run
- Verify: `SELECT count(*) FROM erp_warehouses;` returns 1 (Main Warehouse)

### 3. Configure the app
```bash
cp .env.example .env
# edit .env, fill in your URL and anon key
npm install
npm run dev
```
Open http://localhost:5173

### 4. First login
- Click "Naya account banayein" → enter email + password → Sign up
- (If Supabase email confirmation is ON, confirm via email, then sign in)
- You're in.

## Deploy (Netlify or Vercel)
- Build command: `npm run build`
- Publish directory: `dist`
- Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host dashboard
- SPA redirect: add `_redirects` file in `public/` with `/*  /index.html  200` (Netlify)

## Architecture rules (keep these)
- **All DB logic lives in `src/lib/*Service.ts`.** Components never call Supabase directly.
- **Stock changes ONLY via `stockService.applyMovement()`** → calls the `erp_apply_stock` DB function → ledger + balance update atomically. Never write `erp_stock.quantity` directly.
- **One component per file. No function defined twice.** (This is what keeps it bug-free.)
- **SQL migrations: write a new numbered file, never edit a shipped one.**

## Next phases (not built yet)
- Purchase module (PO + stock-in + supplier ledger)
- Payments + outstanding management
- Reports (sales/stock/GST + CSV export)
- Item variants (color/size)
- Website link (optional `product_id` mapping)

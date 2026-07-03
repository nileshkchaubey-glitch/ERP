import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.');
}

export const supabase = createClient(url, anonKey);

// ─── Types ───
export interface ErpItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  pack_size: number;
  hsn_code: string | null;
  gst_rate: number;
  purchase_price: number;
  sale_price: number;
  mrp: number;
  reorder_level: number;
  status: 'active' | 'inactive' | 'discontinued';
  has_variants: boolean;
  tags: string[] | null;
  custom_fields: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export interface ErpItemVariant {
  id: string;
  item_id: string;
  variant_name: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  sale_price: number;
  purchase_price: number;
  mrp: number;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface StockRow {
  id: string;
  item_id: string;
  variant_id?: string | null;
  warehouse_id: string;
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  opening_balance: number;
  created_at?: string;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  warehouse_id: string | null;
  invoice_date: string;
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
  paid: number;
  balance: number;
  payment_type: string;
  status: string;
  notes: string | null;
  created_at?: string;
}

export interface InvoiceItem {
  id?: string;
  invoice_id?: string;
  item_id: string | null;
  variant_id?: string | null;
  name: string;
  hsn_code: string | null;
  qty: number;
  rate: number;
  gst_rate: number;
  amount: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  opening_balance: number;
  created_at?: string;
}

export interface Purchase {
  id: string;
  bill_no: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  bill_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  paid: number;
  balance: number;
  status: string;
  notes: string | null;
  created_at?: string;
}

export interface PurchaseItem {
  id?: string;
  purchase_id?: string;
  item_id: string | null;
  variant_id?: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface Payment {
  id?: string;
  direction: 'in' | 'out';
  party_type: 'customer' | 'supplier';
  party_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  amount: number;
  mode: string;
  pay_date: string;
  note: string | null;
  created_at?: string;
}

// One row per invoice settled by a payment event. sum(amount) for a given
// payment_id should be <= erp_payments.amount (validated at the service
// layer, not by a DB constraint, to allow on-account/advance payments with
// no invoice allocated yet).
export interface PaymentAllocation {
  id?: string;
  payment_id?: string;
  invoice_id: string;
  amount: number;
  created_at?: string;
}

export interface CustomFieldDef {
  id: string;
  field_key: string;
  field_label: string;
  field_type: 'text' | 'number' | 'select' | 'date';
  options: string[] | null;
  sort_order: number;
}

export interface OrgSettings {
  org_id: string;
  shop_name: string | null;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  gstin: string | null;
  invoice_prefix: string | null;
  next_invoice_no: number | null;
  terms: string | null;
  logo_url: string | null;
  print_format: 'a4' | 'thermal' | 'both';
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'staff';
  is_active: boolean;
  created_at?: string;
}

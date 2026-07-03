import { supabase, type Warehouse, type StockRow, type Invoice, type InvoiceItem, type Customer, type Payment } from './supabase';

export const stockService = {
  async listWarehouses(): Promise<Warehouse[]> {
    const { data, error } = await supabase.from('erp_warehouses').select('*').eq('is_active', true).order('name');
    if (error) { console.error('listWarehouses', error); return []; }
    return data || [];
  },

  async createWarehouse(name: string, code: string): Promise<Warehouse | null> {
    const { data, error } = await supabase.from('erp_warehouses').insert({ name, code }).select().single();
    if (error) { console.error('createWarehouse', error); throw error; }
    return data;
  },

  async stockByItem(itemId: string): Promise<StockRow[]> {
    const { data, error } = await supabase.from('erp_stock').select('*').eq('item_id', itemId);
    if (error) { console.error('stockByItem', error); return []; }
    return data || [];
  },

  async allStock(): Promise<(StockRow & { item_name?: string; variant_name?: string | null })[]> {
    const { data, error } = await supabase
      .from('erp_stock')
      .select('*, erp_items(name), erp_item_variants(variant_name)');
    if (error) { console.error('allStock', error); return []; }
    return (data || []).map((r: any) => ({
      ...r,
      item_name: r.erp_items?.name,
      variant_name: r.erp_item_variants?.variant_name ?? null
    }));
  },

  // The ONLY way to change stock — calls the DB function (ledger + balance atomic)
  async applyMovement(params: {
    itemId: string;
    variantId?: string | null;
    warehouseId: string;
    change: number;
    reason: string;
    refType?: string;
    refId?: string;
    note?: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('erp_apply_stock', {
      p_item: params.itemId,
      p_variant: params.variantId ?? null,
      p_wh: params.warehouseId,
      p_change: params.change,
      p_reason: params.reason,
      p_ref_type: params.refType ?? null,
      p_ref_id: params.refId ?? null,
      p_note: params.note ?? null
    });
    if (error) { console.error('applyMovement', error); throw error; }
  },

  async ledger(itemId: string) {
    const { data, error } = await supabase
      .from('erp_stock_ledger')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error('ledger', error); return []; }
    return data || [];
  }
};

export const customerService = {
  async list(search = ''): Promise<Customer[]> {
    let q = supabase.from('erp_customers').select('*').order('name');
    if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
    const { data, error } = await q;
    if (error) { console.error('customer.list', error); return []; }
    return data || [];
  },
  async create(c: Partial<Customer>): Promise<Customer | null> {
    const { data, error } = await supabase.from('erp_customers').insert(c).select().single();
    if (error) { console.error('customer.create', error); throw error; }
    return data;
  },

  // opening_balance + sum(invoice.total) - sum(payments in).
  // NOTE: invoice.balance is NOT used here — mirrors supplierService.outstanding's
  // fixed formula. Summing per-invoice balance misses unapplied/on-account
  // payments and breaks on overpayment (which clamps a bill's balance at 0).
  // Deriving from total minus actual payments received keeps this correct
  // regardless of how a payment was allocated.
  async outstanding(customerId: string): Promise<number> {
    const { data: cust, error: e1 } = await supabase
      .from('erp_customers')
      .select('opening_balance')
      .eq('id', customerId)
      .single();
    if (e1) { console.error('customer.outstanding customer', e1); return 0; }

    const { data: invoices, error: e2 } = await supabase
      .from('erp_invoices')
      .select('total')
      .eq('customer_id', customerId);
    if (e2) { console.error('customer.outstanding invoices', e2); return 0; }

    const { data: payments, error: e3 } = await supabase
      .from('erp_payments')
      .select('amount')
      .eq('party_type', 'customer')
      .eq('party_id', customerId)
      .eq('direction', 'in');
    if (e3) { console.error('customer.outstanding payments', e3); return 0; }

    const opening = cust?.opening_balance ?? 0;
    const billed = (invoices || []).reduce((sum, i) => sum + (i.total ?? 0), 0);
    const paidIn = (payments || []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
    return opening + billed - paidIn;
  },

  // Customer ledger: this customer's invoices + their in-payments
  async ledger(customerId: string): Promise<{ invoices: Invoice[]; payments: Payment[] }> {
    const { data: invoices, error: e1 } = await supabase
      .from('erp_invoices')
      .select('*')
      .eq('customer_id', customerId)
      .order('invoice_date');
    if (e1) { console.error('customer.ledger invoices', e1); }

    const { data: payments, error: e2 } = await supabase
      .from('erp_payments')
      .select('*')
      .eq('party_type', 'customer')
      .eq('party_id', customerId)
      .eq('direction', 'in')
      .order('pay_date');
    if (e2) { console.error('customer.ledger payments', e2); }

    return { invoices: invoices || [], payments: payments || [] };
  }
};

export const invoiceService = {
  async list(search = ''): Promise<Invoice[]> {
    let q = supabase.from('erp_invoices').select('*').order('created_at', { ascending: false });
    if (search.trim()) q = q.or(`invoice_no.ilike.%${search}%,customer_name.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) { console.error('invoice.list', error); return []; }
    return data || [];
  },

  // Slim, all-rows fetch (3 numeric columns only) for the Sale List summary
  // stats — keeps whole-business totals/aging correct while the table itself
  // is paginated. Far cheaper than fetching full rows just to sum them.
  async statsRows(search = ''): Promise<Pick<Invoice, 'total' | 'balance' | 'invoice_date'>[]> {
    let q = supabase.from('erp_invoices').select('total, balance, invoice_date');
    if (search.trim()) q = q.or(`invoice_no.ilike.%${search}%,customer_name.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) { console.error('invoice.statsRows', error); throw error; }
    return (data as any) || [];
  },

  // Paginated variant for the Sale List (invoices grow unbounded over time).
  async listPaged(search = '', page = 0, pageSize = 50): Promise<{ rows: Invoice[]; total: number }> {
    let q = supabase.from('erp_invoices').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (search.trim()) q = q.or(`invoice_no.ilike.%${search}%,customer_name.ilike.%${search}%`);
    const from = page * pageSize;
    q = q.range(from, from + pageSize - 1);
    const { data, error, count } = await q;
    if (error) { console.error('invoice.listPaged', error); throw error; }
    return { rows: data || [], total: count ?? 0 };
  },

  async getWithItems(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[] } | null> {
    const { data: invoice, error: e1 } = await supabase.from('erp_invoices').select('*').eq('id', id).single();
    if (e1) { console.error('getWithItems invoice', e1); return null; }
    const { data: items, error: e2 } = await supabase.from('erp_invoice_items').select('*').eq('invoice_id', id);
    if (e2) { console.error('getWithItems items', e2); return null; }
    return { invoice, items: items || [] };
  },

  async nextInvoiceNo(): Promise<string> {
    const { data } = await supabase.rpc('erp_next_invoice_no');
    return (data as string) || 'INV-1001';
  },

  // Last rate this customer was charged for this item, or null if no history
  async lastRate(customerId: string, itemId: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('erp_last_rate', { p_customer: customerId, p_item: itemId });
    if (error) { console.error('invoice.lastRate', error); return null; }
    return (data as number) ?? null;
  },

  // Create invoice + items + stock-out, all wired
  async create(invoice: Partial<Invoice>, items: InvoiceItem[]): Promise<Invoice | null> {
    const { data: inv, error } = await supabase
      .from('erp_invoices')
      .insert(invoice)
      .select()
      .single();
    if (error) { console.error('invoice.create', error); throw error; }

    // Insert line items
    const itemRows = items.map(it => ({ ...it, invoice_id: inv.id }));
    const { error: e2 } = await supabase.from('erp_invoice_items').insert(itemRows);
    if (e2) { console.error('invoice items insert', e2); throw e2; }

    // Stock-out each item
    if (inv.warehouse_id) {
      for (const it of items) {
        if (it.item_id && it.qty > 0) {
          await stockService.applyMovement({
            itemId: it.item_id,
            variantId: it.variant_id ?? null,
            warehouseId: inv.warehouse_id,
            change: -it.qty,
            reason: 'sale',
            refType: 'invoice',
            refId: inv.id
          });
        }
      }
    }
    return inv;
  }
};

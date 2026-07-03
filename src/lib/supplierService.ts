import { supabase, type Supplier, type Purchase, type Payment } from './supabase';

export const supplierService = {
  async list(search = ''): Promise<Supplier[]> {
    let q = supabase.from('erp_suppliers').select('*').order('name');
    if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
    const { data, error } = await q;
    if (error) { console.error('supplier.list', error); return []; }
    return data || [];
  },

  async create(s: Partial<Supplier>): Promise<Supplier | null> {
    const { data, error } = await supabase.from('erp_suppliers').insert(s).select().single();
    if (error) { console.error('supplier.create', error); throw error; }
    return data;
  },

  async update(id: string, patch: Partial<Supplier>): Promise<Supplier | null> {
    const { data, error } = await supabase
      .from('erp_suppliers')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('supplier.update', error); throw error; }
    return data;
  },

  // opening_balance + sum(purchase.total) - sum(payments out).
  // NOTE: purchase.balance is NOT used here — it's only updated for payments
  // applied to a specific bill, so an unapplied general payment or an
  // overpayment (which clamps a bill's balance at 0) would otherwise be
  // invisible to this total. Deriving from total minus actual payments made
  // keeps this correct regardless of how a payment was applied.
  async outstanding(supplierId: string): Promise<number> {
    const { data: sup, error: e1 } = await supabase
      .from('erp_suppliers')
      .select('opening_balance')
      .eq('id', supplierId)
      .single();
    if (e1) { console.error('supplier.outstanding supplier', e1); return 0; }

    const { data: purchases, error: e2 } = await supabase
      .from('erp_purchases')
      .select('total')
      .eq('supplier_id', supplierId);
    if (e2) { console.error('supplier.outstanding purchases', e2); return 0; }

    const { data: payments, error: e3 } = await supabase
      .from('erp_payments')
      .select('amount')
      .eq('party_type', 'supplier')
      .eq('party_id', supplierId)
      .eq('direction', 'out');
    if (e3) { console.error('supplier.outstanding payments', e3); return 0; }

    const opening = sup?.opening_balance ?? 0;
    const billed = (purchases || []).reduce((sum, p) => sum + (p.total ?? 0), 0);
    const paidOut = (payments || []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
    return opening + billed - paidOut;
  },

  // Supplier ledger: this supplier's purchases + their out-payments
  async ledger(supplierId: string): Promise<{ purchases: Purchase[]; payments: Payment[] }> {
    const { data: purchases, error: e1 } = await supabase
      .from('erp_purchases')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('bill_date');
    if (e1) { console.error('supplier.ledger purchases', e1); }

    const { data: payments, error: e2 } = await supabase
      .from('erp_payments')
      .select('*')
      .eq('party_type', 'supplier')
      .eq('party_id', supplierId)
      .order('pay_date');
    if (e2) { console.error('supplier.ledger payments', e2); }

    return { purchases: purchases || [], payments: payments || [] };
  }
};

import { supabase, type Payment } from './supabase';

export const paymentService = {
  // Record a payment IN from a customer, optionally allocated across one or
  // more invoices (partial or full settlement). An empty allocations array
  // records an on-account/advance payment with nothing applied yet.
  async recordCustomerPayment(params: {
    customerId: string;
    amount: number;
    mode: string;
    payDate: string;
    note?: string;
    allocations: { invoiceId: string; amount: number }[];
  }): Promise<void> {
    // Validate before writing anything: allocations can't exceed the amount received.
    const allocatedTotal = params.allocations.reduce((sum, a) => sum + a.amount, 0);
    if (allocatedTotal > params.amount) {
      throw new Error('Allocated amount cannot exceed the payment amount.');
    }

    const { data: pay, error } = await supabase
      .from('erp_payments')
      .insert({
        direction: 'in',
        party_type: 'customer',
        party_id: params.customerId,
        ref_type: 'invoice_settlement',
        ref_id: null,
        amount: params.amount,
        mode: params.mode,
        pay_date: params.payDate,
        note: params.note ?? null
      })
      .select()
      .single();
    if (error) { console.error('payment.recordCustomerPayment insert', error); throw error; }

    for (const alloc of params.allocations) {
      if (alloc.amount <= 0) continue;

      const { error: eAlloc } = await supabase.from('erp_payment_allocations').insert({
        payment_id: pay.id,
        invoice_id: alloc.invoiceId,
        amount: alloc.amount
      });
      if (eAlloc) { console.error('payment.recordCustomerPayment allocation insert', eAlloc); throw eAlloc; }

      // Update the linked invoice's running paid/balance.
      // CAVEAT: not atomic — read-then-write, matching the codebase's existing
      // non-atomic multi-write pattern (e.g. invoiceService.create, recordOut).
      const { data: inv, error: eRead } = await supabase
        .from('erp_invoices')
        .select('paid, balance')
        .eq('id', alloc.invoiceId)
        .single();
      if (eRead) { console.error('payment.recordCustomerPayment read invoice', eRead); throw eRead; }

      // Clamp what's actually applied to this invoice's own remaining balance,
      // so paid+balance==total holds even if the caller allocated more to a
      // single invoice than it owed (the recorded erp_payments.amount already
      // captures the true amount received regardless of this clamp).
      const applied = Math.min(alloc.amount, inv?.balance ?? 0);
      const paid = (inv?.paid ?? 0) + applied;
      const balance = Math.max(0, (inv?.balance ?? 0) - applied);

      const { error: eWrite } = await supabase
        .from('erp_invoices')
        .update({ paid, balance })
        .eq('id', alloc.invoiceId);
      if (eWrite) { console.error('payment.recordCustomerPayment update invoice', eWrite); throw eWrite; }
    }
  },

  // Total ever received from customers (direction='in'). Used by SalesList's
  // global outstanding stat — must be total-minus-payments, not a sum of
  // invoice.balance, for the same reason customerService.outstanding is.
  async totalReceivedFromCustomers(): Promise<number> {
    const { data, error } = await supabase
      .from('erp_payments')
      .select('amount')
      .eq('direction', 'in')
      .eq('party_type', 'customer');
    if (error) { console.error('payment.totalReceivedFromCustomers', error); return 0; }
    return (data || []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
  },

  // Record a payment OUT to a supplier, optionally against a specific purchase.
  // If a purchaseId is given, the purchase's paid/balance columns are updated
  // (read-then-write — see atomicity caveat below).
  async recordOut(params: {
    supplierId: string;
    purchaseId?: string | null;
    amount: number;
    mode: string;
    payDate: string;
    note?: string;
  }): Promise<void> {
    const { error } = await supabase.from('erp_payments').insert({
      direction: 'out',
      party_type: 'supplier',
      party_id: params.supplierId,
      ref_type: params.purchaseId ? 'purchase' : null,
      ref_id: params.purchaseId ?? null,
      amount: params.amount,
      mode: params.mode,
      pay_date: params.payDate,
      note: params.note ?? null
    });
    if (error) { console.error('payment.recordOut insert', error); throw error; }

    // Update the linked purchase's running paid/balance.
    // CAVEAT: not atomic — read-then-write, matching the codebase's existing
    // non-atomic multi-write pattern (e.g. invoiceService.create).
    if (params.purchaseId) {
      const { data: pur, error: e2 } = await supabase
        .from('erp_purchases')
        .select('paid, balance')
        .eq('id', params.purchaseId)
        .single();
      if (e2) { console.error('payment.recordOut read purchase', e2); throw e2; }

      // Clamp what's actually applied to this purchase's own remaining balance,
      // so paid+balance==total holds even if the amount exceeds what's owed
      // (erp_payments.amount already captures the true amount paid regardless).
      const applied = Math.min(params.amount, pur?.balance ?? 0);
      const paid = (pur?.paid ?? 0) + applied;
      const balance = Math.max(0, (pur?.balance ?? 0) - applied);

      const { error: e3 } = await supabase
        .from('erp_purchases')
        .update({ paid, balance })
        .eq('id', params.purchaseId);
      if (e3) { console.error('payment.recordOut update purchase', e3); throw e3; }
    }
  },

  // Total ever paid out to suppliers (direction='out'). Used by the Purchase
  // List's Payable stat — must be total-minus-payments, not sum(purchase.balance),
  // for the same reason customer/supplier outstanding is.
  async totalPaidToSuppliers(): Promise<number> {
    const { data, error } = await supabase
      .from('erp_payments')
      .select('amount')
      .eq('direction', 'out')
      .eq('party_type', 'supplier');
    if (error) { console.error('payment.totalPaidToSuppliers', error); return 0; }
    return (data || []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
  },

  // Fetch payments for a party (e.g. supplier ledger / Phase 6 readiness).
  async list(params: { partyType: 'customer' | 'supplier'; partyId: string }): Promise<Payment[]> {
    const { data, error } = await supabase
      .from('erp_payments')
      .select('*')
      .eq('party_type', params.partyType)
      .eq('party_id', params.partyId)
      .order('pay_date', { ascending: false });
    if (error) { console.error('payment.list', error); return []; }
    return data || [];
  }
};

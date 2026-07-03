import { supabase } from './supabase';

// Phase 7 "Reports & Insight" — read-only aggregation service.
// All date params are ISO date strings (YYYY-MM-DD), matching invoice_date /
// bill_date conventions used elsewhere (see Billing.tsx's `date` state).
// No new DB functions/tables: everything here is plain select + JS grouping,
// since the JS query builder has no GROUP BY/HAVING support.

export interface SalesByDay { date: string; total: number; count: number }
export interface SalesByMonth { month: string; total: number; count: number }
export interface SalesByCustomer { customerId: string | null; customerName: string; total: number; count: number }
export interface SalesByItem { itemId: string | null; itemName: string; qty: number; amount: number }
export interface GstSummaryRow { gstRate: number; taxableAmount: number; taxAmount: number }
export interface LowStockRow { itemId: string; itemName: string; quantity: number; reorderLevel: number }
export interface DeadStockRow { itemId: string; itemName: string; quantity: number; lastMovementDate: string | null }

export const reportService = {
  async salesByDay(from: string, to: string): Promise<SalesByDay[]> {
    const { data, error } = await supabase
      .from('erp_invoices')
      .select('invoice_date, total')
      .gte('invoice_date', from)
      .lte('invoice_date', to);
    if (error) { console.error('reportService.salesByDay', error); return []; }

    const byDate = new Map<string, SalesByDay>();
    for (const row of data || []) {
      const key = row.invoice_date;
      const bucket = byDate.get(key) ?? { date: key, total: 0, count: 0 };
      bucket.total += row.total ?? 0;
      bucket.count += 1;
      byDate.set(key, bucket);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  },

  async salesByMonth(from: string, to: string): Promise<SalesByMonth[]> {
    const { data, error } = await supabase
      .from('erp_invoices')
      .select('invoice_date, total')
      .gte('invoice_date', from)
      .lte('invoice_date', to);
    if (error) { console.error('reportService.salesByMonth', error); return []; }

    const byMonth = new Map<string, SalesByMonth>();
    for (const row of data || []) {
      const key = (row.invoice_date ?? '').slice(0, 7);
      const bucket = byMonth.get(key) ?? { month: key, total: 0, count: 0 };
      bucket.total += row.total ?? 0;
      bucket.count += 1;
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  },

  async salesByCustomer(from: string, to: string): Promise<SalesByCustomer[]> {
    const { data, error } = await supabase
      .from('erp_invoices')
      .select('customer_id, customer_name, total')
      .gte('invoice_date', from)
      .lte('invoice_date', to);
    if (error) { console.error('reportService.salesByCustomer', error); return []; }

    const byCustomer = new Map<string, SalesByCustomer>();
    for (const row of data || []) {
      const name = row.customer_name || 'Cash Sale';
      const key = row.customer_id ?? name;
      const bucket = byCustomer.get(key) ?? {
        customerId: row.customer_id ?? null,
        customerName: name,
        total: 0,
        count: 0
      };
      bucket.total += row.total ?? 0;
      bucket.count += 1;
      byCustomer.set(key, bucket);
    }
    return Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);
  },

  async salesByItem(from: string, to: string): Promise<SalesByItem[]> {
    const { data, error } = await supabase
      .from('erp_invoice_items')
      .select('item_id, name, qty, amount, erp_invoices!inner(invoice_date)')
      .gte('erp_invoices.invoice_date', from)
      .lte('erp_invoices.invoice_date', to);
    if (error) { console.error('reportService.salesByItem', error); return []; }

    const byItem = new Map<string, SalesByItem>();
    for (const row of data || []) {
      const key = row.item_id ?? `name:${row.name}`;
      const bucket = byItem.get(key) ?? {
        itemId: row.item_id ?? null,
        itemName: row.name,
        qty: 0,
        amount: 0
      };
      bucket.qty += row.qty ?? 0;
      bucket.amount += row.amount ?? 0;
      byItem.set(key, bucket);
    }
    return Array.from(byItem.values()).sort((a, b) => b.amount - a.amount);
  },

  async gstSummary(from: string, to: string): Promise<GstSummaryRow[]> {
    const { data, error } = await supabase
      .from('erp_invoice_items')
      .select('gst_rate, amount, erp_invoices!inner(invoice_date)')
      .gte('erp_invoices.invoice_date', from)
      .lte('erp_invoices.invoice_date', to);
    if (error) { console.error('reportService.gstSummary', error); return []; }

    const byRate = new Map<number, { gstRate: number; taxableAmount: number }>();
    for (const row of data || []) {
      const rate = row.gst_rate ?? 0;
      const bucket = byRate.get(rate) ?? { gstRate: rate, taxableAmount: 0 };
      bucket.taxableAmount += row.amount ?? 0;
      byRate.set(rate, bucket);
    }
    return Array.from(byRate.values())
      .map(b => ({ ...b, taxAmount: b.taxableAmount * (b.gstRate / 100) }))
      .sort((a, b) => a.gstRate - b.gstRate);
  },

  async lowStock(): Promise<LowStockRow[]> {
    const { data, error } = await supabase
      .from('erp_stock')
      .select('item_id, quantity, erp_items(name, reorder_level)');
    if (error) { console.error('reportService.lowStock', error); return []; }

    const byItem = new Map<string, { itemName: string; quantity: number; reorderLevel: number }>();
    for (const row of (data || []) as any[]) {
      const itemName = row.erp_items?.name ?? 'Unknown';
      const reorderLevel = row.erp_items?.reorder_level ?? 0;
      const bucket = byItem.get(row.item_id) ?? { itemName, quantity: 0, reorderLevel };
      bucket.quantity += row.quantity ?? 0;
      byItem.set(row.item_id, bucket);
    }

    return Array.from(byItem.entries())
      .filter(([, b]) => b.reorderLevel > 0 && b.quantity <= b.reorderLevel)
      .map(([itemId, b]) => ({ itemId, itemName: b.itemName, quantity: b.quantity, reorderLevel: b.reorderLevel }))
      .sort((a, b) => a.quantity - b.quantity);
  },

  async deadStock(days = 60): Promise<DeadStockRow[]> {
    const { data: stockRows, error: e1 } = await supabase
      .from('erp_stock')
      .select('item_id, variant_id, quantity, erp_items(name)')
      .gt('quantity', 0);
    if (e1) { console.error('reportService.deadStock stock', e1); return []; }

    // Roll up quantity per item_id (an item can have stock in multiple warehouses)
    const byItem = new Map<string, { itemName: string; quantity: number }>();
    for (const row of (stockRows || []) as any[]) {
      const itemName = row.erp_items?.name ?? 'Unknown';
      const bucket = byItem.get(row.item_id) ?? { itemName, quantity: 0 };
      bucket.quantity += row.quantity ?? 0;
      byItem.set(row.item_id, bucket);
    }
    if (byItem.size === 0) return [];

    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { data: recentLedger, error: e2 } = await supabase
      .from('erp_stock_ledger')
      .select('item_id')
      .gte('created_at', cutoff);
    if (e2) { console.error('reportService.deadStock recent ledger', e2); return []; }

    const movedRecently = new Set((recentLedger || []).map(r => r.item_id));
    const deadItemIds = Array.from(byItem.keys()).filter(id => !movedRecently.has(id));
    if (deadItemIds.length === 0) return [];

    const { data: lastMoves, error: e3 } = await supabase
      .from('erp_stock_ledger')
      .select('item_id, created_at')
      .in('item_id', deadItemIds)
      .order('created_at', { ascending: false });
    if (e3) { console.error('reportService.deadStock last movement', e3); }

    const lastMovementByItem = new Map<string, string>();
    for (const row of lastMoves || []) {
      if (!lastMovementByItem.has(row.item_id)) {
        lastMovementByItem.set(row.item_id, row.created_at);
      }
    }

    return deadItemIds
      .map(itemId => {
        const b = byItem.get(itemId)!;
        return {
          itemId,
          itemName: b.itemName,
          quantity: b.quantity,
          lastMovementDate: lastMovementByItem.get(itemId) ?? null
        };
      })
      .sort((a, b) => b.quantity - a.quantity);
  }
};

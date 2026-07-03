import { supabase, type Purchase, type PurchaseItem } from './supabase';
import { stockService } from './erpServices';

export const purchaseService = {
  async list(search = ''): Promise<Purchase[]> {
    let q = supabase.from('erp_purchases').select('*').order('created_at', { ascending: false });
    if (search.trim()) q = q.ilike('bill_no', `%${search.trim()}%`);
    const { data, error } = await q;
    if (error) { console.error('purchase.list', error); return []; }
    return data || [];
  },

  // Slim all-rows fetch for the Purchase List summary stats (total purchased),
  // so whole-business figures stay correct while the table is paginated.
  async statsRows(search = ''): Promise<Pick<Purchase, 'total'>[]> {
    let q = supabase.from('erp_purchases').select('total');
    if (search.trim()) q = q.ilike('bill_no', `%${search.trim()}%`);
    const { data, error } = await q;
    if (error) { console.error('purchase.statsRows', error); throw error; }
    return (data as any) || [];
  },

  // Paginated variant for the Purchase List (purchases grow unbounded over time).
  async listPaged(search = '', page = 0, pageSize = 50): Promise<{ rows: Purchase[]; total: number }> {
    let q = supabase.from('erp_purchases').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (search.trim()) q = q.ilike('bill_no', `%${search.trim()}%`);
    const from = page * pageSize;
    q = q.range(from, from + pageSize - 1);
    const { data, error, count } = await q;
    if (error) { console.error('purchase.listPaged', error); throw error; }
    return { rows: data || [], total: count ?? 0 };
  },

  async getWithItems(id: string): Promise<{ purchase: Purchase; items: PurchaseItem[] } | null> {
    const { data: purchase, error: e1 } = await supabase.from('erp_purchases').select('*').eq('id', id).single();
    if (e1) { console.error('getWithItems purchase', e1); return null; }
    const { data: items, error: e2 } = await supabase.from('erp_purchase_items').select('*').eq('purchase_id', id);
    if (e2) { console.error('getWithItems purchase items', e2); return null; }
    return { purchase, items: items || [] };
  },

  // Create purchase + items + stock-in (inverse of invoiceService.create's stock-out)
  async create(purchase: Partial<Purchase>, items: PurchaseItem[]): Promise<Purchase | null> {
    const { data: pur, error } = await supabase
      .from('erp_purchases')
      .insert(purchase)
      .select()
      .single();
    if (error) { console.error('purchase.create', error); throw error; }

    // Insert line items (variant_id flows through the spread)
    const itemRows = items.map(it => ({ ...it, purchase_id: pur.id }));
    const { error: e2 } = await supabase.from('erp_purchase_items').insert(itemRows);
    if (e2) { console.error('purchase items insert', e2); throw e2; }

    // Stock-IN each item only when received and a warehouse is set
    if (pur.status === 'received' && pur.warehouse_id) {
      for (const it of items) {
        if (it.item_id && it.qty > 0) {
          await stockService.applyMovement({
            itemId: it.item_id,
            variantId: it.variant_id ?? null,
            warehouseId: pur.warehouse_id,
            change: +it.qty, // POSITIVE — stock IN
            reason: 'purchase',
            refType: 'purchase',
            refId: pur.id
          });
        }
      }
    }
    return pur;
  }
};

import { supabase, type ErpItem, type CustomFieldDef } from './supabase';

export const itemService = {
  async list(search = ''): Promise<ErpItem[]> {
    let query = supabase.from('erp_items').select('*').order('name');
    if (search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`);
    }
    const { data, error } = await query;
    if (error) { console.error('itemService.list', error); return []; }
    return data || [];
  },

  // Paginated variant for large catalogues (keeps the DOM bounded at 5,000+ items).
  // Returns the page rows plus the total match count (for page controls).
  async listPaged(search = '', page = 0, pageSize = 50): Promise<{ rows: ErpItem[]; total: number }> {
    let query = supabase.from('erp_items').select('*', { count: 'exact' }).order('name');
    if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);
    const from = page * pageSize;
    query = query.range(from, from + pageSize - 1);
    const { data, error, count } = await query;
    if (error) { console.error('itemService.listPaged', error); throw error; }
    return { rows: data || [], total: count ?? 0 };
  },

  async getById(id: string): Promise<ErpItem | null> {
    const { data, error } = await supabase.from('erp_items').select('*').eq('id', id).maybeSingle();
    if (error) { console.error('itemService.getById', error); return null; }
    return data;
  },

  async nextSku(): Promise<string> {
    const { data, error } = await supabase.rpc('erp_next_sku');
    if (error) { console.error('nextSku', error); return 'XLT-0001'; }
    return data as string;
  },

  async create(item: Partial<ErpItem>): Promise<ErpItem | null> {
    // Auto-SKU if blank
    let sku = item.sku?.trim() || null;
    if (!sku) sku = await this.nextSku();

    const { data, error } = await supabase
      .from('erp_items')
      .insert({ ...item, sku })
      .select()
      .single();
    if (error) { console.error('itemService.create', error); throw error; }
    return data;
  },

  async update(id: string, patch: Partial<ErpItem>): Promise<ErpItem | null> {
    const { data, error } = await supabase
      .from('erp_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('itemService.update', error); throw error; }
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('erp_items').delete().eq('id', id);
    if (error) { console.error('itemService.remove', error); throw error; }
  },

  // ─── Custom field definitions ───
  async listCustomFields(): Promise<CustomFieldDef[]> {
    const { data, error } = await supabase
      .from('erp_custom_field_defs')
      .select('*')
      .order('sort_order');
    if (error) { console.error('listCustomFields', error); return []; }
    return data || [];
  },

  async addCustomField(def: Omit<CustomFieldDef, 'id'>): Promise<CustomFieldDef | null> {
    const { data, error } = await supabase
      .from('erp_custom_field_defs')
      .insert(def)
      .select()
      .single();
    if (error) { console.error('addCustomField', error); throw error; }
    return data;
  },

  async removeCustomField(id: string): Promise<void> {
    const { error } = await supabase.from('erp_custom_field_defs').delete().eq('id', id);
    if (error) { console.error('removeCustomField', error); throw error; }
  }
};

import { supabase, type ErpItemVariant } from './supabase';

export const variantService = {
  async listByItem(itemId: string): Promise<ErpItemVariant[]> {
    const { data, error } = await supabase
      .from('erp_item_variants')
      .select('*')
      .eq('item_id', itemId)
      .order('variant_name');
    if (error) { console.error('variantService.listByItem', error); return []; }
    return data || [];
  },

  async create(v: Partial<ErpItemVariant>): Promise<ErpItemVariant | null> {
    const { data, error } = await supabase
      .from('erp_item_variants')
      .insert(v)
      .select()
      .single();
    if (error) { console.error('variantService.create', error); throw error; }
    return data;
  },

  async update(id: string, patch: Partial<ErpItemVariant>): Promise<ErpItemVariant | null> {
    const { data, error } = await supabase
      .from('erp_item_variants')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('variantService.update', error); throw error; }
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('erp_item_variants').delete().eq('id', id);
    if (error) { console.error('variantService.remove', error); throw error; }
  }
};

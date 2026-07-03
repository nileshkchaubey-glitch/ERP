import { supabase, type OrgSettings, type OrgMember } from './supabase';

// All organization-level DB logic lives here (settings + team members).
export const orgService = {
  async getSettings(orgId: string): Promise<OrgSettings | null> {
    const { data, error } = await supabase
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) { console.error('orgService.getSettings', error); return null; }
    return data;
  },

  async updateSettings(orgId: string, patch: Partial<OrgSettings>): Promise<void> {
    const { error } = await supabase
      .from('org_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('org_id', orgId);
    if (error) { console.error('orgService.updateSettings', error); throw error; }
  },

  async listMembers(): Promise<OrgMember[]> {
    const { data, error } = await supabase
      .from('org_members')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) { console.error('orgService.listMembers', error); return []; }
    return data || [];
  },

  async setRole(memberId: string, role: 'owner' | 'admin' | 'staff'): Promise<void> {
    const { error } = await supabase.from('org_members').update({ role }).eq('id', memberId);
    if (error) { console.error('orgService.setRole', error); throw error; }
  },

  async setActive(memberId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('org_members').update({ is_active: isActive }).eq('id', memberId);
    if (error) { console.error('orgService.setActive', error); throw error; }
  }
};

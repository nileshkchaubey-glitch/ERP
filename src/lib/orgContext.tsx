import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export type Role = 'owner' | 'admin' | 'staff';

interface OrgContextValue {
  orgId: string | null;
  orgName: string;
  role: Role | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgContextValue>({
  orgId: null,
  orgName: '',
  role: null,
  loading: true,
  refresh: async () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setOrgId(null);
        setOrgName('');
        setRole(null);
        return;
      }

      // Which org does this user belong to, and as what role?
      const { data: member } = await supabase
        .from('org_members')
        .select('org_id, role')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!member) {
        // Signed in but no org yet -> signup will prompt to create one.
        setOrgId(null);
        setOrgName('');
        setRole(null);
        return;
      }

      setOrgId(member.org_id);
      setRole(member.role as Role);

      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', member.org_id)
        .maybeSingle();

      setOrgName(org?.name ?? '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') return;
      load();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <OrgContext.Provider value={{ orgId, orgName, role, loading, refresh: load }}>
      {children}
    </OrgContext.Provider>
  );
}

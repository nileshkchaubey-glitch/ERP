import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/orgContext';

export function CreateBusiness() {
  const { refresh } = useOrg();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setErr('Please enter your business name');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const { error } = await supabase.rpc('create_org_for_me', { p_name: name.trim() });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setErr(e.message || 'Could not create business');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand text-white grid place-items-center text-2xl mx-auto mb-3">🏢</div>
          <h1 className="text-xl font-bold">Create your business</h1>
          <p className="text-sm text-slate-400">You'll be the owner of this workspace</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Business name</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. XL Traders"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>

          {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{err}</div>}

          <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create business'}
          </button>

          <button
            className="text-xs text-slate-500 w-full text-center pt-1"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

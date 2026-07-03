import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If email confirmation is disabled, a session is returned and the app
        // moves straight to the "Create your business" step. Otherwise, sign in.
        if (!data.session) {
          setErr('Account created. Check your email if confirmation is required, then sign in.');
          setMode('signin');
        }
      }
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand text-white grid place-items-center text-2xl mx-auto mb-3">📒</div>
          <h1 className="text-xl font-bold">XL ERP</h1>
          <p className="text-sm text-slate-400">{mode === 'signin' ? 'Sign in to continue' : 'Create your account'}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>

          {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{err}</div>}

          <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? '…' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>

          <button
            className="text-xs text-slate-500 w-full text-center pt-1"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(''); }}
          >
            {mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

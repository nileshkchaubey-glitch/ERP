import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      // Skip TOKEN_REFRESHED churn — only react to real sign-in/out
      if (_event === 'TOKEN_REFRESHED') return;
      // SECURITY: the PWA service worker keeps an offline-fallback cache of
      // Supabase REST responses, keyed by URL only (the auth token is NOT part
      // of the cache key). Purge it on BOTH sign-in and sign-out so a previous
      // user's cached data can never be served to the next user on a shared
      // device. Purging on sign-in too covers expired/forced logouts that
      // never fired a SIGNED_OUT event.
      if (_event === 'SIGNED_IN' || _event === 'SIGNED_OUT') {
        if ('caches' in window) {
          caches.delete('supabase-reads').catch(() => {});
        }
      }
      setSession(sess);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

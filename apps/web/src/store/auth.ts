import { create } from 'zustand';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: SupabaseUser | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
}

// Read cached session synchronously from localStorage so we never show a
// loading spinner for returning users — getSession() validates it in the background.
function readCachedSession(): Session | null {
  try {
    const raw = localStorage.getItem('split-it-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.access_token ? parsed : null;
  } catch {
    return null;
  }
}

const cached = readCachedSession();

export const useAuthStore = create<AuthState>((set) => ({
  session: cached,
  user: cached?.user ?? null,
  loading: !cached, // skip spinner if we already have a cached session
  setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
}));

// Validate / refresh in the background
supabase.auth.getSession()
  .then(({ data }) => useAuthStore.getState().setSession(data.session))
  .catch(() => useAuthStore.getState().setSession(null));

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session);
});

import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { resolveMembership, type Membership } from '@/lib/membership';
import { supabase } from '@/lib/supabase';

export type { Membership } from '@/lib/membership';

export interface AuthState {
  /** undefined while restoring the persisted session. */
  session: Session | null | undefined;
  /** undefined while loading; null when the user has no family yet. */
  membership: Membership | null | undefined;
  signOut: () => Promise<void>;
  /** Re-resolve membership (claims pending invites); used by onboarding. */
  refreshMembership: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [membership, setMembership] = useState<Membership | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setMembership(undefined);
      return;
    }
    resolveMembership(userId).then((m) => {
      if (!cancelled) setMembership(m);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshMembership = useCallback(async () => {
    if (!userId) return;
    setMembership(await resolveMembership(userId));
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, membership, signOut, refreshMembership }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>');
  return state;
}

/** Convenience: the current household id (throws off the happy path if absent). */
export function useHousehold(): Membership {
  const { membership } = useAuth();
  if (!membership) throw new Error('useHousehold used without a household membership');
  return membership;
}

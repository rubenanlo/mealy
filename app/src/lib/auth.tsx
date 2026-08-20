import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { supabase } from '@/lib/supabase';

export interface Membership {
  householdId: string;
  personId: string | null;
  role: 'owner' | 'member';
}

export interface AuthState {
  /** undefined while restoring the persisted session. */
  session: Session | null | undefined;
  /** undefined while loading; null when the user has no household (not invited). */
  membership: Membership | null | undefined;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, person_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    householdId: data.household_id as string,
    personId: (data.person_id as string | null) ?? null,
    role: data.role as 'owner' | 'member',
  };
}

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
    fetchMembership(userId).then((m) => {
      if (!cancelled) setMembership(m);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, membership, signOut }}>
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

import { supabase } from '@/lib/supabase';

export interface Membership {
  householdId: string;
  personId: string | null;
  role: 'owner' | 'member';
}

export async function fetchMembership(userId: string): Promise<Membership | null> {
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

/**
 * Membership, claiming a pending invite when none exists yet (the
 * signed-up-before-invited order the DB trigger cannot cover).
 */
export async function resolveMembership(userId: string): Promise<Membership | null> {
  const existing = await fetchMembership(userId);
  if (existing) return existing;
  const { data, error } = await supabase.rpc('claim_invites');
  if (error || !data) return null;
  return fetchMembership(userId);
}

/** Creates the family and the caller's owner membership; returns the household id. */
export async function createFamily(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_family', { family_name: name });
  if (error) throw error;
  return data as string;
}

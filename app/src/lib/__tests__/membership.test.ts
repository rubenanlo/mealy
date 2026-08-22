import { supabase } from '@/lib/supabase';

import { createFamily, resolveMembership } from '../membership';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function membershipQueryReturning(row: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
  };
}

const ROW = { household_id: 'hh-1', person_id: null, role: 'owner' };

describe('resolveMembership', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the membership without claiming when one exists', async () => {
    mockFrom.mockReturnValue(membershipQueryReturning(ROW));
    const m = await resolveMembership('user-1');
    expect(m).toEqual({ householdId: 'hh-1', personId: null, role: 'owner' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('claims a pending invite and re-fetches when there is no membership', async () => {
    mockFrom
      .mockReturnValueOnce(membershipQueryReturning(null))
      .mockReturnValueOnce(membershipQueryReturning({ ...ROW, role: 'member' }));
    mockRpc.mockResolvedValue({ data: 'hh-1', error: null });
    const m = await resolveMembership('user-1');
    expect(mockRpc).toHaveBeenCalledWith('claim_invites');
    expect(m).toEqual({ householdId: 'hh-1', personId: null, role: 'member' });
  });

  it('returns null when there is no membership and nothing to claim', async () => {
    mockFrom.mockReturnValue(membershipQueryReturning(null));
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(resolveMembership('user-1')).resolves.toBeNull();
  });
});

describe('createFamily', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the new household id', async () => {
    mockRpc.mockResolvedValue({ data: 'hh-9', error: null });
    await expect(createFamily('Andino')).resolves.toBe('hh-9');
    expect(mockRpc).toHaveBeenCalledWith('create_family', { family_name: 'Andino' });
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'already in a family' } });
    await expect(createFamily('Andino')).rejects.toMatchObject({ message: 'already in a family' });
  });
});

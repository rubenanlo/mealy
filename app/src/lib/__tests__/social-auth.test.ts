import { googleAvailable, signInWithApple } from '../social-auth';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithIdToken: jest.fn().mockResolvedValue({ error: null }) } },
}));

const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

describe('googleAvailable', () => {
  it('is false when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not configured', () => {
    // jest.setup.js does not define it; the native module is also absent in tests.
    expect(googleAvailable()).toBe(false);
  });
});

describe('signInWithApple', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges the identity token with Supabase', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'tok' });
    await expect(signInWithApple()).resolves.toEqual({ error: null });
    const { supabase } = require('@/lib/supabase');
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'tok',
    });
  });

  it('treats user cancellation as a silent no-op', async () => {
    mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await expect(signInWithApple()).resolves.toEqual({ error: null });
    const { supabase } = require('@/lib/supabase');
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('returns a message when no identity token comes back', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });
    const res = await signInWithApple();
    expect(res.error).toBeTruthy();
  });
});

export type SignupCodeStatus = 'active' | 'expired' | 'redeemed';

export interface SignupCodeRow {
  code: string;
  expires_at: string;
  redeemed_at: string | null;
}

/** A used code reads as 'redeemed' regardless of expiry; otherwise expiry decides. */
export function signupCodeStatus(
  code: Pick<SignupCodeRow, 'expires_at' | 'redeemed_at'>,
  now: Date = new Date()
): SignupCodeStatus {
  if (code.redeemed_at) return 'redeemed';
  if (new Date(code.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

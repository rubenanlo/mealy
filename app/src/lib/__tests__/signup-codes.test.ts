import { signupCodeStatus } from '../signup-codes';

const NOW = new Date('2026-08-25T12:00:00Z');

describe('signupCodeStatus', () => {
  it('is active when unredeemed and not yet expired', () => {
    expect(
      signupCodeStatus({ expires_at: '2026-09-01T12:00:00Z', redeemed_at: null }, NOW)
    ).toBe('active');
  });

  it('is expired when past expiry and never redeemed', () => {
    expect(
      signupCodeStatus({ expires_at: '2026-08-20T12:00:00Z', redeemed_at: null }, NOW)
    ).toBe('expired');
  });

  it('is redeemed when used, even if also past expiry', () => {
    expect(
      signupCodeStatus(
        { expires_at: '2026-08-20T12:00:00Z', redeemed_at: '2026-08-19T12:00:00Z' },
        NOW
      )
    ).toBe('redeemed');
  });
});

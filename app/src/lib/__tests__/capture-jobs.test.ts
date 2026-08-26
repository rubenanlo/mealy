import { jobPayload } from '../capture-jobs';

// jobPayload is pure; the supabase client is mocked (hoisted above the
// import by jest) only so the module loads.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('jobPayload', () => {
  it('routes social links to a social job with the bare URL', () => {
    expect(
      jobPayload('Check this! https://www.instagram.com/reel/DcaqTjyCVwi/?igsi=abc 🍲')
    ).toEqual({ kind: 'social', input: 'https://www.instagram.com/reel/DcaqTjyCVwi/?igsi=abc' });
  });

  it('routes plain URLs to a url job, trimmed', () => {
    expect(jobPayload('  https://www.marmiton.org/recettes/tarte.aspx  ')).toEqual({
      kind: 'url',
      input: 'https://www.marmiton.org/recettes/tarte.aspx',
    });
  });

  it('keeps recipe text verbatim as a text job', () => {
    const text = 'Tarte aux pommes\n200 g de farine\n3 pommes\nMélanger et cuire.';
    expect(jobPayload(text)).toEqual({ kind: 'text', input: text });
  });
});

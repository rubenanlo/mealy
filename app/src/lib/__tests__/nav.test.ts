import { router } from 'expo-router';

import { backOr } from '@/lib/nav';

jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

const mocked = router as jest.Mocked<typeof router>;

describe('backOr', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes back when history exists', () => {
    (mocked.canGoBack as jest.Mock).mockReturnValue(true);
    backOr('/settings');
    expect(mocked.back).toHaveBeenCalled();
    expect(mocked.replace).not.toHaveBeenCalled();
  });

  it('replaces with the fallback when there is no history', () => {
    (mocked.canGoBack as jest.Mock).mockReturnValue(false);
    backOr('/settings');
    expect(mocked.back).not.toHaveBeenCalled();
    expect(mocked.replace).toHaveBeenCalledWith('/settings');
  });
});

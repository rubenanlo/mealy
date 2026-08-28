import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { notify } from '@/lib/confirm';
import { employeeMenuUrl, shareEmployeeLink } from '@/lib/employee-link';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/confirm', () => ({ notify: jest.fn() }));

describe('employeeMenuUrl', () => {
  it('builds the proxy URL with the share token', () => {
    expect(employeeMenuUrl('tok-1')).toBe(
      'https://mealy-menu.mealy-rubenanlo.workers.dev/?token=tok-1'
    );
  });
});

describe('shareEmployeeLink', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the system share sheet when available', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as Awaited<ReturnType<typeof Share.share>>);

    await shareEmployeeLink('tok-1', 'Link copied');

    expect(shareSpy).toHaveBeenCalledWith({
      message: employeeMenuUrl('tok-1'),
      url: employeeMenuUrl('tok-1'),
    });
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing is unavailable', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('not supported'));

    await shareEmployeeLink('tok-1', 'Link copied');

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(employeeMenuUrl('tok-1'));
    expect(notify).toHaveBeenCalledWith('Link copied', employeeMenuUrl('tok-1'));
  });
});

import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { notify } from '@/lib/confirm';

/**
 * The employee's public cooking page. Served from the Cloudflare proxy:
 * supabase.co refuses to render HTML to unauthenticated browsers
 * (anti-phishing rewrite). The token in the URL is the credential.
 */
export function employeeMenuUrl(shareToken: string): string {
  return `https://mealy-menu.mealy-rubenanlo.workers.dev/?token=${shareToken}`;
}

/**
 * Share the link via the system sheet; where none exists (desktop web),
 * copy it and say so. `copiedTitle` is the localized "Link copied" notice.
 */
export async function shareEmployeeLink(shareToken: string, copiedTitle: string): Promise<void> {
  const url = employeeMenuUrl(shareToken);
  try {
    await Share.share({ message: url, url });
  } catch {
    await Clipboard.setStringAsync(url);
    notify(copiedTitle, url);
  }
}

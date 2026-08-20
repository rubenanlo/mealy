import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

// Web entry point: '/' must match a real route. Forward to wherever the
// auth state says the user belongs; native keeps the same behavior.
export default function Index() {
  const { session, membership } = useAuth();

  const restoring = session === undefined || (!!session && membership === undefined);
  if (restoring) return null;

  if (!session) return <Redirect href="/sign-in" />;
  if (!membership) return <Redirect href="/no-access" />;
  return <Redirect href="/library" />;
}

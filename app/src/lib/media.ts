import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

const cache = new Map<string, string>();

/**
 * Resolve a recipe image reference to a displayable URL.
 * Remote https URLs (Phase 1 stores them directly) pass through;
 * storage paths get a 1-hour signed URL on the private 'recipe-media' bucket.
 */
export async function resolveImageUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cached = cache.get(path);
  if (cached) return cached;
  const { data, error } = await supabase.storage.from('recipe-media').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  cache.set(path, data.signedUrl);
  return data.signedUrl;
}

export function useImageUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(
    path && path.startsWith('http') ? path : null
  );
  useEffect(() => {
    let cancelled = false;
    resolveImageUrl(path).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

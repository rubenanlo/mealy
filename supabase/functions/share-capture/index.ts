// iPhone share sheet → Mealy, with no native share extension (which would
// need a paid Apple Developer account). An iOS Shortcut that appears in the
// share sheet POSTs {key, url} here; we queue an ordinary capture_jobs row
// for the key's owner and ping the worker, exactly like the app's
// createCaptureJob (app/src/lib/capture-jobs.ts). If the ping fails the job
// stays pending and the app re-pings it next time the library opens.
//
// Deployed with verify_jwt: false — the personal share key in the body is
// the credential (see migration 0032_share_capture_keys.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

const WORKER_URL = 'https://mealy-worker.fly.dev';
const SOCIAL_HOSTS = ['instagram.com', 'tiktok.com'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Plain-text replies: the Shortcut shows them as-is in a notification.
const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Mirrors extractCaptureUrl/detectCaptureKind in app/src/lib/worker.ts. */
function payload(input: string): { kind: 'url' | 'social' | 'text'; input: string } | null {
  const match = input.match(/https?:\/\/\S+/i);
  if (match && input.replace(match[0], '').trim().length <= 24) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase();
      const social = SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
      return { kind: social ? 'social' : 'url', input: match[0] };
    } catch {
      return null;
    }
  }
  // Shared text (e.g. a selection from Notes) is a recipe if it is long enough.
  const trimmed = input.trim();
  return trimmed.length >= 40 ? { kind: 'text', input: trimmed } : null;
}

/**
 * The worker's /jobs/run wants the caller's own Supabase access token. Mint a
 * short-lived session for the key's owner (admin magic link, verified
 * server-side, never emailed), ping, then revoke that session.
 */
async function pingWorker(url: string, anonKey: string, admin: ReturnType<typeof createClient>, userId: string, jobId: string) {
  try {
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const email = userData.user?.email;
    if (!email) return;
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError || !link.properties?.hashed_token) return;
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: verified } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    });
    const token = verified.session?.access_token;
    if (!token) return;
    try {
      await fetch(`${WORKER_URL}/jobs/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
    } finally {
      await anon.auth.signOut({ scope: 'local' });
    }
  } catch (err) {
    console.error('share-capture: worker ping failed', err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text(405, 'Use POST');

  let key = '';
  let input = '';
  try {
    const body = await req.json();
    key = String(body.key ?? '').trim();
    input = String(body.url ?? body.input ?? '');
  } catch {
    return text(400, 'Mealy: could not read what was shared.');
  }
  if (!UUID_RE.test(key)) return text(401, 'Mealy: the share key in this Shortcut is missing or wrong.');
  const job = payload(input);
  if (!job) return text(400, 'Mealy: share a recipe link (or recipe text).');

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: owner } = await admin
    .from('share_capture_keys')
    .select('user_id')
    .eq('token', key)
    .maybeSingle();
  if (!owner) return text(401, 'Mealy: this share key is no longer valid. Copy a new one from Settings.');

  const { data: membership } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', owner.user_id)
    .limit(1)
    .maybeSingle();
  if (!membership) return text(403, 'Mealy: your account has no family yet.');

  const { data: row, error } = await admin
    .from('capture_jobs')
    .insert({
      household_id: membership.household_id,
      created_by: owner.user_id,
      kind: job.kind,
      input: job.input,
    })
    .select('id')
    .single();
  if (error || !row) return text(500, 'Mealy: could not queue the import. Try again.');

  // Answer the Shortcut right away; the worker ping (which may wake a
  // suspended Fly machine) finishes in the background.
  const ping = pingWorker(url, Deno.env.get('SUPABASE_ANON_KEY')!, admin, owner.user_id, row.id);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(ping);
  else await ping;

  return text(200, 'Added to Mealy. Importing now.');
});

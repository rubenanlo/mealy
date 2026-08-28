// Send the invitation email for a pending family invite via Supabase Auth's
// built-in inviteUserByEmail. Guarded: the caller must be signed in, and the
// email must already have a pending invite row in the caller's own household,
// so this can never be used to email arbitrary addresses. Creating the auth
// user fires handle_new_user, which attaches the membership and consumes the
// invite row immediately.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Browser clients (app.rawdev.link) send a CORS preflight; native apps skip
// it. Auth still comes from the JWT, so a wildcard origin is safe here.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  let email = '';
  try {
    const body = await req.json();
    email = String(body.email ?? '').trim().toLowerCase();
  } catch {
    return json(400, { error: 'invalid body' });
  }
  if (!email.includes('@')) return json(400, { error: 'invalid email' });

  const url = Deno.env.get('SUPABASE_URL')!;
  // Caller identity from the forwarded JWT (verify_jwt already checked it).
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json(401, { error: 'not signed in' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: invite } = await admin
    .from('invites')
    .select('household_id')
    .eq('email', email)
    .maybeSingle();
  if (!invite) return json(404, { error: 'no pending invite for this email' });

  const { data: membership } = await admin
    .from('household_members')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('household_id', invite.household_id)
    .maybeSingle();
  if (!membership) return json(403, { error: 'not a member of this household' });

  // Lands on the worker's set-your-password page (must be in the Auth
  // redirect allowlist, else Supabase falls back to the Site URL).
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://mealy-menu.mealy-rubenanlo.workers.dev/invite',
  });
  if (error) {
    // Already-registered users need no email: their next sign-in claims the invite.
    const already = /already/i.test(error.message);
    return json(already ? 200 : 502, {
      sent: false,
      reason: already ? 'already_registered' : error.message,
    });
  }
  return json(200, { sent: true });
});

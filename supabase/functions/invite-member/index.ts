// Send the invitation email for a pending family invite via Supabase Auth's
// built-in inviteUserByEmail. Guarded: the caller must be signed in, and the
// email must already have a pending invite row in the caller's own household,
// so this can never be used to email arbitrary addresses. Creating the auth
// user fires handle_new_user, which attaches the membership and consumes the
// invite row immediately.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
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

  const { error } = await admin.auth.admin.inviteUserByEmail(email);
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

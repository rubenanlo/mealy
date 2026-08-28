// Owner-only: delete a family member's account entirely. The caller must be
// the owner of the household the target belongs to; the target must be a
// plain member (never an owner, never the caller). Deleting the auth user
// cascades the membership row; recipes/plans they added stay with the
// household. Requires the service role; the caller is identified from JWT.
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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const body = await req.json().catch(() => ({}));
  const targetId = body?.user_id;
  if (typeof targetId !== 'string' || !targetId) {
    return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const caller = userData.user.id;
  if (targetId === caller) {
    return new Response(JSON.stringify({ error: 'cannot remove yourself' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: me } = await admin
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', caller)
    .maybeSingle();
  if (!me || me.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'only the owner can remove members' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: target } = await admin
    .from('household_members')
    .select('role, email')
    .eq('household_id', me.household_id)
    .eq('user_id', targetId)
    .maybeSingle();
  if (!target) {
    return new Response(JSON.stringify({ error: 'not a member of your household' }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (target.role === 'owner') {
    return new Response(JSON.stringify({ error: 'cannot remove an owner' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (target.email) {
    await admin.from('invites').delete().eq('household_id', me.household_id).eq('email', target.email);
  }
  // Cascades the household_members row (user_id references auth.users).
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});

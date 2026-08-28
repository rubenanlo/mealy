// Deletes the calling user's account. If they are the last member of their
// household, the household is deleted first (cascading recipes, plans, etc.).
// Requires the service role; the caller is identified from their JWT.
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

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const uid = userData.user.id;

  const { data: membership } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', uid)
    .maybeSingle();

  if (membership) {
    const { count } = await admin
      .from('household_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('household_id', membership.household_id);
    if ((count ?? 0) <= 1) {
      const { error } = await admin.from('households').delete().eq('id', membership.household_id);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});

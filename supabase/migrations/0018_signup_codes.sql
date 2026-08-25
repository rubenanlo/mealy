-- 0018: admin-gated signup codes. A single app admin issues single-use, expiring
-- codes; redeeming one lets a new person create their own family. Open self-signup
-- is closed: handle_new_user now rejects any account that is neither an invited
-- member email nor a valid code. Email-invites for members are unchanged.
-- Spec: docs/superpowers/specs/2026-08-25-signup-codes-design.md

-- The single global gatekeeper identity. Seeded with the app owner's account.
create table app_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table app_admins enable row level security;

-- Seed the app owner. Confirm this matches the real login before deploying.
insert into app_admins (user_id)
select id from auth.users where lower(email) = lower('ruben.raw.dev@gmail.com')
on conflict do nothing;

create table signup_codes (
  code        text primary key,
  created_by  uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users on delete set null
);
alter table signup_codes enable row level security;

-- Is the caller the app admin? Security definer so it bypasses app_admins RLS.
create or replace function is_app_admin() returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from app_admins where user_id = auth.uid()) $$;

-- Admins may read and revoke codes; a user may see their own admin row.
create policy app_admins_self on app_admins for select
  using (user_id = auth.uid());
create policy signup_codes_admin on signup_codes for all
  using (is_app_admin());

-- Mint a single-use code (admin only). Returns the human-readable code.
create or replace function create_signup_code(expires_in interval default '7 days')
returns text
language plpgsql security definer set search_path = public as $$
declare new_code text;
begin
  if not is_app_admin() then
    raise exception 'not authorized';
  end if;
  loop
    -- Hex avoids the ambiguous 0/O and 1/I letter pairs.
    new_code := 'MEALY-' || upper(encode(gen_random_bytes(2), 'hex'))
             || '-' || upper(encode(gen_random_bytes(2), 'hex'));
    exit when not exists (select 1 from signup_codes where code = new_code);
  end loop;
  insert into signup_codes(code, created_by, expires_at)
  values (new_code, auth.uid(), now() + expires_in);
  return new_code;
end $$;

-- Read-only check for the sign-up screen. Callable pre-auth (anon). The real
-- enforcement is the redemption in handle_new_user; this is only for UX feedback.
create or replace function validate_signup_code(p_code text) returns text
language plpgsql security definer stable set search_path = public as $$
declare rec signup_codes%rowtype;
begin
  select * into rec from signup_codes where code = p_code;
  if not found then return 'invalid'; end if;
  if rec.redeemed_at is not null then return 'used'; end if;
  if rec.expires_at <= now() then return 'expired'; end if;
  return 'valid';
end $$;

-- Gate account creation. Allow invited member emails (existing behavior) and
-- valid codes; reject everything else so no one can self-signup.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv invites%rowtype;
  code_text text := new.raw_user_meta_data->>'signup_code';
  redeemed int;
begin
  -- 1. Invited member: attach to their household, consume the invite.
  select * into inv from invites where lower(email) = lower(new.email);
  if found then
    insert into household_members(user_id, household_id, person_id, role, email)
    values (new.id, inv.household_id, inv.person_id, inv.role, new.email);
    delete from invites where lower(email) = lower(new.email);
    return new;
  end if;

  -- 2. Signup code: redeem atomically; the redeemer will create their own family.
  if code_text is not null then
    update signup_codes
       set redeemed_at = now(), redeemed_by = new.id
     where code = code_text and redeemed_at is null and expires_at > now();
    get diagnostics redeemed = row_count;
    if redeemed = 1 then
      return new;
    end if;
  end if;

  -- 3. No invite, no valid code: signup is closed.
  raise exception 'signup requires an invitation or a valid code';
end $$;

revoke all on function is_app_admin() from public;
grant execute on function is_app_admin() to authenticated;
revoke all on function create_signup_code(interval) from public;
grant execute on function create_signup_code(interval) to authenticated;
revoke all on function validate_signup_code(text) from public;
grant execute on function validate_signup_code(text) to anon, authenticated;

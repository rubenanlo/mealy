-- 0005: open family signup — member emails, create_family / claim_invites RPCs,
-- invite rows deleted once claimed (spec: docs/superpowers/specs/2026-08-22-family-signup-design.md)

alter table household_members add column email text;

-- Backfill from auth so the Family screen can show existing members.
update household_members hm
   set email = u.email
  from auth.users u
 where u.id = hm.user_id and hm.email is null;

-- Trigger now also records the email and consumes the invite.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  if found then
    insert into household_members(user_id, household_id, person_id, role, email)
    values (new.id, inv.household_id, inv.person_id, inv.role, new.email);
    delete from invites where lower(email) = lower(new.email);
  end if;
  return new;
end $$;

-- Self-signup: create a household and become its owner, atomically.
-- Security definer because RLS forbids inserting a household you are not yet a member of.
create or replace function create_family(family_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  user_email text;
  new_household uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from household_members where user_id = uid) then
    raise exception 'already in a family';
  end if;
  if coalesce(trim(family_name), '') = '' then
    raise exception 'family name required';
  end if;
  select email into user_email from auth.users where id = uid;
  insert into households(name) values (trim(family_name)) returning id into new_household;
  insert into household_members(user_id, household_id, role, email)
  values (uid, new_household, 'owner', user_email);
  return new_household;
end $$;

-- Reverse-order invites: user signed up first, was invited later.
-- Idempotent: returns the current household when already a member, null when nothing to claim.
create or replace function claim_invites() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  user_email text;
  inv invites%rowtype;
  existing uuid;
begin
  if uid is null then
    return null;
  end if;
  select household_id into existing from household_members where user_id = uid;
  if found then
    return existing;
  end if;
  select email into user_email from auth.users where id = uid;
  select * into inv from invites where lower(email) = lower(user_email);
  if not found then
    return null;
  end if;
  insert into household_members(user_id, household_id, person_id, role, email)
  values (uid, inv.household_id, inv.person_id, inv.role, user_email);
  delete from invites where lower(email) = lower(user_email);
  return inv.household_id;
end $$;

revoke all on function create_family(text) from public;
grant execute on function create_family(text) to authenticated;
revoke all on function claim_invites() from public;
grant execute on function claim_invites() to authenticated;

-- The policy has always covered every household member, not just owners; name it honestly.
alter policy invites_owner on invites rename to invites_members;

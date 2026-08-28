-- Revoke a member account's household access. household_members has no
-- delete policy (members_self is select-only), so removing a person left the
-- linked login as a lingering full member with no way to remove it from the
-- app. Owner-only, cannot target yourself, and cannot remove another owner.

create or replace function remove_household_member(target_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  hh uuid;
begin
  select household_id into hh
    from household_members
    where user_id = auth.uid() and role = 'owner'
    limit 1;
  if hh is null then
    raise exception 'only the household owner can remove members';
  end if;
  if target_user = auth.uid() then
    raise exception 'you cannot remove your own account';
  end if;
  delete from household_members
    where household_id = hh and user_id = target_user and role = 'member';
end;
$$;

revoke all on function remove_household_member(uuid) from public;
grant execute on function remove_household_member(uuid) to authenticated;

-- iPhone share-sheet capture without a native share extension: an iOS
-- Shortcut posts the shared URL plus the user's personal key to the
-- share-capture edge function, which queues a normal capture_jobs row.
-- The key is the only credential the Shortcut holds, so it is per user,
-- unguessable, and can be rotated from Settings.

create table share_capture_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Only the security-definer functions below and the service role touch it.
alter table share_capture_keys enable row level security;

-- Get (or lazily create) the caller's key.
create or replace function my_share_capture_key() returns uuid
language plpgsql security definer set search_path = public as
$$
declare k uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into share_capture_keys (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
  select token into k from share_capture_keys where user_id = auth.uid();
  return k;
end
$$;

-- Replace the caller's key (the old Shortcut stops working).
create or replace function rotate_share_capture_key() returns uuid
language plpgsql security definer set search_path = public as
$$
declare k uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into share_capture_keys (user_id) values (auth.uid())
    on conflict (user_id) do update set token = gen_random_uuid(), created_at = now()
    returning token into k;
  return k;
end
$$;

revoke all on function my_share_capture_key() from public, anon;
revoke all on function rotate_share_capture_key() from public, anon;
grant execute on function my_share_capture_key() to authenticated;
grant execute on function rotate_share_capture_key() to authenticated;

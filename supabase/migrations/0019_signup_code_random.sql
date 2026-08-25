-- 0019: fix create_signup_code. 0018 used gen_random_bytes (pgcrypto), which is
-- not on the function's search_path, so code generation failed at call time.
-- Use gen_random_uuid (core, already the default for uuid PKs) for the randomness.

create or replace function create_signup_code(expires_in interval default '7 days')
returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  hex text;
begin
  if not is_app_admin() then
    raise exception 'not authorized';
  end if;
  loop
    hex := replace(gen_random_uuid()::text, '-', '');
    -- Hex avoids the ambiguous 0/O and 1/I letter pairs.
    new_code := 'MEALY-' || upper(substr(hex, 1, 4)) || '-' || upper(substr(hex, 5, 4));
    exit when not exists (select 1 from signup_codes where code = new_code);
  end loop;
  insert into signup_codes(code, created_by, expires_at)
  values (new_code, auth.uid(), now() + expires_in);
  return new_code;
end $$;

-- 0020: correct the app admin. 0018 seeded ruben.raw.dev@gmail.com, but the app
-- owner's login is rubenanlo@gmail.com (ruben.raw.dev is only a family member).
-- Make the admin set exactly {rubenanlo@gmail.com} so only the owner can mint codes.

delete from app_admins;
insert into app_admins (user_id)
select id from auth.users where lower(email) = lower('rubenanlo@gmail.com')
on conflict do nothing;

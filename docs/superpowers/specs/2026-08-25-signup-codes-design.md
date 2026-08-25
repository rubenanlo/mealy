# Signup codes — admin-gated family creation

Status: approved (design), pending implementation
Date: 2026-08-25
Related: `2026-08-22-family-signup-design.md` (the existing email-invite + create_family flow this builds on)

## Problem

The auth screen (`app/src/app/(auth)/sign-in.tsx`) only presents a "Sign in" path.
Because `signInWithOtp` and `signInWithIdToken` auto-provision an `auth.users` row on
first successful verification, **anyone with any email can currently create an account and
then a family** via onboarding. Mealy is a private planner for the household and a small
circle of family and friends, so open self-signup is wrong.

We want a **Sign up** path gated behind an **admin-generated code**: a new person enters a
code the admin gave them out-of-band, then their email, and only then can they create their
own new family.

The admin (the app owner, a single global gatekeeper) has **full control over who starts a
new family**. A person who wants in contacts the admin; the admin sends a code; they sign up
as a family owner. From there, that family owner adds their own household members through the
existing email-invite flow — the admin does not gate individual members, only new families.

## Decisions (locked)

- **What the code does:** it is an *access gate*, not a link to the admin's household.
  Redeeming a code lets the person create their **own new family** (they become `owner` of a
  fresh household via the existing `create_family` RPC). It does not add them to the admin's
  household.
- **Coexistence:** the existing email-invite flow (owner types an invitee's email in Settings,
  `handle_new_user`/`claim_invites` links them as a `member`) stays. Codes are an additional
  path, not a replacement.
- **Auth method:** reuse the existing passwordless email OTP flow. No password surface added.
- **Code lifecycle:** single-use, with an expiry (default 7 days).
- **Who generates codes:** the **app admin** only — a single global gatekeeper identity, not
  every household owner. A family owner cannot mint codes; they can only invite members to
  their own household. The admin is identified by an `app_admins` table seeded with the app
  owner's account.
- **Enforcement:** genuinely close open signup. The gate is enforced server-side in the
  `handle_new_user` trigger, not merely client-side.

## Architecture

Three layers, each independently testable.

### 1. Database (`supabase/migrations/0018_signup_codes.sql`, append-only)

New tables:

```sql
-- The single global gatekeeper identity. Seeded with the app owner's account.
create table app_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table app_admins enable row level security;
-- Seed the app owner (confirm the email against the real account at implementation time).
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
```

A code is **usable** when `redeemed_at is null and expires_at > now()`.

Admin helper:

- `is_app_admin() returns boolean` — SECURITY DEFINER, returns whether `auth.uid()` is in
  `app_admins`. Granted to `authenticated`. Used by RLS, by `create_signup_code`, and called
  by the app to decide whether to render the admin UI.

RLS: an admin (`is_app_admin()`) may `select`/`delete` (revoke) `signup_codes` rows. Non-admins
have no access. `app_admins` is admin-select-only. Inserts and redemption go through SECURITY
DEFINER functions, so no broad insert policy is needed.

RPCs:

- `create_signup_code(expires_in interval default '7 days') returns text`
  SECURITY DEFINER. Requires `is_app_admin()` (else raise). Generates a short readable,
  collision-checked code — format `MEALY-XXXX-XXXX` from an unambiguous base32 alphabet (no
  `0/O/1/I`). Inserts the row, returns the code. Granted to `authenticated` (the function
  itself enforces admin-only).

- `validate_signup_code(p_code text) returns text`
  SECURITY DEFINER, read-only. Returns `'valid' | 'expired' | 'used' | 'invalid'`.
  Granted to **`anon`** (the person is not authenticated at the code-entry step) and
  `authenticated`. Purely for immediate UX feedback; the trigger below is the real
  enforcement, so this function never mutates.

Extend the existing trigger function:

- `handle_new_user()` — current logic (link membership when email matches an `invites` row,
  delete the invite) is kept, wrapped in a new gate:
  1. Email matches an `invites` row → link membership + delete invite → **allow**.
  2. Else a code is present in `new.raw_user_meta_data->>'signup_code'` and is usable →
     atomically mark it redeemed (`update ... where code = ... and redeemed_at is null and
     expires_at > now()`, requiring exactly one row affected) → **allow** (no membership;
     they will onboard).
  3. Else → `raise exception` → the `auth.users` insert rolls back and no account is created.

  `claim_invites()` is left as-is; with the gate in place the "signed up first, invited
  later" scenario can no longer occur, but the function stays as a harmless idempotent no-op.

### 2. Sign-up screen (`app/src/app/(auth)/sign-up.tsx`, new)

A step machine mirroring `sign-in.tsx` (`'code' | 'email' | 'verify'`), reusing the shared
`Field`/`Button` components:

- **code** — text input for the code → on continue, call `validate_signup_code`. Non-`valid`
  results show inline copy ("That code is invalid or expired" / "already used"); only `valid`
  advances.
- **email** — email input → `supabase.auth.signInWithOtp({ email, options: { data: { signup_code: code } } })`.
  The code rides along in user metadata so the trigger can read it.
- **verify** — 6-digit OTP → `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
  A trigger rejection surfaces as a generic Supabase "database error"; map any error at this
  step (and at the send-OTP step) to "That code is invalid or expired." On success the
  `AuthProvider` picks up the session; the user has no household, so the existing `RootStack`
  guard routes them to `onboarding.tsx` to create their family. No routing changes beyond
  registering the new screen.

`RootStack` (`app/src/app/_layout.tsx`): register `(auth)/sign-up` under the existing
`guard={!signedIn}` block. `sign-in.tsx`: add a footer button — "Have a signup code? Create
your family" — routing to `/sign-up`. The web entry `index.tsx` needs no change (sign-up is
reached from sign-in, not by redirect).

### 3. Admin code UI (`app/src/app/settings/account.tsx`)

Alongside the existing invites section, add a **"Signup codes"** section that renders **only
for the app admin**. Gate it on `supabase.rpc('is_app_admin')` (resolved once on load); the
section is entirely absent for everyone else.

- *Generate code* button → `supabase.rpc('create_signup_code')` → show the returned code with
  a copy affordance.
- List of all `signup_codes` with status derived client-side (active / expired / redeemed) and
  the expiry date (RLS already restricts visibility to the admin).
- Revoke → `supabase.from('signup_codes').delete().eq('code', code)`.

## Data flow (happy path)

1. Admin → Settings → Generate code → gets `MEALY-7QK4-2XPD`, shares it out-of-band.
2. New person → Sign in screen → "Have a signup code?" → Sign-up screen.
3. Code step → `validate_signup_code` returns `valid` → advance.
4. Email step → `signInWithOtp` with `{ data: { signup_code } }` → OTP emailed.
5. Verify step → `verifyOtp` → `handle_new_user` sees the code, redeems it, allows the user.
6. No household → onboarding → `create_family` → owner of a new household → tabs.

## Error handling

- Invalid/expired/used code at the code step: caught by `validate_signup_code`, inline copy,
  no advance.
- Race (code redeemed between validate and verify): the trigger's conditional `update`
  affects zero rows → gate raises → mapped to "That code is invalid or expired" at the verify
  step. Rare for single-use codes handed to one person.
- Non-admin calls `create_signup_code`: RPC raises; surfaced as an alert (and the UI is hidden
  from non-admins anyway).
- Abandoned signup after redemption: the code is spent but the (unconfirmed) user can still
  complete `verifyOtp` later without re-triggering the gate. If truly abandoned, the admin
  generates a new code. Accepted minor limitation.

## Testing

- **Component:** `app/src/app/(auth)/__tests__/sign-up.test.tsx`, mirroring the existing
  `sign-in.test.tsx` — mock `supabase.rpc('validate_signup_code')`, `signInWithOtp`,
  `verifyOtp`; cover valid/invalid code, step advancement, and error mapping.
- **DB:** no DB test harness exists in the repo, so the migration is verified manually against
  Supabase with explicit steps (create code as the admin; non-admin calling
  `create_signup_code` is rejected; validate as anon; sign up with a valid code → account +
  onboarding; sign up with an invalid code → rejected; sign up with an un-invited/un-coded
  email → rejected; existing member sign-in still works; email-invite flow for members still
  works). These steps go in the implementation plan.

## Out of scope

- Passwords / password signup.
- Codes that add the redeemer to the admin's household (explicitly decided against).
- Multi-use / reusable codes.
- Admin-gating individual family members — family owners add members freely via email invites;
  the admin only gates who starts a new family.
- A UI for managing the `app_admins` set — it is seeded in the migration; adding/removing
  admins later is a manual DB operation.

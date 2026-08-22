# Family Signup & Membership — Design

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Scope:** Sub-project 1 of 2. This spec covers open self-signup (email OTP + Google + Apple), "create your family" onboarding, and invite management. Sub-project 2 — the employee token web page (main spec §10) and recipe/meal assignment UI — gets its own spec later and is explicitly out of scope here.

## 1. Goals

- Anyone can sign up and create a **family** (a `households` row — "family" is the product word, `household` stays the schema word).
- Sign-in/sign-up methods: **email OTP** (existing), **Google**, and **Apple** — all via Supabase Auth.
- A family member can **invite others by email**; invitees join the same family with full content access.
- All family members are equal: any member can invite, revoke invites, and edit family settings. The `owner` role remains on the schema (creator gets it) but grants nothing extra for now.
- The **employee is not an app user.** She will access assigned recipes through a revocable token web link (sub-project 2). No `employee` value is added to `household_members.role`.

## 2. Current state (what already exists)

- Supabase Auth with email OTP sign-in (`app/src/app/(auth)/sign-in.tsx`); signups disabled at the project level (invite-only).
- `households`, `household_members` (PK `user_id` → one family per user, `role` owner|member), `invites` (PK `email`), all RLS-scoped via `my_household_ids()` (`supabase/migrations/0001_core.sql`).
- `handle_new_user()` trigger: on `auth.users` insert, matches an invite by email and creates the membership automatically.
- Routing guards in `app/src/app/_layout.tsx`: signed-out → sign-in; signed-in without membership → `no-access.tsx` (dead end); with membership → tabs.
- `invites_owner` RLS policy already allows **all** household members (it checks `my_household_ids()`, not role), matching the "everyone can manage" decision. No change needed; rename is optional cleanup.

## 3. Auth methods

### 3.1 Email OTP (signup-capable)
`signInWithOtp({ email })` already creates users when the project-level "allow signups" setting is on. **Config change:** enable signups in the Supabase Auth settings. No client code change for OTP beyond copy ("Sign in or create account").

### 3.2 Apple
Native flow: `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })`. Requires the Sign in with Apple capability (Xcode/App Store Connect) and enabling the Apple provider in Supabase. **The Apple button ships behind a runtime availability check and stays hidden until signing/capability setup is complete** (currently blocked on the pending Xcode signing work).

### 3.3 Google
Native flow: `@react-native-google-signin/google-signin` → `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. Requires iOS + web OAuth client IDs in Google Cloud Console, configured in the Supabase Google provider and in `app.json` (URL scheme). Requires a dev build (not Expo Go).

Both providers return a verified email, so the invite-matching trigger works identically for OAuth users. Supabase's default identity-linking rules apply (same verified email links to the same user).

## 4. Signup & onboarding flow

```
Welcome screen (replaces sign-in screen)
  ├─ email → OTP code → session
  ├─ Continue with Google → session
  └─ Continue with Apple → session (hidden until capability ready)
        │
        ▼
  has membership? ──yes──► (tabs) app
        │ no
        ▼  (app calls claim_invites() first — see §5.2)
  Onboarding screen (replaces no-access dead end)
  ├─ "Create your family" → name input → create_family(name) → (tabs)
  └─ "Been invited? Ask a family member to invite <your@email>,
      then pull to refresh." (refresh re-runs claim_invites)
```

- The welcome screen is the existing `(auth)/sign-in.tsx` restyled: email OTP path unchanged, plus provider buttons. The email+password path remains as a secondary option for existing password users.
- `no-access.tsx` is replaced by `onboarding.tsx` (same route slot in `_layout.tsx` guards: signed-in + no membership).
- One family per user is kept (schema already enforces it via PK).

## 5. Database changes (migration `0005_signup.sql`)

### 5.1 `create_family(family_name text) returns uuid`
`security definer` function: inserts the `households` row and the caller's `household_members` row (`role = 'owner'`) in one transaction; refuses if the caller already has a membership. Security definer is required because RLS makes it impossible to insert a household you are not yet a member of.

### 5.2 `claim_invites() returns uuid`
`security definer` function: looks up `invites` by the caller's email (`auth.users.email` for `auth.uid()`); if found and the caller has no membership, creates the membership (copying `person_id` and `role` from the invite), deletes the invite row, and returns the household id. Covers the order the existing trigger cannot: user signs up first, gets invited later. The app calls it whenever a session exists but no membership does.

### 5.3 Member email visibility
Add `email text` to `household_members`, populated by `create_family`, `claim_invites`, and the `handle_new_user` trigger from the auth email. Needed because clients cannot read `auth.users`, and the Family screen must show who each member is. Backfill existing rows in the migration (from `auth.users`).

### 5.4 Invite lifecycle
- `handle_new_user()` gains `delete from invites where email = new.email` after a successful claim (today claimed invites linger forever).
- `invites` policy already covers all members; optionally rename `invites_owner` → `invites_members` for clarity.

## 6. App changes

| Surface | Change |
|---|---|
| `(auth)/sign-in.tsx` | Restyle as welcome screen; add Google + Apple buttons (Apple behind availability flag); copy covers both sign-in and sign-up. |
| `no-access.tsx` → `onboarding.tsx` | Create-family form (name → `create_family` RPC) + invited-user guidance with refresh. |
| `_layout.tsx` | Point the no-membership guard at onboarding; after `create_family`/`claim_invites` succeeds, re-resolve membership (existing `AuthProvider` refresh path). |
| `lib/auth.tsx` | On session-without-membership, call `claim_invites()` before concluding "no membership"; expose a `refreshMembership()` used by onboarding. |
| Settings → new **Family** section | List members (email + role badge for owner), list pending invites, "Invite by email" input (inserts into `invites`), revoke pending invite (delete row). Members cannot be removed in v1 (YAGNI; revisit with employee work). |

No changes to the worker, recipes, planning, or storage.

## 7. Error handling

- `create_family` when a membership already exists → RPC raises; client refreshes membership (covers double-tap and the invited-meanwhile race).
- `claim_invites` with no invite → returns null; onboarding stays put.
- Inviting an email that already has a pending invite (any family) → `invites` PK violation; UI shows "already invited". Inviting someone who already belongs to a family isn't blocked at insert time, but `claim_invites` and the trigger no-op when a membership exists, so the invite is inert; acceptable for v1.
- OAuth cancel/failed token → stay on welcome screen with a toast; no partial session.
- Apple capability missing at runtime → button simply not rendered.

## 8. Testing

- **Migration/RLS (SQL):** `create_family` creates exactly one household + owner membership and rejects a second call; `claim_invites` claims and deletes the invite, no-ops without one; a member of family A cannot read family B's invites/members; `email` backfill correct.
- **App (manual, per `/verify`):** fresh email OTP signup → create family → lands in tabs; second device invited by email → signs up → auto-joins (trigger path); existing user invited later → onboarding refresh joins (claim path); Google signup on a dev build; invite list add/revoke.
- Apple flow verified once signing/capability lands (tracked as follow-up).

## 9. Config checklist (not code)

1. Supabase Auth: enable signups; enable Google + Apple providers.
2. Google Cloud Console: iOS + web OAuth client IDs.
3. App Store Connect / Xcode: Sign in with Apple capability (blocked on pending signing setup).
4. New dev build (native modules for Google/Apple sign-in).

## 10. Out of scope (sub-project 2: employee access)

Employee token link per main spec §10: share-token table, revocation, server-rendered Spanish page (hosting choice: FastAPI worker with a service-role key vs. Supabase Edge Function — decided in that spec), and the UI for assigning recipes/meals to the employee. Nothing in this migration blocks or presupposes that design.

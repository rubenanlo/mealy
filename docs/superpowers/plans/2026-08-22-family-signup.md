# Family Signup & Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open self-signup (email OTP + Google + Apple), a "create your family" onboarding screen, invite claiming in both directions, and a Family management screen in Settings.

**Architecture:** Supabase Auth remains the identity system; a new migration adds two `security definer` RPCs (`create_family`, `claim_invites`) and an `email` column on `household_members`. The Expo app gains a `lib/membership.ts` (membership resolution + RPC wrappers), a `lib/social-auth.ts` (lazy-loaded native Apple/Google token sign-in that degrades gracefully in Expo Go), a restyled welcome screen, an onboarding screen replacing the `no-access` dead end, and a `settings/family` screen.

**Tech Stack:** Expo SDK 54 / expo-router 6 / React Native 0.81, `@supabase/supabase-js`, Supabase Postgres + RLS, jest-expo + @testing-library/react-native. Migrations applied to the live project via Supabase MCP.

**Spec:** `docs/superpowers/specs/2026-08-22-family-signup-design.md`

## Global Constraints

- Expo SDK is **pinned to 54** for Expo Go compatibility (`app/AGENTS.md`). The app must still boot in Expo Go: never statically import `@react-native-google-signin/google-signin` from screen code — only via the guarded `require()` in `lib/social-auth.ts`.
- Supabase project id: `fcqtywqwhddlyirhwbzq` (eu-west-3). Migrations are applied via the Supabase MCP `apply_migration` tool AND saved verbatim to `supabase/migrations/` in the repo.
- Commits go straight to `main` (Ruben's stated workflow). Commits are signed via 1Password's SSH agent; if `git commit` fails with `1Password: failed to fill whole buffer`, pause and ask Ruben to unlock 1Password, then retry — do not bypass signing.
- Product copy says **family**; schema/code identifiers keep **household**.
- All members are equal in the UI. `owner` is assigned to the family creator but grants nothing extra.
- Run app commands from `app/`: `npm run typecheck`, `npm test`.
- Email matching for invites is case-insensitive (`lower()` on both sides).

---

### Task 1: Migration `0005_signup.sql` — RPCs, member email, invite lifecycle

**Files:**
- Create: `supabase/migrations/0005_signup.sql`

**Interfaces:**
- Produces (used by later tasks via `supabase.rpc`):
  - `create_family(family_name text) returns uuid` — creates household + caller's `owner` membership; raises `already in a family` / `not authenticated`.
  - `claim_invites() returns uuid` — claims a pending invite for the caller's email; returns the household id, or `null` when there is nothing to claim; returns the existing household id if the caller already has a membership.
  - `household_members.email text` — displayable email for every membership row.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0005_signup.sql` with exactly:

```sql
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
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` (load via ToolSearch if deferred) with `project_id: fcqtywqwhddlyirhwbzq`, `name: 0005_signup`, and the SQL above verbatim.

- [ ] **Step 3: Verify with a rollback-wrapped SQL test**

Run via `mcp__claude_ai_Supabase__execute_sql` (single call; it must end in `rollback;` so the live project is untouched):

```sql
begin;
-- Two fake auth users (minimal columns; trigger no-ops without an invite).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'mealy-test-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000bb', 'mealy-test-late@example.com');

-- Act as the first user and create a family.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select create_family('Test Family') as created_household \gset
select count(*) = 1 as owner_membership_ok,
       bool_and(role = 'owner' and email = 'mealy-test-owner@example.com') as owner_row_ok
  from household_members where user_id = '00000000-0000-0000-0000-0000000000aa';

-- Second create_family must fail.
do $$ begin
  perform create_family('Second Family');
  raise exception 'should not reach here';
exception when others then
  if sqlerrm <> 'already in a family' then raise; end if;
end $$;

-- Invite the second user (case-mixed email), then claim as them.
insert into invites (email, household_id)
select 'Mealy-Test-LATE@example.com', household_id
  from household_members where user_id = '00000000-0000-0000-0000-0000000000aa';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
select claim_invites() is not null as claim_ok;
select count(*) = 0 as invite_consumed from invites where lower(email) = 'mealy-test-late@example.com';
select claim_invites() is not null as claim_idempotent_ok;  -- second call returns household
rollback;
```

Expected: every `*_ok` column is `true`, and the `do` block raises nothing. If `\gset` is unsupported in the MCP runner, drop that line (nothing depends on the variable).

- [ ] **Step 4: Confirm backfill and column on live schema**

`execute_sql`: `select count(*) as members, count(email) as with_email from household_members;` — the two counts must be equal.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_signup.sql
git commit -m "feat(db): create_family/claim_invites RPCs, member emails, invite consumption"
```

---

### Task 2: `lib/membership.ts` + auth provider integration

**Files:**
- Create: `app/src/lib/membership.ts`
- Create: `app/src/lib/__tests__/membership.test.ts`
- Modify: `app/src/lib/auth.tsx`

**Interfaces:**
- Consumes: Task 1's `create_family` / `claim_invites` RPCs.
- Produces:
  - `membership.ts`: `interface Membership { householdId: string; personId: string | null; role: 'owner' | 'member' }`; `fetchMembership(userId: string): Promise<Membership | null>`; `resolveMembership(userId: string): Promise<Membership | null>` (fetch → claim → re-fetch); `createFamily(name: string): Promise<string>` (throws on RPC error).
  - `auth.tsx`: `AuthState` gains `refreshMembership: () => Promise<void>`; `Membership` type is re-exported so existing imports keep working.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/__tests__/membership.test.ts`:

```ts
import { supabase } from '@/lib/supabase';

import { createFamily, resolveMembership } from '../membership';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function membershipQueryReturning(row: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
  };
}

const ROW = { household_id: 'hh-1', person_id: null, role: 'owner' };

describe('resolveMembership', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the membership without claiming when one exists', async () => {
    mockFrom.mockReturnValue(membershipQueryReturning(ROW));
    const m = await resolveMembership('user-1');
    expect(m).toEqual({ householdId: 'hh-1', personId: null, role: 'owner' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('claims a pending invite and re-fetches when there is no membership', async () => {
    mockFrom
      .mockReturnValueOnce(membershipQueryReturning(null))
      .mockReturnValueOnce(membershipQueryReturning({ ...ROW, role: 'member' }));
    mockRpc.mockResolvedValue({ data: 'hh-1', error: null });
    const m = await resolveMembership('user-1');
    expect(mockRpc).toHaveBeenCalledWith('claim_invites');
    expect(m).toEqual({ householdId: 'hh-1', personId: null, role: 'member' });
  });

  it('returns null when there is no membership and nothing to claim', async () => {
    mockFrom.mockReturnValue(membershipQueryReturning(null));
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(resolveMembership('user-1')).resolves.toBeNull();
  });
});

describe('createFamily', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the new household id', async () => {
    mockRpc.mockResolvedValue({ data: 'hh-9', error: null });
    await expect(createFamily('Andino')).resolves.toBe('hh-9');
    expect(mockRpc).toHaveBeenCalledWith('create_family', { family_name: 'Andino' });
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'already in a family' } });
    await expect(createFamily('Andino')).rejects.toMatchObject({ message: 'already in a family' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/`): `npm test -- membership`
Expected: FAIL — cannot find module `../membership`.

- [ ] **Step 3: Implement `app/src/lib/membership.ts`**

```ts
import { supabase } from '@/lib/supabase';

export interface Membership {
  householdId: string;
  personId: string | null;
  role: 'owner' | 'member';
}

export async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, person_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    householdId: data.household_id as string,
    personId: (data.person_id as string | null) ?? null,
    role: data.role as 'owner' | 'member',
  };
}

/**
 * Membership, claiming a pending invite when none exists yet (the
 * signed-up-before-invited order the DB trigger cannot cover).
 */
export async function resolveMembership(userId: string): Promise<Membership | null> {
  const existing = await fetchMembership(userId);
  if (existing) return existing;
  const { data, error } = await supabase.rpc('claim_invites');
  if (error || !data) return null;
  return fetchMembership(userId);
}

/** Creates the family and the caller's owner membership; returns the household id. */
export async function createFamily(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_family', { family_name: name });
  if (error) throw error;
  return data as string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- membership` — expected PASS.

- [ ] **Step 5: Rewire `auth.tsx`**

In `app/src/lib/auth.tsx`:
1. Delete the local `Membership` interface and local `fetchMembership` (lines 13–17 and 29–41). Replace with:
   ```ts
   import { resolveMembership, type Membership } from '@/lib/membership';

   export type { Membership } from '@/lib/membership';
   ```
2. In `AuthState`, add below `signOut`:
   ```ts
   /** Re-resolve membership (claims pending invites); used by onboarding. */
   refreshMembership: () => Promise<void>;
   ```
3. In the membership effect, replace `fetchMembership(userId).then(...)` with `resolveMembership(userId).then(...)` (same cancellation handling).
4. Add before the `return`:
   ```ts
   const refreshMembership = useCallback(async () => {
     if (!userId) return;
     setMembership(await resolveMembership(userId));
   }, [userId]);
   ```
5. Include `refreshMembership` in the provider value: `value={{ session, membership, signOut, refreshMembership }}`.

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm test` — expected clean. (`useHousehold` consumers are unaffected; the `Membership` shape is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/membership.ts app/src/lib/__tests__/membership.test.ts app/src/lib/auth.tsx
git commit -m "feat(app): membership resolution claims pending invites; refreshMembership"
```

---

### Task 3: `lib/social-auth.ts` — Apple & Google native token sign-in

**Files:**
- Create: `app/src/lib/social-auth.ts`
- Create: `app/src/lib/__tests__/social-auth.test.ts`
- Modify: `app/package.json` (+ lockfile), `app/app.json`

**Interfaces:**
- Produces (consumed by Task 4):
  - `appleAvailable(): Promise<boolean>` — false off-iOS, in Expo Go, or when the capability is missing.
  - `googleAvailable(): boolean` — false when env config or the native module is absent (Expo Go).
  - `signInWithApple(): Promise<{ error: string | null }>` / `signInWithGoogle(): Promise<{ error: string | null }>` — user cancellation returns `{ error: null }` without a session; failures return a user-facing message.
- Env config: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (required for the Google button to appear) and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

- [ ] **Step 1: Install native modules**

Run (from `app/`):
```bash
npx expo install expo-apple-authentication @react-native-google-signin/google-signin
```

- [ ] **Step 2: Configure `app.json`**

In the `expo` object:
1. Add an `ios` section (bundle id is new — flag it to Ruben in the task report; easy to change before the first build):
   ```json
   "ios": {
     "bundleIdentifier": "com.rubenanlo.mealy",
     "usesAppleSignIn": true
   },
   ```
2. Append `"expo-apple-authentication"` to `plugins`. Do NOT add the google-signin config plugin yet — it hard-requires `iosUrlScheme` from a Google OAuth client that doesn't exist yet; it goes in with the config checklist (Task 7) once client IDs exist.

- [ ] **Step 3: Write the failing tests**

Create `app/src/lib/__tests__/social-auth.test.ts`:

```ts
import { signInWithApple, googleAvailable } from '../social-auth';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithIdToken: jest.fn().mockResolvedValue({ error: null }) } },
}));

const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

describe('googleAvailable', () => {
  it('is false when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not configured', () => {
    // jest.setup.js does not define it; the native module is also absent in tests.
    expect(googleAvailable()).toBe(false);
  });
});

describe('signInWithApple', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges the identity token with Supabase', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'tok' });
    await expect(signInWithApple()).resolves.toEqual({ error: null });
    const { supabase } = require('@/lib/supabase');
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'tok',
    });
  });

  it('treats user cancellation as a silent no-op', async () => {
    mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await expect(signInWithApple()).resolves.toEqual({ error: null });
    const { supabase } = require('@/lib/supabase');
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('returns a message when no identity token comes back', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });
    const res = await signInWithApple();
    expect(res.error).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- social-auth`
Expected: FAIL — cannot find module `../social-auth`.

- [ ] **Step 5: Implement `app/src/lib/social-auth.ts`**

```ts
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Native token sign-in for Apple and Google. Both modules are loaded lazily so
 * the app still boots in Expo Go (SDK 54 pin): when a native module is absent
 * the corresponding button simply never renders.
 */

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const Apple = require('expo-apple-authentication');
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<{ error: string | null }> {
  try {
    const Apple = require('expo-apple-authentication');
    const credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) return { error: 'Apple sign-in did not complete. Try again.' };
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    return { error: error ? 'Could not sign in with Apple. Try again.' : null };
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return { error: null };
    return { error: 'Could not sign in with Apple. Try again.' };
  }
}

export function googleAvailable(): boolean {
  if (!GOOGLE_WEB_CLIENT_ID) return false;
  try {
    require('@react-native-google-signin/google-signin');
    return true;
  } catch {
    return false;
  }
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  try {
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
    });
    await GoogleSignin.hasPlayServices?.();
    const result = await GoogleSignin.signIn();
    // v13+ wraps the payload; older shapes carry idToken at the top level.
    const idToken: string | null =
      result?.data?.idToken ?? (result as { idToken?: string })?.idToken ?? null;
    if (result?.type === 'cancelled' || !idToken) return { error: null };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    return { error: error ? 'Could not sign in with Google. Try again.' : null };
  } catch {
    return { error: 'Could not sign in with Google. Try again.' };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- social-auth` — expected PASS. Then `npm run typecheck` (the `result?.data?.idToken` access may need a local `type GoogleSignInResult = { type?: string; data?: { idToken?: string | null } }` cast if the installed types disagree — resolve against the installed version, don't `any` the whole module).

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/app.json app/src/lib/social-auth.ts app/src/lib/__tests__/social-auth.test.ts
git commit -m "feat(app): Apple/Google native token sign-in helpers (Expo Go-safe)"
```

---

### Task 4: Welcome screen — signup copy + provider buttons

**Files:**
- Modify: `app/src/app/(auth)/sign-in.tsx`

**Interfaces:**
- Consumes: `appleAvailable`, `googleAvailable`, `signInWithApple`, `signInWithGoogle` from `@/lib/social-auth` (Task 3).

- [ ] **Step 1: Update the screen**

In `app/src/app/(auth)/sign-in.tsx`:

1. Add imports:
   ```ts
   import { useEffect, useState } from 'react';
   import {
     appleAvailable,
     googleAvailable,
     signInWithApple,
     signInWithGoogle,
   } from '@/lib/social-auth';
   ```
2. Inside the component add provider state:
   ```ts
   const [appleReady, setAppleReady] = useState(false);
   const googleReady = googleAvailable();

   useEffect(() => {
     appleAvailable().then(setAppleReady);
   }, []);

   const withProvider = async (run: () => Promise<{ error: string | null }>) => {
     setBusy(true);
     setError(null);
     const { error: err } = await run();
     setBusy(false);
     if (err) setError(err);
     // On success the auth listener re-routes (same as OTP).
   };
   ```
3. Change the header tagline block: after the existing `<Eyebrow>` add
   ```tsx
   <Muted>Sign in or create your family's account.</Muted>
   ```
4. In the `step === 'email'` branch, after the "Use a password" button, append:
   ```tsx
   {googleReady || appleReady ? (
     <View style={{ gap: 12, marginTop: 8 }}>
       <Muted style={{ textAlign: 'center' }}>or</Muted>
       {googleReady ? (
         <Button
           label="Continue with Google"
           kind="secondary"
           onPress={() => void withProvider(signInWithGoogle)}
           disabled={busy}
         />
       ) : null}
       {appleReady ? (
         <Button
           label="Continue with Apple"
           kind="secondary"
           onPress={() => void withProvider(signInWithApple)}
           disabled={busy}
         />
       ) : null}
     </View>
   ) : null}
   ```
   (In Expo Go both flags are false and the screen is unchanged — that is the intended degradation.)

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck && npm test` — expected clean.

- [ ] **Step 3: Manual smoke in Expo Go**

Run `npm run start`, open in Expo Go (or web): the welcome screen renders with the new tagline, no provider buttons, and email OTP still works. (OTP signup for brand-new emails only works after the Task 7 dashboard flip; existing accounts must still sign in fine now.)

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/sign-in.tsx"
git commit -m "feat(app): welcome screen with Google/Apple sign-in and signup copy"
```

---

### Task 5: Onboarding screen replaces `no-access`

**Files:**
- Create: `app/src/app/onboarding.tsx`
- Delete: `app/src/app/no-access.tsx`
- Modify: `app/src/app/_layout.tsx:48-50`

**Interfaces:**
- Consumes: `createFamily` from `@/lib/membership` (Task 2); `refreshMembership` from `useAuth()` (Task 2).

- [ ] **Step 1: Create `app/src/app/onboarding.tsx`**

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { createFamily } from '@/lib/membership';
import { screenPadding, useTheme } from '@/lib/theme';

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { session, signOut, refreshMembership } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noInvite, setNoInvite] = useState(false);
  const email = session?.user.email ?? 'your email address';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFamily(name.trim());
    } catch {
      setError('Could not create the family. Try again.');
    } finally {
      // Also covers the invited-meanwhile / double-tap races: whatever
      // membership now exists, routing follows it.
      await refreshMembership();
      setBusy(false);
    }
  };

  const checkInvite = async () => {
    setChecking(true);
    setNoInvite(false);
    await refreshMembership();
    // Still on this screen afterwards ⇒ nothing was claimed.
    setNoInvite(true);
    setChecking(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: screenPadding, gap: 16 }}
      >
        <Title>Welcome to Mealy</Title>

        <View style={{ gap: 12 }}>
          <Eyebrow>Start your family</Eyebrow>
          <Body>Create your family's cooking notebook. You can invite everyone else next.</Body>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="Family name (e.g. The Andinos)"
            autoCapitalize="words"
            onSubmitEditing={() => void create()}
          />
          <Button
            label="Create family"
            onPress={() => void create()}
            loading={busy}
            disabled={!name.trim()}
          />
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
        </View>

        <Hairline />

        <View style={{ gap: 12 }}>
          <Eyebrow>Joining a family?</Eyebrow>
          <Body>
            Ask a family member to invite {email} from Settings → Family, then check again.
          </Body>
          <Button
            label="Check for an invite"
            kind="secondary"
            onPress={() => void checkInvite()}
            loading={checking}
          />
          {noInvite ? <Muted>No invite for {email} yet.</Muted> : null}
        </View>

        <Button label="Sign out" kind="secondary" onPress={() => void signOut()} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Swap the route**

Delete `app/src/app/no-access.tsx`. In `app/src/app/_layout.tsx` replace `<Stack.Screen name="no-access" />` with `<Stack.Screen name="onboarding" />` (guard expression unchanged).

- [ ] **Step 3: Typecheck + tests + grep for stragglers**

Run: `npm run typecheck && npm test` and `grep -rn "no-access" app/src` — expected: clean, no hits.

- [ ] **Step 4: Manual smoke**

In Expo Go signed in as an account with a household, the app behaves as before. (The create-family path is exercised end-to-end in Task 7's verification.)

- [ ] **Step 5: Commit**

```bash
git add app/src/app/onboarding.tsx app/src/app/_layout.tsx
git rm app/src/app/no-access.tsx
git commit -m "feat(app): onboarding screen — create your family or claim an invite"
```

---

### Task 6: Settings → Family screen (members, invites)

**Files:**
- Create: `app/src/app/settings/family.tsx`
- Modify: `app/src/app/settings/index.tsx` (link row in the Household section)

**Interfaces:**
- Consumes: `household_members.email` (Task 1); `invites` table (insert/delete allowed to all members by the existing policy).

- [ ] **Step 1: Create `app/src/app/settings/family.tsx`**

```tsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { controlHeight, fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

interface MemberRow {
  user_id: string;
  email: string | null;
  role: 'owner' | 'member';
}

interface InviteRow {
  email: string;
}

export default function FamilyScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const { session } = useAuth();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
      supabase
        .from('household_members')
        .select('user_id, email, role')
        .eq('household_id', householdId),
      supabase.from('invites').select('email').eq('household_id', householdId).order('created_at'),
    ]);
    setMembers((memberRows as MemberRow[]) ?? []);
    setInvites((inviteRows as InviteRow[]) ?? []);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes('@')) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('invites').insert({ email, household_id: householdId });
    setBusy(false);
    if (err) {
      setError(
        err.code === '23505'
          ? 'That email already has a pending invite.'
          : 'Could not create the invite. Try again.'
      );
      return;
    }
    setInviteEmail('');
    await load();
  };

  const revoke = async (email: string) => {
    await supabase.from('invites').delete().eq('email', email);
    await load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 24, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>Settings</Body>
        </Pressable>
        <Title>Family</Title>

        <View style={{ gap: 10 }}>
          <Eyebrow>Members</Eyebrow>
          <View>
            {members.map((member, index) => (
              <View key={member.user_id}>
                {index > 0 ? <Hairline /> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: controlHeight + 4,
                    gap: 10,
                  }}
                >
                  <Body style={{ flex: 1 }}>{member.email ?? 'Unknown member'}</Body>
                  {member.user_id === session?.user.id ? <Muted>you</Muted> : null}
                </View>
              </View>
            ))}
            <Hairline />
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Eyebrow>Invite someone</Eyebrow>
          <Muted>They get full access to every recipe and plan in this family.</Muted>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={{ flex: 1 }}
              onSubmitEditing={() => void invite()}
            />
            <Button
              label="Invite"
              kind="secondary"
              onPress={() => void invite()}
              loading={busy}
              disabled={!inviteEmail.includes('@')}
            />
          </View>
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          {invites.length > 0 ? (
            <View>
              {invites.map((inv, index) => (
                <View key={inv.email}>
                  {index > 0 ? <Hairline /> : null}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: controlHeight + 4,
                      gap: 10,
                    }}
                  >
                    <Body style={{ flex: 1 }}>{inv.email}</Body>
                    <Muted>pending</Muted>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke invite for ${inv.email}`}
                      onPress={() => void revoke(inv.email)}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Hairline />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Link from Settings**

In `app/src/app/settings/index.tsx`, inside the Household section directly after `<Eyebrow>Household</Eyebrow>` (line 186), insert:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Family members and invites"
  onPress={() => router.push('/settings/family')}
  style={({ pressed }) => ({
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: controlHeight + 4,
    gap: 10,
    backgroundColor: pressed ? colors.cardPressed : 'transparent',
  })}
>
  <Body style={{ flex: 1 }}>Family members & invites</Body>
  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
</Pressable>
<Hairline />
```

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm test` — expected clean (typed routes must accept `/settings/family`; if the typed-route type lags, restart the dev server once to regenerate).

- [ ] **Step 4: Manual smoke**

In Expo Go: Settings → "Family members & invites" shows your own email marked "you"; inviting an address lists it as pending; the revoke × removes it; re-inviting the same address twice shows the duplicate message.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/settings/family.tsx app/src/app/settings/index.tsx
git commit -m "feat(app): family screen — members list, invite by email, revoke"
```

---

### Task 7: Enable signups + end-to-end verification + config checklist

**Files:**
- Modify: `docs/spec.md` (only if it states invite-only signup — align one sentence with the new open-signup design, citing the spec doc)

- [ ] **Step 1: Flip Supabase Auth settings (needs Ruben / dashboard)**

These are dashboard-only (no MCP tool): in Supabase → project `fcqtywqwhddlyirhwbzq` → Authentication → Sign In / Up: **enable email signups** (was invite-only). Ask Ruben to do this (or confirm it's already done) before the E2E check below.

- [ ] **Step 2: End-to-end verification of the full signup arc**

Use the `verify` skill's spirit — drive the real flow (Expo Go + a fresh email alias, e.g. `ruben.raw.dev+family1@gmail.com`):
1. Welcome screen → OTP with the fresh alias → lands on **onboarding** (no membership).
2. "Create family" with a name → lands in the tabs; Settings → Family shows the alias as the only member marked "you".
3. Invite a second alias (`+family2`); sign out; OTP-sign-in as `+family2` → trigger path auto-joins → tabs, both members listed.
4. Reverse order: sign up a third alias (`+family3`) with **no** invite → onboarding; from the first account invite `+family3`; back on the third account tap "Check for an invite" → tabs.
5. Confirm in SQL (`execute_sql`): the claimed invites are deleted, all three `household_members` rows have emails, exactly one household was created.
6. Clean up the test rows Ruben doesn't want to keep (delete the test household cascade-deletes memberships): confirm with Ruben first.

- [ ] **Step 3: Record the remaining config checklist**

Report to Ruben (and leave in the final summary — these blocks are external, not code):
- **Google**: create iOS + Web OAuth client IDs in Google Cloud Console → add to Supabase Auth → Providers → Google → set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `app/.env` → add `["@react-native-google-signin/google-signin", { "iosUrlScheme": "<reversed iOS client id>" }]` to `app.json` plugins → new dev build.
- **Apple**: Sign in with Apple capability in Xcode/App Store Connect (blocked on the pending signing setup) + enable the Apple provider in Supabase; the button appears automatically once the capability exists in a dev build.
- **Dev build**: both providers need one (`npx expo run:ios`); Expo Go keeps working with OTP only.

- [ ] **Step 4: Update memory follow-ups**

Add the Google/Apple config checklist and gesture-QA-style outstanding items to the `mealy-followups` memory file so they survive the session.

- [ ] **Step 5: Final commit (if `docs/spec.md` changed) and wrap-up**

```bash
git add docs/spec.md
git commit -m "docs: signup is open self-serve; families invite members (see 2026-08-22 spec)"
```

---

## Self-Review (done at planning time)

- **Spec coverage:** §3 auth methods → Tasks 3–4 + 7; §4 flow → Tasks 4–5; §5 DB → Task 1; §6 app changes → Tasks 2, 4, 5, 6; §7 error handling → Task 1 (RPC raises), Task 5 (race handling via `refreshMembership` in `finally`), Task 6 (23505 message), Task 3 (cancel → `{error: null}`); §8 testing → per-task test steps + Task 7 E2E; §9 config → Tasks 3 (app.json), 7 (checklist). Gap check: §5.4 policy rename ✔ (Task 1); member email backfill ✔; "email+password stays" ✔ (untouched).
- **Placeholder scan:** none — all code blocks complete.
- **Type consistency:** `Membership` re-export keeps `useHousehold` consumers compiling; `refreshMembership` added to `AuthState` in Task 2 and consumed in Task 5; `create_family(family_name text)` matches `rpc('create_family', { family_name })`.

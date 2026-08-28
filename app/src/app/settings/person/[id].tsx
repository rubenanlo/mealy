import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { initials } from '@/components/person-chip';
import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { confirmDestructive, notify } from '@/lib/confirm';
import { shareEmployeeLink } from '@/lib/employee-link';
import { backOr } from '@/lib/nav';
import { useAuth, useHousehold } from '@/lib/auth';
import { AVATAR_COLORS } from '@/lib/avatar';
import { fmt, LOCALES, useI18n, type Locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * Person account page: identity and access only (name, employee flag, web
 * access + link language, removal). Diet preferences live under Meal
 * preferences → Person preferences (settings/preferences/[id]).
 */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { d } = useI18n();
  const router = useRouter();
  const { householdId } = useHousehold();
  const { session } = useAuth();
  // Create mode: the Account screen's Add button pushes /settings/person/new.
  // Everything stays local until Save, which inserts the person (+ invite).
  const isNew = id === 'new';

  const [name, setName] = useState('');
  const [isEmployee, setIsEmployee] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [linkLanguage, setLinkLanguage] = useState<Locale>('es');
  const [avatarColor, setAvatarColor] = useState<string | null>(null);
  const [linkedMember, setLinkedMember] = useState<{
    email: string | null;
    role: string;
    user_id: string;
  } | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [inviteDraft, setInviteDraft] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (isNew) {
      // Default to the first palette color nobody in the family uses yet.
      void supabase
        .from('persons')
        .select('avatar_color')
        .eq('household_id', householdId)
        .then(({ data }) => {
          const used = new Set((data ?? []).map((p) => p.avatar_color).filter(Boolean));
          setAvatarColor(AVATAR_COLORS.find((c) => !used.has(c)) ?? AVATAR_COLORS[0]);
          setLoaded(true);
        });
      return;
    }
    void (async () => {
      const [{ data }, { data: member }, { data: invite }] = await Promise.all([
        supabase
          .from('persons')
          .select('name, is_employee, share_token, link_language, avatar_color')
          .eq('id', id)
          .single(),
        supabase
          .from('household_members')
          .select('email, role, user_id')
          .eq('person_id', id)
          .maybeSingle(),
        supabase.from('invites').select('email').eq('person_id', id).maybeSingle(),
      ]);
      if (!data) return;
      setName(data.name);
      setIsEmployee(data.is_employee);
      setShareToken(data.share_token ?? null);
      setLinkLanguage((data.link_language as Locale) ?? 'es');
      setAvatarColor(data.avatar_color ?? null);
      setLinkedMember(member ?? null);
      setPendingInvite(invite?.email ?? null);
      setLoaded(true);
    })();
  }, [id, isNew, householdId]);

  /** Re-read the linked account / pending invite (they change when the email invite lands). */
  const refreshAccess = async () => {
    const [{ data: member }, { data: invite }] = await Promise.all([
      supabase
        .from('household_members')
        .select('email, role, user_id')
        .eq('person_id', id)
        .maybeSingle(),
      supabase.from('invites').select('email').eq('person_id', id).maybeSingle(),
    ]);
    setLinkedMember(member ?? null);
    setPendingInvite(invite?.email ?? null);
  };

  /** Trigger the invitation email; the invite row must already exist. */
  const sendInviteEmail = async (email: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { email },
    });
    return !error && (data as { sent?: boolean } | null)?.sent !== false;
  };

  const sendInvite = async () => {
    const email = inviteDraft.trim().toLowerCase();
    if (!email.includes('@')) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteNotice(null);
    const { error } = await supabase
      .from('invites')
      .insert({ email, household_id: householdId, person_id: id });
    if (error) {
      setInviteBusy(false);
      setInviteError(error.code === '23505' ? d.settings.inviteDuplicate : d.settings.inviteFailed);
      return;
    }
    const sent = await sendInviteEmail(email);
    setInviteBusy(false);
    setInviteDraft('');
    setInviteNotice(sent ? d.person.inviteSent : d.person.inviteEmailFailed);
    // A sent email means the account already exists: the trigger consumed the
    // invite and linked the member, so re-read instead of assuming "pending".
    await refreshAccess();
  };

  const revokeInvite = async () => {
    if (!pendingInvite) return;
    await supabase.from('invites').delete().eq('email', pendingInvite);
    setPendingInvite(null);
  };

  const save = async () => {
    if (!id) return;
    const trimmed = name.trim();
    if (isNew) {
      if (!trimmed) return;
      setSaving(true);
      setInviteError(null);
      const { data: created, error } = await supabase
        .from('persons')
        .insert({
          household_id: householdId,
          name: trimmed,
          is_employee: isEmployee,
          avatar_color: avatarColor,
        })
        .select('id')
        .single();
      if (error || !created) {
        setSaving(false);
        setInviteError(d.common.genericError);
        return;
      }
      // Invite on save (family members only): pre-linked to this person so the
      // signup trigger attaches their account on first sign-in.
      const email = inviteDraft.trim().toLowerCase();
      if (!isEmployee && email.includes('@')) {
        const { error: inviteErr } = await supabase
          .from('invites')
          .insert({ email, household_id: householdId, person_id: created.id });
        if (inviteErr) {
          setSaving(false);
          setInviteError(
            inviteErr.code === '23505' ? d.settings.inviteDuplicate : d.settings.inviteFailed
          );
          return;
        }
        const sent = await sendInviteEmail(email);
        if (!sent) notify(d.person.accountAccess, d.person.inviteEmailFailed);
      }
      setSaving(false);
      backOr('/settings/account');
      return;
    }
    setSaving(true);
    await supabase
      .from('persons')
      .update({ name: trimmed || name })
      .eq('id', id);
    setSaving(false);
    backOr('/settings/account');
  };

  const remove = () => {
    // A linked login must go with the person — otherwise it lingers as an
    // unlinked member with full access (household_members.person_id is
    // on delete set null). Owners can't be revoked this way.
    const revokable =
      linkedMember && linkedMember.user_id !== session?.user.id && linkedMember.role === 'member'
        ? linkedMember
        : null;
    const body = revokable
      ? fmt(d.person.removeBodyWithAccess, {
          name,
          email: revokable.email ?? d.settings.unknownMember,
        })
      : fmt(d.person.removeBody, { name });
    confirmDestructive({
      title: d.person.removeTitle,
      message: body,
      confirmLabel: d.person.remove,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        void (async () => {
          if (revokable) {
            // Deletes the auth account entirely; membership cascades. If the
            // revoke fails, keep the person too — a deleted person with a
            // live login would linger as an unlinked member with full access.
            const { error } = await supabase.functions.invoke('remove-member', {
              body: { user_id: revokable.user_id },
            });
            if (error) {
              notify(d.settings.revokeMemberFailedTitle, d.common.genericError);
              return;
            }
          }
          await supabase.from('invites').delete().eq('person_id', id);
          await supabase.from('persons').delete().eq('id', id);
          backOr('/settings/account');
        })();
      },
    });
  };

  if (!loaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <View style={{ padding: screenPadding }}>
          <Muted>{d.common.loading}</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 20, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.person.backToAccount}
          onPress={() => backOr('/settings/account')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.person.account}</Body>
        </Pressable>
        <Title>{name || d.person.personFallback}</Title>

        <View style={{ gap: 10 }}>
          <Eyebrow>{d.person.name}</Eyebrow>
          <Field value={name} onChangeText={setName} placeholder={d.person.name} />
        </View>

        <View style={{ gap: 10 }}>
          <Eyebrow>{d.person.avatarColor}</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {AVATAR_COLORS.map((color) => {
              const selected = avatarColor === color;
              return (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    // Tapping the active swatch clears back to the mono chip.
                    const next = selected ? null : color;
                    setAvatarColor(next);
                    if (!isNew) {
                      void supabase.from('persons').update({ avatar_color: next }).eq('id', id);
                    }
                  }}
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: color,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: selected ? 3 : 0,
                    borderColor: colors.text,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  {selected ? (
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: fonts.uiSemi }}>
                      {initials(name)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View>
          <Hairline />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 52,
            }}
          >
            <Body>{d.person.householdEmployee}</Body>
            <Switch
              value={isEmployee}
              onValueChange={(value) => {
                // Persist immediately: the web-access link below only works
                // once the flag is saved, so don't wait for the Save button.
                setIsEmployee(value);
                if (!isNew) {
                  void supabase.from('persons').update({ is_employee: value }).eq('id', id);
                }
              }}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Hairline />
        </View>

        {/* Employees get the Web access link below instead of an app account. */}
        {isEmployee ? null : (
          <View style={{ gap: 10 }}>
            <Eyebrow>{d.person.accountAccess}</Eyebrow>
            {linkedMember ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Body style={{ flex: 1 }}>{linkedMember.email ?? d.settings.unknownMember}</Body>
                <Muted>
                  {linkedMember.user_id === session?.user.id
                    ? d.settings.you
                    : linkedMember.role === 'owner'
                      ? d.settings.roleOwner
                      : d.settings.roleMember}
                </Muted>
              </View>
            ) : pendingInvite ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Body style={{ flex: 1 }}>{pendingInvite}</Body>
                  <Muted>{d.settings.pending}</Muted>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fmt(d.settings.revokeInvite, { email: pendingInvite })}
                    onPress={() => void revokeInvite()}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
                {/* Pending = the email may never have gone out (or got lost). */}
                <Button
                  label={d.person.sendInviteEmail}
                  kind="secondary"
                  loading={inviteBusy}
                  onPress={() => {
                    void (async () => {
                      setInviteBusy(true);
                      setInviteNotice(null);
                      const sent = await sendInviteEmail(pendingInvite);
                      setInviteBusy(false);
                      setInviteNotice(sent ? d.person.inviteSent : d.person.inviteEmailFailed);
                      await refreshAccess();
                    })();
                  }}
                />
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <Muted>{d.person.noAccountHint}</Muted>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Field
                    value={inviteDraft}
                    onChangeText={setInviteDraft}
                    placeholder={d.settings.emailAddress}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    style={{ flex: 1 }}
                    onSubmitEditing={() => (isNew ? undefined : void sendInvite())}
                  />
                  {/* Create mode: the invite goes out on Save instead. */}
                  {isNew ? null : (
                    <Button
                      label={d.settings.invite}
                      kind="secondary"
                      onPress={() => void sendInvite()}
                      loading={inviteBusy}
                      disabled={!inviteDraft.includes('@')}
                    />
                  )}
                </View>
                {inviteError ? <Body style={{ color: colors.danger }}>{inviteError}</Body> : null}
              </View>
            )}
            {inviteNotice ? <Muted>{inviteNotice}</Muted> : null}
          </View>
        )}

        {isEmployee && shareToken ? (
          <View style={{ gap: 10 }}>
            <Eyebrow>{d.person.webAccess}</Eyebrow>
            <Muted>{d.person.webAccessHint}</Muted>
            <Button
              label={d.person.shareCookingLink}
              kind="secondary"
              onPress={() => void shareEmployeeLink(shareToken!, d.common.linkCopied)}
            />
            <Eyebrow style={{ marginTop: 6 }}>{d.person.linkLanguage}</Eyebrow>
            <Muted>{d.person.linkLanguageHint}</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {LOCALES.map((option) => {
                const selected = linkLanguage === option.code;
                return (
                  <Pressable
                    key={option.code}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      // Persist immediately: the shared page reads it live.
                      setLinkLanguage(option.code);
                      void supabase
                        .from('persons')
                        .update({ link_language: option.code })
                        .eq('id', id);
                    }}
                    style={({ pressed }) => ({
                      minHeight: minTapTarget,
                      borderRadius: radius.control,
                      paddingHorizontal: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: selected ? 0 : 1,
                      borderColor: colors.border,
                      backgroundColor: selected
                        ? colors.text
                        : pressed
                          ? colors.cardPressed
                          : 'transparent',
                    })}
                  >
                    <Text
                      style={{
                        color: selected ? colors.bg : colors.text,
                        fontSize: fontSize.base,
                        fontFamily: fonts.uiMedium,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <Button
          label={d.common.save}
          onPress={() => void save()}
          loading={saving}
          disabled={isNew && !name.trim()}
        />
        {isNew ? null : <Button label={d.person.removePerson} kind="danger" onPress={remove} />}
      </ScrollView>
    </SafeAreaView>
  );
}

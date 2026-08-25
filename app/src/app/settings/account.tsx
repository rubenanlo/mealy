import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Eyebrow,
  Field,
  Muted,
  SettingsGroup,
  SettingsRow,
  Title,
} from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { fmt, LOCALES, useI18n } from '@/lib/i18n';
import { type SignupCodeRow, signupCodeStatus } from '@/lib/signup-codes';
import { supabase } from '@/lib/supabase';
import { controlHeight, fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

interface PersonRow {
  id: string;
  name: string;
  is_employee: boolean;
}

interface MemberRow {
  user_id: string;
  email: string | null;
  role: 'owner' | 'member';
}

interface InviteRow {
  email: string;
}

export default function AccountScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const { session, signOut } = useAuth();
  const { d, locale, setLocale } = useI18n();

  const [persons, setPersons] = useState<PersonRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [codes, setCodes] = useState<SignupCodeRow[]>([]);
  const [codeBusy, setCodeBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: personRows }, { data: memberRows }, { data: inviteRows }, { data: adminData }] =
      await Promise.all([
        supabase
          .from('persons')
          .select('id, name, is_employee')
          .eq('household_id', householdId)
          .order('created_at'),
        supabase
          .from('household_members')
          .select('user_id, email, role')
          .eq('household_id', householdId),
        supabase.from('invites').select('email').eq('household_id', householdId).order('created_at'),
        supabase.rpc('is_app_admin'),
      ]);
    setPersons((personRows as PersonRow[]) ?? []);
    setMembers((memberRows as MemberRow[]) ?? []);
    setInvites((inviteRows as InviteRow[]) ?? []);
    const admin = adminData === true;
    setIsAdmin(admin);
    if (admin) {
      // RLS already restricts signup_codes to the admin.
      const { data: codeRows } = await supabase
        .from('signup_codes')
        .select('code, expires_at, redeemed_at')
        .order('created_at', { ascending: false });
      setCodes((codeRows as SignupCodeRow[]) ?? []);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const addPerson = async () => {
    const name = newPersonName.trim();
    if (!name) return;
    await supabase.from('persons').insert({ household_id: householdId, name });
    setNewPersonName('');
    await load();
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes('@')) return;
    setInviteBusy(true);
    setInviteError(null);
    const { error } = await supabase.from('invites').insert({ email, household_id: householdId });
    setInviteBusy(false);
    if (error) {
      setInviteError(error.code === '23505' ? d.settings.inviteDuplicate : d.settings.inviteFailed);
      return;
    }
    setInviteEmail('');
    await load();
  };

  const revoke = async (email: string) => {
    await supabase.from('invites').delete().eq('email', email);
    await load();
  };

  const copyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
  };

  const generateCode = async () => {
    setCodeBusy(true);
    const { data, error } = await supabase.rpc('create_signup_code');
    setCodeBusy(false);
    if (error || !data) {
      Alert.alert(d.settings.codeCreateFailedTitle, d.common.genericError);
      return;
    }
    await Clipboard.setStringAsync(data as string);
    Alert.alert(d.settings.newCodeTitle, fmt(d.settings.newCodeBody, { code: data as string }));
    await load();
  };

  const revokeCode = async (code: string) => {
    await supabase.from('signup_codes').delete().eq('code', code);
    await load();
  };

  const changeEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes('@')) return;
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email });
    setEmailBusy(false);
    if (error) {
      Alert.alert(d.settings.emailChangeFailedTitle, error.message);
      return;
    }
    setNewEmail('');
    Alert.alert(d.settings.confirmEmailTitle, d.settings.confirmEmailBody);
  };

  const deleteAccount = () => {
    Alert.alert(
      d.settings.deleteAccountTitle,
      d.settings.deleteAccountBody,
      [
        { text: d.common.cancel, style: 'cancel' },
        {
          text: d.common.delete,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleteBusy(true);
              const { error } = await supabase.functions.invoke('delete-account');
              setDeleteBusy(false);
              if (error) {
                Alert.alert(d.settings.deleteAccountFailedTitle, d.common.genericError);
                return;
              }
              await signOut();
            })();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.settings.backToSettings}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.settings.title}</Body>
        </Pressable>
        <Title>{d.settings.account}</Title>
        {session?.user.email ? <Body>{session.user.email}</Body> : null}

        {/* Personal UI language: applies immediately, follows the account. */}
        <Eyebrow style={{ marginTop: 16 }}>{d.settings.language}</Eyebrow>
        <SettingsGroup>
          {LOCALES.map((option) => (
            <SettingsRow
              key={option.code}
              label={option.label}
              value={locale === option.code ? '✓' : undefined}
              chevron={false}
              onPress={() => void setLocale(option.code)}
            />
          ))}
        </SettingsGroup>

        {/* People planned for: family members and employees. */}
        <Eyebrow style={{ marginTop: 16 }}>{d.settings.people}</Eyebrow>
        <SettingsGroup>
          {persons.map((person) => (
            <SettingsRow
              key={person.id}
              label={person.name}
              value={person.is_employee ? d.settings.employee : undefined}
              onPress={() => router.push(`/settings/person/${person.id}`)}
              accessibilityLabel={fmt(d.settings.editPerson, { name: person.name })}
            />
          ))}
          {persons.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Muted>{d.settings.noPeopleYet}</Muted>
            </View>
          ) : null}
        </SettingsGroup>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            value={newPersonName}
            onChangeText={setNewPersonName}
            placeholder={d.settings.personName}
            style={{ flex: 1 }}
            onSubmitEditing={() => void addPerson()}
          />
          <Button label={d.common.add} kind="secondary" onPress={() => void addPerson()} />
        </View>

        {/* App accounts with access to this household. */}
        <Eyebrow style={{ marginTop: 16 }}>{d.settings.membersInvites}</Eyebrow>
        <SettingsGroup>
          {members.map((member) => (
            <SettingsRow
              key={member.user_id}
              label={member.email ?? d.settings.unknownMember}
              value={
                member.user_id === session?.user.id
                  ? d.settings.you
                  : member.role === 'owner'
                    ? d.settings.roleOwner
                    : d.settings.roleMember
              }
            />
          ))}
          {invites.map((inv) => (
            <View
              key={inv.email}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: controlHeight + 4,
                paddingHorizontal: 16,
              }}
            >
              <Body style={{ flex: 1 }}>{inv.email}</Body>
              <Muted>{d.settings.pending}</Muted>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fmt(d.settings.revokeInvite, { email: inv.email })}
                onPress={() => void revoke(inv.email)}
                hitSlop={8}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </SettingsGroup>
        <Muted>{d.settings.inviteHint}</Muted>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder={d.settings.emailAddress}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={{ flex: 1 }}
            onSubmitEditing={() => void invite()}
          />
          <Button
            label={d.settings.invite}
            kind="secondary"
            onPress={() => void invite()}
            loading={inviteBusy}
            disabled={!inviteEmail.includes('@')}
          />
        </View>
        {inviteError ? <Body style={{ color: colors.danger }}>{inviteError}</Body> : null}

        {/* Admin only: codes that let a new person create their own family. */}
        {isAdmin ? (
          <>
            <Eyebrow style={{ marginTop: 16 }}>{d.settings.signupCodes}</Eyebrow>
            <SettingsGroup>
              {codes.map((c) => {
                const status = signupCodeStatus(c);
                return (
                  <View
                    key={c.code}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: controlHeight + 4,
                      paddingHorizontal: 16,
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={fmt(d.settings.copyCode, { code: c.code })}
                      onPress={() => void copyCode(c.code)}
                      hitSlop={8}
                      style={{ flex: 1 }}
                    >
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: fontSize.base,
                          fontFamily: fonts.uiSemi,
                        }}
                      >
                        {c.code}
                      </Text>
                    </Pressable>
                    <Muted>
                      {copiedCode === c.code
                        ? d.settings.copied
                        : status === 'active'
                          ? fmt(d.settings.expires, {
                              date: new Date(c.expires_at).toLocaleDateString(locale),
                            })
                          : status === 'expired'
                            ? d.settings.statusExpired
                            : d.settings.statusRedeemed}
                    </Muted>
                    {status === 'redeemed' ? null : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fmt(d.settings.revokeCode, { code: c.code })}
                        onPress={() => void revokeCode(c.code)}
                        hitSlop={8}
                      >
                        <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {codes.length === 0 ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                  <Muted>{d.settings.noCodesYet}</Muted>
                </View>
              ) : null}
            </SettingsGroup>
            <Muted>{d.settings.codesHint}</Muted>
            <Button
              label={d.settings.generateCode}
              kind="secondary"
              onPress={() => void generateCode()}
              loading={codeBusy}
            />
          </>
        ) : null}

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.changeEmail}</Eyebrow>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder={d.settings.newEmailAddress}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={{ flex: 1 }}
            onSubmitEditing={() => void changeEmail()}
          />
          <Button
            label={d.common.save}
            kind="secondary"
            onPress={() => void changeEmail()}
            loading={emailBusy}
            disabled={!newEmail.includes('@')}
          />
        </View>

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.dangerZone}</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label={deleteBusy ? d.settings.deleting : d.settings.deleteAccount}
            destructive
            chevron={false}
            onPress={deleteBusy ? undefined : deleteAccount}
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

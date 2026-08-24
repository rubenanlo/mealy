import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
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
import { supabase } from '@/lib/supabase';
import { controlHeight, fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

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

  const load = useCallback(async () => {
    const [{ data: personRows }, { data: memberRows }, { data: inviteRows }] = await Promise.all([
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
    ]);
    setPersons((personRows as PersonRow[]) ?? []);
    setMembers((memberRows as MemberRow[]) ?? []);
    setInvites((inviteRows as InviteRow[]) ?? []);
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
      setInviteError(
        error.code === '23505'
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

  const changeEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes('@')) return;
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email });
    setEmailBusy(false);
    if (error) {
      Alert.alert('Could not change email', error.message);
      return;
    }
    setNewEmail('');
    Alert.alert(
      'Confirm your new email',
      'We sent confirmation links to your old and new addresses. The change applies once both are confirmed.'
    );
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account. If you are the last member, all household data (recipes, plans, groceries) is deleted too. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleteBusy(true);
              const { error } = await supabase.functions.invoke('delete-account');
              setDeleteBusy(false);
              if (error) {
                Alert.alert('Could not delete account', 'Something went wrong. Try again.');
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
          accessibilityLabel="Back to settings"
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
        <Title>Account</Title>
        {session?.user.email ? <Body>{session.user.email}</Body> : null}

        {/* People planned for: family members and employees. */}
        <Eyebrow style={{ marginTop: 16 }}>People</Eyebrow>
        <SettingsGroup>
          {persons.map((person) => (
            <SettingsRow
              key={person.id}
              label={person.name}
              value={person.is_employee ? 'employee' : undefined}
              onPress={() => router.push(`/settings/person/${person.id}`)}
              accessibilityLabel={`Edit ${person.name}`}
            />
          ))}
          {persons.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Muted>No people yet. Add your household below.</Muted>
            </View>
          ) : null}
        </SettingsGroup>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            value={newPersonName}
            onChangeText={setNewPersonName}
            placeholder="Person's name"
            style={{ flex: 1 }}
            onSubmitEditing={() => void addPerson()}
          />
          <Button label="Add" kind="secondary" onPress={() => void addPerson()} />
        </View>

        {/* App accounts with access to this household. */}
        <Eyebrow style={{ marginTop: 16 }}>Members &amp; invites</Eyebrow>
        <SettingsGroup>
          {members.map((member) => (
            <SettingsRow
              key={member.user_id}
              label={member.email ?? 'Unknown member'}
              value={member.user_id === session?.user.id ? 'you' : member.role}
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
          ))}
        </SettingsGroup>
        <Muted>Invited members get full access to every recipe and plan in this family.</Muted>
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
            loading={inviteBusy}
            disabled={!inviteEmail.includes('@')}
          />
        </View>
        {inviteError ? <Body style={{ color: colors.danger }}>{inviteError}</Body> : null}

        <Eyebrow style={{ marginTop: 16 }}>Change email</Eyebrow>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="New email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={{ flex: 1 }}
            onSubmitEditing={() => void changeEmail()}
          />
          <Button
            label="Save"
            kind="secondary"
            onPress={() => void changeEmail()}
            loading={emailBusy}
            disabled={!newEmail.includes('@')}
          />
        </View>

        <Eyebrow style={{ marginTop: 16 }}>Danger zone</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label={deleteBusy ? 'Deleting…' : 'Delete account'}
            destructive
            chevron={false}
            onPress={deleteBusy ? undefined : deleteAccount}
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

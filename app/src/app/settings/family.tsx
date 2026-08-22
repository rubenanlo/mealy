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
    const { error: err } = await supabase
      .from('invites')
      .insert({ email, household_id: householdId });
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

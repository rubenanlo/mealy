import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { screenPadding, useTheme } from '@/lib/theme';

export default function NoAccessScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: screenPadding, gap: 16 }}>
        <Title>Invitation only</Title>
        <Body>
          This account is not part of any household. Ask the household owner for an
          invitation, then sign in again with the invited email address.
        </Body>
        <Button label="Sign out" kind="secondary" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

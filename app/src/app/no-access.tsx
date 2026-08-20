import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function NoAccessScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <Title>Accès sur invitation uniquement</Title>
        <Body>
          Ce compte n'est rattaché à aucun foyer. Demandez une invitation au propriétaire du
          foyer, puis reconnectez-vous avec l'adresse e-mail invitée.
        </Body>
        <Button label="Se déconnecter" kind="secondary" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

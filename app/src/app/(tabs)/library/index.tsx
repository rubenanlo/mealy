import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Title } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export default function LibraryScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 20 }}>
        <Title>Recettes</Title>
      </View>
    </SafeAreaView>
  );
}

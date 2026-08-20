import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Title } from '@/components/ui';
import { minTapTarget, useTheme } from '@/lib/theme';

export default function LibraryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 8,
        }}
      >
        <Title>Recettes</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter une recette"
          onPress={() => router.push('/capture')}
          style={{
            width: minTapTarget,
            height: minTapTarget,
            borderRadius: minTapTarget / 2,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 28, lineHeight: 32 }}>＋</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { useImageUrl } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, useTheme } from '@/lib/theme';

interface RecipeListItem {
  id: string;
  title: string;
  tags: string[];
  needs_review: boolean;
  cover_image_path: string | null;
}

function RecipeRow({ item, onPress }: { item: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const coverUrl = useImageUrl(item.cover_image_path);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 10,
        minHeight: 72,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 12,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={{ width: 64, height: 64 }} contentFit="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 26 }}>🍽️</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.text, fontSize: fontSize.medium, fontWeight: '600' }}
        >
          {item.title}
        </Text>
        {item.tags.length > 0 ? <Muted>{item.tags.slice(0, 4).join(' · ')}</Muted> : null}
      </View>
      {item.needs_review ? (
        <View
          style={{
            backgroundColor: colors.danger,
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>à vérifier</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      supabase
        .from('recipes')
        .select('id, title, tags, needs_review, cover_image_path')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (!cancelled && data) setRecipes(data as RecipeListItem[]);
        });
      return () => {
        cancelled = true;
      };
    }, [householdId])
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.title.toLowerCase().includes(q));
  }, [recipes, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
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
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une recette"
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RecipeRow item={item} onPress={() => router.push(`/library/${item.id}`)} />
        )}
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Muted>
              {recipes.length === 0
                ? 'Aucune recette pour le moment. Ajoutez-en une avec le bouton ＋.'
                : 'Aucune recette ne correspond à la recherche.'}
            </Muted>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

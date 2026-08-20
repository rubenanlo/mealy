import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Eyebrow, FadeRise, Field, Muted, PressCard, Tag, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { deriveCategory, spineColor } from '@/lib/category';
import { useImageUrl } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { controlHeight, fontSize, screenPadding, useTheme } from '@/lib/theme';

interface RecipeListItem {
  id: string;
  title: string;
  tags: string[];
  needs_review: boolean;
  cover_image_path: string | null;
}

function ReviewBadge() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.saffron,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: '#2B2925', fontSize: fontSize.eyebrow, fontWeight: '700' }}>
        needs review
      </Text>
    </View>
  );
}

function Thumbnail({ path, size, radius }: { path: string | null; size: number; radius: number }) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.cardPressed,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Ionicons name="restaurant-outline" size={size / 3} color={colors.textMuted} />
      )}
    </View>
  );
}

function SuggestionCard({ item, onPress }: { item: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const url = useImageUrl(item.cover_image_path);
  return (
    <PressCard
      onPress={onPress}
      spine={spineColor(deriveCategory(item.tags), colors)}
      accessibilityLabel={`Open recipe ${item.title}`}
      style={{ width: 160, height: 200, padding: 0 }}
    >
      <View
        style={{
          height: 120,
          backgroundColor: colors.cardPressed,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {url ? (
          <Image source={{ uri: url }} style={{ width: 160, height: 120 }} contentFit="cover" />
        ) : (
          <Ionicons name="restaurant-outline" size={36} color={colors.textMuted} />
        )}
      </View>
      <View style={{ padding: 12 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.text, fontSize: fontSize.small, fontWeight: '600', lineHeight: 20 }}
        >
          {item.title}
        </Text>
      </View>
    </PressCard>
  );
}

function RecipeRow({
  item,
  index,
  onPress,
}: {
  item: RecipeListItem;
  index: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <FadeRise index={index}>
      <PressCard
        onPress={onPress}
        spine={spineColor(deriveCategory(item.tags), colors)}
        accessibilityLabel={`Open recipe ${item.title}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 }}
      >
        <Thumbnail path={item.cover_image_path} size={72} radius={10} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text
            numberOfLines={2}
            style={{ color: colors.text, fontSize: fontSize.base, fontWeight: '600' }}
          >
            {item.title}
          </Text>
          {item.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {item.tags.slice(0, 3).map((tag) => (
                <Tag key={tag} label={tag} />
              ))}
            </View>
          ) : null}
          {item.needs_review ? <ReviewBadge /> : null}
        </View>
      </PressCard>
    </FadeRise>
  );
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [plannedIds, setPlannedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [{ data: recipeRows }, { data: entryRows }] = await Promise.all([
          supabase
            .from('recipes')
            .select('id, title, tags, needs_review, cover_image_path')
            .eq('household_id', householdId)
            .order('created_at', { ascending: false }),
          supabase
            .from('plan_entries')
            .select('recipe_id, meal_plans!inner(household_id)')
            .eq('meal_plans.household_id', householdId),
        ]);
        if (cancelled) return;
        if (recipeRows) setRecipes(recipeRows as RecipeListItem[]);
        if (entryRows) {
          setPlannedIds(new Set((entryRows as { recipe_id: string }[]).map((e) => e.recipe_id)));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [householdId])
  );

  // Phase-1 suggestion heuristic: never-planned recipes, newest first.
  const suggestions = useMemo(
    () => recipes.filter((r) => !plannedIds.has(r.id)).slice(0, 6),
    [recipes, plannedIds]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.title.toLowerCase().includes(q));
  }, [recipes, search]);

  const openRecipe = (id: string) => router.push(`/library/${id}`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: screenPadding,
          paddingVertical: 8,
        }}
      >
        <Title>Recipes</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a recipe"
          onPress={() => router.push('/capture')}
          style={({ pressed }) => ({
            width: controlHeight,
            height: controlHeight,
            borderRadius: controlHeight / 2,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Ionicons name="add" size={30} color={colors.accentText} />
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <RecipeRow item={item} index={index} onPress={() => openRecipe(item.id)} />
        )}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 12 }}>
            {suggestions.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Eyebrow>Suggestions</Eyebrow>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12 }}
                  style={{ marginHorizontal: -screenPadding }}
                >
                  <View style={{ width: screenPadding - 12 }} />
                  {suggestions.map((item) => (
                    <SuggestionCard key={item.id} item={item} onPress={() => openRecipe(item.id)} />
                  ))}
                  <View style={{ width: screenPadding - 12 }} />
                </ScrollView>
              </View>
            ) : null}
            <Field
              value={search}
              onChangeText={setSearch}
              placeholder="Search recipes"
              autoCapitalize="none"
            />
          </View>
        }
        ListEmptyComponent={
          recipes.length === 0 ? (
            <EmptyState
              message="No recipes yet."
              actionLabel="Add a recipe"
              onAction={() => router.push('/capture')}
            />
          ) : (
            <View style={{ paddingVertical: 24 }}>
              <Muted>No recipes match your search.</Muted>
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 24, gap: 12 }}
      />
    </SafeAreaView>
  );
}

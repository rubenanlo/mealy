import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeRow, type RecipeListItem } from '@/components/recipe-cards';
import { EmptyState, Field, Hairline, LinkButton, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { deriveCategory, type ProteinCategory } from '@/lib/category';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, tabBarClearance, useTheme } from '@/lib/theme';

type Filter = 'all' | ProteinCategory | 'needs_review';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fish', label: 'Fish' },
  { value: 'meat', label: 'Meat' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'legume', label: 'Legume' },
  { value: 'needs_review', label: 'Needs review' },
];

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: 'center',
        borderRadius: 999,
        paddingHorizontal: 14,
        borderWidth: selected ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Text
        style={{
          color: selected ? colors.bg : colors.text,
          fontSize: fontSize.meta,
          fontFamily: fonts.uiMedium,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      supabase
        .from('recipes')
        .select('id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes')
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
    const q = query.trim().toLowerCase();
    return recipes.filter((recipe) => {
      if (q && !recipe.title.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'needs_review') return recipe.needs_review;
      return deriveCategory(recipe.tags) === filter;
    });
  }, [recipes, query, filter]);

  const hasActiveFilters = query.trim().length > 0 || filter !== 'all';
  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: screenPadding, paddingVertical: 8, gap: 12 }}>
        <Title>Search</Title>
        <Field
          icon="search-outline"
          value={query}
          onChangeText={setQuery}
          placeholder="Search recipes"
          autoCapitalize="none"
          returnKeyType="search"
          style={{ minHeight: minTapTarget }}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
          style={{ marginHorizontal: -screenPadding }}
        >
          {FILTERS.map(({ value, label }) => (
            <FilterChip
              key={value}
              label={label}
              selected={filter === value}
              onPress={() => setFilter(value)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RecipeRow recipe={item} onPress={() => router.push(`/recipe/${item.id}`)} />
        )}
        ItemSeparatorComponent={Hairline}
        ListEmptyComponent={
          recipes.length === 0 ? (
            <EmptyState
              message="Your cooking notebook starts here."
              actionLabel="Add your first recipe"
              onAction={() => router.push('/capture')}
            />
          ) : (
            <View style={{ paddingVertical: 32, alignItems: 'flex-start', gap: 4 }}>
              <Muted>No recipes match.</Muted>
              {hasActiveFilters ? (
                <LinkButton
                  label="Clear filters"
                  onPress={clearFilters}
                  style={{ minHeight: minTapTarget, borderRadius: radius.control }}
                />
              ) : null}
            </View>
          )
        }
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingBottom: insets.bottom + tabBarClearance,
        }}
      />
    </SafeAreaView>
  );
}

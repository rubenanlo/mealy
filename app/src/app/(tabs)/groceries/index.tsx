import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Eyebrow, Hairline, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { dayDate, weekStart } from '@/lib/plan';
import { collectWeekIngredients, type ShoppingGroup } from '@/lib/shopping';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow } from '@/lib/worker';

const CHECKED_KEY_PREFIX = 'mealy.groceries.checked.';

interface EntryRow {
  id: string;
  /** Null for free-text meals — they contribute no ingredients. */
  recipe_id: string | null;
  day: number;
  slot: string;
  position: number;
}

function ChecklistRow({
  name,
  quantity,
  unit,
  checked,
  onToggle,
}: {
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const amount = [quantity, unit].filter((v) => v != null).join(' ');
  const textColor = checked ? colors.textMuted : colors.text;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={amount ? `${name}, ${amount}` : name}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: minTapTarget,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      {/* 26px round checkbox: red fill + white check when done */}
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: checked ? 0 : 1.5,
          borderColor: colors.textMuted,
          backgroundColor: checked ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={colors.accentText} /> : null}
      </View>
      <Text
        style={{
          flex: 1,
          color: textColor,
          fontSize: fontSize.base,
          fontFamily: fonts.ui,
          textDecorationLine: checked ? 'line-through' : 'none',
        }}
      >
        {name}
      </Text>
      {amount ? (
        <Text
          style={{
            color: textColor,
            fontSize: fontSize.base,
            fontFamily: fonts.ui,
            fontVariant: ['tabular-nums'],
            textAlign: 'right',
            textDecorationLine: checked ? 'line-through' : 'none',
          }}
        >
          {amount}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function GroceriesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();

  const [weekIso] = useState(() => weekStart(new Date()));
  const [groups, setGroups] = useState<ShoppingGroup[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const storageKey = `${CHECKED_KEY_PREFIX}${weekIso}`;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [{ data: planRow }, storedChecked] = await Promise.all([
          supabase
            .from('meal_plans')
            .select('id')
            .eq('household_id', householdId)
            .eq('week_start', weekIso)
            .maybeSingle(),
          AsyncStorage.getItem(storageKey).catch(() => null),
        ]);
        if (cancelled) return;
        if (storedChecked) {
          try {
            const parsed: unknown = JSON.parse(storedChecked);
            if (Array.isArray(parsed)) {
              setChecked(new Set(parsed.filter((v): v is string => typeof v === 'string')));
            }
          } catch {
            // Ignore corrupted local state; start unchecked.
          }
        }
        if (!planRow) {
          setGroups([]);
          return;
        }
        const [{ data: entryRows }, { data: recipeRows }] = await Promise.all([
          supabase
            .from('plan_entries')
            .select('id, recipe_id, day, slot, position')
            .eq('meal_plan_id', planRow.id),
          supabase
            .from('recipes')
            .select('id, title, ingredients')
            .eq('household_id', householdId),
        ]);
        if (cancelled) return;
        // Deterministic order so checkbox keys stay stable across reloads.
        const entries = ((entryRows as EntryRow[]) ?? []).sort(
          (a, b) => a.day - b.day || a.slot.localeCompare(b.slot) || a.position - b.position
        );
        const recipes =
          (recipeRows as { id: string; title: string; ingredients: IngredientRow[] }[]) ?? [];
        setGroups(collectWeekIngredients(entries, recipes));
      })();
      return () => {
        cancelled = true;
      };
    }, [householdId, weekIso, storageKey])
  );

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };

  const weekLabel = `Week of ${dayDate(weekIso, 0).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: screenPadding, paddingVertical: 8, gap: 2 }}>
        <Eyebrow>{weekLabel}</Eyebrow>
        <Title>Groceries</Title>
      </View>
      {groups.length === 0 ? (
        <EmptyState
          message="No meals planned this week."
          actionLabel="Open the week"
          onAction={() => router.navigate('/plan')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 32 }}
        >
          {groups.map((group, groupIndex) => (
            <View key={`${group.recipeId}-${groupIndex}`} style={{ paddingTop: groupIndex === 0 ? 4 : 20 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.dayName,
                  letterSpacing: -0.2,
                  fontFamily: fonts.displaySemi,
                  paddingBottom: 6,
                }}
              >
                {group.recipeTitle}
              </Text>
              {group.items.map((item, itemIndex) => {
                const key = `${groupIndex}:${itemIndex}`;
                return (
                  <View key={key}>
                    {itemIndex > 0 ? <Hairline /> : null}
                    <ChecklistRow
                      name={item.name}
                      quantity={item.quantity}
                      unit={item.unit}
                      checked={checked.has(key)}
                      onToggle={() => toggle(key)}
                    />
                  </View>
                );
              })}
              {group.items.length === 0 ? (
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: fontSize.meta,
                    fontFamily: fonts.uiMedium,
                    paddingVertical: 8,
                  }}
                >
                  No ingredients extracted for this recipe.
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

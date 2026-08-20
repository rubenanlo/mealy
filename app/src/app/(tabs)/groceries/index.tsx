import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, EmptyState, Eyebrow, FadeRise, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { dayDate, weekStart } from '@/lib/plan';
import { collectWeekIngredients, type ShoppingGroup } from '@/lib/shopping';
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow } from '@/lib/worker';

const CHECKED_KEY_PREFIX = 'mealy.groceries.checked.';

interface EntryRow {
  id: string;
  recipe_id: string;
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
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: checked ? colors.accent : colors.border,
          backgroundColor: checked ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Ionicons name="checkmark" size={18} color={colors.accentText} /> : null}
      </View>
      <Text
        style={{
          flex: 1,
          color: textColor,
          fontSize: fontSize.base,
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
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 32, gap: 12 }}
        >
          {groups.map((group, groupIndex) => (
            <FadeRise key={`${group.recipeId}-${groupIndex}`} index={groupIndex}>
              <View style={{ gap: 8 }}>
                <Eyebrow>{group.recipeTitle}</Eyebrow>
                <Card style={{ paddingVertical: 6 }}>
                  {group.items.map((item, itemIndex) => {
                    const key = `${groupIndex}:${itemIndex}`;
                    return (
                      <ChecklistRow
                        key={key}
                        name={item.name}
                        quantity={item.quantity}
                        unit={item.unit}
                        checked={checked.has(key)}
                        onToggle={() => toggle(key)}
                      />
                    );
                  })}
                  {group.items.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.small, paddingVertical: 8 }}>
                      No ingredients extracted for this recipe.
                    </Text>
                  ) : null}
                </Card>
              </View>
            </FadeRise>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

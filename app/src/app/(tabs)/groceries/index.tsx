import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Eyebrow, Hairline, Muted, Title } from '@/components/ui';
import {
  aggregate,
  groupByAisle,
  type AggregateLine,
  type AggregatedItem,
  type UnmatchedItem,
} from '@/lib/aggregate';
import { useAuth, useHousehold } from '@/lib/auth';
import type { CanonicalIngredient } from '@/lib/canonical';
import { normalizeDietProfile } from '@/lib/diet';
import { buildShoppingText, type ExportGroup } from '@/lib/export';
import { resolveMatches } from '@/lib/matching';
import { dayDate, weekStart } from '@/lib/plan';
import { collectWeekIngredients } from '@/lib/shopping';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow } from '@/lib/worker';

interface EntryRow {
  id: string;
  /** Null for free-text meals — they contribute no ingredients. */
  recipe_id: string | null;
  day: number;
  slot: string;
  position: number;
}

interface AisleGroup {
  aisle: string;
  items: AggregatedItem[];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Small round checkbox row shared by matched + unmatched items. */
function CheckRow({
  label,
  qty,
  checked,
  onToggle,
  fodmapTier,
  mixed,
  expandable,
  expanded,
  onExpand,
  sub,
}: {
  label: string;
  qty?: string;
  checked: boolean;
  onToggle: () => void;
  fodmapTier?: CanonicalIngredient['fodmap_tier'] | null;
  mixed?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  sub?: string[];
}) {
  const { colors } = useTheme();
  const textColor = checked ? colors.textMuted : colors.text;
  const dotColor =
    fodmapTier === 'high' ? colors.danger : fodmapTier === 'check' ? colors.saffron : null;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTapTarget }}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={qty ? `${label}, ${qty}` : label}
          onPress={onToggle}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: minTapTarget,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
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
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              style={{
                color: textColor,
                fontSize: fontSize.base,
                fontFamily: fonts.ui,
                textDecorationLine: checked ? 'line-through' : 'none',
              }}
            >
              {label}
            </Text>
            {dotColor ? (
              <View
                accessibilityLabel={`FODMAP ${fodmapTier}`}
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }}
              />
            ) : null}
            {mixed ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.uiMedium }}>
                  mixed units
                </Text>
              </View>
            ) : null}
          </View>
          {qty ? (
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
              {qty}
            </Text>
          ) : null}
        </Pressable>
        {expandable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? `Hide details for ${label}` : `Show details for ${label}`}
            accessibilityState={{ expanded }}
            onPress={onExpand}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {expanded && sub && sub.length > 0 ? (
        <View style={{ paddingLeft: 38, paddingBottom: 8, gap: 2 }}>
          {sub.map((lineText, i) => (
            <Muted key={i}>{lineText}</Muted>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function GroceriesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [weekIso] = useState(() => weekStart(new Date()));
  const [loading, setLoading] = useState(true);
  const [hasEntries, setHasEntries] = useState(false);
  const [aisles, setAisles] = useState<AisleGroup[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [fodmapDots, setFodmapDots] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: planRow }, { data: personRows }] = await Promise.all([
        supabase
          .from('meal_plans')
          .select('id')
          .eq('household_id', householdId)
          .eq('week_start', weekIso)
          .maybeSingle(),
        supabase
          .from('persons')
          .select('is_employee, diet_profile')
          .eq('household_id', householdId),
      ]);
      setFodmapDots(
        ((personRows as { is_employee: boolean; diet_profile: unknown }[]) ?? []).some(
          (p) => !p.is_employee && normalizeDietProfile(p.diet_profile).fodmap.mode !== 'off'
        )
      );
      if (!planRow) {
        setHasEntries(false);
        setAisles([]);
        setUnmatched([]);
        return;
      }
      const [{ data: entryRows }, { data: recipeRows }, { data: checkRows }] = await Promise.all([
        supabase
          .from('plan_entries')
          .select('id, recipe_id, day, slot, position')
          .eq('meal_plan_id', planRow.id),
        supabase.from('recipes').select('id, title, ingredients').eq('household_id', householdId),
        supabase
          .from('grocery_checks')
          .select('item_key')
          .eq('household_id', householdId)
          .eq('week_start', weekIso),
      ]);
      setChecked(new Set(((checkRows as { item_key: string }[]) ?? []).map((r) => r.item_key)));

      const entries = ((entryRows as EntryRow[]) ?? []).sort(
        (a, b) => a.day - b.day || a.slot.localeCompare(b.slot) || a.position - b.position
      );
      const recipes =
        (recipeRows as { id: string; title: string; ingredients: IngredientRow[] }[]) ?? [];
      const groups = collectWeekIngredients(entries, recipes);
      const lines: AggregateLine[] = groups.flatMap((group) =>
        group.items.map((item) => ({
          raw: item.raw || item.name,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          recipeTitle: group.recipeTitle,
        }))
      );
      setHasEntries(entries.length > 0);
      if (lines.length === 0) {
        setAisles([]);
        setUnmatched([]);
        return;
      }
      const matches = await resolveMatches([...new Set(lines.map((l) => l.raw))]);
      const result = aggregate(lines, (line) => matches.get(line.raw)?.ingredient ?? null);
      setAisles(groupByAisle(result.items));
      // Dedupe unmatched by key, keep first recipe title.
      const seen = new Set<string>();
      setUnmatched(
        result.unmatched.filter((u) => {
          if (!u.key || seen.has(u.key)) return false;
          seen.add(u.key);
          return true;
        })
      );
    } finally {
      setLoading(false);
    }
  }, [householdId, weekIso]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Realtime sync of grocery_checks across the household (spec §9).
  useEffect(() => {
    const channel = supabase
      .channel(`grocery-checks-${householdId}-${weekIso}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grocery_checks',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          const record = (payload.eventType === 'DELETE' ? payload.old : payload.new) as {
            week_start?: string;
            item_key?: string;
          };
          if (!record?.item_key || (record.week_start && record.week_start !== weekIso)) return;
          setChecked((prev) => {
            const next = new Set(prev);
            if (payload.eventType === 'DELETE') next.delete(record.item_key!);
            else next.add(record.item_key!);
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, weekIso]);

  const toggle = (key: string) => {
    const wasChecked = checked.has(key);
    // Optimistic update; realtime echoes are idempotent Set operations.
    setChecked((prev) => {
      const next = new Set(prev);
      if (wasChecked) next.delete(key);
      else next.add(key);
      return next;
    });
    const revert = () =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (wasChecked) next.add(key);
        else next.delete(key);
        return next;
      });
    if (wasChecked) {
      supabase
        .from('grocery_checks')
        .delete()
        .eq('household_id', householdId)
        .eq('week_start', weekIso)
        .eq('item_key', key)
        .then(({ error }) => {
          if (error) revert();
        });
    } else {
      supabase
        .from('grocery_checks')
        .upsert(
          { household_id: householdId, week_start: weekIso, item_key: key, checked_by: userId },
          { onConflict: 'household_id,week_start,item_key', ignoreDuplicates: true }
        )
        .then(({ error }) => {
          if (error) revert();
        });
    }
  };

  const toggleExpanded = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportGroups = useMemo<ExportGroup[]>(() => {
    const groups: ExportGroup[] = aisles.map((group) => ({
      aisle: group.aisle,
      items: group.items.map((item) => ({
        label: item.displayQty
          ? `${capitalize(item.canonical.name_fr)} — ${item.displayQty}`
          : capitalize(item.canonical.name_fr),
        checked: checked.has(item.key),
      })),
    }));
    if (unmatched.length > 0) {
      groups.push({
        aisle: 'Other',
        items: unmatched.map((u) => ({ label: u.raw, checked: checked.has(u.key) })),
      });
    }
    return groups;
  }, [aisles, unmatched, checked]);

  const share = async () => {
    const message = buildShoppingText(exportGroups);
    if (!message) return;
    try {
      await Share.share({ message });
    } catch {
      // User dismissed or platform unsupported — nothing to do.
    }
  };

  const weekLabel = `Week of ${dayDate(weekIso, 0).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })}`;
  const isEmpty = aisles.length === 0 && unmatched.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: screenPadding,
          paddingVertical: 8,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Eyebrow>{weekLabel}</Eyebrow>
          <Title>Groceries</Title>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share the shopping list"
          onPress={() => void share()}
          disabled={isEmpty}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: minTapTarget / 2,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
            opacity: isEmpty ? 0.4 : 1,
          })}
        >
          <Ionicons name="share-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {loading && isEmpty ? (
        <View style={{ padding: screenPadding }}>
          <Muted>Building your list…</Muted>
        </View>
      ) : isEmpty ? (
        <EmptyState
          message={hasEntries ? 'Nothing to buy this week.' : 'No meals planned this week.'}
          actionLabel="Open the week"
          onAction={() => router.navigate('/plan')}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 32 }}>
          {aisles.map((group, groupIndex) => (
            <View key={group.aisle} style={{ paddingTop: groupIndex === 0 ? 4 : 20 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.dayName,
                  letterSpacing: -0.2,
                  fontFamily: fonts.displaySemi,
                  paddingBottom: 6,
                }}
              >
                {group.aisle}
              </Text>
              {group.items.map((item, itemIndex) => (
                <View key={item.key}>
                  {itemIndex > 0 ? <Hairline /> : null}
                  <CheckRow
                    label={capitalize(item.canonical.name_fr)}
                    qty={item.displayQty || undefined}
                    checked={checked.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    fodmapTier={fodmapDots ? item.canonical.fodmap_tier : null}
                    mixed={item.mixed}
                    expandable={item.parts.length > 1}
                    expanded={expandedKeys.has(item.key)}
                    onExpand={() => toggleExpanded(item.key)}
                    sub={item.parts.map((part) => `${part.qty} — ${part.recipeTitle}`)}
                  />
                </View>
              ))}
            </View>
          ))}

          {unmatched.length > 0 ? (
            <View style={{ paddingTop: 24 }}>
              <Eyebrow style={{ paddingBottom: 6 }}>Unmatched</Eyebrow>
              {unmatched.map((item, itemIndex) => (
                <View key={item.key}>
                  {itemIndex > 0 ? <Hairline /> : null}
                  <CheckRow
                    label={item.raw}
                    checked={checked.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    expandable={false}
                    sub={[]}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

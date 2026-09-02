import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PersonChip, type PersonLike } from '@/components/person-chip';
import { RecipeImage } from '@/components/recipe-cards';
import { EmptyState, Eyebrow, Field, Hairline, Loading, Muted, Title } from '@/components/ui';
import {
  aggregate,
  groupByAisle,
  type AggregateLine,
  type AggregatedItem,
  type UnmatchedItem,
} from '@/lib/aggregate';
import { useAuth, useHousehold } from '@/lib/auth';
import { canonicalDisplayName, type CanonicalIngredient } from '@/lib/canonical';
import { normalizeDietProfile } from '@/lib/diet';
import { buildShoppingText, type ExportGroup } from '@/lib/export';
import { consumeInvalidation } from '@/lib/list-refresh';
import { fmt, useI18n } from '@/lib/i18n';
import { resolveMatches } from '@/lib/matching';
import { anchorFromEvent, pickOption } from '@/lib/options';
import { dayDate, weekStart } from '@/lib/plan';
import { resolveUnitOverrides } from '@/lib/units';
import { collectWeekIngredients } from '@/lib/shopping';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, tabBarClearance, useTheme } from '@/lib/theme';
import type { IngredientRow } from '@/lib/worker';

interface EntryRow {
  id: string;
  /** Null for free-text meals — they contribute no ingredients. */
  recipe_id: string | null;
  day: number;
  slot: string;
  position: number;
  /** Empty ⇒ whole household eats it. */
  person_ids: string[];
  /** Non-family guests eating this meal (migration 0017). */
  guest_count: number;
}

interface AisleGroup {
  aisle: string;
  items: AggregatedItem[];
}

interface CustomItem {
  id: string;
  label: string;
  /** Person responsible for getting it (migration 0029); null = anyone. */
  person_id: string | null;
}

/** grocery_checks key for a user-added item (migration 0026). */
const customKey = (id: string) => `custom:${id}`;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** BCP 47 tags for date formatting per app locale. */
const dateLocales = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT' } as const;

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
  recipes,
  assign,
  onRemove,
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
  /** Source recipes shown as horizontal cards when the row is expanded. */
  recipes?: { title: string; qty?: string; cover: string | null; onPress?: () => void }[];
  /** User-added items only: person responsible (chip) + picker. */
  assign?: { person: PersonLike | null; onPress: (e?: GestureResponderEvent) => void };
  /** User-added items only: trailing remove button. */
  onRemove?: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
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
                accessibilityLabel={fmt(d.groceries.fodmap, { tier: fodmapTier ?? '' })}
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
                  {d.groceries.mixedUnits}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        {/* Quantity sits right after the label block; the trailing icon slot
            has a fixed width on every row (an empty view when a row lacks a
            button), so the quantities column aligns list-wide. */}
        {qty ? (
          <Text
            style={{
              // Never let a pathological quantity overlap the label: cap the
              // column and wrap within it.
              maxWidth: '45%',
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
        {assign ? (
          assign.person ? (
            <PersonChip person={assign.person} onPress={assign.onPress} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(d.groceries.assignA11y, { name: label })}
              onPress={assign.onPress}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Ionicons name="person-add-outline" size={17} color={colors.textMuted} />
            </Pressable>
          )
        ) : null}
        <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(d.groceries.removeItemA11y, { name: label })}
              onPress={onRemove}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
            </Pressable>
          ) : expandable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(
                expanded ? d.groceries.hideDetails : d.groceries.showDetails,
                { name: label }
              )}
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
      </View>
      {/* Expanded: the source recipes as cards (cover, qty, title). */}
      {expanded && recipes && recipes.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 12,
            paddingLeft: 38,
            paddingRight: 8,
            paddingTop: 2,
            paddingBottom: 12,
          }}
        >
          {recipes.map((recipe, i) => (
            <Pressable
              key={i}
              disabled={!recipe.onPress}
              onPress={recipe.onPress}
              accessibilityRole="button"
              accessibilityLabel={fmt(d.groceries.openRecipe, { text: recipe.title })}
              style={({ pressed }) => ({ width: 132, gap: 3, opacity: pressed ? 0.7 : 1 })}
            >
              <RecipeImage
                path={recipe.cover}
                style={{ width: 132, height: 88, borderRadius: 10 }}
                iconSize={20}
              />
              {recipe.qty ? <Muted numberOfLines={1}>{recipe.qty}</Muted> : null}
              <Text
                numberOfLines={2}
                style={{
                  color: colors.text,
                  fontSize: fontSize.meta + 1,
                  lineHeight: 18,
                  fontFamily: fonts.displaySemi,
                }}
              >
                {recipe.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default function GroceriesScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [weekIso] = useState(() => weekStart(new Date()));
  const [loading, setLoading] = useState(true);
  const [hasEntries, setHasEntries] = useState(false);
  const [aisles, setAisles] = useState<AisleGroup[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [persons, setPersons] = useState<PersonLike[]>([]);
  const [newItem, setNewItem] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState<Map<string, string | null>>(new Map());
  const [fodmapDots, setFodmapDots] = useState(false);

  const load = useCallback(async () => {
    // A recipe/meal elsewhere changed this list: drop the stale rows so the
    // spinner shows instead of flashing outdated content.
    if (consumeInvalidation('groceries')) {
      setAisles([]);
      setUnmatched([]);
    }
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
          .select('id, name, avatar_color, is_employee, diet_profile')
          .eq('household_id', householdId),
      ]);
      type PersonRow = PersonLike & { is_employee: boolean; diet_profile: unknown };
      const allPersons = ((personRows as PersonRow[]) ?? []);
      setPersons(allPersons);
      const eaterCount = allPersons.filter((p) => !p.is_employee).length;
      setFodmapDots(
        ((personRows as { is_employee: boolean; diet_profile: unknown }[]) ?? []).some(
          (p) => !p.is_employee && normalizeDietProfile(p.diet_profile).fodmap.mode !== 'off'
        )
      );
      // Custom items and checks exist even without a plan. The generated
      // list resets each week by construction (checks are week-keyed), but
      // user-added items carry over until removed — no week filter here.
      const [{ data: itemRows }, { data: checkRows }] = await Promise.all([
        supabase
          .from('grocery_items')
          .select('id, label, person_id')
          .eq('household_id', householdId)
          .order('created_at'),
        supabase
          .from('grocery_checks')
          .select('item_key')
          .eq('household_id', householdId)
          .eq('week_start', weekIso),
      ]);
      setCustomItems((itemRows as CustomItem[]) ?? []);
      setChecked(new Set(((checkRows as { item_key: string }[]) ?? []).map((r) => r.item_key)));
      if (!planRow) {
        setHasEntries(false);
        setAisles([]);
        setUnmatched([]);
        return;
      }
      const [{ data: entryRows }, { data: recipeRows }] = await Promise.all([
        supabase
          .from('plan_entries')
          .select('id, recipe_id, day, slot, position, person_ids, guest_count')
          .eq('meal_plan_id', planRow.id),
        supabase
          .from('recipes')
          .select('id, title, ingredients, servings, cover_image_path')
          .eq('household_id', householdId),
      ]);

      const entries = ((entryRows as EntryRow[]) ?? []).sort(
        (a, b) => a.day - b.day || a.slot.localeCompare(b.slot) || a.position - b.position
      );
      const recipes =
        (recipeRows as {
          id: string;
          title: string;
          ingredients: IngredientRow[];
          servings: number | null;
          cover_image_path: string | null;
        }[]) ?? [];
      setCovers(new Map(recipes.map((r) => [r.id, r.cover_image_path ?? null])));
      const groups = collectWeekIngredients(entries, recipes, eaterCount);
      const lines: AggregateLine[] = groups.flatMap((group) =>
        group.items.map((item) => ({
          raw: item.raw || item.name,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          recipeTitle: group.recipeTitle,
          recipeId: group.recipeId,
        }))
      );
      setHasEntries(entries.length > 0);
      if (lines.length === 0) {
        setAisles([]);
        setUnmatched([]);
        return;
      }
      const [matches, unitOverrides] = await Promise.all([
        resolveMatches([...new Set(lines.map((l) => l.raw))]),
        // AI-backed classification of units the static table doesn't know.
        resolveUnitOverrides(lines.map((l) => l.unit)),
      ]);
      const result = aggregate(
        lines,
        (line) => matches.get(line.raw)?.ingredient ?? null,
        unitOverrides
      );
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grocery_items',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          const record = (payload.eventType === 'DELETE' ? payload.old : payload.new) as {
            id?: string;
            label?: string;
            person_id?: string | null;
          };
          if (!record?.id) return;
          setCustomItems((prev) => {
            if (payload.eventType === 'DELETE') return prev.filter((i) => i.id !== record.id);
            const next = {
              id: record.id!,
              label: record.label ?? '',
              person_id: record.person_id ?? null,
            };
            if (prev.some((i) => i.id === record.id)) {
              return prev.map((i) => (i.id === record.id ? { ...i, ...next } : i));
            }
            return [...prev, next];
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

  /** Enter in the input adds the item and stays focused for the next one. */
  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    setNewItem('');
    supabase
      .from('grocery_items')
      .insert({ household_id: householdId, week_start: weekIso, label, created_by: userId })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (error || !data) return;
        const id = data.id as string;
        // The realtime echo dedupes by id, so this stays single.
        setCustomItems((prev) =>
          prev.some((i) => i.id === id) ? prev : [...prev, { id, label, person_id: null }]
        );
      });
  };

  /** Pick who's responsible for a custom item (or nobody). */
  const assignItem = (item: CustomItem, e?: GestureResponderEvent) => {
    const set = (personId: string | null) => {
      setCustomItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, person_id: personId } : i))
      );
      // PostgREST builders only execute once awaited/.then()'d — a bare
      // `void builder` silently sends nothing.
      supabase
        .from('grocery_items')
        .update({ person_id: personId })
        .eq('id', item.id)
        .then(({ error }) => {
          if (error)
            setCustomItems((prev) =>
              prev.map((i) => (i.id === item.id ? { ...i, person_id: item.person_id } : i))
            );
        });
    };
    pickOption({
      title: item.label,
      message: d.groceries.assignTitle,
      cancelLabel: d.common.cancel,
      anchor: anchorFromEvent(e),
      options: [
        ...persons.map((person) => ({
          label: person.name,
          checked: item.person_id === person.id,
          onPress: () => set(person.id),
        })),
        { label: d.groceries.nobody, checked: item.person_id === null, onPress: () => set(null) },
      ],
    });
  };

  const removeItem = (item: CustomItem) => {
    setCustomItems((prev) => prev.filter((i) => i.id !== item.id));
    supabase
      .from('grocery_items')
      .delete()
      .eq('id', item.id)
      .then(({ error }) => {
        if (error)
          setCustomItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
      });
    // Items outlive weeks now — clear their checks from every week.
    supabase
      .from('grocery_checks')
      .delete()
      .eq('household_id', householdId)
      .eq('item_key', customKey(item.id))
      .then(() => {});
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
      aisle: d.groceries.aisles[group.aisle] ?? group.aisle,
      items: group.items.map((item) => {
        const name = capitalize(canonicalDisplayName(item.canonical, locale));
        return {
          label: item.displayQty ? `${name} — ${item.displayQty}` : name,
          checked: checked.has(item.key),
        };
      }),
    }));
    const other = [
      ...unmatched.map((u) => ({ label: u.raw, checked: checked.has(u.key) })),
      ...customItems.map((item) => {
        const person = persons.find((p) => p.id === item.person_id);
        return {
          label: person ? `${item.label} — ${person.name}` : item.label,
          checked: checked.has(customKey(item.id)),
        };
      }),
    ];
    if (other.length > 0) {
      groups.push({ aisle: d.groceries.other, items: other });
    }
    return groups;
  }, [aisles, unmatched, customItems, persons, checked, d, locale]);

  const share = async () => {
    const message = buildShoppingText(exportGroups);
    if (!message) return;
    try {
      await Share.share({ message });
    } catch {
      // User dismissed or platform unsupported — nothing to do.
    }
  };

  const weekLabel = fmt(d.groceries.weekOf, {
    date: dayDate(weekIso, 0).toLocaleDateString(dateLocales[locale], {
      month: 'long',
      day: 'numeric',
    }),
  });
  const isEmpty = aisles.length === 0 && unmatched.length === 0;
  const shareEmpty = exportGroups.length === 0;

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
          <Title>{d.groceries.title}</Title>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.groceries.shareList}
          onPress={() => void share()}
          disabled={shareEmpty}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: minTapTarget / 2,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
            opacity: shareEmpty ? 0.4 : 1,
          })}
        >
          <Ionicons name="share-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {loading && isEmpty && customItems.length === 0 ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: insets.bottom + tabBarClearance,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {isEmpty && !loading ? (
            <EmptyState
              message={hasEntries ? d.groceries.nothingToBuy : d.groceries.noMeals}
              actionLabel={d.groceries.openWeek}
              onAction={() => router.navigate('/plan')}
            />
          ) : null}

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
                {d.groceries.aisles[group.aisle] ?? group.aisle}
              </Text>
              {group.items.map((item, itemIndex) => (
                <View key={item.key}>
                  {itemIndex > 0 ? <Hairline /> : null}
                  <CheckRow
                    label={capitalize(canonicalDisplayName(item.canonical, locale))}
                    qty={item.displayQty || undefined}
                    checked={checked.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    fodmapTier={fodmapDots ? item.canonical.fodmap_tier : null}
                    mixed={item.mixed}
                    expandable={item.parts.length > 0}
                    expanded={expandedKeys.has(item.key)}
                    onExpand={() => toggleExpanded(item.key)}
                    recipes={item.parts.map((part) => ({
                      title: part.recipeTitle,
                      qty: part.qty,
                      cover: part.recipeId ? (covers.get(part.recipeId) ?? null) : null,
                      // Cards deep-link to the recipe sheet (v3.2).
                      onPress: part.recipeId
                        ? () => router.push(`/recipe/${part.recipeId}`)
                        : undefined,
                    }))}
                  />
                </View>
              ))}
            </View>
          ))}

          {unmatched.length > 0 ? (
            <View style={{ paddingTop: 24 }}>
              <Eyebrow style={{ paddingBottom: 6 }}>{d.groceries.unmatched}</Eyebrow>
              {unmatched.map((item, itemIndex) => (
                <View key={item.key}>
                  {itemIndex > 0 ? <Hairline /> : null}
                  <CheckRow
                    label={item.raw}
                    checked={checked.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    expandable={!!item.recipeTitle}
                    expanded={expandedKeys.has(item.key)}
                    onExpand={() => toggleExpanded(item.key)}
                    recipes={
                      item.recipeTitle
                        ? [
                            {
                              title: item.recipeTitle,
                              cover: item.recipeId
                                ? (covers.get(item.recipeId) ?? null)
                                : null,
                              onPress: item.recipeId
                                ? () => router.push(`/recipe/${item.recipeId}`)
                                : undefined,
                            },
                          ]
                        : []
                    }
                  />
                </View>
              ))}
            </View>
          ) : null}

          {/* User-added items — enter adds and keeps the keyboard for the next one. */}
          <View style={{ paddingTop: 24 }}>
            <Eyebrow style={{ paddingBottom: 6 }}>{d.groceries.other}</Eyebrow>
            {customItems.map((item, itemIndex) => (
              <View key={item.id}>
                {itemIndex > 0 ? <Hairline /> : null}
                <CheckRow
                  label={item.label}
                  checked={checked.has(customKey(item.id))}
                  onToggle={() => toggle(customKey(item.id))}
                  expandable={false}
                  assign={{
                    person: item.person_id
                      ? (persons.find((p) => p.id === item.person_id) ?? null)
                      : null,
                    onPress: (e?: GestureResponderEvent) => assignItem(item, e),
                  }}
                  onRemove={() => removeItem(item)}
                />
              </View>
            ))}
            <Field
              value={newItem}
              onChangeText={setNewItem}
              placeholder={d.groceries.addItemPlaceholder}
              accessibilityLabel={d.groceries.addItemA11y}
              onSubmitEditing={addItem}
              blurOnSubmit={false}
              returnKeyType="done"
              style={{ marginTop: 10 }}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

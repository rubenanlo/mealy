import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterChip, SummaryCard, UndoToast } from '@/components/groceries/parts';
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
import { addWeeks, dayDate, weekStart } from '@/lib/plan';
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

/** Section keys for the two non-aisle sections (aisles key off their DB name). */
const UNMATCHED_SECTION = '__unmatched__';

/**
 * Foldable section header. Aisles render as display-font headings, the
 * "Unmatched"/"Other" sections as eyebrows — both get the same chevron and
 * an item count while folded, so a closed section still says how much is in it.
 */
function SectionHeader({
  title,
  eyebrow,
  count,
  collapsed,
  onToggle,
}: {
  title: string;
  eyebrow?: boolean;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={fmt(
        collapsed ? d.groceries.expandSection : d.groceries.collapseSection,
        { name: title }
      )}
      onPress={onToggle}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 38,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {eyebrow ? (
        <Eyebrow>{title}</Eyebrow>
      ) : (
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.dayName,
            letterSpacing: -0.2,
            fontFamily: fonts.displaySemi,
          }}
        >
          {title}
        </Text>
      )}
      {collapsed && count > 0 ? <Muted>{count}</Muted> : null}
      <View style={{ flex: 1 }} />
      <Ionicons
        name={collapsed ? 'chevron-down' : 'chevron-up'}
        size={16}
        color={colors.textMuted}
      />
    </Pressable>
  );
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

  const currentWeek = weekStart(new Date());
  /** Week the list is built for — this week by default, switchable to next. */
  const [weekIso, setWeekIso] = useState(currentWeek);
  const [loading, setLoading] = useState(true);
  const [hasEntries, setHasEntries] = useState(false);
  const [aisles, setAisles] = useState<AisleGroup[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [persons, setPersons] = useState<PersonLike[]>([]);
  const [newItem, setNewItem] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  /**
   * Unfolded sections (aisle name, or the two __section__ sentinels). The
   * list opens as a folded table of contents — an empty set is every section
   * closed — so a long week is one screen of headings rather than a scroll.
   */
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState<Map<string, string | null>>(new Map());
  const [fodmapDots, setFodmapDots] = useState(false);
  /** Planned meals with a recipe (the grocery card's "From N meals"). */
  const [mealCount, setMealCount] = useState(0);
  /** Errands person filter: 'all', 'anyone' (unassigned) or a person id. */
  const [errandFilter, setErrandFilter] = useState<string>('all');
  const [showDoneErrands, setShowDoneErrands] = useState(false);
  /** Errands open first; opening groceries folds errands to a summary card. */
  const [groceriesOpen, setGroceriesOpen] = useState(false);
  /** Last ticked errand, offered back for a few seconds. */
  const [undoErrand, setUndoErrand] = useState<{ key: string; label: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  const toggleSection = (key: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
      // Custom items and checks exist even without a plan. Errands carry
      // forward: an item stays on this week and every later week until
      // someone removes it (checks stay week-keyed, so it comes back
      // unticked next week). Items created for a future week don't leak
      // backwards, hence lte rather than no filter at all.
      const [{ data: itemRows }, { data: checkRows }] = await Promise.all([
        supabase
          .from('grocery_items')
          .select('id, label, person_id')
          .eq('household_id', householdId)
          .lte('week_start', weekIso)
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
        setMealCount(0);
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
      setMealCount(entries.filter((e) => e.recipe_id).length);
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
            week_start?: string;
          };
          if (!record?.id) return;
          // Errands carry forward, so only a *later* week's item is out of
          // scope here (deletes only carry the id, and removing an absent id
          // is a no-op).
          if (payload.eventType !== 'DELETE' && record.week_start && record.week_start > weekIso)
            return;
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
    // Errands lead the shared text, like they lead the page.
    const errands = customItems.map((item) => {
      const person = persons.find((p) => p.id === item.person_id);
      return {
        label: person ? `${item.label} — ${person.name}` : item.label,
        checked: checked.has(customKey(item.id)),
      };
    });
    const groups: ExportGroup[] =
      errands.length > 0 ? [{ aisle: d.groceries.errands, items: errands }] : [];
    groups.push(...aisles.map((group) => ({
      aisle: d.groceries.aisles[group.aisle] ?? group.aisle,
      items: group.items.map((item) => {
        const name = capitalize(canonicalDisplayName(item.canonical, locale));
        return {
          label: item.displayQty ? `${name} — ${item.displayQty}` : name,
          checked: checked.has(item.key),
        };
      }),
    })));
    if (unmatched.length > 0) {
      groups.push({
        aisle: d.groceries.unmatched,
        items: unmatched.map((u) => ({ label: u.raw, checked: checked.has(u.key) })),
      });
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

  const weekDate = (week: string) =>
    dayDate(week, 0).toLocaleDateString(dateLocales[locale], {
      month: 'long',
      day: 'numeric',
    });
  const weekLabel = fmt(d.groceries.weekOf, { date: weekDate(weekIso) });

  const changeWeek = (week: string) => {
    if (week === weekIso) return;
    // Drop the old week's rows so the spinner shows instead of stale content.
    setAisles([]);
    setUnmatched([]);
    setCustomItems([]);
    setWeekIso(week);
  };

  /** Header week picker: this week's list or next week's. */
  const pickWeek = (e?: GestureResponderEvent) => {
    const weeks: [string, string][] = [
      [currentWeek, d.plan.thisWeek],
      [addWeeks(currentWeek, 1), d.plan.nextWeek],
    ];
    pickOption({
      title: d.groceries.pickWeek,
      cancelLabel: d.common.cancel,
      anchor: anchorFromEvent(e),
      options: weeks.map(([week, label]) => ({
        label: `${label} — ${weekDate(week)}`,
        checked: weekIso === week,
        onPress: () => changeWeek(week),
      })),
    });
  };
  const isEmpty = aisles.length === 0 && unmatched.length === 0;
  const shareEmpty = exportGroups.length === 0;

  // ── Errands (user-added items) ─────────────────────────────────────────
  const errandDone = (item: CustomItem) => checked.has(customKey(item.id));
  const openErrands = customItems.filter((item) => !errandDone(item));
  const doneErrands = customItems.filter(errandDone);
  const matchesFilter = (item: CustomItem) =>
    errandFilter === 'all' ||
    (errandFilter === 'anyone' ? item.person_id === null : item.person_id === errandFilter);
  const visibleOpen = openErrands.filter(matchesFilter);
  const visibleDone = doneErrands.filter(matchesFilter);
  /** Filter chips: All, each person with open errands, then Anyone. */
  const filterChips: { key: string; label: string }[] = [
    { key: 'all', label: fmt(d.groceries.filterCount, { name: d.groceries.all, n: openErrands.length }) },
    ...persons
      .map((person) => ({
        person,
        n: openErrands.filter((i) => i.person_id === person.id).length,
      }))
      .filter(({ person, n }) => n > 0 || errandFilter === person.id)
      .map(({ person, n }) => ({
        key: person.id,
        label: fmt(d.groceries.filterCount, { name: person.name, n }),
      })),
  ];
  const unassignedOpen = openErrands.filter((i) => i.person_id === null).length;
  if (unassignedOpen > 0 || errandFilter === 'anyone') {
    filterChips.push({
      key: 'anyone',
      label: fmt(d.groceries.filterCount, { name: d.groceries.anyone, n: unassignedOpen }),
    });
  }

  /** Ticking an errand offers Undo for a few seconds. */
  const toggleErrand = (item: CustomItem) => {
    const key = customKey(item.id);
    const wasChecked = checked.has(key);
    toggle(key);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (wasChecked) {
      setUndoErrand(null);
      return;
    }
    setUndoErrand({ key, label: item.label });
    undoTimer.current = setTimeout(() => setUndoErrand(null), 4000);
  };
  const undo = () => {
    if (!undoErrand) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (checked.has(undoErrand.key)) toggle(undoErrand.key);
    setUndoErrand(null);
  };

  const errandRow = (item: CustomItem, index: number) => (
    <View key={item.id}>
      {index > 0 ? <Hairline /> : null}
      <CheckRow
        label={item.label}
        checked={errandDone(item)}
        onToggle={() => toggleErrand(item)}
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
  );

  // ── Groceries summary ──────────────────────────────────────────────────
  const groceryKeys = [
    ...aisles.flatMap((group) => group.items.map((item) => item.key)),
    ...unmatched.map((item) => item.key),
  ];
  const groceriesBought = groceryKeys.filter((key) => checked.has(key)).length;
  const aisleNames = aisles.map((group) => d.groceries.aisles[group.aisle] ?? group.aisle);
  const grocerySubtitle = !hasEntries
    ? d.groceries.noMeals
    : groceryKeys.length === 0
      ? d.groceries.nothingToBuy
      : [
          fmt(mealCount === 1 ? d.groceries.fromOneMeal : d.groceries.fromMeals, { n: mealCount }),
          aisleNames.slice(0, 3).join(', ') + (aisleNames.length > 3 ? '…' : ''),
        ]
          .filter(Boolean)
          .join(' · ');
  const groceryCount =
    groceryKeys.length > 0
      ? fmt(d.groceries.boughtOf, { done: groceriesBought, total: groceryKeys.length })
      : undefined;

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.groceries.pickWeek}
            onPress={pickWeek}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              alignSelf: 'flex-start',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Eyebrow style={weekIso !== currentWeek ? { color: colors.saffron } : undefined}>
              {weekLabel}
            </Eyebrow>
            <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
          </Pressable>
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
            paddingBottom: insets.bottom + tabBarClearance + (undoErrand ? 64 : 0),
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {groceriesOpen ? (
            /* Groceries open: errands fold to one line on top. */
            <SummaryCard
              title={d.groceries.errands}
              count={
                openErrands.length > 0
                  ? fmt(d.groceries.toDo, { n: openErrands.length })
                  : d.groceries.allDone
              }
              expanded={false}
              onPress={() => setGroceriesOpen(false)}
              a11yLabel={d.groceries.showErrands}
            />
          ) : (
            <View style={{ gap: 12 }}>
              {/* Enter adds and keeps the keyboard for the next one. */}
              <Field
                icon="add"
                value={newItem}
                onChangeText={setNewItem}
                placeholder={d.groceries.addErrandPlaceholder}
                accessibilityLabel={d.groceries.addErrandA11y}
                onSubmitEditing={addItem}
                blurOnSubmit={false}
                returnKeyType="done"
              />
              {customItems.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -screenPadding }}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
                  keyboardShouldPersistTaps="handled"
                >
                  {filterChips.map((chip) => (
                    <FilterChip
                      key={chip.key}
                      label={chip.label}
                      selected={errandFilter === chip.key}
                      onPress={() => setErrandFilter(chip.key)}
                    />
                  ))}
                </ScrollView>
              ) : null}
              <View>
                {visibleOpen.map(errandRow)}
                {customItems.length === 0 ? (
                  <Muted style={{ paddingVertical: 8 }}>{d.groceries.noErrands}</Muted>
                ) : visibleOpen.length === 0 ? (
                  <Muted style={{ paddingVertical: 8 }}>{d.groceries.allDone}</Muted>
                ) : null}
                {visibleDone.length > 0 ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showDoneErrands }}
                      onPress={() => setShowDoneErrands((v) => !v)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        minHeight: minTapTarget,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text
                        style={{
                          color: colors.textMuted,
                          fontSize: fontSize.meta + 1,
                          fontFamily: fonts.uiMedium,
                        }}
                      >
                        {fmt(d.groceries.doneThisWeek, { n: visibleDone.length })}
                      </Text>
                      <Ionicons
                        name={showDoneErrands ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.textMuted}
                      />
                    </Pressable>
                    {showDoneErrands ? visibleDone.map(errandRow) : null}
                  </>
                ) : null}
              </View>
            </View>
          )}

          <SummaryCard
            title={d.groceries.groceries}
            count={groceryCount}
            progress={groceryKeys.length > 0 ? groceriesBought / groceryKeys.length : undefined}
            subtitle={groceriesOpen ? undefined : grocerySubtitle}
            expanded={groceriesOpen}
            onPress={() => setGroceriesOpen((v) => !v)}
            a11yLabel={groceriesOpen ? d.groceries.hideGroceries : d.groceries.showGroceries}
          />

          {!groceriesOpen ? null : (
            <View>
              {isEmpty && !loading ? (
                <EmptyState
                  message={hasEntries ? d.groceries.nothingToBuy : d.groceries.noMeals}
                  actionLabel={d.groceries.openWeek}
                  onAction={() => router.navigate('/plan')}
                />
              ) : null}
              {aisles.map((group, groupIndex) => (
                <View key={group.aisle} style={{ paddingTop: groupIndex === 0 ? 0 : 12 }}>
                  <SectionHeader
                    title={d.groceries.aisles[group.aisle] ?? group.aisle}
                    count={group.items.length}
                    collapsed={!openSections.has(group.aisle)}
                    onToggle={() => toggleSection(group.aisle)}
                  />
                  {!openSections.has(group.aisle) ? null : group.items.map((item, itemIndex) => (
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
                <View style={{ paddingTop: 16 }}>
                  <SectionHeader
                    title={d.groceries.unmatched}
                    eyebrow
                    count={unmatched.length}
                    collapsed={!openSections.has(UNMATCHED_SECTION)}
                    onToggle={() => toggleSection(UNMATCHED_SECTION)}
                  />
                  {!openSections.has(UNMATCHED_SECTION) ? null : unmatched.map((item, itemIndex) => (
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
            </View>
          )}
        </ScrollView>
      )}
      {undoErrand ? (
        <UndoToast
          message={fmt(d.groceries.errandDone, { name: undoErrand.label })}
          actionLabel={d.groceries.undo}
          onAction={undo}
          bottom={insets.bottom + tabBarClearance - 8}
        />
      ) : null}
    </SafeAreaView>
  );
}

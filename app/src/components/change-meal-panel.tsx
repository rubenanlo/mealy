import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Muted } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import { buildSearchIndex, scoreRecipes } from '@/lib/search-text';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

export interface PanelRecipe {
  id: string;
  title: string;
  /** Ingredient names, for search. */
  ingredients: readonly string[];
  /** Short labels under the title ("Favourite", "20 min"). */
  meta: readonly string[];
}

export interface PanelIdea {
  ideaId: string;
  recipeId: string | null;
  customTitle: string | null;
  /** Note or "Idea for the week of …". */
  sub: string | null;
}

export type PanelPick = { recipeId: string | null; customTitle: string | null; ideaId?: string };

/**
 * Bottom panel drawn inside the ✦ planner's own modal (a second Modal on top
 * of a page sheet is unreliable on iOS). Scrim, grab handle, title, then the
 * content; `footer` stays pinned.
 */
export function PlannerPanel({
  title,
  subtitle,
  onClose,
  footer,
  tall = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  tall?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.common.close}
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(18,18,18,0.38)' }}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.card * 2,
          borderTopRightRadius: radius.card * 2,
          maxHeight: '92%',
          height: tall ? '92%' : undefined,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: 10 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
        </View>
        <View style={{ paddingHorizontal: screenPadding, paddingTop: 10, paddingBottom: 6, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.display, fontSize: 21 }}>
            {title}
          </Text>
          {subtitle ? <Muted>{subtitle}</Muted> : null}
        </View>
        <ScrollView
          style={{ flexGrow: tall ? 1 : 0 }}
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: 12, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: screenPadding, paddingTop: 8, gap: 10 }}>{footer}</View> : null}
      </View>
    </View>
  );
}

/**
 * Change one meal of the ✦ plan: the week's ideas, ideas parked for later
 * weeks, a few dishes that fit the routine, or a typo-tolerant search over the
 * whole library (or keep the typed text as a dish).
 */
export function ChangeMealPanel({
  title,
  currentTitle,
  recipes,
  ideasWeek,
  ideasLater,
  suggestions,
  onPick,
  onLeaveEmpty,
  onEatingOut,
  onClose,
}: {
  title: string;
  currentTitle: string | null;
  recipes: PanelRecipe[];
  ideasWeek: PanelIdea[];
  ideasLater: PanelIdea[];
  suggestions: string[];
  onPick: (pick: PanelPick) => void;
  onLeaveEmpty: () => void;
  onEatingOut: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.routine;
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [title]);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const index = useMemo(
    () => buildSearchIndex(recipes.map((r) => ({ titles: [r.title], ingredients: r.ingredients }))),
    [recipes]
  );
  const scores = useMemo(() => scoreRecipes(index, query), [index, query]);
  const results = useMemo(() => {
    if (!scores) return [];
    return recipes
      .map((r, i) => ({ r, s: scores[i] ?? 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.r);
  }, [recipes, scores]);
  const typed = query.trim();

  const row = (key: string, name: string, sub: string | null, pick: PanelPick, custom = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={fmt(t.useA11y, { title: name })}
      onPress={() => onPick(pick)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.thumb,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: custom ? 'transparent' : colors.bgGrouped,
          borderWidth: custom ? 1 : 0,
          borderStyle: 'dashed',
          borderColor: colors.accent,
        }}
      >
        <Ionicons name={custom ? 'add' : pick.ideaId ? 'bulb-outline' : 'restaurant-outline'} size={18} color={custom ? colors.accent : colors.textMuted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ color: custom ? colors.accent : colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>
          {name}
        </Text>
        {sub ? <Muted numberOfLines={1}>{sub}</Muted> : null}
      </View>
      {!custom ? (
        <View style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{t.use}</Text>
        </View>
      ) : null}
    </Pressable>
  );

  const ideaRow = (idea: PanelIdea) => {
    const recipe = idea.recipeId ? byId.get(idea.recipeId) : undefined;
    const name = recipe?.title ?? idea.customTitle ?? '';
    if (!name) return null;
    const sub = idea.sub ?? (recipe ? recipe.meta.join(' · ') : t.customIdea);
    return row(`idea-${idea.ideaId}`, name, sub, {
      recipeId: recipe ? recipe.id : null,
      customTitle: recipe ? null : name,
      ideaId: idea.ideaId,
    });
  };

  const label = (text: string) => (
    <Text style={{ color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: 11, letterSpacing: 1.2, marginTop: 6 }}>
      {text.toUpperCase()}
    </Text>
  );

  return (
    <PlannerPanel
      title={title}
      subtitle={currentTitle ? fmt(t.nowLine, { title: currentTitle }) : undefined}
      onClose={onClose}
      tall
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              [t.leaveEmpty, onLeaveEmpty],
              [t.eatingOut, onEatingOut],
            ] as const
          ).map(([text, onPress]) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              onPress={onPress}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{text}</Text>
            </Pressable>
          ))}
        </View>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: typed ? colors.text : colors.border, borderRadius: radius.control, paddingHorizontal: 12, minHeight: 46 }}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={t.searchPlaceholder}
          value={query}
          onChangeText={setQuery}
          placeholder={t.searchPlaceholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => (typed ? onPick({ recipeId: null, customTitle: typed }) : undefined)}
          style={{ flex: 1, minHeight: 44, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.base }}
        />
        {typed ? (
          <Pressable accessibilityRole="button" accessibilityLabel={d.common.close} onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {typed ? (
        <View>
          {results.map((r) => row(r.id, r.title, r.meta.join(' · ') || null, { recipeId: r.id, customTitle: null }))}
          {results.length === 0 ? <Muted style={{ paddingVertical: 8 }}>{t.noMatches}</Muted> : null}
          {row('typed', fmt(t.useTyped, { title: typed }), t.useTypedHint, { recipeId: null, customTitle: typed }, true)}
        </View>
      ) : (
        <>
          {ideasWeek.length > 0 ? (
            <View>
              {label(t.ideasWeek)}
              {ideasWeek.map(ideaRow)}
            </View>
          ) : null}
          {ideasLater.length > 0 ? (
            <View>
              {label(t.ideasLater)}
              {ideasLater.map(ideaRow)}
            </View>
          ) : null}
          {suggestions.length > 0 ? (
            <View>
              {label(t.fitsRoutine)}
              {suggestions
                .map((id) => byId.get(id))
                .filter((r): r is PanelRecipe => !!r)
                .map((r) => row(`s-${r.id}`, r.title, r.meta.join(' · ') || null, { recipeId: r.id, customTitle: null }))}
            </View>
          ) : null}
        </>
      )}
    </PlannerPanel>
  );
}

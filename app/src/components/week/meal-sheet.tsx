import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { GuestStepper } from '@/components/guest-stepper';
import { PersonChip, type PersonLike } from '@/components/person-chip';
import { RecipeImage } from '@/components/recipe-cards';
import { Button, Eyebrow, Field, LinkButton, Muted } from '@/components/ui';
import { Pill, WeekSheet } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { effectivePersonIds, type CookType, type PlanEntry } from '@/lib/plan';
import { entryServings } from '@/lib/servings';
import { fonts, fontSize, minTapTarget, radius, useTheme } from '@/lib/theme';

export interface MealPatch {
  person_ids: string[];
  guest_count: number;
  assigned_cook: CookType;
  cook_part: boolean;
  instructions: string | null;
}

type CookChoice = 'family' | 'employee' | 'part';

/**
 * Meal details (design A): open the recipe, swap it, and set who eats,
 * guests, who cooks (whole dish or only part), the cook's note and sides,
 * all on one short sheet. "Done" saves.
 */
export function MealSheet({
  visible,
  entry,
  sides,
  heading,
  title,
  coverPath,
  hasRecipe,
  eaters,
  away,
  employeeName,
  sideTitle,
  onOpenRecipe,
  onSwap,
  onAddSide,
  onRemoveSide,
  onSave,
  onRemove,
  onClose,
}: {
  visible: boolean;
  entry: PlanEntry | null;
  sides: PlanEntry[];
  /** "Mon · Dinner" */
  heading: string;
  title: string;
  coverPath: string | null;
  hasRecipe: boolean;
  eaters: PersonLike[];
  away: ReadonlySet<string>;
  /** Null when the household has no employee. */
  employeeName: string | null;
  sideTitle: (side: PlanEntry) => string;
  onOpenRecipe: (servings: number) => void;
  onSwap: () => void;
  onAddSide: () => void;
  onRemoveSide: (id: string) => void;
  onSave: (patch: MealPatch) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [guests, setGuests] = useState(0);
  const [cook, setCook] = useState<CookChoice>('family');
  const [note, setNote] = useState('');

  // Re-seed the draft when a different meal opens (not on every reload).
  const entryId = visible ? (entry?.id ?? null) : null;
  useEffect(() => {
    if (!entry) return;
    setPersonIds(entry.person_ids);
    setGuests(entry.guest_count);
    setCook(entry.assigned_cook === 'employee' ? (entry.cook_part ? 'part' : 'employee') : 'family');
    setNote(entry.instructions ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const eaterIds = eaters.map((p) => p.id);
  const home = eaters.filter((p) => !away.has(p.id));
  const effective = effectivePersonIds(personIds, eaterIds, away);
  const servings = entryServings(effective, guests, eaters.length);
  const isSelected = (id: string) => personIds.length === 0 || personIds.includes(id);
  const togglePerson = (id: string) => {
    const current = personIds.length === 0 ? home.map((p) => p.id) : personIds;
    const next = current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
    // Everyone home selected again = "whole household" ([]).
    setPersonIds(next.length === home.length && home.every((p) => next.includes(p.id)) ? [] : next);
  };

  const save = () => {
    onSave({
      person_ids: effective,
      guest_count: guests,
      assigned_cook: cook === 'family' ? 'family' : 'employee',
      cook_part: cook === 'part',
      instructions: note.trim() || null,
    });
  };

  const cookOptions: [CookChoice, string][] = employeeName
    ? [
        ['family', d.plan.familyCook],
        ['employee', employeeName],
        ['part', t.partOfIt],
      ]
    : [];

  return (
    <WeekSheet
      visible={visible}
      onClose={save}
      title={title}
      subtitle={heading}
      headerRight={
        hasRecipe ? null : (
          <LinkButton label={t.swap} onPress={onSwap} textStyle={{ fontSize: fontSize.small }} />
        )
      }
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={t.remove} kind="secondary" onPress={onRemove} style={{ flex: 1 }} />
          <Button label={t.done} onPress={save} style={{ flex: 2 }} />
        </View>
      }
    >
      {hasRecipe ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <RecipeImage path={coverPath} style={{ width: 64, height: 64, borderRadius: radius.thumb }} iconSize={20} />
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenRecipe(servings)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: minTapTarget,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Ionicons name="book-outline" size={18} color={colors.text} />
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
              {`${t.openRecipe} · ${fmt(d.plan.serves, { n: servings })}`}
            </Text>
          </Pressable>
          <LinkButton label={t.swap} onPress={onSwap} textStyle={{ fontSize: fontSize.small }} />
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {d.plan.whoEats}
          </Text>
          {home.map((p) => (
            <PersonChip
              key={p.id}
              person={p}
              selected={isSelected(p.id)}
              onPress={() => togglePerson(p.id)}
            />
          ))}
        </View>
        {away.size > 0 ? (
          <Muted>
            {fmt(d.plan.eatsAwayLine, {
              names: eaters
                .filter((p) => away.has(p.id))
                .map((p) => p.name)
                .join(', '),
            })}
          </Muted>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
          {d.plan.guests}
        </Text>
        <GuestStepper value={guests} onChange={setGuests} />
      </View>

      {cookOptions.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {d.plan.whoCooks}
          </Text>
          <View style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: 10, padding: 3 }}>
            {cookOptions.map(([value, label]) => {
              const selected = cook === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCook(value)}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.bg : 'transparent',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.text,
                      fontFamily: selected ? fonts.uiSemi : fonts.uiMedium,
                      fontSize: fontSize.small,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Eyebrow>{d.plan.cookNote}</Eyebrow>
        <Field
          value={note}
          onChangeText={setNote}
          placeholder={cook === 'part' ? t.partPlaceholder : d.plan.cookNotePlaceholder}
          multiline
          style={{ minHeight: 56, textAlignVertical: 'top' }}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.sides}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sides.map((side) => (
            <Pill
              key={side.id}
              label={`${sideTitle(side)}  ×`}
              selected
              accessibilityLabel={fmt(t.removeSideA11y, { title: sideTitle(side) })}
              onPress={() => onRemoveSide(side.id)}
            />
          ))}
          <Pill label={t.addSide} tone="accent" onPress={onAddSide} />
        </View>
      </View>
    </WeekSheet>
  );
}

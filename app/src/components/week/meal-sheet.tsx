import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
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

/** One dish of the meal, for the "Different dishes" cards (design B2). */
export interface SheetDish {
  id: string;
  title: string;
  coverPath: string | null;
  /** Who eats it, as a concrete list (an everyone-main lists everyone home). */
  personIds: string[];
  isMain: boolean;
}

/** Callbacks for the "Different dishes" cards; each applies right away. */
export interface DishActions {
  /** Move a person onto another dish of this meal. */
  onMovePerson: (personId: string, dishId: string) => void;
  onMoveAway: (personId: string) => void;
  /** Pick the recipe for a new dish these people will eat. */
  onChooseDish: (personIds: string[]) => void;
  onChangeDish: (dishId: string) => void;
  /** Drop a dish; its people go back to the main dish. */
  onRemoveDish: (dishId: string) => void;
  onSameForEveryone: () => void;
  onOpenDish: (dishId: string) => void;
}

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
  dishes = [],
  dishActions,
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
  /** Every dish of this meal (main + one per group of people), for design B2/B3. */
  dishes?: SheetDish[];
  dishActions?: DishActions;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [guests, setGuests] = useState(0);
  const [cook, setCook] = useState<CookChoice>('family');
  const [note, setNote] = useState('');
  /** "Different dishes" mode (design B2). */
  const [split, setSplit] = useState(false);
  /** A dish not chosen yet, with the people moved onto it. */
  const [draft, setDraft] = useState<string[] | null>(null);
  /** The person whose "Move to" menu is open (design B3). */
  const [moving, setMoving] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  // Re-seed the draft when a different meal opens (not on every reload).
  const entryId = visible ? (entry?.id ?? null) : null;
  useEffect(() => {
    if (!entry) return;
    setPersonIds(entry.person_ids);
    setGuests(entry.guest_count);
    setCook(entry.assigned_cook === 'employee' ? (entry.cook_part ? 'part' : 'employee') : 'family');
    setNote(entry.instructions ?? '');
    setSplit(dishes.length > 1);
    setDraft(null);
    setMoving(null);
    setConfirmMerge(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  // People moved between dishes are saved right away; keep the draft in step.
  const savedPeople = entry?.person_ids.join(',') ?? '';
  useEffect(() => {
    if (entry) setPersonIds(entry.person_ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPeople]);
  useEffect(() => {
    if (dishes.length > 1) setSplit(true);
  }, [dishes.length]);

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

  const splitOn = split && !!dishActions && !entry?.leftover_of;
  const save = () => {
    onSave({
      // Different dishes: who eats what was already saved by the moves.
      person_ids: splitOn && entry ? entry.person_ids : effective,
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

      {dishActions && !entry?.leftover_of ? (
        <Segmented
          options={[
            ['same', t.sameForEveryone],
            ['split', t.differentDishes],
          ]}
          value={splitOn ? 'split' : 'same'}
          onChange={(value) => {
            setMoving(null);
            if (value === 'split') {
              setSplit(true);
              if (dishes.length <= 1) setDraft([]);
            } else if (dishes.length > 1) {
              setConfirmMerge(true);
            } else {
              setSplit(false);
              setDraft(null);
            }
          }}
        />
      ) : null}

      {confirmMerge && dishActions ? (
        <View style={{ gap: 8, borderRadius: radius.card, backgroundColor: colors.bgGrouped, padding: 12 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {fmt(t.mergeTitle, { title: dishes.find((x) => x.isMain)?.title ?? title })}
          </Text>
          <Muted>{t.mergeMessage}</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={d.common.cancel} kind="secondary" onPress={() => setConfirmMerge(false)} style={{ flex: 1 }} />
            <Button
              label={t.mergeConfirm}
              onPress={() => {
                setConfirmMerge(false);
                setSplit(false);
                setDraft(null);
                dishActions.onSameForEveryone();
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      ) : null}

      {splitOn && dishActions ? (
        <DishCards
          dishes={dishes}
          openId={entry?.id ?? null}
          home={home}
          draft={draft}
          moving={moving}
          setDraft={setDraft}
          setMoving={setMoving}
          actions={{
            ...dishActions,
            // Leaving this meal's sheet keeps the guests, cook and note edits.
            onOpenDish: (id) => {
              save();
              dishActions.onOpenDish(id);
            },
            onChangeDish: (id) => {
              save();
              dishActions.onChangeDish(id);
            },
            onChooseDish: (ids) => {
              save();
              dishActions.onChooseDish(ids);
            },
          }}
        />
      ) : null}

      <View style={{ gap: 6 }}>
        {splitOn ? null : (
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
        )}
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

function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: [V, string][];
  value: V;
  onChange: (value: V) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: 10, padding: 3 }}>
      {options.map(([v, label]) => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(v)}
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
              style={{ color: colors.text, fontFamily: selected ? fonts.uiSemi : fonts.uiMedium, fontSize: fontSize.small }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A person's name chip on a dish card; tap opens "Move to". */
function NameChip({ person, active, onPress }: { person: PersonLike; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.weekPage.movePersonA11y, { name: person.name })}
      accessibilityState={{ expanded: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingLeft: 3,
        paddingRight: 12,
        borderRadius: 18,
        backgroundColor: colors.text,
        borderWidth: 2,
        borderColor: active ? colors.accent : 'transparent',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <PersonChip person={person} />
      <Text style={{ color: colors.bg, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{person.name}</Text>
    </Pressable>
  );
}

/**
 * "Different dishes" (designs B2 + B3): one card per dish with who eats it.
 * Tap a person to move them to another dish, a new dish, or away. A new dish
 * stays a draft (its people listed, "+ Choose a dish") until a recipe is picked.
 */
function DishCards({
  dishes,
  openId,
  home,
  draft,
  moving,
  setDraft,
  setMoving,
  actions,
}: {
  dishes: SheetDish[];
  openId: string | null;
  home: PersonLike[];
  draft: string[] | null;
  moving: string | null;
  setDraft: (next: string[] | null) => void;
  setMoving: (id: string | null) => void;
  actions: DishActions;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const inDraft = (id: string) => draft?.includes(id) ?? false;
  const peopleOf = (ids: string[]) => home.filter((p) => ids.includes(p.id) && !inDraft(p.id));
  const dishOf = (id: string) => (inDraft(id) ? 'draft' : (dishes.find((x) => x.personIds.includes(id))?.id ?? null));
  const unplaced = home.filter((p) => dishOf(p.id) === null);

  const moveTo = (personId: string, to: string) => {
    setMoving(null);
    const from = dishOf(personId);
    if (to === from) return;
    if (to === 'draft') {
      setDraft([...(draft ?? []), personId]);
      return;
    }
    if (inDraft(personId)) setDraft((draft ?? []).filter((id) => id !== personId));
    if (to === 'away') {
      actions.onMoveAway(personId);
      return;
    }
    // Back from the draft onto the dish they're still saved on: nothing to save.
    const saved = dishes.find((x) => x.personIds.includes(personId))?.id;
    if (saved !== to) actions.onMovePerson(personId, to);
  };

  const menu = (personId: string) => {
    const person = home.find((p) => p.id === personId);
    if (!person) return null;
    const current = dishOf(personId);
    const options: { key: string; label: string; checked: boolean; muted?: boolean }[] = dishes.map((dish, i) => ({
      key: dish.id,
      label: `${fmt(t.dishN, { n: i + 1 })} · ${dish.title}`,
      checked: current === dish.id,
    }));
    options.push(
      draft
        ? { key: 'draft', label: `${fmt(t.dishN, { n: dishes.length + 1 })} · ${t.newDish}`, checked: current === 'draft' }
        : { key: 'draft', label: t.newDish, checked: false }
    );
    options.push({ key: 'away', label: t.awayThisMeal, checked: false, muted: true });
    return (
      <View
        style={{
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bg,
          overflow: 'hidden',
        }}
      >
        <Text
          style={{
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 6,
            color: colors.textMuted,
            fontFamily: fonts.uiSemi,
            fontSize: 11,
            letterSpacing: 1.2,
          }}
        >
          {fmt(t.moveTo, { name: person.name }).toUpperCase()}
        </Text>
        {options.map((o) => (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: o.checked }}
            onPress={() => (o.key === 'draft' && !draft ? (setMoving(null), setDraft([personId])) : moveTo(personId, o.key))}
            style={({ pressed }) => ({
              minHeight: minTapTarget,
              paddingHorizontal: 14,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: o.muted ? colors.textMuted : colors.text,
                fontFamily: o.checked ? fonts.uiSemi : fonts.ui,
                fontSize: fontSize.small,
              }}
            >
              {o.label}
            </Text>
            {o.checked ? <Ionicons name="checkmark" size={18} color={colors.text} /> : null}
          </Pressable>
        ))}
      </View>
    );
  };

  const chips = (people: PersonLike[]) =>
    people.length === 0 ? null : (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {people.map((p) => (
          <NameChip key={p.id} person={p} active={moving === p.id} onPress={() => setMoving(moving === p.id ? null : p.id)} />
        ))}
      </View>
    );

  const card = (
    key: string,
    n: number,
    action: { label: string; onPress: () => void } | null,
    body: ReactNode,
    people: PersonLike[],
    highlight: boolean
  ) => (
    <View key={key} style={{ gap: 6 }}>
      <View
        style={{
          gap: 10,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: highlight ? colors.text : colors.border,
          padding: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: 11, letterSpacing: 1.2 }}>
            {fmt(t.dishN, { n }).toUpperCase()}
          </Text>
          {action ? <LinkButton label={action.label} onPress={action.onPress} textStyle={{ fontSize: fontSize.meta }} /> : null}
        </View>
        {body}
        {chips(people)}
      </View>
      {moving && people.some((p) => p.id === moving) ? menu(moving) : null}
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      {dishes.map((dish, i) =>
        card(
          dish.id,
          i + 1,
          dish.isMain
            ? { label: t.changeDish, onPress: () => actions.onChangeDish(dish.id) }
            : { label: t.removeDish, onPress: () => actions.onRemoveDish(dish.id) },
          <Pressable
            accessibilityRole="button"
            disabled={dish.id === openId}
            onPress={() => actions.onOpenDish(dish.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <RecipeImage path={dish.coverPath} style={{ width: 40, height: 40, borderRadius: radius.thumb }} iconSize={16} />
            <Text numberOfLines={2} style={{ flex: 1, color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
              {dish.title}
            </Text>
            {dish.isMain ? null : (
              <LinkButton label={t.changeDish} onPress={() => actions.onChangeDish(dish.id)} textStyle={{ fontSize: fontSize.meta }} />
            )}
          </Pressable>,
          peopleOf(dish.personIds),
          dish.id === openId
        )
      )}
      {draft
        ? card(
            'draft',
            dishes.length + 1,
            { label: t.removeDish, onPress: () => (setMoving(null), setDraft(null)) },
            <Pressable
              accessibilityRole="button"
              disabled={draft.length === 0}
              onPress={() => actions.onChooseDish(draft)}
              style={({ pressed }) => ({
                minHeight: minTapTarget,
                borderRadius: radius.control,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.border,
                justifyContent: 'center',
                paddingHorizontal: 12,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <Text
                style={{
                  color: draft.length === 0 ? colors.textMuted : colors.accent,
                  fontFamily: fonts.uiMedium,
                  fontSize: fontSize.small,
                }}
              >
                {draft.length === 0 ? t.emptyDishHint : t.chooseDish}
              </Text>
            </Pressable>,
            home.filter((p) => draft.includes(p.id)),
            false
          )
        : null}
      {unplaced.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Muted>{fmt(t.noDishFor, { name: unplaced.map((p) => p.name).join(', ') })}</Muted>
          {chips(unplaced)}
          {moving && unplaced.some((p) => p.id === moving) ? menu(moving) : null}
        </View>
      ) : null}
      {draft ? null : (
        <LinkButton label={t.addAnotherDish} onPress={() => setDraft([])} textStyle={{ fontSize: fontSize.small }} />
      )}
      <Muted>{t.moveTip}</Muted>
    </View>
  );
}

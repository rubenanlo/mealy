import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bubble, BubbleText, ChatHeader, Chip, Composer } from '@/components/ai-assist';
import { Button } from '@/components/ui';
import {
  amountPerServing,
  checkItem,
  formatAmount,
  type CheckItem,
  type FodmapListEntry,
  type Overall,
  type RecipeCheck,
} from '@/lib/fodmap-list';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';
import {
  aiEditRecipe,
  fodmapAlternatives,
  type AiChatTurn,
  type AiEditResult,
  type AiRecipeContext,
  type FodmapAltOption,
  type FodmapAlternativesResult,
} from '@/lib/worker';

/**
 * The ✦ FODMAP flow (design A → G0 → G → H, canvas 6a6EbZzhF8cdGC8yBfgjf7):
 * check the recipe against the household's FODMAP list, chat about
 * alternatives, pick a swap per ingredient, review the rewrite, then the page
 * saves it as My version. Limits and verdicts are computed in
 * lib/fodmap-list.ts; the model only suggests and rewrites.
 */

type Step = 'check' | 'chat' | 'choose' | 'review';
type Choice = number | 'keep';

export interface FodmapFlowProps {
  visible: boolean;
  recipe: AiRecipeContext;
  status: 'loading' | 'empty' | 'failed' | 'ready';
  check: RecipeCheck | null;
  entries: FodmapListEntry[];
  /** Saving replaces an existing My version (the original is open). */
  replacesExisting: boolean;
  saving: boolean;
  saveError: boolean;
  onSave: (result: AiEditResult, note: string) => void;
  onClose: () => void;
}

export function FodmapFlowSheet(props: FodmapFlowProps) {
  const { visible, recipe, check, entries } = props;
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.fodmapCheck;
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState<Step>('check');
  const [turns, setTurns] = useState<AiChatTurn[]>([]);
  const [alts, setAlts] = useState<FodmapAlternativesResult | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatFailed, setChatFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [edit, setEdit] = useState<AiEditResult | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editFailed, setEditFailed] = useState(false);

  // Each opening starts from the check.
  useEffect(() => {
    if (!visible) return;
    setStep('check');
    setTurns([]);
    setAlts(null);
    setChatFailed(false);
    setDraft('');
    setChoices(new Map());
    setEdit(null);
    setEditFailed(false);
  }, [visible]);

  const nameOf = useMemo(
    () => new Map(recipe.ingredients.map((ing) => [ing.raw || ing.name, ing.name])),
    [recipe.ingredients]
  );
  const over = check?.over ?? [];

  const rating = (o: Overall) => (o === 'red' ? t.ratedRed : o === 'amber' ? t.ratedAmber : t.ratedGreen);
  const limitText = (e: FodmapListEntry) => {
    const g = e.green_max !== null ? formatAmount(e.green_max, e.unit) : null;
    const r = e.red_qty !== null ? formatAmount(e.red_qty, e.unit) : null;
    if (!g) return r ? fmt(t.limitNoGreen, { red: r }) : t.limitNoGreenOnly;
    return r ? fmt(t.limitGreenRed, { green: g, red: r }) : fmt(t.limitGreen, { green: g });
  };
  const detailFor = (item: CheckItem) => {
    if (!item.entry) return '';
    const amount =
      item.perServing !== null ? fmt(t.perServing, { amount: formatAmount(item.perServing, item.entry.unit) }) : t.amountUnknown;
    return `${amount} ${limitText(item.entry)}`;
  };

  // ---- G0: the alternatives chat --------------------------------------------

  const askAlternatives = async (question: string, history: AiChatTurn[]) => {
    setChatLoading(true);
    setChatFailed(false);
    const reply = await fodmapAlternatives({
      ...recipe,
      flagged: over.map((item) => ({ raw: item.raw, entry: item.entry?.name ?? null, detail: detailFor(item) })),
      entries: entries.map((e, i) => ({
        i,
        name: e.name,
        overall: e.overall,
        green_max: e.green_max,
        red_qty: e.red_qty,
        unit: e.unit,
      })),
      question,
      history,
    });
    setChatLoading(false);
    if (!reply) {
      setChatFailed(true);
      return;
    }
    setAlts(reply);
    setTurns((prev) => [...prev, { role: 'assistant', text: reply.message }]);
    // Default pick per line: the recommended option, keeping any choice already made.
    setChoices((prev) => {
      const next = new Map(prev);
      for (const item of over) {
        const options = reply.alternatives.find((a) => a.for_raw === item.raw)?.options ?? [];
        const current = next.get(item.raw);
        if (current === undefined || (typeof current === 'number' && current >= options.length)) {
          const rec = options.findIndex((o) => o.recommended);
          next.set(item.raw, options.length === 0 ? 'keep' : rec >= 0 ? rec : 0);
        }
      }
      return next;
    });
  };

  const openChat = () => {
    setStep('chat');
    if (!alts && !chatLoading) void askAlternatives('', []);
  };

  const sendQuestion = (text: string) => {
    const q = text.trim();
    if (!q || chatLoading) return;
    const history = turns;
    setTurns([...turns, { role: 'user', text: q }]);
    setDraft('');
    void askAlternatives(q, history);
  };

  useEffect(() => {
    if (step === 'chat') setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [turns, chatLoading, step]);

  // ---- G: choices -------------------------------------------------------------

  const optionsFor = (raw: string): FodmapAltOption[] =>
    alts?.alternatives.find((a) => a.for_raw === raw)?.options ?? [];

  const chosen = over
    .map((item) => {
      const c = choices.get(item.raw);
      const option = typeof c === 'number' ? optionsFor(item.raw)[c] : undefined;
      return option ? { item, option } : null;
    })
    .filter((x): x is { item: CheckItem; option: FodmapAltOption } => x !== null);

  const optionEntry = (o: FodmapAltOption) => (o.entry_index !== null ? (entries[o.entry_index] ?? null) : null);

  const optionCheck = (o: FodmapAltOption): { text: string; ok: boolean | null } => {
    const entry = optionEntry(o);
    if (!entry) return { text: t.optionUnchecked, ok: null };
    const amount = amountPerServing({ quantity: o.quantity, unit: o.unit }, recipe.servings, entry.unit);
    if (entry.green_max === null) return { text: t.optionNoGreen, ok: false };
    const green = formatAmount(entry.green_max, entry.unit);
    if (amount === null) return { text: fmt(t.limitGreen, { green }), ok: entry.overall === 'green' };
    const ok = amount <= entry.green_max;
    return { text: fmt(ok ? t.optionOk : t.optionOver, { amount: formatAmount(amount, entry.unit), green }), ok };
  };

  // ---- H: rewrite + recheck ---------------------------------------------------

  const runEdit = async () => {
    if (chosen.length === 0) return;
    setStep('review');
    setEdit(null);
    setEditFailed(false);
    setEditLoading(true);
    const lines = chosen.map(({ item, option }) =>
      option.remove ? `- Remove "${item.raw}".` : `- Replace "${item.raw}" with "${option.line}".`
    );
    const request =
      'Make this recipe low-FODMAP with exactly these ingredient swaps, and rewrite only the steps that ' +
      'mention the swapped ingredients so they use the replacements. Change nothing else.\n' +
      lines.join('\n');
    const reply = await aiEditRecipe(recipe, request);
    setEditLoading(false);
    if (!reply) setEditFailed(true);
    else setEdit(reply);
  };

  const recheck = useMemo(() => {
    if (!edit || !check) return null;
    const byRaw = new Map(check.items.map((i) => [i.raw, i]));
    const byWas = new Map(chosen.map((c) => [c.item.raw, c.option]));
    const byLine = new Map(chosen.map((c) => [c.option.line.trim().toLowerCase(), c.option]));
    const still: string[] = [];
    let unknown = 0;
    for (const ing of edit.ingredients) {
      const raw = ing.raw || ing.name;
      let item: CheckItem | undefined;
      if (ing.change === 'same') item = byRaw.get(raw);
      else {
        const option = (ing.was ? byWas.get(ing.was) : undefined) ?? byLine.get(raw.trim().toLowerCase());
        const entry = option ? optionEntry(option) : null;
        item = checkItem(
          raw,
          entry,
          entry ? amountPerServing({ quantity: ing.quantity, unit: ing.unit }, recipe.servings, entry.unit) : null
        );
      }
      if (!item?.entry) unknown += 1;
      else if (item.over) still.push(ing.name || raw);
    }
    return { still, unknown };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, check]);

  const save = () => {
    if (!edit) return;
    const names = chosen.map(({ item }) => nameOf.get(item.raw) ?? item.raw).join(', ');
    props.onSave(edit, fmt(t.variantNote, { names }));
  };

  // ---- render -----------------------------------------------------------------

  const title = step === 'check' ? t.checkTitle : step === 'chat' ? t.chatTitle : step === 'choose' ? t.chooseTitle : t.reviewTitle;
  const back = step === 'chat' ? 'check' : step === 'choose' ? 'chat' : step === 'review' ? 'choose' : null;
  const share = recipe.servings ? `1/${recipe.servings}` : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={props.onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bgGrouped }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ChatHeader eyebrow={fmt(t.eyebrow, { title: recipe.title })} title={title} onClose={props.onClose} />
        {back ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setStep(back)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 40 }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>{t.back}</Text>
          </Pressable>
        ) : null}

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'check' ? (
            <>
              <Bubble mine>
                <BubbleText mine>{t.question}</BubbleText>
              </Bubble>
              {props.status === 'loading' ? (
                <Bubble>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <ActivityIndicator color={colors.textMuted} />
                    <BubbleText>{t.loading}</BubbleText>
                  </View>
                </Bubble>
              ) : props.status !== 'ready' || !check ? (
                <Bubble>
                  <BubbleText>{props.status === 'empty' ? t.listEmpty : t.loadFailed}</BubbleText>
                </Bubble>
              ) : (
                <Bubble>
                  <BubbleText>
                    {over.length > 0
                      ? recipe.servings
                        ? fmt(t.notQuite, { over: over.length, share })
                        : fmt(t.notQuiteNoServings, { over: over.length })
                      : check.flagged.length > 0
                        ? fmt(t.mostly, { share })
                        : fmt(t.allGood, { n: check.items.length })}
                  </BubbleText>
                  {check.flagged.map((item) => (
                    <FlagCard key={item.raw} item={item} rating={rating} detail={detailFor(item)} />
                  ))}
                  {check.unknown.length > 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
                      {fmt(t.notInList, { names: check.unknown.map((i) => nameOf.get(i.raw) ?? i.raw).join(', ') })}
                    </Text>
                  ) : null}
                  {check.fine.length > 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
                      {fmt(t.fine, { names: check.fine.map((i) => nameOf.get(i.raw) ?? i.raw).join(', ') })}
                    </Text>
                  ) : null}
                </Bubble>
              )}
              {props.status === 'ready' && over.length > 0 ? (
                <Button label={t.makeLowFodmap} onPress={openChat} />
              ) : null}
            </>
          ) : null}

          {step === 'chat' ? (
            <>
              <Bubble mine>
                <BubbleText mine>{t.chatOpen}</BubbleText>
              </Bubble>
              {turns.map((turn, i) => (
                <Bubble key={i} mine={turn.role === 'user'}>
                  <BubbleText mine={turn.role === 'user'}>{turn.text}</BubbleText>
                </Bubble>
              ))}
              {chatLoading ? (
                <Bubble>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <ActivityIndicator color={colors.textMuted} />
                    <BubbleText>{t.thinking}</BubbleText>
                  </View>
                </Bubble>
              ) : null}
              {chatFailed && !chatLoading ? (
                <Bubble>
                  <BubbleText>{t.chatFailed}</BubbleText>
                  <Button
                    label={t.retry}
                    kind="secondary"
                    onPress={() => {
                      const lastUser = [...turns].reverse().find((x) => x.role === 'user');
                      const history = lastUser ? turns.slice(0, turns.lastIndexOf(lastUser)) : turns;
                      void askAlternatives(lastUser?.text ?? '', history);
                    }}
                  />
                </Bubble>
              ) : null}
              {alts && !chatLoading ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label={t.chipTaste} onPress={() => sendQuestion(t.chipTaste)} />
                  <Chip label={t.chipOther} onPress={() => sendQuestion(t.chipOther)} />
                </View>
              ) : null}
            </>
          ) : null}

          {step === 'choose' ? (
            <>
              <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
                {t.chooseIntro}
              </Text>
              {over.map((item) => (
                <ChoiceCard
                  key={item.raw}
                  item={item}
                  rating={rating}
                  options={optionsFor(item.raw)}
                  choice={choices.get(item.raw) ?? 'keep'}
                  onChoose={(c) => setChoices((prev) => new Map(prev).set(item.raw, c))}
                  optionCheck={optionCheck}
                />
              ))}
              {(check?.flagged ?? [])
                .filter((i) => !i.over)
                .map((item) => (
                  <View key={item.raw} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 14, gap: 6 }}>
                    <Text style={{ color: colors.text, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>{item.raw}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
                      {item.entry && item.perServing !== null
                        ? fmt(t.okNoChange, {
                            rating: rating(item.entry.overall).toLowerCase(),
                            amount: formatAmount(item.perServing, item.entry.unit),
                          })
                        : t.okAtAmount}
                    </Text>
                  </View>
                ))}
              {(check?.unknown ?? []).length > 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
                  {`${(check?.unknown ?? []).map((i) => nameOf.get(i.raw) ?? i.raw).join(', ')}: ${t.unknownKept}`}
                </Text>
              ) : null}
            </>
          ) : null}

          {step === 'review' ? (
            editLoading ? (
              <Bubble>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator color={colors.textMuted} />
                  <BubbleText>{t.rewriting}</BubbleText>
                </View>
              </Bubble>
            ) : editFailed || !edit ? (
              <Bubble>
                <BubbleText>{t.reviewFailed}</BubbleText>
                <Button label={t.retry} kind="secondary" onPress={() => void runEdit()} />
              </Bubble>
            ) : (
              <ReviewBody edit={edit} recheck={recheck} />
            )
          ) : null}

          <Text
            style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium, textAlign: 'center', marginTop: 6 }}
          >
            {t.disclaimer}
          </Text>
        </ScrollView>

        {step === 'chat' ? (
          <>
            {alts && !chatLoading ? (
              <View style={{ backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 10 }}>
                <Button label={t.chooseSwaps} onPress={() => setStep('choose')} />
              </View>
            ) : null}
            <Composer
              value={draft}
              onChangeText={setDraft}
              onSend={() => sendQuestion(draft)}
              placeholder={t.askPlaceholder}
              disabled={chatLoading}
            />
          </>
        ) : null}

        {step === 'choose' ? (
          <Footer>
            <Button
              label={chosen.length > 0 ? fmt(t.review, { n: chosen.length }) : t.reviewNone}
              disabled={chosen.length === 0}
              onPress={() => void runEdit()}
            />
          </Footer>
        ) : null}

        {step === 'review' && edit && !editLoading ? (
          <Footer>
            {props.saveError ? (
              <Text style={{ color: colors.danger, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>{t.saveFailed}</Text>
            ) : null}
            <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
              {props.replacesExisting ? t.saveNoteReplace : t.saveNote}
            </Text>
            <Button label={props.saving ? t.saving : t.saveMine} loading={props.saving} onPress={save} />
            <Button label={t.changeChoices} kind="secondary" onPress={() => setStep('choose')} />
          </Footer>
        ) : null}
        {step !== 'chat' && step !== 'choose' && !(step === 'review' && edit && !editLoading) ? (
          <View style={{ height: insets.bottom }} />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.bg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

function RatingTag({ overall, label }: { overall: Overall; label: string }) {
  const { colors } = useTheme();
  const bg = overall === 'red' ? colors.danger : overall === 'amber' ? colors.saffron : colors.spineVeg;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 11, fontFamily: fonts.uiSemi, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function FlagCard({
  item,
  rating,
  detail,
}: {
  item: CheckItem;
  rating: (o: Overall) => string;
  detail: string;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.fodmapCheck;
  if (!item.entry) return null;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RatingTag overall={item.entry.overall} label={rating(item.entry.overall)} />
        <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.uiSemi }} numberOfLines={2}>
          {item.raw}
        </Text>
        <Text
          style={{
            color: item.over ? colors.danger : colors.spineVeg,
            fontSize: fontSize.eyebrow,
            fontFamily: fonts.uiSemi,
          }}
        >
          {item.over ? t.over : t.okAtAmount}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>{detail}</Text>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.ui }}>
        {fmt(t.matchedAs, { entry: item.entry.name })}
      </Text>
    </View>
  );
}

function ChoiceCard({
  item,
  rating,
  options,
  choice,
  onChoose,
  optionCheck,
}: {
  item: CheckItem;
  rating: (o: Overall) => string;
  options: FodmapAltOption[];
  choice: Choice;
  onChoose: (c: Choice) => void;
  optionCheck: (o: FodmapAltOption) => { text: string; ok: boolean | null };
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.fodmapCheck;
  const row = (key: string, selected: boolean, onPress: () => void, label: string, sub: string, subTone: 'muted' | 'bad' | 'good', badge?: string) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        padding: selected ? 11 : 12,
        borderRadius: radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.text : colors.border,
        backgroundColor: selected ? colors.bgGrouped : colors.card,
      }}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? colors.text : colors.textMuted}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: selected ? fonts.uiSemi : fonts.ui }}>{label}</Text>
        {sub ? (
          <Text
            style={{
              color: subTone === 'bad' ? colors.danger : subTone === 'good' ? colors.text : colors.textMuted,
              fontSize: fontSize.eyebrow + 1,
              lineHeight: 17,
              fontFamily: fonts.ui,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <Text style={{ color: colors.spineVeg, fontSize: fontSize.eyebrow, fontFamily: fonts.uiSemi }}>{badge}</Text>
      ) : null}
    </Pressable>
  );
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {item.entry ? <RatingTag overall={item.entry.overall} label={rating(item.entry.overall)} /> : null}
        <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>{item.raw}</Text>
        <Text style={{ color: colors.danger, fontSize: fontSize.eyebrow, fontFamily: fonts.uiSemi }}>{t.over}</Text>
      </View>
      {options.map((o, i) => {
        const checkResult = o.remove ? { text: o.note, ok: null } : optionCheck(o);
        const sub = [o.note && !o.remove ? o.note : '', checkResult.text].filter(Boolean).join(' ');
        return row(
          `${i}`,
          choice === i,
          () => onChoose(i),
          o.line,
          sub,
          checkResult.ok === false ? 'bad' : checkResult.ok ? 'good' : 'muted',
          o.recommended ? t.bestMatch : undefined
        );
      })}
      {row('keep', choice === 'keep', () => onChoose('keep'), t.keep, t.keepOver, 'bad')}
    </View>
  );
}

function ReviewBody({
  edit,
  recheck,
}: {
  edit: AiEditResult;
  recheck: { still: string[]; unknown: number } | null;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.fodmapCheck;
  const changedIngredients = edit.ingredients.filter((i) => i.change !== 'same').length + edit.removed.length;
  const changedSteps = edit.steps.filter((s) => s.change !== 'same').length;
  const ok = recheck !== null && recheck.still.length === 0;
  const heading = (label: string, count: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 }}>
      <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display }}>{label}</Text>
      {count > 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium }}>
          {fmt(t.changed, { n: count })}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      {recheck ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            padding: 12,
            borderRadius: radius.card,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: ok ? colors.spineVeg : colors.danger,
          }}
        >
          <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={20} color={ok ? colors.spineVeg : colors.danger} />
          <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>
            {(ok ? t.recheckOk : fmt(t.recheckStill, { names: recheck.still.join(', ') })) +
              (recheck.unknown > 0 ? ` ${fmt(t.recheckUnknown, { n: recheck.unknown })}` : '')}
          </Text>
        </View>
      ) : null}
      {edit.summary ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.ui }}>{edit.summary}</Text>
      ) : null}

      {heading(t.ingredients, changedIngredients)}
      <View style={{ backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: 14 }}>
        {edit.ingredients.map((ing, i) => (
          <View key={`${i}-${ing.raw}`} style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, gap: 3 }}>
            {ing.change === 'changed' && ing.was ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, textDecorationLine: 'line-through', fontFamily: fonts.ui }}>
                {ing.was}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {ing.change !== 'same' ? (
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.saffron }} />
              ) : null}
              <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}>{ing.raw || ing.name}</Text>
            </View>
          </View>
        ))}
        {edit.removed.map((raw) => (
          <View key={`rm-${raw}`} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, textDecorationLine: 'line-through', fontFamily: fonts.ui }}>
              {raw}
            </Text>
          </View>
        ))}
      </View>

      {heading(t.steps, changedSteps)}
      <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 14, gap: 12 }}>
        {edit.steps.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ color: colors.textMuted, fontSize: fontSize.small, fontFamily: fonts.uiSemi, width: 18 }}>{i + 1}</Text>
            <Text
              style={{
                flex: 1,
                color: colors.text,
                fontSize: fontSize.small,
                lineHeight: 21,
                fontFamily: fonts.ui,
                backgroundColor: s.change !== 'same' ? `${colors.saffron}33` : 'transparent',
              }}
            >
              {s.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

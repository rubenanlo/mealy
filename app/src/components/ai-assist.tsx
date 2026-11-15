import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addedColor } from '@/components/ingredient-row';
import { Button } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import type { UnitSystem } from '@/lib/unit-convert';
import {
  aiAskRecipe,
  aiEditRecipe,
  type AiChatTurn,
  type AiEditResult,
  type AiRecipeContext,
} from '@/lib/worker';

// ---------------------------------------------------------------------------
// Shared chat chrome
// ---------------------------------------------------------------------------

function Bubble({ children, mine }: { children: ReactNode; mine?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'stretch',
        maxWidth: mine ? '82%' : undefined,
        backgroundColor: mine ? colors.text : colors.card,
        borderRadius: 14,
        borderBottomLeftRadius: mine ? 14 : 4,
        borderBottomRightRadius: mine ? 4 : 14,
        paddingHorizontal: 14,
        paddingVertical: mine ? 10 : 14,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

function BubbleText({ children, mine }: { children: ReactNode; mine?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: mine ? colors.bg : colors.text, fontSize: fontSize.small, lineHeight: 21, fontFamily: fonts.ui }}>
      {children}
    </Text>
  );
}

function SmallEyebrow({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: colors.textMuted,
        fontSize: fontSize.eyebrow,
        fontFamily: fonts.uiSemi,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        justifyContent: 'center',
      })}
    >
      <Text style={{ color: colors.text, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>
        {label.trim()}
      </Text>
    </Pressable>
  );
}

function ChatHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <View
      style={{
        backgroundColor: colors.bg,
        paddingHorizontal: screenPadding,
        paddingTop: 16,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.textMuted,
            fontSize: fontSize.eyebrow,
            fontFamily: fonts.uiSemi,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </Text>
        <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display, marginTop: 2 }}>
          {title}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.assist.close}
        onPress={onClose}
        style={({ pressed }) => ({
          width: minTapTarget - 4,
          height: minTapTarget - 4,
          borderRadius: (minTapTarget - 4) / 2,
          backgroundColor: pressed ? colors.cardPressed : colors.bgGrouped,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Ionicons name="close" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  disabled,
  inputRef,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled?: boolean;
  /** Lets the starter chips focus the field. */
  inputRef?: RefObject<TextInput | null>;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && value.trim().length > 0;
  return (
    <View
      style={{
        backgroundColor: colors.bg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: insets.bottom + 10,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
      }}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder}
        multiline
        onSubmitEditing={canSend ? onSend : undefined}
        blurOnSubmit
        returnKeyType="send"
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          borderRadius: 22,
          backgroundColor: colors.bgGrouped,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 12,
          color: colors.text,
          fontSize: fontSize.small,
          fontFamily: fonts.ui,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.assist.send}
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={onSend}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.text,
          opacity: !canSend ? 0.35 : pressed ? 0.75 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Ionicons name="arrow-up" size={20} color={colors.bg} />
      </Pressable>
    </View>
  );
}

function Tag({ label, tone }: { label: string; tone: 'added' | 'changed' | 'removed' }) {
  const { colors, dark } = useTheme();
  const bg =
    tone === 'added'
      ? addedColor(dark)
      : tone === 'changed'
        ? colors.saffron
        : colors.textMuted;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, marginTop: 1 }}>
      <Text
        style={{
          color: dark && tone !== 'removed' ? '#121212' : '#FFFFFF',
          fontSize: 11,
          fontFamily: fonts.uiSemi,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}


/** The proposal card: only what changed, ingredients first, then steps. */
function EditDiff({ result }: { result: AiEditResult }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const changedIngredients = result.ingredients.filter((i) => i.change !== 'same');
  const changedSteps = result.steps
    .map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => s.change !== 'same');
  const row = { flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border };
  const lineText = { flex: 1, color: colors.text, fontSize: fontSize.small, lineHeight: 21, fontFamily: fonts.ui };
  if (changedIngredients.length === 0 && changedSteps.length === 0 && result.removed.length === 0) {
    return <BubbleText>{d.assist.noChanges}</BubbleText>;
  }
  return (
    <View style={{ gap: 12 }}>
      {changedIngredients.length > 0 || result.removed.length > 0 ? (
        <View>
          <View style={{ paddingBottom: 6 }}>
            <SmallEyebrow>{d.assist.ingredients}</SmallEyebrow>
          </View>
          {changedIngredients.map((ing, i) => (
            <View key={`i${i}`} style={row}>
              <Tag label={ing.change === 'added' ? d.assist.added : d.assist.changed} tone={ing.change === 'added' ? 'added' : 'changed'} />
              <Text style={lineText}>
                {ing.change === 'changed' && ing.was ? (
                  <Text style={{ color: colors.textMuted, textDecorationLine: 'line-through' }}>{`${ing.was}  `}</Text>
                ) : null}
                <Text style={{ fontFamily: ing.change === 'added' ? fonts.uiSemi : fonts.ui }}>{ing.raw || ing.name}</Text>
              </Text>
            </View>
          ))}
          {result.removed.map((raw, i) => (
            <View key={`r${i}`} style={row}>
              <Tag label={d.assist.removed} tone="removed" />
              <Text style={[lineText, { color: colors.textMuted, textDecorationLine: 'line-through' }]}>{raw}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {changedSteps.length > 0 ? (
        <View>
          <View style={{ paddingBottom: 6 }}>
            <SmallEyebrow>{d.assist.steps}</SmallEyebrow>
          </View>
          {changedSteps.map((s) => (
            <View key={`s${s.n}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 4 }}>
              <Text style={{ color: colors.text, fontSize: fontSize.eyebrow, fontFamily: fonts.uiSemi, letterSpacing: 1, textTransform: 'uppercase' }}>
                {fmt(s.change === 'added' ? d.assist.stepAdded : d.assist.stepChanged, { n: s.n })}
              </Text>
              <Text style={lineText}>{s.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>
        {result.extra_minutes && result.extra_minutes > 0
          ? fmt(d.assist.restSameMinutes, { n: result.extra_minutes })
          : d.assist.restSame}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Change this recipe
// ---------------------------------------------------------------------------

type EditTurn =
  | { kind: 'user'; text: string }
  | { kind: 'proposal'; result: AiEditResult }
  | { kind: 'error'; request: string };

export interface EditChatProps {
  visible: boolean;
  recipeTitle: string;
  /** The recipe the AI edits: My version when it exists and is open, else the original. */
  base: AiRecipeContext;
  /** Saving replaces an existing My version (warn the user). */
  replacesExisting: boolean;
  /** Sent automatically when the sheet opens (from Ask → "Apply to my version"). */
  initialRequest?: string | null;
  saving: boolean;
  saveError: boolean;
  onSave: (result: AiEditResult, note: string) => void;
  onClose: () => void;
}

export function EditChatSheet(props: EditChatProps) {
  const { visible, base } = props;
  const { colors } = useTheme();
  const { d } = useI18n();
  const [turns, setTurns] = useState<EditTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const loadingRef = useRef(false);

  const latest = [...turns].reverse().find((t) => t.kind === 'proposal') as
    | { kind: 'proposal'; result: AiEditResult }
    | undefined;
  const requests = turns.filter((t) => t.kind === 'user').map((t) => (t as { text: string }).text);

  const send = async (text: string) => {
    const request = text.trim();
    if (!request || loadingRef.current) return;
    loadingRef.current = true;
    setDraft('');
    setLoading(true);
    // Each follow-up edits the latest proposal, so changes accumulate.
    const current: AiRecipeContext = latest
      ? {
          ...base,
          ingredients: latest.result.ingredients.map(({ change: _c, was: _w, ...ing }) => ing),
          steps: latest.result.steps.map((s) => s.text),
        }
      : base;
    const history: AiChatTurn[] = turns.flatMap((t): AiChatTurn[] =>
      t.kind === 'user'
        ? [{ role: 'user', text: t.text }]
        : t.kind === 'proposal'
          ? [{ role: 'assistant', text: t.result.summary }]
          : []
    );
    setTurns((prev) => [...prev, { kind: 'user', text: request }]);
    const result = await aiEditRecipe(current, request, history);
    setTurns((prev) => [...prev, result ? { kind: 'proposal', result } : { kind: 'error', request }]);
    loadingRef.current = false;
    setLoading(false);
  };

  // Fresh conversation each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setTurns([]);
    setDraft('');
    if (props.initialRequest) void send(props.initialRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const chips: { label: string; prefill?: boolean }[] = [
    { label: d.assist.chipAdd, prefill: true },
    { label: d.assist.chipSwap, prefill: true },
    { label: d.assist.chipSpicier },
    { label: d.assist.chipVeg },
    { label: d.assist.chipLighter },
  ];

  // Summary line saved with the version: the cook's own words, joined.
  const note = requests.join(' · ').slice(0, 200);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={props.onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <ChatHeader eyebrow={fmt(d.assist.eyebrow, { title: props.recipeTitle })} title={d.assist.changeTitle} onClose={props.onClose} />
        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 10 }}
        >
          {turns.length === 0 && !loading ? (
            <View style={{ gap: 10 }}>
              <Bubble>
                <BubbleText>{d.assist.changePlaceholder}</BubbleText>
              </Bubble>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {chips.map((c) => (
                  <Chip
                    key={c.label}
                    label={c.label}
                    onPress={() => {
                      if (c.prefill) {
                        setDraft(c.label);
                        inputRef.current?.focus();
                      } else void send(c.label);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {turns.map((t, i) =>
            t.kind === 'user' ? (
              <Bubble key={i} mine>
                <BubbleText mine>{t.text}</BubbleText>
              </Bubble>
            ) : t.kind === 'error' ? (
              <Bubble key={i}>
                <BubbleText>{d.assist.editFailed}</BubbleText>
                <Button label={d.assist.retry} kind="secondary" onPress={() => {
                  setTurns((prev) => prev.slice(0, -2));
                  void send(t.request);
                }} />
              </Bubble>
            ) : (
              <Bubble key={i}>
                <BubbleText>{t.result.summary}</BubbleText>
                <EditDiff result={t.result} />
              </Bubble>
            )
          )}

          {loading ? (
            <Bubble>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.textMuted} />
                <BubbleText>{d.assist.rewriting}</BubbleText>
              </View>
            </Bubble>
          ) : null}

          {latest && !loading && turns[turns.length - 1]?.kind === 'proposal' ? (
            <View style={{ gap: 8 }}>
              {props.saveError ? (
                <Text style={{ color: colors.danger, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>{d.assist.saveFailed}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  style={{ flex: 1 }}
                  label={props.saving ? d.assist.saving : props.replacesExisting ? d.assist.replaceVersion : d.assist.saveVersion}
                  loading={props.saving}
                  onPress={() => props.onSave(latest.result, note)}
                />
                <Button label={d.assist.notNow} kind="secondary" onPress={props.onClose} />
              </View>
              <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium, textAlign: 'center' }}>
                {props.replacesExisting ? d.assist.replacesWarning : d.assist.originalStays}
              </Text>
            </View>
          ) : null}

          <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium, textAlign: 'center', marginTop: 6 }}>
            {d.assist.disclaimer}
          </Text>
        </ScrollView>
        <Composer
          inputRef={inputRef}
          value={draft}
          onChangeText={setDraft}
          onSend={() => void send(draft)}
          placeholder={turns.length === 0 ? d.assist.changePlaceholder : d.assist.tweakPlaceholder}
          disabled={loading}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ask a question
// ---------------------------------------------------------------------------

type AskTurn =
  | { kind: 'user'; text: string }
  | { kind: 'answer'; text: string; suggestion: string }
  | { kind: 'error'; question: string };

export function AskChatSheet({
  visible,
  recipeTitle,
  recipe,
  onApply,
  onClose,
}: {
  visible: boolean;
  recipeTitle: string;
  recipe: AiRecipeContext;
  /** "Apply this to my version": hands the suggested change to the change chat. */
  onApply: (change: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      setTurns([]);
      setDraft('');
    }
  }, [visible]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || loadingRef.current) return;
    loadingRef.current = true;
    setDraft('');
    setLoading(true);
    const history: AiChatTurn[] = turns.flatMap((t): AiChatTurn[] =>
      t.kind === 'user' ? [{ role: 'user', text: t.text }] : t.kind === 'answer' ? [{ role: 'assistant', text: t.text }] : []
    );
    setTurns((prev) => [...prev, { kind: 'user', text: question }]);
    const reply = await aiAskRecipe(recipe, question, history);
    setTurns((prev) => [
      ...prev,
      reply ? { kind: 'answer', text: reply.answer, suggestion: reply.suggested_change.trim() } : { kind: 'error', question },
    ]);
    loadingRef.current = false;
    setLoading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <ChatHeader eyebrow={fmt(d.assist.eyebrow, { title: recipeTitle })} title={d.assist.askTitle} onClose={onClose} />
        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        >
          {turns.length === 0 ? (
            <Bubble>
              <BubbleText>{d.assist.askIntro}</BubbleText>
            </Bubble>
          ) : null}
          {turns.map((t, i) =>
            t.kind === 'user' ? (
              <Bubble key={i} mine>
                <BubbleText mine>{t.text}</BubbleText>
              </Bubble>
            ) : t.kind === 'error' ? (
              <Bubble key={i}>
                <BubbleText>{d.assist.askFailed}</BubbleText>
                <Button label={d.assist.retry} kind="secondary" onPress={() => {
                  setTurns((prev) => prev.slice(0, -2));
                  void ask(t.question);
                }} />
              </Bubble>
            ) : (
              <Bubble key={i}>
                <BubbleText>{t.text}</BubbleText>
                {t.suggestion ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onApply(t.suggestion)}
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      minHeight: 40,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.text,
                      backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    })}
                  >
                    <Ionicons name="create-outline" size={15} color={colors.text} />
                    <Text style={{ color: colors.text, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>{d.assist.applyToVersion}</Text>
                  </Pressable>
                ) : null}
              </Bubble>
            )
          )}
          {loading ? (
            <Bubble>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.textMuted} />
                <BubbleText>{d.assist.thinking}</BubbleText>
              </View>
            </Bubble>
          ) : null}
          {turns.length === 0 ? (
            <View style={{ marginTop: 'auto', gap: 8 }}>
              <SmallEyebrow>{d.assist.tryAsking}</SmallEyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[d.assist.askChip1, d.assist.askChip2, d.assist.askChip3].map((q) => (
                  <Chip key={q} label={q} onPress={() => void ask(q)} />
                ))}
              </View>
            </View>
          ) : null}
          <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium, textAlign: 'center', marginTop: 6 }}>
            {d.assist.disclaimer}
          </Text>
        </ScrollView>
        <Composer value={draft} onChangeText={setDraft} onSend={() => void ask(draft)} placeholder={d.assist.askPlaceholder} disabled={loading} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet frame (units, manage)
// ---------------------------------------------------------------------------

function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.assist.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: screenPadding,
          paddingTop: 10,
          paddingBottom: insets.bottom + 20,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          gap: 12,
          maxHeight: '88%',
        }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
        {children}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Switch units
// ---------------------------------------------------------------------------

export interface UnitsPreviewLine {
  name: string;
  amount: string;
  estimated: boolean;
}

export function UnitsSheet({
  visible,
  system,
  onChange,
  preview,
  estimating,
  onClose,
}: {
  visible: boolean;
  system: UnitSystem;
  onChange: (system: UnitSystem) => void;
  preview: UnitsPreviewLine[];
  estimating: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const options: [UnitSystem, string][] = [
    ['original', d.assist.unitsAsWritten],
    ['metric', d.assist.unitsMetric],
    ['us', d.assist.unitsUs],
  ];
  const anyEstimated = preview.some((p) => p.estimated);
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="swap-horizontal-outline" size={18} color={colors.accent} />
        <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display }}>{d.assist.unitsTitle}</Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: radius.card, padding: 3 }}
      >
        {options.map(([key, label]) => {
          const on = system === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(key)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: radius.control,
                backgroundColor: on ? colors.card : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: on ? colors.text : colors.textMuted, fontSize: fontSize.small, fontFamily: fonts.uiSemi }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView style={{ flexGrow: 0 }}>
        <View style={{ paddingBottom: 6 }}>
          <SmallEyebrow>{d.assist.unitsPreview}</SmallEyebrow>
        </View>
        {preview.slice(0, 12).map((line, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 9,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }} numberOfLines={1}>
              {line.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {line.estimated ? (
                <Ionicons name="sparkles-outline" size={13} color={colors.accent} accessibilityLabel={d.assist.estimatedA11y} />
              ) : null}
              <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] }}>{line.amount}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      {estimating ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>{d.assist.unitsEstimating}</Text>
        </View>
      ) : anyEstimated ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium }}>{d.assist.unitsEstimatedNote}</Text>
      ) : null}
      <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiMedium }}>{d.assist.unitsEveryRecipe}</Text>
      <Button label={d.assist.unitsDone} onPress={onClose} />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Manage My version
// ---------------------------------------------------------------------------

export function ManageVersionSheet({
  visible,
  note,
  onChangeAgain,
  onStartOver,
  onDelete,
  onClose,
}: {
  visible: boolean;
  note: string | null;
  onChangeAgain: () => void;
  onStartOver: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, danger?: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 52,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: fontSize.base, fontFamily: danger ? fonts.uiSemi : fonts.uiMedium }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display }}>{d.assist.manageTitle}</Text>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>{d.assist.manageSubtitle}</Text>
      </View>
      {note ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
          <SmallEyebrow>{d.assist.manageChanges}</SmallEyebrow>
          <Text style={{ color: colors.text, fontSize: fontSize.small, lineHeight: 21, fontFamily: fonts.ui }}>{note}</Text>
        </View>
      ) : null}
      <View>
        {row('sparkles-outline', d.assist.changeAgain, onChangeAgain)}
        {row('refresh-outline', d.assist.startOver, onStartOver)}
        {row('trash-outline', d.assist.deleteVersion, onDelete, true)}
      </View>
    </BottomSheet>
  );
}

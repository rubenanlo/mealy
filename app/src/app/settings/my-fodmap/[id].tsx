import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RatingPicker } from '@/components/fodmap-rating';
import { Body, Button, Eyebrow, Field, Loading, Muted, SettingsGroup, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { canonicalDisplayName, type CanonicalIngredient } from '@/lib/canonical';
import { confirmDestructive, notify } from '@/lib/confirm';
import { fmt, useI18n } from '@/lib/i18n';
import { invalidateCanonicalIngredients, loadCanonicalIngredients } from '@/lib/matching';
import {
  deletePersonalEntry,
  draftFromEntry,
  EMPTY_DRAFT,
  getPersonalEntry,
  listPersonalEntries,
  savePersonalEntry,
  searchCanonical,
  suggestCanonical,
  validateDraft,
  type PersonalFodmapDraft,
  type PersonalFodmapEntry,
} from '@/lib/my-fodmap';
import { backOr } from '@/lib/nav';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

/**
 * Add / edit one entry of the household's FODMAP list. `id === 'new'` is
 * create mode. Linking to a Mealy ingredient is what makes recipes use the
 * rating; it is suggested from the name and can be changed or removed.
 */
export default function MyFodmapEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const router = useRouter();
  const { householdId } = useHousehold();

  const [draft, setDraft] = useState<PersonalFodmapDraft>(EMPTY_DRAFT);
  const [entry, setEntry] = useState<PersonalFodmapEntry | null>(null);
  const [siblings, setSiblings] = useState<PersonalFodmapEntry[]>([]);
  const [table, setTable] = useState<CanonicalIngredient[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  // Until the user touches the link, a new entry follows the name's best match.
  const [linkTouched, setLinkTouched] = useState(!isNew);
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadCanonicalIngredients().then(setTable).catch(() => setTable([]));
    listPersonalEntries().then(setSiblings).catch(() => setSiblings([]));
    if (isNew || !id) return;
    getPersonalEntry(id)
      .then((row) => {
        if (row) {
          setEntry(row);
          setDraft(draftFromEntry(row));
        }
      })
      .finally(() => setLoaded(true));
  }, [id, isNew]);

  const byId = useMemo(() => new Map(table.map((row) => [row.id, row])), [table]);
  const linked = draft.canonical_id ? (byId.get(draft.canonical_id) ?? null) : null;
  const candidates = useMemo(() => searchCanonical(linkQuery, table), [linkQuery, table]);

  const update = (patch: Partial<PersonalFodmapDraft>) => {
    setFormError(null);
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (patch.name !== undefined && !linkTouched) {
        next.canonical_id = suggestCanonical(patch.name, table)?.id ?? null;
      }
      return next;
    });
  };

  const errorText = (code: ReturnType<typeof validateDraft>) =>
    code === 'nameRequired'
      ? d.myFodmap.nameRequired
      : code === 'ratingRequired'
        ? d.myFodmap.ratingRequired
        : code === 'duplicateName'
          ? d.myFodmap.duplicateName
          : null;

  const save = async () => {
    const problem = validateDraft(draft, siblings, isNew ? null : id);
    if (problem) {
      setFormError(errorText(problem));
      return;
    }
    setSaving(true);
    try {
      await savePersonalEntry(householdId, draft, isNew ? null : id);
      invalidateCanonicalIngredients();
      backOr('/settings/my-fodmap');
    } catch (e) {
      notify(d.myFodmap.saveFailed, e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    confirmDestructive({
      title: d.myFodmap.deleteTitle,
      message: fmt(d.myFodmap.deleteBody, { name: draft.name }),
      confirmLabel: d.myFodmap.delete,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        deletePersonalEntry(id)
          .then(() => {
            invalidateCanonicalIngredients();
            router.back();
          })
          .catch((e: unknown) =>
            notify(d.myFodmap.deleteFailed, e instanceof Error ? e.message : undefined)
          );
      },
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
          onPress={() => backOr('/settings/my-fodmap')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.myFodmap.title}</Body>
        </Pressable>
        <Title>{isNew ? d.myFodmap.newTitle : d.myFodmap.editTitle}</Title>

        {!loaded ? (
          <Loading />
        ) : (
          <>
            <Eyebrow style={{ marginTop: 8 }}>{d.myFodmap.name}</Eyebrow>
            <Field
              value={draft.name}
              onChangeText={(name) => update({ name })}
              placeholder={d.myFodmap.namePlaceholder}
              accessibilityLabel={d.myFodmap.name}
              autoFocus={isNew}
            />

            <Eyebrow style={{ marginTop: 8 }}>{d.myFodmap.rating}</Eyebrow>
            <RatingPicker value={draft.rating} onChange={(rating) => update({ rating })} />

            <Eyebrow style={{ marginTop: 8 }}>{d.myFodmap.safePortion}</Eyebrow>
            <Field
              value={draft.safe_portion}
              onChangeText={(safe_portion) => update({ safe_portion })}
              placeholder={d.myFodmap.safePortionPlaceholder}
              accessibilityLabel={d.myFodmap.safePortion}
            />

            <Eyebrow style={{ marginTop: 8 }}>{d.myFodmap.notes}</Eyebrow>
            <Field
              value={draft.notes}
              onChangeText={(notes) => update({ notes })}
              placeholder={d.myFodmap.notesPlaceholder}
              accessibilityLabel={d.myFodmap.notes}
              multiline
              style={{ minHeight: 88, textAlignVertical: 'top' }}
            />

            <SettingsGroup style={{ marginTop: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Body style={{ fontFamily: fonts.uiSemi }}>{d.myFodmap.checkedLabel}</Body>
                  <Muted>
                    {draft.checked && entry?.checked_at
                      ? fmt(d.myFodmap.checkedOn, {
                          date: new Date(entry.checked_at).toLocaleDateString(locale),
                        })
                      : d.myFodmap.checkedHint}
                  </Muted>
                </View>
                <Switch
                  value={draft.checked}
                  onValueChange={(checked) => update({ checked })}
                  accessibilityLabel={d.myFodmap.checkedLabel}
                />
              </View>
            </SettingsGroup>

            <Eyebrow style={{ marginTop: 8 }}>{d.myFodmap.linkedTo}</Eyebrow>
            {linked ? (
              <SettingsGroup>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 52,
                    paddingHorizontal: 16,
                  }}
                >
                  <Body style={{ flex: 1 }}>{canonicalDisplayName(linked, locale)}</Body>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setLinkTouched(true);
                      update({ canonical_id: null });
                    }}
                    style={{ minHeight: minTapTarget, justifyContent: 'center' }}
                  >
                    <Body style={{ color: colors.accent, fontFamily: fonts.uiSemi }}>
                      {d.myFodmap.unlink}
                    </Body>
                  </Pressable>
                </View>
              </SettingsGroup>
            ) : (
              <>
                <Muted>{d.myFodmap.notLinked}</Muted>
                <Field
                  icon="link"
                  value={linkQuery}
                  onChangeText={setLinkQuery}
                  placeholder={d.myFodmap.linkSearchPlaceholder}
                  accessibilityLabel={d.myFodmap.linkSearch}
                  autoCorrect={false}
                />
                {linkQuery.trim() && candidates.length === 0 ? (
                  <Muted>{d.myFodmap.linkNone}</Muted>
                ) : null}
                {candidates.length > 0 ? (
                  <SettingsGroup>
                    {candidates.map((ing) => (
                      <Pressable
                        key={ing.id}
                        accessibilityRole="button"
                        onPress={() => {
                          setLinkTouched(true);
                          setLinkQuery('');
                          update({ canonical_id: ing.id });
                        }}
                        style={({ pressed }) => ({
                          minHeight: 48,
                          paddingHorizontal: 16,
                          justifyContent: 'center',
                          backgroundColor: pressed ? colors.cardPressed : 'transparent',
                        })}
                      >
                        <Body>{canonicalDisplayName(ing, locale)}</Body>
                      </Pressable>
                    ))}
                  </SettingsGroup>
                ) : null}
              </>
            )}

            {formError ? <Body style={{ color: colors.danger }}>{formError}</Body> : null}

            <Button label={d.myFodmap.save} onPress={() => void save()} loading={saving} style={{ marginTop: 16 }} />
            {!isNew && entry ? (
              <Button label={d.myFodmap.delete} kind="danger" onPress={remove} />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

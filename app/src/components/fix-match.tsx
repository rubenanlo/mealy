import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { normalizeRaw, type CanonicalIngredient } from '@/lib/canonical';
import { fmt, useI18n } from '@/lib/i18n';
import { correctMatch, loadCanonicalIngredients } from '@/lib/matching';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

/**
 * User override of an ingredient→canonical match (spec §4): pick the right
 * canonical row (or "No match") for one raw line; stored with
 * matched_by='user' so it wins over exact/alias/llm forever.
 */
export function FixMatchSheet({
  visible,
  raw,
  current,
  onClose,
  onCorrected,
}: {
  visible: boolean;
  raw: string;
  current: CanonicalIngredient | null;
  onClose: () => void;
  onCorrected: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const [table, setTable] = useState<CanonicalIngredient[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    setError(null);
    loadCanonicalIngredients()
      .then(setTable)
      .catch(() => setError(d.components.loadIngredientsError));
  }, [visible, d]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...table].sort((a, b) => a.name_fr.localeCompare(b.name_fr, 'fr'));
    if (!q) return sorted;
    return sorted.filter(
      (row) =>
        row.name_fr.toLowerCase().includes(q) ||
        row.name_en.toLowerCase().includes(q) ||
        row.aliases.some((a) => a.toLowerCase().includes(q))
    );
  }, [table, search]);

  const pick = async (canonicalId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await correctMatch(raw, canonicalId);
      onCorrected();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : d.components.saveCorrectionError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, padding: screenPadding, gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Eyebrow>{d.components.correctMatch}</Eyebrow>
            <Title style={{ fontSize: fontSize.dayName }}>{raw}</Title>
            <Muted>
              {current
                ? fmt(d.components.matchedTo, { name: current.name_fr, raw: normalizeRaw(raw) })
                : fmt(d.components.unmatched, { raw: normalizeRaw(raw) })}
            </Muted>
          </View>
          <Field
            icon="search-outline"
            value={search}
            onChangeText={setSearch}
            placeholder={d.components.searchIngredients}
            autoCapitalize="none"
          />
          {error ? (
            <Text style={{ color: colors.danger, fontSize: fontSize.base, fontFamily: fonts.ui }}>
              {error}
            </Text>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(row) => row.id}
            ItemSeparatorComponent={Hairline}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fmt(d.components.matchTo, { name: item.name_fr })}
                onPress={() => void pick(item.id)}
                disabled={busy}
                style={({ pressed }) => ({
                  minHeight: minTapTarget,
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: fontSize.base,
                      fontFamily: item.id === current?.id ? fonts.uiSemi : fonts.ui,
                    }}
                  >
                    {item.name_fr}
                  </Text>
                  {item.aisle ? <Muted>{item.aisle}</Muted> : null}
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<Muted>{d.components.noIngredientMatch}</Muted>}
          />
          <Button
            label={d.components.noMatchForLine}
            kind="secondary"
            onPress={() => void pick(null)}
            loading={busy}
          />
          <Button label={d.common.cancel} kind="danger" onPress={onClose} disabled={busy} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

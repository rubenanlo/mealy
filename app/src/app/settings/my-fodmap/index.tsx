import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RatingBadge } from '@/components/fodmap-rating';
import { Body, Button, Field, Loading, Muted, SettingsGroup, Title } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import {
  filterEntries,
  listPersonalEntries,
  type ListFilter,
  type PersonalFodmapEntry,
} from '@/lib/my-fodmap';
import { backOr } from '@/lib/nav';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * Settings → My FODMAP list: the household's own ingredient ratings
 * (migration 0035). Tap a row to edit, "Add ingredient" for a new one.
 */
export default function MyFodmapListScreen() {
  const { colors } = useTheme();
  const { d } = useI18n();
  const router = useRouter();
  const [entries, setEntries] = useState<PersonalFodmapEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      listPersonalEntries()
        .then((rows) => {
          setEntries(rows);
          setError(null);
        })
        .catch(() => setError(d.myFodmap.loadFailed));
    }, [d.myFodmap.loadFailed])
  );

  const visible = useMemo(
    () => (entries ? filterEntries(entries, filter, query) : []),
    [entries, filter, query]
  );

  const filters: [ListFilter, string][] = [
    ['all', d.myFodmap.filterAll],
    ['low', d.myFodmap.low],
    ['moderate', d.myFodmap.moderate],
    ['high', d.myFodmap.high],
    ['unchecked', d.myFodmap.filterUnchecked],
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.settings.backToSettings}
          onPress={() => backOr('/settings')}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.settings.title}</Body>
        </Pressable>
        <Title>{d.myFodmap.title}</Title>
        <Muted>{d.myFodmap.intro}</Muted>

        <Button
          label={d.myFodmap.add}
          onPress={() => router.push('/settings/my-fodmap/new')}
          style={{ marginTop: 8 }}
        />

        <Field
          icon="search"
          value={query}
          onChangeText={setQuery}
          placeholder={d.myFodmap.searchPlaceholder}
          autoCorrect={false}
          accessibilityLabel={d.myFodmap.searchPlaceholder}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {filters.map(([value, label]) => {
              const selected = filter === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(value)}
                  style={({ pressed }) => ({
                    minHeight: 36,
                    paddingHorizontal: 14,
                    borderRadius: radius.control,
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : colors.card,
                  })}
                >
                  <Text
                    style={{
                      color: selected ? colors.bg : colors.text,
                      fontFamily: fonts.uiSemi,
                      fontSize: fontSize.meta,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
        {!entries && !error ? <Loading /> : null}
        {entries && entries.length === 0 ? <Muted>{d.myFodmap.empty}</Muted> : null}
        {entries && entries.length > 0 && visible.length === 0 ? (
          <Muted>{d.myFodmap.noResults}</Muted>
        ) : null}
        {entries && entries.length > 0 ? (
          <Muted>{fmt(d.myFodmap.count, { n: visible.length })}</Muted>
        ) : null}

        {visible.length > 0 ? (
          <SettingsGroup>
            {visible.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.name}, ${d.myFodmap[entry.rating]}`}
                onPress={() => router.push(`/settings/my-fodmap/${entry.id}`)}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  gap: 4,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Body style={{ flex: 1, fontFamily: fonts.uiSemi }}>{entry.name}</Body>
                  {entry.checked ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.spineVeg}
                      accessibilityLabel={d.myFodmap.checked}
                    />
                  ) : null}
                  <RatingBadge rating={entry.rating} />
                </View>
                {entry.safe_portion ? (
                  <Muted>
                    {d.myFodmap.safePortion}: {entry.safe_portion}
                  </Muted>
                ) : null}
                {entry.notes ? <Muted numberOfLines={2}>{entry.notes}</Muted> : null}
                {!entry.canonical_id ? (
                  <Muted style={{ fontSize: fontSize.eyebrow }}>{d.myFodmap.notLinked}</Muted>
                ) : null}
              </Pressable>
            ))}
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

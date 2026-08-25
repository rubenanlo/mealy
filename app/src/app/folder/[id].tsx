import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeRow, type RecipeListItem } from '@/components/recipe-cards';
import { Body, Button, Field, Hairline, Loading, Muted, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmt, useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

/** One folder's recipes (spec 2026-08-24). Owner renames/deletes; family views. */
export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { d } = useI18n();

  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const isMine = ownerId !== null && ownerId === session?.user.id;

  const load = useCallback(async () => {
    if (!id) return;
    const { data: folder } = await supabase
      .from('folders')
      .select('name, owner_id')
      .eq('id', id)
      .single();
    if (!folder) return;
    setName(folder.name);
    setOwnerId(folder.owner_id);
    const [{ data: links }, { data: member }] = await Promise.all([
      supabase
        .from('folder_recipes')
        .select('recipe_id, added_at')
        .eq('folder_id', id)
        .order('added_at', { ascending: false }),
      supabase
        .from('household_members')
        .select('email')
        .eq('user_id', folder.owner_id)
        .maybeSingle(),
    ]);
    setOwnerEmail(member?.email ?? null);
    const ids = ((links ?? []) as { recipe_id: string }[]).map((l) => l.recipe_id);
    if (ids.length === 0) {
      setRecipes([]);
      setLoaded(true);
      return;
    }
    const { data: recipeRows } = await supabase
      .from('recipes')
      .select(
        'id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes, created_at, ingredients, fodmap_override'
      )
      .in('id', ids);
    const order = new Map(ids.map((rid, i) => [rid, i]));
    setRecipes(
      ((recipeRows as RecipeListItem[]) ?? [])
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    );
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || !id) return;
    const { error } = await supabase.from('folders').update({ name: trimmed }).eq('id', id);
    if (error) {
      Alert.alert(
        d.library.couldNotRename,
        error.code === '23505' ? d.library.duplicateFolderName : d.library.tryAgain
      );
      return;
    }
    setRenaming(false);
  };

  const removeFolder = () => {
    Alert.alert(d.library.deleteFolderTitle, fmt(d.library.deleteFolderBody, { name }), [
      { text: d.common.cancel, style: 'cancel' },
      {
        text: d.common.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await supabase.from('folders').delete().eq('id', id);
            router.back();
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
          onPress={() => router.back()}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.common.back}</Body>
        </Pressable>

        {renaming ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field
              value={name}
              onChangeText={setName}
              style={{ flex: 1 }}
              onSubmitEditing={() => void rename()}
              autoFocus
            />
            <Button label={d.common.save} kind="secondary" onPress={() => void rename()} />
          </View>
        ) : (
          <Title>{name || d.library.folderFallback}</Title>
        )}
        {!loaded ? <Loading /> : null}
        {loaded ? (
        <Muted>
          {fmt(recipes.length === 1 ? d.library.recipeCountOne : d.library.recipeCountMany, {
            count: recipes.length,
          })}
          {!isMine && ownerEmail ? ` · ${ownerEmail}` : ''}
        </Muted>
        ) : null}

        <View>
          {loaded ? recipes.map((recipe, i) => (
            <View key={recipe.id}>
              {i > 0 ? <Hairline /> : null}
              <RecipeRow recipe={recipe} onPress={() => router.push(`/recipe/${recipe.id}`)} />
            </View>
          )) : null}
          {loaded && recipes.length === 0 ? (
            <Muted>{isMine ? d.library.folderEmptyMine : d.library.folderEmptyOther}</Muted>
          ) : null}
        </View>

        {isMine ? (
          <View style={{ gap: 10 }}>
            {!renaming ? (
              <Button
                label={d.library.renameFolder}
                kind="secondary"
                onPress={() => setRenaming(true)}
              />
            ) : null}
            <Button label={d.library.deleteFolder} kind="danger" onPress={removeFolder} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

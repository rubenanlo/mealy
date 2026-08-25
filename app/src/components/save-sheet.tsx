import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

interface FolderOption {
  id: string;
  name: string;
  hasRecipe: boolean;
}

/** Bookmark tap: save the recipe into my folders (spec 2026-08-24). */
export function SaveSheet({
  visible,
  recipeId,
  recipeTitle,
  householdId,
  userId,
  onClose,
  onAddToWeek,
  onChanged,
}: {
  visible: boolean;
  recipeId: string;
  recipeTitle: string;
  householdId: string;
  userId: string;
  onClose: () => void;
  onAddToWeek: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: mine }, { data: links }] = await Promise.all([
      supabase.from('folders').select('id, name').eq('owner_id', userId).order('name'),
      supabase.from('folder_recipes').select('folder_id').eq('recipe_id', recipeId),
    ]);
    const has = new Set(((links ?? []) as { folder_id: string }[]).map((l) => l.folder_id));
    setFolders(
      ((mine ?? []) as { id: string; name: string }[]).map((f) => ({
        ...f,
        hasRecipe: has.has(f.id),
      }))
    );
  }, [recipeId, userId]);

  useEffect(() => {
    if (visible) {
      setError(null);
      setNewName('');
      void load();
    }
  }, [visible, load]);

  const toggle = async (folder: FolderOption) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folder.id ? { ...f, hasRecipe: !f.hasRecipe } : f))
    );
    if (folder.hasRecipe) {
      await supabase
        .from('folder_recipes')
        .delete()
        .eq('folder_id', folder.id)
        .eq('recipe_id', recipeId);
    } else {
      await supabase.from('folder_recipes').insert({ folder_id: folder.id, recipe_id: recipeId });
    }
    onChanged();
  };

  const createAndSave = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const { data, error: err } = await supabase
      .from('folders')
      .insert({ household_id: householdId, owner_id: userId, name })
      .select('id')
      .single();
    if (err || !data) {
      setError(
        err?.code === '23505' ? d.components.folderExistsError : d.components.createFolderError
      );
      return;
    }
    await supabase.from('folder_recipes').insert({ folder_id: data.id, recipe_id: recipeId });
    setNewName('');
    onChanged();
    await load();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.card * 2,
          borderTopRightRadius: radius.card * 2,
          maxHeight: '75%',
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <ScrollView
            contentContainerStyle={{ padding: screenPadding, gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <Title>{d.components.saveRecipe}</Title>
            <Muted>{recipeTitle}</Muted>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.components.addToThisWeek}
              onPress={onAddToWeek}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: minTapTarget,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.text} />
              <Body style={{ flex: 1 }}>{d.components.addToThisWeek}</Body>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
            <Hairline />

            <Eyebrow>{d.components.yourFolders}</Eyebrow>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: folder.hasRecipe }}
                accessibilityLabel={folder.name}
                onPress={() => void toggle(folder)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: minTapTarget,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons
                  name={folder.hasRecipe ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={folder.hasRecipe ? colors.accent : colors.textMuted}
                />
                <Body style={{ flex: 1 }}>{folder.name}</Body>
              </Pressable>
            ))}
            {folders.length === 0 ? <Muted>{d.components.noFoldersYet}</Muted> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field
                value={newName}
                onChangeText={setNewName}
                placeholder={d.components.newFolderName}
                style={{ flex: 1 }}
                onSubmitEditing={() => void createAndSave()}
              />
              <Button label={d.components.create} kind="secondary" onPress={() => void createAndSave()} />
            </View>
            {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

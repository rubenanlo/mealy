import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Body, Button, Title } from '@/components/ui';
import { setConfirmPresenter, type ConfirmRequest } from '@/lib/confirm';
import { useTheme } from '@/lib/theme';

/**
 * Styled stand-in for the browser's window.confirm: confirmDestructive routes
 * here on web (native keeps the system Alert). Mounted once in the root
 * layout; requests arrive imperatively via setConfirmPresenter.
 */
export function ConfirmHost() {
  const { colors } = useTheme();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    setConfirmPresenter(setRequest);
    return () => setConfirmPresenter(null);
  }, []);

  // Web modals stack in portal mount order, not show order: keeping this Modal
  // mounted from boot puts it *under* any screen-level modal that is open when
  // a request arrives (e.g. the plan picker). Mount only on demand, like
  // OptionPickerHost, so the portal is appended last and lands on top.
  if (!request) return null;

  const dismiss = () => setRequest(null);
  const confirm = () => {
    const run = request.onConfirm;
    setRequest(null);
    run();
  };
  const cancel = () => {
    const run = request.onCancel;
    setRequest(null);
    run?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        onPress={dismiss}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        {/* Stop backdrop-press from reaching the card. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 400,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 20,
            gap: 12,
          }}
        >
          <Title>{request.title}</Title>
          {request.message ? <Body>{request.message}</Body> : null}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label={request.cancelLabel} kind="secondary" onPress={cancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={request.confirmLabel}
                kind={request.destructive === false ? 'primary' : 'danger'}
                onPress={confirm}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

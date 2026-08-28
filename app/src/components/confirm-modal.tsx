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

  const dismiss = () => setRequest(null);
  const confirm = () => {
    const run = request?.onConfirm;
    setRequest(null);
    run?.();
  };
  const cancel = () => {
    const run = request?.onCancel;
    setRequest(null);
    run?.();
  };

  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
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
          {request ? (
            <>
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
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

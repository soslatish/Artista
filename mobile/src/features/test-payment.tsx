// Тестовая оплата: пока платёжный провайдер не подключён, деньги не списываются.
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { errorText, post } from '@/api/client';
import type { Payment } from '@/api/types';
import { formatPrice } from '@/lib/format';
import { Button, Notice, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

interface Props {
  payment: Payment | null;
  purpose: string;
  onPaid: () => void;
  onCancel: () => void;
}

export function TestPaymentSheet({ payment, purpose, onPaid, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pay = async () => {
    if (!payment) return;
    setBusy(true);
    setError('');
    try {
      await post(`/payments/${payment.id}/stub-confirm`);
      onPaid();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={!!payment} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <T variant="title">Оплата</T>
          <T variant="body">{purpose}</T>
          <T variant="display">{payment ? formatPrice(payment.amount_kop) : ''}</T>
          <Notice text="Тестовый режим: платёжная система ещё не подключена, деньги не списываются." />
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title="Оплатить (тест)" loading={busy} onPress={pay} />
          <Button title="Отмена" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,26,27,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.wall, padding: space.xl, paddingBottom: space.xxl, gap: space.md, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
});

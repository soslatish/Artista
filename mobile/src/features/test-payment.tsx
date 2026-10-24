// Тестовая оплата: пока платёжный провайдер не подключён, деньги не списываются.
import { useState } from 'react';
import { Modal, View } from 'react-native';

import { errorText, post } from '@/api/client';
import type { Payment } from '@/api/types';
import { useT } from '@/i18n';
import { formatPrice } from '@/lib/format';
import { Button, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

interface Props {
  payment: Payment | null;
  purpose: string;
  onPaid: () => void;
  onCancel: () => void;
}

export function TestPaymentSheet({ payment, purpose, onPaid, onCancel }: Props) {
  const t = useT();
  const styles = useStyles();
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
          <T variant="title">{t('Оплата')}</T>
          <T variant="body">{purpose}</T>
          <T variant="priceLarge">{payment ? formatPrice(payment.amount_kop) : ''}</T>
          <Notice text={t('Тестовый режим: платёжная система ещё не подключена, деньги не списываются.')} />
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title={t('Оплатить (тест)')} loading={busy} onPress={pay} />
          <Button title={t('Отмена')} variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.wall, padding: space.xl, paddingBottom: space.xxl, gap: space.md, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
}));

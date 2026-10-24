import { View } from 'react-native';

import { useT } from '@/i18n';
import type { AddressForm } from '@/lib/validation';
import { Field } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

interface AddressFieldsProps {
  value: AddressForm;
  onChange: (next: AddressForm) => void;
  errors: Record<string, string>;
}

/** Поля адреса доставки; ошибки сервера приходят с префиксом address. */
export function AddressFields({ value, onChange, errors }: AddressFieldsProps) {
  const t = useT();
  const styles = useStyles();
  const set = (k: keyof AddressForm) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <View style={styles.box}>
      <Field label={t('Город')} value={value.city} onChangeText={set('city')} error={errors['address.city']} autoComplete="address-line2" />
      <Field label={t('Улица, дом, квартира')} value={value.street} onChangeText={set('street')} error={errors['address.street']} autoComplete="street-address" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label={t('Индекс')} value={value.postal_code} onChangeText={set('postal_code')} keyboardType="number-pad" maxLength={6} error={errors['address.postal_code']} autoComplete="postal-code" />
        </View>
        <View style={styles.flex2}>
          <Field label={t('Телефон')} value={value.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors['address.phone']} autoComplete="tel" placeholder="+7" />
        </View>
      </View>
      <Field label={t('Получатель')} value={value.recipient_name} onChangeText={set('recipient_name')} error={errors['address.recipient_name']} autoComplete="name" />
      <Field label={t('Комментарий курьеру')} value={value.comment} onChangeText={set('comment')} maxLength={300} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  box: { gap: space.lg },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  flex2: { flex: 2 },
}));

import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, fieldErrors, post } from '@/api/client';
import { useArtwork, useDeliveryQuotes } from '@/api/hooks';
import type { DeliveryMethod, Order, Payment } from '@/api/types';
import { useSession } from '@/auth/session';
import { TestPaymentSheet } from '@/features/test-payment';
import { formatPrice, plural } from '@/lib/format';
import { validId } from '@/lib/guard';
import { type AddressForm, validateAddress } from '@/lib/validation';
import { Button, Divider, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const methodNames: Record<DeliveryMethod, string> = {
  cdek: 'СДЭК',
  express: 'Курьер за 2–4 часа',
  post: 'Почта России',
};

function useDebounced(v: string, ms = 500) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function CheckoutRoute() {
  const id = validId(useLocalSearchParams().artworkId);
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <Checkout artworkId={id} />;
}

function Checkout({ artworkId }: { artworkId: string }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const art = useArtwork(artworkId);
  const [addr, setAddr] = useState<AddressForm>({
    city: user?.city ?? '',
    street: '',
    postal_code: '',
    recipient_name: user?.name ?? '',
    phone: '',
    comment: '',
  });
  const city = useDebounced(addr.city);
  const quotes = useDeliveryQuotes(artworkId, city);
  const [method, setMethod] = useState<DeliveryMethod | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const set = (k: keyof AddressForm) => (v: string) => setAddr((a) => ({ ...a, [k]: v }));

  const available = quotes.data ?? [];
  // если выбранный способ недоступен в этом городе — берём первый доступный
  const selected = available.find((q) => q.method === method) ?? available[0] ?? null;

  if (art.isLoading) return <Loading />;
  if (art.isError || !art.data) return <ErrorState text={errorText(art.error)} />;
  const a = art.data;
  // после создания заказа сумма и адрес фиксируются: платим ровно то, что записано в заказе
  const locked = !!order;
  const total = order ? order.total_kop : a.price_kop + (selected?.price_kop ?? 0);

  const submit = async () => {
    const errs = validateAddress(addr);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setError('Заполните адрес доставки');
      return;
    }
    if (!selected && !order) {
      setError('Выберите способ доставки');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const o = order ?? (await post<Order>('/orders', { artwork_id: a.id, delivery_method: selected?.method, address: addr }));
      setOrder(o);
      const p = await post<Payment>(`/orders/${o.id}/pay`);
      if (p.test_mode) setPayment(p);
      // боевой провайдер: здесь откроется p.confirmation_url
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const paid = () => {
    setPayment(null);
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['artworks'] });
    if (order) router.replace({ pathname: '/orders/[id]', params: { id: order.id } });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.item}>
          {a.images[0] ? <Image source={{ uri: a.images[0] }} style={styles.thumb} contentFit="cover" /> : null}
          <View style={styles.flex}>
            <T variant="artTitle">{a.title}</T>
            <T variant="small">{a.artist.name}</T>
            <T variant="price">{formatPrice(a.price_kop)}</T>
          </View>
        </View>

        <T variant="title">Доставка</T>
        {locked ? <Notice text="Заказ создан — адрес и доставка зафиксированы. Чтобы изменить их, отмените заказ в разделе «Мои заказы»." /> : null}
        <Field label="Город" value={addr.city} onChangeText={set('city')} error={errors['address.city']} autoComplete="address-line2" editable={!locked} />
        {quotes.isFetching ? <T variant="small">Считаем доставку…</T> : null}
        {quotes.isError ? <Notice tone="danger" text={errorText(quotes.error)} /> : null}
        <View style={styles.methods} accessibilityRole="radiogroup">
          {available.map((q) => (
            <Pressable
              key={q.method}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected?.method === q.method }}
              disabled={locked}
              onPress={() => setMethod(q.method)}
              style={[styles.method, selected?.method === q.method && styles.methodOn]}>
              <View style={styles.flex}>
                <T variant="bodyStrong">{methodNames[q.method]}</T>
                <T variant="small">
                  {q.days_min === q.days_max ? `${q.days_min} ${plural(q.days_min, ['день', 'дня', 'дней'])}` : `${q.days_min}–${q.days_max} ${plural(q.days_max, ['день', 'дня', 'дней'])}`}
                </T>
              </View>
              <T variant="bodyStrong">{q.price_kop === 0 ? 'Бесплатно' : formatPrice(q.price_kop)}</T>
            </Pressable>
          ))}
        </View>
        <Field label="Улица, дом, квартира" value={addr.street} onChangeText={set('street')} error={errors['address.street']} autoComplete="street-address" editable={!locked} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="Индекс" value={addr.postal_code} onChangeText={set('postal_code')} keyboardType="number-pad" maxLength={6} error={errors['address.postal_code']} autoComplete="postal-code" editable={!locked} />
          </View>
          <View style={styles.flex2}>
            <Field label="Телефон" value={addr.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors['address.phone']} autoComplete="tel" placeholder="+7" editable={!locked} />
          </View>
        </View>
        <Field label="Получатель" value={addr.recipient_name} onChangeText={set('recipient_name')} error={errors['address.recipient_name']} autoComplete="name" editable={!locked} />
        <Field label="Комментарий курьеру" value={addr.comment} onChangeText={set('comment')} maxLength={300} editable={!locked} />

        <Divider />
        <Line label="Работа" value={formatPrice(a.price_kop)} />
        <Line
          label="Доставка"
          value={order ? (order.delivery_kop === 0 ? 'Бесплатно' : formatPrice(order.delivery_kop)) : selected ? (selected.price_kop === 0 ? 'Бесплатно' : formatPrice(selected.price_kop)) : '—'}
        />
        <Line label="Итого" value={formatPrice(total)} strong />
        <Notice tone="success" text="Деньги переводятся художнику только после того, как вы подтвердите получение. Возврат — в течение 14 дней." />
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={`Оплатить ${formatPrice(total)}`} loading={busy} onPress={submit} disabled={!selected && !order} />
      </ScrollView>
      <TestPaymentSheet payment={payment} purpose={`«${a.title}», ${a.artist.name}`} onPaid={paid} onCancel={() => setPayment(null)} />
    </KeyboardAvoidingView>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <T variant={strong ? 'heading' : 'body'}>{label}</T>
      <T variant={strong ? 'heading' : 'body'}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.lg, gap: space.lg },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art },
  flex: { flex: 1 },
  flex2: { flex: 2 },
  row: { flexDirection: 'row', gap: space.md },
  methods: { gap: space.sm },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.paper },
  methodOn: { borderColor: colors.bordeaux, borderWidth: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});

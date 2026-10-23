import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { useOrder, useOrderAction } from '@/api/hooks';
import type { Conversation, Order, Payment } from '@/api/types';
import { orderStatusLabel, StatusTimeline, statusTone } from '@/features/order-status';
import { TestPaymentSheet } from '@/features/test-payment';
import { formatDate, formatPrice, formatTimeLeft } from '@/lib/format';
import { confirmAction } from '@/lib/confirm';
import { validId } from '@/lib/guard';
import { Button, Divider, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const methodNames = { cdek: 'СДЭК', express: 'Курьер за 2–4 часа', post: 'Почта России' } as const;

export default function OrderRoute() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <OrderScreen id={id} />;
}

function OrderScreen({ id }: { id: string }) {
  const q = useOrder(id);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <OrderView o={q.data} refetch={() => q.refetch()} />;
}

function OrderView({ o, refetch }: { o: Order; refetch: () => void }) {
  const action = useOrderAction(o.id);
  const [tracking, setTracking] = useState('');
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const isArtist = o.my_role === 'artist';
  const other = isArtist ? o.buyer : o.artist;

  const run = (name: string, body?: object) =>
    action.mutate({ action: name, body }, { onError: (e) => setError(errorText(e)), onSuccess: () => setError('') });

  const confirmRun = (title: string, text: string, name: string, destructive = false) =>
    confirmAction(title, text, () => run(name), { destructive });

  const pay = async () => {
    try {
      setPayment(await post<Payment>(`/orders/${o.id}/pay`));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const chat = async () => {
    try {
      const c = await post<Conversation>('/conversations', { user_id: other.id, artwork_id: o.artwork.id });
      router.push({ pathname: '/chat/[id]', params: { id: c.id, name: other.name } });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const deadlineText = o.deadline_at ? formatTimeLeft(o.deadline_at) : '';
  const hint = hintFor(o, deadlineText);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: o.artwork.id } })} style={styles.item}>
          {o.artwork.image_url ? <Image source={{ uri: o.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : null}
          <View style={styles.flex}>
            <T variant="artTitle">{o.artwork.title}</T>
            <T variant="small">
              {isArtist ? 'Покупатель' : 'Художник'}: {other.name}
            </T>
            <T variant="smallStrong" color={statusTone(o.status)}>
              {orderStatusLabel[o.status]}
            </T>
          </View>
        </Pressable>

        {hint ? <Notice tone={o.status === 'cancelled' ? 'danger' : 'info'} text={hint} /> : null}
        <StatusTimeline o={o} />
        {error ? <Notice tone="danger" text={error} /> : null}

        {/* действия по роли и статусу */}
        {!isArtist && o.status === 'awaiting_payment' ? (
          <>
            <Button title={`Оплатить ${formatPrice(o.total_kop)}`} onPress={pay} />
            <Button title="Отменить заказ" variant="ghost" onPress={() => confirmRun('Отменить заказ?', 'Работа снова станет доступна другим.', 'cancel', true)} />
          </>
        ) : null}
        {!isArtist && o.status === 'paid' ? (
          <Button title="Отменить и вернуть деньги" variant="danger" onPress={() => confirmRun('Отменить заказ?', 'Деньги вернутся на карту.', 'cancel', true)} />
        ) : null}
        {!isArtist && o.status === 'shipped' ? (
          <Button title="Я получил работу" loading={action.isPending} onPress={() => confirmRun('Подтвердить получение?', 'Проверьте работу: после подтверждения деньги уйдут художнику.', 'complete')} />
        ) : null}
        {isArtist && o.status === 'paid' ? (
          <>
            <Button title="Подтвердить заказ" loading={action.isPending} onPress={() => run('confirm')} />
            <Button title="Отказаться" variant="danger" onPress={() => confirmRun('Отказаться от заказа?', 'Покупателю вернутся деньги, работа снова будет в продаже.', 'decline', true)} />
          </>
        ) : null}
        {isArtist && o.status === 'confirmed' ? (
          <View style={styles.ship}>
            <Field label="Трек-номер отправления" value={tracking} onChangeText={setTracking} autoCapitalize="characters" placeholder="Например, 1234567890" />
            <Button title="Отметить отправку" loading={action.isPending} disabled={tracking.trim().length < 4} onPress={() => run('ship', { tracking_number: tracking.trim() })} />
          </View>
        ) : null}
        {!isArtist && o.status === 'completed' && !o.has_review ? <ReviewForm orderId={o.id} onDone={refetch} /> : null}

        <Button title={isArtist ? 'Написать покупателю' : 'Написать художнику'} variant="secondary" onPress={chat} />

        <Divider />
        <T variant="heading">Доставка</T>
        <T variant="body">
          {methodNames[o.delivery_method]}
          {o.tracking_number ? `, трек ${o.tracking_number}` : ''}
        </T>
        <T variant="body">
          {o.address.recipient_name}, {o.address.phone}
        </T>
        <T variant="small">
          {[o.address.postal_code, o.address.city, o.address.street].filter(Boolean).join(', ')}
        </T>
        {o.address.comment ? <T variant="small">Комментарий: {o.address.comment}</T> : null}

        <Divider />
        <Line label="Работа" value={formatPrice(o.price_kop)} />
        <Line label="Доставка" value={o.delivery_kop ? formatPrice(o.delivery_kop) : 'Бесплатно'} />
        {isArtist ? (
          <>
            <Line label="Комиссия Artista" value={o.commission_kop ? `−${formatPrice(o.commission_kop)}` : '0 ₽'} />
            <Line label="Вам к выплате" value={formatPrice(o.payout_kop ?? 0)} strong />
            <T variant="small">{payoutText(o.payout_status)}</T>
          </>
        ) : (
          <Line label="Итого" value={formatPrice(o.total_kop)} strong />
        )}
        <T variant="small">Заказ от {formatDate(o.created_at)}</T>
      </ScrollView>
      <TestPaymentSheet
        payment={payment}
        purpose={`«${o.artwork.title}»`}
        onPaid={() => {
          setPayment(null);
          refetch();
        }}
        onCancel={() => setPayment(null)}
      />
    </KeyboardAvoidingView>
  );
}

function hintFor(o: Order, left: string): string {
  const artist = o.my_role === 'artist';
  switch (o.status) {
    case 'awaiting_payment':
      return artist ? 'Покупатель ещё не оплатил заказ.' : `Оплатите заказ — бронь работы действует ещё ${left}.`;
    case 'paid':
      return artist ? `Подтвердите, что работа в наличии. Осталось ${left}, иначе заказ отменится.` : `Ждём подтверждения художника (до ${left}).`;
    case 'confirmed':
      return artist ? `Упакуйте и отправьте работу, затем укажите трек-номер. Осталось ${left}.` : 'Художник готовит работу к отправке.';
    case 'shipped':
      return artist ? 'Ждём, когда покупатель подтвердит получение.' : `Работа в пути. Получение подтвердится автоматически через ${left}.`;
    case 'cancelled':
      return o.cancel_reason || 'Заказ отменён.';
    default:
      return '';
  }
}

function payoutText(s?: Order['payout_status']): string {
  switch (s) {
    case 'held':
      return 'Деньги зарезервированы и поступят после подтверждения получения.';
    case 'released':
      return 'Выплата переведена.';
    case 'refunded':
      return 'Деньги возвращены покупателю.';
    default:
      return '';
  }
}

function ReviewForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/orders/${orderId}/review`, { rating, text: text.trim() });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.review}>
      <T variant="heading">Как вам работа?</T>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Оценка">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: n === rating }}
            accessibilityLabel={`${n} из 5`}
            onPress={() => setRating(n)}
            hitSlop={6}>
            <T variant="display" color={n <= rating ? colors.gold : colors.hairline}>
              ★
            </T>
          </Pressable>
        ))}
      </View>
      <Field label="Отзыв" value={text} onChangeText={setText} multiline maxLength={2000} placeholder="Упаковка, соответствие фото, общение с художником" />
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title="Оставить отзыв" disabled={!rating} loading={busy} onPress={submit} />
    </View>
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
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art },
  flex: { flex: 1 },
  ship: { gap: space.md },
  review: { gap: space.md, padding: space.lg, borderRadius: radius.control, backgroundColor: colors.goldSoft },
  stars: { flexDirection: 'row', gap: space.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});

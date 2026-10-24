import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { useOrder, useOrderAction } from '@/api/hooks';
import type { Conversation, Order, Payment } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { orderStatusLabel, StatusTimeline, statusTone } from '@/features/order-status';
import { pickPhotos } from '@/features/pick-photos';
import { TestPaymentSheet } from '@/features/test-payment';
import { type TFunc, useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { formatDate, formatPrice, formatTimeLeft } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, Divider, ErrorState, Field, Line, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const methodNames = { cdek: 'СДЭК', express: 'Курьер за 2–4 часа', post: 'Почта России' } as const;

export default function OrderRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <OrderScreen id={id} />;
}

function OrderScreen({ id }: { id: string }) {
  const q = useOrder(id);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <OrderView o={q.data} refetch={() => q.refetch()} />;
}

function OrderView({ o, refetch }: { o: Order; refetch: () => void }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const action = useOrderAction(o.id);
  const [tracking, setTracking] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const isArtist = o.my_role === 'artist';
  const other = isArtist ? o.buyer : o.artist;

  const run = (name: string, body?: object) => action.mutate({ action: name, body }, { onError: (e) => setError(errorText(e)), onSuccess: () => setError('') });

  const confirmRun = (title: string, text: string, name: string, destructive = false) => confirmAction(title, text, () => run(name), { destructive });

  const pay = async () => {
    try {
      setPayment(await post<Payment>(`/orders/${o.id}/pay`));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const chat = async () => {
    try {
      const c = await post<Conversation>('/conversations', { user_id: other.id, artwork_id: o.kind === 'commission' ? undefined : o.artwork.id });
      router.push({ pathname: '/chat/[id]', params: { id: c.id, name: other.name } });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const addResultPhoto = async () => {
    const [asset] = await pickPhotos('library', 1);
    if (!asset) return;
    setUploading(true);
    try {
      const url = await uploadImage(asset);
      setPhotos((p) => [...p, url].slice(0, 10));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const deadlineText = o.deadline_at ? formatTimeLeft(o.deadline_at) : '';
  const hint = hintFor(o, deadlineText, t);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          disabled={o.kind === 'commission'}
          onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: o.artwork.id } })}
          style={styles.item}>
          {o.artwork.image_url ? <Image source={{ uri: o.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
          <View style={styles.flex}>
            <T variant="artTitle">{o.artwork.title}</T>
            <T variant="small">
              {isArtist ? t('Покупатель') : t('Художник')}: {other.name}
            </T>
            <T variant="smallStrong" color={statusTone(o.status, colors)}>
              {orderStatusLabel(o.status, t)}
            </T>
          </View>
        </Pressable>

        {hint ? <Notice tone={o.status === 'cancelled' ? 'danger' : 'info'} text={hint} /> : null}
        <StatusTimeline o={o} />
        {error ? <Notice tone="danger" text={error} /> : null}

        {/* действия по роли и статусу */}
        {!isArtist && o.status === 'awaiting_payment' ? (
          <>
            <Button title={t('Оплатить {sum}', { sum: formatPrice(o.total_kop) })} onPress={pay} />
            <Button title={t('Отменить заказ')} variant="ghost" onPress={() => confirmRun(t('Отменить заказ?'), t('Работа снова станет доступна другим.'), 'cancel', true)} />
          </>
        ) : null}
        {!isArtist && o.status === 'paid' ? (
          <Button title={t('Отменить и вернуть деньги')} variant="danger" onPress={() => confirmRun(t('Отменить заказ?'), t('Деньги вернутся на карту.'), 'cancel', true)} />
        ) : null}
        {!isArtist && o.status === 'shipped' ? (
          <Button
            title={t('Я получил работу')}
            loading={action.isPending}
            onPress={() => confirmRun(t('Подтвердить получение?'), t('Проверьте работу: после подтверждения деньги уйдут художнику.'), 'complete')}
          />
        ) : null}
        {!isArtist && o.status === 'completed' ? (
          <Button title={t('Сертификат подлинности')} variant="secondary" icon="ribbon-outline" onPress={() => router.push('/certificates')} />
        ) : null}
        {isArtist && o.status === 'paid' ? (
          <>
            <Button title={o.kind === 'commission' ? t('Начать работу') : t('Подтвердить заказ')} loading={action.isPending} onPress={() => run('confirm')} />
            <Button title={t('Отказаться')} variant="danger" onPress={() => confirmRun(t('Отказаться от заказа?'), t('Покупателю вернутся деньги, работа снова будет в продаже.'), 'decline', true)} />
          </>
        ) : null}
        {isArtist && o.status === 'confirmed' ? (
          <View style={styles.ship}>
            {o.kind === 'commission' ? (
              <View style={styles.ship}>
                <T variant="heading">{t('Фото готовой работы')}</T>
                <T variant="small">{t('Покупатель увидит их в заказе, они же попадут в сертификат.')}</T>
                <ScrollView horizontal contentContainerStyle={styles.photos} showsHorizontalScrollIndicator={false}>
                  {photos.map((u) => (
                    <Image key={u} source={{ uri: u }} style={styles.photo} contentFit="cover" />
                  ))}
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Добавить фото')} onPress={addResultPhoto} style={[styles.photo, styles.photoAdd]}>
                    {uploading ? <ActivityIndicator color={colors.bordeaux} /> : <Ionicons name="add" size={26} color={colors.bordeaux} />}
                  </Pressable>
                </ScrollView>
              </View>
            ) : null}
            <Field label={t('Трек-номер отправления')} value={tracking} onChangeText={setTracking} autoCapitalize="characters" placeholder={t('Например, 1234567890')} />
            <Button
              title={t('Отметить отправку')}
              loading={action.isPending}
              disabled={tracking.trim().length < 4 || uploading}
              onPress={() => run('ship', { tracking_number: tracking.trim(), ...(photos.length ? { images: photos } : {}) })}
            />
          </View>
        ) : null}
        {!isArtist && o.status === 'completed' && !o.has_review ? <ReviewForm orderId={o.id} onDone={refetch} /> : null}

        <Button title={isArtist ? t('Написать покупателю') : t('Написать художнику')} variant="secondary" onPress={chat} />

        <Divider />
        <T variant="heading">{t('Доставка')}</T>
        <T variant="body">
          {t(methodNames[o.delivery_method])}
          {o.tracking_number ? `, ${t('трек')} ${o.tracking_number}` : ''}
        </T>
        <T variant="body">
          {o.address.recipient_name}, {o.address.phone}
        </T>
        <T variant="small">{[o.address.postal_code, o.address.city, o.address.street].filter(Boolean).join(', ')}</T>
        {o.address.comment ? (
          <T variant="small">
            {t('Комментарий')}: {o.address.comment}
          </T>
        ) : null}

        <Divider />
        <Line label={t('Работа')} value={formatPrice(o.price_kop)} />
        <Line label={t('Доставка')} value={o.delivery_kop ? formatPrice(o.delivery_kop) : t('Бесплатно')} />
        {isArtist ? (
          <>
            <Line label={t('Комиссия Artista')} value={o.commission_kop ? `−${formatPrice(o.commission_kop)}` : '0 ₽'} />
            <Line label={t('Вам к выплате')} value={formatPrice(o.payout_kop ?? 0)} strong />
            <T variant="small">{payoutText(o.payout_status, t)}</T>
          </>
        ) : (
          <Line label={t('Итого')} value={formatPrice(o.total_kop)} strong />
        )}
        <T variant="small">{t('Заказ от {date}', { date: formatDate(o.created_at) })}</T>
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

function hintFor(o: Order, left: string, t: TFunc): string {
  const artist = o.my_role === 'artist';
  switch (o.status) {
    case 'awaiting_payment':
      return artist ? t('Покупатель ещё не оплатил заказ.') : t('Оплатите заказ — бронь работы действует ещё {left}.', { left });
    case 'paid':
      return artist ? t('Подтвердите, что работа в наличии. Осталось {left}, иначе заказ отменится.', { left }) : t('Ждём подтверждения художника (до {left}).', { left });
    case 'confirmed':
      if (o.kind === 'commission') return artist ? t('Пишите работу и отправьте её в срок. Осталось {left}.', { left }) : t('Художник работает над заказом. Эскизы и вопросы — в чате.');
      return artist ? t('Упакуйте и отправьте работу, затем укажите трек-номер. Осталось {left}.', { left }) : t('Художник готовит работу к отправке.');
    case 'shipped':
      return artist ? t('Ждём, когда покупатель подтвердит получение.') : t('Работа в пути. Получение подтвердится автоматически через {left}.', { left });
    case 'cancelled':
      return o.cancel_reason ? t(o.cancel_reason) : t('Заказ отменён.');
    default:
      return '';
  }
}

function payoutText(s: Order['payout_status'], t: TFunc): string {
  switch (s) {
    case 'held':
      return t('Деньги зарезервированы и поступят после подтверждения получения.');
    case 'released':
      return t('Выплата переведена.');
    case 'refunded':
      return t('Деньги возвращены покупателю.');
    default:
      return '';
  }
}

function ReviewForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
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
      <T variant="heading">{t('Как вам работа?')}</T>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={t('Оценка')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: n === rating }} accessibilityLabel={t('{n} из 5', { n })} onPress={() => setRating(n)} hitSlop={6}>
            <T variant="display" color={n <= rating ? colors.gold : colors.hairline}>
              ★
            </T>
          </Pressable>
        ))}
      </View>
      <Field label={t('Отзыв')} value={text} onChangeText={setText} multiline maxLength={2000} placeholder={t('Упаковка, соответствие фото, общение с художником')} />
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title={t('Оставить отзыв')} disabled={!rating} loading={busy} onPress={submit} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art, backgroundColor: c.plaster },
  flex: { flex: 1 },
  ship: { gap: space.md },
  photos: { gap: space.sm },
  photo: { width: 80, height: 100, borderRadius: radius.art, backgroundColor: c.plaster },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.hairline, backgroundColor: c.paper },
  review: { gap: space.md, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  stars: { flexDirection: 'row', gap: space.sm },
}));

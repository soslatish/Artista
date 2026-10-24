import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors, post } from '@/api/client';
import { keys, useCatalogMeta, useCommission } from '@/api/hooks';
import type { Commission } from '@/api/types';
import { useSession } from '@/auth/session';
import { AddressFields } from '@/features/address-fields';
import { commissionStatusLabel, commissionTone } from '@/features/commission-status';
import { useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { formatDate, formatPrice, formatTimeLeft, parseRubles, plural } from '@/lib/format';
import { validId } from '@/lib/guard';
import { type AddressForm, validateAddress } from '@/lib/validation';
import { Avatar, Button, Chip, Divider, ErrorState, Field, Line, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { ImageViewer } from '@/ui/zoom';

export default function CommissionRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <CommissionScreen id={id} />;
}

function CommissionScreen({ id }: { id: string }) {
  const q = useCommission(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <CommissionView c={q.data} />;
}

function CommissionView({ c }: { c: Commission }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const meta = useCatalogMeta();
  const [viewer, setViewer] = useState<number | null>(null);
  const [error, setError] = useState('');
  const other = c.my_role === 'artist' ? c.buyer : c.artist;
  const category = meta.data?.categories.find((x) => x.code === c.category)?.label ?? c.category;
  const open = c.status === 'requested' || c.status === 'quoted';

  const act = async (action: string, body?: object): Promise<Commission | null> => {
    setError('');
    try {
      const next = await post<Commission>(`/commissions/${c.id}/${action}`, body);
      qc.setQueryData(keys.commission(c.id), next);
      qc.invalidateQueries({ queryKey: ['commissions'] });
      if (next.order_id) qc.invalidateQueries({ queryKey: ['orders'] });
      return next;
    } catch (e) {
      setError(errorText(e));
      // цена или статус изменились на сервере — показываем актуальное предложение
      qc.invalidateQueries({ queryKey: keys.commission(c.id) });
      throw e;
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={styles.party}>
          <Avatar uri={other.avatar_url} name={other.name} size={48} />
          <View style={styles.flex}>
            <T variant="heading">{other.name}</T>
            <T variant="smallStrong" color={commissionTone(c, colors)}>
              {commissionStatusLabel(c, t)}
            </T>
          </View>
          {c.conversation_id ? (
            <Button title={t('Чат')} variant="secondary" icon="chatbubble-outline" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.conversation_id!, name: other.name } })} />
          ) : null}
        </View>

        <T variant="body">{c.description}</T>
        {c.images.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
            {c.images.map((url, i) => (
              <Pressable key={url} accessibilityRole="imagebutton" accessibilityLabel={t('Открыть фото {n}', { n: i + 1 })} onPress={() => setViewer(i)}>
                <Image source={{ uri: url }} style={styles.image} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View>
          {category ? <Line label={t('Вид')} value={t(category)} /> : null}
          {c.width_cm && c.height_cm ? <Line label={t('Размер')} value={`${c.width_cm} × ${c.height_cm} ${t('см')}`} /> : null}
          {c.budget_kop ? <Line label={t('Бюджет')} value={t('до {p}', { p: formatPrice(c.budget_kop) })} /> : null}
          {c.desired_by ? <Line label={t('Желаемый срок')} value={formatDate(c.desired_by)} /> : null}
          <Line label={t('Запрос от')} value={formatDate(c.created_at)} />
        </View>

        {c.quote_kop ? (
          <View style={styles.quote}>
            <T variant="small">{t('Предложение художника')}</T>
            <T variant="priceLarge">{formatPrice(c.quote_kop)}</T>
            {c.quote_days ? <T variant="bodyStrong">{t('Срок работы — {n} {d}', { n: c.quote_days, d: plural(c.quote_days, ['день', 'дня', 'дней'], ['day', 'days']) })}</T> : null}
            {c.quote_note ? <T variant="body">{c.quote_note}</T> : null}
            {c.status === 'quoted' && c.expires_at ? <T variant="small">{t('Предложение действует ещё {left}', { left: formatTimeLeft(c.expires_at) })}</T> : null}
          </View>
        ) : null}
        {c.status === 'declined' && c.decline_reason ? <Notice text={t('Причина: {r}', { r: c.decline_reason })} /> : null}
        {error ? <Notice tone="danger" text={error} /> : null}

        {c.order_id ? <Button title={t('Перейти к заказу')} onPress={() => router.push({ pathname: '/orders/[id]', params: { id: c.order_id! } })} /> : null}
        {c.my_role === 'artist' && open ? <ArtistActions c={c} act={act} /> : null}
        {c.my_role === 'buyer' && c.status === 'quoted' ? <AcceptForm c={c} act={act} /> : null}
        {c.my_role === 'buyer' && open ? (
          <Button
            title={t('Отменить запрос')}
            variant="ghost"
            onPress={() => confirmAction(t('Отменить запрос?'), t('Художник получит уведомление.'), () => act('cancel').catch(() => undefined), { destructive: true })}
          />
        ) : null}
      </ScrollView>
      {viewer !== null ? <ImageViewer images={c.images} index={viewer} visible title="" onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

type Act = (action: string, body?: object) => Promise<Commission | null>;

function ArtistActions({ c, act }: { c: Commission; act: Act }) {
  const t = useT();
  const styles = useStyles();
  const [price, setPrice] = useState(c.quote_kop ? String(c.quote_kop / 100) : '');
  const [days, setDays] = useState(c.quote_days ? String(c.quote_days) : '');
  const [note, setNote] = useState(c.quote_note);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const kop = parseRubles(price);
  const d = Number.parseInt(days, 10);

  const quote = async () => {
    setBusy(true);
    setErrors({});
    try {
      await act('quote', { price_kop: kop ?? 0, days: Number.isFinite(d) ? d : 0, note });
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setBusy(false);
    }
  };

  const decline = () =>
    confirmAction(t('Отказаться от заказа?'), t('Покупатель получит уведомление. Причину можно написать в чате.'), () => act('decline', { reason: '' }).catch(() => undefined), { destructive: true });

  return (
    <View style={styles.form}>
      <Divider />
      <T variant="heading">{c.status === 'quoted' ? t('Изменить предложение') : t('Назовите цену и срок')}</T>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label={t('Цена, ₽')} value={price} onChangeText={setPrice} keyboardType="number-pad" error={errors.price_kop} />
        </View>
        <View style={styles.flex}>
          <Field label={t('Срок, дней')} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={3} error={errors.days} />
        </View>
      </View>
      <Field label={t('Комментарий')} value={note} onChangeText={setNote} multiline maxLength={1000} error={errors.note} placeholder={t('Например: два эскиза на выбор, холст на подрамнике')} />
      <T variant="small">{t('Срок считается с подтверждения оплаченного заказа; ещё 2 дня даём на отправку. Предложение действует 7 дней.')}</T>
      <Button title={c.status === 'quoted' ? t('Обновить предложение') : t('Отправить предложение')} loading={busy} disabled={!kop || !Number.isFinite(d)} onPress={quote} />
      <Button title={t('Отказаться')} variant="ghost" onPress={decline} />
    </View>
  );
}

function AcceptForm({ c, act }: { c: Commission; act: Act }) {
  const t = useT();
  const styles = useStyles();
  const meta = useCatalogMeta();
  const { user } = useSession();
  const [addr, setAddr] = useState<AddressForm>({ city: user?.city ?? '', street: '', postal_code: '', recipient_name: user?.name ?? '', phone: '', comment: '' });
  const [method, setMethod] = useState('cdek');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    const errs = validateAddress(addr);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const next = await act('accept', { delivery_method: method, address: addr, expected_price_kop: c.quote_kop });
      if (next?.order_id) router.replace({ pathname: '/orders/[id]', params: { id: next.order_id } });
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Divider />
      <T variant="heading">{t('Принять и оформить заказ')}</T>
      <T variant="small">{t('Создадим заказ на {p} плюс доставка. Художник начнёт работу после оплаты; деньги он получит, когда вы подтвердите получение.', { p: formatPrice(c.quote_kop ?? 0) })}</T>
      <View style={styles.chips}>
        {(meta.data?.delivery_methods ?? []).map((m) => (
          <Chip key={m.code} label={t(m.label)} selected={method === m.code} onPress={() => setMethod(m.code)} />
        ))}
      </View>
      <AddressFields value={addr} onChange={setAddr} errors={errors} />
      <Button title={t('Принять за {p}', { p: formatPrice(c.quote_kop ?? 0) })} loading={busy} onPress={accept} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  party: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  images: { gap: space.sm },
  image: { width: 120, height: 120, borderRadius: radius.art, backgroundColor: c.plaster },
  quote: { gap: 4, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  form: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));

import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors, post } from '@/api/client';
import { flatten, useMyArtworks } from '@/api/hooks';
import type { Exhibition } from '@/api/types';
import { useT } from '@/i18n';
import { daysFromNowAt, formatDateInput, formatTimeInput, parseLocalDateTime } from '@/lib/datetime-input';
import { formatPrice } from '@/lib/format';
import { Button, Chip, EmptyState, Field, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const maxArtworks = 30;
const presets = [
  { label: 'Завтра в 19:00', days: 1 },
  { label: 'Через 3 дня', days: 3 },
  { label: 'Через неделю', days: 7 },
];

export default function NewExhibitionScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const drafts = useMyArtworks('draft');
  const initial = daysFromNowAt(7, 19);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(formatDateInput(initial));
  const [time, setTime] = useState(formatTimeInput(initial));
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = flatten(drafts.data);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < maxArtworks ? [...prev, id] : prev));

  const applyPreset = (days: number) => {
    const d = daysFromNowAt(days, 19);
    setDate(formatDateInput(d));
    setTime(formatTimeInput(d));
  };

  const submit = async () => {
    const starts = parseLocalDateTime(date, time);
    const local: Record<string, string> = {};
    if (title.trim().length < 2) local.title = t('Назовите выставку');
    if (!starts) local.starts_at = t('Дата ДД.ММ.ГГГГ и время ЧЧ:ММ');
    if (!picked.length) local.artwork_ids = t('Выберите хотя бы одну работу');
    setErrors(local);
    if (Object.keys(local).length || !starts) return;
    setBusy(true);
    setError('');
    try {
      const e = await post<Exhibition>('/exhibitions', { title: title.trim(), description: description.trim(), starts_at: starts.toISOString(), artwork_ids: picked });
      qc.invalidateQueries({ queryKey: ['exhibitions'] });
      qc.invalidateQueries({ queryKey: ['my-artworks'] });
      router.replace({ pathname: '/exhibition/[id]', params: { id: e.id } });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <T variant="body">{t('Выставка — это премьера серии. Подписчики получат анонс сразу, а напоминание — к открытию. До назначенного времени работы видны, но купить их нельзя.')}</T>
        <Field label={t('Название')} value={title} onChangeText={setTitle} maxLength={100} error={errors.title} />
        <Field label={t('О выставке')} value={description} onChangeText={setDescription} multiline maxLength={2000} placeholder={t('Что объединяет работы, как появилась серия')} />

        <T variant="heading">{t('Открытие')}</T>
        <View style={styles.chips}>
          {presets.map((p) => (
            <Chip key={p.days} label={t(p.label)} onPress={() => applyPreset(p.days)} />
          ))}
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label={t('Дата')} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" maxLength={10} error={errors.starts_at} />
          </View>
          <View style={styles.flex}>
            <Field label={t('Время')} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
          </View>
        </View>
        <T variant="small">{t('По времени вашего телефона. От 30 минут до 60 дней от текущего момента.')}</T>

        <T variant="heading">{t('Работы ({n} из {max})', { n: picked.length, max: maxArtworks })}</T>
        {errors.artwork_ids ? <T variant="small" color={colors.danger}>{errors.artwork_ids}</T> : null}
        {drafts.isLoading ? <Loading /> : null}
        {!drafts.isLoading && !items.length ? (
          <EmptyState
            icon="albums-outline"
            title={t('Нет черновиков')}
            text={t('На выставку попадают новые работы. Сохраните их как черновики, затем вернитесь сюда.')}
            action={<Button title={t('Добавить работу')} variant="secondary" onPress={() => router.push('/artwork/new')} />}
          />
        ) : null}
        <View style={styles.grid}>
          {items.map((a) => {
            const on = picked.includes(a.id);
            return (
              <Pressable key={a.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.title} onPress={() => toggle(a.id)} style={styles.cell}>
                <View style={[styles.thumbBox, on && styles.thumbOn]}>
                  {a.images[0] ? <Image source={{ uri: a.images[0] }} style={styles.thumb} contentFit="cover" /> : null}
                  {on ? (
                    <View style={styles.badge}>
                      <T variant="smallStrong" color="#FFFFFF">
                        {picked.indexOf(a.id) + 1}
                      </T>
                    </View>
                  ) : null}
                </View>
                <T variant="small" numberOfLines={1}>
                  {a.title || t('Без названия')}
                </T>
                <T variant="smallStrong">{a.price_kop ? formatPrice(a.price_kop) : '—'}</T>
              </Pressable>
            );
          })}
        </View>
        {drafts.hasNextPage ? <Button title={t('Показать ещё')} variant="ghost" loading={drafts.isFetchingNextPage} onPress={() => void drafts.fetchNextPage()} /> : null}
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Анонсировать выставку')} loading={busy} disabled={!picked.length} onPress={submit} />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%', flexGrow: 1, maxWidth: '33%', gap: 2 },
  thumbBox: { aspectRatio: 4 / 5, borderRadius: radius.art, overflow: 'hidden', backgroundColor: c.plaster, borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: c.bordeaux },
  thumb: { width: '100%', height: '100%' },
  badge: { position: 'absolute', top: 6, right: 6, minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bordeaux },
}));

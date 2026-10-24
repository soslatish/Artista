import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors, post } from '@/api/client';
import { useCatalogMeta, useUser } from '@/api/hooks';
import type { Commission } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { pickPhotos } from '@/features/pick-photos';
import { useT } from '@/i18n';
import { parseRubles } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, Chip, ErrorState, Field, IconButton, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const maxImages = 5;
const datePattern = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** ДД.ММ.ГГГГ → ГГГГ-ММ-ДД; пустая строка — без срока. */
function toISODate(input: string): string | null | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const m = datePattern.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default function NewCommissionRoute() {
  const id = validId(useLocalSearchParams().artistId);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <NewCommission artistId={id} />;
}

function NewCommission({ artistId }: { artistId: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const artist = useUser(artistId);
  const meta = useCatalogMeta();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [budget, setBudget] = useState('');
  const [date, setDate] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  if (artist.isLoading) return <Loading />;
  if (artist.isError || !artist.data) return <ErrorState text={errorText(artist.error)} />;
  const a = artist.data;

  const addPhotos = async () => {
    const assets = await pickPhotos('library', maxImages - images.length);
    if (!assets.length) return;
    setUploading(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const asset of assets) urls.push(await uploadImage(asset));
      setImages((prev) => [...prev, ...urls].slice(0, maxImages));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const desired = toISODate(date);
    const local: Record<string, string> = {};
    if (description.trim().length < 20) local.description = t('Опишите идею подробнее — от 20 символов');
    if (!category) local.category = t('Выберите вид работы');
    if (desired === null) local.desired_by = t('Дата в формате ДД.ММ.ГГГГ');
    setErrors(local);
    if (Object.keys(local).length) return;
    const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
    setBusy(true);
    setError('');
    try {
      const c = await post<Commission>('/commissions', {
        artist_id: a.id,
        description: description.trim(),
        category,
        width_cm: num(width),
        height_cm: num(height),
        budget_kop: parseRubles(budget),
        desired_by: desired,
        images,
      });
      qc.invalidateQueries({ queryKey: ['commissions'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      router.replace({ pathname: '/commissions/[id]', params: { id: c.id } });
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <T variant="title">{t('Работа на заказ у {name}', { name: a.name })}</T>
        {a.commission_note ? <Notice text={a.commission_note} /> : null}
        {!a.accepts_commissions ? <Notice tone="danger" text={t('Сейчас художник не принимает заказы.')} /> : null}
        <Field
          label={t('Что вы хотите')}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          error={errors.description}
          placeholder={t('Сюжет, настроение, цвета, для какой комнаты. Чем подробнее — тем точнее цена.')}
        />
        <T variant="heading">{t('Вид работы')}</T>
        <View style={styles.chips}>
          {(meta.data?.categories ?? []).map((c) => (
            <Chip key={c.code} label={t(c.label)} selected={category === c.code} onPress={() => setCategory(c.code)} />
          ))}
        </View>
        {errors.category ? <T variant="small" color={colors.danger}>{errors.category}</T> : null}
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label={t('Ширина, см')} value={width} onChangeText={setWidth} keyboardType="decimal-pad" error={errors.size} />
          </View>
          <View style={styles.flex}>
            <Field label={t('Высота, см')} value={height} onChangeText={setHeight} keyboardType="decimal-pad" error={errors.size ? ' ' : undefined} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label={t('Бюджет до, ₽')} value={budget} onChangeText={setBudget} keyboardType="number-pad" error={errors.budget_kop} />
          </View>
          <View style={styles.flex}>
            <Field label={t('Нужно к')} value={date} onChangeText={setDate} placeholder={t('ДД.ММ.ГГГГ')} keyboardType="numbers-and-punctuation" maxLength={10} error={errors.desired_by} />
          </View>
        </View>

        <T variant="heading">{t('Фото интерьера или референсы')}</T>
        <View style={styles.images}>
          {images.map((url) => (
            <View key={url}>
              <Image source={{ uri: url }} style={styles.image} contentFit="cover" />
              <View style={styles.remove}>
                <IconButton icon="close-circle" size={24} color={colors.ink} label={t('Убрать фото')} onPress={() => setImages((prev) => prev.filter((x) => x !== url))} />
              </View>
            </View>
          ))}
          {images.length < maxImages ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Добавить фото')} onPress={addPhotos} disabled={uploading} style={[styles.image, styles.add]}>
              <T variant="smallStrong">{uploading ? t('Загружаем…') : t('+ Фото')}</T>
            </Pressable>
          ) : null}
        </View>

        <T variant="small">{t('Художник ответит в течение 7 дней: назовёт цену и срок или откажется. Обсудить детали можно в чате — он откроется сразу.')}</T>
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Отправить запрос')} loading={busy} disabled={uploading || !a.accepts_commissions} onPress={submit} />
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
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  image: { width: 96, height: 96, borderRadius: radius.art, backgroundColor: c.plaster },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.hairline },
  remove: { position: 'absolute', top: -6, right: -6 },
}));

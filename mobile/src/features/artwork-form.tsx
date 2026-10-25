// Форма работы художника (создание и редактирование) с ИИ-помощником для названия, описания и цены.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, fieldErrors, post } from '@/api/client';
import { useCatalogMeta, useSafeDeals, useSaveArtwork, useUserSeries } from '@/api/hooks';
import type { AssistantSuggestion, Option } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { usePlatformTerms } from '@/lib/terms';
import { formatPrice } from '@/lib/format';
import { type ArtworkForm, validateArtworkForm } from '@/lib/validation';
import { Button, Chip, Field, Notice, T, ToggleRow } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

import { pickPhotos, type PhotoSource } from './pick-photos';

const MAX_IMAGES = 10;

interface Props {
  artworkId?: string;
  initial: ArtworkForm;
  isPublished?: boolean;
}

export function ArtworkFormScreen({ artworkId, initial, isPublished }: Props) {
  const t = useT();
  const terms = usePlatformTerms();
  const safeDeals = useSafeDeals();
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { data: meta } = useCatalogMeta();
  const series = useUserSeries(user?.id ?? '');
  const save = useSaveArtwork(artworkId);
  const [form, setForm] = useState<ArtworkForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const set = (k: keyof ArtworkForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const addPhotos = async (source: PhotoSource) => {
    const picked = await pickPhotos(source, MAX_IMAGES - form.images.length);
    if (!picked.length) return;
    setUploading((n) => n + picked.length);
    setError('');
    for (const asset of picked) {
      try {
        const url = await uploadImage(asset);
        setForm((f) => ({ ...f, images: [...f.images, url].slice(0, MAX_IMAGES) }));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const removePhoto = (url: string) => setForm((f) => ({ ...f, images: f.images.filter((u) => u !== url) }));
  const makeCover = (url: string) => setForm((f) => ({ ...f, images: [url, ...f.images.filter((u) => u !== url)] }));
  const toggleRoom = (code: string) => setForm((f) => ({ ...f, rooms: f.rooms.includes(code) ? f.rooms.filter((r) => r !== code) : [...f.rooms, code] }));

  const submit = (publish: boolean) => {
    const { errors: errs, payload } = validateArtworkForm(form, publish || !!isPublished);
    setErrors(errs);
    if (!payload) {
      setError(t('Проверьте поля: {list}', { list: Object.values(errs).join('; ').toLowerCase() }));
      return;
    }
    setError('');
    save.mutate(
      { input: payload, publish },
      {
        onSuccess: (a) => (artworkId ? router.back() : router.replace({ pathname: '/artwork/[id]', params: { id: a.id } })),
        onError: (e) => {
          setErrors(fieldErrors(e));
          setError(errorText(e));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <T variant="heading">{t('Фотографии')}</T>
          <T variant="small">{t('Первое фото — обложка; нажмите на другое фото, чтобы сделать его обложкой. Снимайте при дневном свете, без бликов.')}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {form.images.map((url, i) => (
              <View key={url}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={i === 0 ? t('Обложка') : t('Фото {n}. Сделать обложкой', { n: i + 1 })}
                  disabled={i === 0}
                  onPress={() => makeCover(url)}>
                  <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                  {i === 0 ? (
                    <View style={styles.cover}>
                      <T variant="smallStrong" color="#FFFFFF">
                        {t('Обложка')}
                      </T>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Удалить фото {n}', { n: i + 1 })} hitSlop={8} onPress={() => removePhoto(url)} style={styles.remove}>
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <View key={`u${i}`} style={[styles.photo, styles.photoAdd]}>
                <ActivityIndicator color={colors.bordeaux} />
              </View>
            ))}
            {form.images.length + uploading < MAX_IMAGES ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Добавить фото из галереи')} onPress={() => addPhotos('library')} style={[styles.photo, styles.photoAdd]}>
                  <Ionicons name="images-outline" size={26} color={colors.bordeaux} />
                  <T variant="small">{t('Галерея')}</T>
                </Pressable>
                {Platform.OS !== 'web' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Снять работу на камеру')} onPress={() => addPhotos('camera')} style={[styles.photo, styles.photoAdd]}>
                    <Ionicons name="camera-outline" size={26} color={colors.bordeaux} />
                    <T variant="small">{t('Камера')}</T>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
          {errors.images ? (
            <T variant="small" color={colors.danger}>
              {errors.images}
            </T>
          ) : null}
        </View>

        <OptionGroup title={t('Категория')} options={meta?.categories ?? []} value={form.category} onChange={set('category')} error={errors.category} />
        <OptionGroup title={t('Стиль')} options={meta?.styles ?? []} value={form.style} onChange={set('style')} optional />
        <OptionGroup title={t('Техника')} options={meta?.techniques ?? []} value={form.technique} onChange={set('technique')} optional />
        <Field label={t('Материалы')} value={form.materials} onChangeText={set('materials')} placeholder={t('Холст на подрамнике, масло')} error={errors.materials} />

        <View style={styles.section}>
          <T variant="heading">{t('Размер, см')}</T>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label={t('Ширина')} value={form.width} onChangeText={set('width')} keyboardType="decimal-pad" error={errors.width_cm} />
            </View>
            <View style={styles.flex}>
              <Field label={t('Высота')} value={form.height} onChangeText={set('height')} keyboardType="decimal-pad" error={errors.height_cm} />
            </View>
            <View style={styles.flex}>
              <Field label={t('Глубина')} value={form.depth} onChangeText={set('depth')} keyboardType="decimal-pad" error={errors.depth_cm} placeholder="0" />
            </View>
          </View>
        </View>

        <AssistantPanel form={form} onApply={(patch) => setForm((f) => ({ ...f, ...patch }))} />

        <Field label={t('Название')} value={form.title} onChangeText={set('title')} error={errors.title} placeholder={t('Например, «Белые ночи»')} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label={t('Цена, ₽')} value={form.price} onChangeText={set('price')} keyboardType="number-pad" error={errors.price} placeholder="25 000" />
          </View>
          <View style={styles.flex}>
            <Field label={t('Год создания')} value={form.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} error={errors.year} />
          </View>
        </View>
        <Field
          label={t('Описание')}
          value={form.description}
          onChangeText={set('description')}
          multiline
          maxLength={4000}
          placeholder={t('История работы, что изображено, как оформлена, готова ли к развеске')}
          error={errors.description}
        />

        <View style={styles.section}>
          <T variant="heading">
            {t('Для каких интерьеров')}
            <T variant="small"> — {t('необязательно')}</T>
          </T>
          <View style={styles.chips}>
            {(meta?.rooms ?? []).map((r) => (
              <Chip key={r.code} label={t(r.label)} selected={form.rooms.includes(r.code)} onPress={() => toggleRoom(r.code)} />
            ))}
          </View>
        </View>

        {series.data?.length ? (
          <View style={styles.section}>
            <T variant="heading">{t('Серия')}</T>
            <View style={styles.chips}>
              <Chip label={t('Без серии')} selected={!form.seriesId} onPress={() => setForm((f) => ({ ...f, seriesId: '' }))} />
              {series.data.map((s) => (
                <Chip key={s.id} label={s.title} selected={form.seriesId === s.id} onPress={() => setForm((f) => ({ ...f, seriesId: s.id }))} />
              ))}
            </View>
          </View>
        ) : null}

        <ToggleRow
          label={t('Принимать предложения цены')}
          hint={t('Покупатели смогут предложить свою цену — от 50% от указанной. Вы решаете, соглашаться ли.')}
          value={form.allowOffers}
          onChange={(allowOffers) => setForm((f) => ({ ...f, allowOffers }))}
        />

        <Notice text={safeDeals ? t('Комиссия Artista — {pct} с продажи. С премиумом — 0% на продажи до {limit} в месяц.', { pct: terms.pct, limit: terms.limit }) : t('Комиссии нет: покупатели напишут вам в чат, оплату и доставку вы обсуждаете напрямую. С Премиумом работы выше в ленте.')} />
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={isPublished ? t('Сохранить') : t('Опубликовать')} loading={save.isPending} disabled={uploading > 0} onPress={() => submit(true)} />
        {!isPublished ? <Button title={t('Сохранить черновик')} variant="secondary" disabled={save.isPending || uploading > 0} onPress={() => submit(false)} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** ИИ-помощник: варианты названия, черновик описания и ориентир цены по похожим работам. */
function AssistantPanel({ form, onApply }: { form: ArtworkForm; onApply: (patch: Partial<ArtworkForm>) => void }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [s, setS] = useState<AssistantSuggestion | null>(null);
  const ready = !!form.category;

  const ask = async () => {
    setBusy(true);
    setError('');
    try {
      const num = (v: string) => Number(v.replace(',', '.')) || 0;
      setS(
        await post<AssistantSuggestion>('/assistant/artwork', {
          image_url: form.images[0] ?? '',
          title: form.title.trim(),
          category: form.category,
          style: form.style,
          technique: form.technique,
          materials: form.materials.trim(),
          width_cm: num(form.width),
          height_cm: num(form.height),
          rooms: form.rooms,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const basis = s ? (s.price.basis === 'similar' ? t('по {n} похожим работам', { n: s.price.sample_size }) : s.price.basis === 'category' ? t('по работам этой категории') : t('по средним ценам рынка')) : '';

  return (
    <View style={styles.assistant}>
      <View style={styles.assistantHead}>
        <Ionicons name="sparkles-outline" size={20} color={colors.bordeaux} />
        <T variant="heading" style={styles.flex}>
          {t('Помощник')}
        </T>
      </View>
      <T variant="small">{t('Предложит название, черновик описания и цену по похожим работам. Сначала выберите категорию и добавьте фото.')}</T>
      {!s ? <Button title={t('Подсказать')} variant="secondary" loading={busy} disabled={!ready} onPress={ask} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {s ? (
        <View style={styles.assistantBody}>
          <T variant="smallStrong">{t('Название')}</T>
          <View style={styles.chips}>
            {s.titles.map((title) => (
              <Chip key={title} label={title} selected={form.title === title} onPress={() => onApply({ title })} />
            ))}
          </View>
          <T variant="smallStrong">{t('Описание')}</T>
          <T variant="body">{s.description}</T>
          <Button title={t('Вставить описание')} variant="ghost" onPress={() => onApply({ description: s.description })} />
          <T variant="smallStrong">{t('Цена')}</T>
          <T variant="body">
            {t('Рекомендуем {price} — {basis}. Обычно такие работы стоят {min} – {max}.', {
              price: formatPrice(s.price.suggested_kop),
              basis,
              min: formatPrice(s.price.min_kop),
              max: formatPrice(s.price.max_kop),
            })}
          </T>
          <Button title={t('Поставить {price}', { price: formatPrice(s.price.suggested_kop) })} variant="ghost" onPress={() => onApply({ price: String(Math.round(s.price.suggested_kop / 100)) })} />
          <Button title={t('Ещё варианты')} variant="ghost" loading={busy} onPress={ask} />
        </View>
      ) : null}
    </View>
  );
}

interface OptionGroupProps {
  title: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
  optional?: boolean;
}

function OptionGroup({ title, options, value, onChange, error, optional }: OptionGroupProps) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.section}>
      <T variant="heading">
        {title}
        {optional ? <T variant="small"> — {t('необязательно')}</T> : null}
      </T>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip key={o.code} label={t(o.label)} selected={value === o.code} onPress={() => onChange(value === o.code && optional ? '' : o.code)} />
        ))}
      </View>
      {error ? (
        <T variant="small" color={colors.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.xl },
  section: { gap: space.sm },
  photos: { gap: space.sm, paddingVertical: space.xs },
  photo: { width: 96, height: 120, borderRadius: radius.art, backgroundColor: c.plaster },
  photoAdd: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: c.hairline, backgroundColor: c.paper },
  cover: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(98,45,50,0.85)', paddingVertical: 2, alignItems: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(30,26,27,0.7)', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  assistant: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.bordeauxSoft },
  assistantHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  assistantBody: { gap: space.sm },
}));

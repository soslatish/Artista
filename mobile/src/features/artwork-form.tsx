// Форма работы художника (создание и редактирование).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, fieldErrors } from '@/api/client';
import { useCatalogMeta, useSaveArtwork } from '@/api/hooks';
import type { Option } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { notify } from '@/lib/confirm';
import { type ArtworkForm, validateArtworkForm } from '@/lib/validation';
import { Button, Chip, Field, Notice, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const MAX_IMAGES = 10;

interface Props {
  artworkId?: string;
  initial: ArtworkForm;
  isPublished?: boolean;
}

export function ArtworkFormScreen({ artworkId, initial, isPublished }: Props) {
  const insets = useSafeAreaInsets();
  const { data: meta } = useCatalogMeta();
  const save = useSaveArtwork(artworkId);
  const [form, setForm] = useState<ArtworkForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const set = (k: keyof ArtworkForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const addPhotos = async (source: 'library' | 'camera') => {
    const left = MAX_IMAGES - form.images.length;
    if (left <= 0) return;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        notify('Нет доступа к камере', 'Разрешите доступ в настройках телефона, чтобы снимать работы.');
        return;
      }
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: left });
    if (res.canceled) return;
    const picked = res.assets.slice(0, left);
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

  const submit = (publish: boolean) => {
    const { errors: errs, payload } = validateArtworkForm(form, publish || !!isPublished);
    setErrors(errs);
    if (!payload) {
      setError(`Проверьте поля: ${Object.values(errs).join('; ').toLowerCase()}`);
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
          <T variant="heading">Фотографии</T>
          <T variant="small">Первое фото — обложка; нажмите на другое фото, чтобы сделать его обложкой. Снимайте при дневном свете, без бликов.</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {form.images.map((url, i) => (
              <View key={url}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={i === 0 ? 'Обложка' : `Фото ${i + 1}. Сделать обложкой`}
                  disabled={i === 0}
                  onPress={() => makeCover(url)}>
                  <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                  {i === 0 ? (
                    <View style={styles.cover}>
                      <T variant="smallStrong" color={colors.onDark}>
                        Обложка
                      </T>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Удалить фото ${i + 1}`} hitSlop={8} onPress={() => removePhoto(url)} style={styles.remove}>
                  <Ionicons name="close" size={14} color={colors.onDark} />
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
                <Pressable accessibilityRole="button" accessibilityLabel="Добавить фото из галереи" onPress={() => addPhotos('library')} style={[styles.photo, styles.photoAdd]}>
                  <Ionicons name="images-outline" size={26} color={colors.bordeaux} />
                  <T variant="small">Галерея</T>
                </Pressable>
                {Platform.OS !== 'web' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Снять работу на камеру" onPress={() => addPhotos('camera')} style={[styles.photo, styles.photoAdd]}>
                    <Ionicons name="camera-outline" size={26} color={colors.bordeaux} />
                    <T variant="small">Камера</T>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
          {errors.images ? <T variant="small" color={colors.danger}>{errors.images}</T> : null}
        </View>

        <Field label="Название" value={form.title} onChangeText={set('title')} error={errors.title} placeholder="Например, «Белые ночи»" />
        <OptionGroup title="Категория" options={meta?.categories ?? []} value={form.category} onChange={set('category')} error={errors.category} />
        <OptionGroup title="Стиль" options={meta?.styles ?? []} value={form.style} onChange={set('style')} optional />
        <OptionGroup title="Техника" options={meta?.techniques ?? []} value={form.technique} onChange={set('technique')} optional />
        <Field label="Материалы" value={form.materials} onChangeText={set('materials')} placeholder="Холст на подрамнике, масло" error={errors.materials} />

        <View style={styles.section}>
          <T variant="heading">Размер, см</T>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Ширина" value={form.width} onChangeText={set('width')} keyboardType="decimal-pad" error={errors.width_cm} />
            </View>
            <View style={styles.flex}>
              <Field label="Высота" value={form.height} onChangeText={set('height')} keyboardType="decimal-pad" error={errors.height_cm} />
            </View>
            <View style={styles.flex}>
              <Field label="Глубина" value={form.depth} onChangeText={set('depth')} keyboardType="decimal-pad" error={errors.depth_cm} placeholder="0" />
            </View>
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="Цена, ₽" value={form.price} onChangeText={set('price')} keyboardType="number-pad" error={errors.price} placeholder="25 000" />
          </View>
          <View style={styles.flex}>
            <Field label="Год создания" value={form.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} error={errors.year} />
          </View>
        </View>
        <Field
          label="Описание"
          value={form.description}
          onChangeText={set('description')}
          multiline
          maxLength={4000}
          placeholder="История работы, что изображено, как оформлена, готова ли к развеске"
          error={errors.description}
        />
        <Notice text="Комиссия Artista — 15% с продажи. С премиумом — 0% на продажи до 100 000 ₽ в месяц." />
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={isPublished ? 'Сохранить' : 'Опубликовать'} loading={save.isPending} disabled={uploading > 0} onPress={() => submit(true)} />
        {!isPublished ? <Button title="Сохранить черновик" variant="secondary" disabled={save.isPending || uploading > 0} onPress={() => submit(false)} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
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
  return (
    <View style={styles.section}>
      <T variant="heading">
        {title}
        {optional ? <T variant="small"> — необязательно</T> : null}
      </T>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip key={o.code} label={o.label} selected={value === o.code} onPress={() => onChange(value === o.code && optional ? '' : o.code)} />
        ))}
      </View>
      {error ? <T variant="small" color={colors.danger}>{error}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.lg, gap: space.xl },
  section: { gap: space.sm },
  photos: { gap: space.sm, paddingVertical: space.xs },
  photo: { width: 96, height: 120, borderRadius: radius.art, backgroundColor: colors.plaster },
  photoAdd: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.hairline, backgroundColor: colors.paper },
  cover: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(98,45,50,0.85)', paddingVertical: 2, alignItems: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(30,26,27,0.7)', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

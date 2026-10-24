import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors, post } from '@/api/client';
import { flatten, keys, useMyArtworks } from '@/api/hooks';
import type { Post } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { useSession } from '@/auth/session';
import { pickPhotos } from '@/features/pick-photos';
import { useT } from '@/i18n';
import { Button, Field, IconButton, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const maxImages = 10;

export default function NewPostScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useSession();
  const works = useMyArtworks('published');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = flatten(works.data);

  const addPhotos = async (source: 'library' | 'camera') => {
    const assets = await pickPhotos(source, maxImages - images.length);
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

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      await post<Post>('/posts', { body: body.trim(), images, artwork_id: artworkId });
      qc.invalidateQueries({ queryKey: keys.postsFeed });
      if (user) qc.invalidateQueries({ queryKey: keys.userPosts(user.id) });
      router.back();
    } catch (e) {
      const fe = fieldErrors(e);
      setError(fe.body ?? fe.images ?? fe.artwork_id ?? errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="body">{t('Покажите процесс: эскиз, палитру, мастерскую. Пост увидят подписчики в ленте «Мастерские».')}</T>
        <Field label={t('Текст')} value={body} onChangeText={setBody} multiline maxLength={2000} placeholder={t('Над чем вы сейчас работаете?')} />
        <View style={styles.images}>
          {images.map((url) => (
            <View key={url}>
              <Image source={{ uri: url }} style={styles.image} contentFit="cover" />
              <View style={styles.remove}>
                <IconButton icon="close-circle" size={24} color={colors.ink} label={t('Убрать фото')} onPress={() => setImages((prev) => prev.filter((x) => x !== url))} />
              </View>
            </View>
          ))}
        </View>
        {images.length < maxImages ? (
          <View style={styles.row}>
            <Button title={uploading ? t('Загружаем…') : t('Из галереи')} variant="secondary" icon="images-outline" disabled={uploading} onPress={() => void addPhotos('library')} style={styles.flex} />
            {Platform.OS !== 'web' ? <Button title={t('Камера')} variant="secondary" icon="camera-outline" disabled={uploading} onPress={() => void addPhotos('camera')} style={styles.flex} /> : null}
          </View>
        ) : null}

        {items.length ? (
          <>
            <T variant="heading">{t('Прикрепить работу')}</T>
            <T variant="small">{t('Под постом появится карточка работы со ссылкой на покупку.')}</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.works}>
              {items.map((a) => {
                const on = artworkId === a.id;
                return (
                  <Pressable key={a.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={a.title} onPress={() => setArtworkId(on ? null : a.id)} style={styles.work}>
                    <View style={[styles.workThumb, on && styles.workOn]}>{a.images[0] ? <Image source={{ uri: a.images[0] }} style={styles.fill} contentFit="cover" /> : null}</View>
                    <T variant="small" numberOfLines={1}>
                      {a.title}
                    </T>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Опубликовать')} loading={busy} disabled={uploading || (!body.trim() && !images.length)} onPress={publish} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  image: { width: 96, height: 96, borderRadius: radius.art, backgroundColor: c.plaster },
  remove: { position: 'absolute', top: -6, right: -6 },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  works: { gap: space.md },
  work: { width: 96, gap: 4 },
  workThumb: { width: 96, height: 120, borderRadius: radius.art, overflow: 'hidden', backgroundColor: c.plaster, borderWidth: 2, borderColor: 'transparent' },
  workOn: { borderColor: c.bordeaux },
  fill: { width: '100%', height: '100%' },
}));

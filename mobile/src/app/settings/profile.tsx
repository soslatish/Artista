import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors } from '@/api/client';
import { useUpdateMe } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { Avatar, Button, Field, Notice, T } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

export default function EditProfileScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user, setUser } = useSession();
  const update = useUpdateMe();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    city: user?.city ?? '',
    bio: user?.bio ?? '',
    avatar_url: user?.avatar_url ?? '',
    vk: user?.social.vk ?? '',
    telegram: user?.social.telegram ?? '',
    website: user?.social.website ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  if (!user) return null;

  const pickAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled) return;
    setUploading(true);
    try {
      set('avatar_url')(await uploadImage(res.assets[0]));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    const social: Record<string, string> = {};
    if (form.vk.trim()) social.vk = form.vk.trim();
    if (form.telegram.trim()) social.telegram = form.telegram.trim();
    if (form.website.trim()) social.website = form.website.trim();
    update.mutate(
      { name: form.name, city: form.city, bio: form.bio, avatar_url: form.avatar_url, social },
      {
        onSuccess: (me) => {
          setUser(me);
          router.back();
        },
        onError: (e) => {
          setErrors(fieldErrors(e));
          setError(errorText(e));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel={t('Сменить фото профиля')} onPress={pickAvatar} style={styles.avatar}>
          <Avatar uri={form.avatar_url} name={form.name} size={96} />
          <T variant="smallStrong" color={colors.bordeaux}>
            {uploading ? t('Загружаем…') : t('Сменить фото')}
          </T>
        </Pressable>
        <Field label={t('Имя')} value={form.name} onChangeText={set('name')} error={errors.name} />
        <Field label={t('Город')} value={form.city} onChangeText={set('city')} error={errors.city} />
        <Field label={t('О себе')} value={form.bio} onChangeText={set('bio')} multiline maxLength={1000} error={errors.bio} placeholder={user.role === 'artist' ? t('Образование, техника, выставки') : ''} />
        {user.role === 'artist' ? (
          <View style={styles.group}>
            <T variant="heading">{t('Ссылки')}</T>
            <Field label={t('ВКонтакте')} value={form.vk} onChangeText={set('vk')} autoCapitalize="none" placeholder="https://vk.com/…" />
            <Field label="Telegram" value={form.telegram} onChangeText={set('telegram')} autoCapitalize="none" placeholder="@username" />
            <Field label={t('Сайт или портфолио')} value={form.website} onChangeText={set('website')} autoCapitalize="none" placeholder="https://…" />
            {errors.social ? (
              <T variant="small" color={colors.danger}>
                {errors.social}
              </T>
            ) : null}
          </View>
        ) : null}
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Сохранить')} loading={update.isPending} disabled={uploading} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  avatar: { alignItems: 'center', gap: space.sm },
  group: { gap: space.md },
}));

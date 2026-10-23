import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { errorText, fieldErrors } from '@/api/client';
import { useUpdateMe } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { useSession } from '@/auth/session';
import { Avatar, Button, Field, Notice, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function EditProfileScreen() {
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
        <Pressable accessibilityRole="button" accessibilityLabel="Сменить фото профиля" onPress={pickAvatar} style={styles.avatar}>
          <Avatar uri={form.avatar_url} name={form.name} size={96} />
          <T variant="smallStrong" color={colors.bordeaux}>
            {uploading ? 'Загружаем…' : 'Сменить фото'}
          </T>
        </Pressable>
        <Field label="Имя" value={form.name} onChangeText={set('name')} error={errors.name} />
        <Field label="Город" value={form.city} onChangeText={set('city')} error={errors.city} />
        <Field label="О себе" value={form.bio} onChangeText={set('bio')} multiline maxLength={1000} error={errors.bio} placeholder={user.role === 'artist' ? 'Образование, техника, выставки' : ''} />
        {user.role === 'artist' ? (
          <View style={styles.group}>
            <T variant="heading">Ссылки</T>
            <Field label="ВКонтакте" value={form.vk} onChangeText={set('vk')} autoCapitalize="none" placeholder="https://vk.com/…" />
            <Field label="Telegram" value={form.telegram} onChangeText={set('telegram')} autoCapitalize="none" placeholder="@username" />
            <Field label="Сайт или портфолио" value={form.website} onChangeText={set('website')} autoCapitalize="none" placeholder="https://…" />
            {errors.social ? <T variant="small" color={colors.danger}>{errors.social}</T> : null}
          </View>
        ) : null}
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title="Сохранить" loading={update.isPending} disabled={uploading} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  avatar: { alignItems: 'center', gap: space.sm },
  group: { gap: space.md },
});

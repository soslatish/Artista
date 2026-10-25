import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';

import { errorText, fieldErrors, SITE_URL } from '@/api/client';
import { useFeature } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { validateRegistration } from '@/lib/validation';
import { Button, Field, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

type RoleChoice = 'buyer' | 'artist';

const roles: { key: RoleChoice; title: string; text: string }[] = [
  { key: 'buyer', title: 'Покупаю', text: 'Ищу работы для дома, подарка или коллекции' },
  { key: 'artist', title: 'Продаю свои работы', text: 'Публикую работы и принимаю заказы' },
];

export default function RegisterScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { signUp } = useSession();
  const [role, setRole] = useState<RoleChoice>('buyer');
  const registrationOpen = useFeature('registration');
  const [form, setForm] = useState({ name: '', email: '', password: '', city: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const errs = validateRegistration(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    try {
      await signUp({ ...form, role });
      if (router.canDismiss()) router.dismiss();
      else router.replace('/');
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="display">{t('Добро пожаловать')}</T>
        <View style={styles.roles} accessibilityRole="radiogroup">
          {roles.map((r) => (
            <Pressable key={r.key} accessibilityRole="radio" accessibilityState={{ checked: role === r.key }} onPress={() => setRole(r.key)} style={[styles.role, role === r.key && styles.roleOn]}>
              <T variant="heading" color={role === r.key ? colors.bordeaux : colors.ink}>
                {t(r.title)}
              </T>
              <T variant="small">{t(r.text)}</T>
            </Pressable>
          ))}
        </View>
        {error ? <Notice tone="danger" text={error} /> : null}
        <Field label={t('Имя')} value={form.name} onChangeText={set('name')} autoComplete="name" error={errors.name} />
        <Field label="E-mail" value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.email} />
        <Field
          label={t('Пароль')}
          value={form.password}
          onChangeText={set('password')}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          hint={t('Не меньше 8 символов')}
          error={errors.password}
        />
        <Field label={t('Город')} value={form.city} onChangeText={set('city')} placeholder={t('Для доставки и поиска')} />
        {registrationOpen ? null : <Notice tone="danger" text={t('Регистрация временно закрыта. Попробуйте позже.')} />}
        <Button title={t('Создать аккаунт')} loading={busy} disabled={!registrationOpen} onPress={submit} />
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${SITE_URL}/legal/privacy`)}>
          <T variant="small" center>
            {t('Создавая аккаунт, вы принимаете пользовательское соглашение и политику конфиденциальности.')}
          </T>
        </Pressable>
        <Button title={t('Уже есть аккаунт — войти')} variant="ghost" onPress={() => router.replace('/login')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.xl, gap: space.lg },
  roles: { gap: space.sm },
  role: { padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper, gap: 2 },
  roleOn: { borderColor: c.bordeaux, borderWidth: 2, backgroundColor: c.bordeauxSoft },
}));

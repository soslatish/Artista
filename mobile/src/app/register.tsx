import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { errorText, fieldErrors } from '@/api/client';
import { useSession } from '@/auth/session';
import { validateRegistration } from '@/lib/validation';
import { Button, Field, Notice, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

type RoleChoice = 'buyer' | 'artist';

const roles: { key: RoleChoice; title: string; text: string }[] = [
  { key: 'buyer', title: 'Покупаю', text: 'Ищу работы для дома, подарка или коллекции' },
  { key: 'artist', title: 'Продаю свои работы', text: 'Публикую работы и принимаю заказы' },
];

export default function RegisterScreen() {
  const { signUp } = useSession();
  const [role, setRole] = useState<RoleChoice>('buyer');
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
      router.dismissTo('/');
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
        <T variant="display">Добро пожаловать</T>
        <View style={styles.roles} accessibilityRole="radiogroup">
          {roles.map((r) => (
            <Pressable
              key={r.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: role === r.key }}
              onPress={() => setRole(r.key)}
              style={[styles.role, role === r.key && styles.roleOn]}>
              <T variant="heading" color={role === r.key ? colors.bordeaux : colors.ink}>
                {r.title}
              </T>
              <T variant="small">{r.text}</T>
            </Pressable>
          ))}
        </View>
        {error ? <Notice tone="danger" text={error} /> : null}
        <Field label="Имя" value={form.name} onChangeText={set('name')} autoComplete="name" error={errors.name} />
        <Field
          label="E-mail"
          value={form.email}
          onChangeText={set('email')}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          error={errors.email}
        />
        <Field
          label="Пароль"
          value={form.password}
          onChangeText={set('password')}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          hint="Не меньше 8 символов"
          error={errors.password}
        />
        <Field label="Город" value={form.city} onChangeText={set('city')} placeholder="Для доставки и поиска" />
        <Button title="Создать аккаунт" loading={busy} onPress={submit} />
        <T variant="small" center>
          Создавая аккаунт, вы соглашаетесь с политикой конфиденциальности на proartista.ru
        </T>
        <Button title="Уже есть аккаунт — войти" variant="ghost" onPress={() => router.replace('/login')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.xl, gap: space.lg },
  roles: { gap: space.sm },
  role: { padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.paper, gap: 2 },
  roleOn: { borderColor: colors.bordeaux, borderWidth: 2, backgroundColor: colors.bordeauxSoft },
});

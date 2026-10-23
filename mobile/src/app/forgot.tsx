import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { errorText, post } from '@/api/client';
import { Button, Field, Notice, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function ForgotScreen() {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Проверьте e-mail');
      return;
    }
    void run(async () => {
      await post('/auth/password/forgot', { email: email.trim() });
      setStep('code');
    });
  };

  const reset = () =>
    run(async () => {
      await post('/auth/password/reset', { email: email.trim(), code: code.trim(), password });
      setStep('done');
    });

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Notice tone="danger" text={error} /> : null}
        {step === 'email' ? (
          <>
            <T variant="body">Пришлём 6-значный код на почту, указанную при регистрации.</T>
            <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Button title="Получить код" loading={busy} onPress={sendCode} />
          </>
        ) : step === 'code' ? (
          <>
            <T variant="body">Если аккаунт с адресом {email.trim()} существует, код уже в почте. Он действует 15 минут.</T>
            <Field label="Код из письма" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
            <Field label="Новый пароль" value={password} onChangeText={setPassword} secureTextEntry hint="Не меньше 8 символов" autoComplete="new-password" />
            <Button title="Сохранить пароль" loading={busy} onPress={reset} disabled={code.length !== 6 || password.length < 8} />
            <Button title="Отправить код ещё раз" variant="ghost" onPress={sendCode} />
          </>
        ) : (
          <>
            <Notice tone="success" text="Пароль изменён. Все остальные сессии завершены." />
            <Button title="Войти" onPress={() => router.replace('/login')} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.xl, gap: space.lg },
});

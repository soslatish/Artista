import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { errorText } from '@/api/client';
import { useSession } from '@/auth/session';
import { Button, Field, Notice, T, type TextInputRef } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputRef>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Введите e-mail и пароль');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      router.dismissTo('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="display">С возвращением</T>
        {error ? <Notice tone="danger" text={error} /> : null}
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Field
          ref={passwordRef}
          label="Пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button title="Войти" loading={busy} onPress={submit} />
        <View style={styles.links}>
          <Button title="Забыли пароль?" variant="ghost" onPress={() => router.push('/forgot')} />
          <Button title="Создать аккаунт" variant="ghost" onPress={() => router.replace('/register')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.xl, gap: space.lg },
  links: { gap: 0 },
});

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { errorText } from '@/api/client';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { Button, Field, Notice, T, type TextInputRef } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function LoginScreen() {
  const t = useT();
  const styles = useStyles();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputRef>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('Введите e-mail и пароль'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      if (router.canDismiss()) router.dismiss();
      else router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="display">{t('С возвращением')}</T>
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
          label={t('Пароль')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button title={t('Войти')} loading={busy} onPress={submit} />
        <View>
          <Button title={t('Забыли пароль?')} variant="ghost" onPress={() => router.push('/forgot')} />
          <Button title={t('Создать аккаунт')} variant="ghost" onPress={() => router.replace('/register')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.xl, gap: space.lg },
}));

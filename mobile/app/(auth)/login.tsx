import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, ImageBackground } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../store/auth';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { COLORS, RADIUS } from '../../constants/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Заполните все поля');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBlock}>
            <Text style={styles.logo}>ARTISTA</Text>
            <Text style={styles.tagline}>Площадка для творческих людей</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Вход</Text>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="example@mail.ru"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Input
              label="Пароль"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureToggle
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title="Войти" onPress={handleLogin} loading={loading} style={styles.btn} />

            <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.link}>
              <Text style={styles.linkText}>Нет аккаунта? <Text style={styles.linkAccent}>Зарегистрироваться</Text></Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logo: { fontSize: 42, fontWeight: '900', color: COLORS.white, letterSpacing: 8 },
  tagline: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginBottom: 20 },
  error: { color: COLORS.red, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  btn: { marginTop: 8 },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: COLORS.textSecondary, fontSize: 14 },
  linkAccent: { color: COLORS.orange, fontWeight: '600' },
});

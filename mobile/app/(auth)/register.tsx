import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../store/auth';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { COLORS, RADIUS } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';

type Role = 'artist' | 'customer';

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [role, setRole] = useState<Role>('artist');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError('Заполните все поля');
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setError('Пароль минимум 6 символов');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password, name.trim(), role);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Ошибка регистрации');
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
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Регистрация</Text>

            <Text style={styles.roleLabel}>Я регистрируюсь как:</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleBtn, role === 'artist' && styles.roleBtnActive]}
                onPress={() => setRole('artist')}
              >
                <Ionicons name="brush" size={20} color={role === 'artist' ? COLORS.white : COLORS.textSecondary} />
                <Text style={[styles.roleBtnText, role === 'artist' && styles.roleBtnTextActive]}>Исполнитель</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleBtn, role === 'customer' && styles.roleBtnActive]}
                onPress={() => setRole('customer')}
              >
                <Ionicons name="person" size={20} color={role === 'customer' ? COLORS.white : COLORS.textSecondary} />
                <Text style={[styles.roleBtnText, role === 'customer' && styles.roleBtnTextActive]}>Заказчик</Text>
              </TouchableOpacity>
            </View>

            <Input label="Имя" value={name} onChangeText={setName} placeholder="Иван Иванов" />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="example@mail.ru"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Input label="Пароль" value={password} onChangeText={setPassword} placeholder="••••••••" secureToggle />
            <Input
              label="Повторите пароль"
              value={password2}
              onChangeText={setPassword2}
              placeholder="••••••••"
              secureToggle
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title="Зарегистрироваться" onPress={handleRegister} loading={loading} style={styles.btn} />

            <TouchableOpacity onPress={() => router.back()} style={styles.link}>
              <Text style={styles.linkText}>Уже есть аккаунт? <Text style={styles.linkAccent}>Войти</Text></Text>
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
  logoBlock: { alignItems: 'center', marginBottom: 24 },
  logo: { fontSize: 36, fontWeight: '900', color: COLORS.white, letterSpacing: 8 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginBottom: 16 },
  roleLabel: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 10, fontWeight: '500' },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.inputBg,
  },
  roleBtnActive: { borderColor: COLORS.orange, backgroundColor: COLORS.orange + '22' },
  roleBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  roleBtnTextActive: { color: COLORS.white },
  error: { color: COLORS.red, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  btn: { marginTop: 8 },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: COLORS.textSecondary, fontSize: 14 },
  linkAccent: { color: COLORS.orange, fontWeight: '600' },
});

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { COLORS, RADIUS, SERVICE_CATEGORIES } from '../constants/theme';
import { useAuthStore } from '../store/auth';

export default function EditProfileScreen() {
  const { user, updateUser } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [city, setCity] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [categories, setCategories] = useState(
    user?.categories ? user.categories.split(',').map((c) => c.trim()).filter(Boolean) : []
  );
  const [loading, setLoading] = useState(false);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Ошибка', 'Имя не может быть пустым'); return; }
    setLoading(true);
    try {
      const { data } = await api.patch('/users/me', {
        name: name.trim(),
        bio: bio.trim() || undefined,
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        categories: categories.join(', ') || undefined,
      });
      updateUser(data);
      router.back();
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Редактировать профиль</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Input label="Имя" value={name} onChangeText={setName} placeholder="Иван Иванов" />
          <Input
            label="О себе"
            value={bio}
            onChangeText={setBio}
            placeholder="Расскажите о себе, своём опыте..."
            multiline
            numberOfLines={4}
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          <Input label="Город" value={city} onChangeText={setCity} placeholder="Москва" />
          <Input label="Телефон" value={phone} onChangeText={setPhone} placeholder="+7 999 123-45-67" keyboardType="phone-pad" />

          {user?.role === 'artist' && (
            <>
              <Text style={styles.label}>Мои специализации</Text>
              <View style={styles.tagsGrid}>
                {SERVICE_CATEGORIES.slice(1).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => toggleCategory(cat)}
                    style={[styles.tagChip, categories.includes(cat) && styles.tagChipActive]}
                  >
                    <Text style={[styles.tagText, categories.includes(cat) && styles.tagTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Button title="Сохранить" onPress={handleSave} loading={loading} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.white },
  content: { padding: 16, paddingBottom: 40 },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500', marginBottom: 10 },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full,
    backgroundColor: COLORS.inputBg, borderWidth: 1.5, borderColor: COLORS.inputBorder,
  },
  tagChipActive: { borderColor: COLORS.orange, backgroundColor: COLORS.orange + '22' },
  tagText: { color: COLORS.textSecondary, fontSize: 13 },
  tagTextActive: { color: COLORS.white, fontWeight: '600' },
  btn: { marginTop: 8 },
});

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../services/api';
import { Service, Event } from '../../types';
import { ServiceCard } from '../../components/ServiceCard';
import { EventCard } from '../../components/EventCard';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function ProfileScreen() {
  const { user, logout, updateUser } = useAuthStore();
  const [myContent, setMyContent] = useState<Service[] | Event[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMyContent = async () => {
    try {
      if (user?.role === 'artist') {
        const { data } = await api.get('/services/my');
        setMyContent(data);
      } else {
        const { data } = await api.get('/events/my');
        setMyContent(data);
      }
    } catch {
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { fetchMyContent(); }, []));

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    const form = new FormData();
    form.append('file', { uri: file.uri, name: 'avatar.jpg', type: 'image/jpeg' } as any);
    try {
      const { data } = await api.post('/users/me/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      updateUser(data);
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    }
  };

  const handleLogout = () => {
    Alert.alert('Выход', 'Вы уверены?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: logout },
    ]);
  };

  if (!user) return null;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchMyContent} tintColor={COLORS.orange} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={pickAvatar} style={styles.avatarWrap}>
            <Avatar uri={user.avatar_url} name={user.name} size={86} />
            <View style={styles.avatarEdit}>
              <Ionicons name="camera" size={14} color={COLORS.white} />
            </View>
          </TouchableOpacity>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.role}>{user.role === 'artist' ? 'Исполнитель' : 'Заказчик'}</Text>

          <View style={styles.stats}>
            <View style={styles.statItem}>
              <Ionicons name="star" size={16} color={COLORS.star} />
              <Text style={styles.statValue}>{user.rating.toFixed(1)}</Text>
              <Text style={styles.statLabel}>рейтинг</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{user.reviews_count}</Text>
              <Text style={styles.statLabel}>отзывов</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{myContent.length}</Text>
              <Text style={styles.statLabel}>{user.role === 'artist' ? 'услуг' : 'заказов'}</Text>
            </View>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          {user.bio && <Text style={styles.bio}>{user.bio}</Text>}
          <View style={styles.infoRow}>
            {user.city && (
              <View style={styles.infoItem}>
                <Ionicons name="location-outline" size={15} color={COLORS.orange} />
                <Text style={styles.infoText}>{user.city}</Text>
              </View>
            )}
            {user.phone && (
              <View style={styles.infoItem}>
                <Ionicons name="call-outline" size={15} color={COLORS.orange} />
                <Text style={styles.infoText}>{user.phone}</Text>
              </View>
            )}
          </View>
          {user.categories && (
            <View style={styles.tagsRow}>
              {user.categories.split(',').filter(Boolean).map((cat) => (
                <View key={cat} style={styles.tag}>
                  <Text style={styles.tagText}>{cat.trim()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button title="Редактировать профиль" onPress={() => router.push('/edit-profile')} variant="outline" />
          {user.role === 'artist' && (
            <Button title="+ Добавить услугу" onPress={() => router.push('/create-service')} style={{ marginTop: 10 }} />
          )}
          {user.role === 'customer' && (
            <Button title="+ Создать заказ" onPress={() => router.push('/create-event')} style={{ marginTop: 10 }} />
          )}
        </View>

        {/* My content */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{user.role === 'artist' ? 'Мои услуги' : 'Мои заказы'}</Text>
          {myContent.length === 0 ? (
            <Text style={styles.emptyText}>Пока нет {user.role === 'artist' ? 'услуг' : 'заказов'}</Text>
          ) : user.role === 'artist' ? (
            (myContent as Service[]).map((s) => <ServiceCard key={s.id} service={s} />)
          ) : (
            (myContent as Event[]).map((e) => <EventCard key={e.id} event={e} />)
          )}
        </View>

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.red} />
          <Text style={styles.logoutText}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { alignItems: 'center', padding: 24, paddingBottom: 16 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarEdit: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.orange, alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 22, fontWeight: '800', color: COLORS.white },
  role: { color: COLORS.textSecondary, fontSize: 14, marginTop: 2, marginBottom: 16 },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  statDivider: { width: 1, height: 30, backgroundColor: COLORS.cardBorder },
  infoCard: {
    marginHorizontal: 16, backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  bio: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 10 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { color: COLORS.white, fontSize: 14 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: COLORS.inputBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.inputBorder },
  tagText: { color: COLORS.textSecondary, fontSize: 12 },
  actions: { marginHorizontal: 16, marginBottom: 20 },
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 12 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginVertical: 24,
  },
  logoutText: { color: COLORS.red, fontSize: 15, fontWeight: '600' },
});

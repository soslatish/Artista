import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { Event, EventApplication } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [event, setEvent] = useState<Event | null>(null);
  const [applications, setApplications] = useState<EventApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyModal, setApplyModal] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [applyPrice, setApplyPrice] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api.get(`/events/${id}`)
      .then((r) => {
        setEvent(r.data);
        if (r.data.user_id === user?.id) {
          return api.get(`/events/${id}/applications`).then((ra) => setApplications(ra.data));
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleApply = async () => {
    setApplying(true);
    try {
      await api.post(`/events/${id}/apply`, {
        message: applyMsg,
        price: applyPrice ? parseFloat(applyPrice) : undefined,
      });
      setApplyModal(false);
      Alert.alert('Успешно', 'Отклик отправлен!');
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.orange} style={{ flex: 1, marginTop: 80 }} />;
  if (!event) return null;

  const images: string[] = event.images ? JSON.parse(event.images) : [];
  const isOwner = event.user_id === user?.id;
  const canApply = user?.role === 'artist' && !isOwner && event.status === 'open';

  return (
    <SafeAreaView style={styles.root}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={COLORS.white} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        {images[0] && <Image source={{ uri: images[0] }} style={styles.mainImage} resizeMode="cover" />}

        <View style={styles.body}>
          <View style={styles.statusRow}>
            <View style={styles.catChip}><Text style={styles.catText}>{event.category}</Text></View>
            <View style={[styles.statusBadge, event.status === 'open' && styles.statusOpen]}>
              <Text style={[styles.statusText, event.status === 'open' && styles.statusTextOpen]}>
                {event.status === 'open' ? 'Открыто' : 'Закрыто'}
              </Text>
            </View>
          </View>

          <Text style={styles.title}>{event.title}</Text>

          <View style={styles.metaGrid}>
            {event.city && (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={15} color={COLORS.orange} />
                <Text style={styles.metaText}>{event.city}</Text>
              </View>
            )}
            {event.event_date && (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={15} color={COLORS.orange} />
                <Text style={styles.metaText}>{event.event_date}</Text>
              </View>
            )}
            {(event.budget_min || event.budget_max) && (
              <View style={styles.metaItem}>
                <Ionicons name="cash-outline" size={15} color={COLORS.orange} />
                <Text style={styles.metaText}>
                  {event.budget_min && event.budget_max
                    ? `${event.budget_min.toLocaleString('ru')} – ${event.budget_max.toLocaleString('ru')} ₽`
                    : event.budget_min
                    ? `от ${event.budget_min.toLocaleString('ru')} ₽`
                    : `до ${event.budget_max?.toLocaleString('ru')} ₽`}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.description}>{event.description}</Text>

          {/* Owner */}
          <TouchableOpacity style={styles.ownerCard} onPress={() => router.push(`/user/${event.owner.id}`)}>
            <Avatar uri={event.owner.avatar_url} name={event.owner.name} size={46} />
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerName}>{event.owner.name}</Text>
              <Text style={styles.ownerRole}>Заказчик</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          {!isOwner && (
            <View style={styles.btnRow}>
              <Button title="Написать" variant="outline" onPress={() => router.push(`/chat/${event.owner.id}`)} style={{ flex: 1 }} />
              {canApply && (
                <Button title="Откликнуться" onPress={() => setApplyModal(true)} style={{ flex: 1 }} />
              )}
            </View>
          )}

          {/* Applications (owner) */}
          {isOwner && applications.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Отклики ({applications.length})</Text>
              {applications.map((app) => (
                <View key={app.id} style={styles.appCard}>
                  <View style={styles.appHeader}>
                    <Avatar uri={app.artist.avatar_url} name={app.artist.name} size={38} />
                    <View style={styles.appInfo}>
                      <Text style={styles.appName}>{app.artist.name}</Text>
                      <View style={styles.ratingRow}>
                        <Ionicons name="star" size={12} color={COLORS.star} />
                        <Text style={styles.ratingText}>{app.artist.rating.toFixed(1)}</Text>
                      </View>
                    </View>
                    {app.price && <Text style={styles.appPrice}>{app.price.toLocaleString('ru')} ₽</Text>}
                  </View>
                  {app.message && <Text style={styles.appMsg}>{app.message}</Text>}
                  {app.status === 'pending' && (
                    <View style={styles.appBtnRow}>
                      <Button title="Принять" variant="green" small
                        onPress={async () => {
                          await api.patch(`/events/applications/${app.id}?status=accepted`);
                          setApplications((p) => p.map((a) => a.id === app.id ? { ...a, status: 'accepted' } : a));
                        }}
                      />
                      <Button title="Отклонить" variant="danger" small
                        onPress={async () => {
                          await api.patch(`/events/applications/${app.id}?status=rejected`);
                          setApplications((p) => p.map((a) => a.id === app.id ? { ...a, status: 'rejected' } : a));
                        }}
                      />
                      <Button title="Написать" variant="outline" small onPress={() => router.push(`/chat/${app.artist.id}`)} />
                    </View>
                  )}
                  {app.status !== 'pending' && (
                    <View style={[styles.statusBadge, app.status === 'accepted' && styles.statusOpen, { alignSelf: 'flex-start' }]}>
                      <Text style={[styles.statusText, app.status === 'accepted' && styles.statusTextOpen]}>
                        {app.status === 'accepted' ? 'Принят' : 'Отклонён'}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={applyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Отклик на заказ</Text>
            <TextInput
              value={applyMsg}
              onChangeText={setApplyMsg}
              placeholder="Расскажите о своём опыте..."
              placeholderTextColor={COLORS.textMuted}
              style={styles.modalInput}
              multiline
              numberOfLines={3}
            />
            <TextInput
              value={applyPrice}
              onChangeText={setApplyPrice}
              placeholder="Ваша цена (₽)"
              placeholderTextColor={COLORS.textMuted}
              style={[styles.modalInput, { minHeight: 0, height: 48 }]}
              keyboardType="numeric"
            />
            <Button title="Отправить отклик" onPress={handleApply} loading={applying} />
            <Button title="Отмена" variant="outline" onPress={() => setApplyModal(false)} style={{ marginTop: 10 }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  backBtn: {
    position: 'absolute', top: 52, left: 16, zIndex: 10,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  mainImage: { width: '100%', height: 240 },
  body: { padding: 16 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  catChip: { backgroundColor: COLORS.inputBg, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5 },
  catText: { color: COLORS.textSecondary, fontSize: 13 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full, backgroundColor: COLORS.red + '22' },
  statusOpen: { backgroundColor: COLORS.green + '22' },
  statusText: { color: COLORS.red, fontSize: 12, fontWeight: '600' },
  statusTextOpen: { color: COLORS.green },
  title: { fontSize: 21, fontWeight: '800', color: COLORS.white, marginBottom: 14 },
  metaGrid: { gap: 8, marginBottom: 16 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { color: COLORS.white, fontSize: 14 },
  description: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  ownerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 14,
    marginBottom: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  ownerInfo: { flex: 1 },
  ownerName: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  ownerRole: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 12 },
  appCard: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.cardBorder },
  appHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  appInfo: { flex: 1 },
  appName: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { color: COLORS.star, fontSize: 12 },
  appPrice: { color: COLORS.orange, fontSize: 16, fontWeight: '700' },
  appMsg: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 },
  appBtnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 14 },
  modalInput: {
    backgroundColor: COLORS.inputBg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.inputBorder,
    color: COLORS.white, padding: 12, fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 12,
  },
});

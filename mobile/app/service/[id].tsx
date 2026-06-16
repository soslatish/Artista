import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { Service, Review, ServiceApplication } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { ReviewCard } from '../../components/ReviewCard';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function ServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [service, setService] = useState<Service | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [applications, setApplications] = useState<ServiceApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyModal, setApplyModal] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [applying, setApplying] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);

  useEffect(() => {
    Promise.all([
      api.get(`/services/${id}`).then((r) => setService(r.data)),
      api.get(`/reviews/user/${id}`).then((r) => setReviews(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false));

    if (user?.role === 'artist' || service?.user_id === user?.id) {
      api.get(`/services/${id}/applications`).then((r) => setApplications(r.data)).catch(() => {});
    }
  }, [id]);

  const handleApply = async () => {
    setApplying(true);
    try {
      await api.post(`/services/${id}/apply`, { message: applyMsg });
      setApplyModal(false);
      Alert.alert('Успешно', 'Заявка отправлена!');
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.orange} style={{ flex: 1, marginTop: 80 }} />;
  if (!service) return null;

  const images: string[] = service.images ? JSON.parse(service.images) : [];
  const isOwner = service.user_id === user?.id;
  const canApply = user?.role === 'customer' && !isOwner;

  return (
    <SafeAreaView style={styles.root}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={COLORS.white} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        {images.length > 0 && (
          <View>
            <Image source={{ uri: images[imgIndex] }} style={styles.mainImage} resizeMode="cover" />
            {images.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                {images.map((uri, i) => (
                  <TouchableOpacity key={i} onPress={() => setImgIndex(i)}>
                    <Image source={{ uri }} style={[styles.thumb, i === imgIndex && styles.thumbActive]} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.title}>{service.title}</Text>

          <View style={styles.metaRow}>
            <View style={styles.catChip}>
              <Text style={styles.catText}>{service.category}</Text>
            </View>
            {(service.price_from || service.price_to) && (
              <Text style={styles.price}>
                {service.price_from ? `от ${service.price_from.toLocaleString('ru')} ₽` : ''}
                {service.price_from && service.price_to ? ' — ' : ''}
                {service.price_to ? `до ${service.price_to.toLocaleString('ru')} ₽` : ''}
              </Text>
            )}
          </View>

          <Text style={styles.description}>{service.description}</Text>

          {/* Owner */}
          <TouchableOpacity
            style={styles.ownerCard}
            onPress={() => router.push(`/user/${service.owner.id}`)}
          >
            <Avatar uri={service.owner.avatar_url} name={service.owner.name} size={50} />
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerName}>{service.owner.name}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color={COLORS.star} />
                <Text style={styles.ratingText}>{service.owner.rating.toFixed(1)}</Text>
                <Text style={styles.reviewsCount}>({service.owner.reviews_count} отзывов)</Text>
              </View>
              {service.owner.city && (
                <View style={styles.cityRow}>
                  <Ionicons name="location-outline" size={13} color={COLORS.textSecondary} />
                  <Text style={styles.cityText}>{service.owner.city}</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          {/* Contact / Apply */}
          {!isOwner && (
            <View style={styles.btnRow}>
              <Button
                title="Написать"
                variant="outline"
                onPress={() => router.push(`/chat/${service.owner.id}`)}
                style={{ flex: 1 }}
              />
              {canApply && (
                <Button
                  title="Оставить заявку"
                  onPress={() => setApplyModal(true)}
                  style={{ flex: 1 }}
                />
              )}
            </View>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Отзывы</Text>
              {reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
            </View>
          )}

          {/* My applications (owner view) */}
          {isOwner && applications.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Заявки ({applications.length})</Text>
              {applications.map((app) => (
                <View key={app.id} style={styles.appCard}>
                  <View style={styles.appHeader}>
                    <Avatar uri={app.applicant.avatar_url} name={app.applicant.name} size={36} />
                    <Text style={styles.appName}>{app.applicant.name}</Text>
                    <View style={[styles.appBadge, app.status === 'accepted' && styles.appBadgeGreen]}>
                      <Text style={styles.appBadgeText}>
                        {app.status === 'pending' ? 'Новая' : app.status === 'accepted' ? 'Принята' : 'Отклонена'}
                      </Text>
                    </View>
                  </View>
                  {app.message && <Text style={styles.appMsg}>{app.message}</Text>}
                  {app.status === 'pending' && (
                    <View style={styles.appBtnRow}>
                      <Button title="Принять" variant="green" small
                        onPress={async () => {
                          await api.patch(`/services/applications/${app.id}?status=accepted`);
                          setApplications((prev) => prev.map((a) => a.id === app.id ? { ...a, status: 'accepted' } : a));
                        }}
                      />
                      <Button title="Отклонить" variant="danger" small
                        onPress={async () => {
                          await api.patch(`/services/applications/${app.id}?status=rejected`);
                          setApplications((prev) => prev.map((a) => a.id === app.id ? { ...a, status: 'rejected' } : a));
                        }}
                      />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Apply Modal */}
      <Modal visible={applyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Оставить заявку</Text>
            <TextInput
              value={applyMsg}
              onChangeText={setApplyMsg}
              placeholder="Расскажите о себе или задайте вопрос..."
              placeholderTextColor={COLORS.textMuted}
              style={styles.modalInput}
              multiline
              numberOfLines={4}
            />
            <Button title="Отправить" onPress={handleApply} loading={applying} />
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
  mainImage: { width: '100%', height: 280 },
  thumbRow: { paddingHorizontal: 12, paddingVertical: 8 },
  thumb: { width: 60, height: 60, borderRadius: RADIUS.sm, marginRight: 8, borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: COLORS.orange },
  body: { padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  catChip: { backgroundColor: COLORS.inputBg, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5 },
  catText: { color: COLORS.textSecondary, fontSize: 13 },
  price: { color: COLORS.orange, fontSize: 18, fontWeight: '800' },
  description: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  ownerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg,
    padding: 14, marginBottom: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  ownerInfo: { flex: 1 },
  ownerName: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  ratingText: { color: COLORS.star, fontSize: 14, fontWeight: '600' },
  reviewsCount: { color: COLORS.textMuted, fontSize: 12 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cityText: { color: COLORS.textSecondary, fontSize: 13 },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 12 },
  appCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: 12, marginBottom: 10, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  appHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  appName: { flex: 1, color: COLORS.white, fontSize: 14, fontWeight: '600' },
  appBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, backgroundColor: COLORS.orange + '33' },
  appBadgeGreen: { backgroundColor: COLORS.green + '33' },
  appBadgeText: { color: COLORS.orange, fontSize: 11, fontWeight: '600' },
  appMsg: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 },
  appBtnRow: { flexDirection: 'row', gap: 8 },
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 14 },
  modalInput: {
    backgroundColor: COLORS.inputBg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.inputBorder,
    color: COLORS.white, padding: 12, fontSize: 14, minHeight: 100, textAlignVertical: 'top', marginBottom: 14,
  },
});

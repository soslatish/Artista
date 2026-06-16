import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { User, Review, Service, Event } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { ReviewCard } from '../../components/ReviewCard';
import { ServiceCard } from '../../components/ServiceCard';
import { EventCard } from '../../components/EventCard';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useAuthStore();
  const [profile, setProfile] = useState<User | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/users/${id}`).then((r) => setProfile(r.data)),
      api.get(`/reviews/user/${id}`).then((r) => setReviews(r.data)),
    ])
      .then(async ([userResp]) => {
        const u = userResp.data as User;
        if (u.role === 'artist') {
          const { data } = await api.get('/services/', { params: {} });
          setServices(data.filter((s: Service) => s.user_id === u.id));
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const submitReview = async () => {
    setSubmittingReview(true);
    try {
      const { data } = await api.post('/reviews/', {
        reviewed_id: parseInt(id),
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      setReviews((p) => [data, ...p]);
      setReviewModal(false);
      setReviewComment('');
      Alert.alert('Спасибо!', 'Ваш отзыв опубликован');
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.orange} style={{ flex: 1, marginTop: 80 }} />;
  if (!profile) return null;

  const isMe = profile.id === me?.id;

  return (
    <SafeAreaView style={styles.root}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={COLORS.white} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Avatar uri={profile.avatar_url} name={profile.name} size={86} />
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.role}>{profile.role === 'artist' ? 'Исполнитель' : 'Заказчик'}</Text>

          <View style={styles.stats}>
            <View style={styles.statItem}>
              <Ionicons name="star" size={16} color={COLORS.star} />
              <Text style={styles.statValue}>{profile.rating.toFixed(1)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile.reviews_count}</Text>
              <Text style={styles.statLabel}>отзывов</Text>
            </View>
          </View>

          {!isMe && (
            <View style={styles.headerBtns}>
              <Button title="Написать" variant="outline" onPress={() => router.push(`/chat/${profile.id}`)} style={{ flex: 1 }} />
              <Button title="Оставить отзыв" onPress={() => setReviewModal(true)} style={{ flex: 1 }} />
            </View>
          )}
        </View>

        <View style={styles.infoCard}>
          {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
          <View style={styles.infoRow}>
            {profile.city && (
              <View style={styles.infoItem}>
                <Ionicons name="location-outline" size={15} color={COLORS.orange} />
                <Text style={styles.infoText}>{profile.city}</Text>
              </View>
            )}
            {profile.phone && (
              <View style={styles.infoItem}>
                <Ionicons name="call-outline" size={15} color={COLORS.orange} />
                <Text style={styles.infoText}>{profile.phone}</Text>
              </View>
            )}
          </View>
          {profile.categories && (
            <View style={styles.tagsRow}>
              {profile.categories.split(',').filter(Boolean).map((cat) => (
                <View key={cat} style={styles.tag}>
                  <Text style={styles.tagText}>{cat.trim()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {services.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Услуги</Text>
            {services.map((s) => <ServiceCard key={s.id} service={s} />)}
          </View>
        )}

        {reviews.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Отзывы ({reviews.length})</Text>
            {reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
          </View>
        )}
      </ScrollView>

      <Modal visible={reviewModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Оставить отзыв</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <TouchableOpacity key={i} onPress={() => setReviewRating(i)}>
                  <Ionicons name={i <= reviewRating ? 'star' : 'star-outline'} size={32} color={COLORS.star} />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Расскажите о сотрудничестве..."
              placeholderTextColor={COLORS.textMuted}
              style={styles.modalInput}
              multiline
              numberOfLines={4}
            />
            <Button title="Опубликовать" onPress={submitReview} loading={submittingReview} />
            <Button title="Отмена" variant="outline" onPress={() => setReviewModal(false)} style={{ marginTop: 10 }} />
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
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  header: { alignItems: 'center', padding: 24, paddingTop: 60, paddingBottom: 16 },
  name: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginTop: 12 },
  role: { color: COLORS.textSecondary, fontSize: 14, marginTop: 3, marginBottom: 14 },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 16 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: 12 },
  statDivider: { width: 1, height: 24, backgroundColor: COLORS.cardBorder },
  headerBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  infoCard: {
    marginHorizontal: 16, backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  bio: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 8 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { color: COLORS.white, fontSize: 14 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { backgroundColor: COLORS.inputBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.inputBorder },
  tagText: { color: COLORS.textSecondary, fontSize: 12 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 12 },
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 16 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  modalInput: {
    backgroundColor: COLORS.inputBg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.inputBorder,
    color: COLORS.white, padding: 12, fontSize: 14, minHeight: 100, textAlignVertical: 'top', marginBottom: 14,
  },
});

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Event } from '../types';
import { Avatar } from './ui/Avatar';
import { COLORS, RADIUS, SHADOW } from '../constants/theme';

interface Props {
  event: Event;
}

export function EventCard({ event }: Props) {
  const images: string[] = event.images ? JSON.parse(event.images) : [];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/event/${event.id}`)}
      activeOpacity={0.85}
    >
      {images[0] && (
        <Image source={{ uri: images[0] }} style={styles.image} resizeMode="cover" />
      )}
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.category}>{event.category}</Text>
          <View style={[styles.statusBadge, event.status === 'open' && styles.statusOpen]}>
            <Text style={styles.statusText}>{event.status === 'open' ? 'Открыто' : 'Закрыто'}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <View style={styles.meta}>
          {event.city && (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{event.city}</Text>
            </View>
          )}
          {event.event_date && (
            <View style={styles.metaItem}>
              <Ionicons name="calendar-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{event.event_date}</Text>
            </View>
          )}
        </View>
        <View style={styles.footer}>
          <View style={styles.ownerRow}>
            <Avatar uri={event.owner.avatar_url} name={event.owner.name} size={28} />
            <Text style={styles.ownerName} numberOfLines={1}>{event.owner.name}</Text>
          </View>
          {(event.budget_min || event.budget_max) && (
            <Text style={styles.budget}>
              {event.budget_min && event.budget_max
                ? `${event.budget_min.toLocaleString('ru')} – ${event.budget_max.toLocaleString('ru')} ₽`
                : event.budget_min
                ? `от ${event.budget_min.toLocaleString('ru')} ₽`
                : `до ${event.budget_max?.toLocaleString('ru')} ₽`}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...SHADOW.card,
  },
  image: { width: '100%', height: 140 },
  body: { padding: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  category: { color: COLORS.textSecondary, fontSize: 12, backgroundColor: COLORS.inputBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, backgroundColor: COLORS.red + '33' },
  statusOpen: { backgroundColor: COLORS.green + '33' },
  statusText: { color: COLORS.green, fontSize: 11, fontWeight: '600' },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  meta: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: COLORS.textSecondary, fontSize: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerName: { color: COLORS.textSecondary, fontSize: 12 },
  budget: { color: COLORS.orange, fontSize: 14, fontWeight: '700' },
});

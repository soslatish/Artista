import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Service } from '../types';
import { Avatar } from './ui/Avatar';
import { COLORS, RADIUS, SHADOW } from '../constants/theme';

interface Props {
  service: Service;
}

export function ServiceCard({ service }: Props) {
  const images: string[] = service.images ? JSON.parse(service.images) : [];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/service/${service.id}`)}
      activeOpacity={0.85}
    >
      {images[0] && (
        <Image source={{ uri: images[0] }} style={styles.image} resizeMode="cover" />
      )}
      <View style={styles.body}>
        <View style={styles.ownerRow}>
          <Avatar uri={service.owner.avatar_url} name={service.owner.name} size={32} />
          <Text style={styles.ownerName} numberOfLines={1}>{service.owner.name}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color={COLORS.star} />
            <Text style={styles.rating}>{service.owner.rating.toFixed(1)}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>{service.title}</Text>
        <View style={styles.footer}>
          <Text style={styles.category}>{service.category}</Text>
          {(service.price_from || service.price_to) && (
            <Text style={styles.price}>
              {service.price_from ? `от ${service.price_from.toLocaleString('ru')} ₽` : `до ${service.price_to?.toLocaleString('ru')} ₽`}
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
  image: { width: '100%', height: 160 },
  body: { padding: 12 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  ownerName: { flex: 1, color: COLORS.white, fontSize: 13, fontWeight: '500' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rating: { color: COLORS.star, fontSize: 12, fontWeight: '600' },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { color: COLORS.textSecondary, fontSize: 12, backgroundColor: COLORS.inputBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  price: { color: COLORS.orange, fontSize: 14, fontWeight: '700' },
});

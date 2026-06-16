import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Review } from '../types';
import { Avatar } from './ui/Avatar';
import { COLORS, RADIUS } from '../constants/theme';

interface Props {
  review: Review;
}

export function ReviewCard({ review }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar uri={review.reviewer.avatar_url} name={review.reviewer.name} size={38} />
        <View style={styles.info}>
          <Text style={styles.name}>{review.reviewer.name}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons
                key={i}
                name={i <= review.rating ? 'star' : 'star-outline'}
                size={14}
                color={COLORS.star}
              />
            ))}
          </View>
        </View>
        <Text style={styles.date}>{new Date(review.created_at).toLocaleDateString('ru')}</Text>
      </View>
      {review.comment && <Text style={styles.comment}>{review.comment}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  info: { flex: 1 },
  name: { color: COLORS.white, fontSize: 14, fontWeight: '600', marginBottom: 3 },
  stars: { flexDirection: 'row', gap: 2 },
  date: { color: COLORS.textMuted, fontSize: 11 },
  comment: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
});

// Строка списка «превью — заголовок — статус — сумма» (предложения, заказы на заказ, сертификаты).
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { T } from './primitives';
import { makeStyles, radius, space } from './theme';

interface DealRowProps {
  image?: string;
  title: string;
  subtitle?: string;
  status?: string;
  statusColor?: string;
  right?: string;
  rightSub?: string;
  highlight?: boolean;
  onPress?: () => void;
}

export function DealRow({ image, title, subtitle, status, statusColor, right, rightSub, highlight, onPress }: DealRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, status].filter(Boolean).join(', ')}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {image ? <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
      <View style={styles.body}>
        <T variant="artTitleSmall" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T variant="small" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
        {status ? (
          <View style={styles.statusRow}>
            {highlight ? <View style={styles.dot} /> : null}
            <T variant="smallStrong" color={statusColor}>
              {status}
            </T>
          </View>
        ) : null}
      </View>
      {right ? (
        <View style={styles.right}>
          <T variant="price">{right}</T>
          {rightSub ? <T variant="small">{rightSub}</T> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center' },
  pressed: { backgroundColor: c.plaster },
  thumb: { width: 56, height: 70, borderRadius: radius.art, backgroundColor: c.plaster },
  body: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.gold },
  right: { alignItems: 'flex-end', gap: 2 },
}));

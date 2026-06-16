import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADIUS } from '../../constants/theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'orange' | 'green' | 'outline' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  small?: boolean;
}

export function Button({ title, onPress, variant = 'orange', loading, disabled, style, small }: Props) {
  const bg = {
    orange: COLORS.orange,
    green: COLORS.green,
    outline: 'transparent',
    danger: COLORS.red,
  }[variant];

  const textColor = variant === 'outline' ? COLORS.orange : COLORS.white;
  const borderColor = variant === 'outline' ? COLORS.orange : 'transparent';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btn,
        { backgroundColor: bg, borderColor, borderWidth: variant === 'outline' ? 1.5 : 0 },
        small && styles.small,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.white} size="small" />
      ) : (
        <Text style={[styles.text, { color: textColor }, small && styles.smallText]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADIUS.sm },
  disabled: { opacity: 0.5 },
  text: { fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  smallText: { fontSize: 13 },
});

import React, { useState } from 'react';
import { View, TextInput, Text, TouchableOpacity, StyleSheet, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS } from '../../constants/theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  secureToggle?: boolean;
}

export function Input({ label, error, secureToggle, style, ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.row, error && styles.errorBorder]}>
        <TextInput
          {...props}
          secureTextEntry={secureToggle ? !visible : props.secureTextEntry}
          placeholderTextColor={COLORS.textMuted}
          style={[styles.input, style]}
        />
        {secureToggle && (
          <TouchableOpacity onPress={() => setVisible(!visible)} style={styles.eye}>
            <Ionicons name={visible ? 'eye-off' : 'eye'} size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 14 },
  label: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 6, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  input: { flex: 1, color: COLORS.white, fontSize: 15, paddingVertical: 13, paddingHorizontal: 14 },
  eye: { paddingHorizontal: 12 },
  errorBorder: { borderColor: COLORS.red },
  error: { color: COLORS.red, fontSize: 12, marginTop: 4 },
});

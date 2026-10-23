// Базовые элементы интерфейса: текст, кнопки, поля, чипы, состояния.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type ComponentProps, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

import { initials } from '@/lib/format';

import { colors, fonts, hitSlop, radius, space, type, type TypeVariant } from './theme';

// ---------- текст ----------

interface TProps extends TextProps {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
}

export function T({ variant = 'body', color, center, style, ...rest }: TProps) {
  return <Text {...rest} style={[type[variant], color ? { color } : null, center ? styles.center : null, style]} />;
}

// ---------- кнопки ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light' | 'outlineLight';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityHint }: ButtonProps) {
  const v = buttonVariants[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, v.box, pressed && styles.pressed, inactive && styles.disabled, style]}>
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={v.text.color} /> : null}
          <Text style={[styles.buttonText, v.text]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { box: ViewStyle; text: TextStyle & { color: string } }> = {
  primary: { box: { backgroundColor: colors.bordeaux }, text: { color: colors.onDark } },
  secondary: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.ink }, text: { color: colors.ink } },
  ghost: { box: { backgroundColor: 'transparent' }, text: { color: colors.bordeaux } },
  danger: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger }, text: { color: colors.danger } },
  light: { box: { backgroundColor: colors.paper }, text: { color: colors.bordeaux } },
  outlineLight: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.onDark }, text: { color: colors.onDark } },
};

interface IconButtonProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  badge?: number;
}

export function IconButton({ icon, label, onPress, color = colors.ink, size = 24, badge }: IconButtonProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={hitSlop} onPress={onPress} style={styles.iconButton}>
      <Ionicons name={icon} size={size} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------- поля ----------

export type TextInputRef = ComponentRef<typeof TextInput>;

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  ref?: Ref<TextInputRef>;
}

export function Field({ label, error, hint, style, multiline, ref, ...rest }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.graphite}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------- чипы ----------

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// ---------- аватар ----------

interface AvatarProps {
  uri?: string;
  name: string;
  size?: number;
}

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.avatarFallback, box]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name) || 'A'}</Text>
    </View>
  );
}

/** Отметка премиум-художника: золотой мазок, без слова «PRO». */
export function PremiumMark() {
  return (
    <View accessibilityLabel="Премиум-художник" style={styles.premium}>
      <Ionicons name="brush" size={11} color={colors.bordeaux} />
    </View>
  );
}

// ---------- состояния экрана ----------

export function Loading() {
  return (
    <View style={styles.state} accessibilityLabel="Загрузка">
      <ActivityIndicator color={colors.bordeaux} />
    </View>
  );
}

interface MessageStateProps {
  title: string;
  text?: string;
  action?: ReactNode;
  icon?: ComponentProps<typeof Ionicons>['name'];
}

export function EmptyState({ title, text, action, icon = 'images-outline' }: MessageStateProps) {
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={36} color={colors.hairline} />
      <T variant="title" center style={styles.stateTitle}>
        {title}
      </T>
      {text ? (
        <T variant="small" center>
          {text}
        </T>
      ) : null}
      {action ? <View style={styles.stateAction}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Не удалось загрузить"
      text={text}
      action={onRetry ? <Button title="Повторить" variant="secondary" onPress={onRetry} /> : null}
    />
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Карточка-предупреждение (ошибка формы, подсказка). */
export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'danger' | 'success' }) {
  const bg = tone === 'danger' ? colors.dangerSoft : tone === 'success' ? colors.successSoft : colors.goldSoft;
  const fg = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.ink;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[type.small, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  button: {
    minHeight: 50,
    borderRadius: radius.control,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { fontFamily: fonts.sansSemi, fontSize: 16 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  iconButton: { padding: space.xs, minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.bordeauxDeep },
  field: { gap: 6 },
  fieldLabel: { ...type.smallStrong },
  input: {
    ...type.body,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: colors.paper,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  fieldError: { ...type.small, color: colors.danger },
  fieldHint: { ...type.small },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  chipSelected: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  chipText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.ink },
  chipTextSelected: { color: colors.onDark },
  avatarFallback: { backgroundColor: colors.bordeauxSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.serif, color: colors.bordeaux },
  premium: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm, minHeight: 280 },
  stateTitle: { marginTop: space.sm },
  stateAction: { marginTop: space.lg, alignSelf: 'stretch' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  notice: { padding: space.md, borderRadius: radius.control },
});

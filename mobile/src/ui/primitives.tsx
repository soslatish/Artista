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

import { useT } from '@/i18n';
import { initials } from '@/lib/format';

import { fonts, hitSlop, makeStyles, type Palette, radius, space, type TypeVariant, useTheme } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------- текст ----------

interface TProps extends TextProps {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
}

export function T({ variant = 'body', color, center, style, ...rest }: TProps) {
  const { type } = useTheme();
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
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

function buttonVariant(c: Palette, v: ButtonVariant): { box: ViewStyle; text: TextStyle & { color: string } } {
  switch (v) {
    case 'primary':
      return { box: { backgroundColor: c.bordeaux }, text: { color: c.onDark } };
    case 'secondary':
      return { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.ink }, text: { color: c.ink } };
    case 'ghost':
      return { box: { backgroundColor: 'transparent' }, text: { color: c.bordeaux } };
    case 'danger':
      return { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.danger }, text: { color: c.danger } };
    case 'light':
      return { box: { backgroundColor: '#FFFFFF' }, text: { color: c.brand } };
    case 'outlineLight':
      return { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.onDark }, text: { color: c.onDark } };
  }
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const v = buttonVariant(colors, variant);
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

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  badge?: number;
}

export function IconButton({ icon, label, onPress, color, size = 24, badge }: IconButtonProps) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={hitSlop} onPress={onPress} style={styles.iconButton}>
      <Ionicons name={icon} size={size} color={color ?? colors.ink} />
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
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
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <View style={styles.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.graphite}
        multiline={multiline}
        style={[s.input, multiline && styles.inputMultiline, error ? s.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={s.fieldError}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={s.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------- чипы ----------

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Цветная точка слева (фильтр по цвету). */
  swatch?: string;
}

export function Chip({ label, selected, onPress, swatch }: ChipProps) {
  const s = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={[s.chip, selected && s.chipSelected]}>
      {swatch ? <View style={[s.swatch, { backgroundColor: swatch }]} /> : null}
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/** Переключатель «да/нет» в виде строки с подписью. */
export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const s = useStyles();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={s.toggleRow}>
      <View style={styles.flex}>
        <T variant="bodyStrong">{label}</T>
        {hint ? <T variant="small">{hint}</T> : null}
      </View>
      <View style={[s.track, value && s.trackOn]}>
        <View style={[s.thumb, value && s.thumbOn]} />
      </View>
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
  const s = useStyles();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[s.avatarFallback, box]}>
      <Text style={[s.avatarText, { fontSize: size * 0.38 }]}>{initials(name) || 'A'}</Text>
    </View>
  );
}

/** Отметка премиум-художника: золотой мазок, без слова «PRO». */
export function PremiumMark() {
  const t = useT();
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('Премиум-художник')} style={s.premium}>
      <Ionicons name="brush" size={11} color={colors.brand} />
    </View>
  );
}

// ---------- состояния экрана ----------

export function Loading() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.state} accessibilityLabel={t('Загрузка')}>
      <ActivityIndicator color={colors.bordeaux} />
    </View>
  );
}

interface MessageStateProps {
  title: string;
  text?: string;
  action?: ReactNode;
  icon?: IconName;
}

export function EmptyState({ title, text, action, icon = 'images-outline' }: MessageStateProps) {
  const { colors } = useTheme();
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
  const t = useT();
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={t('Не удалось загрузить')}
      text={text}
      action={onRetry ? <Button title={t('Повторить')} variant="secondary" onPress={onRetry} /> : null}
    />
  );
}

export function Divider() {
  const s = useStyles();
  return <View style={s.divider} />;
}

/** Карточка-предупреждение (ошибка формы, подсказка). */
export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'danger' | 'success' }) {
  const { colors, type } = useTheme();
  const bg = tone === 'danger' ? colors.dangerSoft : tone === 'success' ? colors.successSoft : colors.goldSoft;
  const fg = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.ink;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[type.small, { color: fg }]}>{text}</Text>
    </View>
  );
}

/** Строка «подпись — значение» (суммы в заказе). */
export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <T variant={strong ? 'heading' : 'body'} style={styles.flex}>
        {label}
      </T>
      <T variant={strong ? 'heading' : 'body'}>{value}</T>
    </View>
  );
}

/** Заголовок раздела с необязательной ссылкой «Все». */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <T variant="title" style={styles.flex}>
        {title}
      </T>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={hitSlop}>
          <T variant="smallStrong" color={colors.bordeaux}>
            {action}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

// стили, не зависящие от темы
const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  button: { minHeight: 50, borderRadius: radius.control, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center' },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { fontFamily: fonts.sansSemi, fontSize: 16 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  iconButton: { padding: space.xs, minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm, minHeight: 280 },
  stateTitle: { marginTop: space.sm },
  stateAction: { marginTop: space.lg, alignSelf: 'stretch' },
  notice: { padding: space.md, borderRadius: radius.control },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});

// стили, зависящие от темы
const useStyles = makeStyles((c, t) => ({
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 10, color: '#4A2025' },
  fieldLabel: { ...t.smallStrong },
  input: {
    ...t.body,
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: c.paper,
  },
  inputError: { borderColor: c.danger },
  fieldError: { ...t.small, color: c.danger },
  fieldHint: { ...t.small },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.paper,
  },
  chipSelected: { backgroundColor: c.bordeaux, borderColor: c.bordeaux },
  chipText: { fontFamily: fonts.sansMedium, fontSize: 14, color: c.ink },
  chipTextSelected: { color: c.onDark },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: c.hairline, padding: 3 },
  trackOn: { backgroundColor: c.bordeaux },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' },
  thumbOn: { transform: [{ translateX: 18 }] },
  avatarFallback: { backgroundColor: c.bordeauxSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.serif, color: c.bordeaux },
  premium: { width: 18, height: 18, borderRadius: 9, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.hairline },
}));

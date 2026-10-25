// Общие элементы админки: экран с заголовком, поиск, плитки, строки списка, метки статусов,
// мини-график и действие с подтверждением и причиной.
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { errorText } from '@/api/client';
import { Avatar, Button, Chip, Field, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export function AdminScreen({ title, subtitle, actions, children, scroll = true }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; scroll?: boolean }) {
  const styles = useStyles();
  const head = (
    <View style={styles.head}>
      <View style={styles.flex}>
        <T variant="title">{title}</T>
        {subtitle ? <T variant="small">{subtitle}</T> : null}
      </View>
      {actions}
    </View>
  );
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title }} />
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex]}>
          {head}
          {children}
        </View>
      )}
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.graphite}
      autoCapitalize="none"
      autoCorrect={false}
      style={styles.search}
      accessibilityLabel={placeholder}
    />
  );
}

export interface ChipOption {
  value: string;
  label: string;
}

export function ChipFilter({ options, value, onChange }: { options: ChipOption[]; value: string; onChange: (v: string) => void }) {
  const styles = useStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((o) => (
        <Chip key={o.value || 'all'} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent';

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const styles = useStyles();
  const colors = useColors();
  const bg = { neutral: colors.plaster, good: colors.successSoft, bad: colors.dangerSoft, warn: colors.goldSoft, accent: colors.bordeauxSoft }[tone];
  const fg = { neutral: colors.graphite, good: colors.success, bad: colors.danger, warn: colors.ink, accent: colors.bordeaux }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <T variant="smallStrong" color={fg} style={styles.badgeText}>
        {text}
      </T>
    </View>
  );
}

export function StatTile({ label, value, sub, onPress, tone }: { label: string; value: string; sub?: string; onPress?: () => void; tone?: Tone }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <T variant="small">{label}</T>
      <T variant="priceLarge" color={tone === 'bad' ? colors.danger : tone === 'accent' ? colors.bordeaux : colors.ink}>
        {value}
      </T>
      {sub ? <T variant="small">{sub}</T> : null}
    </Pressable>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.grid}>{children}</View>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T variant="heading" style={styles.flex}>
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  );
}

export function AdminRow({
  image,
  avatar,
  title,
  subtitle,
  meta,
  badges,
  right,
  onPress,
}: {
  image?: string;
  avatar?: { uri: string; name: string };
  title: string;
  subtitle?: string;
  meta?: string;
  badges?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {avatar ? <Avatar uri={avatar.uri} name={avatar.name} size={40} /> : image !== undefined ? image ? <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} /> : null}
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          <T variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {title}
          </T>
          {badges}
        </View>
        {subtitle ? (
          <T variant="small" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
        {meta ? (
          <T variant="small" numberOfLines={1}>
            {meta}
          </T>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function LoadMore({ visible, loading, onPress, shown, total }: { visible: boolean; loading: boolean; onPress: () => void; shown: number; total: number }) {
  const styles = useStyles();
  return (
    <View style={styles.more}>
      <T variant="small">{`Показано ${shown} из ${total}`}</T>
      {visible ? <Button title="Показать ещё" variant="ghost" loading={loading} onPress={onPress} /> : null}
    </View>
  );
}

/** Столбики по дням (последние 30 дней). */
export function MiniBars({ values, labels, format }: { values: number[]; labels: string[]; format: (n: number) => string }) {
  const styles = useStyles();
  const colors = useColors();
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.chartBox} accessible accessibilityLabel={`Всего ${format(total)}`}>
      <View style={styles.chart}>
        {values.map((v, i) => (
          <View key={labels[i] ?? i} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${Math.max(2, (v / max) * 100)}%`, backgroundColor: v ? colors.bordeaux : colors.hairline }]} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <T variant="small">{labels[0]?.slice(5) ?? ''}</T>
        <T variant="smallStrong">{`за 30 дней: ${format(total)}, макс. ${format(max)}`}</T>
        <T variant="small">{labels.at(-1)?.slice(5) ?? ''}</T>
      </View>
    </View>
  );
}

/**
 * Действие с подтверждением: кнопка раскрывает форму с причиной (если нужна) и кнопкой «Подтвердить».
 * Без системных диалогов — одинаково работает в браузере и в приложении.
 */
export function ConfirmAction({
  title,
  confirmTitle,
  description,
  reasonLabel,
  variant = 'secondary',
  onConfirm,
}: {
  title: string;
  confirmTitle?: string;
  description?: string;
  reasonLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <Button title={title} variant={variant} onPress={() => setOpen(true)} />;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.confirm}>
      <T variant="bodyStrong">{title}</T>
      {description ? <T variant="small">{description}</T> : null}
      {reasonLabel ? <Field label={reasonLabel} value={reason} onChangeText={setReason} maxLength={300} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      <View style={styles.confirmButtons}>
        <Button title="Отмена" variant="ghost" onPress={() => setOpen(false)} style={styles.flex} />
        <Button title={confirmTitle ?? 'Подтвердить'} variant={variant === 'danger' ? 'danger' : 'primary'} loading={busy} onPress={submit} style={styles.flex} />
      </View>
    </View>
  );
}

export function Line2({ label, value }: { label: string; value: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <T variant="small" style={styles.lineLabel}>
        {label}
      </T>
      {typeof value === 'string' ? (
        <T variant="body" style={styles.flex} selectable>
          {value}
        </T>
      ) : (
        <View style={styles.flex}>{value}</View>
      )}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <T variant="small" style={{ paddingVertical: space.lg }}>
      {text}
    </T>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: 1180, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  search: { ...t.body, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper },
  chips: { gap: space.sm },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { flexGrow: 1, flexBasis: 200, gap: 2, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  pressed: { opacity: 0.8 },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: c.hairline },
  thumb: { width: 48, height: 48, borderRadius: radius.art, backgroundColor: c.plaster },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  more: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  chartBox: { gap: space.xs },
  chart: { height: 96, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper },
  confirmButtons: { flexDirection: 'row', gap: space.sm },
  line: { flexDirection: 'row', gap: space.md, paddingVertical: 4 },
  lineLabel: { width: 150 },
}));

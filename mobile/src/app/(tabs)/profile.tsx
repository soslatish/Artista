import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import type { AuthResponse } from '@/api/types';
import { useSession } from '@/auth/session';
import { formatDate } from '@/lib/format';
import { Avatar, Button, Notice, PremiumMark, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut, applyAuth } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <View style={[styles.guest, { paddingTop: insets.top + space.xxl }]}>
        <T variant="display">Профиль</T>
        <T variant="body" color={colors.graphite}>
          Войдите, чтобы покупать работы, переписываться с художниками и продавать свои.
        </T>
        <View style={styles.guestActions}>
          <Button title="Войти" onPress={() => router.push('/login')} />
          <Button title="Создать аккаунт" variant="secondary" onPress={() => router.push('/register')} />
        </View>
      </View>
    );
  }

  const isArtist = user.role === 'artist';
  const becomeArtist = async () => {
    setBusy(true);
    setError('');
    try {
      await applyAuth(await post<AuthResponse>('/me/become-artist'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.lg }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть мой публичный профиль" onPress={() => router.push({ pathname: '/artist/[id]', params: { id: user.id } })} style={styles.head}>
        <Avatar uri={user.avatar_url} name={user.name} size={72} />
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <T variant="title" numberOfLines={2} style={styles.flexShrink}>
              {user.name}
            </T>
            {user.is_premium ? <PremiumMark /> : null}
          </View>
          <T variant="small">{isArtist ? 'Художник' : 'Покупатель'}{user.city ? `, ${user.city}` : ''}</T>
        </View>
      </Pressable>

      {isArtist ? (
        <Group title="Мастерская">
          <Item icon="add-circle-outline" label="Добавить работу" href="/artwork/new" />
          <Item icon="images-outline" label="Мои работы" href="/my-artworks" />
          <Item icon="cash-outline" label="Продажи" href={{ pathname: '/orders', params: { role: 'artist' } }} />
          <Item icon="stats-chart-outline" label="Статистика" href="/stats" />
          <Item
            icon="brush-outline"
            label={user.is_premium && user.premium_until ? `Премиум до ${formatDate(user.premium_until)}` : 'Премиум — 0% комиссии'}
            href="/premium"
          />
        </Group>
      ) : (
        <View style={styles.becomeArtist}>
          <T variant="heading">Продаёте свои работы?</T>
          <T variant="small">Откройте мастерскую: размещение бесплатно, комиссия только с продажи — 15%.</T>
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title="Стать художником" variant="secondary" loading={busy} onPress={becomeArtist} />
        </View>
      )}

      <Group title="Покупки">
        <Item icon="bag-handle-outline" label="Мои заказы" href={{ pathname: '/orders', params: { role: 'buyer' } }} />
        <Item icon="heart-outline" label="Избранное" href="/favorites" />
        <Item icon="notifications-outline" label="Уведомления" href="/notifications" />
      </Group>

      <Group title="Аккаунт">
        <Item icon="person-outline" label="Редактировать профиль" href="/settings/profile" />
        <Item icon="log-out-outline" label="Выйти" onPress={() => void signOut()} />
        <Item icon="trash-outline" label="Удалить аккаунт" href="/settings/delete" danger />
      </Group>
      <T variant="small" center>
        {user.email}
      </T>
    </ScrollView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <T variant="heading" style={styles.groupTitle}>
        {title}
      </T>
      <View style={styles.groupBox}>{children}</View>
    </View>
  );
}

interface ItemProps {
  icon: IconName;
  label: string;
  href?: Href;
  onPress?: () => void;
  danger?: boolean;
}

function Item({ icon, label, href, onPress, danger }: ItemProps) {
  const color = danger ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => href && router.push(href))}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.bordeaux} />
      <T variant="body" color={color} style={styles.flex}>
        {label}
      </T>
      <Ionicons name="chevron-forward" size={18} color={colors.hairline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 120 },
  guest: { flex: 1, backgroundColor: colors.wall, padding: space.xl, gap: space.lg },
  guestActions: { gap: space.md, marginTop: space.lg },
  head: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  headText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flexShrink: { flexShrink: 1 },
  becomeArtist: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: colors.goldSoft },
  group: { gap: space.sm },
  groupTitle: { paddingHorizontal: space.xs },
  groupBox: { backgroundColor: colors.paper, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
  itemPressed: { backgroundColor: colors.plaster },
  flex: { flex: 1 },
});

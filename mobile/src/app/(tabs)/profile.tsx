import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { useSafeDeals } from '@/api/hooks';
import type { AuthResponse } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { usePlatformTerms } from '@/lib/terms';
import { formatDate } from '@/lib/format';
import { Avatar, Button, type IconName, Notice, PremiumMark, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const terms = usePlatformTerms();
  const safeDeals = useSafeDeals();
  const t = useT();
  const styles = useStyles();
  const { user, signOut, applyAuth } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.guest, { paddingTop: insets.top + space.xxl }]}>
        <T variant="display">{t('Профиль')}</T>
        <T variant="body">{t('Войдите, чтобы покупать работы, переписываться с художниками и продавать свои.')}</T>
        <View style={styles.guestActions}>
          <Button title={t('Войти')} onPress={() => router.push('/login')} />
          <Button title={t('Создать аккаунт')} variant="secondary" onPress={() => router.push('/register')} />
        </View>
        <Group title={t('Приложение')}>
          <Item icon="color-palette-outline" label={t('Оформление и язык')} href="/settings/app" />
          <Item icon="easel-outline" label={t('Выставки')} href="/exhibitions" />
        </Group>
      </ScrollView>
    );
  }

  const isArtist = user.role === 'artist';
  const onVacation = !!user.vacation_until;
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Открыть мой публичный профиль')}
        onPress={() => router.push({ pathname: '/artist/[id]', params: { id: user.id } })}
        style={styles.head}>
        <Avatar uri={user.avatar_url} name={user.name} size={72} />
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <T variant="title" numberOfLines={2} style={styles.flexShrink}>
              {user.name}
            </T>
            {user.is_premium ? <PremiumMark /> : null}
          </View>
          <T variant="small">
            {isArtist ? t('Художник') : t('Покупатель')}
            {user.city ? `, ${user.city}` : ''}
          </T>
        </View>
      </Pressable>

      {isArtist && onVacation ? <Notice text={t('Магазин на паузе до {date}. Покупатели видят работы, но купить их не могут.', { date: formatDate(user.vacation_until!) })} /> : null}

      {user.role === 'admin' ? (
        <Group title={t('Администрирование')}>
          <Item icon="shield-checkmark-outline" label={t('Админка')} href="/admin" />
        </Group>
      ) : null}

      {isArtist ? (
        <Group title={t('Мастерская')}>
          <Item icon="add-circle-outline" label={t('Добавить работу')} href="/artwork/new" />
          <Item icon="images-outline" label={t('Мои работы')} href="/my-artworks" />
          <Item icon="cash-outline" label={t('Продажи')} href={{ pathname: '/orders', params: { role: 'artist' } }} />
          <Item icon="pricetags-outline" label={t('Предложения цены')} href={{ pathname: '/offers', params: { role: 'artist' } }} />
          <Item icon="color-wand-outline" label={t('Заказы на заказ')} href={{ pathname: '/commissions', params: { role: 'artist' } }} />
          <Item icon="create-outline" label={t('Новый пост')} href="/posts/new" />
          <Item icon="albums-outline" label={t('Серии работ')} href="/series" />
          <Item icon="easel-outline" label={t('Выставки')} href={{ pathname: '/exhibitions', params: { mine: '1' } }} />
          <Item icon="stats-chart-outline" label={t('Статистика')} href="/stats" />
          <Item
            icon="brush-outline"
            label={user.is_premium && user.premium_until ? t('Премиум до {date}', { date: formatDate(user.premium_until) }) : (safeDeals ? t('Премиум — 0% комиссии') : t('Премиум — продвижение в ленте'))}
            href="/premium"
          />
          <Item icon="settings-outline" label={t('Пауза и приём заказов')} href="/settings/workshop" />
        </Group>
      ) : user.role === 'admin' ? null : (
        <View style={styles.becomeArtist}>
          <T variant="heading">{t('Продаёте свои работы?')}</T>
          <T variant="small">{safeDeals ? t('Откройте мастерскую: размещение бесплатно, комиссия только с продажи — {pct}.', { pct: terms.pct }) : t('Откройте мастерскую: размещение бесплатно, без комиссии с продаж — покупатели пишут вам напрямую.')}</T>
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title={t('Стать художником')} variant="secondary" loading={busy} onPress={becomeArtist} />
        </View>
      )}

      <Group title={t('Покупки')}>
        <Item icon="bag-handle-outline" label={t('Мои заказы')} href={{ pathname: '/orders', params: { role: 'buyer' } }} />
        <Item icon="pricetag-outline" label={t('Мои предложения цены')} href={{ pathname: '/offers', params: { role: 'buyer' } }} />
        <Item icon="color-wand-outline" label={t('Работы на заказ')} href={{ pathname: '/commissions', params: { role: 'buyer' } }} />
        <Item icon="ribbon-outline" label={t('Сертификаты подлинности')} href="/certificates" />
        <Item icon="heart-outline" label={t('Избранное')} href="/favorites" />
        <Item icon="time-outline" label={t('Вы смотрели')} href="/history" />
        <Item icon="bookmark-outline" label={t('Сохранённые поиски')} href="/saved-searches" />
        <Item icon="notifications-outline" label={t('Уведомления')} href="/notifications" />
      </Group>

      <Group title={t('Аккаунт')}>
        <Item icon="person-outline" label={t('Редактировать профиль')} href="/settings/profile" />
        <Item icon="color-palette-outline" label={t('Оформление и язык')} href="/settings/app" />
        <Item icon="log-out-outline" label={t('Выйти')} onPress={() => void signOut()} />
        <Item icon="trash-outline" label={t('Удалить аккаунт')} href="/settings/delete" danger />
      </Group>
      <T variant="small" center>
        {user.email}
      </T>
    </ScrollView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
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
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => href && router.push(href))}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.bordeaux} />
      <T variant="body" color={danger ? colors.danger : colors.ink} style={styles.flex}>
        {label}
      </T>
      <Ionicons name="chevron-forward" size={18} color={colors.hairline} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 120 },
  guest: { padding: space.xl, gap: space.lg, paddingBottom: 120 },
  guestActions: { gap: space.md, marginTop: space.lg, marginBottom: space.lg },
  head: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  headText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flexShrink: { flexShrink: 1 },
  becomeArtist: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  group: { gap: space.sm },
  groupTitle: { paddingHorizontal: space.xs },
  groupBox: { backgroundColor: c.paper, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
  itemPressed: { backgroundColor: c.plaster },
  flex: { flex: 1 },
}));

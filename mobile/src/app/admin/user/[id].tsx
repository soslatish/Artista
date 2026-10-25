import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { adminKeys, type AdminUserDetail, useAdminUser } from '@/api/admin';
import { errorText, patch } from '@/api/client';
import { useSession } from '@/auth/session';
import { actionLabels, artworkStatus, label, orderStatus, roleLabels, summarize } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ConfirmAction, Empty, Line2, Section } from '@/features/admin/ui';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Avatar, Button, Chip, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function AdminUserRoute() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <AdminUserScreen id={id} />;
}

function AdminUserScreen({ id }: { id: string }) {
  const q = useAdminUser(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <UserView u={q.data} />;
}

function UserView({ u }: { u: AdminUserDetail }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const { user: me } = useSession();
  const [error, setError] = useState('');
  const [name, setName] = useState(u.name);
  const [city, setCity] = useState(u.city);
  const self = me?.id === u.id;
  const premium = u.premium_until && new Date(u.premium_until) > new Date();

  const save = async (body: object) => {
    setError('');
    try {
      const next = await patch<AdminUserDetail>(`/admin/users/${u.id}`, body);
      qc.setQueryData(adminKeys.user(u.id), next);
      qc.invalidateQueries({ queryKey: ['admin', 'list'] });
      qc.invalidateQueries({ queryKey: adminKeys.dashboard });
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  };

  return (
    <AdminScreen title={u.name} subtitle={u.email}>
      <View style={styles.head}>
        <Avatar uri={u.avatar_url} name={u.name} size={64} />
        <View style={styles.badges}>
          <Badge text={roleLabels[u.role] ?? u.role} tone={u.role === 'admin' ? 'accent' : 'neutral'} />
          {premium ? <Badge text={`Премиум до ${formatDate(u.premium_until!)}`} tone="warn" /> : null}
          {u.banned_at ? <Badge text={`Заблокирован ${formatDate(u.banned_at)}`} tone="bad" /> : null}
          {u.deleted_at ? <Badge text="Аккаунт удалён" tone="bad" /> : null}
          {u.on_vacation ? <Badge text="Магазин на паузе" /> : null}
        </View>
      </View>
      {error ? <Notice tone="danger" text={error} /> : null}

      <Section title="Данные">
        <Line2 label="ID" value={u.id} />
        <Line2 label="Регистрация" value={formatDateTime(u.created_at)} />
        <Line2 label="Язык" value={u.locale === 'en' ? 'English' : 'Русский'} />
        <Line2 label="Подписчики" value={String(u.followers)} />
        <Line2 label="Работ" value={String(u.artworks)} />
        <Line2 label="Продажи" value={`${u.sales} на ${formatPrice(u.sales_kop)}`} />
        <Line2 label="Покупки" value={`${u.purchases} на ${formatPrice(u.spent_kop)}`} />
        <Line2 label="Жалобы на него" value={String(u.reports)} />
        {u.bio ? <Line2 label="О себе" value={u.bio} /> : null}
        <Button title="Открыть публичный профиль" variant="ghost" onPress={() => router.push({ pathname: '/artist/[id]', params: { id: u.id } })} />
      </Section>

      <Section title="Управление">
        {self ? <T variant="small">Это ваш аккаунт: роль и блокировку меняет другой администратор.</T> : null}
        {!self ? (
          <>
            <T variant="smallStrong">Роль</T>
            <View style={styles.badges}>
              {(['buyer', 'artist', 'admin'] as const).map((r) => (
                <Chip key={r} label={roleLabels[r]} selected={u.role === r} onPress={() => (u.role === r ? undefined : void save({ role: r }).catch(() => undefined))} />
              ))}
            </View>
            {u.banned_at ? (
              <ConfirmAction title="Разблокировать" description="Пользователь снова сможет войти. Скрытые при блокировке работы вернуть можно в разделе «Работы»." onConfirm={(reason) => save({ banned: false, reason })} reasonLabel="Комментарий" />
            ) : (
              <ConfirmAction
                title="Заблокировать"
                variant="danger"
                description="Вход закрыт сразу, работы скрываются, аукционы и предложения по ним отменяются."
                reasonLabel="Причина (попадёт в журнал)"
                onConfirm={(reason) => save({ banned: true, reason })}
              />
            )}
          </>
        ) : null}
        <T variant="smallStrong">Премиум</T>
        <View style={styles.badges}>
          <Button title="+30 дней" variant="secondary" onPress={() => void save({ premium_days: 30 }).catch(() => undefined)} />
          <Button title="+1 год" variant="secondary" onPress={() => void save({ premium_days: 365 }).catch(() => undefined)} />
          {premium ? <Button title="Снять Премиум" variant="ghost" onPress={() => void save({ premium_days: 0 }).catch(() => undefined)} /> : null}
        </View>
        <T variant="smallStrong">Профиль</T>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="Имя" value={name} onChangeText={setName} maxLength={80} />
          </View>
          <View style={styles.flex}>
            <Field label="Город" value={city} onChangeText={setCity} maxLength={80} />
          </View>
        </View>
        <Button title="Сохранить имя и город" variant="secondary" disabled={name === u.name && city === u.city} onPress={() => void save({ name, city }).catch(() => undefined)} />
      </Section>

      <Section title="Последние заказы" right={<Button title="Все" variant="ghost" onPress={() => router.push({ pathname: '/admin/orders', params: { user_id: u.id } })} />}>
        {u.recent_orders.length ? null : <Empty text="Заказов нет." />}
        {u.recent_orders.map((o) => {
          const [text, tone] = label(orderStatus, o.status);
          return (
            <AdminRow
              key={o.id}
              image={o.image_url}
              title={o.artwork_title}
              subtitle={`${o.buyer_id === u.id ? 'Купил у' : 'Продал'} ${o.buyer_id === u.id ? o.artist_name : o.buyer_name}`}
              meta={`${formatDate(o.created_at)}, ${formatPrice(o.total_kop)}`}
              badges={<Badge text={text} tone={tone} />}
              onPress={() => router.push({ pathname: '/admin/order/[id]', params: { id: o.id } })}
            />
          );
        })}
      </Section>

      {u.recent_artworks.length ? (
        <Section title="Работы" right={<Button title="Все" variant="ghost" onPress={() => router.push({ pathname: '/admin/artworks', params: { artist_id: u.id } })} />}>
          {u.recent_artworks.map((a) => {
            const [text, tone] = label(artworkStatus, a.status);
            return <AdminRow key={a.id} image={a.image_url} title={a.title} meta={formatPrice(a.price_kop)} badges={<Badge text={text} tone={tone} />} onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: a.id } })} />;
          })}
        </Section>
      ) : null}

      <Section title="Действия администраторов">
        {u.admin_actions.length ? null : <Empty text="Пока ничего не меняли." />}
        {u.admin_actions.map((a) => (
          <AdminRow key={a.id} title={actionLabels[a.action] ?? a.action} subtitle={summarize(a.details)} meta={`${a.admin_name || 'Система'}, ${formatDateTime(a.created_at)}`} />
        ))}
      </Section>
    </AdminScreen>
  );
}

const useStyles = makeStyles(() => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, flex: 1 },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));

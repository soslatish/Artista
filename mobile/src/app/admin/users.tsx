import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { adminTotal, flattenAdmin, type AdminUser, useAdminList } from '@/api/admin';
import { errorText } from '@/api/client';
import { roleLabels } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ChipFilter, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { param, useDebounced } from '@/features/admin/use-debounced';
import { formatDate, formatPrice } from '@/lib/format';
import { Loading, Notice } from '@/ui/primitives';

const roles = [
  { value: '', label: 'Все роли' },
  { value: 'buyer', label: 'Покупатели' },
  { value: 'artist', label: 'Художники' },
  { value: 'admin', label: 'Администраторы' },
];
const statuses = [
  { value: '', label: 'Любой статус' },
  { value: 'active', label: 'Активные' },
  { value: 'premium', label: 'Премиум' },
  { value: 'banned', label: 'Заблокированы' },
  { value: 'deleted', label: 'Удалены' },
];

export default function AdminUsers() {
  const params = useLocalSearchParams();
  const [text, setText] = useState('');
  const [role, setRole] = useState(param(params.role));
  const [status, setStatus] = useState(param(params.status));
  const q = useDebounced(text.trim());
  const list = useAdminList<AdminUser>('users', { q: q || undefined, role: role || undefined, status: status || undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Пользователи" subtitle={list.data ? `Найдено: ${adminTotal(list.data)}` : undefined}>
      <SearchBar value={text} onChange={setText} placeholder="E-mail, имя или id" />
      <ChipFilter options={roles} value={role} onChange={setRole} />
      <ChipFilter options={statuses} value={status} onChange={setStatus} />
      {list.isLoading ? <Loading /> : null}
      {list.isError && !list.data ? <Notice tone="danger" text={errorText(list.error)} /> : null}
      {items.map((u) => (
        <AdminRow
          key={u.id}
          avatar={{ uri: u.avatar_url, name: u.name }}
          title={u.name}
          subtitle={`${u.email}${u.city ? `, ${u.city}` : ''}`}
          meta={`С ${formatDate(u.created_at)}. Работ: ${u.artworks}, продаж: ${u.sales} на ${formatPrice(u.sales_kop)}, покупок: ${u.purchases}`}
          badges={
            <>
              <Badge text={roleLabels[u.role] ?? u.role} tone={u.role === 'admin' ? 'accent' : 'neutral'} />
              {u.premium_until && new Date(u.premium_until) > new Date() ? <Badge text="Премиум" tone="warn" /> : null}
              {u.banned_at ? <Badge text="Заблокирован" tone="bad" /> : null}
              {u.deleted_at ? <Badge text="Удалён" tone="bad" /> : null}
              {u.reports ? <Badge text={`Жалоб: ${u.reports}`} tone="bad" /> : null}
            </>
          }
          onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: u.id } })}
        />
      ))}
      {!list.isLoading && !items.length ? <Empty text="Никого не нашлось." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

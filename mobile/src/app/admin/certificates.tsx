import { router } from 'expo-router';
import { useState } from 'react';

import { adminTotal, type AdminCertificate, flattenAdmin, useAdminList } from '@/api/admin';
import { AdminRow, AdminScreen, Badge, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { useDebounced } from '@/features/admin/use-debounced';
import { formatDate } from '@/lib/format';
import { Loading } from '@/ui/primitives';

export default function AdminCertificates() {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = useAdminList<AdminCertificate>('certificates', { q: q || undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Сертификаты" subtitle={list.data ? `Выдано: ${adminTotal(list.data)}` : undefined}>
      <SearchBar value={text} onChange={setText} placeholder="Код, работа или владелец" />
      {list.isLoading ? <Loading /> : null}
      {items.map((c) => (
        <AdminRow
          key={c.code}
          title={`${c.code}: ${c.title}`}
          subtitle={`${c.artist_name}, владелец ${c.owner_name}`}
          meta={`Выдан ${formatDate(c.issued_at)}`}
          badges={<Badge text={c.status === 'active' ? 'Действует' : 'Передан'} tone={c.status === 'active' ? 'good' : 'neutral'} />}
          onPress={() => router.push({ pathname: '/certificate/[code]', params: { code: c.code } })}
        />
      ))}
      {!list.isLoading && !items.length ? <Empty text="Сертификатов нет." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

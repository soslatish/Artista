import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { adminTotal, type AdminOrder, flattenAdmin, useAdminList } from '@/api/admin';
import { errorText } from '@/api/client';
import { label, orderKind, orderStatus } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ChipFilter, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { param, useDebounced } from '@/features/admin/use-debounced';
import { formatDate, formatPrice } from '@/lib/format';
import { Loading, Notice } from '@/ui/primitives';

const statuses = [{ value: '', label: 'Все' }, ...Object.entries(orderStatus).map(([value, [text]]) => ({ value, label: text }))];
const kinds = [{ value: '', label: 'Любой тип' }, ...Object.entries(orderKind).map(([value, text]) => ({ value, label: text }))];

export default function AdminOrders() {
  const params = useLocalSearchParams();
  const [text, setText] = useState('');
  const [status, setStatus] = useState(param(params.status));
  const [kind, setKind] = useState('');
  const q = useDebounced(text.trim());
  const userId = param(params.user_id);
  const list = useAdminList<AdminOrder>('orders', { q: q || undefined, status: status || undefined, kind: kind || undefined, user_id: userId || undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Заказы" subtitle={list.data ? `Найдено: ${adminTotal(list.data)}${userId ? ' у выбранного пользователя' : ''}` : undefined}>
      <SearchBar value={text} onChange={setText} placeholder="Работа, покупатель, художник, e-mail или id заказа" />
      <ChipFilter options={statuses} value={status} onChange={setStatus} />
      <ChipFilter options={kinds} value={kind} onChange={setKind} />
      {list.isLoading ? <Loading /> : null}
      {list.isError && !list.data ? <Notice tone="danger" text={errorText(list.error)} /> : null}
      {items.map((o) => {
        const [text2, tone] = label(orderStatus, o.status);
        return (
          <AdminRow
            key={o.id}
            image={o.image_url}
            title={o.artwork_title}
            subtitle={`${o.buyer_name} купил у ${o.artist_name}`}
            meta={`${formatDate(o.created_at)}, ${formatPrice(o.total_kop)}, комиссия ${formatPrice(o.commission_kop)}`}
            badges={
              <>
                <Badge text={text2} tone={tone} />
                {o.kind !== 'artwork' ? <Badge text={orderKind[o.kind] ?? o.kind} /> : null}
              </>
            }
            onPress={() => router.push({ pathname: '/admin/order/[id]', params: { id: o.id } })}
          />
        );
      })}
      {!list.isLoading && !items.length ? <Empty text="Заказов не найдено." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { adminTotal, type AdminPayment, flattenAdmin, useAdminList } from '@/api/admin';
import { errorText } from '@/api/client';
import { label, paymentPurpose, paymentStatus } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ChipFilter, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { param, useDebounced } from '@/features/admin/use-debounced';
import { formatDateTime, formatPrice } from '@/lib/format';
import { Loading, Notice } from '@/ui/primitives';

const statuses = [{ value: '', label: 'Все' }, ...Object.entries(paymentStatus).map(([value, [text]]) => ({ value, label: text }))];
const purposes = [{ value: '', label: 'Любое назначение' }, ...Object.entries(paymentPurpose).map(([value, text]) => ({ value, label: text }))];

export default function AdminPayments() {
  const params = useLocalSearchParams();
  const [text, setText] = useState('');
  const [status, setStatus] = useState(param(params.status));
  const [purpose, setPurpose] = useState(param(params.purpose));
  const q = useDebounced(text.trim());
  const list = useAdminList<AdminPayment>('payments', { q: q || undefined, status: status || undefined, purpose: purpose || undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Платежи" subtitle={list.data ? `Найдено: ${adminTotal(list.data)}` : undefined}>
      <SearchBar value={text} onChange={setText} placeholder="Плательщик, e-mail, id платежа или заказа" />
      <ChipFilter options={statuses} value={status} onChange={setStatus} />
      <ChipFilter options={purposes} value={purpose} onChange={setPurpose} />
      {list.isLoading ? <Loading /> : null}
      {list.isError && !list.data ? <Notice tone="danger" text={errorText(list.error)} /> : null}
      {items.map((p) => {
        const [text2, tone] = label(paymentStatus, p.status);
        return (
          <AdminRow
            key={p.id}
            title={`${formatPrice(p.amount_kop)}, ${paymentPurpose[p.purpose] ?? p.purpose}`}
            subtitle={`${p.user_name}, ${p.provider}${p.external_id ? `, ${p.external_id}` : ''}`}
            meta={formatDateTime(p.created_at)}
            badges={<Badge text={text2} tone={tone} />}
            onPress={() => (p.order_id ? router.push({ pathname: '/admin/order/[id]', params: { id: p.order_id } }) : router.push({ pathname: '/admin/user/[id]', params: { id: p.user_id } }))}
          />
        );
      })}
      {!list.isLoading && !items.length ? <Empty text="Платежей не найдено." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { adminTotal, type AdminDeal, flattenAdmin, useAdminList } from '@/api/admin';
import { errorText, post } from '@/api/client';
import { dealStatus, label } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ChipFilter, ConfirmAction, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { param, useDebounced } from '@/features/admin/use-debounced';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';
import { Loading, Notice } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

type Tab = 'auctions' | 'offers' | 'commissions' | 'exhibitions';

const tabs = [
  { value: 'auctions', label: 'Аукционы' },
  { value: 'offers', label: 'Предложения цены' },
  { value: 'commissions', label: 'Заказы на создание' },
  { value: 'exhibitions', label: 'Выставки' },
];

const statusByTab: Record<Tab, string[]> = {
  auctions: ['live', 'ended', 'cancelled'],
  offers: ['pending', 'countered', 'accepted', 'used', 'declined', 'withdrawn', 'expired'],
  commissions: ['requested', 'quoted', 'accepted', 'declined', 'cancelled', 'expired'],
  exhibitions: ['upcoming', 'open', 'cancelled'],
};

const cancellable: Record<Tab, string[]> = {
  auctions: ['live'],
  offers: ['pending', 'countered', 'accepted'],
  commissions: ['requested', 'quoted'],
  exhibitions: ['upcoming'],
};

export default function AdminDeals() {
  const params = useLocalSearchParams();
  const initial = param(params.tab, 'auctions') as Tab;
  const [tab, setTab] = useState<Tab>(statusByTab[initial] ? initial : 'auctions');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = useAdminList<AdminDeal>(`deals/${tab}`, { status: status || undefined, q: q || undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Сделки" subtitle={list.data ? `Найдено: ${adminTotal(list.data)}` : undefined}>
      <ChipFilter options={tabs} value={tab} onChange={(v) => (setTab(v as Tab), setStatus(''))} />
      <ChipFilter options={[{ value: '', label: 'Любой статус' }, ...statusByTab[tab].map((s) => ({ value: s, label: dealStatus[s]?.[0] ?? s }))]} value={status} onChange={setStatus} />
      <SearchBar value={text} onChange={setText} placeholder="Название, художник или покупатель" />
      {list.isLoading ? <Loading /> : null}
      {list.isError && !list.data ? <Notice tone="danger" text={errorText(list.error)} /> : null}
      {items.map((d) => (
        <DealRow key={d.id} d={d} tab={tab} />
      ))}
      {!list.isLoading && !items.length ? <Empty text="Ничего не найдено." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

function describe(d: AdminDeal): { subtitle: string; meta: string } {
  switch (d.type) {
    case 'auction':
      return {
        subtitle: `${d.artist_name}${d.other_name ? `, лидирует ${d.other_name}` : ''}`,
        meta: `${d.amount_kop ? formatPrice(d.amount_kop) : ''}, ставок ${d.count}${d.at ? `, до ${formatDateTime(d.at)}` : ''}`,
      };
    case 'offer':
      return { subtitle: `${d.other_name} предлагает ${d.artist_name}`, meta: `${d.amount_kop ? formatPrice(d.amount_kop) : ''}, от ${formatDate(d.created_at)}` };
    case 'commission':
      return { subtitle: `${d.other_name} заказывает у ${d.artist_name}`, meta: `${d.amount_kop ? formatPrice(d.amount_kop) : 'без бюджета'}${d.count ? `, срок ${d.count} дн.` : ''}, от ${formatDate(d.created_at)}` };
    default:
      return { subtitle: d.artist_name, meta: `${d.count} работ${d.at ? `, открытие ${formatDateTime(d.at)}` : ''}` };
  }
}

function DealRow({ d, tab }: { d: AdminDeal; tab: Tab }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, tone] = label(dealStatus, d.status);
  const { subtitle, meta } = describe(d);
  const canCancel = cancellable[tab].includes(d.status);
  const openTarget = () => {
    if (d.type === 'exhibition') router.push({ pathname: '/exhibition/[id]', params: { id: d.id } });
    else if (d.type === 'auction') router.push({ pathname: '/auction/[id]', params: { id: d.id } });
    else if (d.artwork_id) router.push({ pathname: '/artwork/[id]', params: { id: d.artwork_id } });
  };
  return (
    <View>
      <AdminRow image={d.image_url} title={d.title || 'Без названия'} subtitle={subtitle} meta={meta} badges={<Badge text={text} tone={tone} />} onPress={() => setOpen(!open)} />
      {open ? (
        <View style={styles.panel}>
          <AdminRow title={d.artist_name} subtitle="Художник" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: d.artist_id } })} />
          {d.other_id ? <AdminRow title={d.other_name} subtitle="Покупатель" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: d.other_id! } })} /> : null}
          {d.type !== 'commission' ? <AdminRow title="Открыть в приложении" onPress={openTarget} /> : null}
          {canCancel ? (
            <ConfirmAction
              title={d.type === 'offer' ? 'Отклонить предложение' : 'Отменить'}
              variant="danger"
              description={d.type === 'auction' ? 'Аукцион закрывается без победителя, работа возвращается в продажу по обычной цене.' : undefined}
              reasonLabel="Причина (попадёт в журнал)"
              onConfirm={async (reason) => {
                await post(`/admin/deals/${tab}/${d.id}/cancel`, { reason });
                qc.invalidateQueries({ queryKey: ['admin', 'list', `deals/${tab}`] });
                qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  panel: { gap: space.sm, paddingLeft: space.xl, paddingVertical: space.sm },
}));

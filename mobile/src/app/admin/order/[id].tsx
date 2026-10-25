import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { adminKeys, type AdminOrderDetail, useAdminOrder } from '@/api/admin';
import { errorText, post } from '@/api/client';
import { actionLabels, label, orderKind, orderStatus, paymentPurpose, paymentStatus, payoutStatus, summarize } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ConfirmAction, Empty, Line2, Section } from '@/features/admin/ui';
import { formatDateTime, formatPrice } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, ErrorState, Loading } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

const deliveryNames: Record<string, string> = { cdek: 'СДЭК', express: 'Курьер', post: 'Почта России' };

export default function AdminOrderRoute() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <AdminOrderScreen id={id} />;
}

function AdminOrderScreen({ id }: { id: string }) {
  const q = useAdminOrder(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <OrderView o={q.data} />;
}

function OrderView({ o }: { o: AdminOrderDetail }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [text, tone] = label(orderStatus, o.status);
  const active = ['awaiting_payment', 'paid', 'confirmed', 'shipped'].includes(o.status);

  const act = async (action: 'cancel' | 'complete', reason: string) => {
    const next = await post<AdminOrderDetail>(`/admin/orders/${o.id}/${action}`, { reason });
    qc.setQueryData(adminKeys.order(o.id), next);
    qc.invalidateQueries({ queryKey: ['admin', 'list'] });
    qc.invalidateQueries({ queryKey: adminKeys.dashboard });
  };

  const addr = o.address ?? {};
  return (
    <AdminScreen title={o.artwork_title} subtitle={`Заказ от ${formatDateTime(o.created_at)}`}>
      <View style={styles.head}>
        {o.image_url ? <Image source={{ uri: o.image_url }} style={styles.image} contentFit="cover" /> : null}
        <View style={styles.flex}>
          <View style={styles.badges}>
            <Badge text={text} tone={tone} />
            <Badge text={orderKind[o.kind] ?? o.kind} />
            <Badge text={`Деньги: ${payoutStatus[o.payout_status] ?? o.payout_status}`} tone={o.payout_status === 'refunded' ? 'bad' : o.payout_status === 'released' ? 'good' : 'warn'} />
          </View>
          {o.cancel_reason ? <Line2 label="Причина отмены" value={o.cancel_reason} /> : null}
          {o.deadline_at && active ? <Line2 label="Срок шага" value={formatDateTime(o.deadline_at)} /> : null}
        </View>
      </View>

      {active ? (
        <Section title="Разбор спора">
          <View style={styles.actions}>
            <ConfirmAction
              title="Отменить и вернуть деньги"
              variant="danger"
              description="Заказ отменяется в любом активном статусе, оплата возвращается покупателю, работа снова в продаже."
              reasonLabel="Причина — её увидят покупатель и художник"
              onConfirm={(reason) => act('cancel', reason)}
            />
            {o.status === 'shipped' ? (
              <ConfirmAction title="Завершить заказ" description="Покупатель получил работу: деньги уходят художнику, покупателю выдаётся сертификат." onConfirm={(reason) => act('complete', reason)} />
            ) : null}
          </View>
        </Section>
      ) : null}

      <Section title="Участники">
        <AdminRow title={o.buyer_name} subtitle="Покупатель" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: o.buyer_id } })} />
        <AdminRow title={o.artist_name} subtitle="Художник" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: o.artist_id } })} />
        <Button title="Открыть работу" variant="ghost" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: o.artwork_id } })} />
      </Section>

      <Section title="Сумма">
        <Line2 label="Работа" value={formatPrice(o.price_kop)} />
        <Line2 label="Доставка" value={formatPrice(o.delivery_kop)} />
        <Line2 label="Итого оплачено" value={formatPrice(o.total_kop)} />
        <Line2 label="Комиссия платформы" value={formatPrice(o.commission_kop)} />
      </Section>

      <Section title="Доставка">
        <Line2 label="Способ" value={deliveryNames[o.delivery_method] ?? o.delivery_method} />
        {o.tracking_number ? <Line2 label="Трек-номер" value={o.tracking_number} /> : null}
        <Line2 label="Получатель" value={[addr.recipient_name, addr.phone].filter(Boolean).join(', ') || '—'} />
        <Line2 label="Адрес" value={[addr.postal_code, addr.city, addr.street].filter(Boolean).join(', ') || '—'} />
        {addr.comment ? <Line2 label="Комментарий" value={addr.comment} /> : null}
      </Section>

      <Section title="Этапы">
        <Line2 label="Создан" value={formatDateTime(o.created_at)} />
        {o.paid_at ? <Line2 label="Оплачен" value={formatDateTime(o.paid_at)} /> : null}
        {o.completed_at ? <Line2 label="Завершён" value={formatDateTime(o.completed_at)} /> : null}
        {o.cancelled_at ? <Line2 label="Отменён" value={formatDateTime(o.cancelled_at)} /> : null}
      </Section>

      <Section title="Платежи">
        {o.payments.length ? null : <Empty text="Платежей нет." />}
        {o.payments.map((p) => {
          const [ptext, ptone] = label(paymentStatus, p.status);
          return <AdminRow key={p.id} title={`${paymentPurpose[p.purpose] ?? p.purpose}: ${formatPrice(p.amount_kop)}`} subtitle={`${p.provider}${p.external_id ? `, ${p.external_id}` : ''}`} meta={formatDateTime(p.created_at)} badges={<Badge text={ptext} tone={ptone} />} />;
        })}
      </Section>

      {o.admin_actions.length ? (
        <Section title="Действия администраторов">
          {o.admin_actions.map((a) => (
            <AdminRow key={a.id} title={actionLabels[a.action] ?? a.action} subtitle={summarize(a.details)} meta={`${a.admin_name}, ${formatDateTime(a.created_at)}`} />
          ))}
        </Section>
      ) : null}
    </AdminScreen>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' },
  image: { width: 120, height: 120, borderRadius: radius.art, backgroundColor: c.plaster },
  flex: { flex: 1, minWidth: 240, gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { gap: space.md },
}));

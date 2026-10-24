// Статусы заказа: подписи и шкала этапов сделки.
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import type { Order, OrderStatus } from '@/api/types';
import { type TFunc, useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { T } from '@/ui/primitives';
import { makeStyles, type Palette, space, useColors } from '@/ui/theme';

const labels: Record<OrderStatus, string> = {
  awaiting_payment: 'Ожидает оплаты',
  paid: 'Оплачен, ждёт подтверждения',
  confirmed: 'Готовится к отправке',
  shipped: 'В пути',
  completed: 'Получен',
  cancelled: 'Отменён',
};

export function orderStatusLabel(s: OrderStatus, t: TFunc): string {
  return t(labels[s]);
}

export function statusTone(s: OrderStatus, c: Palette): string {
  if (s === 'completed') return c.success;
  if (s === 'cancelled') return c.danger;
  return c.bordeaux;
}

const steps: { status: OrderStatus; title: string; at: keyof Order }[] = [
  { status: 'paid', title: 'Оплачен', at: 'paid_at' },
  { status: 'confirmed', title: 'Художник подтвердил', at: 'confirmed_at' },
  { status: 'shipped', title: 'Отправлен', at: 'shipped_at' },
  { status: 'completed', title: 'Получен покупателем', at: 'completed_at' },
];

const order: OrderStatus[] = ['awaiting_payment', 'paid', 'confirmed', 'shipped', 'completed'];

/** Шкала этапов — это действительно последовательность, поэтому шаги пронумерованы. */
export function StatusTimeline({ o }: { o: Order }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  if (o.status === 'cancelled') return null;
  const reached = order.indexOf(o.status);
  return (
    <View style={styles.timeline} accessibilityLabel={t('Статус заказа: {s}', { s: orderStatusLabel(o.status, t) })}>
      {steps.map((s, i) => {
        const done = order.indexOf(s.status) <= reached;
        const at = o[s.at] as string | null;
        return (
          <View key={s.status} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.node, done && styles.nodeDone]}>
                {done ? (
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                ) : (
                  <T variant="smallStrong" color={colors.graphite}>
                    {i + 1}
                  </T>
                )}
              </View>
              {i < steps.length - 1 ? <View style={[styles.line, done && order.indexOf(steps[i + 1].status) <= reached && styles.lineDone]} /> : null}
            </View>
            <View style={styles.stepText}>
              <T variant={done ? 'bodyStrong' : 'body'} color={done ? colors.ink : colors.graphite}>
                {t(s.title)}
              </T>
              {at ? <T variant="small">{formatDate(at)}</T> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  timeline: { gap: 0 },
  step: { flexDirection: 'row', gap: space.md, minHeight: 52 },
  rail: { alignItems: 'center', width: 26 },
  node: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: c.paper },
  nodeDone: { backgroundColor: c.bordeaux, borderColor: c.bordeaux },
  line: { flex: 1, width: 2, backgroundColor: c.hairline, marginVertical: 2 },
  lineDone: { backgroundColor: c.bordeaux },
  stepText: { flex: 1, paddingTop: 2, gap: 2 },
}));

import { router } from 'expo-router';

import { useAudit } from '@/api/admin';
import { errorText } from '@/api/client';
import { actionLabels, summarize } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Empty } from '@/features/admin/ui';
import { formatDateTime } from '@/lib/format';
import { Button, Loading, Notice } from '@/ui/primitives';

export default function AdminAudit() {
  const q = useAudit();
  const open = (type: string, id: string) => {
    if (type === 'user') router.push({ pathname: '/admin/user/[id]', params: { id } });
    else if (type === 'order') router.push({ pathname: '/admin/order/[id]', params: { id } });
    else if (type === 'artwork') router.push({ pathname: '/artwork/[id]', params: { id } });
    else if (type === 'settings') router.push('/admin/settings');
  };
  return (
    <AdminScreen title="Журнал действий" subtitle="Последние 200 изменений, сделанных в админке" actions={<Button title="Обновить" variant="ghost" onPress={() => void q.refetch()} />}>
      {q.isLoading ? <Loading /> : null}
      {q.isError && !q.data ? <Notice tone="danger" text={errorText(q.error)} /> : null}
      {q.data && !q.data.length ? <Empty text="Пока ничего не меняли." /> : null}
      {q.data?.map((a) => (
        <AdminRow
          key={a.id}
          title={actionLabels[a.action] ?? a.action}
          subtitle={summarize(a.details) || `${a.target_type} ${a.target_id}`}
          meta={`${a.admin_name || 'Администратор'}, ${formatDateTime(a.created_at)}`}
          onPress={['user', 'order', 'artwork', 'settings'].includes(a.target_type) ? () => open(a.target_type, a.target_id) : undefined}
        />
      ))}
    </AdminScreen>
  );
}

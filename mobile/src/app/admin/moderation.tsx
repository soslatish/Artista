import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { adminTotal, type AdminContent, type AdminReport, flattenAdmin, useAdminList, useAdminReports } from '@/api/admin';
import { errorText, post } from '@/api/client';
import { AdminRow, AdminScreen, Badge, ChipFilter, ConfirmAction, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { useDebounced } from '@/features/admin/use-debounced';
import { formatDateTime } from '@/lib/format';
import { Button, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

const tabs = [
  { value: 'reports', label: 'Жалобы' },
  { value: 'posts', label: 'Посты' },
  { value: 'questions', label: 'Вопросы о работах' },
];

const targetNames: Record<string, string> = { artwork: 'Работа', user: 'Пользователь', message: 'Сообщение', question: 'Вопрос', post: 'Пост' };

export default function AdminModeration() {
  const [tab, setTab] = useState('reports');
  return (
    <AdminScreen title="Модерация">
      <ChipFilter options={tabs} value={tab} onChange={setTab} />
      {tab === 'reports' ? <Reports /> : <Content kind={tab as 'posts' | 'questions'} />}
    </AdminScreen>
  );
}

function Reports() {
  const styles = useStyles();
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const q = useAdminReports(status);
  const resolve = async (r: AdminReport, action: 'hide' | 'reject', resolution: string) => {
    await post(`/admin/reports/${r.id}/resolve`, { action, resolution });
    qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  };
  const open = (r: AdminReport) => {
    if (r.target_type === 'artwork') router.push({ pathname: '/artwork/[id]', params: { id: r.target_id } });
    else if (r.target_type === 'user') router.push({ pathname: '/admin/user/[id]', params: { id: r.target_id } });
  };
  return (
    <>
      <ChipFilter
        options={[
          { value: 'open', label: 'Открытые' },
          { value: 'resolved', label: 'Скрыто' },
          { value: 'rejected', label: 'Отклонены' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {q.isLoading ? <Loading /> : null}
      {q.isError && !q.data ? <Notice tone="danger" text={errorText(q.error)} /> : null}
      {q.data && !q.data.length ? <Empty text={status === 'open' ? 'Открытых жалоб нет.' : 'Пусто.'} /> : null}
      {q.data?.map((r) => (
        <View key={r.id} style={styles.card}>
          <AdminRow
            title={`${targetNames[r.target_type] ?? r.target_type}: ${r.target_label || r.target_id}`}
            subtitle={`«${r.reason}»`}
            meta={`${r.reporter_name || 'Пользователь'}, ${formatDateTime(r.created_at)}${r.resolution ? `. Решение: ${r.resolution}` : ''}`}
            badges={<Badge text={targetNames[r.target_type] ?? r.target_type} tone="bad" />}
            onPress={r.target_type === 'artwork' || r.target_type === 'user' ? () => open(r) : undefined}
          />
          {r.status === 'open' ? (
            <View style={styles.actions}>
              <ConfirmAction
                title={r.target_type === 'user' ? 'Заблокировать' : 'Скрыть'}
                variant="danger"
                description={r.target_type === 'user' ? 'Пользователь не сможет войти, его работы скроются.' : 'Объект скроется для всех.'}
                reasonLabel="Комментарий к решению"
                onConfirm={(reason) => resolve(r, 'hide', reason)}
              />
              <ConfirmAction title="Отклонить жалобу" reasonLabel="Комментарий" onConfirm={(reason) => resolve(r, 'reject', reason)} />
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

function Content({ kind }: { kind: 'posts' | 'questions' }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = useAdminList<AdminContent>(`content/${kind}`, { status: status || undefined, q: q || undefined });
  const items = flattenAdmin(list.data);
  const [error, setError] = useState('');
  const toggle = async (c: AdminContent) => {
    setError('');
    try {
      await post(`/admin/content/${kind}/${c.id}/hidden`, { hidden: !c.hidden_at });
      qc.invalidateQueries({ queryKey: ['admin', 'list', `content/${kind}`] });
      qc.invalidateQueries({ queryKey: ['posts-feed'] });
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <ChipFilter
        options={[
          { value: '', label: 'Все' },
          { value: 'visible', label: 'Видны' },
          { value: 'hidden', label: 'Скрыты' },
          { value: 'reported', label: 'С жалобами' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <SearchBar value={text} onChange={setText} placeholder="Текст или автор" />
      {error ? <Notice tone="danger" text={error} /> : null}
      {list.isLoading ? <Loading /> : null}
      {items.map((c) => (
        <View key={c.id} style={styles.card}>
          <AdminRow
            image={c.image_url || undefined}
            title={c.author_name}
            subtitle={c.body || '(без текста)'}
            meta={`${formatDateTime(c.created_at)}${c.extra ? `. ${kind === 'questions' ? 'Ответ' : 'Работа'}: ${c.extra}` : ''}`}
            badges={
              <>
                {c.hidden_at ? <Badge text="Скрыт" tone="bad" /> : <Badge text="Виден" tone="good" />}
                {c.reports ? <Badge text={`Жалоб: ${c.reports}`} tone="bad" /> : null}
              </>
            }
            onPress={c.artwork_id ? () => router.push({ pathname: '/artwork/[id]', params: { id: c.artwork_id! } }) : undefined}
          />
          <View style={styles.actions}>
            <Button title={c.hidden_at ? 'Показать снова' : 'Скрыть'} variant={c.hidden_at ? 'secondary' : 'danger'} onPress={() => void toggle(c)} />
            <Button title="Автор" variant="ghost" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: c.author_id } })} />
          </View>
        </View>
      ))}
      {!list.isLoading && !items.length ? <T variant="small">Ничего не найдено.</T> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingLeft: space.sm, paddingBottom: space.md },
}));

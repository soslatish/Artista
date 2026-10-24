import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { del, errorText } from '@/api/client';
import { flatten, keys, useHistory } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { confirmAction, notify } from '@/lib/confirm';
import { Gallery } from '@/ui/artwork';
import { Button, EmptyState, ErrorState } from '@/ui/primitives';
import { makeStyles } from '@/ui/theme';

export default function HistoryScreen() {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const { user } = useSession();
  const q = useHistory(!!user);
  const items = flatten(q.data);

  const clear = () =>
    confirmAction(t('Очистить историю?'), t('Рекомендации «Для вас» станут менее точными.'), async () => {
      try {
        await del('/me/history');
        qc.setQueryData(keys.history, undefined);
        qc.invalidateQueries({ queryKey: keys.history });
      } catch (e) {
        notify(t('Не удалось очистить'), errorText(e));
      }
    }, { destructive: true });

  if (q.isError) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerRight: () => (items.length ? <Button title={t('Очистить')} variant="ghost" onPress={clear} /> : null) }} />
      <Gallery
        items={items}
        loading={q.isLoading}
        src="history"
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        loadingMore={q.isFetchingNextPage}
        empty={
          <EmptyState
            icon="time-outline"
            title={t('Вы ещё ничего не смотрели')}
            text={t('Здесь появятся работы, которые вы открывали, — чтобы легко вернуться к понравившейся.')}
            action={<Button title={t('Смотреть галерею')} variant="secondary" onPress={() => router.navigate('/')} />}
          />
        }
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
}));

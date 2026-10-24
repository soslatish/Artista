import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { del, errorText } from '@/api/client';
import { keys, useCatalogMeta, useSavedSearches } from '@/api/hooks';
import type { SavedSearch } from '@/api/types';
import { useSession } from '@/auth/session';
import { SignInGate } from '@/features/sign-in-gate';
import { useT } from '@/i18n';
import { confirmAction, notify } from '@/lib/confirm';
import { describeFilter } from '@/lib/filters';
import { Button, EmptyState, ErrorState, IconButton, Loading, T } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

export default function SavedSearchesScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useSession();
  const meta = useCatalogMeta();
  const q = useSavedSearches(!!user);

  const remove = (s: SavedSearch) =>
    confirmAction(t('Удалить поиск?'), t('Уведомления о новых работах по нему прекратятся.'), async () => {
      try {
        await del(`/me/saved-searches/${s.id}`);
        qc.setQueryData(keys.savedSearches, (old: SavedSearch[] | undefined) => old?.filter((x) => x.id !== s.id));
      } catch (e) {
        notify(t('Не удалось удалить'), errorText(e));
      }
    }, { destructive: true });

  if (!user) return <SignInGate text={t('Сохраняйте поиски и получайте уведомления о новых подходящих работах.')} />;
  if (q.isLoading) return <Loading />;
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.list}
      data={q.data ?? []}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
      ListHeaderComponent={<T variant="small">{t('Когда появится подходящая работа, пришлём уведомление — не чаще раза в час на поиск.')}</T>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            style={styles.flex}
            onPress={() => router.navigate({ pathname: '/search', params: { filters: JSON.stringify(item.filters), k: String(Date.now()) } })}>
            <T variant="bodyStrong">{item.title}</T>
            <T variant="small">{describeFilter(item.filters, meta.data, t)}</T>
          </Pressable>
          <IconButton icon="trash-outline" color={colors.graphite} label={t('Удалить поиск «{title}»', { title: item.title })} onPress={() => remove(item)} />
        </View>
      )}
      ListEmptyComponent={
        <EmptyState
          icon="bookmark-outline"
          title={t('Нет сохранённых поисков')}
          text={t('Настройте фильтры в поиске и нажмите «Сохранить поиск» — мы сообщим о новых подходящих работах.')}
          action={<Button title={t('Перейти в поиск')} variant="secondary" onPress={() => router.navigate('/search')} />}
        />
      }
    />
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  list: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.hairline },
  flex: { flex: 1, gap: 2 },
}));

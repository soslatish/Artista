import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '@/api/client';
import { flatten, useFavorites } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { Gallery } from '@/ui/artwork';
import { Button, EmptyState, ErrorState, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useStyles();
  const { user } = useSession();
  const q = useFavorites(!!user);

  if (!user) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          icon="heart-outline"
          title={t('Сохраняйте понравившееся')}
          text={t('Войдите, чтобы собирать работы в избранное и следить за ценами.')}
          action={<Button title={t('Войти')} onPress={() => router.push('/login')} />}
        />
      </View>
    );
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <T variant="display" style={styles.title}>
        {t('Избранное')}
      </T>
      {q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Gallery
          items={flatten(q.data)}
          loading={q.isLoading}
          src="favorites"
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          loadingMore={q.isFetchingNextPage}
          empty={
            <EmptyState
              icon="heart-outline"
              title={t('Пока ничего')}
              text={t('Нажмите на сердце на странице работы — она появится здесь. Если цена снизится, мы сообщим.')}
              action={<Button title={t('Смотреть галерею')} variant="secondary" onPress={() => router.navigate('/')} />}
            />
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  title: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
}));

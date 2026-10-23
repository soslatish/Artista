import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '@/api/client';
import { flatten, useFavorites } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { Gallery } from '@/ui/artwork';
import { Button, EmptyState, ErrorState, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const q = useFavorites(!!user);

  if (!user) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          icon="heart-outline"
          title="Сохраняйте понравившееся"
          text="Войдите, чтобы собирать работы в избранное и следить за ценами."
          action={<Button title="Войти" onPress={() => router.push('/login')} />}
        />
      </View>
    );
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <T variant="display" style={styles.title}>
        Избранное
      </T>
      {q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Gallery
          items={flatten(q.data)}
          loading={q.isLoading}
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          loadingMore={q.isFetchingNextPage}
          empty={
            <EmptyState
              icon="heart-outline"
              title="Пока ничего"
              text="Нажмите на сердце на странице работы — она появится здесь."
              action={<Button title="Смотреть галерею" variant="secondary" onPress={() => router.navigate('/')} />}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  title: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
});

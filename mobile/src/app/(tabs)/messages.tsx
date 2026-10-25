import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '@/api/client';
import { flatten, useConversations } from '@/api/hooks';
import type { Conversation } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { formatMessageTime } from '@/lib/format';
import { webPage } from '@/ui/layout';
import { Avatar, Button, EmptyState, ErrorState, Loading, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const q = useConversations(!!user);

  if (!user) {
    return (
      <View style={[styles.root, webPage, { paddingTop: insets.top }]}>
        <EmptyState
          icon="chatbubbles-outline"
          title={t('Переписка с художниками')}
          text={t('Войдите, чтобы задать вопрос о работе или договориться о деталях.')}
          action={<Button title={t('Войти')} onPress={() => router.push('/login')} />}
        />
      </View>
    );
  }
  const items = flatten(q.data);
  return (
    <View style={[styles.root, webPage, { paddingTop: insets.top }]}>
      <T variant="display" style={styles.title}>
        {t('Сообщения')}
      </T>
      {q.isLoading ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <Row c={item} myId={user.id} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t('Сообщений пока нет')} text={t('Напишите художнику со страницы работы.')} />}
        />
      )}
    </View>
  );
}

function Row({ c, myId }: { c: Conversation; myId: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const last = c.last_message;
  const mine = last?.sender_id === myId;
  const preview = last ? last.body || (last.image_url ? t('Фото') : '') : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={c.unread ? t('Диалог с {name}, непрочитанных {n}', { name: c.other.name, n: c.unread }) : t('Диалог с {name}', { name: c.other.name })}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id, name: c.other.name } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Avatar uri={c.other.avatar_url} name={c.other.name} size={48} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <T variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {c.other.name}
          </T>
          {last ? <T variant="small">{formatMessageTime(last.created_at)}</T> : null}
        </View>
        {c.artwork ? (
          <T variant="artTitleSmall" numberOfLines={1}>
            {c.artwork.title}
          </T>
        ) : null}
        <View style={styles.rowTop}>
          <T variant="small" numberOfLines={1} style={styles.flex} color={c.unread ? colors.ink : colors.graphite}>
            {mine ? t('Вы: ') : ''}
            {preview}
          </T>
          {c.unread ? (
            <View style={styles.unread}>
              <T variant="smallStrong" color={colors.onDark}>
                {c.unread}
              </T>
            </View>
          ) : null}
        </View>
      </View>
      {c.artwork?.image_url ? <Image source={{ uri: c.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  title: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center' },
  pressed: { backgroundColor: c.plaster },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.bordeaux, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  thumb: { width: 44, height: 56, borderRadius: radius.art },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginLeft: 76 },
}));

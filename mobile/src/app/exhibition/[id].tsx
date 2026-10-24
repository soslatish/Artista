import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { del, errorText, post } from '@/api/client';
import { flatten, keys, pageMeta, useExhibition } from '@/api/hooks';
import type { Exhibition } from '@/api/types';
import { useSession } from '@/auth/session';
import { shareLink } from '@/features/share';
import { useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { formatCountdown, formatDateTime } from '@/lib/format';
import { requireAuth, validId } from '@/lib/guard';
import { useNow } from '@/lib/use-now';
import { Gallery } from '@/ui/artwork';
import { Avatar, Button, EmptyState, ErrorState, IconButton, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function ExhibitionRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <ExhibitionScreen id={id} />;
}

function ExhibitionScreen({ id }: { id: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const q = useExhibition(id);
  const e = pageMeta<Exhibition>(q.data, 'exhibition');
  if (q.isError) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: e?.title ?? t('Выставка'),
          headerRight: () => (e ? <IconButton icon="share-outline" color={colors.ink} label={t('Поделиться')} onPress={() => void shareLink(`/e/${e.id}`, `${e.title} — ${e.artist.name}`)} /> : null),
        }}
      />
      <Gallery
        items={flatten(q.data)}
        loading={q.isLoading}
        src="exhibition"
        showStatus={e?.status !== 'open'}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        loadingMore={q.isFetchingNextPage}
        header={e ? <Header e={e} /> : null}
        empty={<EmptyState title={t('Работы появятся к открытию')} />}
      />
    </View>
  );
}

function Header({ e }: { e: Exhibition }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const now = useNow(e.status === 'upcoming' ? 1000 : 60_000);
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = user?.id === e.artist.id;
  const upcoming = e.status === 'upcoming';

  const patchMeta = (next: Partial<Exhibition>) =>
    qc.setQueryData(keys.exhibition(e.id), (old: { pages: { meta: Record<string, unknown> }[] } | undefined) =>
      old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, meta: { ...p.meta, exhibition: { ...e, ...next } } } : p)) } : old,
    );

  const toggleRemind = async () => {
    if (!requireAuth(!!user)) return;
    setBusy(true);
    setError('');
    try {
      if (e.reminded) await del(`/exhibitions/${e.id}/remind`);
      else await post(`/exhibitions/${e.id}/remind`);
      patchMeta({ reminded: !e.reminded, reminders: e.reminders + (e.reminded ? -1 : 1) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    confirmAction(t('Отменить выставку?'), t('Работы вернутся в черновики, подписчики получат уведомление.'), async () => {
      try {
        await post(`/exhibitions/${e.id}/cancel`);
        qc.invalidateQueries({ queryKey: ['exhibitions'] });
        qc.invalidateQueries({ queryKey: ['my-artworks'] });
        router.back();
      } catch (err) {
        setError(errorText(err));
      }
    }, { destructive: true });

  return (
    <View style={styles.head}>
      {e.cover_url ? <Image source={{ uri: e.cover_url }} style={styles.cover} contentFit="cover" /> : null}
      <T variant="display">{e.title}</T>
      <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/artist/[id]', params: { id: e.artist.id } })} style={styles.artist}>
        <Avatar uri={e.artist.avatar_url} name={e.artist.name} size={32} />
        <T variant="bodyStrong">{e.artist.name}</T>
      </Pressable>
      {e.description ? <T variant="body">{e.description}</T> : null}
      {upcoming ? (
        <View style={styles.board}>
          <T variant="small">{t('Открытие {date}', { date: formatDateTime(e.starts_at) })}</T>
          <T variant="title">{formatCountdown(e.starts_at, now)}</T>
          <T variant="small">{t('Работы станут доступны для покупки все одновременно. Напоминание получили {n}.', { n: e.reminders })}</T>
        </View>
      ) : e.status === 'cancelled' ? (
        <Notice tone="danger" text={t('Выставка отменена.')} />
      ) : (
        <Notice tone="success" text={t('Выставка открыта с {date}. Работы можно купить.', { date: formatDateTime(e.starts_at) })} />
      )}
      {error ? <Notice tone="danger" text={error} /> : null}
      {upcoming && !mine ? (
        <Button title={e.reminded ? t('Напомним об открытии') : t('Напомнить об открытии')} variant={e.reminded ? 'secondary' : 'primary'} icon={e.reminded ? 'checkmark' : 'notifications-outline'} loading={busy} onPress={toggleRemind} />
      ) : null}
      {upcoming && mine ? <Button title={t('Отменить выставку')} variant="ghost" onPress={cancel} /> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  head: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.xl, gap: space.md },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.art, backgroundColor: c.plaster },
  artist: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' },
  board: { gap: 4, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
}));

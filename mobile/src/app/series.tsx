import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { del, errorText, fieldErrors, patch, post } from '@/api/client';
import { keys, useUserSeries } from '@/api/hooks';
import type { Series } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { confirmAction, notify } from '@/lib/confirm';
import { plural } from '@/lib/format';
import { Button, EmptyState, ErrorState, Field, IconButton, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function SeriesScreen() {
  const { user } = useSession();
  const t = useT();
  if (!user) return <ErrorState text={t('Войдите, чтобы управлять сериями.')} />;
  return <SeriesManager userId={user.id} />;
}

function SeriesManager({ userId }: { userId: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const q = useUserSeries(userId);
  const [editing, setEditing] = useState<Series | 'new' | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.series(userId) });
    qc.invalidateQueries({ queryKey: keys.userArtworks(userId) });
    qc.invalidateQueries({ queryKey: ['artwork'] });
  };

  const remove = (s: Series) =>
    confirmAction(t('Удалить серию «{title}»?', { title: s.title }), t('Работы останутся в профиле, просто без серии.'), async () => {
      try {
        await del(`/me/series/${s.id}`);
        refresh();
      } catch (e) {
        notify(t('Не удалось удалить'), errorText(e));
      }
    }, { destructive: true });

  if (q.isLoading) return <Loading />;
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <View style={styles.root}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        ListHeaderComponent={
          <View style={styles.head}>
            <T variant="small">{t('Серии группируют работы в профиле: «Северные пейзажи», «Ночной город». Работу добавляют в серию в её карточке.')}</T>
            {editing === 'new' ? <SeriesForm onDone={() => (setEditing(null), refresh())} onCancel={() => setEditing(null)} /> : <Button title={t('Новая серия')} icon="add" onPress={() => setEditing('new')} />}
          </View>
        }
        renderItem={({ item: s }) =>
          editing !== 'new' && editing?.id === s.id ? (
            <SeriesForm series={s} onDone={() => (setEditing(null), refresh())} onCancel={() => setEditing(null)} />
          ) : (
            <View style={styles.row}>
              {s.cover_url ? <Image source={{ uri: s.cover_url }} style={styles.cover} contentFit="cover" /> : <View style={styles.cover} />}
              <View style={styles.flex}>
                <T variant="artTitleSmall">{s.title}</T>
                <T variant="small">{`${s.artworks_count} ${plural(s.artworks_count, ['работа', 'работы', 'работ'], ['artwork', 'artworks'])}`}</T>
              </View>
              <IconButton icon="create-outline" color={colors.graphite} label={t('Изменить серию «{title}»', { title: s.title })} onPress={() => setEditing(s)} />
              <IconButton icon="trash-outline" color={colors.graphite} label={t('Удалить серию «{title}»', { title: s.title })} onPress={() => remove(s)} />
            </View>
          )
        }
        ListEmptyComponent={editing === 'new' ? undefined : <EmptyState icon="albums-outline" title={t('Серий пока нет')} text={t('Создайте первую — и покупатели увидят ваши работы сгруппированными по темам.')} />}
      />
    </View>
  );
}

function SeriesForm({ series, onDone, onCancel }: { series?: Series; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const styles = useStyles();
  const [title, setTitle] = useState(series?.title ?? '');
  const [description, setDescription] = useState(series?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { title: title.trim(), description: description.trim() };
      if (series) await patch(`/me/series/${series.id}`, body);
      else await post('/me/series', body);
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Field label={t('Название серии')} value={title} onChangeText={setTitle} maxLength={80} error={errors.title} />
      <Field label={t('Описание')} value={description} onChangeText={setDescription} multiline maxLength={1000} error={errors.description} />
      {error && !errors.title ? <Notice tone="danger" text={error} /> : null}
      <View style={styles.actions}>
        <Button title={t('Отмена')} variant="ghost" onPress={onCancel} style={styles.flex} />
        <Button title={t('Сохранить')} loading={busy} disabled={title.trim().length < 2} onPress={save} style={styles.flex} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  head: { gap: space.md, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.hairline },
  cover: { width: 56, height: 56, borderRadius: radius.art, backgroundColor: c.plaster },
  flex: { flex: 1 },
  form: { gap: space.md, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  actions: { flexDirection: 'row', gap: space.md },
}));

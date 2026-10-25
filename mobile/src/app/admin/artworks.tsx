import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { adminTotal, type AdminArtwork, flattenAdmin, useAdminList } from '@/api/admin';
import { errorText, patch } from '@/api/client';
import { artworkStatus, label } from '@/features/admin/labels';
import { AdminRow, AdminScreen, Badge, ChipFilter, Empty, LoadMore, SearchBar } from '@/features/admin/ui';
import { param, useDebounced } from '@/features/admin/use-debounced';
import { formatDate, formatPrice, parseRubles } from '@/lib/format';
import { Button, Field, Loading, Notice } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

const statuses = [
  { value: '', label: 'Все' },
  ...['published', 'hidden', 'draft', 'archived', 'reserved', 'sold', 'auction', 'scheduled'].map((s) => ({ value: s, label: artworkStatus[s][0] })),
];

export default function AdminArtworks() {
  const params = useLocalSearchParams();
  const [text, setText] = useState('');
  const [status, setStatus] = useState(param(params.status));
  const [reported, setReported] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(text.trim());
  const artistId = param(params.artist_id);
  const list = useAdminList<AdminArtwork>('artworks', { q: q || undefined, status: status || undefined, artist_id: artistId || undefined, reported: reported ? 'true' : undefined });
  const items = flattenAdmin(list.data);
  return (
    <AdminScreen title="Работы" subtitle={list.data ? `Найдено: ${adminTotal(list.data)}${artistId ? ' у выбранного художника' : ''}` : undefined}>
      <SearchBar value={text} onChange={setText} placeholder="Название, художник или id" />
      <ChipFilter options={statuses} value={status} onChange={setStatus} />
      <ChipFilter options={[{ value: '', label: 'Все работы' }, { value: 'reported', label: 'С открытыми жалобами' }]} value={reported ? 'reported' : ''} onChange={(v) => setReported(v === 'reported')} />
      {list.isLoading ? <Loading /> : null}
      {list.isError && !list.data ? <Notice tone="danger" text={errorText(list.error)} /> : null}
      {items.map((a) => {
        const [text2, tone] = label(artworkStatus, a.status);
        return (
          <View key={a.id}>
            <AdminRow
              image={a.image_url}
              title={a.title}
              subtitle={`${a.artist_name}, ${formatPrice(a.price_kop)}`}
              meta={`${formatDate(a.created_at)}. Просмотров ${a.views}, в избранном ${a.favorites}`}
              badges={
                <>
                  <Badge text={text2} tone={tone} />
                  {a.is_promoted ? <Badge text="Продвигается" tone="warn" /> : null}
                  {a.reports ? <Badge text={`Жалоб: ${a.reports}`} tone="bad" /> : null}
                </>
              }
              onPress={() => setOpen(open === a.id ? null : a.id)}
            />
            {open === a.id ? <ArtworkActions a={a} /> : null}
          </View>
        );
      })}
      {!list.isLoading && !items.length ? <Empty text="Работ не найдено." /> : null}
      {list.data ? <LoadMore visible={!!list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} shown={items.length} total={adminTotal(list.data)} /> : null}
    </AdminScreen>
  );
}

function ArtworkActions({ a }: { a: AdminArtwork }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [price, setPrice] = useState(String(a.price_kop / 100));
  const [title, setTitle] = useState(a.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = a.status === 'sold' || a.status === 'reserved' || a.status === 'commission';

  const save = async (body: object) => {
    setBusy(true);
    setError('');
    try {
      await patch(`/admin/artworks/${a.id}`, body);
      qc.invalidateQueries({ queryKey: ['admin', 'list', 'artworks'] });
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['artwork', a.id] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      {error ? <Notice tone="danger" text={error} /> : null}
      {locked ? <Notice text="Работа продана или в заказе — её статус меняется через заказ." /> : null}
      <View style={styles.row}>
        {!locked && a.status !== 'published' ? <Button title="Вернуть в продажу" loading={busy} onPress={() => void save({ status: 'published' })} /> : null}
        {!locked && a.status !== 'hidden' ? <Button title="Скрыть" variant="danger" loading={busy} onPress={() => void save({ status: 'hidden', reason: 'Скрыта администратором' })} /> : null}
        {!locked && a.status !== 'archived' ? <Button title="В архив" variant="secondary" loading={busy} onPress={() => void save({ status: 'archived' })} /> : null}
        <Button title="Открыть страницу" variant="ghost" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: a.id } })} />
        <Button title="Художник" variant="ghost" onPress={() => router.push({ pathname: '/admin/user/[id]', params: { id: a.artist_id } })} />
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label="Название" value={title} onChangeText={setTitle} maxLength={120} />
        </View>
        <View style={styles.price}>
          <Field label="Цена, ₽" value={price} onChangeText={setPrice} keyboardType="number-pad" />
        </View>
      </View>
      <Button
        title="Сохранить название и цену"
        variant="secondary"
        loading={busy}
        disabled={title === a.title && parseRubles(price) === a.price_kop}
        onPress={() => void save({ title, price_kop: parseRubles(price) ?? a.price_kop })}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  panel: { gap: space.md, padding: space.md, marginVertical: space.sm, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  flex: { flex: 1, minWidth: 220 },
  price: { width: 160 },
}));

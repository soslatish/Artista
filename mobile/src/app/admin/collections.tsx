import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { type AdminCollection, useAdminCollections } from '@/api/admin';
import { del, errorText, fieldErrors, patch, post } from '@/api/client';
import { keys, useCatalogMeta } from '@/api/hooks';
import { AdminRow, AdminScreen, Badge, ChipFilter, ConfirmAction, Empty, Section } from '@/features/admin/ui';
import { formatPrice, parseRubles } from '@/lib/format';
import { Button, Field, Loading, Notice, ToggleRow } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

export default function AdminCollections() {
  const q = useAdminCollections();
  const [editing, setEditing] = useState<AdminCollection | 'new' | null>(null);
  return (
    <AdminScreen title="Подборки" subtitle="Показываются на главной в порядке позиции" actions={editing ? null : <Button title="Новая подборка" icon="add" onPress={() => setEditing('new')} />}>
      {editing === 'new' ? <CollectionForm onDone={() => setEditing(null)} /> : null}
      {q.isLoading ? <Loading /> : null}
      {q.isError && !q.data ? <Notice tone="danger" text={errorText(q.error)} /> : null}
      {q.data && !q.data.length ? <Empty text="Подборок нет." /> : null}
      {q.data?.map((c) =>
        editing !== 'new' && editing?.id === c.id ? (
          <CollectionForm key={c.id} c={c} onDone={() => setEditing(null)} />
        ) : (
          <AdminRow
            key={c.id}
            title={c.title}
            subtitle={c.subtitle || `/collections/${c.slug}`}
            meta={`Позиция ${c.position}, ${c.kind === 'manual' ? `вручную: ${c.artwork_ids?.length ?? 0} работ` : 'по фильтрам'}`}
            badges={<Badge text={c.is_published ? 'Опубликована' : 'Скрыта'} tone={c.is_published ? 'good' : 'neutral'} />}
            onPress={() => setEditing(c)}
          />
        ),
      )}
    </AdminScreen>
  );
}

function CollectionForm({ c, onDone }: { c?: AdminCollection; onDone: () => void }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const meta = useCatalogMeta();
  const f = (c?.filters ?? {}) as Record<string, unknown>;
  const [slug, setSlug] = useState(c?.slug ?? '');
  const [title, setTitle] = useState(c?.title ?? '');
  const [subtitle, setSubtitle] = useState(c?.subtitle ?? '');
  const [position, setPosition] = useState(String(c?.position ?? 10));
  const [published, setPublished] = useState(c?.is_published ?? true);
  const [kind, setKind] = useState<'filter' | 'manual'>(c?.kind ?? 'filter');
  const [category, setCategory] = useState(String(f.category ?? ''));
  const [room, setRoom] = useState(String(f.room ?? ''));
  const [city, setCity] = useState(String(f.city ?? ''));
  const [priceMax, setPriceMax] = useState(f.price_max ? String(Number(f.price_max) / 100) : '');
  const [newArtists, setNewArtists] = useState(Boolean(f.new_artists));
  const [ids, setIds] = useState((c?.artwork_ids ?? []).join('\n'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    const filters: Record<string, unknown> = {};
    if (category) filters.category = category;
    if (room) filters.room = room;
    if (city.trim()) filters.city = city.trim();
    if (parseRubles(priceMax)) filters.price_max = parseRubles(priceMax);
    if (newArtists) filters.new_artists = true;
    const body = {
      slug: slug.trim(),
      title: title.trim(),
      subtitle: subtitle.trim(),
      kind,
      filters: kind === 'filter' ? filters : {},
      position: Number.parseInt(position, 10) || 0,
      is_published: published,
      artwork_ids: kind === 'manual' ? ids.split(/[\s,]+/).filter(Boolean) : [],
    };
    try {
      if (c) await patch(`/admin/collections/${c.id}`, body);
      else await post('/admin/collections', body);
      qc.invalidateQueries({ queryKey: ['admin', 'collections'] });
      qc.invalidateQueries({ queryKey: keys.collections });
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const options = (list: { code: string; label: string }[] | undefined, all: string) => [{ value: '', label: all }, ...(list ?? []).map((o) => ({ value: o.code, label: o.label }))];

  return (
    <View style={styles.form}>
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Field label="Название" value={title} onChangeText={setTitle} maxLength={120} error={errors.title} />
        </View>
        <View style={styles.cell}>
          <Field label="Адрес (латиница)" value={slug} onChangeText={setSlug} autoCapitalize="none" maxLength={64} error={errors.slug} placeholder="for-kitchen" />
        </View>
        <View style={styles.small}>
          <Field label="Позиция" value={position} onChangeText={setPosition} keyboardType="number-pad" />
        </View>
      </View>
      <Field label="Подзаголовок" value={subtitle} onChangeText={setSubtitle} maxLength={160} error={errors.subtitle} />
      <ToggleRow label="Опубликована" value={published} onChange={setPublished} />
      <ChipFilter
        options={[
          { value: 'filter', label: 'По фильтрам' },
          { value: 'manual', label: 'Работы вручную' },
        ]}
        value={kind}
        onChange={(v) => setKind(v as 'filter' | 'manual')}
      />
      {kind === 'filter' ? (
        <Section title="Фильтры">
          <ChipFilter options={options(meta.data?.categories, 'Любая категория')} value={category} onChange={setCategory} />
          <ChipFilter options={options(meta.data?.rooms, 'Любой интерьер')} value={room} onChange={setRoom} />
          <View style={styles.grid}>
            <View style={styles.cell}>
              <Field label="Город художника" value={city} onChangeText={setCity} />
            </View>
            <View style={styles.cell}>
              <Field label="Цена до, ₽" value={priceMax} onChangeText={setPriceMax} keyboardType="number-pad" hint={parseRubles(priceMax) ? formatPrice(parseRubles(priceMax)!) : undefined} />
            </View>
          </View>
          <ToggleRow label="Только новые художники" value={newArtists} onChange={setNewArtists} />
        </Section>
      ) : (
        <Field label="ID работ, по одному в строке" value={ids} onChangeText={setIds} multiline error={errors.artwork_ids} hint="ID видно в адресе страницы работы и в разделе «Работы»" />
      )}
      {error ? <Notice tone="danger" text={error} /> : null}
      <View style={styles.buttons}>
        <Button title="Сохранить" loading={busy} onPress={save} />
        <Button title="Отмена" variant="ghost" onPress={onDone} />
        {c ? <Button title="Открыть" variant="ghost" onPress={() => router.push({ pathname: '/collection/[slug]', params: { slug: c.slug } })} /> : null}
      </View>
      {c ? (
        <ConfirmAction
          title="Удалить подборку"
          variant="danger"
          onConfirm={async () => {
            await del(`/admin/collections/${c.id}`);
            qc.invalidateQueries({ queryKey: ['admin', 'collections'] });
            qc.invalidateQueries({ queryKey: keys.collections });
            onDone();
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  form: { gap: space.md, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexGrow: 1, flexBasis: 220 },
  small: { width: 120 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
}));

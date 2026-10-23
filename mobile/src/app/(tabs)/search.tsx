import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '@/api/client';
import { type CatalogFilters, flatten, useArtworks, useCatalogMeta } from '@/api/hooks';
import type { Option } from '@/api/types';
import { parseRubles } from '@/lib/format';
import { Gallery } from '@/ui/artwork';
import { Button, Chip, EmptyState, ErrorState, Field, T } from '@/ui/primitives';
import { colors, radius, space, type } from '@/ui/theme';

const sorts: Option[] = [
  { code: 'new', label: 'Сначала новые' },
  { code: 'popular', label: 'Популярные' },
  { code: 'price_asc', label: 'Дешевле' },
  { code: 'price_desc', label: 'Дороже' },
];

const sizes: { label: string; value?: number }[] = [
  { label: 'Любой' },
  { label: 'До 40 см', value: 40 },
  { label: 'До 80 см', value: 80 },
  { label: 'До 120 см', value: 120 },
];

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Panel = Omit<CatalogFilters, 'q' | 'feed'>;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Panel>({ sort: 'new' });
  const [open, setOpen] = useState(false);
  const q = useDebounced(text.trim());
  const query = useArtworks({ ...filters, q: q || undefined });
  const items = flatten(query.data);
  const active = Object.entries(filters).filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '').length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.graphite} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Название, художник, техника"
            placeholderTextColor={colors.graphite}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Поиск работ"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Фильтры${active ? `, выбрано ${active}` : ''}`}
          onPress={() => setOpen(true)}
          style={[styles.filterBtn, active > 0 && styles.filterBtnActive]}>
          <Ionicons name="options-outline" size={20} color={active ? colors.onDark : colors.ink} />
          {active ? <T variant="smallStrong" color={colors.onDark}>{active}</T> : null}
        </Pressable>
      </View>
      {query.isError ? (
        <ErrorState text={errorText(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <Gallery
          items={items}
          loading={query.isLoading}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          loadingMore={query.isFetchingNextPage}
          empty={<EmptyState icon="search-outline" title="Ничего не нашлось" text="Попробуйте другой запрос или снимите часть фильтров." />}
        />
      )}
      {open ? <FiltersSheet value={filters} onClose={() => setOpen(false)} onApply={(f) => (setFilters(f), setOpen(false))} /> : null}
    </View>
  );
}

interface SheetProps {
  value: Panel;
  onClose: () => void;
  onApply: (f: Panel) => void;
}

// монтируется при открытии, поэтому черновик инициализируется из текущих фильтров
function FiltersSheet({ value, onClose, onApply }: SheetProps) {
  const { data: meta } = useCatalogMeta();
  const [draft, setDraft] = useState<Panel>(value);
  const [priceMin, setPriceMin] = useState(value.price_min ? String(value.price_min / 100) : '');
  const [priceMax, setPriceMax] = useState(value.price_max ? String(value.price_max / 100) : '');

  const toggle = (key: 'category' | 'style' | 'technique', code: string) =>
    setDraft((d) => ({ ...d, [key]: d[key] === code ? undefined : code }));

  const groups = useMemo(
    () =>
      [
        { key: 'category' as const, title: 'Категория', options: meta?.categories ?? [] },
        { key: 'style' as const, title: 'Стиль', options: meta?.styles ?? [] },
        { key: 'technique' as const, title: 'Техника', options: meta?.techniques ?? [] },
      ] as const,
    [meta],
  );

  const apply = () =>
    onApply({
      ...draft,
      price_min: parseRubles(priceMin) ?? undefined,
      price_max: parseRubles(priceMax) ?? undefined,
      city: draft.city?.trim() || undefined,
    });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <T variant="title">Фильтры</T>
          <Button title="Сбросить" variant="ghost" onPress={() => (setDraft({ sort: 'new' }), setPriceMin(''), setPriceMax(''))} />
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Section title="Сортировка">
            {sorts.map((s) => (
              <Chip key={s.code} label={s.label} selected={draft.sort === s.code} onPress={() => setDraft((d) => ({ ...d, sort: s.code }))} />
            ))}
          </Section>
          {groups.map((g) => (
            <Section key={g.key} title={g.title}>
              {g.options.map((o) => (
                <Chip key={o.code} label={o.label} selected={draft[g.key] === o.code} onPress={() => toggle(g.key, o.code)} />
              ))}
            </Section>
          ))}
          <Section title="Размер по большей стороне">
            {sizes.map((s) => (
              <Chip key={s.label} label={s.label} selected={draft.size_max === s.value} onPress={() => setDraft((d) => ({ ...d, size_max: s.value }))} />
            ))}
          </Section>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Цена от, ₽" value={priceMin} onChangeText={setPriceMin} keyboardType="number-pad" placeholder="3 000" />
            </View>
            <View style={styles.flex}>
              <Field label="до, ₽" value={priceMax} onChangeText={setPriceMax} keyboardType="number-pad" placeholder="500 000" />
            </View>
          </View>
          <Field label="Город художника" value={draft.city ?? ''} onChangeText={(city) => setDraft((d) => ({ ...d, city }))} placeholder="Например, Санкт-Петербург" />
        </ScrollView>
        <View style={styles.sheetFoot}>
          <Button title="Показать работы" onPress={apply} />
          <Button title="Закрыть" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="heading">{title}</T>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  bar: { flexDirection: 'row', gap: space.sm, padding: space.lg, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.control,
    backgroundColor: colors.paper,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  searchInput: { ...type.body, flex: 1, paddingVertical: 10 },
  filterBtn: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  filterBtnActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  sheet: { flex: 1, backgroundColor: colors.wall },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.lg, paddingTop: space.xl },
  sheetBody: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  sheetFoot: { padding: space.lg, gap: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  section: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});

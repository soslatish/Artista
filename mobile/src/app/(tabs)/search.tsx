import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { flatten, useArtworks, useCatalogMeta } from '@/api/hooks';
import type { Option } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { notify } from '@/lib/confirm';
import { fromSavedParam, type Panel, toQuery, toSaved } from '@/lib/filters';
import { parseRubles } from '@/lib/format';
import { requireAuth } from '@/lib/guard';
import { Gallery } from '@/ui/artwork';
import { Button, Chip, EmptyState, ErrorState, Field, T, ToggleRow } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

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

function useDebounced<V>(value: V, ms = 350): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Panel>({ sort: 'new' });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // переход из «Сохранённых поисков»: применяем фильтры один раз на каждое новое значение параметра
  // k — метка нажатия: повторный выбор того же поиска тоже применяет фильтры
  const params = useLocalSearchParams();
  const savedKey = `${String(params.k ?? '')}|${String(params.filters ?? '')}`;
  const [appliedKey, setAppliedKey] = useState('|');
  if (savedKey !== appliedKey) {
    setAppliedKey(savedKey);
    const parsed = fromSavedParam(params.filters);
    if (parsed) {
      setFilters(parsed.panel);
      setText(parsed.q);
    }
  }
  const q = useDebounced(text.trim());
  const query = useArtworks(toQuery(filters, q));
  const items = flatten(query.data);
  const active = Object.entries(filters).filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && !v.length)).length;
  const canSave = active > 0 || q.length > 0;

  const saveSearch = async () => {
    if (!requireAuth(!!user)) return;
    setSaving(true);
    try {
      await post('/me/saved-searches', { title: q || t('Мой поиск'), filters: toSaved(filters, q) });
      notify(t('Поиск сохранён'), t('Пришлём уведомление, когда появится подходящая работа.'));
    } catch (e) {
      notify(t('Не удалось сохранить'), errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.graphite} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('Название, художник, техника')}
            placeholderTextColor={colors.graphite}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel={t('Поиск работ')}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? t('Фильтры, выбрано {n}', { n: active }) : t('Фильтры')}
          onPress={() => setOpen(true)}
          style={[styles.filterBtn, active > 0 && styles.filterBtnActive]}>
          <Ionicons name="options-outline" size={20} color={active ? colors.onDark : colors.ink} />
          {active ? (
            <T variant="smallStrong" color={colors.onDark}>
              {active}
            </T>
          ) : null}
        </Pressable>
      </View>
      {canSave ? (
        <View style={styles.saveRow}>
          <Pressable accessibilityRole="button" onPress={saveSearch} disabled={saving} style={styles.saveBtn}>
            <Ionicons name="notifications-outline" size={16} color={colors.bordeaux} />
            <T variant="smallStrong" color={colors.bordeaux}>
              {t('Сообщать о новых работах по этому поиску')}
            </T>
          </Pressable>
        </View>
      ) : null}
      {query.isError && !query.data ? (
        <ErrorState text={errorText(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <Gallery
          items={items}
          loading={query.isLoading}
          src="search"
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          loadingMore={query.isFetchingNextPage}
          empty={
            <EmptyState
              icon="search-outline"
              title={t('Ничего не нашлось')}
              text={t('Попробуйте другой запрос или снимите часть фильтров.')}
              action={user ? <Button title={t('Мои сохранённые поиски')} variant="ghost" onPress={() => router.push('/saved-searches')} /> : null}
            />
          }
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
  const t = useT();
  const styles = useStyles();
  const { data: meta } = useCatalogMeta();
  const [draft, setDraft] = useState<Panel>(value);
  const [priceMin, setPriceMin] = useState(value.price_min ? String(value.price_min / 100) : '');
  const [priceMax, setPriceMax] = useState(value.price_max ? String(value.price_max / 100) : '');

  const toggle = (key: 'category' | 'style' | 'technique' | 'room', code: string) => setDraft((d) => ({ ...d, [key]: d[key] === code ? undefined : code }));
  const toggleColor = (code: string) =>
    setDraft((d) => {
      const cur = d.colors ?? [];
      return { ...d, colors: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code].slice(0, 5) };
    });

  const groups = useMemo(
    () =>
      [
        { key: 'category' as const, title: 'Категория', options: meta?.categories ?? [] },
        { key: 'room' as const, title: 'Для интерьера', options: meta?.rooms ?? [] },
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
          <T variant="title">{t('Фильтры')}</T>
          <Button title={t('Сбросить')} variant="ghost" onPress={() => (setDraft({ sort: 'new' }), setPriceMin(''), setPriceMax(''))} />
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Section title={t('Сортировка')}>
            {sorts.map((s) => (
              <Chip key={s.code} label={t(s.label)} selected={draft.sort === s.code} onPress={() => setDraft((d) => ({ ...d, sort: s.code }))} />
            ))}
          </Section>
          <Section title={t('Цвет')}>
            {(meta?.colors ?? []).map((c) => (
              <Chip key={c.code} label={t(c.label)} swatch={c.hex} selected={draft.colors?.includes(c.code)} onPress={() => toggleColor(c.code)} />
            ))}
          </Section>
          {groups.map((g) => (
            <Section key={g.key} title={t(g.title)}>
              {g.options.map((o) => (
                <Chip key={o.code} label={t(o.label)} selected={draft[g.key] === o.code} onPress={() => toggle(g.key, o.code)} />
              ))}
            </Section>
          ))}
          <Section title={t('Размер по большей стороне')}>
            {sizes.map((s) => (
              <Chip key={s.label} label={t(s.label)} selected={draft.size_max === s.value} onPress={() => setDraft((d) => ({ ...d, size_max: s.value }))} />
            ))}
          </Section>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label={t('Цена от, ₽')} value={priceMin} onChangeText={setPriceMin} keyboardType="number-pad" placeholder="3 000" />
            </View>
            <View style={styles.flex}>
              <Field label={t('до, ₽')} value={priceMax} onChangeText={setPriceMax} keyboardType="number-pad" placeholder="500 000" />
            </View>
          </View>
          <Field label={t('Город художника')} value={draft.city ?? ''} onChangeText={(city) => setDraft((d) => ({ ...d, city }))} placeholder={t('Например, Санкт-Петербург')} />
          <ToggleRow label={t('Только аукционы')} value={!!draft.auction} onChange={(auction) => setDraft((d) => ({ ...d, auction }))} />
        </ScrollView>
        <View style={styles.sheetFoot}>
          <Button title={t('Показать работы')} onPress={apply} />
          <Button title={t('Закрыть')} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <T variant="heading">{title}</T>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.wall },
  bar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: radius.control,
    backgroundColor: c.paper,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  searchInput: { ...t.body, flex: 1, paddingVertical: 10 },
  filterBtn: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.paper,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  filterBtnActive: { backgroundColor: c.bordeaux, borderColor: c.bordeaux },
  saveRow: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  sheet: { flex: 1, backgroundColor: c.wall },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.lg, paddingTop: space.xl },
  sheetBody: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  sheetFoot: { padding: space.lg, gap: space.xs, borderTopWidth: 1, borderTopColor: c.hairline },
  section: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));

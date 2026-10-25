import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { adminKeys, type PlatformSettings, type SettingsResponse, useAdminSettings } from '@/api/admin';
import { errorText, fieldErrors, put } from '@/api/client';
import { keys } from '@/api/hooks';
import { AdminScreen, Section } from '@/features/admin/ui';
import { formatDateTime, formatPrice, parseRubles } from '@/lib/format';
import { Button, ErrorState, Field, Loading, Notice, T, ToggleRow } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function AdminSettingsScreen() {
  const q = useAdminSettings();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <SettingsForm data={q.data} />;
}

const pct = (bp: number) => String(bp / 100).replace('.', ',');
const bpFrom = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
const rub = (kop: number) => String(kop / 100);

interface Form {
  commission: string;
  premiumPrice: string;
  premiumLimit: string;
  offerMin: string;
  tariffs: { days: string; price: string }[];
  announcement: string;
  registration: boolean;
  offers: boolean;
  auctions: boolean;
  commissions: boolean;
  safeDeals: boolean;
  promotionSales: boolean;
}

function toForm(s: PlatformSettings): Form {
  return {
    commission: pct(s.commission_bp),
    premiumPrice: rub(s.premium_price_kop),
    premiumLimit: rub(s.premium_free_limit_kop),
    offerMin: pct(s.offer_min_share_bp),
    tariffs: s.promotion_tariffs.map((t) => ({ days: String(t.days), price: rub(t.price_kop) })),
    announcement: s.announcement,
    registration: s.registration_open,
    offers: s.offers_enabled,
    auctions: s.auctions_enabled,
    commissions: s.commissions_enabled,
    safeDeals: s.safe_deals,
    promotionSales: s.promotion_sales,
  };
}

function fromForm(f: Form): PlatformSettings {
  return {
    commission_bp: bpFrom(f.commission),
    premium_price_kop: parseRubles(f.premiumPrice) ?? 0,
    premium_free_limit_kop: parseRubles(f.premiumLimit) ?? 0,
    offer_min_share_bp: bpFrom(f.offerMin),
    promotion_tariffs: f.tariffs.filter((t) => t.days.trim()).map((t) => ({ days: Number.parseInt(t.days, 10) || 0, price_kop: parseRubles(t.price) ?? 0 })),
    announcement: f.announcement.trim(),
    registration_open: f.registration,
    offers_enabled: f.offers,
    auctions_enabled: f.auctions,
    commissions_enabled: f.commissions,
    safe_deals: f.safeDeals,
    promotion_sales: f.promotionSales,
  };
}

function SettingsForm({ data }: { data: SettingsResponse }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(data.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => (setForm((f) => ({ ...f, [k]: v })), setSaved(false));
  const setTariff = (i: number, k: 'days' | 'price', v: string) => set('tariffs', form.tariffs.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  const save = async (next: PlatformSettings) => {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const res = await put<SettingsResponse>('/admin/settings', next);
      qc.setQueryData(adminKeys.settings, res);
      qc.invalidateQueries({ queryKey: keys.meta });
      setForm(toForm(res.settings));
      setSaved(true);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminScreen
      title="Настройки платформы"
      subtitle={data.updated_at ? `Изменено ${formatDateTime(data.updated_at)}${data.updated_by ? `, ${data.updated_by}` : ''}` : 'Действуют значения по умолчанию'}>
      <Notice text="Изменения применяются сразу ко всем новым сделкам. Уже созданные заказы и оплаты не пересчитываются." />

      <Section title="Деньги">
        <View style={styles.grid}>
          <View style={styles.cell}>
            <Field label="Комиссия с продажи, %" value={form.commission} onChangeText={(v) => set('commission', v)} keyboardType="decimal-pad" error={errors.commission_bp} hint={`По умолчанию ${pct(data.defaults.commission_bp)}%`} />
          </View>
          <View style={styles.cell}>
            <Field label="Премиум за 30 дней, ₽" value={form.premiumPrice} onChangeText={(v) => set('premiumPrice', v)} keyboardType="number-pad" error={errors.premium_price_kop} hint={`По умолчанию ${formatPrice(data.defaults.premium_price_kop)}`} />
          </View>
          <View style={styles.cell}>
            <Field label="Продажи без комиссии для Премиума, ₽ в месяц" value={form.premiumLimit} onChangeText={(v) => set('premiumLimit', v)} keyboardType="number-pad" error={errors.premium_free_limit_kop} />
          </View>
          <View style={styles.cell}>
            <Field label="Минимальное предложение цены, % от цены" value={form.offerMin} onChangeText={(v) => set('offerMin', v)} keyboardType="decimal-pad" error={errors.offer_min_share_bp} />
          </View>
        </View>
      </Section>

      <Section title="Тарифы продвижения">
        {errors.promotion_tariffs ? <Notice tone="danger" text={errors.promotion_tariffs} /> : null}
        {form.tariffs.map((t, i) => (
          <View key={i} style={styles.tariff}>
            <View style={styles.cell}>
              <Field label="Дней" value={t.days} onChangeText={(v) => setTariff(i, 'days', v)} keyboardType="number-pad" />
            </View>
            <View style={styles.cell}>
              <Field label="Цена, ₽" value={t.price} onChangeText={(v) => setTariff(i, 'price', v)} keyboardType="number-pad" />
            </View>
            <Button title="Убрать" variant="ghost" disabled={form.tariffs.length <= 1} onPress={() => set('tariffs', form.tariffs.filter((_, j) => j !== i))} />
          </View>
        ))}
        {form.tariffs.length < 6 ? <Button title="Добавить тариф" variant="ghost" onPress={() => set('tariffs', [...form.tariffs, { days: '', price: '' }])} /> : null}
      </Section>

      <Section title="Модель заработка">
        <ToggleRow
          label="Безопасная сделка (оплата через Artista)"
          hint="Выключено: покупатель пишет художнику и платит ему напрямую, комиссии нет. Включайте только после договора с платёжным сервисом и юристом."
          value={form.safeDeals}
          onChange={(v) => set('safeDeals', v)}
        />
        <ToggleRow
          label="Платное продвижение отдельных работ"
          hint="Выключено: продвижение в ленте даёт только Премиум."
          value={form.promotionSales}
          onChange={(v) => set('promotionSales', v)}
        />
      </Section>
      <Section title="Функции">
        <ToggleRow label="Регистрация новых пользователей" hint="Выключите, чтобы временно закрыть регистрацию" value={form.registration} onChange={(v) => set('registration', v)} />
        <ToggleRow label="Предложения цены" value={form.offers} onChange={(v) => set('offers', v)} />
        <ToggleRow label="Аукционы" hint="Запуск новых аукционов и ставки" value={form.auctions} onChange={(v) => set('auctions', v)} />
        <ToggleRow label="Работы на заказ" hint="Новые запросы художникам" value={form.commissions} onChange={(v) => set('commissions', v)} />
      </Section>

      <Section title="Объявление в приложении">
        <T variant="small">Показывается всем на главной. Оставьте пустым, чтобы убрать.</T>
        <Field label="Текст объявления" value={form.announcement} onChangeText={(v) => set('announcement', v)} multiline maxLength={300} error={errors.announcement} />
      </Section>

      {error ? <Notice tone="danger" text={error} /> : null}
      {saved ? <Notice tone="success" text="Сохранено. Новые условия уже действуют." /> : null}
      <View style={styles.buttons}>
        <Button title="Сохранить" loading={busy} onPress={() => void save(fromForm(form))} />
        <Button title="Вернуть значения по умолчанию" variant="ghost" onPress={() => setForm(toForm(data.defaults))} />
      </View>
    </AdminScreen>
  );
}

const useStyles = makeStyles(() => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexGrow: 1, flexBasis: 240 },
  tariff: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
}));

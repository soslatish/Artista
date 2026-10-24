import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { keys, useArtwork } from '@/api/hooks';
import type { Auction } from '@/api/types';
import { useT } from '@/i18n';
import { formatPrice, parseRubles } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, Chip, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

const durations = [1, 3, 5, 7];

export default function NewAuctionRoute() {
  const id = validId(useLocalSearchParams().artworkId);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <NewAuction artworkId={id} />;
}

function NewAuction({ artworkId }: { artworkId: string }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const art = useArtwork(artworkId);
  const [start, setStart] = useState('');
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (art.isLoading) return <Loading />;
  if (art.isError || !art.data) return <ErrorState text={errorText(art.error)} />;
  const a = art.data;
  const kop = parseRubles(start);

  const submit = async () => {
    if (!kop) return;
    setBusy(true);
    setError('');
    try {
      const au = await post<Auction>(`/artworks/${a.id}/auction`, { start_kop: kop, days });
      qc.invalidateQueries({ queryKey: keys.artwork(a.id) });
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['my-artworks'] });
      router.replace({ pathname: '/auction/[id]', params: { id: au.id } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <T variant="artTitle">{a.title}</T>
        <T variant="body">{t('Подписчики получат уведомление о начале торгов. Шаг ставки — 5% от стартовой цены. Победитель оформляет заказ в течение 48 часов.')}</T>
        <Field label={t('Стартовая цена, ₽')} value={start} onChangeText={setStart} keyboardType="number-pad" placeholder={String(Math.round((a.price_kop * 0.7) / 100))} hint={t('Обычная цена работы — {p}', { p: formatPrice(a.price_kop) })} />
        <T variant="heading">{t('Длительность')}</T>
        <View style={styles.chips}>
          {durations.map((d) => (
            <Chip key={d} label={t('{n} дн.', { n: d })} selected={days === d} onPress={() => setDays(d)} />
          ))}
        </View>
        <Notice text={t('Пока нет ставок, аукцион можно отменить. После первой ставки — нет.')} />
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Начать аукцион')} loading={busy} disabled={!kop} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));

import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { useArtwork, useCatalogMeta } from '@/api/hooks';
import type { Offer } from '@/api/types';
import { useT } from '@/i18n';
import { formatPrice, parseRubles } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, Chip, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function NewOfferRoute() {
  const id = validId(useLocalSearchParams().artworkId);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <NewOffer artworkId={id} />;
}

function NewOffer({ artworkId }: { artworkId: string }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const art = useArtwork(artworkId);
  const { data: meta } = useCatalogMeta();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (art.isLoading) return <Loading />;
  if (art.isError || !art.data) return <ErrorState text={errorText(art.error)} />;
  const a = art.data;
  const shareBp = meta?.offer_min_share_bp ?? 5000;
  const min = Math.max(3_000_00, Math.ceil((a.price_kop * shareBp) / 10000 / 100) * 100);
  const kop = parseRubles(amount);
  const quick = [0.9, 0.85, 0.8].map((k) => Math.round((a.price_kop * k) / 100_00) * 100_00).filter((v) => v >= min && v < a.price_kop);

  const submit = async () => {
    if (!kop) return;
    setBusy(true);
    setError('');
    try {
      const o = await post<Offer>(`/artworks/${a.id}/offers`, { amount_kop: kop, message: message.trim() });
      qc.invalidateQueries({ queryKey: ['offers'] });
      router.replace({ pathname: '/offers/[id]', params: { id: o.id } });
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
        <T variant="body">{t('Цена художника — {p}. Предложение — от {min}. Художник ответит в течение 48 часов.', { p: formatPrice(a.price_kop), min: formatPrice(min) })}</T>
        {quick.length ? (
          <View style={styles.chips}>
            {quick.map((v) => (
              <Chip key={v} label={formatPrice(v)} selected={kop === v} onPress={() => setAmount(String(v / 100))} />
            ))}
          </View>
        ) : null}
        <Field label={t('Ваша цена, ₽')} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder={String(min / 100)} />
        <Field label={t('Сообщение художнику')} value={message} onChangeText={setMessage} multiline maxLength={500} placeholder={t('Например, когда сможете забрать или почему работа вам дорога')} />
        <Notice text={t('Если художник согласится, цена закрепится за вами на 24 часа — останется оформить заказ.')} />
        {error ? <Notice tone="danger" text={error} /> : null}
        <Button title={t('Отправить предложение')} loading={busy} disabled={!kop || kop < min || kop >= a.price_kop} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));

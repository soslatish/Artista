import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { errorText, fieldErrors, post } from '@/api/client';
import { keys, useCatalogMeta, useCertificate } from '@/api/hooks';
import type { Certificate } from '@/api/types';
import { shareCertificatePdf } from '@/features/certificate-pdf';
import { shareLink } from '@/features/share';
import { useT } from '@/i18n';
import { confirmAction, notify } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { labelOf } from '@/ui/artwork';
import { Button, Divider, ErrorState, Field, Line, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const codePattern = /^ART-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export default function CertificateRoute() {
  const raw = useLocalSearchParams().code;
  const t = useT();
  const code = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (!codePattern.test(code)) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <CertificateScreen code={code} />;
}

function CertificateScreen({ code }: { code: string }) {
  const t = useT();
  const q = useCertificate(code);
  const meta = useCatalogMeta();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  // сервер отдаёт код техники — показываем (и печатаем в PDF) её название
  const technique = t(labelOf(meta.data, 'techniques', q.data.artwork.technique)) || q.data.artwork.technique;
  return <CertificateView c={{ ...q.data, artwork: { ...q.data.artwork, technique } }} />;
}

function CertificateView({ c }: { c: Certificate }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const [pdfBusy, setPdfBusy] = useState(false);
  const a = c.artwork;
  const size = [a.width_cm, a.height_cm, a.depth_cm].filter((x) => x > 0).join(' × ');
  const active = c.status === 'active';

  const pdf = async () => {
    setPdfBusy(true);
    try {
      await shareCertificatePdf(c, t);
    } catch (e) {
      notify(t('Не удалось создать PDF'), errorText(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={styles.sheet}>
          <T variant="smallStrong" color={colors.bordeaux}>
            {t('Сертификат подлинности')}
          </T>
          <T variant="display">«{a.title}»</T>
          {a.image_url ? <Image source={{ uri: a.image_url }} style={styles.art} contentFit="contain" /> : null}
          {active ? <Notice tone="success" text={t('Действителен. Работа продана через Artista, подлинность подтверждена художником.')} /> : <Notice tone="danger" text={t('Недействителен: работа передана новому владельцу.')} />}
          <View>
            <Line label={t('Художник')} value={c.artist.name} />
            {a.year ? <Line label={t('Год')} value={String(a.year)} /> : null}
            {a.technique || a.materials ? <Line label={t('Техника')} value={[a.technique, a.materials].filter(Boolean).join(', ')} /> : null}
            {size ? <Line label={t('Размер')} value={`${size} ${t('см')}`} /> : null}
            <Line label={t('Владелец')} value={c.owner} />
            <Line label={t('Выдан')} value={formatDate(c.issued_at)} />
          </View>
          <View style={styles.codeRow}>
            <View style={styles.flex}>
              <T variant="title" selectable>
                {c.code}
              </T>
              <T variant="small">{t('Отсканируйте QR, чтобы проверить подлинность на сайте.')}</T>
            </View>
            {c.qr_png ? <Image source={{ uri: c.qr_png }} style={styles.qr} contentFit="contain" accessibilityLabel={t('QR-код для проверки')} /> : null}
          </View>
        </View>

        <Button title={t('Открыть работу')} variant="secondary" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: a.id } })} />
        {c.is_mine ? <Button title={t('Скачать PDF')} icon="document-outline" loading={pdfBusy} onPress={pdf} /> : null}
        <Button title={t('Поделиться ссылкой')} variant="ghost" icon="share-outline" onPress={() => void shareLink(`/c/${c.code}`, t('Сертификат подлинности «{title}»', { title: a.title }))} />

        {c.history && c.history.length > 1 ? (
          <View style={styles.block}>
            <T variant="heading">{t('История владения')}</T>
            {c.history.map((h, i) => (
              <Line key={`${h.issued_at}-${i}`} label={formatDate(h.issued_at)} value={h.owner} />
            ))}
          </View>
        ) : null}

        {c.is_mine && active ? <Transfer c={c} /> : null}
      </ScrollView>
    </View>
  );
}

function Transfer({ c }: { c: Certificate }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const transfer = () =>
    confirmAction(t('Передать сертификат?'), t('Текущий сертификат станет недействительным, новому владельцу выпустим свой. Отменить это нельзя.'), async () => {
      setBusy(true);
      setError('');
      try {
        const res = await post<{ code: string }>(`/certificates/${c.code}/transfer`, { email: email.trim() });
        qc.invalidateQueries({ queryKey: keys.certificates });
        qc.invalidateQueries({ queryKey: keys.certificate(c.code) });
        notify(t('Сертификат передан'), t('Новый код: {code}', { code: res.code }));
      } catch (e) {
        setError(fieldErrors(e).email ?? errorText(e));
      } finally {
        setBusy(false);
      }
    }, { destructive: true });

  return (
    <View style={styles.block}>
      <Divider />
      <T variant="heading">{t('Продали или подарили работу?')}</T>
      <T variant="small">{t('Передайте сертификат новому владельцу — у него должен быть аккаунт в Artista.')}</T>
      <Field label={t('E-mail нового владельца')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={error} />
      <Button title={t('Передать')} variant="secondary" loading={busy} disabled={!email.includes('@')} onPress={transfer} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  sheet: { gap: space.md, padding: space.lg, borderRadius: radius.control, borderWidth: 1.5, borderColor: c.brand, backgroundColor: c.paper, marginBottom: space.md },
  art: { width: '100%', height: 260, backgroundColor: c.plaster, borderRadius: radius.art },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 4 },
  qr: { width: 96, height: 96, backgroundColor: '#FFFFFF' },
  block: { gap: space.md, marginTop: space.md },
}));

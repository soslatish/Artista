import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { Certificate } from '@/api/types';
import { formatDate } from '@/lib/format';

type Translate = (s: string, vars?: Record<string, string | number>) => string;

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => entities[ch]);
}

/** Разрешаем в PDF только картинки по https и QR из data:image/png. */
function safeImage(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('data:image/png;base64,')) return escapeHtml(url);
  return '';
}

/** HTML листа A4 «Сертификат подлинности» — то же, что видно в приложении и на сайте. */
export function buildCertificateHtml(c: Certificate, t: Translate): string {
  const a = c.artwork;
  const size = [a.width_cm, a.height_cm, a.depth_cm].filter((x) => x > 0).join(' × ');
  const rows: [string, string][] = [
    [t('Художник'), c.artist.name],
    [t('Год'), a.year ? String(a.year) : '—'],
    [t('Техника'), [a.technique, a.materials].filter(Boolean).join(', ') || '—'],
    [t('Размер'), size ? `${size} ${t('см')}` : '—'],
    [t('Владелец'), c.owner],
    [t('Выдан'), formatDate(c.issued_at)],
  ];
  const image = safeImage(a.image_url);
  const qr = safeImage(c.qr_png);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1E1A1B; }
  .frame { border: 1.5pt solid #622D32; padding: 14mm; min-height: 240mm; box-sizing: border-box; }
  .brand { font-size: 11pt; letter-spacing: 0.08em; color: #622D32; }
  h1 { font-size: 26pt; font-weight: normal; margin: 6mm 0 2mm; }
  h2 { font-size: 18pt; font-weight: normal; font-style: italic; margin: 0 0 8mm; }
  .art { width: 100%; max-height: 95mm; object-fit: contain; margin-bottom: 8mm; }
  table { border-collapse: collapse; width: 100%; font-size: 11pt; }
  td { padding: 2mm 0; border-bottom: 0.5pt solid #D9D2CC; vertical-align: top; }
  td:first-child { color: #6E6567; width: 35%; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10mm; font-size: 10pt; }
  .code { font-family: 'Courier New', monospace; font-size: 14pt; letter-spacing: 0.06em; }
  .qr { width: 32mm; height: 32mm; }
  .void { color: #A33A2E; font-size: 12pt; margin-bottom: 4mm; }
</style></head><body><div class="frame">
  <div class="brand">ARTISTA</div>
  <h1>${escapeHtml(t('Сертификат подлинности'))}</h1>
  <h2>«${escapeHtml(a.title)}»</h2>
  ${c.status === 'transferred' ? `<div class="void">${escapeHtml(t('Недействителен: работа передана новому владельцу'))}</div>` : ''}
  ${image ? `<img class="art" src="${image}" />` : ''}
  <table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
  <div class="foot">
    <div><div class="code">${escapeHtml(c.code)}</div><div>${escapeHtml(t('Проверить подлинность: {url}', { url: c.verify_url }))}</div></div>
    ${qr ? `<img class="qr" src="${qr}" />` : ''}
  </div>
</div></body></html>`;
}

/** Сохраняет сертификат в PDF и открывает «Поделиться»; в браузере — диалог печати. */
export async function shareCertificatePdf(c: Certificate, t: Translate): Promise<void> {
  const html = buildCertificateHtml(c, t);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: c.code });
  } else {
    await Print.printAsync({ uri });
  }
}

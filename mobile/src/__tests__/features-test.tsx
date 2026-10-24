import { render, screen } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Text } from 'react-native';

import type { Certificate, Commission, Offer } from '@/api/types';
import { buildCertificateHtml, escapeHtml, shareCertificatePdf } from '@/features/certificate-pdf';
import { commissionNeedsAction, commissionStatusLabel, commissionTone } from '@/features/commission-status';
import { offerNeedsAction, offerStatusLabel, offerTone } from '@/features/offer-status';
import { light, makeStyles, ThemeProvider, useTheme } from '@/ui/theme';

const id = (s: string, vars?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));

const cert: Certificate = {
  code: 'ART-AB12-CD34',
  status: 'active',
  issued_at: '2026-10-20T10:00:00Z',
  artwork: { id: 'a1', title: 'Сад <script>alert(1)</script>', image_url: 'javascript:alert(1)', category: 'painting', technique: 'Масло', materials: 'холст', width_cm: 60, height_cm: 80, depth_cm: 0, year: 2025 },
  artist: { id: 'u1', name: 'Анна "А" Петрова', avatar_url: '' },
  owner: 'Иван И.',
  is_mine: true,
  verify_url: 'https://artista.example/c/ART-AB12-CD34',
  qr_png: 'data:image/png;base64,AAAA',
};

describe('certificate PDF', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('renders the certificate without unsafe content', () => {
    const html = buildCertificateHtml(cert, id);
    expect(html).toContain('ART-AB12-CD34');
    expect(html).toContain('Сад &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('60 × 80 см');
    expect(html).not.toContain('Недействителен');
  });

  it('marks a transferred certificate as void', () => {
    const html = buildCertificateHtml({ ...cert, status: 'transferred', qr_png: undefined, artwork: { ...cert.artwork, image_url: 'https://x/a.jpg', year: null, width_cm: 0, height_cm: 0 } }, id);
    expect(html).toContain('Недействителен');
    expect(html).toContain('<img class="art" src="https://x/a.jpg" />');
    expect(html).not.toContain('class="qr"');
  });

  it('saves a PDF and opens the share sheet', async () => {
    await shareCertificatePdf(cert, id);
    expect(Print.printToFileAsync).toHaveBeenCalled();
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/cert.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
  });

  it('falls back to printing when sharing is unavailable', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await shareCertificatePdf(cert, id);
    expect(Print.printAsync).toHaveBeenCalledWith({ uri: 'file:///tmp/cert.pdf' });
  });
});

const commission = (status: Commission['status'], my_role: Commission['my_role']) => ({ status, my_role }) as Commission;

describe('commission status', () => {
  it.each([
    ['requested', 'artist', 'Ждёт вашего ответа', true],
    ['requested', 'buyer', 'Ждёт ответа художника', false],
    ['quoted', 'buyer', 'Художник назвал цену', true],
    ['quoted', 'artist', 'Цена отправлена', false],
    ['accepted', 'buyer', 'Принят, создан заказ', false],
    ['declined', 'buyer', 'Отклонён', false],
    ['cancelled', 'artist', 'Отменён', false],
    ['expired', 'artist', 'Истёк срок', false],
  ] as const)('%s for %s', (status, role, label, needs) => {
    const c = commission(status, role);
    expect(commissionStatusLabel(c, id)).toBe(label);
    expect(commissionNeedsAction(c)).toBe(needs);
  });

  it('colours by outcome', () => {
    expect(commissionTone(commission('accepted', 'buyer'), light)).toBe(light.success);
    expect(commissionTone(commission('expired', 'buyer'), light)).toBe(light.graphite);
    expect(commissionTone(commission('quoted', 'buyer'), light)).toBe(light.bordeaux);
  });
});

const offer = (status: Offer['status'], my_role: Offer['my_role']) => ({ status, my_role }) as Offer;

describe('offer status', () => {
  it('labels depend on the role', () => {
    expect(offerStatusLabel(offer('pending', 'artist'), id)).toBe('Ждёт вашего ответа');
    expect(offerStatusLabel(offer('pending', 'buyer'), id)).toBe('Ждёт ответа художника');
    expect(offerStatusLabel(offer('countered', 'artist'), id)).toBe('Ждём ответа покупателя');
    expect(offerStatusLabel(offer('countered', 'buyer'), id)).toBe('Встречная цена');
  });

  it('flags offers that need a reply', () => {
    expect(offerNeedsAction(offer('pending', 'artist'))).toBe(true);
    expect(offerNeedsAction(offer('pending', 'buyer'))).toBe(false);
    expect(offerNeedsAction(offer('countered', 'buyer'))).toBe(true);
    expect(typeof offerTone(offer('accepted', 'buyer'), light)).toBe('string');
  });
});

const useProbeStyles = makeStyles((c) => ({ box: { backgroundColor: c.wall } }));

function Probe() {
  const styles = useProbeStyles();
  const { scheme } = useTheme();
  return <Text style={styles.box}>{scheme}</Text>;
}

describe('theme', () => {
  it('builds styles for the chosen theme', async () => {
    await render(
      <ThemeProvider initial="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('dark')).toBeTruthy();
    await render(
      <ThemeProvider initial="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('light')).toBeTruthy();
  });
});

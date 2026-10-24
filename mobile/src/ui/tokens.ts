// Дизайн-токены Artista. Палитра взята из логотипа: бордо + золото мазка,
// поверх — нейтральная «стена галереи», чтобы цвет давали сами работы.
// Две темы: светлая (дневная галерея) и тёмная (галерея вечером).

export interface Palette {
  /** Бордо логотипа — фон шапки и экранов с логотипом (одинаков в обеих темах). */
  brand: string;
  bordeaux: string;
  bordeauxDeep: string;
  bordeauxSoft: string;
  gold: string;
  goldSoft: string;
  wall: string;
  plaster: string;
  paper: string;
  ink: string;
  graphite: string;
  hairline: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  onDark: string;
  onDarkMuted: string;
  overlay: string;
}

export const light: Palette = {
  brand: '#622D32',
  bordeaux: '#622D32',
  bordeauxDeep: '#4A2025',
  bordeauxSoft: '#F1E4E5',
  gold: '#C9A24B',
  goldSoft: '#F4ECD8',
  wall: '#FAFAF7',
  plaster: '#ECE8E3',
  paper: '#FFFFFF',
  ink: '#1E1A1B',
  graphite: '#6E6668',
  hairline: '#D9D3CE',
  success: '#3F6B4C',
  successSoft: '#E3EEE6',
  danger: '#A23B2C',
  dangerSoft: '#F6E3DF',
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.72)',
  overlay: 'rgba(30,26,27,0.78)',
};

export const dark: Palette = {
  brand: '#622D32',
  bordeaux: '#B25E65', // светлее, чтобы читаться на тёмной стене и держать контраст с белым текстом
  bordeauxDeep: '#7A3A40',
  bordeauxSoft: '#3A2629',
  gold: '#D4AF5C',
  goldSoft: '#3A3221',
  wall: '#1B1819',
  plaster: '#2A2627',
  paper: '#242021',
  ink: '#EEE9E4',
  graphite: '#A59C9E',
  hairline: '#3E3739',
  success: '#86B794',
  successSoft: '#1F3326',
  danger: '#E58A7B',
  dangerSoft: '#3D2420',
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.72)',
  overlay: 'rgba(0,0,0,0.72)',
};

export const fonts = {
  logo: 'GreatVibes_400Regular',
  serif: 'CormorantGaramond_600SemiBold',
  serifItalic: 'CormorantGaramond_600SemiBold_Italic',
  serifMediumItalic: 'CormorantGaramond_500Medium_Italic',
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemi: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
} as const;

/** Шкала 13 / 15 / 17 / 21 / 26 / 34 */
export function makeType(c: Palette) {
  return {
    display: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: c.ink },
    title: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 30, color: c.ink },
    artTitle: { fontFamily: fonts.serifItalic, fontSize: 21, lineHeight: 24, color: c.ink },
    artTitleSmall: { fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 20, color: c.ink },
    heading: { fontFamily: fonts.sansBold, fontSize: 17, lineHeight: 22, color: c.ink },
    body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: c.ink },
    bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 22, color: c.ink },
    small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: c.graphite },
    smallStrong: { fontFamily: fonts.sansSemi, fontSize: 13, lineHeight: 18, color: c.ink },
    price: { fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 20, color: c.ink },
    priceLarge: { fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 30, color: c.ink },
  } as const;
}

export type TypeScale = ReturnType<typeof makeType>;
export type TypeVariant = keyof TypeScale;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = {
  art: 2, // работы — почти без скругления, это прямоугольник картины
  control: 10,
  sheet: 20,
  pill: 999,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;

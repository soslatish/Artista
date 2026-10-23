// Дизайн-токены Artista. Палитра взята из логотипа: бордо + золото мазка,
// поверх — нейтральная «стена галереи», чтобы цвет давали сами работы.

export const colors = {
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
} as const;

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
export const type = {
  display: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: colors.ink },
  title: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 30, color: colors.ink },
  artTitle: { fontFamily: fonts.serifItalic, fontSize: 21, lineHeight: 24, color: colors.ink },
  artTitleSmall: { fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 20, color: colors.ink },
  heading: { fontFamily: fonts.sansBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.ink },
  bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 22, color: colors.ink },
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: colors.graphite },
  smallStrong: { fontFamily: fonts.sansSemi, fontSize: 13, lineHeight: 18, color: colors.ink },
  price: { fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 20, color: colors.ink },
} as const;

export type TypeVariant = keyof typeof type;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = {
  art: 2, // работы — почти без скругления, это прямоугольник картины
  control: 10,
  sheet: 20,
  pill: 999,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;

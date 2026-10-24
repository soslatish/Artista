import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { en } from '@/i18n/en';
import { I18nProvider, pluralForm, translate, useLocale, useT } from '@/i18n';
import { daysFromNowAt, formatDateInput, formatTimeInput, parseLocalDateTime } from '@/lib/datetime-input';

describe('translate', () => {
  it('returns Russian as is and English from the dictionary', () => {
    expect(translate('ru', 'Войти')).toBe('Войти');
    expect(translate('en', 'Войти')).toBe('Sign in');
  });

  it('falls back to Russian and fills params', () => {
    expect(translate('en', 'Строка без перевода {n}', { n: 2 })).toBe('Строка без перевода 2');
    expect(translate('en', 'Активные заказы: {n}', { n: 3 })).toBe('Active orders: 3');
    expect(translate('ru', 'Осталось {x}', {})).toBe('Осталось {x}');
  });

  it('keeps the same placeholders in every English string', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const broken = Object.entries(en).filter(([ru, eng]) => placeholders(ru) !== placeholders(eng));
    expect(broken).toEqual([]);
  });
});

describe('pluralForm', () => {
  it.each([
    [1, 'работа'],
    [3, 'работы'],
    [5, 'работ'],
    [11, 'работ'],
    [21, 'работа'],
    [24, 'работы'],
  ])('ru %d → %s', (n, form) => expect(pluralForm('ru', n, ['работа', 'работы', 'работ'])).toBe(form));

  it('uses English forms', () => {
    expect(pluralForm('en', 1, ['работа', 'работы', 'работ'])).toBe('work');
    expect(pluralForm('en', 4, ['работа', 'работы', 'работ'])).toBe('works');
    expect(pluralForm('en', 2, ['день', 'дня', 'дней'], ['day', 'days'])).toBe('days');
  });
});

function Probe() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <Text accessibilityRole="button" onPress={() => setLocale(locale === 'ru' ? 'en' : 'ru')}>
      {t('Войти')}
    </Text>
  );
}

it('re-renders screens when the language changes', async () => {
  const onChange = jest.fn();
  await render(
    <I18nProvider initial="ru" onChange={onChange}>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText('Войти')).toBeTruthy();
  await act(async () => screen.getByRole('button').props.onPress());
  expect(screen.getByText('Sign in')).toBeTruthy();
  expect(onChange).toHaveBeenCalledWith('en');
});

describe('date and time input', () => {
  it('parses local date and time', () => {
    expect(parseLocalDateTime('05.11.2026', '19:30')).toEqual(new Date(2026, 10, 5, 19, 30));
    expect(parseLocalDateTime(' 5.1.2027 ', '9:05')).toEqual(new Date(2027, 0, 5, 9, 5));
  });

  it.each([
    ['31.02.2026', '10:00'],
    ['01.13.2026', '10:00'],
    ['01.01.2026', '24:00'],
    ['01.01.2026', '10:60'],
    ['2026-01-01', '10:00'],
    ['01.01.2026', ''],
  ])('rejects %s %s', (d, tm) => expect(parseLocalDateTime(d, tm)).toBeNull());

  it('formats inputs and builds presets', () => {
    const d = new Date(2026, 0, 2, 7, 5);
    expect(formatDateInput(d)).toBe('02.01.2026');
    expect(formatTimeInput(d)).toBe('07:05');
    expect(daysFromNowAt(7, 19, new Date(2026, 9, 28, 23, 59))).toEqual(new Date(2026, 10, 4, 19, 0));
  });
});

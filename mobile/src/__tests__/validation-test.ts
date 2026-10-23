import { requireAuth, validId } from '@/lib/guard';
import { type ArtworkForm, emptyArtworkForm, validateAddress, validateArtworkForm, validateRegistration } from '@/lib/validation';
import { router } from 'expo-router';

const valid: ArtworkForm = {
  ...emptyArtworkForm,
  title: 'Белые ночи',
  category: 'painting',
  width: '60',
  height: '80,5',
  year: '2024',
  price: '25 000',
  images: ['https://api/files/a.jpg'],
};

describe('validateArtworkForm', () => {
  it('builds payload in kopecks and centimeters', () => {
    const { errors, payload } = validateArtworkForm(valid, true, 2026);
    expect(errors).toEqual({});
    expect(payload).toMatchObject({ title: 'Белые ночи', width_cm: 60, height_cm: 80.5, depth_cm: 0, year: 2024, price_kop: 2_500_000 });
  });

  it.each([
    ['title', { title: 'A' }],
    ['category', { category: '' }],
    ['width_cm', { width: '0' }],
    ['height_cm', { height: 'abc' }],
    ['depth_cm', { depth: '-1' }],
    ['year', { year: '2099' }],
    ['price', { price: '100' }],
    ['price', { price: '600000' }],
    ['images', { images: Array.from({ length: 11 }, (_, i) => `u${i}`) }],
  ])('flags %s', (field, patch) => {
    const { errors, payload } = validateArtworkForm({ ...valid, ...patch } as ArtworkForm, false, 2026);
    expect(errors[field]).toBeTruthy();
    expect(payload).toBeNull();
  });

  it('requires photos only for publishing', () => {
    expect(validateArtworkForm({ ...valid, images: [] }, false, 2026).payload).not.toBeNull();
    expect(validateArtworkForm({ ...valid, images: [] }, true, 2026).errors.images).toBeTruthy();
  });

  it('empty year becomes null', () => {
    expect(validateArtworkForm({ ...valid, year: '' }, true, 2026).payload?.year).toBeNull();
  });
});

describe('validateRegistration', () => {
  it('accepts valid data', () => {
    expect(validateRegistration({ email: 'a@b.ru', password: 'secret123', name: 'Анна' })).toEqual({});
  });
  it('reports every problem', () => {
    const e = validateRegistration({ email: 'nope', password: '123', name: ' ' });
    expect(Object.keys(e).sort()).toEqual(['email', 'name', 'password']);
    expect(validateRegistration({ email: 'a@b.ru', password: 'x'.repeat(73), name: 'A' }).password).toBeTruthy();
  });
});

describe('validateAddress', () => {
  const ok = { city: 'Москва', street: 'Тверская, 1, кв. 5', postal_code: '125009', recipient_name: 'Иван', phone: '+7 900 123-45-67', comment: '' };
  it('accepts valid address', () => expect(validateAddress(ok)).toEqual({}));
  it('flags phone, index and street', () => {
    const e = validateAddress({ ...ok, phone: '123', postal_code: '12', street: 'x' });
    expect(Object.keys(e).sort()).toEqual(['address.phone', 'address.postal_code', 'address.street']);
  });
});

describe('guards', () => {
  it('validId accepts only UUIDs', () => {
    expect(validId('1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(validId('../../etc')).toBeNull();
    expect(validId(['a'])).toBeNull();
    expect(validId(undefined)).toBeNull();
  });
  it('requireAuth sends guests to login', () => {
    expect(requireAuth(true)).toBe(true);
    expect(requireAuth(false)).toBe(false);
    expect(router.push).toHaveBeenCalledWith('/login');
  });
});

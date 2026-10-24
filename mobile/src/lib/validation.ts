// Клиентская валидация форм (сервер проверяет всё повторно).
import { t } from '@/i18n';

import { parseRubles } from './format';

export function validateRegistration(v: { email: string; password: string; name: string }): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errs.email = t('Проверьте e-mail');
  if (v.password.length < 8) errs.password = t('Минимум 8 символов');
  if (v.password.length > 72) errs.password = t('Не длиннее 72 символов');
  if (!v.name.trim()) errs.name = t('Как к вам обращаться?');
  return errs;
}

export interface ArtworkForm {
  title: string;
  description: string;
  category: string;
  style: string;
  technique: string;
  materials: string;
  width: string;
  height: string;
  depth: string;
  year: string;
  price: string;
  images: string[];
  rooms: string[];
  allowOffers: boolean;
  seriesId: string;
}

export const emptyArtworkForm: ArtworkForm = {
  title: '',
  description: '',
  category: '',
  style: '',
  technique: '',
  materials: '',
  width: '',
  height: '',
  depth: '',
  year: '',
  price: '',
  images: [],
  rooms: [],
  allowOffers: false,
  seriesId: '',
};

function num(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ArtworkPayload {
  title: string;
  description: string;
  category: string;
  style: string;
  technique: string;
  materials: string;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  year: number | null;
  price_kop: number;
  images: string[];
  rooms: string[];
  allow_offers: boolean;
  series_id: string | null;
}

/** Проверяет форму работы и собирает тело запроса. */
export function validateArtworkForm(
  f: ArtworkForm,
  publish: boolean,
  currentYear = new Date().getFullYear(),
): { errors: Record<string, string>; payload: ArtworkPayload | null } {
  const errors: Record<string, string> = {};
  const title = f.title.trim();
  if (title.length < 2 || title.length > 120) errors.title = t('От 2 до 120 символов');
  if (!f.category) errors.category = t('Выберите категорию');
  const width = num(f.width);
  const height = num(f.height);
  const depth = num(f.depth) ?? 0;
  if (width === null || width <= 0 || width > 1000) errors.width_cm = t('Ширина в сантиметрах');
  if (height === null || height <= 0 || height > 1000) errors.height_cm = t('Высота в сантиметрах');
  if (depth < 0 || depth > 1000) errors.depth_cm = t('Глубина от 0 до 1000 см');
  const year = num(f.year);
  if (f.year.trim() && (year === null || !Number.isInteger(year) || year < 1000 || year > currentYear)) errors.year = t('Год создания');
  const price = parseRubles(f.price);
  if (price === null || price < 3_000_00 || price > 500_000_00) errors.price = t('От 3 000 до 500 000 ₽');
  if (f.images.length > 10) errors.images = t('Не больше 10 фото');
  else if (publish && f.images.length === 0) errors.images = t('Добавьте хотя бы одно фото');
  if (Object.keys(errors).length) return { errors, payload: null };
  return {
    errors,
    payload: {
      title,
      description: f.description.trim(),
      category: f.category,
      style: f.style,
      technique: f.technique,
      materials: f.materials.trim(),
      width_cm: width as number,
      height_cm: height as number,
      depth_cm: depth,
      year: f.year.trim() ? (year as number) : null,
      price_kop: price as number,
      images: f.images,
      rooms: f.rooms,
      allow_offers: f.allowOffers,
      series_id: f.seriesId || null,
    },
  };
}

export interface AddressForm {
  city: string;
  street: string;
  postal_code: string;
  recipient_name: string;
  phone: string;
  comment: string;
}

export function validateAddress(a: AddressForm): Record<string, string> {
  const errs: Record<string, string> = {};
  if (a.city.trim().length < 2) errs['address.city'] = t('Укажите город');
  if (a.street.trim().length < 5) errs['address.street'] = t('Улица, дом, квартира');
  if (a.recipient_name.trim().length < 2) errs['address.recipient_name'] = t('Кто получит посылку');
  const digits = a.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) errs['address.phone'] = t('Телефон для курьера');
  if (a.postal_code && !/^\d{6}$/.test(a.postal_code)) errs['address.postal_code'] = t('Индекс — 6 цифр');
  return errs;
}

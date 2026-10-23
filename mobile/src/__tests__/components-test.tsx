import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import type { Artwork, Order } from '@/api/types';
import { StatusTimeline, orderStatusLabel } from '@/features/order-status';
import { ArtworkCard, labelOf, previewAspect, statusLabel } from '@/ui/artwork';
import { Avatar, Button, Chip, EmptyState, ErrorState, Field, Notice } from '@/ui/primitives';

async function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const artwork: Artwork = {
  id: 'a1',
  title: 'Белые ночи',
  description: '',
  category: 'painting',
  style: 'impressionism',
  technique: 'oil',
  materials: '',
  width_cm: 60,
  height_cm: 80,
  depth_cm: 0,
  year: 2024,
  price_kop: 2_500_000,
  status: 'published',
  views: 3,
  favorites_count: 1,
  is_favorite: false,
  images: ['https://x/files/a.jpg'],
  artist: { id: 'u1', name: 'Анна Петрова', avatar_url: '', city: 'СПб', is_premium: true },
  published_at: null,
  created_at: '2026-10-01T00:00:00Z',
};

const meta = {
  categories: [{ code: 'painting', label: 'Живопись' }],
  styles: [],
  techniques: [{ code: 'oil', label: 'Масло' }],
  delivery_methods: [],
  price_min_kop: 0,
  price_max_kop: 0,
  commission_bp: 1500,
  premium_price_kop: 99000,
};

describe('ArtworkCard', () => {
  it('shows a museum label and opens the artwork', async () => {
    await wrap(<ArtworkCard artwork={artwork} meta={meta} />);
    expect(screen.getByText('Белые ночи')).toBeTruthy();
    expect(screen.getByText('Анна Петрова')).toBeTruthy();
    expect(screen.getByText(/Масло, 60/)).toBeTruthy();
    expect(screen.getByLabelText('Премиум-художник')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/artwork/[id]', params: { id: 'a1' } });
  });

  it('marks sold works', async () => {
    await wrap(<ArtworkCard artwork={{ ...artwork, status: 'sold', images: [] }} />);
    expect(screen.getByText('Продана')).toBeTruthy();
    expect(screen.getByText('Нет фото')).toBeTruthy();
  });

  it('helpers', () => {
    expect(previewAspect({ width_cm: 100, height_cm: 10 })).toBe(1.6);
    expect(previewAspect({ width_cm: 10, height_cm: 100 })).toBe(0.625);
    expect(previewAspect({ width_cm: 0, height_cm: 0 })).toBe(1);
    expect(labelOf(meta, 'categories', 'painting')).toBe('Живопись');
    expect(labelOf(undefined, 'styles', 'x')).toBe('');
    expect(statusLabel('hidden')).toMatch(/модератор/);
  });
});

describe('primitives', () => {
  it('Button calls handler and respects disabled/loading', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<Button title="Купить" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Купить' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<Button title="Купить" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Купить' }));
    await rerender(<Button title="Купить" onPress={onPress} loading variant="danger" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Купить' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Field shows error over hint', async () => {
    const { rerender } = await render(<Field label="E-mail" hint="Подсказка" value="" />);
    expect(screen.getByText('Подсказка')).toBeTruthy();
    await rerender(<Field label="E-mail" hint="Подсказка" error="Проверьте e-mail" value="" />);
    expect(screen.getByText('Проверьте e-mail')).toBeTruthy();
    expect(screen.queryByText('Подсказка')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'a@b.ru');
  });

  it('Chip exposes selected state', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Живопись" selected onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Живопись' });
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it('states and avatar fallback', async () => {
    const retry = jest.fn();
    await render(
      <>
        <EmptyState title="Пусто" text="Ничего" />
        <ErrorState text="Нет сети" onRetry={retry} />
        <Notice text="Готово" tone="success" />
        <Avatar name="Анна Петрова" />
      </>,
    );
    expect(screen.getByText('АП')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('StatusTimeline', () => {
  const base = {
    status: 'shipped',
    paid_at: '2026-10-20T10:00:00Z',
    confirmed_at: '2026-10-20T12:00:00Z',
    shipped_at: '2026-10-21T10:00:00Z',
    completed_at: null,
  } as unknown as Order;

  it('marks reached steps and numbers the rest', async () => {
    await render(<StatusTimeline o={base} />);
    expect(screen.getByLabelText(`Статус заказа: ${orderStatusLabel.shipped}`)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy(); // последний шаг ещё не пройден
    expect(screen.queryByText('1')).toBeNull();
  });

  it('hides for cancelled orders', async () => {
    const { toJSON } = await render(<StatusTimeline o={{ ...base, status: 'cancelled' }} />);
    expect(toJSON()).toBeNull();
  });
});

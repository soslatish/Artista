import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { setFetch } from '@/api/client';
import type { Artwork, Exhibition, Post } from '@/api/types';
import { loadPref, savePref } from '@/lib/prefs';
import { useNow } from '@/lib/use-now';
import { ArtworkStrip, Gallery } from '@/ui/artwork';
import { ExhibitionCard, PostCard } from '@/ui/cards';
import { Line, SectionHeader, ToggleRow } from '@/ui/primitives';
import { DealRow } from '@/ui/rows';

const mockSession = { user: { id: 'me', role: 'artist' } as { id: string; role: string } | null };
jest.mock('@/auth/session', () => ({ useSession: () => mockSession }));

const requests: string[] = [];
beforeEach(() => {
  requests.length = 0;
  setFetch((async (url: string, init: RequestInit) => {
    requests.push(`${init.method ?? 'GET'} ${url.split('/api/v1')[1]}`);
    return { status: 200, ok: true, json: async () => ({ data: {} }) } as Response;
  }) as unknown as typeof fetch);
});

async function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return await render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const post: Post = {
  id: 'p1',
  body: 'Новая серия почти готова',
  images: ['https://x/1.jpg'],
  artwork: { id: 'a1', title: 'Белые ночи', image_url: 'https://x/a.jpg', price_kop: 2_500_000, status: 'published' },
  artist: { id: 'u1', name: 'Анна Петрова', avatar_url: '', city: 'СПб', is_premium: true },
  likes: 2,
  liked: false,
  created_at: '2026-10-20T10:00:00Z',
};

describe('PostCard', () => {
  it('likes optimistically and opens the linked work', async () => {
    await wrap(<PostCard post={post} />);
    expect(screen.getByText('Новая серия почти готова')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Нравится'));
    expect(screen.getByText('3')).toBeTruthy();
    expect(requests).toContain('POST /posts/p1/like');
    await fireEvent.press(screen.getByText('Белые ночи'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/artwork/[id]', params: { id: 'a1', src: 'post' } });
    await fireEvent.press(screen.getByText('Анна Петрова'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/artist/[id]', params: { id: 'u1' } });
  });

  it('sends guests to sign in and shows delete only to the author', async () => {
    mockSession.user = null;
    await wrap(<PostCard post={{ ...post, liked: true, artwork: null, images: [] }} />);
    expect(screen.queryByLabelText('Удалить пост')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Убрать отметку «нравится»'));
    expect(router.push).toHaveBeenCalledWith('/login');
    mockSession.user = { id: 'u1', role: 'artist' };
    await wrap(<PostCard post={post} />);
    expect(screen.getByLabelText('Удалить пост')).toBeTruthy();
  });
});

const exhibition: Exhibition = {
  id: 'e1',
  title: 'Северное лето',
  description: '',
  cover_url: '',
  starts_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
  status: 'upcoming',
  artist: { id: 'u1', name: 'Анна Петрова', avatar_url: '', city: '', is_premium: false },
  artworks_count: 5,
  reminders: 0,
  reminded: false,
};

it('ExhibitionCard shows a countdown and opens the show', async () => {
  await render(<ExhibitionCard e={exhibition} width={160} />);
  expect(screen.getByText(/через/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/exhibition/[id]', params: { id: 'e1' } });
  await render(<ExhibitionCard e={{ ...exhibition, status: 'open' }} />);
  expect(screen.getByText('Открыта')).toBeTruthy();
});

it('DealRow shows status and amount', async () => {
  const onPress = jest.fn();
  await render(<DealRow image="https://x/a.jpg" title="Белые ночи" subtitle="Иван" status="Ждёт ответа" statusColor="#000" right="20 000 ₽" rightSub="1 окт" highlight onPress={onPress} />);
  await fireEvent.press(screen.getByLabelText('Белые ночи, Ждёт ответа'));
  expect(onPress).toHaveBeenCalled();
  await render(<DealRow title="Без превью" />);
  expect(screen.getByText('Без превью')).toBeTruthy();
});

it('ToggleRow, Line and SectionHeader', async () => {
  const onChange = jest.fn();
  const onAction = jest.fn();
  await render(
    <>
      <ToggleRow label="Принимать заказы" hint="Подсказка" value={false} onChange={onChange} />
      <Line label="Итого" value="100 ₽" strong />
      <SectionHeader title="Выставки" action="Все" onAction={onAction} />
    </>,
  );
  await fireEvent.press(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith(true);
  await fireEvent.press(screen.getByText('Все'));
  expect(onAction).toHaveBeenCalled();
  expect(screen.getByText('100 ₽')).toBeTruthy();
});

const art = (id: string): Artwork => ({ id, title: `Работа ${id}`, width_cm: 40, height_cm: 50, images: [], artist: { id: 'u', name: 'Автор' }, technique: '', price_kop: 300_000, status: 'published', rooms: [], palette: [] }) as unknown as Artwork;

it('ArtworkStrip and Gallery render works', async () => {
  await wrap(<ArtworkStrip items={[art('1'), art('2')]} src="similar" />);
  expect(screen.getByText('Работа 1')).toBeTruthy();
  await wrap(<Gallery items={[]} loading={false} empty={<SectionHeader title="Пусто" />} />);
  expect(screen.getByText('Пусто')).toBeTruthy();
});

describe('prefs', () => {
  it('stores settings in SecureStore', async () => {
    await savePref('theme', 'dark');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('artista.pref.theme', 'dark');
    expect(await loadPref('theme')).toBe('dark');
  });

  it('uses localStorage on the web and survives errors', async () => {
    const original = Platform.OS;
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    Platform.OS = 'web';
    await savePref('locale', 'en');
    expect(await loadPref('locale')).toBe('en');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
    await expect(savePref('locale', 'ru')).resolves.toBeUndefined();
    expect(await loadPref('locale')).toBeNull();
    Platform.OS = original;
  });
});

it('useNow ticks', async () => {
  jest.useFakeTimers();
  const { result } = await renderHook(() => useNow(1000));
  const first = result.current.getTime();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.getTime()).toBeGreaterThan(first);
  jest.useRealTimers();
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import type { ReactNode } from 'react';

import { configureTokens, setFetch } from '@/api/client';
import {
  flatten,
  keys,
  useArchiveArtwork,
  useArtwork,
  useArtworks,
  useCatalogMeta,
  useConversations,
  useDeliveryQuotes,
  useFavorites,
  useFollow,
  useMessages,
  useMyArtworks,
  useNotifications,
  useOrder,
  useOrderAction,
  useOrders,
  useReviews,
  useSaveArtwork,
  useStats,
  useToggleFavorite,
  useUpdateMe,
  useUser,
  useUserArtworks,
} from '@/api/hooks';
import type { Artwork } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { chooseAction, confirmAction, notify } from '@/lib/confirm';

type Handler = (method: string, path: string, body: unknown) => { status: number; body?: unknown };
let handler: Handler;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  configureTokens({ getAccess: () => 'token', getRefresh: () => 'r', setTokens: () => undefined, onSessionExpired: () => undefined });
  setFetch((async (url: string, init: RequestInit) => {
    const path = url.split('/api/v1')[1];
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const r = handler(method, path, body);
    return { status: r.status, ok: r.status < 300, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch);
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

const art = (id: string, extra: Partial<Artwork> = {}) => ({ id, title: id, is_favorite: false, favorites_count: 0, status: 'published', ...extra }) as Artwork;

test('paged lists follow next_cursor and flatten pages', async () => {
  handler = (_m, path) =>
    path.includes('cursor=1')
      ? { status: 200, body: { data: [art('b')], meta: { next_cursor: null } } }
      : { status: 200, body: { data: [art('a')], meta: { next_cursor: '1' } } };
  const { wrapper } = setup();
  const { result } = await renderHook(() => useArtworks({ feed: 'new' }), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.hasNextPage).toBe(true);
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(flatten(result.current.data).map((a) => a.id)).toEqual(['a', 'b']));
  expect(flatten(undefined)).toEqual([]);
  expect(calls[0]).toBe('GET /artworks?feed=new');
});

test('simple queries hit the right endpoints', async () => {
  handler = () => ({ status: 200, body: { data: { id: 'x' }, meta: { next_cursor: null } } });
  const { wrapper } = setup();
  const hooks = [
    () => useCatalogMeta(),
    () => useArtwork('a1'),
    () => useUser('u1'),
    () => useStats(true),
    () => useOrder('o1'),
  ];
  for (const h of hooks) {
    const { result } = await renderHook(h, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }
  const paged = [
    () => useMyArtworks('draft'),
    () => useFavorites(true),
    () => useUserArtworks('u1'),
    () => useReviews('u1'),
    () => useOrders('artist', 'active'),
    () => useConversations(true),
    () => useMessages('c1'),
    () => useNotifications(true),
  ];
  handler = () => ({ status: 200, body: { data: [], meta: { next_cursor: null } } });
  for (const h of paged) {
    const { result } = await renderHook(h, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }
  expect(calls).toEqual(
    expect.arrayContaining([
      'GET /catalog/meta',
      'GET /artworks/a1',
      'GET /users/u1',
      'GET /me/stats',
      'GET /orders/o1',
      'GET /me/artworks?status=draft',
      'GET /orders?role=artist&status=active',
      'GET /conversations/c1/messages?limit=50',
    ]),
  );
});

test('disabled queries do not fire', async () => {
  handler = () => ({ status: 200, body: { data: [] } });
  const { wrapper } = setup();
  await renderHook(() => useArtwork(''), { wrapper });
  await renderHook(() => useFavorites(false), { wrapper });
  await renderHook(() => useDeliveryQuotes('a1', 'М'), { wrapper });
  expect(calls).toEqual([]);
});

test('favorite toggles optimistically and rolls back on error', async () => {
  const { qc, wrapper } = setup();
  qc.setQueryData(keys.artwork('a1'), art('a1'));
  handler = () => ({ status: 500, body: { error: { code: 'internal', message: 'boom' } } });
  const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
  await act(async () => {
    result.current.mutate({ id: 'a1', on: true });
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(qc.getQueryData<Artwork>(keys.artwork('a1'))?.is_favorite).toBe(false);

  handler = (m) => (m === 'GET' ? { status: 200, body: { data: art('a1', { is_favorite: true, favorites_count: 1 }) } } : { status: 204 });
  await act(async () => {
    result.current.mutate({ id: 'a1', on: true });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls).toContain('POST /artworks/a1/favorite');
});

test('save artwork creates, then patches and publishes a draft', async () => {
  handler = (m, path) => {
    if (m === 'POST' && path === '/artworks') return { status: 201, body: { data: art('n1', { status: 'draft' }) } };
    if (m === 'PATCH') return { status: 200, body: { data: art('n1', { status: 'draft' }) } };
    if (path.endsWith('/publish')) return { status: 200, body: { data: art('n1') } };
    return { status: 200, body: { data: {} } };
  };
  const { wrapper } = setup();
  const input = { title: 'T', description: '', category: 'painting', style: '', technique: '', materials: '', width_cm: 1, height_cm: 1, depth_cm: 0, year: null, price_kop: 300000, images: [] };
  const create = await renderHook(() => useSaveArtwork(), { wrapper });
  await act(async () => {
    await create.result.current.mutateAsync({ input, publish: false });
  });
  const edit = await renderHook(() => useSaveArtwork('n1'), { wrapper });
  let saved: Artwork | undefined;
  await act(async () => {
    saved = await edit.result.current.mutateAsync({ input, publish: true });
  });
  expect(saved?.status).toBe('published');
  expect(calls).toEqual(expect.arrayContaining(['POST /artworks', 'PATCH /artworks/n1', 'POST /artworks/n1/publish']));
});

test('order action, archive, follow and profile update', async () => {
  handler = (m, path) => {
    if (path.startsWith('/orders/o1/')) return { status: 200, body: { data: { id: 'o1', status: 'confirmed', artwork: { id: 'a1' } } } };
    if (path === '/me') return { status: 200, body: { data: { id: 'u1', name: 'Новое имя' } } };
    return { status: 204 };
  };
  const { qc, wrapper } = setup();
  const order = await renderHook(() => useOrderAction('o1'), { wrapper });
  await act(async () => {
    await order.result.current.mutateAsync({ action: 'confirm' });
  });
  expect(qc.getQueryData<{ status: string }>(keys.order('o1'))?.status).toBe('confirmed');

  const archive = await renderHook(() => useArchiveArtwork(), { wrapper });
  const follow = await renderHook(() => useFollow('u2'), { wrapper });
  const me = await renderHook(() => useUpdateMe(), { wrapper });
  await act(async () => {
    await archive.result.current.mutateAsync('a1');
    await follow.result.current.mutateAsync(true);
    await follow.result.current.mutateAsync(false);
    await me.result.current.mutateAsync({ name: 'Новое имя' });
  });
  expect(calls).toEqual(expect.arrayContaining(['DELETE /artworks/a1', 'POST /users/u2/follow', 'DELETE /users/u2/follow', 'PATCH /me']));
  expect(qc.getQueryData<{ name: string }>(keys.me)?.name).toBe('Новое имя');
});

test('delivery quotes load once city is typed', async () => {
  handler = () => ({ status: 200, body: { data: [{ method: 'cdek', price_kop: 50000, days_min: 1, days_max: 2 }] } });
  const { wrapper } = setup();
  const { result } = await renderHook(() => useDeliveryQuotes('a1', 'Москва'), { wrapper });
  await waitFor(() => expect(result.current.data?.[0].method).toBe('cdek'));
});

test('uploadImage posts multipart and returns url', async () => {
  handler = () => ({ status: 201, body: { data: { url: 'http://api/files/x.jpg' } } });
  await expect(uploadImage({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg' })).resolves.toBe('http://api/files/x.jpg');
  await expect(uploadImage({ uri: 'file:///p.png' })).resolves.toBe('http://api/files/x.jpg');
  expect(calls).toEqual(['POST /uploads', 'POST /uploads']);
});

describe('confirm helpers on native', () => {
  it('wires Alert buttons', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const yes = jest.fn();
    confirmAction('Удалить?', 'Точно', yes, { destructive: true, confirmText: 'Удалить' });
    const buttons = spy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Удалить')?.onPress?.();
    expect(yes).toHaveBeenCalled();

    const pick = jest.fn();
    chooseAction('Жалоба', 'Причина', [{ label: 'Спам', onPress: pick }]);
    (spy.mock.calls[1][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Спам')?.onPress?.();
    expect(pick).toHaveBeenCalled();

    notify('Готово');
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('falls back to window dialogs on web', () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const g = globalThis as unknown as { confirm: jest.Mock; alert: jest.Mock };
    g.confirm = jest.fn(() => true);
    g.alert = jest.fn();
    const yes = jest.fn();
    confirmAction('Удалить?', 'Точно', yes);
    chooseAction('Жалоба', 'Причина', [{ label: 'Спам', onPress: yes }]);
    notify('Готово', 'Текст');
    expect(yes).toHaveBeenCalledTimes(2);
    expect(g.alert).toHaveBeenCalledWith('Готово\n\nТекст');
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });
});

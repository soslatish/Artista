import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { adminTotal, flattenAdmin, useAdminList, useAdminSettings, useDashboard } from '@/api/admin';
import { configureTokens, setFetch } from '@/api/client';
import { label, orderStatus, summarize } from '@/features/admin/labels';
import { usePlatformTerms } from '@/lib/terms';

const calls: string[] = [];
let metaBody: unknown = { commission_bp: 1250, premium_price_kop: 500_00, premium_free_limit_kop: 50_000_00 };

beforeEach(() => {
  calls.length = 0;
  configureTokens({ getAccess: () => 'token', getRefresh: () => 'r', setTokens: () => undefined, onSessionExpired: () => undefined });
  setFetch((async (url: string) => {
    const path = url.split('/api/v1')[1];
    calls.push(path);
    let body: unknown = { data: {} };
    if (path.startsWith('/admin/users')) {
      const offset = new URL(`http://x${path}`).searchParams.get('offset');
      body = offset
        ? { data: [{ id: 'u3' }], meta: { total: 3, offset: 2, limit: 2, next_offset: null } }
        : { data: [{ id: 'u1' }, { id: 'u2' }], meta: { total: 3, offset: 0, limit: 2, next_offset: 2 } };
    } else if (path.startsWith('/catalog/meta')) {
      body = { data: metaBody };
    }
    return { status: 200, ok: true, json: async () => body } as Response;
  }) as unknown as typeof fetch);
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test('admin lists page with offset and report the total', async () => {
  const r = await renderHook(() => useAdminList<{ id: string }>('users', { role: 'artist', q: undefined }), { wrapper });
  await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
  expect(flattenAdmin(r.result.current.data).map((u) => u.id)).toEqual(['u1', 'u2']);
  expect(adminTotal(r.result.current.data)).toBe(3);
  await act(async () => {
    await r.result.current.fetchNextPage();
  });
  await waitFor(() => expect(flattenAdmin(r.result.current.data)).toHaveLength(3));
  expect(r.result.current.hasNextPage).toBe(false);
  expect(calls).toEqual(['/admin/users?role=artist', '/admin/users?role=artist&offset=2']);
});

test('dashboard and settings hit their endpoints', async () => {
  const d = await renderHook(() => useDashboard(), { wrapper });
  const s = await renderHook(() => useAdminSettings(), { wrapper });
  await waitFor(() => expect(d.result.current.isSuccess && s.result.current.isSuccess).toBe(true));
  expect(calls).toEqual(expect.arrayContaining(['/admin/dashboard', '/admin/settings']));
});

test('platform terms come from the catalog meta', async () => {
  const r = await renderHook(() => usePlatformTerms(), { wrapper });
  await waitFor(() => expect(r.result.current.pct).toBe('12,5%'));
  expect(r.result.current.price.replace(/ /g, ' ')).toBe('500 ₽');
  expect(r.result.current.limit.replace(/ /g, ' ')).toBe('50 000 ₽');
});

test('falls back to default terms before the meta loads', async () => {
  metaBody = {};
  const r = await renderHook(() => usePlatformTerms(), { wrapper });
  expect(r.result.current.pct).toBe('15%');
});

test('labels and audit summaries', () => {
  expect(label(orderStatus, 'shipped')).toEqual(['В пути', 'accent']);
  expect(label(orderStatus, 'weird')).toEqual(['weird', 'neutral']);
  expect(summarize({ reason: 'спам', banned: true, before: { a: 1 }, empty: '' })).toBe('reason: спам, banned: true');
});

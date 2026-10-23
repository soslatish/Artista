import { ApiError, configureTokens, errorText, fieldErrors, get, patch, post, del, setFetch } from '@/api/client';
import { clearSession, loadSession, saveSession } from '@/api/storage';
import type { Tokens } from '@/api/types';

function json(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('api client', () => {
  let access: string | null;
  let refresh: string | null;
  let expired: jest.Mock;

  beforeEach(() => {
    access = 'old-access';
    refresh = 'refresh-1';
    expired = jest.fn();
    configureTokens({
      getAccess: () => access,
      getRefresh: () => refresh,
      setTokens: (t: Tokens) => {
        access = t.access_token;
        refresh = t.refresh_token;
      },
      onSessionExpired: expired,
    });
  });

  it('unwraps data and sends bearer token and query', async () => {
    const f = jest.fn(async () => json(200, { data: [1, 2], meta: { next_cursor: null } }));
    setFetch(f as unknown as typeof fetch);
    await expect(get('/artworks', { q: 'ночи', empty: '', skip: undefined })).resolves.toEqual([1, 2]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/artworks\?q=%D0%BD%D0%BE%D1%87%D0%B8$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer old-access');
  });

  it('refreshes once on 401 and retries with new token', async () => {
    const calls: string[] = [];
    const f = jest.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization ?? '';
      calls.push(`${url.split('/api/v1')[1]} ${auth}`);
      if (url.endsWith('/auth/refresh')) return json(200, { data: { access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 900 } });
      return auth === 'Bearer new-access' ? json(200, { data: { ok: true } }) : json(401, { error: { code: 'unauthorized', message: 'no' } });
    });
    setFetch(f as unknown as typeof fetch);
    const [a, b] = await Promise.all([get('/me'), get('/orders')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(calls.filter((c) => c.startsWith('/auth/refresh'))).toHaveLength(1);
    expect(refresh).toBe('refresh-2');
  });

  it('expires session when refresh is rejected', async () => {
    setFetch((async (url: string) =>
      url.endsWith('/auth/refresh') ? json(401, { error: { code: 'unauthorized', message: 'Сессия истекла' } }) : json(401, { error: { code: 'unauthorized', message: 'Требуется вход' } })) as unknown as typeof fetch);
    await expect(get('/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalled();
  });

  it('maps validation errors and network failures', async () => {
    setFetch((async () => json(422, { error: { code: 'validation', message: 'Проверьте', fields: { title: 'Слишком коротко' } } })) as unknown as typeof fetch);
    const err = await post('/artworks', { title: 'A' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(fieldErrors(err)).toEqual({ title: 'Слишком коротко' });
    expect(errorText(err)).toBe('Слишком коротко');

    setFetch((async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch);
    const net = await patch('/me', {}).catch((e: unknown) => e);
    expect((net as ApiError).code).toBe('network');
    expect(errorText(new Error('x'))).toMatch(/Что-то пошло не так/);
    expect(fieldErrors('x')).toEqual({});
  });

  it('handles 204 and non-json bodies', async () => {
    setFetch((async () => ({ status: 204, ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch);
    await expect(del('/artworks/1/favorite')).resolves.toBeUndefined();
    setFetch((async () => ({ status: 500, ok: false, json: async () => { throw new Error('html'); } }) as unknown as Response) as unknown as typeof fetch);
    await expect(get('/x')).rejects.toMatchObject({ status: 500, code: 'http_error' });
  });
});

describe('session storage', () => {
  it('round-trips tokens in secure store', async () => {
    await saveSession({ accessToken: 'a', refreshToken: 'r' });
    await expect(loadSession()).resolves.toEqual({ accessToken: 'a', refreshToken: 'r' });
    await clearSession();
    await expect(loadSession()).resolves.toBeNull();
  });
});

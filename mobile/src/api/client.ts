// HTTP-клиент Artista API: JSON-конверт, ошибки по полям, автообновление access-токена.
import { currentLocale, t } from '@/i18n';

import type { Tokens } from './types';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/** Адрес сайта для ссылок «Поделиться» (по умолчанию — тот же сервер, что и API). */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? API_URL).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  getAccess(): string | null;
  getRefresh(): string | null;
  setTokens(t: Tokens): Promise<void> | void;
  onSessionExpired(): void;
}

let store: TokenStore | null = null;
let refreshing: Promise<boolean> | null = null;

export function configureTokens(s: TokenStore | null) {
  store = s;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);

/** Для тестов. */
export function setFetch(f: Fetch) {
  fetchImpl = f;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  query?: Record<string, string | number | undefined | null>;
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${API_URL}/api/v1${path}${qs ? `?${qs}` : ''}`;
}

async function rawRequest<T>(path: string, opts: RequestOptions, token: string | null): Promise<{ status: number; env: Envelope<T> | null; error?: ApiError }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': currentLocale() };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetchImpl(buildUrl(path, opts.query), { method: opts.method ?? 'GET', headers, body });
  } catch {
    return { status: 0, env: null, error: new ApiError(0, 'network', t('Нет соединения с сервером. Проверьте интернет.')) };
  }
  if (res.status === 204) return { status: 204, env: null };
  let json: { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; fields?: Record<string, string> } } = {};
  try {
    json = await res.json();
  } catch {
    /* пустое или не-JSON тело */
  }
  if (!res.ok) {
    const e = json.error;
    return {
      status: res.status,
      env: null,
      error: new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? t('Что-то пошло не так. Попробуйте ещё раз.'), e?.fields ?? {}),
    };
  }
  return { status: res.status, env: { data: json.data as T, meta: json.meta } };
}

/**
 * Обновляет токены один раз для всех параллельных запросов.
 * Если за время запроса сессия сменилась (выход, вход другим аккаунтом), результат отбрасывается —
 * иначе старый refresh-токен вернул бы сессию после выхода.
 */
export async function refreshTokens(): Promise<boolean> {
  const startedWith = store?.getRefresh();
  if (!startedWith) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const r = await rawRequest<Tokens>('/auth/refresh', { method: 'POST', body: { refresh_token: startedWith } }, null);
      if (store?.getRefresh() !== startedWith) return false;
      if (r.env?.data) {
        await store?.setTokens(r.env.data);
        return true;
      }
      if (r.status === 401) store?.onSessionExpired();
      return false;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Дождаться идущего обновления токенов (перед выходом). */
export async function awaitPendingRefresh(): Promise<void> {
  if (refreshing) await refreshing.catch(() => false);
}

/** Текущий access-токен (для WebSocket — читается в момент подключения). */
export function currentAccessToken(): string | null {
  return store?.getAccess() ?? null;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
  const useAuth = opts.auth !== false;
  const first = await rawRequest<T>(path, opts, useAuth ? store?.getAccess() ?? null : null);
  if (first.status === 401 && useAuth && store?.getAccess()) {
    if (await refreshTokens()) {
      const second = await rawRequest<T>(path, opts, store?.getAccess() ?? null);
      if (second.error) throw second.error;
      return second.env ?? { data: undefined as T };
    }
  }
  if (first.error) throw first.error;
  return first.env ?? { data: undefined as T };
}

export async function get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
  return (await request<T>(path, { query })).data;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return (await request<T>(path, { method: 'POST', body })).data;
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PATCH', body })).data;
}

export async function del<T = void>(path: string, body?: unknown): Promise<T> {
  return (await request<T>(path, { method: 'DELETE', body })).data;
}

/** Сообщение об ошибке для показа пользователю. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fields)[0];
    return t(first ?? e.message);
  }
  return t('Что-то пошло не так. Попробуйте ещё раз.');
}

export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, t(v)]));
}

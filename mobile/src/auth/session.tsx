// Сессия пользователя: токены, профиль, вход/выход. Гость может смотреть каталог.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, awaitPendingRefresh, configureTokens, get, post } from '@/api/client';
import { clearSession, loadSession, saveSession } from '@/api/storage';
import type { AuthResponse, Me, Role, Tokens } from '@/api/types';
import { registeredPushToken } from '@/features/push-token';

interface SignUpInput {
  email: string;
  password: string;
  name: string;
  role: Exclude<Role, 'admin'>;
  city: string;
}

interface SessionValue {
  ready: boolean;
  user: Me | null;
  /** Есть сохранённая сессия, но профиль ещё не загружен (например, нет сети). */
  restoring: boolean;
  accessToken: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
  /** Применить ответ с новыми токенами и профилем (например, «стать художником»). */
  applyAuth(r: AuthResponse): Promise<void>;
  setUser(u: Me): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Me | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const tokens = useRef<{ access: string | null; refresh: string | null }>({ access: null, refresh: null });

  const reset = useCallback(async () => {
    tokens.current = { access: null, refresh: null };
    setAccessToken(null);
    setUser(null);
    setRestoring(false);
    qc.clear();
    await clearSession();
  }, [qc]);

  const storeTokens = useCallback(async (t: Tokens) => {
    tokens.current = { access: t.access_token, refresh: t.refresh_token };
    setAccessToken(t.access_token);
    await saveSession({ accessToken: t.access_token, refreshToken: t.refresh_token });
  }, []);

  useEffect(() => {
    configureTokens({
      getAccess: () => tokens.current.access,
      getRefresh: () => tokens.current.refresh,
      setTokens: storeTokens,
      onSessionExpired: () => {
        void reset();
      },
    });
    return () => configureTokens(null);
  }, [reset, storeTokens]);

  // восстановление сессии: при отсутствии сети повторяем загрузку профиля, не выкидывая пользователя
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadMe = async (attempt: number): Promise<void> => {
      try {
        const me = await get<Me>('/me');
        if (active) {
          setUser(me);
          setRestoring(false);
        }
      } catch (e) {
        const offline = e instanceof ApiError && (e.status === 0 || e.status >= 500);
        if (active && offline && tokens.current.refresh) {
          timer = setTimeout(() => void loadMe(attempt + 1), Math.min(30_000, 2_000 * 2 ** attempt));
        } else if (active) {
          setRestoring(false);
        }
      }
    };
    (async () => {
      const saved = await loadSession();
      if (saved) {
        tokens.current = { access: saved.accessToken, refresh: saved.refreshToken };
        setAccessToken(saved.accessToken);
        setRestoring(true);
        await loadMe(0);
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const applyAuth = useCallback(
    async (r: AuthResponse) => {
      await storeTokens(r.tokens);
      setUser(r.user);
      qc.invalidateQueries();
    },
    [qc, storeTokens],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await applyAuth(await post<AuthResponse>('/auth/login', { email: email.trim(), password }));
    },
    [applyAuth],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      await applyAuth(await post<AuthResponse>('/auth/register', { ...input, email: input.email.trim() }));
    },
    [applyAuth],
  );

  const signOut = useCallback(async () => {
    await awaitPendingRefresh(); // иначе выход разойдётся с ротацией refresh-токена
    const refresh = tokens.current.refresh;
    if (refresh) {
      try {
        // device_token — чтобы push этого аккаунта больше не приходили на устройство
        await post('/auth/logout', { refresh_token: refresh, device_token: registeredPushToken() ?? '' });
      } catch {
        /* выходим локально даже без сети */
      }
    }
    await reset();
  }, [reset]);

  const value = useMemo<SessionValue>(
    () => ({ ready, user, restoring, accessToken, signIn, signUp, signOut, applyAuth, setUser }),
    [ready, user, restoring, accessToken, signIn, signUp, signOut, applyAuth],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

/** Сессия, если есть провайдер (карточки рендерятся и в тестах без него). */
export function useMaybeSession(): SessionValue | null {
  return useContext(SessionContext);
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

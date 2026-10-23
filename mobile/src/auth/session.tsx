// Сессия пользователя: токены, профиль, вход/выход. Гость может смотреть каталог.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { configureTokens, get, post } from '@/api/client';
import { clearSession, loadSession, saveSession } from '@/api/storage';
import type { AuthResponse, Me, Role, Tokens } from '@/api/types';

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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const tokens = useRef<{ access: string | null; refresh: string | null }>({ access: null, refresh: null });

  const reset = useCallback(async () => {
    tokens.current = { access: null, refresh: null };
    setAccessToken(null);
    setUser(null);
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

  useEffect(() => {
    let active = true;
    (async () => {
      const saved = await loadSession();
      if (saved) {
        tokens.current = { access: saved.accessToken, refresh: saved.refreshToken };
        setAccessToken(saved.accessToken);
        try {
          const me = await get<Me>('/me');
          if (active) setUser(me);
        } catch {
          if (active && !tokens.current.access) setUser(null);
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
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
    const refresh = tokens.current.refresh;
    if (refresh) {
      try {
        await post('/auth/logout', { refresh_token: refresh });
      } catch {
        /* выходим локально даже без сети */
      }
    }
    await reset();
  }, [reset]);

  const value = useMemo<SessionValue>(
    () => ({ ready, user, accessToken, signIn, signUp, signOut, applyAuth, setUser }),
    [ready, user, accessToken, signIn, signUp, signOut, applyAuth],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

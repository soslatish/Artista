// Хранение токенов: Keychain/Keystore на устройстве, localStorage в веб-превью.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'artista.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

const web = {
  get: (): string | null => {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      globalThis.localStorage?.setItem(KEY, v);
    } catch {
      /* приватный режим — сессия живёт до перезагрузки */
    }
  },
  remove: () => {
    try {
      globalThis.localStorage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

export async function loadSession(): Promise<StoredSession | null> {
  const raw = Platform.OS === 'web' ? web.get() : await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    return s.accessToken && s.refreshToken ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: StoredSession): Promise<void> {
  const raw = JSON.stringify(s);
  if (Platform.OS === 'web') web.set(raw);
  else await SecureStore.setItemAsync(KEY, raw);
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') web.remove();
  else await SecureStore.deleteItemAsync(KEY);
}

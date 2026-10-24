// Настройки устройства (тема, язык). Не секретны, но SecureStore уже есть в проекте и работает везде, кроме веба.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type PrefKey = 'theme' | 'locale';

const prefix = 'artista.pref.';

export async function loadPref(key: PrefKey): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(prefix + key) ?? null;
    return await SecureStore.getItemAsync(prefix + key);
  } catch {
    return null;
  }
}

export async function savePref(key: PrefKey, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(prefix + key, value);
      return;
    }
    await SecureStore.setItemAsync(prefix + key, value);
  } catch {
    /* настройка не сохранится — не критично */
  }
}

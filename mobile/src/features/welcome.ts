// Общая логика контейнера вкладок: приветствие гостю и регистрация push.
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/auth/session';

import { usePushRegistration } from './push';

let welcomeShown = false;

export function useTabsBootstrap(): void {
  const { user } = useSession();
  usePushRegistration();
  useEffect(() => {
    // приветствие показываем гостю один раз за запуск
    if (user || welcomeShown) return;
    welcomeShown = true;
    const t = setTimeout(() => router.push('/welcome'), 0);
    return () => clearTimeout(t);
  }, [user]);
}

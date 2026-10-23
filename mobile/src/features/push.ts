// Push-уведомления: получаем Expo-токен и отправляем на сервер.
// Пока на сервере стоит заглушка (лог), а у проекта нет EAS projectId — регистрация тихо пропускается.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { post } from '@/api/client';
import { useSession } from '@/auth/session';

import { setRegisteredPushToken } from './push-token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

async function registerToken(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Artista', importance: AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await post('/me/devices', { token: token.data, platform: Platform.OS });
  setRegisteredPushToken(token.data);
}

export function usePushRegistration(): void {
  const { user } = useSession();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    registerToken().catch(() => undefined);
  }, [userId]);
}

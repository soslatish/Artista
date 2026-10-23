// TanStack Query в React Native не знает о фокусе приложения и сети — подключаем вручную,
// чтобы списки обновлялись при возврате в приложение и после восстановления связи.
import { focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

let installed = false;

export function installQueryLifecycle(): void {
  if (installed || Platform.OS === 'web') return; // в браузере TanStack делает это сам
  installed = true;
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false));
    return () => sub.remove();
  });
}

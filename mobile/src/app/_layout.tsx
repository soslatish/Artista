import { CormorantGaramond_500Medium_Italic, CormorantGaramond_600SemiBold, CormorantGaramond_600SemiBold_Italic } from '@expo-google-fonts/cormorant-garamond';
import { GreatVibes_400Regular } from '@expo-google-fonts/great-vibes';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ApiError } from '@/api/client';
import { SessionProvider, useSession } from '@/auth/session';
import { RealtimeBridge } from '@/features/realtime';
import { colors, fonts } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      },
    },
  });
}

const screenOptions = {
  headerTintColor: colors.ink,
  headerTitleStyle: { fontFamily: fonts.sansSemi, fontSize: 17 },
  headerStyle: { backgroundColor: colors.wall },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.wall },
  headerBackButtonDisplayMode: 'minimal' as const,
};

function RootStack() {
  const { ready } = useSession();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <>
      <RealtimeBridge />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="login" options={{ title: 'Вход', presentation: 'modal' }} />
        <Stack.Screen name="register" options={{ title: 'Регистрация', presentation: 'modal' }} />
        <Stack.Screen name="forgot" options={{ title: 'Восстановление пароля', presentation: 'modal' }} />
        <Stack.Screen name="artwork/[id]" options={{ title: '' }} />
        <Stack.Screen name="artwork/new" options={{ title: 'Новая работа' }} />
        <Stack.Screen name="artwork/edit/[id]" options={{ title: 'Редактирование' }} />
        <Stack.Screen name="artist/[id]" options={{ title: '' }} />
        <Stack.Screen name="checkout/[artworkId]" options={{ title: 'Оформление заказа' }} />
        <Stack.Screen name="orders/index" options={{ title: 'Заказы' }} />
        <Stack.Screen name="orders/[id]" options={{ title: 'Заказ' }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="notifications" options={{ title: 'Уведомления' }} />
        <Stack.Screen name="my-artworks" options={{ title: 'Мои работы' }} />
        <Stack.Screen name="stats" options={{ title: 'Статистика' }} />
        <Stack.Screen name="premium" options={{ title: 'Премиум', presentation: 'modal' }} />
        <Stack.Screen name="settings/profile" options={{ title: 'Профиль' }} />
        <Stack.Screen name="settings/delete" options={{ title: 'Удаление аккаунта' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [client] = useState(makeClient);
  const [fontsLoaded, fontError] = useFonts({
    GreatVibes_400Regular,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_600SemiBold_Italic,
    CormorantGaramond_500Medium_Italic,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.wall }}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <StatusBar style="dark" />
          <RootStack />
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

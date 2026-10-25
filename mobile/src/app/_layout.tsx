import { CormorantGaramond_500Medium_Italic, CormorantGaramond_600SemiBold, CormorantGaramond_600SemiBold_Italic } from '@expo-google-fonts/cormorant-garamond';
import { GreatVibes_400Regular } from '@expo-google-fonts/great-vibes';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ApiError, patch } from '@/api/client';
import { SessionProvider, useSession } from '@/auth/session';
import { installQueryLifecycle } from '@/features/query-lifecycle';
import { RealtimeBridge } from '@/features/realtime';
import { WebHeaderLeft } from '@/features/web-header-left';
import { deviceLocale, I18nProvider, type Locale, useLocale, useT } from '@/i18n';
import { loadPref } from '@/lib/prefs';
import { isWeb, webPage } from '@/ui/layout';
import { fonts, ThemeProvider, type ThemePref, useTheme } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();
installQueryLifecycle();

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

/** Язык уведомлений на сервере совпадает с языком приложения. */
/**
 * Язык между устройствами: при входе берём язык из профиля (его могли выбрать на другом устройстве),
 * а смену языка в настройках сохраняем в профиль — от него зависят тексты уведомлений.
 */
function LocaleSync() {
  const { user, setUser } = useSession();
  const { locale, setLocale } = useLocale();
  const syncedFor = useRef<string | null>(null);
  const patched = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current !== user.id) {
      syncedFor.current = user.id;
      patched.current = null;
      if ((user.locale === 'ru' || user.locale === 'en') && user.locale !== locale) {
        setLocale(user.locale);
        return;
      }
    }
    if (user.locale === locale || patched.current === locale) return;
    patched.current = locale;
    patch<typeof user>('/me', { locale })
      .then(setUser)
      .catch(() => undefined);
  }, [user, locale, setLocale, setUser]);
  return null;
}

function RootStack() {
  const { ready } = useSession();
  const t = useT();
  const { colors, scheme } = useTheme();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  const screenOptions = {
    headerTintColor: colors.ink,
    headerTitleStyle: { fontFamily: fonts.sansSemi, fontSize: 17 },
    headerStyle: { backgroundColor: colors.wall },
    headerShadowVisible: false,
    // в браузере обычные экраны — колонка по центру, шапка остаётся во всю ширину
    contentStyle: { backgroundColor: colors.wall, ...webPage },
    headerBackButtonDisplayMode: 'minimal' as const,
    ...(Platform.OS === 'web' ? { headerLeft: (props: { canGoBack?: boolean }) => <WebHeaderLeft canGoBack={props.canGoBack} /> } : {}),
  };
  const title = (s: string) => ({ title: t(s) });
  // экраны, которые сами раскладывают контент по ширине окна
  const fullWidth = { backgroundColor: colors.wall };
  // фон навигатора = фон приложения: по бокам колонки экрана в браузере не видно серых полос
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = { ...base, colors: { ...base.colors, background: colors.wall, card: colors.wall, text: colors.ink, border: colors.hairline, primary: colors.bordeaux } };
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RealtimeBridge />
      <LocaleSync />
      <NavigationThemeProvider value={navigationTheme}>
        <Stack screenOptions={screenOptions}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: fullWidth }} />
          <Stack.Screen name="welcome" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="login" options={{ ...title('Вход'), presentation: 'modal' }} />
          <Stack.Screen name="register" options={{ ...title('Регистрация'), presentation: 'modal' }} />
          <Stack.Screen name="forgot" options={{ ...title('Восстановление пароля'), presentation: 'modal' }} />
          <Stack.Screen name="artwork/[id]" options={{ title: '', contentStyle: fullWidth }} />
          <Stack.Screen name="artwork/new" options={title('Новая работа')} />
          <Stack.Screen name="artwork/edit/[id]" options={title('Редактирование')} />
          <Stack.Screen name="try-on/[id]" options={{ headerShown: false, presentation: 'fullScreenModal', contentStyle: fullWidth }} />
          <Stack.Screen name="artist/[id]" options={{ title: '' }} />
          <Stack.Screen name="checkout/[artworkId]" options={title('Оформление заказа')} />
          <Stack.Screen name="orders/index" options={title('Заказы')} />
          <Stack.Screen name="orders/[id]" options={title('Заказ')} />
          <Stack.Screen name="offers/index" options={title('Предложения цены')} />
          <Stack.Screen name="offers/[id]" options={title('Предложение')} />
          <Stack.Screen name="offer/new/[artworkId]" options={{ ...title('Предложить цену'), presentation: 'modal' }} />
          <Stack.Screen name="auction/[id]" options={title('Аукцион')} />
          <Stack.Screen name="auction/new/[artworkId]" options={{ ...title('Выставить на аукцион'), presentation: 'modal' }} />
          <Stack.Screen name="commissions/index" options={title('Работы на заказ')} />
          <Stack.Screen name="commissions/[id]" options={title('Работа на заказ')} />
          <Stack.Screen name="commission/new/[artistId]" options={{ ...title('Заказать работу'), presentation: 'modal' }} />
          <Stack.Screen name="collection/[slug]" options={{ title: '' }} />
          <Stack.Screen name="exhibitions/index" options={title('Выставки')} />
          <Stack.Screen name="exhibition/[id]" options={{ title: '' }} />
          <Stack.Screen name="exhibitions/new" options={title('Новая выставка')} />
          <Stack.Screen name="history" options={title('Вы смотрели')} />
          <Stack.Screen name="saved-searches" options={title('Сохранённые поиски')} />
          <Stack.Screen name="certificates/index" options={title('Сертификаты')} />
          <Stack.Screen name="certificate/[code]" options={title('Сертификат')} />
          <Stack.Screen name="posts/new" options={{ ...title('Новый пост'), presentation: 'modal' }} />
          <Stack.Screen name="series" options={title('Серии')} />
          <Stack.Screen name="promote/[id]" options={{ ...title('Продвижение'), presentation: 'modal' }} />
          <Stack.Screen name="chat/[id]" options={{ title: '' }} />
          <Stack.Screen name="notifications" options={title('Уведомления')} />
          <Stack.Screen name="my-artworks" options={title('Мои работы')} />
          <Stack.Screen name="stats" options={title('Статистика')} />
          <Stack.Screen name="premium" options={{ ...title('Премиум'), presentation: 'modal' }} />
          <Stack.Screen name="settings/profile" options={title('Профиль')} />
          <Stack.Screen name="settings/workshop" options={title('Мастерская')} />
          <Stack.Screen name="settings/app" options={title('Оформление и язык')} />
          <Stack.Screen name="settings/delete" options={title('Удаление аккаунта')} />
          <Stack.Screen name="admin" options={{ headerShown: false, contentStyle: fullWidth }} />
          <Stack.Screen name="a/[id]" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="u/[id]" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="e/[id]" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="c/[code]" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="collections/[slug]" options={{ headerShown: false, animation: 'none' }} />
        </Stack>
      </NavigationThemeProvider>
    </>
  );
}

/** Настройки устройства (тема, язык) читаются до первого кадра, пока виден сплэш. */
function usePrefs(): { theme: ThemePref; locale: Locale } | null {
  const [prefs, setPrefs] = useState<{ theme: ThemePref; locale: Locale } | null>(null);
  useEffect(() => {
    void (async () => {
      const [theme, locale] = await Promise.all([loadPref('theme'), loadPref('locale')]);
      setPrefs({
        theme: theme === 'light' || theme === 'dark' ? theme : 'system',
        locale: locale === 'ru' || locale === 'en' ? locale : deviceLocale(),
      });
    })();
  }, []);
  return prefs;
}

/** В браузере ползунки прокрутки — тонкие и в цвет темы, а не системные светлые со стрелками. */
function useWebScrollbars(thumb: string, hover: string) {
  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = [`* { scrollbar-width: thin; scrollbar-color: ${thumb} transparent; }`, `*:hover { scrollbar-color: ${hover} transparent; }`].join('\n');
    document.head.appendChild(style);
    return () => style.remove();
  }, [thumb, hover]);
}

function Root() {
  const { colors } = useTheme();
  // в браузере приложение — колонка по центру экрана; админке нужна вся ширина
  useWebScrollbars(colors.hairline, colors.graphite);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.wall }}>
      <RootStack />
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [client] = useState(makeClient);
  const prefs = usePrefs();
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
  if ((!fontsLoaded && !fontError) || !prefs) return null;
  return (
    <I18nProvider initial={prefs.locale}>
      <ThemeProvider initial={prefs.theme}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

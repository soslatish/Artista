import { Ionicons } from '@expo/vector-icons';
import { router, Stack, usePathname } from 'expo-router';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { useSession } from '@/auth/session';
import { adminSections } from '@/features/admin/sections';
import { Button, EmptyState, T } from '@/ui/primitives';
import { fonts, makeStyles, space, useColors } from '@/ui/theme';

const wideFrom = 900;

/** Админка: на широком экране — меню слева, на телефоне — обычные экраны со стрелкой «назад». */
export default function AdminLayout() {
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const styles = useStyles();
  const wide = width >= wideFrom;

  if (user?.role !== 'admin') {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: 'Админка' }} />
        <EmptyState icon="lock-closed-outline" title="Нет доступа" text="Раздел доступен только администраторам." action={<Button title="На главную" variant="secondary" onPress={() => router.replace('/')} />} />
      </View>
    );
  }

  const stack = (
    <Stack
      screenOptions={{
        headerShown: !wide,
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.wall },
        headerTitleStyle: { fontFamily: fonts.sansSemi, fontSize: 17 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.wall },
      }}
    />
  );
  if (!wide) return stack;
  return (
    <View style={styles.wide}>
      <Sidebar />
      <View style={styles.flex}>{stack}</View>
    </View>
  );
}

function Sidebar() {
  const styles = useStyles();
  const colors = useColors();
  const path = usePathname();
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href));
  return (
    <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>
      <Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={styles.brand}>
        <T variant="heading" color={colors.onDark}>
          Artista
        </T>
        <T variant="small" color={colors.onDarkMuted}>
          Админка. Нажмите, чтобы вернуться в приложение
        </T>
      </Pressable>
      {adminSections.map((s) => {
        const on = active(s.href);
        return (
          <Pressable
            key={s.href}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            onPress={() => router.navigate(s.href as never)}
            style={({ pressed }) => [styles.item, on && styles.itemOn, pressed && styles.pressed]}>
            <Ionicons name={s.icon} size={18} color={on ? colors.onDark : colors.onDarkMuted} />
            <T variant="bodyStrong" color={on ? colors.onDark : colors.onDarkMuted}>
              {s.label}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  wide: { flex: 1, flexDirection: 'row', backgroundColor: c.wall },
  flex: { flex: 1 },
  side: { width: 240, flexGrow: 0, backgroundColor: c.brand },
  sideContent: { padding: space.md, gap: 2 },
  brand: { paddingHorizontal: space.sm, paddingVertical: space.lg, gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: 10, borderRadius: 8 },
  itemOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pressed: { opacity: 0.8 },
}));

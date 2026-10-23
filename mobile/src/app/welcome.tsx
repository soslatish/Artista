import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.center}>
        <Image source={require('@/assets/images/splash-logo.png')} style={styles.logo} contentFit="contain" accessibilityLabel="Artista" />
        <T variant="body" center color={colors.onDarkMuted} style={styles.lead}>
          Оригинальные работы художников — напрямую от автора. Деньги поступают художнику только после того, как вы получите работу.
        </T>
      </View>
      <View style={styles.actions}>
        <Button title="Создать аккаунт" variant="light" onPress={() => router.replace('/register')} />
        <Button title="Войти" variant="outlineLight" onPress={() => router.replace('/login')} />
        <Button title="Смотреть без входа" variant="outlineLight" style={styles.ghost} onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bordeaux, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  logo: { width: '100%', height: 220 },
  lead: { maxWidth: 340 },
  actions: { gap: space.md },
  ghost: { borderWidth: 0 },
});

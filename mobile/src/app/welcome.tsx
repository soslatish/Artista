import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { Button, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useStyles();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.center}>
        <Image source={require('@/assets/images/splash-logo.png')} style={styles.logo} contentFit="contain" accessibilityLabel="Artista" />
        <T variant="body" center color="rgba(255,255,255,0.72)" style={styles.lead}>
          {t('Оригинальные работы художников — напрямую от автора. Деньги поступают художнику только после того, как вы получите работу.')}
        </T>
      </View>
      <View style={styles.actions}>
        <Button title={t('Создать аккаунт')} variant="light" onPress={() => router.replace('/register')} />
        <Button title={t('Войти')} variant="outlineLight" onPress={() => router.replace('/login')} />
        <Button title={t('Смотреть без входа')} variant="outlineLight" style={styles.ghost} onPress={() => router.back()} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.brand, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  logo: { width: '100%', height: 220 },
  lead: { maxWidth: 340 },
  actions: { gap: space.md },
  ghost: { borderWidth: 0 },
}));

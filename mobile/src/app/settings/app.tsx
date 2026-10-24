import { useQueryClient } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';

import { type Locale, useLocale, useT } from '@/i18n';
import { Chip, T } from '@/ui/primitives';
import { makeStyles, space, type ThemePref, useTheme } from '@/ui/theme';

const themes: { key: ThemePref; label: string }[] = [
  { key: 'system', label: 'Как в системе' },
  { key: 'light', label: 'Светлая' },
  { key: 'dark', label: 'Тёмная' },
];

const languages: { key: Locale; label: string }[] = [
  { key: 'ru', label: 'Русский' },
  { key: 'en', label: 'English' },
];

export default function AppSettingsScreen() {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const { pref, setPref } = useTheme();
  const { locale, setLocale } = useLocale();

  const changeLocale = (l: Locale) => {
    setLocale(l);
    // справочники и тексты ошибок сервера приходят на выбранном языке — перезапросим
    void qc.invalidateQueries();
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <T variant="heading">{t('Тема')}</T>
        <T variant="small">{t('Тёмная тема — как галерея вечером: работы смотрятся на тёмной стене.')}</T>
        <View style={styles.chips}>
          {themes.map((th) => (
            <Chip key={th.key} label={t(th.label)} selected={pref === th.key} onPress={() => setPref(th.key)} />
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <T variant="heading">{t('Язык')}</T>
        <T variant="small">{t('Язык интерфейса и уведомлений. Описания работ остаются на языке автора.')}</T>
        <View style={styles.chips}>
          {languages.map((l) => (
            <Chip key={l.key} label={l.label} selected={locale === l.key} onPress={() => changeLocale(l.key)} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.xl },
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
}));

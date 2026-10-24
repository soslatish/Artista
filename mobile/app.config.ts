import type { ConfigContext, ExpoConfig } from 'expo/config';

// Домен сайта для universal links (iOS) и app links (Android): ссылки вида
// https://artista.example/a/<id> открываются сразу в приложении. Без переменной
// приложение работает как раньше — по схеме artista://.
const siteHost = (process.env.EXPO_PUBLIC_SITE_HOST ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const linkPrefixes = ['/a/', '/u/', '/e/', '/c/', '/collections/'];

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!siteHost) return base;
  return {
    ...base,
    ios: { ...base.ios, associatedDomains: [`applinks:${siteHost}`] },
    android: {
      ...base.android,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: linkPrefixes.map((pathPrefix) => ({ scheme: 'https', host: siteHost, pathPrefix })),
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
};

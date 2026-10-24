// Веб-превью: нативных вкладок в браузере нет, поэтому JS-вкладки внизу экрана.
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';

import { flatten, useConversations } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useTabsBootstrap } from '@/features/welcome';
import { useT } from '@/i18n';
import { fonts, useTheme } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabs: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Галерея', icon: 'grid-outline', active: 'grid' },
  { name: 'search', title: 'Поиск', icon: 'search-outline', active: 'search' },
  { name: 'favorites', title: 'Избранное', icon: 'heart-outline', active: 'heart' },
  { name: 'messages', title: 'Сообщения', icon: 'chatbubble-outline', active: 'chatbubble' },
  { name: 'profile', title: 'Профиль', icon: 'person-outline', active: 'person' },
];

export default function WebTabsLayout() {
  const { user } = useSession();
  const tr = useT();
  const { colors } = useTheme();
  useTabsBootstrap();
  const conversations = useConversations(!!user);
  const unread = flatten(conversations.data).reduce((sum, c) => sum + c.unread, 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.bordeaux,
        tabBarInactiveTintColor: colors.graphite,
        tabBarStyle: { backgroundColor: colors.wall, borderTopColor: colors.hairline, height: 64, paddingBottom: 8, paddingTop: 4 },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11 },
      }}>
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: tr(t.title),
            tabBarBadge: t.name === 'messages' && unread > 0 ? unread : undefined,
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? t.active : t.icon} color={String(color)} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}

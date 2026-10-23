import { NativeTabs } from 'expo-router/native-tabs';

import { flatten, useConversations } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useTabsBootstrap } from '@/features/welcome';
import { colors, fonts } from '@/ui/theme';

export default function TabsLayout() {
  const { user } = useSession();
  useTabsBootstrap();
  const conversations = useConversations(!!user);
  const unread = flatten(conversations.data).reduce((sum, c) => sum + c.unread, 0);

  return (
    <NativeTabs
      backgroundColor={colors.wall}
      indicatorColor={colors.bordeauxSoft}
      iconColor={{ default: colors.graphite, selected: colors.bordeaux }}
      labelStyle={{ default: { color: colors.graphite, fontFamily: fonts.sansMedium }, selected: { color: colors.bordeaux, fontFamily: fonts.sansSemi } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Галерея</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="grid_view" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>Поиск</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="favorites">
        <NativeTabs.Trigger.Label>Избранное</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'heart', selected: 'heart.fill' }} md="favorite" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Label>Сообщения</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} md="chat_bubble" />
        {unread > 0 ? <NativeTabs.Trigger.Badge>{unread > 9 ? '9+' : String(unread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Профиль</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

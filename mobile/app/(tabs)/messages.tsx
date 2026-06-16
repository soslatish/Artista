import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { ChatPreview } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function MessagesScreen() {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuthStore();

  const fetchChats = async () => {
    try {
      const { data } = await api.get('/messages/chats');
      setChats(data);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, []);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Сообщения</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.orange} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.user.id.toString()}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchChats} tintColor={COLORS.orange} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chatItem}
              onPress={() => router.push(`/chat/${item.user.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.avatarWrap}>
                <Avatar uri={item.user.avatar_url} name={item.user.name} size={50} />
                {item.unread_count > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unread_count}</Text>
                  </View>
                )}
              </View>
              <View style={styles.chatContent}>
                <View style={styles.chatHeader}>
                  <Text style={styles.chatName} numberOfLines={1}>{item.user.name}</Text>
                  {item.last_message && (
                    <Text style={styles.chatTime}>{formatTime(item.last_message.created_at)}</Text>
                  )}
                </View>
                {item.last_message && (
                  <Text style={[styles.chatPreview, item.unread_count > 0 && styles.chatPreviewUnread]} numberOfLines={1}>
                    {item.last_message.sender_id === user?.id ? 'Вы: ' : ''}
                    {item.last_message.content}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Нет сообщений</Text>
              <Text style={styles.emptyHint}>Начните общение с исполнителем или заказчиком</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '900', color: COLORS.white },
  chatItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  avatarWrap: { position: 'relative' },
  badge: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: COLORS.orange, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: COLORS.white, fontSize: 10, fontWeight: '800' },
  chatContent: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  chatName: { flex: 1, color: COLORS.white, fontSize: 15, fontWeight: '700', marginRight: 8 },
  chatTime: { color: COLORS.textMuted, fontSize: 12 },
  chatPreview: { color: COLORS.textSecondary, fontSize: 13 },
  chatPreviewUnread: { color: COLORS.white, fontWeight: '600' },
  separator: { height: 1, backgroundColor: COLORS.cardBorder, marginLeft: 78 },
  empty: { alignItems: 'center', marginTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
});

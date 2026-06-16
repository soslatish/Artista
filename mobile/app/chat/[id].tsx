import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { Message, User } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { COLORS, RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      api.get(`/users/${id}`).then((r) => setOtherUser(r.data)),
      api.get(`/messages/${id}`).then((r) => setMessages(r.data)),
    ]).finally(() => setLoading(false));

    // Poll every 5 seconds for new messages
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/messages/${id}`);
        setMessages(data);
      } catch {}
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  const sendMessage = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    try {
      const { data } = await api.post(`/messages/${id}`, { content });
      setMessages((prev) => [...prev, data]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setText(content);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        {otherUser && (
          <TouchableOpacity style={styles.userInfo} onPress={() => router.push(`/user/${otherUser.id}`)}>
            <Avatar uri={otherUser.avatar_url} name={otherUser.name} size={36} />
            <View>
              <Text style={styles.userName}>{otherUser.name}</Text>
              <Text style={styles.userRole}>{otherUser.role === 'artist' ? 'Исполнитель' : 'Заказчик'}</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.orange} style={{ flex: 1 }} />
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.messageList}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const isMine = item.sender_id === user?.id;
              return (
                <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
                  <Text style={styles.bubbleText}>{item.content}</Text>
                  <Text style={styles.bubbleTime}>{formatTime(item.created_at)}</Text>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Начните диалог</Text>
              </View>
            }
          />
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Сообщение..."
              placeholderTextColor={COLORS.textMuted}
              style={styles.textInput}
              multiline
              maxLength={2000}
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity onPress={sendMessage} disabled={!text.trim() || sending} style={styles.sendBtn}>
              <Ionicons name="send" size={20} color={text.trim() ? COLORS.orange : COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
    backgroundColor: COLORS.bgDark,
  },
  backBtn: { marginRight: 12 },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  userName: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  userRole: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  messageList: { padding: 16, gap: 8, flexGrow: 1 },
  bubble: {
    maxWidth: '78%', padding: 12, borderRadius: RADIUS.lg,
    marginBottom: 4,
  },
  bubbleMine: { backgroundColor: COLORS.orange + 'CC', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.card, alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.cardBorder },
  bubbleText: { color: COLORS.white, fontSize: 15, lineHeight: 21 },
  bubbleTime: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 15 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.bgDark,
  },
  textInput: {
    flex: 1, color: COLORS.white, fontSize: 15,
    backgroundColor: COLORS.inputBg, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.inputBorder,
    paddingHorizontal: 14, paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.inputBg, alignItems: 'center', justifyContent: 'center',
  },
});

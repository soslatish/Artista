import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { flatten, keys, useMessages } from '@/api/hooks';
import type { Message } from '@/api/types';
import { useSession } from '@/auth/session';
import { formatMessageTime } from '@/lib/format';
import { validId } from '@/lib/guard';
import { EmptyState, ErrorState, IconButton, Loading, Notice, T } from '@/ui/primitives';
import { colors, radius, space, type } from '@/ui/theme';

export default function ChatRoute() {
  const params = useLocalSearchParams();
  const id = validId(params.id);
  const name = typeof params.name === 'string' ? params.name.slice(0, 80) : '';
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <Chat id={id} name={name} />;
}

function Chat({ id, name }: { id: string; name: string }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const q = useMessages(id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messages = flatten(q.data);

  // отмечаем прочитанным при открытии и при новых сообщениях
  const newestId = messages[0]?.id;
  useEffect(() => {
    if (!newestId) return;
    post(`/conversations/${id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: keys.conversations }))
      .catch(() => undefined);
  }, [id, newestId, qc]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const m = await post<Message>(`/conversations/${id}/messages`, { body });
      setText('');
      qc.setQueryData(keys.messages(id), (old: typeof q.data) =>
        old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, items: [m, ...p.items.filter((x) => x.id !== m.id)] } : p)) } : old,
      );
      qc.invalidateQueries({ queryKey: keys.conversations });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: name || 'Диалог' }} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={messages}
          inverted={messages.length > 0}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          renderItem={({ item }) => <Bubble m={item} mine={item.sender_id === user?.id} />}
          ListEmptyComponent={<EmptyState icon="chatbubble-ellipses-outline" title="Начните разговор" text="Спросите о работе, оформлении или сроках отправки." />}
        />
      )}
      {error ? (
        <View style={styles.errorBox}>
          <Notice tone="danger" text={error} />
        </View>
      ) : null}
      <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение"
          placeholderTextColor={colors.graphite}
          multiline
          maxLength={2000}
          style={styles.input}
          accessibilityLabel="Текст сообщения"
        />
        <IconButton icon="arrow-up-circle" size={36} color={text.trim() ? colors.bordeaux : colors.hairline} label="Отправить" onPress={send} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine }: { m: Message; mine: boolean }) {
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <T variant="body" color={mine ? colors.onDark : colors.ink}>
          {m.body}
        </T>
        <T variant="small" color={mine ? colors.onDarkMuted : colors.graphite} style={styles.time}>
          {formatMessageTime(m.created_at)}
          {mine && m.read_at ? ', прочитано' : ''}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  list: { padding: space.lg, gap: space.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.bordeaux, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderBottomLeftRadius: 4 },
  time: { alignSelf: 'flex-end', fontSize: 11 },
  errorBox: { paddingHorizontal: space.lg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.wall },
  input: { ...type.body, flex: 1, maxHeight: 120, minHeight: 42, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.control, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.paper },
});

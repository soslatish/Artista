import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { flatten, keys, useMessages } from '@/api/hooks';
import type { Message } from '@/api/types';
import { uploadImage } from '@/api/upload';
import { useSession } from '@/auth/session';
import { pickPhotos } from '@/features/pick-photos';
import { useT } from '@/i18n';
import { formatMessageTime } from '@/lib/format';
import { validId } from '@/lib/guard';
import { EmptyState, ErrorState, IconButton, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { ImageViewer } from '@/ui/zoom';

export default function ChatRoute() {
  const params = useLocalSearchParams();
  const id = validId(params.id);
  const t = useT();
  const name = typeof params.name === 'string' ? params.name.slice(0, 80) : '';
  const draft = typeof params.draft === 'string' ? params.draft.slice(0, 500) : '';
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <Chat id={id} name={name} draft={draft} />;
}

function Chat({ id, name, draft }: { id: string; name: string; draft: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const q = useMessages(id);
  const [text, setText] = useState(draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<string | null>(null);
  const messages = flatten(q.data);

  // отмечаем прочитанным при открытии и при новых сообщениях
  const newestId = messages[0]?.id;
  useEffect(() => {
    if (!newestId) return;
    post(`/conversations/${id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: keys.conversations }))
      .catch(() => undefined);
  }, [id, newestId, qc]);

  const pushMessage = (m: Message) => {
    qc.setQueryData(keys.messages(id), (old: typeof q.data) =>
      old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, items: [m, ...p.items.filter((x) => x.id !== m.id)] } : p)) } : old,
    );
    qc.invalidateQueries({ queryKey: keys.conversations });
  };

  const send = async (imageUrl = '') => {
    const body = imageUrl ? '' : text.trim();
    if ((!body && !imageUrl) || sending) return;
    setSending(true);
    setError('');
    try {
      const m = await post<Message>(`/conversations/${id}/messages`, { body, image_url: imageUrl });
      if (!imageUrl) setText('');
      pushMessage(m);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async () => {
    const [asset] = await pickPhotos('library', 1);
    if (!asset) return;
    setSending(true);
    try {
      const url = await uploadImage(asset);
      setSending(false);
      await send(url);
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: name || t('Диалог') }} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={messages}
          inverted={messages.length > 0}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          renderItem={({ item }) => <Bubble m={item} mine={item.sender_id === user?.id} onOpenImage={setViewer} />}
          ListEmptyComponent={<EmptyState icon="chatbubble-ellipses-outline" title={t('Начните разговор')} text={t('Спросите о работе, оформлении или сроках отправки. Можно отправить фото — например, эскиз или интерьер.')} />}
        />
      )}
      {error ? (
        <View style={styles.errorBox}>
          <Notice tone="danger" text={error} />
        </View>
      ) : null}
      <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
        <IconButton icon="image-outline" size={26} color={colors.graphite} label={t('Отправить фото')} onPress={sendPhoto} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('Сообщение')}
          placeholderTextColor={colors.graphite}
          multiline
          maxLength={2000}
          style={styles.input}
          accessibilityLabel={t('Текст сообщения')}
        />
        {sending ? (
          <ActivityIndicator style={styles.sending} color={colors.bordeaux} />
        ) : (
          <IconButton icon="arrow-up-circle" size={36} color={text.trim() ? colors.bordeaux : colors.hairline} label={t('Отправить')} onPress={() => void send()} />
        )}
      </View>
      {viewer ? <ImageViewer images={[viewer]} index={0} visible title="" onClose={() => setViewer(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, onOpenImage }: { m: Message; mine: boolean; onOpenImage: (url: string) => void }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {m.image_url ? (
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('Открыть фото')} onPress={() => onOpenImage(m.image_url)}>
            <Image source={{ uri: m.image_url }} style={styles.image} contentFit="cover" />
          </Pressable>
        ) : null}
        {m.body ? (
          <T variant="body" color={mine ? '#FFFFFF' : colors.ink}>
            {m.body}
          </T>
        ) : null}
        <T variant="small" color={mine ? 'rgba(255,255,255,0.72)' : colors.graphite} style={styles.time}>
          {formatMessageTime(m.created_at)}
          {mine && m.read_at ? `, ${t('прочитано')}` : ''}
        </T>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c, t) => ({
  root: { flex: 1, backgroundColor: c.wall },
  list: { padding: space.lg, gap: space.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 16, gap: 4 },
  bubbleMine: { backgroundColor: c.bordeaux, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: c.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, borderBottomLeftRadius: 4 },
  image: { width: 220, height: 220, borderRadius: 10, backgroundColor: c.plaster },
  time: { alignSelf: 'flex-end', fontSize: 11 },
  errorBox: { paddingHorizontal: space.lg },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.hairline,
    backgroundColor: c.wall,
  },
  input: { ...t.body, flex: 1, maxHeight: 120, minHeight: 42, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.control, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper },
  sending: { width: 44, height: 44 },
}));

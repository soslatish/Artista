// Вопросы и ответы под работой: видны всем покупателям, снимают повторяющиеся вопросы в чате.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { del, errorText, post } from '@/api/client';
import { flatten, keys, useQuestions } from '@/api/hooks';
import type { Question } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { requireAuth } from '@/lib/guard';
import { Button, Field, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const COLLAPSED = 3;

export function QuestionsBlock({ artworkId, artistId }: { artworkId: string; artistId: string }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const { user } = useSession();
  const q = useQuestions(artworkId);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = flatten(q.data);
  const isArtist = user?.id === artistId;
  const shown = expanded ? items : items.slice(0, COLLAPSED);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.questions(artworkId) });

  const ask = async () => {
    if (!requireAuth(!!user)) return;
    setBusy(true);
    setError('');
    try {
      await post(`/artworks/${artworkId}/questions`, { body: text.trim() });
      setText('');
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.block}>
      <T variant="heading">{t('Вопросы о работе')}</T>
      {items.length === 0 && !q.isLoading ? <T variant="small">{t('Вопросов пока нет. Спросите о раме, упаковке или деталях — ответ увидят все.')}</T> : null}
      {shown.map((item) => (
        <QuestionRow key={item.id} q={item} canAnswer={isArtist} canDelete={isArtist || user?.id === item.author.id} onChange={refresh} />
      ))}
      {items.length > COLLAPSED ? (
        <Button title={expanded ? t('Свернуть') : t('Все вопросы ({n})', { n: items.length })} variant="ghost" onPress={() => setExpanded((v) => !v)} />
      ) : null}
      {!isArtist ? (
        <View style={styles.ask}>
          <Field label={t('Ваш вопрос')} value={text} onChangeText={setText} maxLength={500} placeholder={t('Например, работа оформлена в раму?')} />
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title={t('Спросить')} variant="secondary" loading={busy} disabled={text.trim().length < 3} onPress={ask} />
        </View>
      ) : null}
    </View>
  );
}

function QuestionRow({ q, canAnswer, canDelete, onChange }: { q: Question; canAnswer: boolean; canDelete: boolean; onChange: () => void }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await post(`/questions/${q.id}/answer`, { answer: answer.trim() });
      setAnswer('');
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    void del(`/questions/${q.id}`)
      .then(onChange)
      .catch((e) => setError(errorText(e)));

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <T variant="bodyStrong" style={styles.flex}>
          {q.body}
        </T>
        {canDelete ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Удалить вопрос')} hitSlop={10} onPress={remove}>
            <T variant="small" color={colors.graphite}>
              {t('Удалить')}
            </T>
          </Pressable>
        ) : null}
      </View>
      <T variant="small">
        {q.author.name}, {formatDate(q.created_at)}
      </T>
      {q.answer ? (
        <View style={styles.answer}>
          <T variant="smallStrong">{t('Ответ художника')}</T>
          <T variant="body">{q.answer}</T>
        </View>
      ) : canAnswer ? (
        <View style={styles.ask}>
          <Field label={t('Ответ')} value={answer} onChangeText={setAnswer} multiline maxLength={1000} />
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title={t('Ответить')} loading={busy} disabled={!answer.trim()} onPress={send} />
        </View>
      ) : (
        <T variant="small" color={colors.graphite}>
          {t('Ждёт ответа художника')}
        </T>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  block: { gap: space.md },
  flex: { flex: 1 },
  row: { gap: 4, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.hairline },
  rowHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  answer: { marginTop: space.xs, padding: space.md, borderRadius: radius.control, backgroundColor: c.paper, gap: 2 },
  ask: { gap: space.sm, marginTop: space.xs },
}));

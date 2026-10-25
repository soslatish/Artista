// Прямая сделка: открыть чат с художником (по работе) и подставить первое сообщение.
import { router } from 'expo-router';
import { useState } from 'react';

import { errorText, post } from '@/api/client';
import type { Conversation } from '@/api/types';
import { useSession } from '@/auth/session';
import { notify } from '@/lib/confirm';
import { requireAuth } from '@/lib/guard';
import { t } from '@/i18n';

interface ContactTarget {
  artistId: string;
  artistName: string;
  artworkId?: string;
  /** Черновик первого сообщения — человек может поправить его перед отправкой. */
  draft?: string;
}

export function useContactArtist(): { contact: (target: ContactTarget) => Promise<void>; busy: boolean } {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const contact = async ({ artistId, artistName, artworkId, draft }: ContactTarget) => {
    if (!requireAuth(!!user) || busy) return;
    setBusy(true);
    try {
      const c = await post<Conversation>('/conversations', { user_id: artistId, artwork_id: artworkId });
      router.push({ pathname: '/chat/[id]', params: { id: c.id, name: artistName, draft: draft ?? '' } });
    } catch (e) {
      notify(t('Не удалось открыть чат'), errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { contact, busy };
}

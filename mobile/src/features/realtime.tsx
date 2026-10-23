// WebSocket-мост: новые сообщения и уведомления обновляют кэш без перезагрузки экранов.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { API_URL, currentAccessToken, refreshTokens } from '@/api/client';
import { keys } from '@/api/hooks';
import type { Message } from '@/api/types';
import { useSession } from '@/auth/session';

const RECONNECT_MS = [1000, 3000, 10000, 30000];

interface ServerEvent {
  type: 'message' | 'read' | 'notification';
  data: unknown;
}

export function RealtimeBridge() {
  const { user } = useSession();
  const userId = user?.id;
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refetchMissed = () => {
      qc.invalidateQueries({ queryKey: keys.conversations });
      qc.invalidateQueries({ queryKey: keys.notifications });
      qc.invalidateQueries({ queryKey: ['messages'] });
    };

    const connect = () => {
      // токен читаем в момент подключения: за время в фоне он мог обновиться
      const token = currentAccessToken();
      if (!token || closed) return;
      let opened = false;
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        opened = true;
        if (attempt > 0) refetchMissed(); // события, пропущенные без связи
        attempt = 0;
      };
      ws.onmessage = (e) => {
        let ev: ServerEvent;
        try {
          ev = JSON.parse(String(e.data)) as ServerEvent;
        } catch {
          return;
        }
        if (ev.type === 'message') {
          const m = ev.data as Message;
          qc.invalidateQueries({ queryKey: keys.messages(m.conversation_id) });
          qc.invalidateQueries({ queryKey: keys.conversations });
        } else if (ev.type === 'read') {
          const id = (ev.data as { conversation_id?: string }).conversation_id;
          if (id) qc.invalidateQueries({ queryKey: keys.messages(id) });
          qc.invalidateQueries({ queryKey: keys.conversations });
        } else if (ev.type === 'notification') {
          qc.invalidateQueries({ queryKey: keys.notifications });
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order'] });
        }
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)];
        // соединение не открылось — скорее всего истёк access-токен: обновим перед повтором
        const before = opened ? Promise.resolve(true) : refreshTokens().catch(() => false);
        void before.then(() => {
          if (!closed) timer = setTimeout(connect, delay);
        });
      };
    };
    connect();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (!ws || ws.readyState === WebSocket.CLOSED)) {
        clearTimeout(timer);
        connect();
      }
    });
    return () => {
      closed = true;
      clearTimeout(timer);
      sub.remove();
      ws?.close();
    };
  }, [userId, qc]);

  return null;
}

// WebSocket-мост: новые сообщения и уведомления обновляют кэш без перезагрузки экранов.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { API_URL } from '@/api/client';
import { keys } from '@/api/hooks';
import type { Message } from '@/api/types';
import { useSession } from '@/auth/session';

const RECONNECT_MS = [1000, 3000, 10000, 30000];

interface ServerEvent {
  type: 'message' | 'read' | 'notification';
  data: unknown;
}

export function RealtimeBridge() {
  const { accessToken, user } = useSession();
  const qc = useQueryClient();

  useEffect(() => {
    if (!accessToken || !user) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      const url = `${API_URL.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(accessToken)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
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
          qc.invalidateQueries({ queryKey: keys.conversations });
        } else if (ev.type === 'notification') {
          qc.invalidateQueries({ queryKey: keys.notifications });
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order'] });
        }
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
      };
    };
    connect();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && ws?.readyState === WebSocket.CLOSED) {
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
  }, [accessToken, user, qc]);

  return null;
}

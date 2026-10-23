package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/soslatish/artista/backend/internal/httpx"
)

// Event — событие, отправляемое клиенту по WebSocket.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// Hub хранит WebSocket-подключения пользователей (в пределах одного инстанса API).
type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[chan Event]struct{}
}

// NewHub создаёт хаб.
func NewHub() *Hub { return &Hub{conns: map[string]map[chan Event]struct{}{}} }

func (h *Hub) subscribe(userID string) chan Event {
	ch := make(chan Event, 32)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[userID] == nil {
		h.conns[userID] = map[chan Event]struct{}{}
	}
	h.conns[userID][ch] = struct{}{}
	return ch
}

func (h *Hub) unsubscribe(userID string, ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns[userID], ch)
	if len(h.conns[userID]) == 0 {
		delete(h.conns, userID)
	}
}

// Send отправляет событие всем подключениям пользователя; медленные клиенты пропускают событие.
func (h *Hub) Send(userID string, e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.conns[userID] {
		select {
		case ch <- e:
		default:
		}
	}
}

const wsPingInterval = 30 * time.Second

// websocket — GET /api/v1/ws?token=<access> (или заголовок Authorization).
func (s *Server) websocket(w http.ResponseWriter, r *http.Request) {
	if t := r.URL.Query().Get("token"); t != "" && r.Header.Get("Authorization") == "" {
		r.Header.Set("Authorization", "Bearer "+t)
	}
	u, ok := s.userFromRequest(r)
	if !ok {
		httpx.Fail(w, r, s.Log, httpx.Unauthorized("Требуется вход"))
		return
	}
	opts := &websocket.AcceptOptions{}
	if slices.Contains(s.Config.CORSOrigins, "*") {
		opts.InsecureSkipVerify = true // нативные клиенты не присылают Origin; токен обязателен
	} else {
		for _, o := range s.Config.CORSOrigins {
			opts.OriginPatterns = append(opts.OriginPatterns, strings.TrimPrefix(strings.TrimPrefix(o, "https://"), "http://"))
		}
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		s.Log.Warn("ws accept", "err", err)
		return
	}
	defer conn.CloseNow()

	ch := s.hub.subscribe(u.ID)
	defer s.hub.unsubscribe(u.ID, ch)

	ctx := conn.CloseRead(r.Context()) // входящие сообщения клиенту не нужны
	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		case e := <-ch:
			if err := writeEvent(ctx, conn, e); err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func writeEvent(ctx context.Context, conn *websocket.Conn, e Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, b)
}

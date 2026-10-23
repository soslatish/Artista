package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/soslatish/artista/backend/internal/httpx"
)

type notificationDTO struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Data      map[string]any `json:"data"`
	ReadAt    *time.Time     `json:"read_at"`
	CreatedAt time.Time      `json:"created_at"`
}

// notify сохраняет in-app уведомление, шлёт его по WebSocket и push. Ошибки только логируются.
func (s *Server) notify(ctx context.Context, userID, typ, title, body string, data map[string]any) {
	var n notificationDTO
	err := s.DB.QueryRow(ctx, `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)
		RETURNING id, type, title, body, data, read_at, created_at`, userID, typ, title, body, data).
		Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Data, &n.ReadAt, &n.CreatedAt)
	if err != nil {
		s.Log.Error("save notification", "err", err)
		return
	}
	s.hub.Send(userID, Event{Type: "notification", Data: n})
	s.pushOnly(ctx, userID, title, body, data)
}

// pushOnly отправляет push без сохранения в ленту уведомлений.
func (s *Server) pushOnly(ctx context.Context, userID, title, body string, data map[string]any) {
	s.pushTo(ctx, []string{userID}, title, body, data)
}

// pushTo отправляет одно push-уведомление на все устройства перечисленных пользователей.
func (s *Server) pushTo(ctx context.Context, userIDs []string, title, body string, data map[string]any) {
	if len(userIDs) == 0 {
		return
	}
	tokens, err := collectIDs(ctx, s.DB, `SELECT token FROM device_tokens WHERE user_id = ANY($1::uuid[])`, userIDs)
	if err != nil {
		s.Log.Error("load device tokens", "err", err)
		return
	}
	for start := 0; start < len(tokens); start += pushBatch {
		batch := tokens[start:min(start+pushBatch, len(tokens))]
		if err := s.Pusher.Push(ctx, batch, title, body, data); err != nil {
			s.Log.Error("push", "err", err)
		}
	}
}

const pushBatch = 100 // лимит Expo Push на один запрос

// notifyFollowersAsync уведомляет подписчиков о новой работе в фоне (остановка сервера дождётся).
func (s *Server) notifyFollowersAsync(artistID, artworkID, title string) {
	s.goBackground(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.notifyFollowers(ctx, artistID, artworkID, title)
	})
}

// notifyFollowers создаёт уведомления всем подписчикам одним запросом и рассылает push пачками.
func (s *Server) notifyFollowers(ctx context.Context, artistID, artworkID, title string) {
	var artistName string
	if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, artistID).Scan(&artistName); err != nil {
		s.Log.Error("notify followers", "err", err)
		return
	}
	heading := "Новая работа: " + artistName
	body := fmt.Sprintf("«%s»", title)
	data := map[string]any{"artwork_id": artworkID}
	rows, err := s.DB.Query(ctx, `INSERT INTO notifications (user_id, type, title, body, data)
		SELECT f.follower_id, 'new_artwork', $2::text, $3::text, $4::jsonb FROM follows f JOIN users u ON u.id = f.follower_id
		WHERE f.artist_id = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL
		RETURNING id, user_id, type, title, body, data, read_at, created_at`, artistID, heading, body, data)
	if err != nil {
		s.Log.Error("notify followers", "err", err)
		return
	}
	var followers []string
	for rows.Next() {
		var n notificationDTO
		var userID string
		if err := rows.Scan(&n.ID, &userID, &n.Type, &n.Title, &n.Body, &n.Data, &n.ReadAt, &n.CreatedAt); err != nil {
			s.Log.Error("notify followers", "err", err)
			break
		}
		followers = append(followers, userID)
		s.hub.Send(userID, Event{Type: "notification", Data: n})
	}
	rows.Close()
	s.pushTo(ctx, followers, heading, body, data)
}

func (s *Server) listNotifications(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`SELECT id, type, title, body, data, read_at, created_at
		FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []notificationDTO{}
	for rows.Next() {
		var n notificationDTO
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Data, &n.ReadAt, &n.CreatedAt); err != nil {
			return err
		}
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var unread int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, u.ID).Scan(&unread); err != nil {
		return err
	}
	meta := p.meta(len(items))
	meta["unread"] = unread
	httpx.JSON(w, http.StatusOK, items, meta)
	return nil
}

func (s *Server) readNotifications(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		IDs []string `json:"ids"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	for _, id := range in.IDs {
		if !isUUID(id) {
			return httpx.BadRequest("Некорректный id уведомления")
		}
	}
	var err error
	if len(in.IDs) == 0 {
		_, err = s.DB.Exec(r.Context(), `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, u.ID)
	} else {
		_, err = s.DB.Exec(r.Context(), `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`, u.ID, in.IDs)
	}
	if err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

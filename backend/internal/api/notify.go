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
	rows, err := s.DB.Query(ctx, `SELECT token FROM device_tokens WHERE user_id = $1`, userID)
	if err != nil {
		s.Log.Error("load device tokens", "err", err)
		return
	}
	var tokens []string
	for rows.Next() {
		var t string
		if rows.Scan(&t) == nil {
			tokens = append(tokens, t)
		}
	}
	rows.Close()
	if err := s.Pusher.Push(ctx, tokens, title, body, data); err != nil {
		s.Log.Error("push", "err", err)
	}
}

// notifyFollowersAsync уведомляет подписчиков о новой работе в фоне.
func (s *Server) notifyFollowersAsync(artistID, artworkID, title string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.notifyFollowers(ctx, artistID, artworkID, title)
	}()
}

func (s *Server) notifyFollowers(ctx context.Context, artistID, artworkID, title string) {
	var artistName string
	if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, artistID).Scan(&artistName); err != nil {
		s.Log.Error("notify followers", "err", err)
		return
	}
	rows, err := s.DB.Query(ctx, `SELECT follower_id FROM follows WHERE artist_id = $1`, artistID)
	if err != nil {
		s.Log.Error("notify followers", "err", err)
		return
	}
	var followers []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			followers = append(followers, id)
		}
	}
	rows.Close()
	for _, f := range followers {
		s.notify(ctx, f, "new_artwork", "Новая работа: "+artistName, fmt.Sprintf("«%s»", title),
			map[string]any{"artwork_id": artworkID})
	}
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

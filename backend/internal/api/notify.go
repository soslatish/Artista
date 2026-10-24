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

// text — строка уведомления на двух языках; выбирается по языку получателя (users.locale).
type text struct{ ru, en string }

// tr — уведомление с подстановками (одинаковые аргументы для обоих языков).
func tr(ru, en string, args ...any) text {
	return text{fmt.Sprintf(ru, args...), fmt.Sprintf(en, args...)}
}

func (t text) in(locale string) string {
	if locale == "en" && t.en != "" {
		return t.en
	}
	return t.ru
}

// notify сохраняет in-app уведомление на языке получателя, шлёт его по WebSocket и push.
// Ошибки только логируются.
func (s *Server) notify(ctx context.Context, userID, typ string, title, body text, data map[string]any) {
	var n notificationDTO
	err := s.DB.QueryRow(ctx, `INSERT INTO notifications (user_id, type, title, body, data)
		SELECT u.id, $2, CASE WHEN u.locale = 'en' THEN $4 ELSE $3 END, CASE WHEN u.locale = 'en' THEN $6 ELSE $5 END, $7
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL
		RETURNING id, type, title, body, data, read_at, created_at`,
		userID, typ, title.ru, title.en, body.ru, body.en, data).
		Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Data, &n.ReadAt, &n.CreatedAt)
	if isNoRows(err) {
		return
	}
	if err != nil {
		s.Log.Error("save notification", "err", err)
		return
	}
	s.hub.Send(userID, Event{Type: "notification", Data: n})
	s.pushTo(ctx, []string{userID}, n.Title, n.Body, data)
}

// pushOnly отправляет push без сохранения в ленту уведомлений (готовый текст).
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

// notifyMany создаёт уведомления пользователям, выбранным запросом recipients (возвращает id
// пользователей; $1… — его аргументы), одним INSERT … SELECT и рассылает push пачками по языкам.
func (s *Server) notifyMany(ctx context.Context, recipients string, args []any, typ string, title, body text, data map[string]any) int {
	n := len(args)
	sql := fmt.Sprintf(`INSERT INTO notifications (user_id, type, title, body, data)
		SELECT u.id, $%d, CASE WHEN u.locale = 'en' THEN $%d ELSE $%d END, CASE WHEN u.locale = 'en' THEN $%d ELSE $%d END, $%d::jsonb
		FROM users u WHERE u.id IN (%s) AND u.deleted_at IS NULL AND u.banned_at IS NULL
		RETURNING id, user_id, type, title, body, data, read_at, created_at,
			(SELECT locale FROM users WHERE id = user_id)`, n+1, n+3, n+2, n+5, n+4, n+6, recipients)
	all := append(append([]any{}, args...), typ, title.ru, title.en, body.ru, body.en, data)
	rows, err := s.DB.Query(ctx, sql, all...)
	if err != nil {
		s.Log.Error("notify many", "type", typ, "err", err)
		return 0
	}
	byLocale := map[string][]string{}
	count := 0
	for rows.Next() {
		var nt notificationDTO
		var userID, locale string
		if err := rows.Scan(&nt.ID, &userID, &nt.Type, &nt.Title, &nt.Body, &nt.Data, &nt.ReadAt, &nt.CreatedAt, &locale); err != nil {
			s.Log.Error("notify many", "err", err)
			break
		}
		byLocale[locale] = append(byLocale[locale], userID)
		s.hub.Send(userID, Event{Type: "notification", Data: nt})
		count++
	}
	rows.Close()
	for locale, ids := range byLocale {
		s.pushTo(ctx, ids, title.in(locale), body.in(locale), data)
	}
	return count
}

// background запускает задачу с собственным таймаутом (остановка сервера её дождётся).
func (s *Server) background(timeout time.Duration, fn func(ctx context.Context)) {
	s.goBackground(func() {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		fn(ctx)
	})
}

// announceArtworkAsync — первая публикация работы: подписчики художника и сохранённые поиски.
func (s *Server) announceArtworkAsync(artistID, artworkID, title string) {
	s.background(2*time.Minute, func(ctx context.Context) {
		s.notifyFollowers(ctx, artistID, artworkID, title)
		s.matchSavedSearches(ctx, artworkID)
	})
}

// notifyFollowers уведомляет подписчиков художника о новой работе.
func (s *Server) notifyFollowers(ctx context.Context, artistID, artworkID, title string) {
	var artistName string
	if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, artistID).Scan(&artistName); err != nil {
		s.Log.Error("notify followers", "err", err)
		return
	}
	s.notifyMany(ctx, `SELECT follower_id FROM follows WHERE artist_id = $1`, []any{artistID}, "new_artwork",
		tr("Новая работа: %s", "New artwork by %s", artistName), tr("«%s»", "“%s”", title),
		map[string]any{"artwork_id": artworkID})
}

// notifyPriceDropAsync — цена работы снижена: сообщаем тем, у кого она в избранном.
func (s *Server) notifyPriceDropAsync(artworkID, artistID, title string, oldKop, newKop int64) {
	s.background(time.Minute, func(ctx context.Context) {
		s.notifyMany(ctx, `SELECT user_id FROM favorites WHERE artwork_id = $1 AND user_id <> $2`, []any{artworkID, artistID},
			"price_drop", tr("Цена снижена", "Price drop"),
			tr("«%s» — теперь %s вместо %s", "“%s” is now %s instead of %s", title, rub(newKop), rub(oldKop)),
			map[string]any{"artwork_id": artworkID})
	})
}

// rub форматирует копейки как «12 500 ₽».
func rub(kop int64) string {
	n := kop / 100
	s := fmt.Sprintf("%d", n)
	out := make([]byte, 0, len(s)+len(s)/3+4)
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, " "...)
		}
		out = append(out, s[i])
	}
	return string(out) + " ₽"
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

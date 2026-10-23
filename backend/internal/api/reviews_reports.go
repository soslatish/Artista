package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/httpx"
)

type reviewDTO struct {
	ID        string    `json:"id"`
	Rating    int       `json:"rating"`
	Text      string    `json:"text"`
	Author    party     `json:"author"`
	Artwork   string    `json:"artwork_title"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Server) createReview(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Rating int    `json:"rating"`
		Text   string `json:"text"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if in.Rating < 1 || in.Rating > 5 {
		return httpx.Validation(map[string]string{"rating": "Оценка от 1 до 5"})
	}
	if utf8.RuneCountInString(in.Text) > 2000 {
		return httpx.Validation(map[string]string{"text": "Отзыв — до 2000 символов"})
	}
	var buyerID, artistID, status, title string
	err = s.DB.QueryRow(r.Context(), `SELECT o.buyer_id, o.artist_id, o.status, a.title FROM orders o
		JOIN artworks a ON a.id = o.artwork_id WHERE o.id = $1`, id).Scan(&buyerID, &artistID, &status, &title)
	if isNoRows(err) || (err == nil && buyerID != u.ID) {
		return httpx.NotFound("Заказ не найден")
	}
	if err != nil {
		return err
	}
	if status != "completed" {
		return httpx.Conflict("order_not_completed", "Отзыв можно оставить после получения работы")
	}
	var rid string
	err = s.DB.QueryRow(r.Context(), `INSERT INTO reviews (order_id, author_id, artist_id, rating, text)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`, id, u.ID, artistID, in.Rating, strings.TrimSpace(in.Text)).Scan(&rid)
	if isUniqueViolation(err) {
		return httpx.Conflict("review_exists", "Вы уже оставили отзыв")
	}
	if err != nil {
		return err
	}
	s.notify(r.Context(), artistID, "new_review", "Новый отзыв", fmt.Sprintf("%d★ за «%s»", in.Rating, title), map[string]any{"review_id": rid})
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": rid}, nil)
	return nil
}

func (s *Server) userReviews(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`SELECT rv.id, rv.rating, rv.text, au.id, au.name, au.avatar_url, a.title, rv.created_at
		FROM reviews rv JOIN users au ON au.id = rv.author_id JOIN orders o ON o.id = rv.order_id JOIN artworks a ON a.id = o.artwork_id
		WHERE rv.artist_id = $1 ORDER BY rv.created_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), id)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []reviewDTO{}
	for rows.Next() {
		var rv reviewDTO
		if err := rows.Scan(&rv.ID, &rv.Rating, &rv.Text, &rv.Author.ID, &rv.Author.Name, &rv.Author.AvatarURL, &rv.Artwork, &rv.CreatedAt); err != nil {
			return err
		}
		items = append(items, rv)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

// ---------- жалобы и модерация ----------

type reportDTO struct {
	ID         string     `json:"id"`
	ReporterID string     `json:"reporter_id"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	Reason     string     `json:"reason"`
	Status     string     `json:"status"`
	Resolution string     `json:"resolution"`
	CreatedAt  time.Time  `json:"created_at"`
	ResolvedAt *time.Time `json:"resolved_at"`
}

func (s *Server) createReport(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Reason     string `json:"reason"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	table := map[string]string{"artwork": "artworks", "user": "users", "message": "messages"}[in.TargetType]
	if table == "" || !isUUID(in.TargetID) {
		return httpx.Validation(map[string]string{"target": "Некорректный объект жалобы"})
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Reason)); n < 3 || n > 1000 {
		return httpx.Validation(map[string]string{"reason": "Опишите причину (3–1000 символов)"})
	}
	var exists bool
	if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM `+table+` WHERE id = $1)`, in.TargetID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.NotFound("Объект жалобы не найден")
	}
	var id string
	if err := s.DB.QueryRow(r.Context(), `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4) RETURNING id`,
		u.ID, in.TargetType, in.TargetID, strings.TrimSpace(in.Reason)).Scan(&id); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id}, nil)
	return nil
}

func (s *Server) listReports(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "open"
	}
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`SELECT id, reporter_id, target_type, target_id, reason, status, resolution, created_at, resolved_at
		FROM reports WHERE status = $1 ORDER BY created_at LIMIT %d OFFSET %d`, p.limit, p.offset), status)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []reportDTO{}
	for rows.Next() {
		var rp reportDTO
		if err := rows.Scan(&rp.ID, &rp.ReporterID, &rp.TargetType, &rp.TargetID, &rp.Reason, &rp.Status, &rp.Resolution, &rp.CreatedAt, &rp.ResolvedAt); err != nil {
			return err
		}
		items = append(items, rp)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

// resolveReport: action=hide скрывает объект (работа → hidden, сообщение → текст удалён,
// пользователь → блокировка входа), action=reject отклоняет жалобу.
func (s *Server) resolveReport(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Action     string `json:"action"`
		Resolution string `json:"resolution"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if in.Action != "hide" && in.Action != "reject" {
		return httpx.Validation(map[string]string{"action": "hide или reject"})
	}
	return s.withTx(r.Context(), func(tx pgx.Tx) error {
		var targetType, targetID, status string
		err := tx.QueryRow(r.Context(), `SELECT target_type, target_id, status FROM reports WHERE id = $1 FOR UPDATE`, id).Scan(&targetType, &targetID, &status)
		if isNoRows(err) {
			return httpx.NotFound("Жалоба не найдена")
		}
		if err != nil {
			return err
		}
		if status != "open" {
			return httpx.Conflict("report_closed", "Жалоба уже рассмотрена")
		}
		newStatus := "rejected"
		if in.Action == "hide" {
			newStatus = "resolved"
			var q string
			switch targetType {
			case "artwork":
				q = `UPDATE artworks SET status = 'hidden', updated_at = now() WHERE id = $1 AND status IN ('draft','published','archived')`
			case "message":
				q = `UPDATE messages SET body = 'Сообщение удалено модератором' WHERE id = $1`
			case "user":
				q = `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;`
				if _, err := tx.Exec(r.Context(), `UPDATE users SET password_hash = '!', updated_at = now() WHERE id = $1`, targetID); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(r.Context(), q, targetID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(r.Context(), `UPDATE reports SET status = $2, resolution = $3, resolved_at = now() WHERE id = $1`,
			id, newStatus, strings.TrimSpace(in.Resolution)); err != nil {
			return err
		}
		httpx.NoContent(w)
		return nil
	})
}

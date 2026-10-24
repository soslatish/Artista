package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/httpx"
)

// ---------- вопросы под работой ----------

type questionDTO struct {
	ID         string     `json:"id"`
	Body       string     `json:"body"`
	Answer     string     `json:"answer"`
	AnsweredAt *time.Time `json:"answered_at"`
	Author     party      `json:"author"`
	CreatedAt  time.Time  `json:"created_at"`
}

const questionSelect = `SELECT q.id, q.body, q.answer, q.answered_at, u.id, u.name, u.avatar_url, q.created_at
FROM artwork_questions q JOIN users u ON u.id = q.author_id `

func scanQuestion(row pgx.Row) (questionDTO, error) {
	var q questionDTO
	err := row.Scan(&q.ID, &q.Body, &q.Answer, &q.AnsweredAt, &q.Author.ID, &q.Author.Name, &q.Author.AvatarURL, &q.CreatedAt)
	return q, err
}

func (s *Server) listQuestions(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	p := parsePage(r)
	// отвеченные — выше: это то, что полезно всем покупателям
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`%s WHERE q.artwork_id = $1 AND q.hidden_at IS NULL AND u.deleted_at IS NULL
		ORDER BY (q.answered_at IS NOT NULL) DESC, q.created_at DESC LIMIT %d OFFSET %d`, questionSelect, p.limit, p.offset), id)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []questionDTO{}
	for rows.Next() {
		q, err := scanQuestion(rows)
		if err != nil {
			return err
		}
		items = append(items, q)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) askQuestion(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if !s.socialLimiter.Allow("question:" + u.ID) {
		return httpx.TooMany()
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	body := strings.TrimSpace(in.Body)
	if n := utf8.RuneCountInString(body); n < 3 || n > 500 {
		return httpx.Validation(map[string]string{"body": "Вопрос — от 3 до 500 символов"})
	}
	var artistID, title string
	err = s.DB.QueryRow(r.Context(), `SELECT a.artist_id, a.title FROM artworks a WHERE a.id = $1 AND `+publicStatuses, id).Scan(&artistID, &title)
	if isNoRows(err) {
		return httpx.NotFound("Работа не найдена")
	}
	if err != nil {
		return err
	}
	if artistID == u.ID {
		return httpx.BadRequest("Это ваша работа — добавьте подробности в описание")
	}
	q, err := scanQuestion(s.DB.QueryRow(r.Context(), `WITH ins AS (INSERT INTO artwork_questions (artwork_id, author_id, body) VALUES ($1, $2, $3) RETURNING *)
		SELECT q.id, q.body, q.answer, q.answered_at, u.id, u.name, u.avatar_url, q.created_at FROM ins q JOIN users u ON u.id = q.author_id`, id, u.ID, body))
	if err != nil {
		return err
	}
	s.notify(r.Context(), artistID, "question_new", tr("Вопрос о работе", "Question about your artwork"),
		tr("«%s»: %s", "“%s”: %s", title, truncate(body, 100)), map[string]any{"artwork_id": id, "question_id": q.ID})
	httpx.JSON(w, http.StatusCreated, q, nil)
	return nil
}

func (s *Server) answerQuestion(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Answer string `json:"answer"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	answer := strings.TrimSpace(in.Answer)
	if n := utf8.RuneCountInString(answer); n < 1 || n > 1000 {
		return httpx.Validation(map[string]string{"answer": "Ответ — до 1000 символов"})
	}
	var authorID, artworkID, title string
	err = s.DB.QueryRow(r.Context(), `UPDATE artwork_questions q SET answer = $3, answered_at = now()
		FROM artworks a WHERE q.id = $1 AND a.id = q.artwork_id AND a.artist_id = $2 AND q.hidden_at IS NULL
		RETURNING q.author_id, a.id, a.title`, id, u.ID, answer).Scan(&authorID, &artworkID, &title)
	if isNoRows(err) {
		return httpx.NotFound("Вопрос не найден")
	}
	if err != nil {
		return err
	}
	s.notify(r.Context(), authorID, "question_answered", tr("Художник ответил", "The artist replied"),
		tr("«%s»: %s", "“%s”: %s", title, truncate(answer, 100)), map[string]any{"artwork_id": artworkID, "question_id": id})
	q, err := scanQuestion(s.DB.QueryRow(r.Context(), questionSelect+`WHERE q.id = $1`, id))
	if err != nil {
		return err
	}
	httpx.OK(w, q)
	return nil
}

// deleteQuestion — автор или художник скрывает вопрос.
func (s *Server) deleteQuestion(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `UPDATE artwork_questions q SET hidden_at = now() FROM artworks a
		WHERE q.id = $1 AND a.id = q.artwork_id AND (q.author_id = $2 OR a.artist_id = $2) AND q.hidden_at IS NULL`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Вопрос не найден")
	}
	httpx.NoContent(w)
	return nil
}

// ---------- посты художников ----------

type postArtwork struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
	PriceKop int64  `json:"price_kop"`
	Status   string `json:"status"`
}

type postDTO struct {
	ID        string       `json:"id"`
	Body      string       `json:"body"`
	Images    []string     `json:"images"`
	Artwork   *postArtwork `json:"artwork"`
	Artist    artistBrief  `json:"artist"`
	Likes     int          `json:"likes"`
	Liked     bool         `json:"liked"`
	CreatedAt time.Time    `json:"created_at"`
}

// postSelect: $1 — зритель (может быть NULL).
const postSelect = `SELECT p.id, p.body, p.images,
	a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''), a.price_kop, a.status,
	u.id, u.name, u.avatar_url, u.city, coalesce(u.premium_until > now(), false),
	(SELECT count(*) FROM post_likes l WHERE l.post_id = p.id),
	EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1::uuid),
	p.created_at
FROM posts p JOIN users u ON u.id = p.artist_id
LEFT JOIN artworks a ON a.id = p.artwork_id AND a.status IN ('published','reserved','sold','scheduled','auction') `

func scanPost(row pgx.Row) (postDTO, error) {
	var p postDTO
	var aID, aTitle, aImg, aStatus *string
	var aPrice *int64
	err := row.Scan(&p.ID, &p.Body, &p.Images, &aID, &aTitle, &aImg, &aPrice, &aStatus,
		&p.Artist.ID, &p.Artist.Name, &p.Artist.AvatarURL, &p.Artist.City, &p.Artist.IsPremium,
		&p.Likes, &p.Liked, &p.CreatedAt)
	if err != nil {
		return p, err
	}
	if aID != nil {
		p.Artwork = &postArtwork{ID: *aID, Title: *aTitle, ImageURL: deref(aImg), PriceKop: *aPrice, Status: *aStatus}
	}
	return p, nil
}

func (s *Server) queryPosts(ctx context.Context, sql string, args ...any) ([]postDTO, error) {
	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []postDTO{}
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// postsFeed — посты художников, на которых подписан зритель; без подписок — все свежие посты.
func (s *Server) postsFeed(w http.ResponseWriter, r *http.Request) error {
	viewer, _ := s.userFromRequest(r)
	p := parsePage(r)
	cond := "p.hidden_at IS NULL AND u.deleted_at IS NULL AND u.banned_at IS NULL"
	if viewer.ID != "" && r.URL.Query().Get("scope") != "all" {
		cond += ` AND (NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1::uuid)
			OR p.artist_id IN (SELECT artist_id FROM follows WHERE follower_id = $1::uuid))`
	}
	items, err := s.queryPosts(r.Context(), fmt.Sprintf("%s WHERE %s ORDER BY p.created_at DESC LIMIT %d OFFSET %d", postSelect, cond, p.limit, p.offset),
		nullableID(viewer.ID))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) userPosts(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	p := parsePage(r)
	items, err := s.queryPosts(r.Context(), fmt.Sprintf("%s WHERE p.artist_id = $2 AND p.hidden_at IS NULL AND u.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT %d OFFSET %d",
		postSelect, p.limit, p.offset), nullableID(viewer.ID), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) createPost(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Посты публикуют художники")
	}
	if !s.socialLimiter.Allow("post:" + u.ID) {
		return httpx.TooMany()
	}
	var in struct {
		Body      string   `json:"body"`
		Images    []string `json:"images"`
		ArtworkID *string  `json:"artwork_id"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	body := strings.TrimSpace(in.Body)
	errs := map[string]string{}
	if utf8.RuneCountInString(body) > 2000 {
		errs["body"] = "Текст — до 2000 символов"
	}
	if body == "" && len(in.Images) == 0 {
		errs["body"] = "Добавьте текст или фото"
	}
	if len(in.Images) > 10 {
		errs["images"] = "Не больше 10 фото"
	}
	imgErrs, err := s.validateImages(r.Context(), u.ID, in.Images)
	if err != nil {
		return err
	}
	for k, v := range imgErrs {
		errs[k] = v
	}
	if in.ArtworkID != nil && *in.ArtworkID == "" {
		in.ArtworkID = nil
	}
	if in.ArtworkID != nil {
		var ok bool
		if !isUUID(*in.ArtworkID) {
			errs["artwork_id"] = "Работа не найдена"
		} else if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM artworks a WHERE a.id = $1 AND a.artist_id = $2 AND `+publicStatuses+`)`,
			*in.ArtworkID, u.ID).Scan(&ok); err != nil {
			return err
		} else if !ok {
			errs["artwork_id"] = "Работа не найдена"
		}
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	if in.Images == nil {
		in.Images = []string{}
	}
	var id string
	if err := s.DB.QueryRow(r.Context(), `INSERT INTO posts (artist_id, body, images, artwork_id) VALUES ($1,$2,$3,$4) RETURNING id`,
		u.ID, body, in.Images, in.ArtworkID).Scan(&id); err != nil {
		return err
	}
	s.background(time.Minute, func(ctx context.Context) {
		var name string
		if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, u.ID).Scan(&name); err != nil {
			return
		}
		preview := truncate(body, 100)
		if preview == "" {
			preview = "📷"
		}
		s.notifyMany(ctx, `SELECT follower_id FROM follows WHERE artist_id = $1`, []any{u.ID}, "new_post",
			tr("%s: новый пост", "%s posted", name), text{preview, preview}, map[string]any{"post_id": id, "artist_id": u.ID})
	})
	items, err := s.queryPosts(r.Context(), postSelect+`WHERE p.id = $2`, u.ID, id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, items[0], nil)
	return nil
}

func (s *Server) deletePost(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `DELETE FROM posts WHERE id = $1 AND artist_id = $2`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Пост не найден")
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) likePost(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `INSERT INTO post_likes (post_id, user_id)
		SELECT id, $2 FROM posts WHERE id = $1 AND hidden_at IS NULL ON CONFLICT DO NOTHING`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2)`, id, u.ID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.NotFound("Пост не найден")
		}
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) unlikePost(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`, id, u.ID); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// ---------- серии ----------

type seriesDTO struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	Position      int    `json:"position"`
	ArtworksCount int    `json:"artworks_count"`
	CoverURL      string `json:"cover_url"`
}

const maxSeries = 30

func (s *Server) userSeries(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	// своему художнику показываем и пустые серии
	rows, err := s.DB.Query(r.Context(), `SELECT sr.id, sr.title, sr.description, sr.position,
			(SELECT count(*) FROM artworks a WHERE a.series_id = sr.id AND `+publicStatuses+`),
			coalesce((SELECT i.url FROM artworks a JOIN artwork_images i ON i.artwork_id = a.id AND i.position = 0
				WHERE a.series_id = sr.id AND `+publicStatuses+` ORDER BY a.published_at DESC NULLS LAST LIMIT 1), '')
		FROM series sr WHERE sr.artist_id = $1 ORDER BY sr.position, sr.created_at`, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []seriesDTO{}
	for rows.Next() {
		var sr seriesDTO
		if err := rows.Scan(&sr.ID, &sr.Title, &sr.Description, &sr.Position, &sr.ArtworksCount, &sr.CoverURL); err != nil {
			return err
		}
		if sr.ArtworksCount == 0 && viewer.ID != id {
			continue
		}
		items = append(items, sr)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, items)
	return nil
}

type seriesInput struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Position    *int    `json:"position"`
}

func (in seriesInput) validate(creating bool) error {
	errs := map[string]string{}
	if in.Title != nil || creating {
		t := ""
		if in.Title != nil {
			t = strings.TrimSpace(*in.Title)
		}
		if n := utf8.RuneCountInString(t); n < 2 || n > 80 {
			errs["title"] = "Название — от 2 до 80 символов"
		}
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > 1000 {
		errs["description"] = "Описание — до 1000 символов"
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	return nil
}

func (s *Server) createSeries(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Серии создают художники")
	}
	var in seriesInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if err := in.validate(true); err != nil {
		return err
	}
	var sr seriesDTO
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, u.ID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM series WHERE artist_id = $1`, u.ID).Scan(&n); err != nil {
			return err
		}
		if n >= maxSeries {
			return httpx.Conflict("too_many_series", "Можно создать не больше 30 серий")
		}
		desc := ""
		if in.Description != nil {
			desc = strings.TrimSpace(*in.Description)
		}
		return tx.QueryRow(r.Context(), `INSERT INTO series (artist_id, title, description, position) VALUES ($1,$2,$3,$4)
			RETURNING id, title, description, position`, u.ID, strings.TrimSpace(*in.Title), desc, n).
			Scan(&sr.ID, &sr.Title, &sr.Description, &sr.Position)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, sr, nil)
	return nil
}

func (s *Server) updateSeries(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in seriesInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if err := in.validate(false); err != nil {
		return err
	}
	var sr seriesDTO
	err = s.DB.QueryRow(r.Context(), `UPDATE series SET title = coalesce($3, title), description = coalesce($4, description),
			position = coalesce($5, position) WHERE id = $1 AND artist_id = $2 RETURNING id, title, description, position`,
		id, u.ID, trimPtr(in.Title), trimPtr(in.Description), in.Position).Scan(&sr.ID, &sr.Title, &sr.Description, &sr.Position)
	if isNoRows(err) {
		return httpx.NotFound("Серия не найдена")
	}
	if err != nil {
		return err
	}
	httpx.OK(w, sr)
	return nil
}

func (s *Server) deleteSeries(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `DELETE FROM series WHERE id = $1 AND artist_id = $2`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Серия не найдена")
	}
	httpx.NoContent(w)
	return nil
}

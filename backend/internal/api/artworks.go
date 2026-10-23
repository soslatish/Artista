package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// artistBrief — краткие данные художника в карточке работы.
type artistBrief struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	City      string `json:"city"`
	IsPremium bool   `json:"is_premium"`
}

// artworkDTO — работа для клиента.
type artworkDTO struct {
	ID             string      `json:"id"`
	Title          string      `json:"title"`
	Description    string      `json:"description"`
	Category       string      `json:"category"`
	Style          string      `json:"style"`
	Technique      string      `json:"technique"`
	Materials      string      `json:"materials"`
	WidthCm        float64     `json:"width_cm"`
	HeightCm       float64     `json:"height_cm"`
	DepthCm        float64     `json:"depth_cm"`
	Year           *int        `json:"year"`
	PriceKop       int64       `json:"price_kop"`
	Status         string      `json:"status"`
	Views          int64       `json:"views"`
	FavoritesCount int64       `json:"favorites_count"`
	IsFavorite     bool        `json:"is_favorite"`
	Images         []string    `json:"images"`
	Artist         artistBrief `json:"artist"`
	PublishedAt    *time.Time  `json:"published_at"`
	CreatedAt      time.Time   `json:"created_at"`
}

// artworkSelect — общий SELECT; $1 — id зрителя (может быть пустым).
const artworkSelect = `SELECT a.id, a.title, a.description, a.category, a.style, a.technique, a.materials,
	a.width_cm::float8, a.height_cm::float8, a.depth_cm::float8, a.year, a.price_kop, a.status, a.views,
	(SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id),
	EXISTS(SELECT 1 FROM favorites f WHERE f.artwork_id = a.id AND f.user_id::text = $1),
	coalesce((SELECT array_agg(url ORDER BY position) FROM artwork_images i WHERE i.artwork_id = a.id), '{}'),
	u.id, u.name, u.avatar_url, u.city, coalesce(u.premium_until > now(), false),
	a.published_at, a.created_at
FROM artworks a JOIN users u ON u.id = a.artist_id `

func scanArtwork(row pgx.Row) (artworkDTO, error) {
	var a artworkDTO
	err := row.Scan(&a.ID, &a.Title, &a.Description, &a.Category, &a.Style, &a.Technique, &a.Materials,
		&a.WidthCm, &a.HeightCm, &a.DepthCm, &a.Year, &a.PriceKop, &a.Status, &a.Views,
		&a.FavoritesCount, &a.IsFavorite, &a.Images,
		&a.Artist.ID, &a.Artist.Name, &a.Artist.AvatarURL, &a.Artist.City, &a.Artist.IsPremium,
		&a.PublishedAt, &a.CreatedAt)
	return a, err
}

func collectArtworks(rows pgx.Rows) ([]artworkDTO, error) {
	defer rows.Close()
	out := []artworkDTO{}
	for rows.Next() {
		a, err := scanArtwork(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadArtwork(ctx context.Context, q querier, id, viewerID string) (artworkDTO, error) {
	a, err := scanArtwork(q.QueryRow(ctx, artworkSelect+`WHERE a.id = $2`, viewerID, id))
	if isNoRows(err) {
		return artworkDTO{}, httpx.NotFound("Работа не найдена")
	}
	return a, err
}

// visibleTo — может ли зритель видеть работу.
func (a artworkDTO) visibleTo(viewerID string) bool {
	switch a.Status {
	case "published", "reserved", "sold":
		return true
	}
	return viewerID != "" && viewerID == a.Artist.ID && a.Status != "hidden"
}

func (s *Server) catalogMeta(w http.ResponseWriter, _ *http.Request) error {
	httpx.OK(w, domain.CatalogMeta())
	return nil
}

func (s *Server) validateImages(urls []string) map[string]string {
	for _, u := range urls {
		if !s.isOwnFileURL(u) {
			return map[string]string{"images": "Фото должны быть загружены через приложение"}
		}
	}
	return nil
}

func (s *Server) createArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Публиковать работы могут только художники")
	}
	var in struct {
		domain.ArtworkInput
		Publish bool `json:"publish"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	in.Title = strings.TrimSpace(in.Title)
	errs := domain.ValidateArtwork(in.ArtworkInput, in.Publish)
	for k, v := range s.validateImages(in.Images) {
		errs[k] = v
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	status := "draft"
	if in.Publish {
		status = "published"
	}
	var id string
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `INSERT INTO artworks (artist_id, title, description, category, style, technique,
				materials, width_cm, height_cm, depth_cm, year, price_kop, status, published_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $13 = 'published' THEN now() END) RETURNING id`,
			u.ID, in.Title, in.Description, in.Category, in.Style, in.Technique, in.Materials,
			in.WidthCm, in.HeightCm, in.DepthCm, in.Year, in.PriceKop, status).Scan(&id)
		if err != nil {
			return fmt.Errorf("insert artwork: %w", err)
		}
		return replaceImages(r.Context(), tx, id, in.Images)
	})
	if err != nil {
		return err
	}
	if in.Publish {
		s.notifyFollowersAsync(u.ID, id, in.Title)
	}
	a, err := loadArtwork(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, a, nil)
	return nil
}

func replaceImages(ctx context.Context, tx pgx.Tx, artworkID string, urls []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM artwork_images WHERE artwork_id = $1`, artworkID); err != nil {
		return err
	}
	for i, u := range urls {
		if _, err := tx.Exec(ctx, `INSERT INTO artwork_images (artwork_id, url, position) VALUES ($1, $2, $3)`, artworkID, u, i); err != nil {
			return fmt.Errorf("insert image: %w", err)
		}
	}
	return nil
}

func (s *Server) getArtwork(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	a, err := loadArtwork(r.Context(), s.DB, id, viewer.ID)
	if err != nil {
		return err
	}
	if !a.visibleTo(viewer.ID) {
		return httpx.NotFound("Работа не найдена")
	}
	if viewer.ID != a.Artist.ID {
		if _, err := s.DB.Exec(r.Context(), `UPDATE artworks SET views = views + 1 WHERE id = $1`, id); err != nil {
			s.Log.Warn("count view", "err", err)
		}
	}
	httpx.OK(w, a)
	return nil
}

// ownArtworkForUpdate блокирует работу художника для изменения.
func ownArtworkForUpdate(ctx context.Context, tx pgx.Tx, id, userID string) (domain.ArtworkInput, string, error) {
	var in domain.ArtworkInput
	var artistID, status string
	err := tx.QueryRow(ctx, `SELECT artist_id, status, title, description, category, style, technique, materials,
			width_cm::float8, height_cm::float8, depth_cm::float8, year, price_kop,
			coalesce((SELECT array_agg(url ORDER BY position) FROM artwork_images WHERE artwork_id = a.id), '{}')
		FROM artworks a WHERE id = $1 FOR UPDATE`, id).
		Scan(&artistID, &status, &in.Title, &in.Description, &in.Category, &in.Style, &in.Technique, &in.Materials,
			&in.WidthCm, &in.HeightCm, &in.DepthCm, &in.Year, &in.PriceKop, &in.Images)
	if isNoRows(err) || (err == nil && artistID != userID) {
		return in, "", httpx.NotFound("Работа не найдена")
	}
	return in, status, err
}

func (s *Server) updateArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var patch struct {
		Title       *string   `json:"title"`
		Description *string   `json:"description"`
		Category    *string   `json:"category"`
		Style       *string   `json:"style"`
		Technique   *string   `json:"technique"`
		Materials   *string   `json:"materials"`
		WidthCm     *float64  `json:"width_cm"`
		HeightCm    *float64  `json:"height_cm"`
		DepthCm     *float64  `json:"depth_cm"`
		Year        *int      `json:"year"`
		PriceKop    *int64    `json:"price_kop"`
		Images      *[]string `json:"images"`
	}
	if err := httpx.Decode(w, r, &patch); err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		cur, status, err := ownArtworkForUpdate(r.Context(), tx, id, u.ID)
		if err != nil {
			return err
		}
		if status != "draft" && status != "published" && status != "archived" {
			return httpx.Conflict("artwork_locked", "Работу нельзя изменить в текущем статусе")
		}
		next := cur
		applyString(&next.Title, patch.Title)
		applyString(&next.Description, patch.Description)
		applyString(&next.Category, patch.Category)
		applyString(&next.Style, patch.Style)
		applyString(&next.Technique, patch.Technique)
		applyString(&next.Materials, patch.Materials)
		if patch.WidthCm != nil {
			next.WidthCm = *patch.WidthCm
		}
		if patch.HeightCm != nil {
			next.HeightCm = *patch.HeightCm
		}
		if patch.DepthCm != nil {
			next.DepthCm = *patch.DepthCm
		}
		if patch.Year != nil {
			next.Year = patch.Year
		}
		if patch.PriceKop != nil {
			next.PriceKop = *patch.PriceKop
		}
		if patch.Images != nil {
			next.Images = *patch.Images
		}
		next.Title = strings.TrimSpace(next.Title)
		errs := domain.ValidateArtwork(next, status == "published")
		for k, v := range s.validateImages(next.Images) {
			errs[k] = v
		}
		if len(errs) > 0 {
			return httpx.Validation(errs)
		}
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET title=$2, description=$3, category=$4, style=$5, technique=$6,
				materials=$7, width_cm=$8, height_cm=$9, depth_cm=$10, year=$11, price_kop=$12, updated_at=now()
			WHERE id = $1`, id, next.Title, next.Description, next.Category, next.Style, next.Technique,
			next.Materials, next.WidthCm, next.HeightCm, next.DepthCm, next.Year, next.PriceKop)
		if err != nil {
			return err
		}
		if patch.Images != nil {
			return replaceImages(r.Context(), tx, id, next.Images)
		}
		return nil
	})
	if err != nil {
		return err
	}
	a, err := loadArtwork(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, a)
	return nil
}

func applyString(dst *string, v *string) {
	if v != nil {
		*dst = *v
	}
}

func (s *Server) publishArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var title string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		cur, status, err := ownArtworkForUpdate(r.Context(), tx, id, u.ID)
		if err != nil {
			return err
		}
		if status != "draft" && status != "archived" {
			return httpx.Conflict("bad_status", "Опубликовать можно черновик или работу из архива")
		}
		if errs := domain.ValidateArtwork(cur, true); len(errs) > 0 {
			return httpx.Validation(errs)
		}
		title = cur.Title
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1`, id)
		return err
	})
	if err != nil {
		return err
	}
	s.notifyFollowersAsync(u.ID, id, title)
	a, err := loadArtwork(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, a)
	return nil
}

// archiveArtwork снимает работу с продажи.
func (s *Server) archiveArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		_, status, err := ownArtworkForUpdate(r.Context(), tx, id, u.ID)
		if err != nil {
			return err
		}
		if status != "draft" && status != "published" {
			return httpx.Conflict("artwork_locked", "Работа в заказе или продана — снять с продажи нельзя")
		}
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET status = 'archived', updated_at = now() WHERE id = $1`, id)
		return err
	})
	if err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) addFavorite(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `INSERT INTO favorites (user_id, artwork_id)
		SELECT $1, id FROM artworks WHERE id = $2 AND status IN ('published','reserved','sold')
		ON CONFLICT DO NOTHING`, u.ID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM favorites WHERE user_id=$1 AND artwork_id=$2)`, u.ID, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.NotFound("Работа не найдена")
		}
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) removeFavorite(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM favorites WHERE user_id = $1 AND artwork_id = $2`, u.ID, id); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) deliveryQuote(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	id := q.Get("artwork_id")
	if !isUUID(id) {
		return httpx.BadRequest("Укажите artwork_id")
	}
	var price int64
	var wcm, hcm, dcm float64
	err := s.DB.QueryRow(r.Context(), `SELECT price_kop, width_cm::float8, height_cm::float8, depth_cm::float8
		FROM artworks WHERE id = $1 AND status = 'published'`, id).Scan(&price, &wcm, &hcm, &dcm)
	if isNoRows(err) {
		return httpx.NotFound("Работа не найдена или уже продана")
	}
	if err != nil {
		return err
	}
	city := q.Get("city")
	methods := []domain.DeliveryMethod{domain.DeliveryCDEK, domain.DeliveryExpress, domain.DeliveryPost}
	if m := q.Get("method"); m != "" {
		methods = []domain.DeliveryMethod{domain.DeliveryMethod(m)}
	}
	quotes := []domain.DeliveryQuote{}
	for _, m := range methods {
		quote, err := domain.QuoteDelivery(m, city, price, domain.MaxSide(wcm, hcm, dcm))
		if err == domain.ErrDeliveryUnavailable && len(methods) > 1 {
			continue
		}
		if err != nil {
			return httpx.BadRequest(deliveryErrorText(err))
		}
		quotes = append(quotes, quote)
	}
	httpx.OK(w, quotes)
	return nil
}

func deliveryErrorText(err error) string {
	switch err {
	case domain.ErrCityRequired:
		return "Укажите город доставки"
	case domain.ErrDeliveryUnavailable:
		return "Этот способ доставки недоступен в вашем городе"
	default:
		return "Неизвестный способ доставки"
	}
}

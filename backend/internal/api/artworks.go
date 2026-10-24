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
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	AvatarURL     string     `json:"avatar_url"`
	City          string     `json:"city"`
	IsPremium     bool       `json:"is_premium"`
	OnVacation    bool       `json:"on_vacation"`
	VacationUntil *time.Time `json:"vacation_until"`
}

// auctionBrief — текущее состояние аукциона в карточке работы.
type auctionBrief struct {
	ID         string    `json:"id"`
	StartKop   int64     `json:"start_kop"`
	StepKop    int64     `json:"step_kop"`
	CurrentKop *int64    `json:"current_kop"`
	BidsCount  int       `json:"bids_count"`
	EndsAt     time.Time `json:"ends_at"`
}

// artworkDTO — работа для клиента.
type artworkDTO struct {
	ID             string        `json:"id"`
	Title          string        `json:"title"`
	Description    string        `json:"description"`
	Category       string        `json:"category"`
	Style          string        `json:"style"`
	Technique      string        `json:"technique"`
	Materials      string        `json:"materials"`
	WidthCm        float64       `json:"width_cm"`
	HeightCm       float64       `json:"height_cm"`
	DepthCm        float64       `json:"depth_cm"`
	Year           *int          `json:"year"`
	PriceKop       int64         `json:"price_kop"`
	Status         string        `json:"status"`
	Views          int64         `json:"views"`
	FavoritesCount int64         `json:"favorites_count"`
	IsFavorite     bool          `json:"is_favorite"`
	Images         []string      `json:"images"`
	Palette        []string      `json:"palette"`
	Rooms          []string      `json:"rooms"`
	AllowOffers    bool          `json:"allow_offers"`
	SeriesID       *string       `json:"series_id"`
	ExhibitionID   *string       `json:"exhibition_id"`
	IsPromoted     bool          `json:"is_promoted"`
	Auction        *auctionBrief `json:"auction"`
	// MyPriceKop — цена для этого зрителя из брони (принятое предложение, выигранный аукцион)
	MyPriceKop  *int64      `json:"my_price_kop"`
	Artist      artistBrief `json:"artist"`
	PublishedAt *time.Time  `json:"published_at"`
	CreatedAt   time.Time   `json:"created_at"`
}

// artworkSelect — общий SELECT; $1 — id зрителя (может быть NULL).
const artworkSelect = `SELECT a.id, a.title, a.description, a.category, a.style, a.technique, a.materials,
	a.width_cm::float8, a.height_cm::float8, a.depth_cm::float8, a.year, a.price_kop, a.status, a.views,
	(SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id),
	EXISTS(SELECT 1 FROM favorites f WHERE f.artwork_id = a.id AND f.user_id = $1::uuid),
	coalesce((SELECT array_agg(url ORDER BY position) FROM artwork_images i WHERE i.artwork_id = a.id), '{}'),
	a.palette, a.rooms, a.allow_offers, a.series_id, a.exhibition_id,
	EXISTS(SELECT 1 FROM promotions p WHERE p.artwork_id = a.id AND p.status = 'active' AND p.ends_at > now()) AS is_promoted,
	au.id, au.start_kop, au.step_kop, au.current_kop, au.bids_count, au.ends_at,
	(SELECT pl.price_kop FROM price_locks pl WHERE pl.artwork_id = a.id AND pl.user_id = $1::uuid
		AND pl.used_at IS NULL AND pl.released_at IS NULL AND pl.expires_at > now() ORDER BY pl.created_at DESC LIMIT 1),
	u.id, u.name, u.avatar_url, u.city, coalesce(u.premium_until > now(), false),
	coalesce(u.vacation_until > now(), false), u.vacation_until,
	a.published_at, a.created_at
FROM artworks a JOIN users u ON u.id = a.artist_id
LEFT JOIN auctions au ON au.artwork_id = a.id AND au.status = 'live' `

func scanArtwork(row pgx.Row) (artworkDTO, error) {
	var a artworkDTO
	var auID *string
	var auStart, auStep *int64
	var auBids *int
	var auEnds *time.Time
	var au auctionBrief
	err := row.Scan(&a.ID, &a.Title, &a.Description, &a.Category, &a.Style, &a.Technique, &a.Materials,
		&a.WidthCm, &a.HeightCm, &a.DepthCm, &a.Year, &a.PriceKop, &a.Status, &a.Views,
		&a.FavoritesCount, &a.IsFavorite, &a.Images,
		&a.Palette, &a.Rooms, &a.AllowOffers, &a.SeriesID, &a.ExhibitionID, &a.IsPromoted,
		&auID, &auStart, &auStep, &au.CurrentKop, &auBids, &auEnds,
		&a.MyPriceKop,
		&a.Artist.ID, &a.Artist.Name, &a.Artist.AvatarURL, &a.Artist.City, &a.Artist.IsPremium,
		&a.Artist.OnVacation, &a.Artist.VacationUntil,
		&a.PublishedAt, &a.CreatedAt)
	if err != nil {
		return a, err
	}
	if auID != nil {
		au.ID, au.StartKop, au.StepKop, au.BidsCount, au.EndsAt = *auID, *auStart, *auStep, *auBids, *auEnds
		a.Auction = &au
	}
	if !a.Artist.OnVacation {
		a.Artist.VacationUntil = nil
	}
	return a, nil
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
	a, err := scanArtwork(q.QueryRow(ctx, artworkSelect+`WHERE a.id = $2`, nullableID(viewerID), id))
	if isNoRows(err) {
		return artworkDTO{}, httpx.NotFound("Работа не найдена")
	}
	return a, err
}

// visibleTo — может ли зритель видеть работу.
func (a artworkDTO) visibleTo(viewerID string) bool {
	switch a.Status {
	case "published", "reserved", "sold", "scheduled", "auction":
		return true
	}
	return viewerID != "" && viewerID == a.Artist.ID && a.Status != "hidden"
}

func (s *Server) catalogMeta(w http.ResponseWriter, _ *http.Request) error {
	httpx.OK(w, domain.CatalogMeta())
	return nil
}

// validateImages: фото загружены через наш API и (если загрузка учтена) — этим же пользователем.
func (s *Server) validateImages(ctx context.Context, userID string, urls []string) (map[string]string, error) {
	// приводим к PUBLIC_BASE_URL на месте: вызывающий сохраняет уже канонические ссылки
	for i, u := range urls {
		urls[i] = s.canonicalFileURL(u)
		if !s.isOwnFileURL(u) {
			return map[string]string{"images": "Фото должны быть загружены через приложение"}, nil
		}
	}
	if len(urls) == 0 {
		return nil, nil
	}
	var foreign bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM uploads WHERE url = ANY($1::text[]) AND user_id <> $2)`, urls, userID).Scan(&foreign)
	if err != nil {
		return nil, err
	}
	if foreign {
		return map[string]string{"images": "Можно использовать только свои фото"}, nil
	}
	return nil, nil
}

// coverPalette — палитра первого фото (посчитана при загрузке).
func coverPalette(ctx context.Context, q querier, images []string) ([]string, error) {
	if len(images) == 0 {
		return []string{}, nil
	}
	var p []string
	err := q.QueryRow(ctx, `SELECT palette FROM uploads WHERE url = $1`, images[0]).Scan(&p)
	if isNoRows(err) {
		return []string{}, nil
	}
	return p, err
}

// checkSeries — серия принадлежит художнику.
func checkSeries(ctx context.Context, q querier, seriesID *string, artistID string) (map[string]string, error) {
	if seriesID == nil || *seriesID == "" {
		return nil, nil
	}
	if !isUUID(*seriesID) {
		return map[string]string{"series_id": "Серия не найдена"}, nil
	}
	var ok bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM series WHERE id = $1 AND artist_id = $2)`, *seriesID, artistID).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		return map[string]string{"series_id": "Серия не найдена"}, nil
	}
	return nil, nil
}

func normalizeSeries(id *string) *string {
	if id == nil || *id == "" {
		return nil
	}
	return id
}

func (s *Server) validateArtworkInput(ctx context.Context, in domain.ArtworkInput, forPublish bool, artistID string) error {
	errs := domain.ValidateArtwork(in, forPublish)
	imgErrs, err := s.validateImages(ctx, artistID, in.Images)
	if err != nil {
		return err
	}
	seriesErrs, err := checkSeries(ctx, s.DB, in.SeriesID, artistID)
	if err != nil {
		return err
	}
	for _, m := range []map[string]string{imgErrs, seriesErrs} {
		for k, v := range m {
			errs[k] = v
		}
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
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
	if in.Rooms == nil {
		in.Rooms = []string{}
	}
	in.SeriesID = normalizeSeries(in.SeriesID)
	if err := s.validateArtworkInput(r.Context(), in.ArtworkInput, in.Publish, u.ID); err != nil {
		return err
	}
	status := "draft"
	if in.Publish {
		status = "published"
	}
	var id string
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		palette, err := coverPalette(r.Context(), tx, in.Images)
		if err != nil {
			return err
		}
		err = tx.QueryRow(r.Context(), `INSERT INTO artworks (artist_id, title, description, category, style, technique,
				materials, width_cm, height_cm, depth_cm, year, price_kop, status, published_at,
				palette, rooms, allow_offers, series_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $13 = 'published' THEN now() END,
				$14,$15,$16,$17) RETURNING id`,
			u.ID, in.Title, in.Description, in.Category, in.Style, in.Technique, in.Materials,
			in.WidthCm, in.HeightCm, in.DepthCm, in.Year, in.PriceKop, status,
			palette, in.Rooms, in.AllowOffers, in.SeriesID).Scan(&id)
		if err != nil {
			return fmt.Errorf("insert artwork: %w", err)
		}
		return replaceImages(r.Context(), tx, id, in.Images)
	})
	if err != nil {
		return err
	}
	if in.Publish {
		s.announceArtworkAsync(u.ID, id, in.Title)
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

// viewSources — откуда пришёл просмотр (для статистики художника).
var viewSources = map[string]bool{
	"feed": true, "search": true, "similar": true, "collection": true, "share": true,
	"profile": true, "favorites": true, "notification": true, "history": true, "exhibition": true, "post": true,
}

// viewDedupWindow — повторный просмотр той же работы тем же пользователем не считается.
const viewDedupWindow = "30 minutes"

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
		src := r.URL.Query().Get("src")
		if !viewSources[src] {
			src = "other"
		}
		s.countView(r.Context(), id, viewer.ID, src)
	}
	httpx.OK(w, a)
	return nil
}

// countView записывает просмотр (история + источник) и увеличивает счётчик. Ошибки только логируются.
func (s *Server) countView(ctx context.Context, artworkID, viewerID, source string) {
	tag, err := s.DB.Exec(ctx, `INSERT INTO artwork_views (artwork_id, user_id, source)
		SELECT $1, $2::uuid, $3 WHERE $2::uuid IS NULL OR NOT EXISTS (
			SELECT 1 FROM artwork_views WHERE artwork_id = $1 AND user_id = $2::uuid AND viewed_at > now() - interval '`+viewDedupWindow+`')`,
		artworkID, nullableID(viewerID), source)
	if err != nil {
		s.Log.Warn("count view", "err", err)
		return
	}
	if tag.RowsAffected() == 0 {
		return
	}
	if _, err := s.DB.Exec(ctx, `UPDATE artworks SET views = views + 1 WHERE id = $1`, artworkID); err != nil {
		s.Log.Warn("count view", "err", err)
	}
}

// ownArtworkForUpdate блокирует работу художника для изменения.
func ownArtworkForUpdate(ctx context.Context, tx pgx.Tx, id, userID string) (domain.ArtworkInput, string, error) {
	var in domain.ArtworkInput
	var artistID, status string
	err := tx.QueryRow(ctx, `SELECT artist_id, status, title, description, category, style, technique, materials,
			width_cm::float8, height_cm::float8, depth_cm::float8, year, price_kop,
			coalesce((SELECT array_agg(url ORDER BY position) FROM artwork_images WHERE artwork_id = a.id), '{}'),
			rooms, allow_offers, series_id
		FROM artworks a WHERE id = $1 FOR UPDATE`, id).
		Scan(&artistID, &status, &in.Title, &in.Description, &in.Category, &in.Style, &in.Technique, &in.Materials,
			&in.WidthCm, &in.HeightCm, &in.DepthCm, &in.Year, &in.PriceKop, &in.Images,
			&in.Rooms, &in.AllowOffers, &in.SeriesID)
	if isNoRows(err) || (err == nil && artistID != userID) {
		return in, "", httpx.NotFound("Работа не найдена")
	}
	return in, status, err
}

// artworkPatch — частичное изменение работы.
type artworkPatch struct {
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
	Rooms       *[]string `json:"rooms"`
	AllowOffers *bool     `json:"allow_offers"`
	SeriesID    *string   `json:"series_id"` // "" — убрать из серии
}

func (p artworkPatch) applyTo(cur domain.ArtworkInput) domain.ArtworkInput {
	next := cur
	applyString(&next.Title, p.Title)
	applyString(&next.Description, p.Description)
	applyString(&next.Category, p.Category)
	applyString(&next.Style, p.Style)
	applyString(&next.Technique, p.Technique)
	applyString(&next.Materials, p.Materials)
	if p.WidthCm != nil {
		next.WidthCm = *p.WidthCm
	}
	if p.HeightCm != nil {
		next.HeightCm = *p.HeightCm
	}
	if p.DepthCm != nil {
		next.DepthCm = *p.DepthCm
	}
	if p.Year != nil {
		next.Year = p.Year
	}
	if p.PriceKop != nil {
		next.PriceKop = *p.PriceKop
	}
	if p.Images != nil {
		next.Images = *p.Images
	}
	if p.Rooms != nil {
		next.Rooms = *p.Rooms
	}
	if p.AllowOffers != nil {
		next.AllowOffers = *p.AllowOffers
	}
	if p.SeriesID != nil {
		next.SeriesID = normalizeSeries(p.SeriesID)
	}
	next.Title = strings.TrimSpace(next.Title)
	if next.Rooms == nil {
		next.Rooms = []string{}
	}
	return next
}

// editableStatuses — в этих статусах работу можно менять (в заказе, на аукционе и проданную — нельзя).
var editableStatuses = map[string]bool{"draft": true, "published": true, "archived": true, "scheduled": true}

func (s *Server) updateArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var patch artworkPatch
	if err := httpx.Decode(w, r, &patch); err != nil {
		return err
	}
	var title string
	var oldPrice, newPrice int64
	var status string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		cur, st, err := ownArtworkForUpdate(r.Context(), tx, id, u.ID)
		if err != nil {
			return err
		}
		status = st
		if !editableStatuses[status] {
			return httpx.Conflict("artwork_locked", "Работу нельзя изменить в текущем статусе")
		}
		next := patch.applyTo(cur)
		if err := s.validateArtworkInput(r.Context(), next, status == "published" || status == "scheduled", u.ID); err != nil {
			return err
		}
		palette, err := coverPalette(r.Context(), tx, next.Images)
		if err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET title=$2, description=$3, category=$4, style=$5, technique=$6,
				materials=$7, width_cm=$8, height_cm=$9, depth_cm=$10, year=$11, price_kop=$12,
				palette=$13, rooms=$14, allow_offers=$15, series_id=$16, updated_at=now()
			WHERE id = $1`, id, next.Title, next.Description, next.Category, next.Style, next.Technique,
			next.Materials, next.WidthCm, next.HeightCm, next.DepthCm, next.Year, next.PriceKop,
			palette, next.Rooms, next.AllowOffers, next.SeriesID)
		if err != nil {
			return err
		}
		title, oldPrice, newPrice = next.Title, cur.PriceKop, next.PriceKop
		if patch.Images != nil {
			return replaceImages(r.Context(), tx, id, next.Images)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if status == "published" && newPrice < oldPrice {
		s.notifyPriceDropAsync(id, u.ID, title, oldPrice, newPrice)
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
	firstPublish := false
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
		// подписчиков уведомляем только о первой публикации, не о возврате из архива
		err = tx.QueryRow(r.Context(), `UPDATE artworks SET status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
			WHERE id = $1 RETURNING published_at = now()`, id).Scan(&firstPublish)
		return err
	})
	if err != nil {
		return err
	}
	if firstPublish {
		s.announceArtworkAsync(u.ID, id, title)
	}
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
			return httpx.Conflict("artwork_locked", "Работа в заказе, на аукционе или продана — снять с продажи нельзя")
		}
		if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'archived', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		// принятые предложения по снятой работе больше не действуют
		if _, err := tx.Exec(r.Context(), `UPDATE offers SET status = 'expired', updated_at = now()
			WHERE artwork_id = $1 AND status IN ('pending','countered','accepted')`, id); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE price_locks SET released_at = now()
			WHERE artwork_id = $1 AND used_at IS NULL AND released_at IS NULL`, id)
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
		SELECT $1, a.id FROM artworks a WHERE a.id = $2 AND `+publicStatuses+`
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
	// reserved — для победителя аукциона и покупателя по принятому предложению
	err := s.DB.QueryRow(r.Context(), `SELECT price_kop, width_cm::float8, height_cm::float8, depth_cm::float8
		FROM artworks WHERE id = $1 AND status IN ('published','reserved','auction')`, id).Scan(&price, &wcm, &hcm, &dcm)
	if isNoRows(err) {
		return httpx.NotFound("Работа не найдена или уже продана")
	}
	if err != nil {
		return err
	}
	if v := q.Get("price_kop"); v != "" { // цена из брони (предложение, аукцион) влияет на бесплатную доставку
		if n, err := parseKop(v); err == nil && n != nil && *n > 0 {
			price = *n
		}
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

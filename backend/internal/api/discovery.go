package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/httpx"
)

// ---------- похожие работы ----------

const similarLimit = 12

// similarArtworks — похожие по категории, стилю, технике, палитре и цене (другие авторы — выше).
func (s *Server) similarArtworks(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	var exists bool
	if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM artworks WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.NotFound("Работа не найдена")
	}
	sql := `WITH src AS (SELECT id, artist_id, category, style, technique, palette, price_kop FROM artworks WHERE id = $2) ` +
		artworkSelect + ` CROSS JOIN src
		WHERE a.id <> src.id AND ` + catalogStatuses + ` AND u.deleted_at IS NULL AND u.banned_at IS NULL
		ORDER BY ((a.category = src.category)::int * 3
			+ (a.style <> '' AND a.style = src.style)::int * 2
			+ (a.technique <> '' AND a.technique = src.technique)::int * 2
			+ cardinality(ARRAY(SELECT unnest(a.palette) INTERSECT SELECT unnest(src.palette))) * 1.5
			+ (abs(ln(a.price_kop::float8 / src.price_kop)) < 0.5)::int
			- (a.artist_id = src.artist_id)::int * 0.5) DESC,
			a.published_at DESC NULLS LAST, a.id
		LIMIT ` + fmt.Sprint(similarLimit)
	rows, err := s.DB.Query(r.Context(), sql, nullableID(viewer.ID), id)
	if err != nil {
		return err
	}
	items, err := collectArtworks(rows)
	if err != nil {
		return err
	}
	httpx.OK(w, items)
	return nil
}

// ---------- история просмотров ----------

func (s *Server) myHistory(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	sql := fmt.Sprintf(`WITH h AS (SELECT artwork_id, max(viewed_at) AS last FROM artwork_views WHERE user_id = $2 GROUP BY artwork_id) %s
		JOIN h ON h.artwork_id = a.id WHERE %s AND u.deleted_at IS NULL
		ORDER BY h.last DESC LIMIT %d OFFSET %d`, artworkSelect, publicStatuses, p.limit, p.offset)
	rows, err := s.DB.Query(r.Context(), sql, u.ID, u.ID)
	if err != nil {
		return err
	}
	items, err := collectArtworks(rows)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) clearHistory(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	// записи остаются для статистики художников, но отвязываются от пользователя
	if _, err := s.DB.Exec(r.Context(), `UPDATE artwork_views SET user_id = NULL WHERE user_id = $1`, u.ID); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// ---------- сохранённые поиски ----------

type savedSearchDTO struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Filters   catalogFilter `json:"filters"`
	CreatedAt time.Time     `json:"created_at"`
}

const maxSavedSearches = 20

func (s *Server) listSavedSearches(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	rows, err := s.DB.Query(r.Context(), `SELECT id, title, filters, created_at FROM saved_searches
		WHERE user_id = $1 ORDER BY created_at DESC`, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []savedSearchDTO{}
	for rows.Next() {
		var ss savedSearchDTO
		if err := rows.Scan(&ss.ID, &ss.Title, &ss.Filters, &ss.CreatedAt); err != nil {
			return err
		}
		items = append(items, ss)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, items)
	return nil
}

func (s *Server) createSavedSearch(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Title   string        `json:"title"`
		Filters catalogFilter `json:"filters"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	in.Filters.ArtistID = ""
	if err := in.Filters.validate(); err != nil {
		return err
	}
	if in.Filters.isEmpty() {
		return httpx.Validation(map[string]string{"filters": "Выберите хотя бы один фильтр"})
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Мой поиск"
	}
	if utf8.RuneCountInString(title) > 80 {
		return httpx.Validation(map[string]string{"title": "Название — до 80 символов"})
	}
	ss, err := s.insertSavedSearch(r.Context(), u.ID, title, in.Filters)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, ss, nil)
	return nil
}

func (s *Server) insertSavedSearch(ctx context.Context, userID, title string, f catalogFilter) (savedSearchDTO, error) {
	ss := savedSearchDTO{Title: title, Filters: f}
	raw, err := json.Marshal(f)
	if err != nil {
		return ss, err
	}
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		// блокируем пользователя, чтобы параллельные запросы не обошли лимит
		if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM saved_searches WHERE user_id = $1`, userID).Scan(&n); err != nil {
			return err
		}
		if n >= maxSavedSearches {
			return httpx.Conflict("too_many_searches", "Можно сохранить не больше 20 поисков")
		}
		return tx.QueryRow(ctx, `INSERT INTO saved_searches (user_id, title, filters) VALUES ($1, $2, $3)
			RETURNING id, created_at`, userID, title, raw).Scan(&ss.ID, &ss.CreatedAt)
	})
	return ss, err
}

func (s *Server) deleteSavedSearch(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Поиск не найден")
	}
	httpx.NoContent(w)
	return nil
}

// similarAlert — «Сообщить, если появится похожее»: поиск по категории, стилю, цветам и цене ±30%.
func (s *Server) similarAlert(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var title, category, style string
	var palette []string
	var price int64
	err = s.DB.QueryRow(r.Context(), `SELECT a.title, a.category, a.style, a.palette, a.price_kop FROM artworks a
		WHERE a.id = $1 AND `+publicStatuses, id).Scan(&title, &category, &style, &palette, &price)
	if isNoRows(err) {
		return httpx.NotFound("Работа не найдена")
	}
	if err != nil {
		return err
	}
	lo, hi := price*7/10, price*13/10
	f := catalogFilter{Category: category, Style: style, PriceMin: &lo, PriceMax: &hi}
	if len(palette) > 0 {
		f.Colors = palette[:min(2, len(palette))]
	}
	ss, err := s.insertSavedSearch(r.Context(), u.ID, truncate("Похожие на «"+title+"»", 80), f)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, ss, nil)
	return nil
}

// savedSearchMatch — условие «новая работа подходит под сохранённый поиск s» (работа — CTE a).
const savedSearchMatch = `
	(s.filters->>'category' IS NULL OR s.filters->>'category' = a.category)
	AND (s.filters->>'style' IS NULL OR s.filters->>'style' = a.style)
	AND (s.filters->>'technique' IS NULL OR s.filters->>'technique' = a.technique)
	AND (s.filters->>'city' IS NULL OR lower(s.filters->>'city') = lower(a.artist_city))
	AND (s.filters->>'room' IS NULL OR s.filters->>'room' = ANY(a.rooms))
	AND (s.filters->'colors' IS NULL OR a.palette && ARRAY(SELECT jsonb_array_elements_text(s.filters->'colors')))
	AND (s.filters->>'price_min' IS NULL OR a.price_kop >= (s.filters->>'price_min')::bigint)
	AND (s.filters->>'price_max' IS NULL OR a.price_kop <= (s.filters->>'price_max')::bigint)
	AND (s.filters->>'size_max' IS NULL OR greatest(a.width_cm, a.height_cm, a.depth_cm) <= (s.filters->>'size_max')::numeric)
	AND (s.filters->>'new_artists' IS NULL OR a.artist_created > now() - interval '60 days')
	AND (s.filters->>'q' IS NULL OR a.search @@ plainto_tsquery('russian', s.filters->>'q'))`

// matchSavedSearches уведомляет владельцев сохранённых поисков, под которые подходит новая работа.
// Один пользователь получает не больше одного уведомления на работу.
func (s *Server) matchSavedSearches(ctx context.Context, artworkID string) {
	var title string
	if err := s.DB.QueryRow(ctx, `SELECT title FROM artworks WHERE id = $1`, artworkID).Scan(&title); err != nil {
		s.Log.Error("match saved searches", "err", err)
		return
	}
	recipients := `SELECT DISTINCT s.user_id FROM saved_searches s,
		(SELECT a.*, u.city AS artist_city, u.created_at AS artist_created FROM artworks a JOIN users u ON u.id = a.artist_id WHERE a.id = $1) a
		WHERE s.user_id <> a.artist_id AND ` + savedSearchMatch
	if n := s.notifyMany(ctx, recipients, []any{artworkID}, "saved_search",
		tr("Нашлась подходящая работа", "A matching artwork is here"), tr("«%s»", "“%s”", title),
		map[string]any{"artwork_id": artworkID}); n > 0 {
		_, err := s.DB.Exec(ctx, `UPDATE saved_searches s SET last_notified_at = now()
			FROM (SELECT a.*, u.city AS artist_city, u.created_at AS artist_created FROM artworks a JOIN users u ON u.id = a.artist_id WHERE a.id = $1) a
			WHERE s.user_id <> a.artist_id AND `+savedSearchMatch, artworkID)
		if err != nil {
			s.Log.Warn("saved searches notified_at", "err", err)
		}
	}
}

// ---------- подборки ----------

type collectionDTO struct {
	ID          string        `json:"id"`
	Slug        string        `json:"slug"`
	Title       string        `json:"title"`
	Subtitle    string        `json:"subtitle"`
	Kind        string        `json:"kind"`
	Filters     catalogFilter `json:"filters"`
	Position    int           `json:"position"`
	IsPublished bool          `json:"is_published"`
	Preview     []artworkDTO  `json:"preview,omitempty"`
}

const collectionPreview = 8

func scanCollection(row pgx.Row) (collectionDTO, error) {
	var c collectionDTO
	err := row.Scan(&c.ID, &c.Slug, &c.Title, &c.Subtitle, &c.Kind, &c.Filters, &c.Position, &c.IsPublished)
	return c, err
}

const collectionCols = `id, slug, title, subtitle, kind, filters, position, is_published`

// listCollections — опубликованные подборки с превью работ (для главной).
func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) error {
	viewer, _ := s.userFromRequest(r)
	rows, err := s.DB.Query(r.Context(), `SELECT `+collectionCols+` FROM collections WHERE is_published ORDER BY position, title`)
	if err != nil {
		return err
	}
	var list []collectionDTO
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			rows.Close()
			return err
		}
		list = append(list, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	out := []collectionDTO{}
	for _, c := range list {
		items, err := s.collectionArtworks(r.Context(), c, viewer.ID, page{limit: collectionPreview})
		if err != nil {
			return err
		}
		if len(items) == 0 {
			continue // пустые подборки на главной не показываем
		}
		c.Preview = items
		out = append(out, c)
	}
	httpx.OK(w, out)
	return nil
}

func (s *Server) collectionArtworks(ctx context.Context, c collectionDTO, viewerID string, p page) ([]artworkDTO, error) {
	var sql string
	var args []any
	if c.Kind == "manual" {
		sql = fmt.Sprintf(`%s JOIN collection_items ci ON ci.artwork_id = a.id AND ci.collection_id = $2
			WHERE %s AND u.deleted_at IS NULL AND u.banned_at IS NULL
			ORDER BY ci.position, a.published_at DESC LIMIT %d OFFSET %d`, artworkSelect, publicStatuses, p.limit, p.offset)
		args = []any{nullableID(viewerID), c.ID}
	} else {
		sql, args = catalogQuery(viewerID, c.Filters, "", "new", p)
	}
	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return collectArtworks(rows)
}

func (s *Server) getCollection(w http.ResponseWriter, r *http.Request) error {
	viewer, _ := s.userFromRequest(r)
	c, err := scanCollection(s.DB.QueryRow(r.Context(), `SELECT `+collectionCols+` FROM collections WHERE slug = $1 AND is_published`, r.PathValue("slug")))
	if isNoRows(err) {
		return httpx.NotFound("Подборка не найдена")
	}
	if err != nil {
		return err
	}
	p := parsePage(r)
	items, err := s.collectionArtworks(r.Context(), c, viewer.ID, p)
	if err != nil {
		return err
	}
	meta := p.meta(len(items))
	meta["collection"] = c
	httpx.JSON(w, http.StatusOK, items, meta)
	return nil
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`)

type collectionInput struct {
	Slug        string        `json:"slug"`
	Title       string        `json:"title"`
	Subtitle    string        `json:"subtitle"`
	Kind        string        `json:"kind"`
	Filters     catalogFilter `json:"filters"`
	Position    int           `json:"position"`
	IsPublished *bool         `json:"is_published"`
	ArtworkIDs  []string      `json:"artwork_ids"`
}

func (in collectionInput) validate() error {
	errs := map[string]string{}
	if !slugRe.MatchString(in.Slug) {
		errs["slug"] = "Адрес — латиница, цифры и дефис"
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Title)); n < 2 || n > 80 {
		errs["title"] = "Название — от 2 до 80 символов"
	}
	if utf8.RuneCountInString(in.Subtitle) > 160 {
		errs["subtitle"] = "Подзаголовок — до 160 символов"
	}
	if in.Kind != "manual" && in.Kind != "filter" {
		errs["kind"] = "manual или filter"
	}
	if in.Kind == "filter" {
		if err := in.Filters.validate(); err != nil || in.Filters.isEmpty() {
			errs["filters"] = "Укажите корректные фильтры"
		}
	}
	if len(in.ArtworkIDs) > 100 {
		errs["artwork_ids"] = "Не больше 100 работ"
	}
	for _, id := range in.ArtworkIDs {
		if !isUUID(id) {
			errs["artwork_ids"] = "Некорректный id работы"
		}
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	return nil
}

// saveCollection — создание (id пустой) или изменение подборки администратором.
func (s *Server) saveCollection(w http.ResponseWriter, r *http.Request, id string) error {
	var in collectionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	published := in.IsPublished == nil || *in.IsPublished
	in.Filters.ArtistID = ""
	filters, _ := json.Marshal(in.Filters)
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var err error
		if id == "" {
			err = tx.QueryRow(r.Context(), `INSERT INTO collections (slug, title, subtitle, kind, filters, position, is_published)
				VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, in.Slug, strings.TrimSpace(in.Title), in.Subtitle, in.Kind, filters, in.Position, published).Scan(&id)
		} else {
			var tag interface{ RowsAffected() int64 }
			tag, err = tx.Exec(r.Context(), `UPDATE collections SET slug=$2, title=$3, subtitle=$4, kind=$5, filters=$6, position=$7, is_published=$8
				WHERE id = $1`, id, in.Slug, strings.TrimSpace(in.Title), in.Subtitle, in.Kind, filters, in.Position, published)
			if err == nil && tag.RowsAffected() == 0 {
				return httpx.NotFound("Подборка не найдена")
			}
		}
		if isUniqueViolation(err) {
			return httpx.Validation(map[string]string{"slug": "Такой адрес уже занят"})
		}
		if err != nil {
			return err
		}
		if in.Kind != "manual" {
			return nil
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM collection_items WHERE collection_id = $1`, id); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO collection_items (collection_id, artwork_id, position)
			SELECT $1, x.id, x.ord FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, ord)
			JOIN artworks a ON a.id = x.id ON CONFLICT DO NOTHING`, id, in.ArtworkIDs)
		return err
	})
	if err != nil {
		return err
	}
	c, err := scanCollection(s.DB.QueryRow(r.Context(), `SELECT `+collectionCols+` FROM collections WHERE id = $1`, id))
	if err != nil {
		return err
	}
	httpx.OK(w, c)
	return nil
}

func (s *Server) adminCreateCollection(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	return s.saveCollection(w, r, "")
}

func (s *Server) adminUpdateCollection(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	return s.saveCollection(w, r, id)
}

func (s *Server) adminDeleteCollection(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM collections WHERE id = $1`, id); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) adminListCollections(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	rows, err := s.DB.Query(r.Context(), `SELECT `+collectionCols+` FROM collections ORDER BY position, title`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []collectionDTO{}
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, out)
	return nil
}

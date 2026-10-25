package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// queryBuilder собирает WHERE с позиционными параметрами (без конкатенации значений).
type queryBuilder struct {
	where []string
	args  []any
}

func (b *queryBuilder) arg(v any) string {
	b.args = append(b.args, v)
	return "$" + strconv.Itoa(len(b.args))
}

func (b *queryBuilder) add(cond string, vals ...any) {
	for _, v := range vals {
		cond = strings.Replace(cond, "?", b.arg(v), 1)
	}
	b.where = append(b.where, cond)
}

func (b *queryBuilder) sql() string {
	if len(b.where) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(b.where, " AND ")
}

// catalogStatuses — работы, которые можно купить или на которые можно сделать ставку.
const catalogStatuses = "a.status IN ('published','auction')"

// publicStatuses — работы, которые видны всем (в том числе проданные и анонсы выставок).
const publicStatuses = "a.status IN ('published','reserved','sold','scheduled','auction')"

// Сортировки — только из белого списка. Продвигаемые работы идут первыми в лентах,
// но не в сортировках по цене.
var sorts = map[string]string{
	// Премиум продвигает работы художника в ленте: свежие (14 дней) — выше в «Новом»,
	// все — выше в «Популярном» и «Для вас»; оплаченное продвижение работы — ещё выше
	"new": `is_promoted DESC, (coalesce(u.premium_until > now(), false) AND a.published_at > now() - interval '14 days') DESC,
		a.published_at DESC NULLS LAST, a.id DESC`,
	"price_asc":  "a.price_kop ASC, a.id DESC",
	"price_desc": "a.price_kop DESC, a.id DESC",
	"popular": `is_promoted DESC, (coalesce(u.premium_until > now(), false)) DESC,
		(a.views + 5 * (SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id)) DESC, a.id DESC`,
	"ending": "au.ends_at ASC NULLS LAST, a.id DESC",
}

// catalogFilter — фильтры каталога. Тот же формат хранится в сохранённых поисках и подборках.
type catalogFilter struct {
	Q          string   `json:"q,omitempty"`
	Category   string   `json:"category,omitempty"`
	Style      string   `json:"style,omitempty"`
	Technique  string   `json:"technique,omitempty"`
	City       string   `json:"city,omitempty"`
	Colors     []string `json:"colors,omitempty"`
	Room       string   `json:"room,omitempty"`
	PriceMin   *int64   `json:"price_min,omitempty"`
	PriceMax   *int64   `json:"price_max,omitempty"`
	SizeMax    *float64 `json:"size_max,omitempty"`
	NewArtists bool     `json:"new_artists,omitempty"`
	Auction    bool     `json:"auction,omitempty"`
	// ArtistID — только для запроса каталога, в сохранённые поиски не попадает
	ArtistID string `json:"-"`
}

const maxQueryLen = 100

// parseCatalogFilter читает фильтры из query string.
func parseCatalogFilter(q url.Values) (catalogFilter, error) {
	f := catalogFilter{
		Q:          strings.TrimSpace(q.Get("q")),
		Category:   q.Get("category"),
		Style:      q.Get("style"),
		Technique:  q.Get("technique"),
		City:       strings.TrimSpace(q.Get("city")),
		Room:       q.Get("room"),
		NewArtists: q.Get("new_artists") == "true",
		Auction:    q.Get("auction") == "true",
		ArtistID:   q.Get("artist_id"),
	}
	if f.ArtistID != "" && !isUUID(f.ArtistID) {
		return f, httpx.BadRequest("Некорректный artist_id")
	}
	if v := q.Get("colors"); v != "" {
		f.Colors = strings.Split(v, ",")
	}
	var err error
	if f.PriceMin, err = parseKop(q.Get("price_min")); err != nil {
		return f, err
	}
	if f.PriceMax, err = parseKop(q.Get("price_max")); err != nil {
		return f, err
	}
	if v := q.Get("size_max"); v != "" {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil || n <= 0 || n > 10_000 {
			return f, httpx.BadRequest("Некорректный size_max")
		}
		f.SizeMax = &n
	}
	return f, f.validate()
}

func parseKop(raw string) (*int64, error) {
	if raw == "" {
		return nil, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return nil, httpx.BadRequest("Некорректный диапазон цены")
	}
	return &n, nil
}

// validate проверяет значения из справочников (в том числе для фильтров из JSON).
func (f catalogFilter) validate() error {
	if utf8.RuneCountInString(f.Q) > maxQueryLen || utf8.RuneCountInString(f.City) > 80 {
		return httpx.BadRequest("Слишком длинный запрос")
	}
	if f.Category != "" && !domain.IsValidCategory(f.Category) {
		return httpx.BadRequest("Неизвестная категория")
	}
	if f.Style != "" && !domain.IsValidStyle(f.Style) {
		return httpx.BadRequest("Неизвестный стиль")
	}
	if f.Technique != "" && !domain.IsValidTechnique(f.Technique) {
		return httpx.BadRequest("Неизвестная техника")
	}
	if f.Room != "" && !domain.IsRoom(f.Room) {
		return httpx.BadRequest("Неизвестный интерьер")
	}
	if len(f.Colors) > 5 {
		return httpx.BadRequest("Выберите не больше пяти цветов")
	}
	for _, c := range f.Colors {
		if !domain.IsColor(c) {
			return httpx.BadRequest("Неизвестный цвет")
		}
	}
	if (f.PriceMin != nil && *f.PriceMin < 0) || (f.PriceMax != nil && *f.PriceMax < 0) {
		return httpx.BadRequest("Некорректный диапазон цены")
	}
	return nil
}

// isEmpty — ни одного условия (сохранять такой поиск бессмысленно).
func (f catalogFilter) isEmpty() bool {
	return f.Q == "" && f.Category == "" && f.Style == "" && f.Technique == "" && f.City == "" &&
		len(f.Colors) == 0 && f.Room == "" && f.PriceMin == nil && f.PriceMax == nil && f.SizeMax == nil &&
		!f.NewArtists && !f.Auction
}

// apply добавляет условия фильтра к запросу.
func (f catalogFilter) apply(b *queryBuilder) {
	if f.Q != "" {
		like := "%" + escapeLike(f.Q) + "%"
		b.add("(a.search @@ plainto_tsquery('russian', ?) OR a.title ILIKE ? OR u.name ILIKE ?)", f.Q, like, like)
	}
	for _, c := range []struct{ val, col string }{
		{f.Category, "a.category"}, {f.Style, "a.style"}, {f.Technique, "a.technique"},
	} {
		if c.val != "" {
			b.add(c.col+" = ?", c.val)
		}
	}
	if f.City != "" {
		b.add("lower(u.city) = lower(?)", f.City)
	}
	if len(f.Colors) > 0 {
		b.add("a.palette && ?::text[]", f.Colors)
	}
	if f.Room != "" {
		b.add("? = ANY(a.rooms)", f.Room)
	}
	if f.PriceMin != nil {
		b.add("a.price_kop >= ?", *f.PriceMin)
	}
	if f.PriceMax != nil {
		b.add("a.price_kop <= ?", *f.PriceMax)
	}
	if f.SizeMax != nil {
		b.add("greatest(a.width_cm, a.height_cm, a.depth_cm) <= ?", *f.SizeMax)
	}
	if f.NewArtists {
		b.add("u.created_at > now() - interval '60 days'")
	}
	if f.Auction {
		b.add("a.status = 'auction'")
	}
	if f.ArtistID != "" {
		b.add("a.artist_id = ?", f.ArtistID)
	}
}

// catalogQuery собирает запрос к каталогу: фильтр, лента, сортировка, страница.
func catalogQuery(viewerID string, f catalogFilter, feed, sortKey string, p page) (string, []any) {
	b := &queryBuilder{}
	b.arg(nullableID(viewerID)) // $1 — зритель для is_favorite
	b.add(catalogStatuses)
	b.add("u.deleted_at IS NULL AND u.banned_at IS NULL")
	f.apply(b)
	switch feed {
	case "popular":
		sortKey = "popular"
	case "for_you":
		if viewerID != "" {
			// подписки и категории из избранного; если ничего нет — популярное
			b.add(`((NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1::uuid)
				  AND NOT EXISTS (SELECT 1 FROM favorites WHERE user_id = $1::uuid))
				OR a.artist_id IN (SELECT artist_id FROM follows WHERE follower_id = $1::uuid)
				OR a.category IN (SELECT DISTINCT a2.category FROM favorites f2 JOIN artworks a2 ON a2.id = f2.artwork_id WHERE f2.user_id = $1::uuid))`)
			b.add("a.artist_id <> $1::uuid")
		}
		if sortKey == "" {
			sortKey = "popular"
		}
	}
	order, ok := sorts[sortKey]
	if !ok {
		order = sorts["new"]
	}
	return fmt.Sprintf("%s %s ORDER BY %s LIMIT %d OFFSET %d", artworkSelect, b.sql(), order, p.limit, p.offset), b.args
}

// listArtworks — каталог с поиском, фильтрами и лентами.
func (s *Server) listArtworks(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	viewer, _ := s.userFromRequest(r)
	f, err := parseCatalogFilter(q)
	if err != nil {
		return err
	}
	p := parsePage(r)
	sql, args := catalogQuery(viewer.ID, f, q.Get("feed"), q.Get("sort"), p)
	rows, err := s.DB.Query(r.Context(), sql, args...)
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

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (s *Server) listByCondition(w http.ResponseWriter, r *http.Request, viewerID, cond string, args ...any) error {
	p := parsePage(r)
	all := append([]any{nullableID(viewerID)}, args...)
	sql := fmt.Sprintf("%s WHERE %s ORDER BY a.created_at DESC, a.id DESC LIMIT %d OFFSET %d", artworkSelect, cond, p.limit, p.offset)
	rows, err := s.DB.Query(r.Context(), sql, all...)
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

var artistStatuses = map[string]bool{
	"draft": true, "published": true, "reserved": true, "sold": true, "archived": true,
	"hidden": true, "scheduled": true, "auction": true, "commission": true,
}

// myArtworks — все работы художника (?status= фильтр).
func (s *Server) myArtworks(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	status := r.URL.Query().Get("status")
	if status != "" {
		if !artistStatuses[status] {
			return httpx.BadRequest("Некорректный статус")
		}
		return s.listByCondition(w, r, u.ID, "a.artist_id = $2 AND a.status = $3", u.ID, status)
	}
	return s.listByCondition(w, r, u.ID, "a.artist_id = $2 AND a.status <> 'commission'", u.ID)
}

func (s *Server) myFavorites(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	return s.listByCondition(w, r, u.ID,
		"a.id IN (SELECT artwork_id FROM favorites WHERE user_id = $2) AND "+publicStatuses, u.ID)
}

// userArtworks — работы художника в профиле (?series_id= — работы серии).
func (s *Server) userArtworks(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	cond := "a.artist_id = $2 AND " + publicStatuses + " AND u.deleted_at IS NULL"
	if sid := r.URL.Query().Get("series_id"); sid != "" {
		if !isUUID(sid) {
			return httpx.BadRequest("Некорректный series_id")
		}
		return s.listByCondition(w, r, viewer.ID, cond+" AND a.series_id = $3", id, sid)
	}
	return s.listByCondition(w, r, viewer.ID, cond, id)
}

package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

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

// Сортировки — только из белого списка.
var sorts = map[string]string{
	"new":        "a.published_at DESC NULLS LAST, a.id DESC",
	"price_asc":  "a.price_kop ASC, a.id DESC",
	"price_desc": "a.price_kop DESC, a.id DESC",
	"popular": `(coalesce(u.premium_until > now(), false)) DESC,
		(a.views + 5 * (SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id)) DESC, a.id DESC`,
}

// listArtworks — каталог с поиском, фильтрами и лентами.
func (s *Server) listArtworks(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	viewer, _ := s.userFromRequest(r)
	p := parsePage(r)

	b := &queryBuilder{}
	b.arg(viewer.ID) // $1 — зритель для is_favorite
	b.add("a.status = 'published'")
	b.add("u.deleted_at IS NULL")

	if text := strings.TrimSpace(q.Get("q")); text != "" {
		if len([]rune(text)) > 100 {
			return httpx.BadRequest("Слишком длинный запрос")
		}
		like := "%" + escapeLike(text) + "%"
		b.add("(a.search @@ plainto_tsquery('russian', ?) OR a.title ILIKE ? OR u.name ILIKE ?)", text, like, like)
	}
	for _, f := range []struct{ param, col string }{
		{"category", "a.category"}, {"style", "a.style"}, {"technique", "a.technique"},
	} {
		if v := q.Get(f.param); v != "" {
			b.add(f.col+" = ?", v)
		}
	}
	if v := q.Get("city"); v != "" {
		b.add("lower(u.city) = lower(?)", strings.TrimSpace(v))
	}
	if v := q.Get("artist_id"); v != "" {
		if !isUUID(v) {
			return httpx.BadRequest("Некорректный artist_id")
		}
		b.add("a.artist_id = ?", v)
	}
	if err := addRange(b, q.Get("price_min"), "a.price_kop >= ?"); err != nil {
		return err
	}
	if err := addRange(b, q.Get("price_max"), "a.price_kop <= ?"); err != nil {
		return err
	}
	if v := q.Get("size_max"); v != "" {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil || n <= 0 {
			return httpx.BadRequest("Некорректный size_max")
		}
		b.add("greatest(a.width_cm, a.height_cm, a.depth_cm) <= ?", n)
	}

	sortKey := q.Get("sort")
	switch q.Get("feed") {
	case "popular":
		sortKey = "popular"
	case "for_you":
		if viewer.ID != "" {
			// подписки и категории из избранного; если ничего нет — популярное
			b.add(`((NOT EXISTS (SELECT 1 FROM follows WHERE follower_id::text = $1)
				  AND NOT EXISTS (SELECT 1 FROM favorites WHERE user_id::text = $1))
				OR a.artist_id IN (SELECT artist_id FROM follows WHERE follower_id::text = $1)
				OR a.category IN (SELECT DISTINCT a2.category FROM favorites f2 JOIN artworks a2 ON a2.id = f2.artwork_id WHERE f2.user_id::text = $1))`)
			b.add("a.artist_id::text <> $1")
		}
		if sortKey == "" {
			sortKey = "popular"
		}
	}
	order, ok := sorts[sortKey]
	if !ok {
		order = sorts["new"]
	}
	sql := fmt.Sprintf("%s %s ORDER BY %s LIMIT %d OFFSET %d", artworkSelect, b.sql(), order, p.limit, p.offset)
	rows, err := s.DB.Query(r.Context(), sql, b.args...)
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

func addRange(b *queryBuilder, raw, cond string) error {
	if raw == "" {
		return nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return httpx.BadRequest("Некорректный диапазон цены")
	}
	b.add(cond, n)
	return nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (s *Server) listByCondition(w http.ResponseWriter, r *http.Request, viewerID, cond string, args ...any) error {
	p := parsePage(r)
	all := append([]any{viewerID}, args...)
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

// myArtworks — все работы художника, кроме скрытых модератором (?status= фильтр).
func (s *Server) myArtworks(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	status := r.URL.Query().Get("status")
	if status != "" {
		switch status {
		case "draft", "published", "reserved", "sold", "archived", "hidden":
		default:
			return httpx.BadRequest("Некорректный статус")
		}
		return s.listByCondition(w, r, u.ID, "a.artist_id = $2 AND a.status = $3", u.ID, status)
	}
	return s.listByCondition(w, r, u.ID, "a.artist_id = $2", u.ID)
}

func (s *Server) myFavorites(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	return s.listByCondition(w, r, u.ID,
		"a.id IN (SELECT artwork_id FROM favorites WHERE user_id = $2) AND a.status IN ('published','reserved','sold')", u.ID)
}

func (s *Server) userArtworks(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	return s.listByCondition(w, r, viewer.ID,
		"a.artist_id = $2 AND a.status IN ('published','reserved','sold') AND u.deleted_at IS NULL", id)
}

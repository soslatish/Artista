package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/soslatish/artista/backend/internal/httpx"
)

type dayPoint struct {
	Date  string `json:"date"`
	Value int    `json:"value"`
}

type sourcePoint struct {
	Source string `json:"source"`
	Views  int    `json:"views"`
}

type topArtwork struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ImageURL  string `json:"image_url"`
	Views     int    `json:"views"`
	Favorites int    `json:"favorites"`
	Orders    int    `json:"orders"`
}

type funnel struct {
	Views     int `json:"views"`
	Favorites int `json:"favorites"`
	Orders    int `json:"orders"`
	Sales     int `json:"sales"`
}

type detailedStatsDTO struct {
	Days           int           `json:"days"`
	ViewsByDay     []dayPoint    `json:"views_by_day"`
	FavoritesByDay []dayPoint    `json:"favorites_by_day"`
	Sources        []sourcePoint `json:"sources"`
	Top            []topArtwork  `json:"top_artworks"`
	Funnel         funnel        `json:"funnel"`
	NewFollowers   int           `json:"new_followers"`
}

var statsPeriods = map[int]bool{7: true, 30: true, 90: true}

// detailedStats — расширенная статистика (часть премиума): просмотры по дням, источники, воронка, топ работ.
func (s *Server) detailedStats(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Статистика доступна художникам")
	}
	premium, err := isPremiumActive(r.Context(), s.DB, u.ID)
	if err != nil {
		return err
	}
	if !premium {
		return httpx.Conflict("premium_required", "Расширенная статистика входит в Премиум")
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if !statsPeriods[days] {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days+1).Truncate(24 * time.Hour)
	out := detailedStatsDTO{Days: days, Sources: []sourcePoint{}, Top: []topArtwork{}}
	ctx := r.Context()

	series := func(sql string) ([]dayPoint, error) {
		rows, err := s.DB.Query(ctx, sql, u.ID, since, days)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		pts := []dayPoint{}
		for rows.Next() {
			var p dayPoint
			var d time.Time
			if err := rows.Scan(&d, &p.Value); err != nil {
				return nil, err
			}
			p.Date = d.Format("2006-01-02")
			pts = append(pts, p)
		}
		return pts, rows.Err()
	}
	if out.ViewsByDay, err = series(`SELECT d::date, coalesce(v.n, 0)::int FROM generate_series($2::timestamptz, $2::timestamptz + make_interval(days => $3 - 1), interval '1 day') d
		LEFT JOIN (SELECT date_trunc('day', av.viewed_at) AS day, count(*) AS n FROM artwork_views av JOIN artworks a ON a.id = av.artwork_id
			WHERE a.artist_id = $1 AND av.viewed_at >= $2 GROUP BY 1) v ON v.day = d ORDER BY d`); err != nil {
		return err
	}
	if out.FavoritesByDay, err = series(`SELECT d::date, coalesce(v.n, 0)::int FROM generate_series($2::timestamptz, $2::timestamptz + make_interval(days => $3 - 1), interval '1 day') d
		LEFT JOIN (SELECT date_trunc('day', f.created_at) AS day, count(*) AS n FROM favorites f JOIN artworks a ON a.id = f.artwork_id
			WHERE a.artist_id = $1 AND f.created_at >= $2 GROUP BY 1) v ON v.day = d ORDER BY d`); err != nil {
		return err
	}

	rows, err := s.DB.Query(ctx, `SELECT av.source, count(*)::int FROM artwork_views av JOIN artworks a ON a.id = av.artwork_id
		WHERE a.artist_id = $1 AND av.viewed_at >= $2 GROUP BY 1 ORDER BY 2 DESC`, u.ID, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p sourcePoint
		if err := rows.Scan(&p.Source, &p.Views); err != nil {
			rows.Close()
			return err
		}
		out.Sources = append(out.Sources, p)
	}
	rows.Close()

	rows, err = s.DB.Query(ctx, `SELECT a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''),
			(SELECT count(*) FROM artwork_views av WHERE av.artwork_id = a.id AND av.viewed_at >= $2)::int AS v,
			(SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id)::int,
			(SELECT count(*) FROM orders o WHERE o.artwork_id = a.id AND o.created_at >= $2)::int
		FROM artworks a WHERE a.artist_id = $1 AND a.status NOT IN ('draft','commission')
		ORDER BY v DESC, a.created_at DESC LIMIT 10`, u.ID, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var t topArtwork
		if err := rows.Scan(&t.ID, &t.Title, &t.ImageURL, &t.Views, &t.Favorites, &t.Orders); err != nil {
			rows.Close()
			return err
		}
		out.Top = append(out.Top, t)
	}
	rows.Close()

	err = s.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM artwork_views av JOIN artworks a ON a.id = av.artwork_id WHERE a.artist_id = $1 AND av.viewed_at >= $2)::int,
		(SELECT count(*) FROM favorites f JOIN artworks a ON a.id = f.artwork_id WHERE a.artist_id = $1 AND f.created_at >= $2)::int,
		(SELECT count(*) FROM orders WHERE artist_id = $1 AND created_at >= $2)::int,
		(SELECT count(*) FROM orders WHERE artist_id = $1 AND status = 'completed' AND completed_at >= $2)::int,
		(SELECT count(*) FROM follows WHERE artist_id = $1 AND created_at >= $2)::int`, u.ID, since).
		Scan(&out.Funnel.Views, &out.Funnel.Favorites, &out.Funnel.Orders, &out.Funnel.Sales, &out.NewFollowers)
	if err != nil {
		return err
	}
	httpx.OK(w, out)
	return nil
}

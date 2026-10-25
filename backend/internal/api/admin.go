package api

// Админка: сводка, пользователи и работы. Все изменения пишутся в журнал admin_actions.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// adminPage — пагинация админки смещением (?limit=&offset=) с общим числом строк.
type adminPage struct{ limit, offset int }

func parseAdminPage(r *http.Request) adminPage {
	p := adminPage{limit: 50}
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		p.limit = min(n, 200)
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n > 0 {
		p.offset = n
	}
	return p
}

func (p adminPage) meta(total int) map[string]any {
	m := map[string]any{"total": total, "offset": p.offset, "limit": p.limit, "next_offset": nil}
	if p.offset+p.limit < total {
		m["next_offset"] = p.offset + p.limit
	}
	return m
}

// likeQuery — шаблон для ILIKE с экранированием спецсимволов.
func likeQuery(q string) string {
	q = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(q))
	return "%" + q + "%"
}

// filters собирает WHERE из условий с позиционными параметрами.
type filters struct {
	where []string
	args  []any
}

func (f *filters) add(cond string, args ...any) {
	for _, a := range args {
		f.args = append(f.args, a)
		cond = strings.Replace(cond, "?", "$"+strconv.Itoa(len(f.args)), 1)
	}
	f.where = append(f.where, cond)
}

func (f *filters) sql() string {
	if len(f.where) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(f.where, " AND ")
}

// ---------- сводка ----------

type dashboardDTO struct {
	Users struct {
		Total, Buyers, Artists, Admins, Banned, Premium, New7d, New30d int
	} `json:"users"`
	Artworks map[string]int `json:"artworks"`
	Orders   map[string]int `json:"orders"`
	Money    struct {
		GMVMonthKop, GMVTotalKop, CommissionMonthKop, CommissionTotalKop, HeldKop int64
		SubscriptionsMonthKop, PromotionsMonthKop                                 int64
	} `json:"money"`
	Activity struct {
		OpenReports, LiveAuctions, ActivePromotions, UpcomingExhibitions, PendingOffers, OpenCommissions, RefundsPending int
	} `json:"activity"`
	Daily []dailyPoint `json:"daily"`
}

type dailyPoint struct {
	Date       string `json:"date"`
	Signups    int    `json:"signups"`
	Orders     int    `json:"orders"`
	RevenueKop int64  `json:"revenue_kop"`
}

func (s *Server) adminDashboard(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	ctx := r.Context()
	var d dashboardDTO
	u := &d.Users
	if err := s.DB.QueryRow(ctx, `SELECT count(*),
			count(*) FILTER (WHERE role = 'buyer'), count(*) FILTER (WHERE role = 'artist'), count(*) FILTER (WHERE role = 'admin'),
			count(*) FILTER (WHERE banned_at IS NOT NULL), count(*) FILTER (WHERE premium_until > now()),
			count(*) FILTER (WHERE created_at > now() - interval '7 days'), count(*) FILTER (WHERE created_at > now() - interval '30 days')
		FROM users WHERE deleted_at IS NULL`).Scan(&u.Total, &u.Buyers, &u.Artists, &u.Admins, &u.Banned, &u.Premium, &u.New7d, &u.New30d); err != nil {
		return err
	}
	var err error
	if d.Artworks, err = countBy(ctx, s.DB, `SELECT status, count(*) FROM artworks GROUP BY status`); err != nil {
		return err
	}
	if d.Orders, err = countBy(ctx, s.DB, `SELECT status, count(*) FROM orders GROUP BY status`); err != nil {
		return err
	}
	m := &d.Money
	monthStart := time.Now().In(moscow)
	monthStart = time.Date(monthStart.Year(), monthStart.Month(), 1, 0, 0, 0, 0, moscow)
	if err := s.DB.QueryRow(ctx, `SELECT
			coalesce(sum(price_kop) FILTER (WHERE status = 'completed' AND completed_at >= $1), 0),
			coalesce(sum(price_kop) FILTER (WHERE status = 'completed'), 0),
			coalesce(sum(commission_kop) FILTER (WHERE status = 'completed' AND completed_at >= $1), 0),
			coalesce(sum(commission_kop) FILTER (WHERE status = 'completed'), 0),
			coalesce(sum(total_kop) FILTER (WHERE payout_status = 'held'), 0)
		FROM orders`, monthStart).Scan(&m.GMVMonthKop, &m.GMVTotalKop, &m.CommissionMonthKop, &m.CommissionTotalKop, &m.HeldKop); err != nil {
		return err
	}
	if err := s.DB.QueryRow(ctx, `SELECT
			coalesce(sum(amount_kop) FILTER (WHERE purpose = 'subscription'), 0),
			coalesce(sum(amount_kop) FILTER (WHERE purpose = 'promotion'), 0)
		FROM payments WHERE status = 'succeeded' AND created_at >= $1`, monthStart).Scan(&m.SubscriptionsMonthKop, &m.PromotionsMonthKop); err != nil {
		return err
	}
	a := &d.Activity
	if err := s.DB.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM reports WHERE status = 'open'),
			(SELECT count(*) FROM auctions WHERE status = 'live'),
			(SELECT count(*) FROM promotions WHERE status = 'active' AND ends_at > now()),
			(SELECT count(*) FROM exhibitions WHERE opened_at IS NULL AND cancelled_at IS NULL),
			(SELECT count(*) FROM offers WHERE status IN ('pending','countered') AND expires_at > now()),
			(SELECT count(*) FROM commissions WHERE status IN ('requested','quoted')),
			(SELECT count(*) FROM payments WHERE status = 'refund_pending')`).
		Scan(&a.OpenReports, &a.LiveAuctions, &a.ActivePromotions, &a.UpcomingExhibitions, &a.PendingOffers, &a.OpenCommissions, &a.RefundsPending); err != nil {
		return err
	}
	rows, err := s.DB.Query(ctx, `WITH days AS (
			SELECT generate_series((now() AT TIME ZONE 'Europe/Moscow')::date - 29, (now() AT TIME ZONE 'Europe/Moscow')::date, '1 day')::date AS d
		)
		SELECT to_char(days.d, 'YYYY-MM-DD'),
			(SELECT count(*) FROM users u WHERE (u.created_at AT TIME ZONE 'Europe/Moscow')::date = days.d),
			(SELECT count(*) FROM orders o WHERE o.paid_at IS NOT NULL AND (o.paid_at AT TIME ZONE 'Europe/Moscow')::date = days.d),
			(SELECT coalesce(sum(o.commission_kop), 0) FROM orders o WHERE o.status = 'completed' AND (o.completed_at AT TIME ZONE 'Europe/Moscow')::date = days.d)
				+ (SELECT coalesce(sum(p.amount_kop), 0) FROM payments p WHERE p.status = 'succeeded' AND p.purpose IN ('subscription','promotion')
					AND (p.created_at AT TIME ZONE 'Europe/Moscow')::date = days.d)
		FROM days ORDER BY days.d`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var p dailyPoint
		if err := rows.Scan(&p.Date, &p.Signups, &p.Orders, &p.RevenueKop); err != nil {
			return err
		}
		d.Daily = append(d.Daily, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, d)
	return nil
}

func countBy(ctx context.Context, q querier, sql string) (map[string]int, error) {
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

// ---------- пользователи ----------

type adminUserDTO struct {
	ID           string     `json:"id"`
	Email        string     `json:"email"`
	Name         string     `json:"name"`
	Role         string     `json:"role"`
	City         string     `json:"city"`
	AvatarURL    string     `json:"avatar_url"`
	PremiumUntil *time.Time `json:"premium_until"`
	BannedAt     *time.Time `json:"banned_at"`
	DeletedAt    *time.Time `json:"deleted_at"`
	CreatedAt    time.Time  `json:"created_at"`
	Artworks     int        `json:"artworks"`
	Purchases    int        `json:"purchases"`
	Sales        int        `json:"sales"`
	SalesKop     int64      `json:"sales_kop"`
	SpentKop     int64      `json:"spent_kop"`
	Reports      int        `json:"reports"`
}

const adminUserSelect = `SELECT u.id, u.email, u.name, u.role, u.city, u.avatar_url, u.premium_until, u.banned_at, u.deleted_at, u.created_at,
	(SELECT count(*) FROM artworks a WHERE a.artist_id = u.id),
	(SELECT count(*) FROM orders o WHERE o.buyer_id = u.id AND o.status = 'completed'),
	(SELECT count(*) FROM orders o WHERE o.artist_id = u.id AND o.status = 'completed'),
	(SELECT coalesce(sum(o.price_kop), 0) FROM orders o WHERE o.artist_id = u.id AND o.status = 'completed'),
	(SELECT coalesce(sum(o.total_kop), 0) FROM orders o WHERE o.buyer_id = u.id AND o.status = 'completed'),
	(SELECT count(*) FROM reports rp WHERE rp.target_type = 'user' AND rp.target_id = u.id)
	FROM users u`

func scanAdminUser(row pgx.Row) (adminUserDTO, error) {
	var u adminUserDTO
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.City, &u.AvatarURL, &u.PremiumUntil, &u.BannedAt, &u.DeletedAt, &u.CreatedAt,
		&u.Artworks, &u.Purchases, &u.Sales, &u.SalesKop, &u.SpentKop, &u.Reports)
	return u, err
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	q := r.URL.Query()
	p := parseAdminPage(r)
	var f filters
	if v := q.Get("q"); v != "" {
		f.add(`(u.email ILIKE ? OR u.name ILIKE ? OR u.id::text = ?)`, likeQuery(v), likeQuery(v), strings.TrimSpace(v))
	}
	switch q.Get("role") {
	case "buyer", "artist", "admin":
		f.add(`u.role = ?`, q.Get("role"))
	}
	switch q.Get("status") {
	case "banned":
		f.add(`u.banned_at IS NOT NULL`)
	case "deleted":
		f.add(`u.deleted_at IS NOT NULL`)
	case "premium":
		f.add(`u.premium_until > now()`)
	case "active":
		f.add(`u.banned_at IS NULL AND u.deleted_at IS NULL`)
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM users u`+f.sql(), f.args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.Query(r.Context(), adminUserSelect+f.sql()+fmt.Sprintf(` ORDER BY u.created_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), f.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []adminUserDTO{}
	for rows.Next() {
		u, err := scanAdminUser(rows)
		if err != nil {
			return err
		}
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

type adminUserDetail struct {
	adminUserDTO
	Bio          string            `json:"bio"`
	Locale       string            `json:"locale"`
	Followers    int               `json:"followers"`
	OnVacation   bool              `json:"on_vacation"`
	RecentOrders []adminOrderDTO   `json:"recent_orders"`
	RecentWorks  []adminArtworkDTO `json:"recent_artworks"`
	Actions      []auditDTO        `json:"admin_actions"`
}

func (s *Server) adminGetUser(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	d, err := s.loadAdminUser(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.OK(w, d)
	return nil
}

func (s *Server) loadAdminUser(ctx context.Context, id string) (adminUserDetail, error) {
	var d adminUserDetail
	base, err := scanAdminUser(s.DB.QueryRow(ctx, adminUserSelect+` WHERE u.id = $1`, id))
	if isNoRows(err) {
		return d, httpx.NotFound("Пользователь не найден")
	}
	if err != nil {
		return d, err
	}
	d.adminUserDTO = base
	if err := s.DB.QueryRow(ctx, `SELECT u.bio, u.locale, (SELECT count(*) FROM follows f WHERE f.artist_id = u.id),
			coalesce(u.vacation_until > now(), false) FROM users u WHERE u.id = $1`, id).Scan(&d.Bio, &d.Locale, &d.Followers, &d.OnVacation); err != nil {
		return d, err
	}
	if d.RecentOrders, err = s.adminOrders(ctx, `WHERE o.buyer_id = $1 OR o.artist_id = $1`, []any{id}, 20, 0); err != nil {
		return d, err
	}
	if d.RecentWorks, err = s.adminArtworks(ctx, `WHERE a.artist_id = $1`, []any{id}, 20, 0); err != nil {
		return d, err
	}
	if d.Actions, err = s.auditEntries(ctx, `WHERE target_type = 'user' AND target_id = $1`, []any{id}, 20); err != nil {
		return d, err
	}
	return d, nil
}

// adminPatchUser меняет роль, блокировку, Премиум и данные профиля.
func (s *Server) adminPatchUser(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Role        *string `json:"role"`
		Banned      *bool   `json:"banned"`
		PremiumDays *int    `json:"premium_days"` // >0 — продлить на N дней, 0 — снять Премиум
		Name        *string `json:"name"`
		City        *string `json:"city"`
		Reason      string  `json:"reason"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if id == admin.ID && (in.Role != nil || in.Banned != nil) {
		return httpx.Conflict("self_change", "Нельзя изменить роль или заблокировать себя")
	}
	errs := map[string]string{}
	if in.Role != nil && *in.Role != "buyer" && *in.Role != "artist" && *in.Role != "admin" {
		errs["role"] = "Роль: buyer, artist или admin"
	}
	if in.PremiumDays != nil && (*in.PremiumDays < 0 || *in.PremiumDays > 3650) {
		errs["premium_days"] = "От 0 до 3650 дней"
	}
	if in.Name != nil && (len([]rune(strings.TrimSpace(*in.Name))) < 1 || len([]rune(*in.Name)) > 80) {
		errs["name"] = "Имя — от 1 до 80 символов"
	}
	if in.City != nil && len([]rune(*in.City)) > 80 {
		errs["city"] = "Город — до 80 символов"
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	var banned bool
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT true FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&exists); err != nil {
			if isNoRows(err) {
				return httpx.NotFound("Пользователь не найден")
			}
			return err
		}
		details := map[string]any{"reason": in.Reason}
		if in.Role != nil {
			if _, err := tx.Exec(r.Context(), `UPDATE users SET role = $2, updated_at = now() WHERE id = $1`, id, *in.Role); err != nil {
				return err
			}
			// смена роли действует сразу: старые токены с прежней ролью отзываем
			if _, err := tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id); err != nil {
				return err
			}
			details["role"] = *in.Role
		}
		if in.Banned != nil {
			if *in.Banned {
				banned = true
				for _, q := range []string{
					`UPDATE users SET banned_at = now(), updated_at = now() WHERE id = $1 AND banned_at IS NULL`,
					`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
					`DELETE FROM device_tokens WHERE user_id = $1`,
				} {
					if _, err := tx.Exec(r.Context(), q, id); err != nil {
						return err
					}
				}
				if err := cancelArtworkDeals(r.Context(), tx, `a.artist_id = $1`, id); err != nil {
					return err
				}
				if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'hidden', updated_at = now()
					WHERE artist_id = $1 AND status IN ('draft','published','archived','auction','scheduled')`, id); err != nil {
					return err
				}
			} else if _, err := tx.Exec(r.Context(), `UPDATE users SET banned_at = NULL, updated_at = now() WHERE id = $1`, id); err != nil {
				return err
			}
			details["banned"] = *in.Banned
		}
		if in.PremiumDays != nil {
			q := `UPDATE users SET premium_until = NULL, updated_at = now() WHERE id = $1`
			args := []any{id}
			if *in.PremiumDays > 0 {
				q = `UPDATE users SET premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => $2), updated_at = now() WHERE id = $1`
				args = append(args, *in.PremiumDays)
			}
			if _, err := tx.Exec(r.Context(), q, args...); err != nil {
				return err
			}
			details["premium_days"] = *in.PremiumDays
		}
		if in.Name != nil || in.City != nil {
			if _, err := tx.Exec(r.Context(), `UPDATE users SET name = coalesce($2, name), city = coalesce($3, city), updated_at = now() WHERE id = $1`,
				id, trimPtr(in.Name), trimPtr(in.City)); err != nil {
				return err
			}
			details["profile"] = true
		}
		return audit(r.Context(), tx, admin.ID, "user.update", "user", id, details)
	})
	if err != nil {
		return err
	}
	if banned {
		s.revokeAccess(id)
	}
	d, err := s.loadAdminUser(r.Context(), id)
	if err != nil {
		return err
	}
	if in.Banned != nil && !banned {
		s.active.set(id, d.DeletedAt == nil) // разбан действует сразу, без ожидания кэша
	}
	httpx.OK(w, d)
	return nil
}

// ---------- работы ----------

type adminArtworkDTO struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	PriceKop   int64     `json:"price_kop"`
	ImageURL   string    `json:"image_url"`
	ArtistID   string    `json:"artist_id"`
	ArtistName string    `json:"artist_name"`
	Views      int       `json:"views"`
	Favorites  int       `json:"favorites"`
	Reports    int       `json:"reports"`
	IsPromoted bool      `json:"is_promoted"`
	CreatedAt  time.Time `json:"created_at"`
	Category   string    `json:"category"`
}

func (s *Server) adminArtworks(ctx context.Context, where string, args []any, limit, offset int) ([]adminArtworkDTO, error) {
	rows, err := s.DB.Query(ctx, `SELECT a.id, a.title, a.status, a.price_kop,
			coalesce((SELECT url FROM artwork_images i WHERE i.artwork_id = a.id ORDER BY position LIMIT 1), ''),
			u.id, u.name, a.views, (SELECT count(*) FROM favorites f WHERE f.artwork_id = a.id),
			(SELECT count(*) FROM reports rp WHERE rp.target_type = 'artwork' AND rp.target_id = a.id),
			EXISTS(SELECT 1 FROM promotions p WHERE p.artwork_id = a.id AND p.status = 'active' AND p.ends_at > now()),
			a.created_at, a.category
		FROM artworks a JOIN users u ON u.id = a.artist_id `+where+fmt.Sprintf(` ORDER BY a.created_at DESC LIMIT %d OFFSET %d`, limit, offset), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []adminArtworkDTO{}
	for rows.Next() {
		var a adminArtworkDTO
		if err := rows.Scan(&a.ID, &a.Title, &a.Status, &a.PriceKop, &a.ImageURL, &a.ArtistID, &a.ArtistName, &a.Views, &a.Favorites,
			&a.Reports, &a.IsPromoted, &a.CreatedAt, &a.Category); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Server) adminListArtworks(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	q := r.URL.Query()
	p := parseAdminPage(r)
	var f filters
	if v := q.Get("q"); v != "" {
		f.add(`(a.title ILIKE ? OR u.name ILIKE ? OR a.id::text = ?)`, likeQuery(v), likeQuery(v), strings.TrimSpace(v))
	}
	if v := q.Get("status"); v != "" {
		f.add(`a.status = ?`, v)
	}
	if v := q.Get("artist_id"); isUUID(v) {
		f.add(`a.artist_id = ?`, v)
	}
	if q.Get("reported") == "true" {
		f.add(`EXISTS (SELECT 1 FROM reports rp WHERE rp.target_type = 'artwork' AND rp.target_id = a.id AND rp.status = 'open')`)
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM artworks a JOIN users u ON u.id = a.artist_id`+f.sql(), f.args...).Scan(&total); err != nil {
		return err
	}
	items, err := s.adminArtworks(r.Context(), f.sql(), f.args, p.limit, p.offset)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

// adminPatchArtwork: статус (скрыть / вернуть в продажу / в архив), цена и название.
func (s *Server) adminPatchArtwork(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Status   *string `json:"status"`
		PriceKop *int64  `json:"price_kop"`
		Title    *string `json:"title"`
		Reason   string  `json:"reason"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	errs := map[string]string{}
	if in.Status != nil && *in.Status != "published" && *in.Status != "hidden" && *in.Status != "archived" {
		errs["status"] = "Статус: published, hidden или archived"
	}
	if in.PriceKop != nil && (*in.PriceKop < domain.MinArtworkPriceKop || *in.PriceKop > domain.MaxArtworkPriceKop) {
		errs["price_kop"] = "Цена — от 3 000 до 500 000 ₽"
	}
	if in.Title != nil && (len([]rune(strings.TrimSpace(*in.Title))) < 2 || len([]rune(*in.Title)) > 120) {
		errs["title"] = "Название — от 2 до 120 символов"
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(r.Context(), `SELECT status FROM artworks WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
			if isNoRows(err) {
				return httpx.NotFound("Работа не найдена")
			}
			return err
		}
		details := map[string]any{"reason": in.Reason, "from": status}
		if in.Status != nil && *in.Status != status {
			if status == "sold" || status == "reserved" || status == "commission" {
				return httpx.Conflict("artwork_locked", "Работа продана или в заказе — статус меняется через заказ")
			}
			if *in.Status != "published" {
				if err := cancelArtworkDeals(r.Context(), tx, `a.id = $1`, id); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = $2, exhibition_id = CASE WHEN $2 = 'published' THEN NULL ELSE exhibition_id END,
				published_at = coalesce(published_at, CASE WHEN $2 = 'published' THEN now() END), updated_at = now() WHERE id = $1`, id, *in.Status); err != nil {
				return err
			}
			details["status"] = *in.Status
		}
		if in.PriceKop != nil || in.Title != nil {
			if _, err := tx.Exec(r.Context(), `UPDATE artworks SET price_kop = coalesce($2, price_kop), title = coalesce($3, title), updated_at = now() WHERE id = $1`,
				id, in.PriceKop, trimPtr(in.Title)); err != nil {
				return err
			}
			details["price_kop"], details["title"] = in.PriceKop, in.Title
		}
		return audit(r.Context(), tx, admin.ID, "artwork.update", "artwork", id, details)
	})
	if err != nil {
		return err
	}
	items, err := s.adminArtworks(r.Context(), `WHERE a.id = $1`, []any{id}, 1, 0)
	if err != nil {
		return err
	}
	httpx.OK(w, items[0])
	return nil
}

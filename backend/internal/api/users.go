package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// querier — общий интерфейс пула и транзакции.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// meDTO — профиль текущего пользователя.
type meDTO struct {
	ID           string            `json:"id"`
	Email        string            `json:"email"`
	Name         string            `json:"name"`
	Role         string            `json:"role"`
	City         string            `json:"city"`
	Bio          string            `json:"bio"`
	AvatarURL    string            `json:"avatar_url"`
	Social       map[string]string `json:"social"`
	IsPremium    bool              `json:"is_premium"`
	PremiumUntil *time.Time        `json:"premium_until"`
	// VacationUntil — магазин на паузе до этой даты (работы видны, купить нельзя)
	VacationUntil      *time.Time `json:"vacation_until"`
	VacationNote       string     `json:"vacation_note"`
	AcceptsCommissions bool       `json:"accepts_commissions"`
	CommissionNote     string     `json:"commission_note"`
	Locale             string     `json:"locale"`
	CreatedAt          time.Time  `json:"created_at"`
}

func loadMe(ctx context.Context, q querier, id string) (meDTO, error) {
	var m meDTO
	err := q.QueryRow(ctx, `SELECT id, email, name, role, city, bio, avatar_url, social, premium_until,
			coalesce(premium_until > now(), false), CASE WHEN vacation_until > now() THEN vacation_until END,
			vacation_note, accepts_commissions, commission_note, locale, created_at
		FROM users WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&m.ID, &m.Email, &m.Name, &m.Role, &m.City, &m.Bio, &m.AvatarURL, &m.Social, &m.PremiumUntil, &m.IsPremium,
			&m.VacationUntil, &m.VacationNote, &m.AcceptsCommissions, &m.CommissionNote, &m.Locale, &m.CreatedAt)
	if isNoRows(err) {
		return meDTO{}, httpx.Unauthorized("Аккаунт не найден")
	}
	return m, err
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	m, err := loadMe(r.Context(), s.DB, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, m)
	return nil
}

var allowedSocial = map[string]bool{"vk": true, "telegram": true, "website": true, "behance": true, "instagram": true}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Name      *string            `json:"name"`
		City      *string            `json:"city"`
		Bio       *string            `json:"bio"`
		AvatarURL *string            `json:"avatar_url"`
		Social    *map[string]string `json:"social"`
		// VacationUntil: RFC 3339 — включить паузу до даты, "" — выключить
		VacationUntil      *string `json:"vacation_until"`
		VacationNote       *string `json:"vacation_note"`
		AcceptsCommissions *bool   `json:"accepts_commissions"`
		CommissionNote     *string `json:"commission_note"`
		Locale             *string `json:"locale"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	errs := map[string]string{}
	vacation, clearVacation, vErr := parseVacation(in.VacationUntil)
	if vErr != "" {
		errs["vacation_until"] = vErr
	}
	if in.VacationNote != nil && utf8.RuneCountInString(*in.VacationNote) > 200 {
		errs["vacation_note"] = "Сообщение — до 200 символов"
	}
	if in.CommissionNote != nil && utf8.RuneCountInString(*in.CommissionNote) > 500 {
		errs["commission_note"] = "Условия — до 500 символов"
	}
	if in.Locale != nil && *in.Locale != "ru" && *in.Locale != "en" {
		errs["locale"] = "Язык: ru или en"
	}
	if (in.AcceptsCommissions != nil || in.VacationUntil != nil) && u.Role != "artist" {
		errs["role"] = "Доступно художникам"
	}
	if in.Name != nil {
		if n := utf8.RuneCountInString(strings.TrimSpace(*in.Name)); n < 1 || n > 80 {
			errs["name"] = "Укажите имя (до 80 символов)"
		}
	}
	if in.City != nil && utf8.RuneCountInString(*in.City) > 80 {
		errs["city"] = "Слишком длинное название города"
	}
	if in.Bio != nil && utf8.RuneCountInString(*in.Bio) > 1000 {
		errs["bio"] = "«О себе» — до 1000 символов"
	}
	if in.AvatarURL != nil {
		*in.AvatarURL = s.canonicalFileURL(*in.AvatarURL)
	}
	if in.AvatarURL != nil && *in.AvatarURL != "" && !s.isOwnFileURL(*in.AvatarURL) {
		errs["avatar_url"] = "Загрузите фото через приложение"
	}
	if in.Social != nil {
		for k, v := range *in.Social {
			if !allowedSocial[k] || len(v) > 200 || (v != "" && !isHTTPURL(v) && k != "telegram") {
				errs["social"] = "Некорректная ссылка: " + k
			}
		}
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	var socialJSON []byte
	if in.Social != nil {
		socialJSON, _ = json.Marshal(*in.Social)
	}
	_, err := s.DB.Exec(r.Context(), `UPDATE users SET
			name = coalesce($2, name), city = coalesce($3, city), bio = coalesce($4, bio),
			avatar_url = coalesce($5, avatar_url), social = coalesce($6::jsonb, social),
			vacation_until = CASE WHEN $7 THEN NULL ELSE coalesce($8, vacation_until) END,
			vacation_note = coalesce($9, vacation_note), accepts_commissions = coalesce($10, accepts_commissions),
			commission_note = coalesce($11, commission_note), locale = coalesce($12, locale), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`,
		u.ID, trimPtr(in.Name), trimPtr(in.City), in.Bio, in.AvatarURL, nullableJSON(socialJSON),
		clearVacation, vacation, trimPtr(in.VacationNote), in.AcceptsCommissions, trimPtr(in.CommissionNote), in.Locale)
	if err != nil {
		return err
	}
	return s.getMe(w, r, u)
}

// deleteMe — удаление аккаунта (требование магазинов приложений): данные обезличиваются,
// работы снимаются с продажи, все сессии отзываются.
func (s *Server) deleteMe(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Password string `json:"password"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var hash string
		if err := tx.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, u.ID).Scan(&hash); err != nil {
			if isNoRows(err) {
				return httpx.Unauthorized("Аккаунт не найден")
			}
			return err
		}
		if !auth.CheckPassword(hash, in.Password) {
			return httpx.Forbidden("Неверный пароль")
		}
		var active int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM orders WHERE (buyer_id = $1 OR artist_id = $1)
			AND status IN ('awaiting_payment','paid','confirmed','shipped')`, u.ID).Scan(&active); err != nil {
			return err
		}
		if active > 0 {
			return httpx.Conflict("active_orders", "Сначала завершите активные заказы")
		}
		stmts := []string{
			`UPDATE users SET deleted_at = now(), email = 'deleted+' || id || '@artista.invalid', name = 'Удалённый пользователь',
				bio = '', avatar_url = '', city = '', social = '{}'::jsonb, password_hash = '!' WHERE id = $1`,
			`UPDATE artworks SET status = 'archived', updated_at = now() WHERE artist_id = $1 AND status IN ('draft','published')`,
			`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
			`DELETE FROM device_tokens WHERE user_id = $1`,
			`DELETE FROM follows WHERE follower_id = $1 OR artist_id = $1`,
			`DELETE FROM favorites WHERE user_id = $1`,
		}
		for _, q := range stmts {
			if _, err := tx.Exec(r.Context(), q, u.ID); err != nil {
				return fmt.Errorf("delete account: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.revokeAccess(u.ID)
	httpx.NoContent(w) // только после успешного коммита
	return nil
}

func (s *Server) becomeArtist(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role == "admin" {
		return httpx.Conflict("already_admin", "Администратор не может сменить роль")
	}
	var resp authResponse
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE users SET role = 'artist', updated_at = now()
			WHERE id = $1 AND deleted_at IS NULL AND banned_at IS NULL`, u.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Unauthorized("Аккаунт недоступен")
		}
		if resp.Tokens, err = s.issueTokens(r.Context(), tx, u.ID, "artist"); err != nil {
			return err
		}
		resp.User, err = loadMe(r.Context(), tx, u.ID)
		return err
	})
	if err != nil {
		return err
	}
	httpx.OK(w, resp)
	return nil
}

type statsDTO struct {
	PublishedArtworks int   `json:"published_artworks"`
	TotalViews        int64 `json:"total_views"`
	TotalFavorites    int64 `json:"total_favorites"`
	Followers         int64 `json:"followers"`
	SalesTotal        int64 `json:"sales_total"`
	RevenueTotalKop   int64 `json:"revenue_total_kop"`
	SalesMonth        int64 `json:"sales_month"`
	RevenueMonthKop   int64 `json:"revenue_month_kop"`
	ActiveOrders      int64 `json:"active_orders"`
}

func (s *Server) myStats(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Статистика доступна художникам")
	}
	var st statsDTO
	err := s.DB.QueryRow(r.Context(), `SELECT
		(SELECT count(*) FROM artworks WHERE artist_id = $1 AND status = 'published'),
		(SELECT coalesce(sum(views), 0) FROM artworks WHERE artist_id = $1),
		(SELECT count(*) FROM favorites f JOIN artworks a ON a.id = f.artwork_id WHERE a.artist_id = $1),
		(SELECT count(*) FROM follows WHERE artist_id = $1),
		(SELECT count(*) FROM orders WHERE artist_id = $1 AND status = 'completed'),
		(SELECT coalesce(sum(price_kop - commission_kop), 0) FROM orders WHERE artist_id = $1 AND status = 'completed'),
		(SELECT count(*) FROM orders WHERE artist_id = $1 AND status = 'completed' AND completed_at >= date_trunc('month', now())),
		(SELECT coalesce(sum(price_kop - commission_kop), 0) FROM orders WHERE artist_id = $1 AND status = 'completed' AND completed_at >= date_trunc('month', now())),
		(SELECT count(*) FROM orders WHERE artist_id = $1 AND status IN ('paid','confirmed','shipped'))`, u.ID).
		Scan(&st.PublishedArtworks, &st.TotalViews, &st.TotalFavorites, &st.Followers, &st.SalesTotal,
			&st.RevenueTotalKop, &st.SalesMonth, &st.RevenueMonthKop, &st.ActiveOrders)
	if err != nil {
		return err
	}
	httpx.OK(w, st)
	return nil
}

func (s *Server) addDevice(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if in.Token == "" || len(in.Token) > 300 || (in.Platform != "ios" && in.Platform != "android" && in.Platform != "web") {
		return httpx.Validation(map[string]string{"token": "Некорректный токен устройства"})
	}
	_, err := s.DB.Exec(r.Context(), `INSERT INTO device_tokens (token, user_id, platform) VALUES ($1, $2, $3)
		ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`, in.Token, u.ID, in.Platform)
	if err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) removeDevice(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`, in.Token, u.ID); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// ---------- публичные профили ----------

type userDTO struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Role         string            `json:"role"`
	City         string            `json:"city"`
	Bio          string            `json:"bio"`
	AvatarURL    string            `json:"avatar_url"`
	Social       map[string]string `json:"social"`
	IsPremium    bool              `json:"is_premium"`
	Rating       *float64          `json:"rating"`
	ReviewsCount int               `json:"reviews_count"`
	Followers    int               `json:"followers"`
	ArtworkCount int               `json:"artworks_count"`
	IsFollowing  bool              `json:"is_following"`
	// пауза магазина и приём заказов на заказ
	OnVacation         bool       `json:"on_vacation"`
	VacationUntil      *time.Time `json:"vacation_until"`
	VacationNote       string     `json:"vacation_note"`
	AcceptsCommissions bool       `json:"accepts_commissions"`
	CommissionNote     string     `json:"commission_note"`
	SeriesCount        int        `json:"series_count"`
	PostsCount         int        `json:"posts_count"`
	CreatedAt          time.Time  `json:"created_at"`
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	var d userDTO
	err = s.DB.QueryRow(r.Context(), `SELECT u.id, u.name, u.role, u.city, u.bio, u.avatar_url, u.social,
			coalesce(u.premium_until > now(), false),
			(SELECT round(avg(rating)::numeric, 1)::float8 FROM reviews WHERE artist_id = u.id),
			(SELECT count(*) FROM reviews WHERE artist_id = u.id),
			(SELECT count(*) FROM follows WHERE artist_id = u.id),
			(SELECT count(*) FROM artworks WHERE artist_id = u.id AND status IN ('published','reserved')),
			EXISTS(SELECT 1 FROM follows WHERE artist_id = u.id AND follower_id = $2::uuid),
			coalesce(u.vacation_until > now(), false), CASE WHEN u.vacation_until > now() THEN u.vacation_until END,
			CASE WHEN u.vacation_until > now() THEN u.vacation_note ELSE '' END,
			u.accepts_commissions AND u.role = 'artist', u.commission_note,
			(SELECT count(*) FROM series WHERE artist_id = u.id),
			(SELECT count(*) FROM posts WHERE artist_id = u.id AND hidden_at IS NULL),
			u.created_at
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL`, id, nullableID(viewer.ID)).
		Scan(&d.ID, &d.Name, &d.Role, &d.City, &d.Bio, &d.AvatarURL, &d.Social, &d.IsPremium, &d.Rating,
			&d.ReviewsCount, &d.Followers, &d.ArtworkCount, &d.IsFollowing,
			&d.OnVacation, &d.VacationUntil, &d.VacationNote, &d.AcceptsCommissions, &d.CommissionNote,
			&d.SeriesCount, &d.PostsCount, &d.CreatedAt)
	if isNoRows(err) {
		return httpx.NotFound("Пользователь не найден")
	}
	if err != nil {
		return err
	}
	httpx.OK(w, d)
	return nil
}

func (s *Server) follow(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if id == u.ID {
		return httpx.BadRequest("Нельзя подписаться на себя")
	}
	var role string
	err = s.DB.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&role)
	if isNoRows(err) {
		return httpx.NotFound("Пользователь не найден")
	}
	if err != nil {
		return err
	}
	if role != "artist" {
		return httpx.BadRequest("Подписаться можно только на художника")
	}
	if _, err := s.DB.Exec(r.Context(), `INSERT INTO follows (follower_id, artist_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, u.ID, id); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) unfollow(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM follows WHERE follower_id = $1 AND artist_id = $2`, u.ID, id); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// ---------- помощники ----------

// fileURLRe — ссылка на файл, который раздаёт этот API. Хост может отличаться от PUBLIC_BASE_URL:
// веб-версию открывают и по localhost, и по IP в локальной сети, и по домену.
var fileURLRe = regexp.MustCompile(`^https?://[^/?#]+/files/([A-Za-z0-9._-]+)$`)

func (s *Server) isOwnFileURL(u string) bool {
	return fileURLRe.MatchString(u)
}

// canonicalFileURL приводит ссылку на свой файл к PUBLIC_BASE_URL — в базе хранится одна форма.
func (s *Server) canonicalFileURL(u string) string {
	if m := fileURLRe.FindStringSubmatch(u); m != nil {
		return s.Config.PublicBaseURL + "/files/" + m[1]
	}
	return u
}

func isHTTPURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

func trimPtr(p *string) *string {
	if p == nil {
		return nil
	}
	t := strings.TrimSpace(*p)
	return &t
}

func nullableJSON(b []byte) any {
	if b == nil {
		return nil
	}
	return string(b)
}

// maxVacation — пауза магазина не дольше 90 дней.
const maxVacation = 90 * 24 * time.Hour

// parseVacation: nil — не менять; "" — выключить; иначе дата в будущем, не дальше 90 дней.
func parseVacation(raw *string) (until *time.Time, clear bool, problem string) {
	if raw == nil {
		return nil, false, ""
	}
	if *raw == "" {
		return nil, true, ""
	}
	t, err := time.Parse(time.RFC3339, *raw)
	if err != nil {
		return nil, false, "Некорректная дата"
	}
	if !t.After(time.Now()) || t.After(time.Now().Add(maxVacation)) {
		return nil, false, "Пауза — от сегодняшнего дня до 90 дней"
	}
	return &t, false, ""
}

// artistOnVacation — художник поставил магазин на паузу (покупки, предложения и заказы недоступны).
func artistOnVacation(ctx context.Context, q querier, artistID string) (bool, *time.Time, error) {
	var until *time.Time
	err := q.QueryRow(ctx, `SELECT CASE WHEN vacation_until > now() THEN vacation_until END FROM users WHERE id = $1`, artistID).Scan(&until)
	return until != nil, until, err
}

// vacationError — ответ, когда художник на паузе.
func vacationError(until *time.Time) error {
	msg := "Художник взял паузу и сейчас не принимает заказы"
	if until != nil {
		msg += " — до " + until.In(moscow).Format("02.01.2006")
	}
	return httpx.Conflict("artist_on_vacation", msg)
}

// moscow — часовой пояс для дат в сообщениях (без tzdata в контейнере — фиксированный UTC+3).
var moscow = time.FixedZone("MSK", 3*60*60)

// isPremiumActive — проверка премиума внутри транзакции.
func isPremiumActive(ctx context.Context, q querier, userID string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT coalesce(premium_until > now(), false) FROM users WHERE id = $1`, userID).Scan(&ok)
	return ok, err
}

// Package api — HTTP-обработчики Artista API v1 и запросы к БД для них.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/config"
	"github.com/soslatish/artista/backend/internal/httpx"
	"github.com/soslatish/artista/backend/internal/providers"
)

// Deps — зависимости сервера.
type Deps struct {
	Config   config.Config
	DB       *pgxpool.Pool
	Tokens   *auth.TokenManager
	Payments providers.Payments
	Pusher   providers.Pusher
	Mailer   providers.Mailer
	Storage  providers.Storage
	Log      *slog.Logger
}

// Server — HTTP API.
type Server struct {
	Deps
	hub         *Hub
	authLimiter *httpx.RateLimiter
	apiLimiter  *httpx.RateLimiter
}

// New создаёт сервер.
func New(d Deps) *Server {
	return &Server{
		Deps:        d,
		hub:         NewHub(),
		authLimiter: httpx.NewRateLimiter(positive(d.Config.AuthRatePerMin, 20), time.Minute),
		apiLimiter:  httpx.NewRateLimiter(positive(d.Config.APIRatePerMin, 600), time.Minute),
	}
}

func positive(v, def int) int {
	if v > 0 {
		return v
	}
	return def
}

// handlerFunc — обработчик, возвращающий ошибку.
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

func (s *Server) h(fn handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			httpx.Fail(w, r, s.Log, err)
		}
	}
}

// authed — обработчик для авторизованного пользователя.
func (s *Server) authed(fn func(w http.ResponseWriter, r *http.Request, u httpx.User) error) http.HandlerFunc {
	return s.h(func(w http.ResponseWriter, r *http.Request) error {
		u, ok := s.userFromRequest(r)
		if !ok {
			return httpx.Unauthorized("Требуется вход")
		}
		return fn(w, r.WithContext(httpx.WithUser(r.Context(), u)), u)
	})
}

// adminOnly — только для администраторов.
func (s *Server) adminOnly(fn func(w http.ResponseWriter, r *http.Request, u httpx.User) error) http.HandlerFunc {
	return s.authed(func(w http.ResponseWriter, r *http.Request, u httpx.User) error {
		if u.Role != "admin" {
			return httpx.Forbidden("Только для администраторов")
		}
		return fn(w, r, u)
	})
}

func (s *Server) userFromRequest(r *http.Request) (httpx.User, bool) {
	h := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(h, "Bearer ")
	if !ok || token == "" {
		return httpx.User{}, false
	}
	c, err := s.Tokens.Parse(token)
	if err != nil {
		return httpx.User{}, false
	}
	return httpx.User{ID: c.UserID, Role: c.Role}, true
}

// Handler собирает маршруты и middleware.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.routes(mux)
	return httpx.Chain(mux,
		httpx.Recover(s.Log),
		httpx.Logger(s.Log),
		httpx.SecurityHeaders,
		httpx.CORS(s.Config.CORSOrigins),
		s.apiLimiter.Middleware(s.Log),
	)
}

func (s *Server) routes(mux *http.ServeMux) {
	const v = "/api/v1"
	limited := func(h http.HandlerFunc) http.Handler { return s.authLimiter.Middleware(s.Log)(h) }

	mux.HandleFunc("GET /healthz", s.h(s.health))
	mux.HandleFunc("GET /files/{name}", s.serveFile)

	// Аккаунт
	mux.Handle("POST "+v+"/auth/register", limited(s.h(s.register)))
	mux.Handle("POST "+v+"/auth/login", limited(s.h(s.login)))
	mux.Handle("POST "+v+"/auth/refresh", limited(s.h(s.refresh)))
	mux.HandleFunc("POST "+v+"/auth/logout", s.h(s.logout))
	mux.Handle("POST "+v+"/auth/password/forgot", limited(s.h(s.forgotPassword)))
	mux.Handle("POST "+v+"/auth/password/reset", limited(s.h(s.resetPassword)))

	mux.HandleFunc("GET "+v+"/me", s.authed(s.getMe))
	mux.HandleFunc("PATCH "+v+"/me", s.authed(s.updateMe))
	mux.HandleFunc("DELETE "+v+"/me", s.authed(s.deleteMe))
	mux.HandleFunc("POST "+v+"/me/become-artist", s.authed(s.becomeArtist))
	mux.HandleFunc("GET "+v+"/me/stats", s.authed(s.myStats))
	mux.HandleFunc("POST "+v+"/me/devices", s.authed(s.addDevice))
	mux.HandleFunc("DELETE "+v+"/me/devices", s.authed(s.removeDevice))
	mux.HandleFunc("POST "+v+"/me/subscription", s.authed(s.buySubscription))
	mux.HandleFunc("GET "+v+"/me/artworks", s.authed(s.myArtworks))
	mux.HandleFunc("GET "+v+"/me/favorites", s.authed(s.myFavorites))

	// Пользователи
	mux.HandleFunc("GET "+v+"/users/{id}", s.h(s.getUser))
	mux.HandleFunc("GET "+v+"/users/{id}/artworks", s.h(s.userArtworks))
	mux.HandleFunc("GET "+v+"/users/{id}/reviews", s.h(s.userReviews))
	mux.HandleFunc("POST "+v+"/users/{id}/follow", s.authed(s.follow))
	mux.HandleFunc("DELETE "+v+"/users/{id}/follow", s.authed(s.unfollow))

	// Каталог и работы
	mux.HandleFunc("GET "+v+"/catalog/meta", s.h(s.catalogMeta))
	mux.HandleFunc("GET "+v+"/artworks", s.h(s.listArtworks))
	mux.HandleFunc("POST "+v+"/artworks", s.authed(s.createArtwork))
	mux.HandleFunc("GET "+v+"/artworks/{id}", s.h(s.getArtwork))
	mux.HandleFunc("PATCH "+v+"/artworks/{id}", s.authed(s.updateArtwork))
	mux.HandleFunc("DELETE "+v+"/artworks/{id}", s.authed(s.archiveArtwork))
	mux.HandleFunc("POST "+v+"/artworks/{id}/publish", s.authed(s.publishArtwork))
	mux.HandleFunc("POST "+v+"/artworks/{id}/favorite", s.authed(s.addFavorite))
	mux.HandleFunc("DELETE "+v+"/artworks/{id}/favorite", s.authed(s.removeFavorite))
	mux.HandleFunc("POST "+v+"/uploads", s.authed(s.upload))
	mux.HandleFunc("GET "+v+"/delivery/quote", s.h(s.deliveryQuote))

	// Заказы и платежи
	mux.HandleFunc("POST "+v+"/orders", s.authed(s.createOrder))
	mux.HandleFunc("GET "+v+"/orders", s.authed(s.listOrders))
	mux.HandleFunc("GET "+v+"/orders/{id}", s.authed(s.getOrder))
	mux.HandleFunc("POST "+v+"/orders/{id}/pay", s.authed(s.payOrder))
	mux.HandleFunc("POST "+v+"/orders/{id}/{action}", s.authed(s.orderAction))
	mux.HandleFunc("POST "+v+"/orders/{id}/review", s.authed(s.createReview))
	mux.HandleFunc("POST "+v+"/payments/{id}/stub-confirm", s.authed(s.stubConfirmPayment))
	mux.HandleFunc("POST "+v+"/webhooks/payments", s.h(s.paymentWebhook))

	// Чат и уведомления
	mux.HandleFunc("GET "+v+"/conversations", s.authed(s.listConversations))
	mux.HandleFunc("POST "+v+"/conversations", s.authed(s.startConversation))
	mux.HandleFunc("GET "+v+"/conversations/{id}/messages", s.authed(s.listMessages))
	mux.HandleFunc("POST "+v+"/conversations/{id}/messages", s.authed(s.sendMessage))
	mux.HandleFunc("POST "+v+"/conversations/{id}/read", s.authed(s.markConversationRead))
	mux.HandleFunc("GET "+v+"/ws", s.websocket)
	mux.HandleFunc("GET "+v+"/notifications", s.authed(s.listNotifications))
	mux.HandleFunc("POST "+v+"/notifications/read", s.authed(s.readNotifications))

	// Жалобы и модерация
	mux.HandleFunc("POST "+v+"/reports", s.authed(s.createReport))
	mux.HandleFunc("GET "+v+"/admin/reports", s.adminOnly(s.listReports))
	mux.HandleFunc("POST "+v+"/admin/reports/{id}/resolve", s.adminOnly(s.resolveReport))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.DB.Ping(ctx); err != nil {
		return err
	}
	httpx.OK(w, map[string]string{"status": "ok"})
	return nil
}

// ---------- общие помощники ----------

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// pathID достаёт UUID из пути; некорректный id — 404.
func pathID(r *http.Request, name string) (string, error) {
	id := strings.ToLower(r.PathValue(name))
	if !uuidRe.MatchString(id) {
		return "", httpx.NotFound("Не найдено")
	}
	return id, nil
}

func isUUID(s string) bool { return uuidRe.MatchString(strings.ToLower(s)) }

const (
	defaultLimit = 20
	maxLimit     = 50
)

// page — параметры пагинации (курсор — смещение).
type page struct{ limit, offset int }

func parsePage(r *http.Request) page {
	p := page{limit: defaultLimit}
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		p.limit = min(n, maxLimit)
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("cursor")); err == nil && n > 0 {
		p.offset = n
	}
	return p
}

// meta возвращает next_cursor, если страница заполнена.
func (p page) meta(got int) map[string]any {
	m := map[string]any{"next_cursor": nil}
	if got == p.limit {
		m["next_cursor"] = strconv.Itoa(p.offset + got)
	}
	return m
}

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// withTx выполняет fn в транзакции.
func (s *Server) withTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, s.DB, fn)
}

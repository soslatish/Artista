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
	"sync"
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
	hub            *Hub
	authLimiter    *httpx.RateLimiter
	apiLimiter     *httpx.RateLimiter
	accountLimiter *httpx.RateLimiter // попытки входа по одному e-mail
	uploadLimiter  *httpx.RateLimiter // загрузки файлов одним пользователем
	active         *activeCache
	bg             sync.WaitGroup // фоновые задачи (воркер, рассылки) — ждём при остановке
}

const (
	loginAttemptsPerAccount = 10
	loginWindow             = 15 * time.Minute
	uploadsPerUserHour      = 60
)

// New создаёт сервер.
func New(d Deps) *Server {
	return &Server{
		Deps:           d,
		hub:            NewHub(),
		authLimiter:    httpx.NewRateLimiter(positive(d.Config.AuthRatePerMin, 20), time.Minute),
		apiLimiter:     httpx.NewRateLimiter(positive(d.Config.APIRatePerMin, 600), time.Minute),
		accountLimiter: httpx.NewRateLimiter(loginAttemptsPerAccount, loginWindow),
		uploadLimiter:  httpx.NewRateLimiter(uploadsPerUserHour, time.Hour),
		active:         newActiveCache(30 * time.Second),
	}
}

// StartWorker запускает фоновый воркер (дедлайны заказов, очередь возвратов).
func (s *Server) StartWorker(ctx context.Context) {
	s.goBackground(func() { s.RunWorker(ctx) })
}

// CloseRealtime закрывает все WebSocket-подключения.
func (s *Server) CloseRealtime() { s.hub.CloseAll() }

// Shutdown закрывает WebSocket-подключения и ждёт фоновые задачи.
// Вызывать после http.Server.Shutdown и отмены контекста воркера.
func (s *Server) Shutdown() {
	s.hub.CloseAll()
	s.bg.Wait()
}

// WaitBackground ждёт завершения текущих фоновых задач (для тестов и диагностики).
func (s *Server) WaitBackground() { s.bg.Wait() }

// goBackground запускает задачу, которую дождётся Shutdown.
func (s *Server) goBackground(fn func()) {
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		fn()
	}()
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
		active, err := s.isActive(r.Context(), u.ID)
		if err != nil {
			return err
		}
		if !active {
			return httpx.Unauthorized("Аккаунт недоступен")
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
		s.apiLimiter.Middleware(s.Log, s.Config.TrustProxyHeaders),
	)
}

func (s *Server) routes(mux *http.ServeMux) {
	const v = "/api/v1"
	limited := func(h http.HandlerFunc) http.Handler {
		return s.authLimiter.Middleware(s.Log, s.Config.TrustProxyHeaders)(h)
	}

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

// ---------- активность пользователя ----------

// activeCache кэширует признак «аккаунт не удалён и не заблокирован» на короткое время,
// чтобы не ходить в БД на каждый запрос. Блокировка и удаление сбрасывают запись сразу.
type activeCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]activeEntry
}

type activeEntry struct {
	active bool
	exp    time.Time
}

func newActiveCache(ttl time.Duration) *activeCache {
	return &activeCache{ttl: ttl, m: map[string]activeEntry{}}
}

func (c *activeCache) get(id string) (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[id]
	if !ok || time.Now().After(e.exp) {
		return false, false
	}
	return e.active, true
}

func (c *activeCache) set(id string, active bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) > 50_000 {
		c.m = map[string]activeEntry{}
	}
	c.m[id] = activeEntry{active: active, exp: time.Now().Add(c.ttl)}
}

func (s *Server) isActive(ctx context.Context, userID string) (bool, error) {
	if v, ok := s.active.get(userID); ok {
		return v, nil
	}
	var active bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL AND banned_at IS NULL)`, userID).Scan(&active)
	if err != nil {
		return false, err
	}
	s.active.set(userID, active)
	return active, nil
}

// revokeAccess — после блокировки/удаления: сбросить кэш и закрыть WebSocket.
func (s *Server) revokeAccess(userID string) {
	s.active.set(userID, false)
	s.hub.Disconnect(userID)
}

// nullableID — пустой id зрителя превращается в NULL (сравнение с uuid-колонкой без ::text).
func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

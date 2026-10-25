// Package apitest — интеграционные тесты HTTP API на реальном Postgres.
// БД: TEST_DATABASE_URL (по умолчанию postgres://artista:artista@localhost:5432/artista_test).
// Схема public пересоздаётся перед прогоном.
package apitest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/soslatish/artista/backend/internal/api"
	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/config"
	"github.com/soslatish/artista/backend/internal/db"
	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/providers"
)

var (
	ts     *httptest.Server
	pool   *pgxpool.Pool
	srv    *api.Server
	mailer = &providers.MemoryMailer{}
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://artista:artista@localhost:5432/artista_test?sslmode=disable"
	}
	ctx := context.Background()
	var err error
	pool, err = db.Open(ctx, dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, "SKIP integration tests: no database:", err)
		return 0
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		fmt.Fprintln(os.Stderr, "reset schema:", err)
		return 1
	}
	if err := db.Migrate(ctx, pool); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		return 1
	}
	// повторный запуск миграций не должен ничего ломать
	if err := db.Migrate(ctx, pool); err != nil {
		fmt.Fprintln(os.Stderr, "migrate twice:", err)
		return 1
	}
	auth.BcryptCost = bcrypt.MinCost

	uploadDir, _ := os.MkdirTemp("", "artista-uploads")
	defer os.RemoveAll(uploadDir)
	// минимальная «сборка» веб-версии для /app/
	webDir, _ := os.MkdirTemp("", "artista-webapp")
	defer os.RemoveAll(webDir)
	_ = os.MkdirAll(webDir+"/_expo/static/js", 0o755)
	_ = os.WriteFile(webDir+"/index.html", []byte("<!doctype html><div id=root>artista-webapp</div>"), 0o644)
	_ = os.WriteFile(webDir+"/_expo/static/js/app-123.js", []byte("console.log(1)"), 0o644)

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	// базовый URL нужен до старта сервера — используем неинициализированный httptest
	ts = httptest.NewUnstartedServer(nil)
	base := "http://" + ts.Listener.Addr().String()
	cfg := config.Config{
		Env: "test", DatabaseURL: dsn, JWTSecret: []byte(strings.Repeat("t", 32)),
		AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour, PublicBaseURL: base,
		UploadDir: uploadDir, WebAppDir: webDir, MaxUploadBytes: 1 << 20, PaymentsProvider: "stub",
		CORSOrigins: []string{"*"}, WorkerInterval: time.Hour,
		AuthRatePerMin: 100_000, APIRatePerMin: 100_000,
	}
	srv = api.New(api.Deps{
		Config: cfg, DB: pool, Tokens: auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTTL),
		Payments: providers.StubPayments{Log: log}, Pusher: providers.LogPusher{Log: log},
		Mailer: mailer, Storage: providers.LocalStorage{Dir: uploadDir, BaseURL: base}, Log: log,
	})
	// большинство сценариев проверяют сделку через площадку; прямые сделки — в direct_test.go
	if err := setDealMode(ctx, true); err != nil {
		fmt.Fprintln(os.Stderr, "settings:", err)
		return 1
	}
	ts.Config.Handler = srv.Handler()
	ts.Start()
	defer ts.Close()
	return m.Run()
}

// resp — разобранный ответ API.
type resp struct {
	Status int
	Data   json.RawMessage
	Meta   map[string]any
	Error  struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Fields  map[string]string `json:"fields"`
	}
}

func (r resp) into(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Data, v); err != nil {
		t.Fatalf("decode data %s: %v", r.Data, err)
	}
}

func call(t *testing.T, method, path, token string, body any) resp {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return send(t, req)
}

func send(t *testing.T, req *http.Request) resp {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL.Path, err)
	}
	defer res.Body.Close()
	out := resp{Status: res.StatusCode}
	raw, _ := io.ReadAll(res.Body)
	if len(raw) > 0 && strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		var env struct {
			Data  json.RawMessage `json:"data"`
			Meta  map[string]any  `json:"meta"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("bad json %s", raw)
		}
		out.Data, out.Meta = env.Data, env.Meta
		if len(env.Error) > 0 {
			_ = json.Unmarshal(env.Error, &out.Error)
		}
	}
	return out
}

func expect(t *testing.T, r resp, status int) {
	t.Helper()
	if r.Status != status {
		t.Fatalf("status = %d, want %d; error=%+v data=%s", r.Status, status, r.Error, r.Data)
	}
}

// user — зарегистрированный тестовый пользователь.
type user struct {
	ID, Email, Password, Access, Refresh, Role string
}

var seq int

func register(t *testing.T, role string) user {
	t.Helper()
	seq++
	u := user{Email: fmt.Sprintf("user%d_%d@test.ru", seq, time.Now().UnixNano()), Password: "secret123", Role: role}
	r := call(t, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": u.Email, "password": u.Password, "name": fmt.Sprintf("%s %d", role, seq), "role": role, "city": "Москва",
	})
	expect(t, r, http.StatusCreated)
	var out struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		Tokens struct {
			Access  string `json:"access_token"`
			Refresh string `json:"refresh_token"`
		} `json:"tokens"`
	}
	r.into(t, &out)
	u.ID, u.Access, u.Refresh = out.User.ID, out.Tokens.Access, out.Tokens.Refresh
	return u
}

// pngBytes — минимальный валидный PNG 1×1.
var pngBytes = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
	0x00, 0x05, 0x00, 0x01, 0xe9, 0xfa, 0xdc, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
	0xae, 0x42, 0x60, 0x82,
}

func uploadFile(t *testing.T, token string, content []byte) resp {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/uploads", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	return send(t, req)
}

func uploadImage(t *testing.T, token string) string {
	t.Helper()
	r := uploadFile(t, token, pngBytes)
	expect(t, r, http.StatusCreated)
	var out struct {
		URL string `json:"url"`
	}
	r.into(t, &out)
	return out.URL
}

// artworkBody — валидная работа.
func artworkBody(title string, priceKop int64, images []string, publish bool) map[string]any {
	return map[string]any{
		"title": title, "description": "Холст, масло. Петербургские крыши на закате.",
		"category": "painting", "style": "impressionism", "technique": "oil", "materials": "холст, масло",
		"width_cm": 60, "height_cm": 80, "depth_cm": 2, "year": 2025, "price_kop": priceKop,
		"images": images, "publish": publish,
	}
}

type artwork struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Status         string   `json:"status"`
	PriceKop       int64    `json:"price_kop"`
	Views          int64    `json:"views"`
	FavoritesCount int64    `json:"favorites_count"`
	IsFavorite     bool     `json:"is_favorite"`
	Images         []string `json:"images"`
	Artist         struct {
		ID        string `json:"id"`
		IsPremium bool   `json:"is_premium"`
	} `json:"artist"`
}

func publishArtwork(t *testing.T, artist user, title string, priceKop int64) artwork {
	t.Helper()
	img := uploadImage(t, artist.Access)
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody(title, priceKop, []string{img}, true))
	expect(t, r, http.StatusCreated)
	var a artwork
	r.into(t, &a)
	return a
}

func exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func login(t *testing.T, email, password string) (string, string) {
	t.Helper()
	r := call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": email, "password": password})
	expect(t, r, http.StatusOK)
	var out struct {
		Tokens struct {
			Access  string `json:"access_token"`
			Refresh string `json:"refresh_token"`
		} `json:"tokens"`
	}
	r.into(t, &out)
	return out.Tokens.Access, out.Tokens.Refresh
}

// setDealMode включает или выключает «Безопасную сделку» (и платное продвижение) в настройках платформы.
func setDealMode(ctx context.Context, safe bool) error {
	cfg := domain.DefaultSettings()
	cfg.SafeDeals, cfg.PromotionSales = safe, safe
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `INSERT INTO platform_settings (id, data) VALUES (1, $1)
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, raw); err != nil {
		return err
	}
	return srv.LoadSettings(ctx)
}

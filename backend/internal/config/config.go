// Package config читает настройки из переменных окружения.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config — настройки приложения.
type Config struct {
	Env           string // dev | prod
	Addr          string
	DatabaseURL   string
	JWTSecret     []byte
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
	PublicBaseURL string // базовый URL для ссылок на файлы
	SiteURL       string // адрес сайта для публичных ссылок (по умолчанию = PublicBaseURL)
	// для App Links / Universal Links (необязательно)
	AndroidCertFingerprints []string // SHA-256 отпечатки ключа подписи (через запятую)
	AppleTeamID             string
	// ссылки на магазины для сайта
	StoreGooglePlay, StoreRuStore, StoreAppStore string
	SupportEmail                                 string // адрес поддержки на сайте (необязательно)
	UploadDir                                    string
	MaxUploadBytes                               int64
	PaymentsProvider                             string // stub
	PushProvider                                 string // log
	MailProvider                                 string // log
	CORSOrigins                                  []string
	WorkerInterval                               time.Duration
	AuthRatePerMin                               int // лимит запросов на вход/регистрацию с одного IP в минуту
	APIRatePerMin                                int // общий лимит запросов с одного IP в минуту
	// AllowStubPayments — явное разрешение тестовых платежей (иначе stub запрещён в любом окружении).
	AllowStubPayments bool
	// TrustProxyHeaders — брать IP клиента из X-Real-IP (только за своим nginx).
	TrustProxyHeaders bool
}

// Load читает окружение и проверяет обязательные значения.
func Load() (Config, error) {
	c := Config{
		Env:                     env("APP_ENV", "dev"),
		Addr:                    env("HTTP_ADDR", ":8080"),
		DatabaseURL:             os.Getenv("DATABASE_URL"),
		JWTSecret:               []byte(os.Getenv("JWT_SECRET")),
		AccessTTL:               durationEnv("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:              durationEnv("REFRESH_TTL", 30*24*time.Hour),
		PublicBaseURL:           strings.TrimRight(env("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		SiteURL:                 strings.TrimRight(os.Getenv("SITE_URL"), "/"),
		AndroidCertFingerprints: splitList(os.Getenv("ANDROID_CERT_FINGERPRINTS")),
		AppleTeamID:             os.Getenv("APPLE_TEAM_ID"),
		StoreGooglePlay:         env("STORE_GOOGLE_PLAY", "https://play.google.com/store/apps/details?id=com.aleksandr.artista"),
		StoreRuStore:            env("STORE_RUSTORE", "https://www.rustore.ru/catalog/app/com.aleksandr.artista"),
		StoreAppStore:           os.Getenv("STORE_APP_STORE"),
		SupportEmail:            os.Getenv("SUPPORT_EMAIL"),
		UploadDir:               env("UPLOAD_DIR", "./uploads"),
		MaxUploadBytes:          int64Env("MAX_UPLOAD_BYTES", 10<<20),
		PaymentsProvider:        env("PAYMENTS_PROVIDER", "stub"),
		PushProvider:            env("PUSH_PROVIDER", "log"),
		MailProvider:            env("MAIL_PROVIDER", "log"),
		CORSOrigins:             splitList(env("CORS_ORIGINS", "*")),
		WorkerInterval:          durationEnv("WORKER_INTERVAL", time.Minute),
		AuthRatePerMin:          int(int64Env("AUTH_RATE_PER_MIN", 20)),
		APIRatePerMin:           int(int64Env("API_RATE_PER_MIN", 600)),
		AllowStubPayments:       os.Getenv("ALLOW_STUB_PAYMENTS") == "true",
		TrustProxyHeaders:       os.Getenv("TRUST_PROXY_HEADERS") == "true",
	}
	var problems []string
	if c.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		problems = append(problems, "JWT_SECRET must be at least 32 bytes")
	}
	problems = append(problems, c.providerProblems()...)
	if c.WorkerInterval <= 0 {
		problems = append(problems, "WORKER_INTERVAL must be positive")
	}
	if len(problems) > 0 {
		return Config{}, errors.New(strings.Join(problems, "; "))
	}
	return c, nil
}

// providerProblems проверяет, что выбранные провайдеры реализованы и допустимы в окружении.
func (c Config) providerProblems() []string {
	var p []string
	switch c.PaymentsProvider {
	case "stub":
		if c.Env == "prod" {
			p = append(p, "PAYMENTS_PROVIDER=stub is not allowed in prod")
		} else if !c.AllowStubPayments {
			p = append(p, "PAYMENTS_PROVIDER=stub requires ALLOW_STUB_PAYMENTS=true")
		}
	default:
		p = append(p, "PAYMENTS_PROVIDER "+c.PaymentsProvider+" is not implemented yet")
	}
	if c.MailProvider != "log" {
		p = append(p, "MAIL_PROVIDER "+c.MailProvider+" is not implemented yet")
	} else if c.Env == "prod" {
		p = append(p, "MAIL_PROVIDER=log is not allowed in prod")
	}
	if c.PushProvider != "log" {
		p = append(p, "PUSH_PROVIDER "+c.PushProvider+" is not implemented yet")
	}
	return p
}

// StubPayments — включён ли тестовый платёжный провайдер.
func (c Config) StubPayments() bool { return c.PaymentsProvider == "stub" }

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func durationEnv(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		fmt.Fprintf(os.Stderr, "config: bad duration %s=%q, using %s\n", key, v, def)
	}
	return def
}

func int64Env(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

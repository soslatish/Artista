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
	Env              string // dev | prod
	Addr             string
	DatabaseURL      string
	JWTSecret        []byte
	AccessTTL        time.Duration
	RefreshTTL       time.Duration
	PublicBaseURL    string // базовый URL для ссылок на файлы
	UploadDir        string
	MaxUploadBytes   int64
	PaymentsProvider string // stub
	PushProvider     string // log
	MailProvider     string // log
	CORSOrigins      []string
	WorkerInterval   time.Duration
	AuthRatePerMin   int // лимит запросов на вход/регистрацию с одного IP в минуту
	APIRatePerMin    int // общий лимит запросов с одного IP в минуту
}

// Load читает окружение и проверяет обязательные значения.
func Load() (Config, error) {
	c := Config{
		Env:              env("APP_ENV", "dev"),
		Addr:             env("HTTP_ADDR", ":8080"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		JWTSecret:        []byte(os.Getenv("JWT_SECRET")),
		AccessTTL:        durationEnv("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:       durationEnv("REFRESH_TTL", 30*24*time.Hour),
		PublicBaseURL:    strings.TrimRight(env("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		UploadDir:        env("UPLOAD_DIR", "./uploads"),
		MaxUploadBytes:   int64Env("MAX_UPLOAD_BYTES", 10<<20),
		PaymentsProvider: env("PAYMENTS_PROVIDER", "stub"),
		PushProvider:     env("PUSH_PROVIDER", "log"),
		MailProvider:     env("MAIL_PROVIDER", "log"),
		CORSOrigins:      splitList(env("CORS_ORIGINS", "*")),
		WorkerInterval:   durationEnv("WORKER_INTERVAL", time.Minute),
		AuthRatePerMin:   int(int64Env("AUTH_RATE_PER_MIN", 20)),
		APIRatePerMin:    int(int64Env("API_RATE_PER_MIN", 600)),
	}
	var problems []string
	if c.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		problems = append(problems, "JWT_SECRET must be at least 32 bytes")
	}
	if c.Env == "prod" && c.PaymentsProvider == "stub" {
		problems = append(problems, "PAYMENTS_PROVIDER=stub is not allowed in prod")
	}
	if len(problems) > 0 {
		return Config{}, errors.New(strings.Join(problems, "; "))
	}
	return c, nil
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

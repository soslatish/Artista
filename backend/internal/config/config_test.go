package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadRequiresSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "short")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected both problems, got %v", err)
	}
}

func TestLoadRejectsStubPaymentsInProd(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
	t.Setenv("APP_ENV", "prod")
	t.Setenv("PAYMENTS_PROVIDER", "")
	if _, err := Load(); err == nil {
		t.Fatal("stub payments must be rejected in prod")
	}
}

func TestLoadDefaultsAndOverrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
	t.Setenv("APP_ENV", "")
	t.Setenv("ACCESS_TTL", "5m")
	t.Setenv("REFRESH_TTL", "bogus")
	t.Setenv("CORS_ORIGINS", "https://a.ru, https://b.ru")
	t.Setenv("PUBLIC_BASE_URL", "https://api.proartista.ru/")
	t.Setenv("MAX_UPLOAD_BYTES", "1024")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.AccessTTL != 5*time.Minute || c.RefreshTTL != 30*24*time.Hour {
		t.Errorf("ttl: %v %v", c.AccessTTL, c.RefreshTTL)
	}
	if len(c.CORSOrigins) != 2 || c.CORSOrigins[1] != "https://b.ru" {
		t.Errorf("cors: %v", c.CORSOrigins)
	}
	if c.PublicBaseURL != "https://api.proartista.ru" || c.MaxUploadBytes != 1024 || !c.StubPayments() {
		t.Errorf("unexpected: %+v", c)
	}
}

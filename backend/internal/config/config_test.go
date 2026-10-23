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
	t.Setenv("ALLOW_STUB_PAYMENTS", "true")
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

func TestLoadProviderRules(t *testing.T) {
	base := func() {
		t.Setenv("DATABASE_URL", "postgres://x")
		t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
		t.Setenv("APP_ENV", "dev")
		t.Setenv("PAYMENTS_PROVIDER", "stub")
		t.Setenv("ALLOW_STUB_PAYMENTS", "true")
		t.Setenv("MAIL_PROVIDER", "")
		t.Setenv("PUSH_PROVIDER", "")
		t.Setenv("WORKER_INTERVAL", "")
	}
	cases := []struct {
		name, key, val, want string
	}{
		{"stub needs explicit allow", "ALLOW_STUB_PAYMENTS", "", "ALLOW_STUB_PAYMENTS"},
		{"unknown payments provider", "PAYMENTS_PROVIDER", "yookassa", "not implemented"},
		{"unknown mail provider", "MAIL_PROVIDER", "smtp", "not implemented"},
		{"unknown push provider", "PUSH_PROVIDER", "expo", "not implemented"},
		{"bad worker interval", "WORKER_INTERVAL", "-1s", "WORKER_INTERVAL"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			base()
			t.Setenv(c.key, c.val)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want %q, got %v", c.want, err)
			}
		})
	}
	base()
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	c, err := Load()
	if err != nil || !c.TrustProxyHeaders || !c.AllowStubPayments {
		t.Fatalf("valid dev config rejected: %v %+v", err, c)
	}
	base()
	t.Setenv("APP_ENV", "prod")
	t.Setenv("PAYMENTS_PROVIDER", "stub")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "MAIL_PROVIDER=log") {
		t.Fatalf("prod must refuse log mailer: %v", err)
	}
}

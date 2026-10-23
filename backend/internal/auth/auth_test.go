package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var secret = []byte(strings.Repeat("k", 32))

func TestPasswordHashAndCheck(t *testing.T) {
	h, err := HashPassword("secret123")
	if err != nil {
		t.Fatal(err)
	}
	if h == "secret123" || !CheckPassword(h, "secret123") {
		t.Fatal("hash must verify original password")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password must not verify")
	}
}

func TestAccessTokenRoundTrip(t *testing.T) {
	m := NewTokenManager(secret, time.Minute)
	tok, err := m.Issue("user-1", "artist")
	if err != nil {
		t.Fatal(err)
	}
	c, err := m.Parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.UserID != "user-1" || c.Role != "artist" {
		t.Fatalf("claims: %+v", c)
	}
}

func TestAccessTokenRejectsExpiredAndForeign(t *testing.T) {
	expired := NewTokenManager(secret, -time.Minute)
	tok, _ := expired.Issue("u", "buyer")
	if _, err := NewTokenManager(secret, time.Minute).Parse(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expired: %v", err)
	}
	other := NewTokenManager([]byte(strings.Repeat("z", 32)), time.Minute)
	tok2, _ := other.Issue("u", "buyer")
	if _, err := NewTokenManager(secret, time.Minute).Parse(tok2); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("foreign: %v", err)
	}
	if _, err := NewTokenManager(secret, time.Minute).Parse("garbage"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("garbage: %v", err)
	}
}

func TestAccessTokenRejectsAlgNone(t *testing.T) {
	claims := jwt.MapClaims{"sub": "u", "role": "admin", "exp": time.Now().Add(time.Hour).Unix(), "iss": issuer}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewTokenManager(secret, time.Minute).Parse(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("alg none must be rejected, got %v", err)
	}
}

func TestOpaqueTokens(t *testing.T) {
	a, ah, err := NewOpaqueToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := NewOpaqueToken()
	if a == b || len(a) < 40 {
		t.Fatalf("tokens must be long and unique: %q %q", a, b)
	}
	if HashToken(a) != ah {
		t.Fatal("hash must be deterministic")
	}
}

func TestResetCode(t *testing.T) {
	c, err := NewResetCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(c) != 6 || strings.Trim(c, "0123456789") != "" {
		t.Fatalf("bad code %q", c)
	}
}

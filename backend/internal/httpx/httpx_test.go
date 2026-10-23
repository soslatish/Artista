package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestFailMapsAPIError(t *testing.T) {
	rec := httptest.NewRecorder()
	Fail(rec, httptest.NewRequest("GET", "/", nil), quiet, Validation(map[string]string{"title": "bad"}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Error Error `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Error.Code != "validation" || body.Error.Fields["title"] != "bad" {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestFailHidesInternalErrors(t *testing.T) {
	rec := httptest.NewRecorder()
	Fail(rec, httptest.NewRequest("GET", "/", nil), quiet, errors.New("pq: secret table broke"))
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("leaked: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDecode(t *testing.T) {
	type in struct {
		A int `json:"a"`
	}
	cases := []struct {
		name, body, ct string
		ok             bool
	}{
		{"ok", `{"a":1}`, "application/json", true},
		{"unknown field", `{"a":1,"b":2}`, "application/json", false},
		{"empty", ``, "application/json", false},
		{"wrong content type", `{"a":1}`, "text/plain", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(c.body))
			r.Header.Set("Content-Type", c.ct)
			var v in
			err := Decode(httptest.NewRecorder(), r, &v)
			if (err == nil) != c.ok {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestRateLimiter(t *testing.T) {
	l := NewRateLimiter(2, time.Minute)
	now := time.Now()
	l.now = func() time.Time { return now }
	if !l.Allow("ip") || !l.Allow("ip") || l.Allow("ip") {
		t.Fatal("third request in window must be blocked")
	}
	if !l.Allow("other") {
		t.Fatal("keys are independent")
	}
	now = now.Add(2 * time.Minute)
	if !l.Allow("ip") {
		t.Fatal("window must reset")
	}
}

func TestMiddlewareChain(t *testing.T) {
	h := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("boom") }),
		Recover(quiet), Logger(quiet), SecurityHeaders, CORS([]string{"https://ok.ru"}))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Origin", "https://ok.ru")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != 500 || rec.Header().Get("Access-Control-Allow-Origin") != "https://ok.ru" ||
		rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("code=%d headers=%v", rec.Code, rec.Header())
	}

	pre := httptest.NewRequest("OPTIONS", "/", nil)
	pre.Header.Set("Origin", "https://evil.ru")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, pre)
	if rec2.Code != 204 || rec2.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("preflight from foreign origin: %d %v", rec2.Code, rec2.Header())
	}
}

func TestRateLimitMiddlewareAndClientIP(t *testing.T) {
	l := NewRateLimiter(1, time.Minute)
	h := l.Middleware(quiet, true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	if ClientIP(r, true) != "1.2.3.4" {
		t.Fatal("X-Real-IP must be used behind trusted proxy")
	}
	if ClientIP(r, false) == "1.2.3.4" {
		t.Fatal("X-Real-IP must be ignored without trusted proxy")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", rec.Code)
	}
	r2 := httptest.NewRequest("GET", "/", nil)
	if ClientIP(r2, true) != "192.0.2.1" {
		t.Fatalf("remote addr ip: %s", ClientIP(r2, true))
	}
	v6a := httptest.NewRequest("GET", "/", nil)
	v6a.RemoteAddr = "[2001:db8:1:2:aaaa::1]:5000"
	v6b := httptest.NewRequest("GET", "/", nil)
	v6b.RemoteAddr = "[2001:db8:1:2:bbbb::9]:5000"
	if ClientKey(v6a, false) != ClientKey(v6b, false) || ClientKey(v6a, false) != "2001:db8:1:2::/64" {
		t.Fatalf("ipv6 /64 bucketing: %s %s", ClientKey(v6a, false), ClientKey(v6b, false))
	}
	bad := httptest.NewRequest("GET", "/", nil)
	bad.RemoteAddr = "garbage"
	if ClientKey(bad, false) != "garbage" {
		t.Fatal("unparsable remote addr")
	}
}

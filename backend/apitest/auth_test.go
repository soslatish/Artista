package apitest

import (
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func TestHealthAndMeta(t *testing.T) {
	expect(t, call(t, "GET", "/healthz", "", nil), http.StatusOK)
	r := call(t, "GET", "/api/v1/catalog/meta", "", nil)
	expect(t, r, http.StatusOK)
	var meta struct {
		Categories   []struct{ Code string } `json:"categories"`
		CommissionBP int                     `json:"commission_bp"`
	}
	r.into(t, &meta)
	if len(meta.Categories) == 0 || meta.CommissionBP != 1500 {
		t.Fatalf("meta %+v", meta)
	}
}

func TestRegisterValidationAndDuplicates(t *testing.T) {
	r := call(t, "POST", "/api/v1/auth/register", "", map[string]string{"email": "bad", "password": "1", "name": "", "role": "admin"})
	expect(t, r, http.StatusUnprocessableEntity)
	for _, f := range []string{"email", "password", "name", "role"} {
		if r.Error.Fields[f] == "" {
			t.Errorf("expected field error %s: %+v", f, r.Error.Fields)
		}
	}
	u := register(t, "buyer")
	r = call(t, "POST", "/api/v1/auth/register", "", map[string]string{"email": strings.ToUpper(u.Email), "password": "secret123", "name": "X"})
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "email_taken" {
		t.Fatalf("code %s", r.Error.Code)
	}
	expect(t, call(t, "POST", "/api/v1/auth/register", "", map[string]any{"email": "x@y.ru", "unknown": 1}), http.StatusBadRequest)
}

func TestLoginRefreshLogout(t *testing.T) {
	u := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": u.Email, "password": "wrong-pass"}), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": "nobody@test.ru", "password": "secret123"}), http.StatusUnauthorized)
	_, refresh := login(t, " "+strings.ToUpper(u.Email), u.Password)

	r := call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh})
	expect(t, r, http.StatusOK)
	var pair struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
	}
	r.into(t, &pair)
	expect(t, call(t, "GET", "/api/v1/me", pair.Access, nil), http.StatusOK)

	// повторное использование старого токена — отзыв всех сессий
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh}), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": pair.Refresh}), http.StatusUnauthorized)

	_, refresh2 := login(t, u.Email, u.Password)
	expect(t, call(t, "POST", "/api/v1/auth/logout", "", map[string]string{"refresh_token": refresh2}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh2}), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": "nonsense"}), http.StatusUnauthorized)
}

func TestUnauthorizedAccess(t *testing.T) {
	expect(t, call(t, "GET", "/api/v1/me", "", nil), http.StatusUnauthorized)
	expect(t, call(t, "GET", "/api/v1/me", "not-a-jwt", nil), http.StatusUnauthorized)
	expect(t, call(t, "GET", "/api/v1/artworks/not-a-uuid", "", nil), http.StatusNotFound)
}

var codeRe = regexp.MustCompile(`\b(\d{6})\b`)

func TestPasswordReset(t *testing.T) {
	u := register(t, "buyer")
	// неизвестный e-mail — тот же ответ
	expect(t, call(t, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "ghost@test.ru"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": u.Email}), http.StatusNoContent)
	mail, ok := mailer.Last(u.Email)
	if !ok {
		t.Fatal("reset mail not sent")
	}
	code := codeRe.FindStringSubmatch(mail.Body)[1]

	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	r := call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": wrong, "password": "newpass123"})
	expect(t, r, http.StatusBadRequest)
	expect(t, call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": code, "password": "short"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": code, "password": "newpass123"}), http.StatusNoContent)
	// старый refresh отозван, старый пароль не работает, код одноразовый
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": u.Refresh}), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": u.Email, "password": u.Password}), http.StatusUnauthorized)
	login(t, u.Email, "newpass123")
	expect(t, call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": code, "password": "another123"}), http.StatusBadRequest)
}

func TestPasswordResetAttemptsLimit(t *testing.T) {
	u := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": u.Email}), http.StatusNoContent)
	mail, _ := mailer.Last(u.Email)
	code := codeRe.FindStringSubmatch(mail.Body)[1]
	for i := 0; i < 5; i++ {
		bad := "99999" + string(rune('0'+i))
		if bad == code {
			bad = "888888"
		}
		call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": bad, "password": "newpass123"})
	}
	expect(t, call(t, "POST", "/api/v1/auth/password/reset", "", map[string]string{"email": u.Email, "code": code, "password": "newpass123"}), http.StatusBadRequest)
}

func TestProfileUpdateAndBecomeArtist(t *testing.T) {
	u := register(t, "buyer")
	avatar := uploadImage(t, u.Access)
	r := call(t, "PATCH", "/api/v1/me", u.Access, map[string]any{
		"name": "  Анна Петрова ", "city": "Казань", "bio": "Коллекционер", "avatar_url": avatar,
		"social": map[string]string{"vk": "https://vk.com/anna", "telegram": "@anna"},
	})
	expect(t, r, http.StatusOK)
	var me struct {
		Name, City, Role, AvatarURL string
		Social                      map[string]string
	}
	r.into(t, &me)
	if me.Name != "Анна Петрова" || me.City != "Казань" || me.Social["vk"] == "" {
		t.Fatalf("me %+v", me)
	}
	r = call(t, "PATCH", "/api/v1/me", u.Access, map[string]any{"avatar_url": "https://evil.ru/x.png", "social": map[string]string{"myspace": "x"}})
	expect(t, r, http.StatusUnprocessableEntity)

	// покупатель не может публиковать работы и смотреть статистику
	expect(t, call(t, "POST", "/api/v1/artworks", u.Access, artworkBody("Тест", 10_000_00, nil, false)), http.StatusForbidden)
	expect(t, call(t, "GET", "/api/v1/me/stats", u.Access, nil), http.StatusForbidden)

	r = call(t, "POST", "/api/v1/me/become-artist", u.Access, nil)
	expect(t, r, http.StatusOK)
	var out struct {
		User   struct{ Role string } `json:"user"`
		Tokens struct {
			Access string `json:"access_token"`
		} `json:"tokens"`
	}
	r.into(t, &out)
	if out.User.Role != "artist" {
		t.Fatalf("role %s", out.User.Role)
	}
	expect(t, call(t, "GET", "/api/v1/me/stats", out.Tokens.Access, nil), http.StatusOK)
}

func TestDevices(t *testing.T) {
	u := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/me/devices", u.Access, map[string]string{"token": "ExponentPushToken[abc]", "platform": "ios"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/me/devices", u.Access, map[string]string{"token": "ExponentPushToken[abc]", "platform": "ios"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/me/devices", u.Access, map[string]string{"token": "", "platform": "symbian"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "DELETE", "/api/v1/me/devices", u.Access, map[string]string{"token": "ExponentPushToken[abc]"}), http.StatusNoContent)
}

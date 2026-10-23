package apitest

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestChatAndWebSocket(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Обсуждение", 25_000_00)

	// WebSocket художника
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/ws?token=" + artist.Access
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	defer conn.CloseNow()
	if _, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/v1/ws?token=bad", nil); err == nil {
		t.Fatal("ws must reject bad token")
	}
	time.Sleep(50 * time.Millisecond) // дождаться регистрации подписки

	r := call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID, "artwork_id": a.ID, "message": "Здравствуйте! Работа ещё доступна?"})
	expect(t, r, http.StatusCreated)
	var conv struct {
		ID    string `json:"id"`
		Other struct {
			ID string `json:"id"`
		} `json:"other"`
		Artwork *struct {
			Title string `json:"title"`
		} `json:"artwork"`
	}
	r.into(t, &conv)
	if conv.Other.ID != artist.ID || conv.Artwork == nil || conv.Artwork.Title != "Обсуждение" {
		t.Fatalf("conv %+v", conv)
	}

	_, msg, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var ev struct {
		Type string `json:"type"`
		Data struct {
			Body string `json:"body"`
		} `json:"data"`
	}
	_ = json.Unmarshal(msg, &ev)
	if ev.Type != "message" || !strings.Contains(ev.Data.Body, "доступна") {
		t.Fatalf("ws event %s", msg)
	}

	// тот же диалог при повторном обращении
	r = call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID, "artwork_id": a.ID})
	var again struct {
		ID string `json:"id"`
	}
	r.into(t, &again)
	if again.ID != conv.ID {
		t.Fatal("conversation must be reused")
	}

	r = call(t, "GET", "/api/v1/conversations", artist.Access, nil)
	var list []struct {
		ID     string `json:"id"`
		Unread int    `json:"unread"`
	}
	r.into(t, &list)
	if len(list) != 1 || list[0].Unread != 1 {
		t.Fatalf("artist conversations %+v", list)
	}
	expect(t, call(t, "POST", "/api/v1/conversations/"+conv.ID+"/messages", artist.Access, map[string]string{"body": "Да, доступна 🙂"}), http.StatusCreated)
	expect(t, call(t, "POST", "/api/v1/conversations/"+conv.ID+"/messages", artist.Access, map[string]string{"body": "   "}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/conversations/"+conv.ID+"/read", artist.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/conversations", artist.Access, nil)
	r.into(t, &list)
	if list[0].Unread != 0 {
		t.Fatal("unread must be 0 after read")
	}
	r = call(t, "GET", "/api/v1/conversations/"+conv.ID+"/messages", buyer.Access, nil)
	var msgs []struct {
		Body string `json:"body"`
	}
	r.into(t, &msgs)
	if len(msgs) != 2 || !strings.HasPrefix(msgs[0].Body, "Да") {
		t.Fatalf("messages %+v", msgs)
	}

	// посторонний не видит диалог
	stranger := register(t, "buyer")
	expect(t, call(t, "GET", "/api/v1/conversations/"+conv.ID+"/messages", stranger.Access, nil), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/conversations/"+conv.ID+"/messages", stranger.Access, map[string]string{"body": "hi"}), http.StatusNotFound)
	// двум покупателям переписываться нельзя; художник может написать покупателю
	expect(t, call(t, "POST", "/api/v1/conversations", stranger.Access, map[string]any{"user_id": buyer.ID, "message": "hi"}), http.StatusBadRequest)
	expect(t, call(t, "POST", "/api/v1/conversations", artist.Access, map[string]any{"user_id": stranger.ID, "message": "Добрый день"}), http.StatusCreated)
	expect(t, call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": buyer.ID}), http.StatusUnprocessableEntity)
}

func TestFollowersGetNewArtworkNotification(t *testing.T) {
	artist := register(t, "artist")
	fan := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", fan.Access, nil), http.StatusNoContent)
	publishArtwork(t, artist, "Для подписчиков", 9_000_00)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r := call(t, "GET", "/api/v1/notifications", fan.Access, nil)
		var notes []struct {
			Type string `json:"type"`
		}
		r.into(t, &notes)
		if len(notes) > 0 && notes[0].Type == "new_artwork" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("follower did not get new_artwork notification")
}

func TestReportsAndModeration(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Спорная работа", 10_000_00)

	expect(t, call(t, "POST", "/api/v1/reports", buyer.Access, map[string]string{"target_type": "artwork", "target_id": a.ID, "reason": "x"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/reports", buyer.Access, map[string]string{"target_type": "planet", "target_id": a.ID, "reason": "Нарушение"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/reports", buyer.Access, map[string]string{"target_type": "artwork", "target_id": "00000000-0000-0000-0000-000000000000", "reason": "Нарушение"}), http.StatusNotFound)
	r := call(t, "POST", "/api/v1/reports", buyer.Access, map[string]string{"target_type": "artwork", "target_id": a.ID, "reason": "Чужая работа, плагиат"})
	expect(t, r, http.StatusCreated)
	var rep struct {
		ID string `json:"id"`
	}
	r.into(t, &rep)
	r = call(t, "POST", "/api/v1/reports", buyer.Access, map[string]string{"target_type": "user", "target_id": artist.ID, "reason": "Спам в сообщениях"})
	var userRep struct {
		ID string `json:"id"`
	}
	r.into(t, &userRep)

	expect(t, call(t, "GET", "/api/v1/admin/reports", buyer.Access, nil), http.StatusForbidden)

	admin := register(t, "buyer")
	exec(t, `UPDATE users SET role = 'admin' WHERE id = $1`, admin.ID)
	adminToken, _ := login(t, admin.Email, admin.Password)
	r = call(t, "GET", "/api/v1/admin/reports", adminToken, nil)
	expect(t, r, http.StatusOK)
	var reports []struct {
		ID string `json:"id"`
	}
	r.into(t, &reports)
	if len(reports) < 2 {
		t.Fatalf("reports %+v", reports)
	}
	expect(t, call(t, "POST", "/api/v1/admin/reports/"+rep.ID+"/resolve", adminToken, map[string]string{"action": "ban"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/admin/reports/"+rep.ID+"/resolve", adminToken, map[string]string{"action": "hide", "resolution": "Плагиат подтверждён"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/admin/reports/"+rep.ID+"/resolve", adminToken, map[string]string{"action": "hide"}), http.StatusConflict)
	if artworkStatus(t, a.ID) != "hidden" {
		t.Fatal("artwork must be hidden")
	}
	expect(t, call(t, "GET", "/api/v1/artworks/"+a.ID, artist.Access, nil), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/admin/reports/"+userRep.ID+"/resolve", adminToken, map[string]string{"action": "hide"}), http.StatusNoContent)
	r = call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": artist.Email, "password": artist.Password})
	expect(t, r, http.StatusForbidden)
	// заблокированный не возвращает доступ ни старым access-токеном, ни через «стать художником», ни сбросом пароля
	expect(t, call(t, "GET", "/api/v1/me", artist.Access, nil), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/me/become-artist", artist.Access, nil), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": artist.Refresh}), http.StatusUnauthorized)
	before := len(mailer.Sent)
	expect(t, call(t, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": artist.Email}), http.StatusNoContent)
	if len(mailer.Sent) != before {
		t.Fatal("banned user must not get a reset code")
	}
	expect(t, call(t, "GET", "/api/v1/users/"+artist.ID, "", nil), http.StatusNotFound)
	r = call(t, "GET", "/api/v1/admin/reports?status=resolved", adminToken, nil)
	r.into(t, &reports)
	if len(reports) < 2 {
		t.Fatal("resolved list")
	}
	expect(t, call(t, "POST", "/api/v1/admin/reports/00000000-0000-0000-0000-000000000000/resolve", adminToken, map[string]string{"action": "reject"}), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/me/become-artist", adminToken, nil), http.StatusConflict)
}

func TestDeleteAccount(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Удаление", 10_000_00)
	o := createOrder(t, buyer, a.ID)

	expect(t, call(t, "DELETE", "/api/v1/me", buyer.Access, map[string]string{"password": "wrong"}), http.StatusForbidden)
	r := call(t, "DELETE", "/api/v1/me", buyer.Access, map[string]string{"password": buyer.Password})
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "active_orders" {
		t.Fatalf("code %s", r.Error.Code)
	}
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/cancel", buyer.Access, nil), http.StatusOK)
	expect(t, call(t, "DELETE", "/api/v1/me", artist.Access, map[string]string{"password": artist.Password}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": artist.Email, "password": artist.Password}), http.StatusUnauthorized)
	expect(t, call(t, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": artist.Refresh}), http.StatusUnauthorized)
	expect(t, call(t, "GET", "/api/v1/users/"+artist.ID, "", nil), http.StatusNotFound)
	if artworkStatus(t, a.ID) != "archived" {
		t.Fatal("artworks must be archived")
	}
	// e-mail освобождается для новой регистрации
	expect(t, call(t, "POST", "/api/v1/auth/register", "", map[string]string{"email": artist.Email, "password": "secret123", "name": "Снова"}), http.StatusCreated)
}

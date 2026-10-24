package apitest

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestCommissionDeclineCancelAndExpiry(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"accepts_commissions": true}), http.StatusOK)
	newRequest := func() string {
		t.Helper()
		r := call(t, "POST", "/api/v1/commissions", buyer.Access, map[string]any{
			"artist_id": artist.ID, "description": "Натюрморт с яблоками для кухни, светлые тона.", "category": "painting",
		})
		expect(t, r, http.StatusCreated)
		var c struct{ ID string }
		r.into(t, &c)
		return c.ID
	}
	status := func(u user, id string) string {
		t.Helper()
		r := call(t, "GET", "/api/v1/commissions/"+id, u.Access, nil)
		expect(t, r, http.StatusOK)
		var c struct {
			Status string `json:"status"`
			MyRole string `json:"my_role"`
		}
		r.into(t, &c)
		return c.Status
	}

	declined := newRequest()
	expect(t, call(t, "POST", "/api/v1/commissions/"+declined+"/decline", artist.Access, map[string]any{"reason": "Нет времени"}), http.StatusOK)
	if s := status(buyer, declined); s != "declined" {
		t.Fatalf("declined = %s", s)
	}
	cancelled := newRequest()
	expect(t, call(t, "POST", "/api/v1/commissions/"+cancelled+"/cancel", artist.Access, nil), http.StatusConflict)
	expect(t, call(t, "POST", "/api/v1/commissions/"+cancelled+"/cancel", buyer.Access, nil), http.StatusOK)
	expired := newRequest()
	exec(t, `UPDATE commissions SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired)
	if s := status(artist, expired); s != "expired" {
		t.Fatalf("expired (computed) = %s", s)
	}
	expect(t, call(t, "POST", "/api/v1/commissions/"+expired+"/quote", artist.Access, map[string]any{"price_kop": 10_000_00, "days": 5}), http.StatusConflict)
	if n, err := srv.ExpireCommissions(context.Background()); err != nil || n != 1 {
		t.Fatalf("ExpireCommissions = %d %v", n, err)
	}
	r := call(t, "GET", "/api/v1/commissions?role=artist", artist.Access, nil)
	var list []struct{ ID string }
	r.into(t, &list)
	if len(list) != 3 {
		t.Fatalf("artist commissions = %d", len(list))
	}
	expect(t, call(t, "GET", "/api/v1/commissions?role=admin", artist.Access, nil), http.StatusBadRequest)
	other := register(t, "buyer")
	expect(t, call(t, "GET", "/api/v1/commissions/"+declined, other.Access, nil), http.StatusNotFound)

	// на паузе — новых запросов нет
	until := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"vacation_until": until}), http.StatusOK)
	r = call(t, "POST", "/api/v1/commissions", buyer.Access, map[string]any{
		"artist_id": artist.ID, "description": "Ещё один заказ, большой пейзаж маслом.", "category": "painting",
	})
	expect(t, r, http.StatusConflict)
}

func TestAdminCollectionsCRUD(t *testing.T) {
	admin := register(t, "buyer")
	exec(t, `UPDATE users SET role = 'admin' WHERE id = $1`, admin.ID)
	access, _ := login(t, admin.Email, admin.Password)
	r := call(t, "POST", "/api/v1/admin/collections", access, map[string]any{
		"slug": "blue-mood", "title": "Синее настроение", "kind": "filter", "filters": map[string]any{"colors": []string{"blue"}},
	})
	expect(t, r, http.StatusOK)
	var c struct{ ID string }
	r.into(t, &c)
	expect(t, call(t, "POST", "/api/v1/admin/collections", access, map[string]any{"slug": "Bad Slug", "title": "x", "kind": "filter"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "PATCH", "/api/v1/admin/collections/"+c.ID, access, map[string]any{
		"slug": "blue-mood", "title": "Синее настроение", "kind": "filter", "filters": map[string]any{"colors": []string{"blue", "teal"}}, "is_published": false,
	}), http.StatusOK)
	expect(t, call(t, "GET", "/api/v1/collections/blue-mood", "", nil), http.StatusNotFound) // снята с публикации
	r = call(t, "GET", "/api/v1/admin/collections", access, nil)
	var all []struct{ Slug string }
	r.into(t, &all)
	if len(all) < 5 {
		t.Fatalf("admin collections = %d", len(all))
	}
	expect(t, call(t, "PATCH", "/api/v1/admin/collections/00000000-0000-0000-0000-000000000000", access, map[string]any{
		"slug": "ghost", "title": "Призрак", "kind": "filter", "filters": map[string]any{"room": "kids"},
	}), http.StatusNotFound)
	expect(t, call(t, "DELETE", "/api/v1/admin/collections/"+c.ID, access, nil), http.StatusNoContent)
}

func TestExhibitionUpdateAndReminders(t *testing.T) {
	artist := register(t, "artist")
	visitor := register(t, "buyer")
	draft := func(title string) string {
		r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody(title, 9_000_00, []string{uploadImage(t, artist.Access)}, false))
		expect(t, r, http.StatusCreated)
		var a artwork
		r.into(t, &a)
		return a.ID
	}
	a1, a2 := draft("Первая"), draft("Вторая")
	r := call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Весна", "starts_at": time.Now().Add(5 * time.Hour).UTC().Format(time.RFC3339), "artwork_ids": []string{a1},
	})
	expect(t, r, http.StatusCreated)
	var ex struct {
		ID            string `json:"id"`
		ArtworksCount int    `json:"artworks_count"`
		Reminded      bool   `json:"reminded"`
	}
	r.into(t, &ex)
	r = call(t, "PATCH", "/api/v1/exhibitions/"+ex.ID, artist.Access, map[string]any{"title": "Ранняя весна", "artwork_ids": []string{a2}})
	expect(t, r, http.StatusOK)
	r.into(t, &ex)
	if ex.ArtworksCount != 1 || artworkStatus(t, a1) != "draft" || artworkStatus(t, a2) != "scheduled" {
		t.Fatalf("after update: %+v %s %s", ex, artworkStatus(t, a1), artworkStatus(t, a2))
	}
	expect(t, call(t, "PATCH", "/api/v1/exhibitions/"+ex.ID, visitor.Access, map[string]any{"title": "Чужая"}), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/remind", visitor.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/remind", visitor.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/exhibitions?status=upcoming&artist_id="+artist.ID, visitor.Access, nil)
	var list []struct {
		Reminded  bool `json:"reminded"`
		Reminders int  `json:"reminders"`
	}
	r.into(t, &list)
	if len(list) != 1 || !list[0].Reminded || list[0].Reminders != 1 {
		t.Fatalf("list = %+v", list)
	}
	expect(t, call(t, "DELETE", "/api/v1/exhibitions/"+ex.ID+"/remind", visitor.Access, nil), http.StatusNoContent)
	expect(t, call(t, "GET", "/api/v1/exhibitions?artist_id=bad", "", nil), http.StatusBadRequest)

	// воркер открывает выставку
	exec(t, `UPDATE exhibitions SET starts_at = now() - interval '1 second' WHERE id = $1`, ex.ID)
	srv.RunWorkerOnce(context.Background())
	if artworkStatus(t, a2) != "published" {
		t.Fatalf("worker did not open exhibition: %s", artworkStatus(t, a2))
	}
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/remind", visitor.Access, nil), http.StatusConflict)
}

func TestQuestionDeleteByAuthor(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Удаление вопроса", 9_000_00)
	r := call(t, "POST", "/api/v1/artworks/"+a.ID+"/questions", buyer.Access, map[string]any{"body": "Можно ли забрать самовывозом?"})
	expect(t, r, http.StatusCreated)
	var q struct{ ID string }
	r.into(t, &q)
	other := register(t, "buyer")
	expect(t, call(t, "DELETE", "/api/v1/questions/"+q.ID, other.Access, nil), http.StatusNotFound)
	expect(t, call(t, "DELETE", "/api/v1/questions/"+q.ID, buyer.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/questions/"+q.ID+"/answer", artist.Access, map[string]any{"answer": "Да"}), http.StatusNotFound)
}

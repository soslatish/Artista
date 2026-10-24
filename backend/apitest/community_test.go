package apitest

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestQuestions(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "С вопросами", 9_000_00)
	path := "/api/v1/artworks/" + a.ID + "/questions"

	expect(t, call(t, "POST", path, artist.Access, map[string]any{"body": "Сам себе вопрос"}), http.StatusBadRequest)
	expect(t, call(t, "POST", path, buyer.Access, map[string]any{"body": "?"}), http.StatusUnprocessableEntity)
	r := call(t, "POST", path, buyer.Access, map[string]any{"body": "Рама входит в стоимость?"})
	expect(t, r, http.StatusCreated)
	var q struct {
		ID     string `json:"id"`
		Answer string `json:"answer"`
	}
	r.into(t, &q)
	waitNotification(t, artist, "question_new")

	expect(t, call(t, "POST", "/api/v1/questions/"+q.ID+"/answer", buyer.Access, map[string]any{"answer": "Да"}), http.StatusNotFound)
	r = call(t, "POST", "/api/v1/questions/"+q.ID+"/answer", artist.Access, map[string]any{"answer": "Да, работа оформлена в раму."})
	expect(t, r, http.StatusOK)
	waitNotification(t, buyer, "question_answered")

	r = call(t, "GET", path, "", nil)
	var list []struct {
		Answer string `json:"answer"`
	}
	r.into(t, &list)
	if len(list) != 1 || !strings.HasPrefix(list[0].Answer, "Да") {
		t.Fatalf("questions = %+v", list)
	}
	// жалоба на вопрос скрывает его
	admin := register(t, "buyer")
	exec(t, `UPDATE users SET role = 'admin' WHERE id = $1`, admin.ID)
	adminAccess, _ := login(t, admin.Email, admin.Password)
	r = call(t, "POST", "/api/v1/reports", artist.Access, map[string]any{"target_type": "question", "target_id": q.ID, "reason": "Спам"})
	expect(t, r, http.StatusCreated)
	var rep struct{ ID string }
	r.into(t, &rep)
	expect(t, call(t, "POST", "/api/v1/admin/reports/"+rep.ID+"/resolve", adminAccess, map[string]any{"action": "hide"}), http.StatusNoContent)
	r = call(t, "GET", path, "", nil)
	r.into(t, &list)
	if len(list) != 0 {
		t.Fatalf("hidden question still listed: %+v", list)
	}
}

func TestPostsFeedAndLikes(t *testing.T) {
	artist := register(t, "artist")
	fan := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", fan.Access, nil), http.StatusNoContent)
	a := publishArtwork(t, artist, "Из мастерской", 9_000_00)

	expect(t, call(t, "POST", "/api/v1/posts", fan.Access, map[string]any{"body": "Я не художник"}), http.StatusForbidden)
	expect(t, call(t, "POST", "/api/v1/posts", artist.Access, map[string]any{"body": ""}), http.StatusUnprocessableEntity)
	img := uploadImage(t, artist.Access)
	r := call(t, "POST", "/api/v1/posts", artist.Access, map[string]any{"body": "Новая серия почти готова!", "images": []string{img}, "artwork_id": a.ID})
	expect(t, r, http.StatusCreated)
	var p struct {
		ID      string `json:"id"`
		Likes   int    `json:"likes"`
		Liked   bool   `json:"liked"`
		Artwork *struct {
			ID string `json:"id"`
		} `json:"artwork"`
	}
	r.into(t, &p)
	if p.Artwork == nil || p.Artwork.ID != a.ID {
		t.Fatalf("post = %+v", p)
	}
	waitNotification(t, fan, "new_post")

	expect(t, call(t, "POST", "/api/v1/posts/"+p.ID+"/like", fan.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/posts/"+p.ID+"/like", fan.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/feed/posts", fan.Access, nil)
	var feed []struct {
		ID    string `json:"id"`
		Likes int    `json:"likes"`
		Liked bool   `json:"liked"`
	}
	r.into(t, &feed)
	if len(feed) == 0 || feed[0].ID != p.ID || feed[0].Likes != 1 || !feed[0].Liked {
		t.Fatalf("feed = %+v", feed)
	}
	expect(t, call(t, "DELETE", "/api/v1/posts/"+p.ID+"/like", fan.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/users/"+artist.ID+"/posts", "", nil)
	r.into(t, &feed)
	if len(feed) != 1 || feed[0].Likes != 0 {
		t.Fatalf("user posts = %+v", feed)
	}
	expect(t, call(t, "DELETE", "/api/v1/posts/"+p.ID, fan.Access, nil), http.StatusNotFound)
	expect(t, call(t, "DELETE", "/api/v1/posts/"+p.ID, artist.Access, nil), http.StatusNoContent)
}

func TestSeries(t *testing.T) {
	artist := register(t, "artist")
	other := register(t, "artist")
	r := call(t, "POST", "/api/v1/me/series", artist.Access, map[string]any{"title": "Морская серия", "description": "Балтика"})
	expect(t, r, http.StatusCreated)
	var sr struct{ ID string }
	r.into(t, &sr)
	expect(t, call(t, "POST", "/api/v1/me/series", artist.Access, map[string]any{"title": "x"}), http.StatusUnprocessableEntity)

	img := uploadImage(t, artist.Access)
	inSeries := publishWith(t, artist, "Волна", 9_000_00, img, map[string]any{"series_id": sr.ID})
	publishArtwork(t, artist, "Вне серии", 9_000_00)
	// чужая серия не подходит
	bad := artworkBody("Чужая серия", 9_000_00, []string{uploadImage(t, other.Access)}, true)
	bad["series_id"] = sr.ID
	expect(t, call(t, "POST", "/api/v1/artworks", other.Access, bad), http.StatusUnprocessableEntity)

	ids := listIDs(t, "/api/v1/users/"+artist.ID+"/artworks?series_id="+sr.ID, "")
	if len(ids) != 1 || ids[0] != inSeries.ID {
		t.Fatalf("series artworks = %v", ids)
	}
	r = call(t, "GET", "/api/v1/users/"+artist.ID+"/series", "", nil)
	var list []struct {
		Title         string `json:"title"`
		ArtworksCount int    `json:"artworks_count"`
		CoverURL      string `json:"cover_url"`
	}
	r.into(t, &list)
	if len(list) != 1 || list[0].ArtworksCount != 1 || list[0].CoverURL == "" {
		t.Fatalf("series = %+v", list)
	}
	expect(t, call(t, "PATCH", "/api/v1/me/series/"+sr.ID, artist.Access, map[string]any{"title": "Балтийская серия"}), http.StatusOK)
	expect(t, call(t, "DELETE", "/api/v1/me/series/"+sr.ID, other.Access, nil), http.StatusNotFound)
	expect(t, call(t, "DELETE", "/api/v1/me/series/"+sr.ID, artist.Access, nil), http.StatusNoContent)
	// работа остаётся, просто без серии
	r = call(t, "GET", "/api/v1/artworks/"+inSeries.ID, "", nil)
	var got struct {
		SeriesID *string `json:"series_id"`
	}
	r.into(t, &got)
	if got.SeriesID != nil {
		t.Fatal("series_id should be cleared")
	}
}

func TestExhibitionDrop(t *testing.T) {
	artist := register(t, "artist")
	fan := register(t, "buyer")
	visitor := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", fan.Access, nil), http.StatusNoContent)
	img := uploadImage(t, artist.Access)
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody("Премьера", 9_000_00, []string{img}, false))
	expect(t, r, http.StatusCreated)
	var draft artwork
	r.into(t, &draft)
	published := publishArtwork(t, artist, "Уже в продаже", 9_000_00)

	starts := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	expect(t, call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Осень", "starts_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339), "artwork_ids": []string{draft.ID},
	}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Осень", "starts_at": starts, "artwork_ids": []string{published.ID},
	}), http.StatusUnprocessableEntity)
	r = call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Осень", "description": "Новая серия пейзажей", "starts_at": starts, "artwork_ids": []string{draft.ID},
	})
	expect(t, r, http.StatusCreated)
	var ex struct {
		ID            string `json:"id"`
		Status        string `json:"status"`
		ArtworksCount int    `json:"artworks_count"`
		Reminded      bool   `json:"reminded"`
		CoverURL      string `json:"cover_url"`
	}
	r.into(t, &ex)
	if ex.Status != "upcoming" || ex.ArtworksCount != 1 || ex.CoverURL == "" || artworkStatus(t, draft.ID) != "scheduled" {
		t.Fatalf("exhibition = %+v, artwork %s", ex, artworkStatus(t, draft.ID))
	}
	waitNotification(t, fan, "exhibition_announced")

	// анонс виден, но купить нельзя
	expect(t, call(t, "GET", "/api/v1/artworks/"+draft.ID, "", nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders", visitor.Access, map[string]any{"artwork_id": draft.ID, "delivery_method": "cdek", "address": address}), http.StatusConflict)
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/remind", visitor.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/exhibitions/"+ex.ID, visitor.Access, nil)
	expect(t, r, http.StatusOK)
	var items []artwork
	r.into(t, &items)
	if len(items) != 1 {
		t.Fatalf("exhibition artworks = %+v", items)
	}

	exec(t, `UPDATE exhibitions SET starts_at = now() - interval '1 second' WHERE id = $1`, ex.ID)
	if n, err := srv.OpenExhibitions(context.Background()); err != nil || n != 1 {
		t.Fatalf("OpenExhibitions = %d, %v", n, err)
	}
	if artworkStatus(t, draft.ID) != "published" {
		t.Fatalf("artwork after opening = %s", artworkStatus(t, draft.ID))
	}
	waitNotification(t, visitor, "exhibition_opened")
	waitNotification(t, fan, "exhibition_opened")
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/cancel", artist.Access, nil), http.StatusConflict)

	r = call(t, "GET", "/api/v1/exhibitions?artist_id="+artist.ID, "", nil)
	var list []struct {
		Status string `json:"status"`
	}
	r.into(t, &list)
	if len(list) != 1 || list[0].Status != "open" {
		t.Fatalf("list = %+v", list)
	}
}

func TestExhibitionCancelReturnsDrafts(t *testing.T) {
	artist := register(t, "artist")
	img := uploadImage(t, artist.Access)
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody("Отменённая премьера", 9_000_00, []string{img}, false))
	var draft artwork
	r.into(t, &draft)
	r = call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Не состоится", "starts_at": time.Now().Add(3 * time.Hour).UTC().Format(time.RFC3339), "artwork_ids": []string{draft.ID},
	})
	expect(t, r, http.StatusCreated)
	var ex struct{ ID string }
	r.into(t, &ex)
	expect(t, call(t, "POST", "/api/v1/exhibitions/"+ex.ID+"/cancel", artist.Access, nil), http.StatusNoContent)
	if artworkStatus(t, draft.ID) != "draft" {
		t.Fatalf("artwork after cancel = %s", artworkStatus(t, draft.ID))
	}
}

func TestDetailedStatsRequirePremium(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Для статистики", 9_000_00)
	expect(t, call(t, "GET", "/api/v1/artworks/"+a.ID+"?src=search", buyer.Access, nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/favorite", buyer.Access, nil), http.StatusNoContent)

	r := call(t, "GET", "/api/v1/me/stats/detailed", artist.Access, nil)
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "premium_required" {
		t.Fatalf("code = %s", r.Error.Code)
	}
	exec(t, `UPDATE users SET premium_until = now() + interval '10 days' WHERE id = $1`, artist.ID)
	r = call(t, "GET", "/api/v1/me/stats/detailed?days=7", artist.Access, nil)
	expect(t, r, http.StatusOK)
	var st struct {
		Days       int `json:"days"`
		ViewsByDay []struct {
			Value int `json:"value"`
		} `json:"views_by_day"`
		Sources []struct {
			Source string `json:"source"`
			Views  int    `json:"views"`
		} `json:"sources"`
		Funnel struct {
			Views, Favorites int
		} `json:"funnel"`
		Top []struct {
			ID    string `json:"id"`
			Views int    `json:"views"`
		} `json:"top_artworks"`
	}
	r.into(t, &st)
	total := 0
	for _, p := range st.ViewsByDay {
		total += p.Value
	}
	if st.Days != 7 || len(st.ViewsByDay) != 7 || total != 1 || st.Funnel.Favorites != 1 ||
		len(st.Sources) != 1 || st.Sources[0].Source != "search" || st.Top[0].ID != a.ID {
		t.Fatalf("stats = %+v", st)
	}
}

func TestAssistantSuggestions(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/assistant/artwork", buyer.Access, map[string]any{"category": "painting"}), http.StatusForbidden)
	img, _ := uploadColored(t, artist.Access, blue)
	r := call(t, "POST", "/api/v1/assistant/artwork", artist.Access, map[string]any{
		"image_url": img, "category": "painting", "technique": "oil", "width_cm": 50, "height_cm": 70, "rooms": []string{"bedroom"},
	})
	expect(t, r, http.StatusOK)
	var s struct {
		Titles      []string `json:"titles"`
		Description string   `json:"description"`
		Palette     []string `json:"palette"`
		Price       struct {
			SuggestedKop int64  `json:"suggested_kop"`
			MinKop       int64  `json:"min_kop"`
			Basis        string `json:"basis"`
		} `json:"price"`
	}
	r.into(t, &s)
	if len(s.Titles) < 2 || !strings.Contains(s.Description, "синий") || len(s.Palette) != 1 || s.Price.SuggestedKop%500_00 != 0 || s.Price.Basis == "" {
		t.Fatalf("assistant = %+v", s)
	}
	expect(t, call(t, "POST", "/api/v1/assistant/artwork", artist.Access, map[string]any{"category": "nope"}), http.StatusUnprocessableEntity)
}

func TestChatImagesAndLocalizedNotifications(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	expect(t, call(t, "PATCH", "/api/v1/me", buyer.Access, map[string]any{"locale": "en"}), http.StatusOK)
	expect(t, call(t, "PATCH", "/api/v1/me", buyer.Access, map[string]any{"locale": "de"}), http.StatusUnprocessableEntity)
	r := call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID})
	expect(t, r, http.StatusCreated)
	var c struct{ ID string }
	r.into(t, &c)
	img := uploadImage(t, artist.Access)
	expect(t, call(t, "POST", "/api/v1/conversations/"+c.ID+"/messages", buyer.Access, map[string]any{"image_url": img}), http.StatusUnprocessableEntity) // чужое фото
	r = call(t, "POST", "/api/v1/conversations/"+c.ID+"/messages", artist.Access, map[string]any{"body": "", "image_url": img})
	expect(t, r, http.StatusCreated)
	var m struct {
		ImageURL string `json:"image_url"`
	}
	r.into(t, &m)
	if m.ImageURL != img {
		t.Fatalf("message = %+v", m)
	}
	expect(t, call(t, "POST", "/api/v1/conversations/"+c.ID+"/messages", artist.Access, map[string]any{"body": ""}), http.StatusUnprocessableEntity)

	// уведомление приходит на языке получателя
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", buyer.Access, nil), http.StatusNoContent)
	publishArtwork(t, artist, "Sunset", 9_000_00)
	waitNotification(t, buyer, "new_artwork")
	r = call(t, "GET", "/api/v1/notifications", buyer.Access, nil)
	var notes []struct {
		Title string `json:"title"`
	}
	r.into(t, &notes)
	if len(notes) == 0 || !strings.HasPrefix(notes[0].Title, "New artwork by") {
		t.Fatalf("notification = %+v", notes)
	}
}

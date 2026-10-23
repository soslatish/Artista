package apitest

import (
	"net/http"
	"net/url"
	"testing"
)

func TestUploads(t *testing.T) {
	u := register(t, "artist")
	img := uploadImage(t, u.Access)
	res, err := http.Get(img)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("file not served: %v %v", err, res)
	}
	res.Body.Close()
	expect(t, uploadFile(t, u.Access, []byte("<?php echo 'hi'; ?>")), http.StatusUnprocessableEntity)
	big := make([]byte, 2<<20)
	copy(big, pngBytes)
	r := uploadFile(t, u.Access, big)
	if r.Status != http.StatusRequestEntityTooLarge && r.Status != http.StatusBadRequest {
		t.Fatalf("big upload: %d", r.Status)
	}
	res, _ = http.Get(ts.URL + "/files/..%2f..%2fetc%2fpasswd")
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("path traversal: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestArtworkLifecycle(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")

	// черновик без фото можно, публикация без фото — нет
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody("Черновик", 12_000_00, nil, false))
	expect(t, r, http.StatusCreated)
	var draft artwork
	r.into(t, &draft)
	if draft.Status != "draft" {
		t.Fatalf("status %s", draft.Status)
	}
	expect(t, call(t, "POST", "/api/v1/artworks/"+draft.ID+"/publish", artist.Access, nil), http.StatusUnprocessableEntity)
	// чужие картинки не принимаются
	r = call(t, "PATCH", "/api/v1/artworks/"+draft.ID, artist.Access, map[string]any{"images": []string{"https://evil.ru/x.jpg"}})
	expect(t, r, http.StatusUnprocessableEntity)
	// черновик не виден другим
	expect(t, call(t, "GET", "/api/v1/artworks/"+draft.ID, buyer.Access, nil), http.StatusNotFound)
	expect(t, call(t, "GET", "/api/v1/artworks/"+draft.ID, artist.Access, nil), http.StatusOK)

	img := uploadImage(t, artist.Access)
	r = call(t, "PATCH", "/api/v1/artworks/"+draft.ID, artist.Access, map[string]any{"images": []string{img}, "price_kop": 15_000_00, "title": "Белые ночи"})
	expect(t, r, http.StatusOK)
	r = call(t, "POST", "/api/v1/artworks/"+draft.ID+"/publish", artist.Access, nil)
	expect(t, r, http.StatusOK)
	var pub artwork
	r.into(t, &pub)
	if pub.Status != "published" || pub.PriceKop != 15_000_00 || len(pub.Images) != 1 {
		t.Fatalf("published %+v", pub)
	}
	expect(t, call(t, "POST", "/api/v1/artworks/"+draft.ID+"/publish", artist.Access, nil), http.StatusConflict)

	// чужой художник не может редактировать
	other := register(t, "artist")
	expect(t, call(t, "PATCH", "/api/v1/artworks/"+draft.ID, other.Access, map[string]any{"title": "Моё"}), http.StatusNotFound)
	expect(t, call(t, "PATCH", "/api/v1/artworks/"+draft.ID, artist.Access, map[string]any{"price_kop": 100}), http.StatusUnprocessableEntity)

	// просмотры считаются только для чужих
	call(t, "GET", "/api/v1/artworks/"+draft.ID, buyer.Access, nil)
	call(t, "GET", "/api/v1/artworks/"+draft.ID, "", nil)
	call(t, "GET", "/api/v1/artworks/"+draft.ID, artist.Access, nil)
	r = call(t, "GET", "/api/v1/artworks/"+draft.ID, artist.Access, nil)
	var viewed artwork
	r.into(t, &viewed)
	if viewed.Views != 2 {
		t.Fatalf("views = %d, want 2", viewed.Views)
	}

	// избранное
	expect(t, call(t, "POST", "/api/v1/artworks/"+draft.ID+"/favorite", buyer.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/artworks/"+draft.ID+"/favorite", buyer.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/me/favorites", buyer.Access, nil)
	var favs []artwork
	r.into(t, &favs)
	if len(favs) != 1 || !favs[0].IsFavorite || favs[0].FavoritesCount != 1 {
		t.Fatalf("favorites %+v", favs)
	}
	expect(t, call(t, "POST", "/api/v1/artworks/00000000-0000-0000-0000-000000000000/favorite", buyer.Access, nil), http.StatusNotFound)
	expect(t, call(t, "DELETE", "/api/v1/artworks/"+draft.ID+"/favorite", buyer.Access, nil), http.StatusNoContent)

	// мои работы с фильтром статуса
	r = call(t, "GET", "/api/v1/me/artworks?status=published", artist.Access, nil)
	var mine []artwork
	r.into(t, &mine)
	if len(mine) != 1 {
		t.Fatalf("mine %d", len(mine))
	}
	expect(t, call(t, "GET", "/api/v1/me/artworks?status=weird", artist.Access, nil), http.StatusBadRequest)

	// архив
	expect(t, call(t, "DELETE", "/api/v1/artworks/"+draft.ID, artist.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/artworks/"+draft.ID, buyer.Access, nil)
	expect(t, r, http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/artworks/"+draft.ID+"/publish", artist.Access, nil), http.StatusOK)
}

func TestCatalogSearchFiltersAndFeeds(t *testing.T) {
	artist := register(t, "artist")
	exec(t, `UPDATE users SET city = 'Тверь' WHERE id = $1`, artist.ID)
	a1 := publishArtwork(t, artist, "Тверская набережная зимой", 8_000_00)
	a2 := publishArtwork(t, artist, "Абстракция синяя", 120_000_00)
	exec(t, `UPDATE artworks SET category = 'graphics', style = 'abstract', width_cm = 150 WHERE id = $1`, a2.ID)

	list := func(query string) []artwork {
		t.Helper()
		r := call(t, "GET", "/api/v1/artworks?"+query, "", nil)
		expect(t, r, http.StatusOK)
		var items []artwork
		r.into(t, &items)
		return items
	}
	has := func(items []artwork, id string) bool {
		for _, a := range items {
			if a.ID == id {
				return true
			}
		}
		return false
	}
	q := url.Values{"q": {"набережная"}, "city": {"тверь"}}.Encode()
	if items := list(q); !has(items, a1.ID) || has(items, a2.ID) {
		t.Fatalf("search by text failed: %+v", items)
	}
	if items := list("q=" + url.QueryEscape(artist.Email[:0]+"artist") + "&artist_id=" + artist.ID); len(items) != 2 {
		t.Fatalf("search by artist name: %d", len(items))
	}
	if items := list("category=graphics&artist_id=" + artist.ID); len(items) != 1 || items[0].ID != a2.ID {
		t.Fatalf("category filter: %+v", items)
	}
	if items := list("price_min=10000000&artist_id=" + artist.ID); len(items) != 1 {
		t.Fatalf("price_min: %d", len(items))
	}
	if items := list("price_max=1000000&artist_id=" + artist.ID); len(items) != 1 || items[0].ID != a1.ID {
		t.Fatalf("price_max: %+v", items)
	}
	if items := list("size_max=100&artist_id=" + artist.ID); len(items) != 1 || items[0].ID != a1.ID {
		t.Fatalf("size_max: %+v", items)
	}
	if items := list("sort=price_desc&artist_id=" + artist.ID); items[0].ID != a2.ID {
		t.Fatal("price_desc order")
	}
	if items := list("sort=price_asc&artist_id=" + artist.ID); items[0].ID != a1.ID {
		t.Fatal("price_asc order")
	}
	if items := list("feed=popular&limit=1&artist_id=" + artist.ID); len(items) != 1 {
		t.Fatal("limit")
	}
	for _, bad := range []string{"price_min=abc", "size_max=-1", "artist_id=xyz"} {
		expect(t, call(t, "GET", "/api/v1/artworks?"+bad, "", nil), http.StatusBadRequest)
	}

	// пагинация
	r := call(t, "GET", "/api/v1/artworks?limit=1&artist_id="+artist.ID, "", nil)
	if r.Meta["next_cursor"] != "1" {
		t.Fatalf("next_cursor %v", r.Meta)
	}

	// лента «для вас»: подписка на художника
	buyer := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", buyer.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/artworks?feed=for_you&limit=50", buyer.Access, nil)
	var feed []artwork
	r.into(t, &feed)
	if !has(feed, a1.ID) {
		t.Fatal("for_you must include followed artist")
	}

	// публичный профиль и работы художника
	r = call(t, "GET", "/api/v1/users/"+artist.ID, buyer.Access, nil)
	var prof struct {
		Followers     int  `json:"followers"`
		ArtworksCount int  `json:"artworks_count"`
		IsFollowing   bool `json:"is_following"`
	}
	r.into(t, &prof)
	if prof.Followers != 1 || prof.ArtworksCount != 2 || !prof.IsFollowing {
		t.Fatalf("profile %+v", prof)
	}
	r = call(t, "GET", "/api/v1/users/"+artist.ID+"/artworks", "", nil)
	var theirs []artwork
	r.into(t, &theirs)
	if len(theirs) != 2 {
		t.Fatalf("user artworks %d", len(theirs))
	}
	expect(t, call(t, "GET", "/api/v1/users/00000000-0000-0000-0000-000000000000", "", nil), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/users/"+buyer.ID+"/follow", artist.Access, nil), http.StatusBadRequest)
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", artist.Access, nil), http.StatusBadRequest)
	expect(t, call(t, "DELETE", "/api/v1/users/"+artist.ID+"/follow", buyer.Access, nil), http.StatusNoContent)
}

func TestDeliveryQuote(t *testing.T) {
	artist := register(t, "artist")
	a := publishArtwork(t, artist, "Доставка", 20_000_00)
	r := call(t, "GET", "/api/v1/delivery/quote?artwork_id="+a.ID+"&city="+url.QueryEscape("Казань"), "", nil)
	expect(t, r, http.StatusOK)
	var quotes []struct {
		Method   string `json:"method"`
		PriceKop int64  `json:"price_kop"`
	}
	r.into(t, &quotes)
	if len(quotes) != 2 { // экспресс недоступен в регионах
		t.Fatalf("quotes %+v", quotes)
	}
	r = call(t, "GET", "/api/v1/delivery/quote?artwork_id="+a.ID+"&city="+url.QueryEscape("Москва"), "", nil)
	r.into(t, &quotes)
	if len(quotes) != 3 {
		t.Fatalf("moscow quotes %+v", quotes)
	}
	expect(t, call(t, "GET", "/api/v1/delivery/quote?artwork_id="+a.ID+"&city=Kazan&method=express", "", nil), http.StatusBadRequest)
	expect(t, call(t, "GET", "/api/v1/delivery/quote?artwork_id="+a.ID+"&city=", "", nil), http.StatusBadRequest)
	expect(t, call(t, "GET", "/api/v1/delivery/quote?artwork_id=bad", "", nil), http.StatusBadRequest)
	expect(t, call(t, "GET", "/api/v1/delivery/quote?artwork_id=00000000-0000-0000-0000-000000000000&city=x", "", nil), http.StatusNotFound)
}

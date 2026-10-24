package apitest

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"slices"
	"testing"
	"time"
)

// colorPNG — однотонная картинка 40×40 для проверки палитры.
func colorPNG(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 40; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

var (
	blue   = color.RGBA{46, 111, 216, 255}
	yellow = color.RGBA{241, 196, 15, 255}
)

func uploadColored(t *testing.T, token string, c color.RGBA) (string, []string) {
	t.Helper()
	r := uploadFile(t, token, colorPNG(t, c))
	expect(t, r, http.StatusCreated)
	var out struct {
		URL     string   `json:"url"`
		Palette []string `json:"palette"`
		Width   int      `json:"width"`
	}
	r.into(t, &out)
	if out.Width != 40 {
		t.Fatalf("width = %d", out.Width)
	}
	return out.URL, out.Palette
}

func publishWith(t *testing.T, artist user, title string, price int64, img string, extra map[string]any) artwork {
	t.Helper()
	body := artworkBody(title, price, []string{img}, true)
	for k, v := range extra {
		body[k] = v
	}
	r := call(t, "POST", "/api/v1/artworks", artist.Access, body)
	expect(t, r, http.StatusCreated)
	var a artwork
	r.into(t, &a)
	return a
}

func listIDs(t *testing.T, path, token string) []string {
	t.Helper()
	r := call(t, "GET", path, token, nil)
	expect(t, r, http.StatusOK)
	var items []artwork
	r.into(t, &items)
	ids := make([]string, len(items))
	for i, a := range items {
		ids[i] = a.ID
	}
	return ids
}

// waitNotification ждёт уведомление типа typ (часть рассылок идёт в фоне).
func waitNotification(t *testing.T, u user, typ string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r := call(t, "GET", "/api/v1/notifications?limit=50", u.Access, nil)
		var notes []struct {
			Type string         `json:"type"`
			Body string         `json:"body"`
			Data map[string]any `json:"data"`
		}
		r.into(t, &notes)
		for _, n := range notes {
			if n.Type == typ {
				n.Data["_body"] = n.Body
				return n.Data
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no %s notification", typ)
	return nil
}

func TestPaletteColorAndRoomFilters(t *testing.T) {
	artist := register(t, "artist")
	blueImg, palette := uploadColored(t, artist.Access, blue)
	if !slices.Equal(palette, []string{"blue"}) {
		t.Fatalf("palette = %v", palette)
	}
	yellowImg, _ := uploadColored(t, artist.Access, yellow)
	b := publishWith(t, artist, "Синее море", 12_000_00, blueImg, map[string]any{"rooms": []string{"bedroom"}})
	y := publishWith(t, artist, "Жёлтое поле", 12_000_00, yellowImg, map[string]any{"rooms": []string{"living", "kitchen"}})

	ids := listIDs(t, "/api/v1/artworks?artist_id="+artist.ID+"&colors=blue", "")
	if !slices.Equal(ids, []string{b.ID}) {
		t.Fatalf("blue filter = %v", ids)
	}
	ids = listIDs(t, "/api/v1/artworks?artist_id="+artist.ID+"&room=kitchen", "")
	if !slices.Equal(ids, []string{y.ID}) {
		t.Fatalf("room filter = %v", ids)
	}
	expect(t, call(t, "GET", "/api/v1/artworks?colors=magenta", "", nil), http.StatusBadRequest)
	expect(t, call(t, "GET", "/api/v1/artworks?room=garage", "", nil), http.StatusBadRequest)

	// неизвестный интерьер при создании и чужое фото — ошибка валидации
	other := register(t, "artist")
	bad := artworkBody("Чужое фото", 9_000_00, []string{blueImg}, true)
	r := call(t, "POST", "/api/v1/artworks", other.Access, bad)
	expect(t, r, http.StatusUnprocessableEntity)
	if r.Error.Fields["images"] == "" {
		t.Fatalf("foreign image accepted: %+v", r.Error)
	}
	bad = artworkBody("Гараж", 9_000_00, []string{yellowImg}, true)
	bad["rooms"] = []string{"garage"}
	expect(t, call(t, "POST", "/api/v1/artworks", artist.Access, bad), http.StatusUnprocessableEntity)

	// мета каталога отдаёт цвета и интерьеры
	r = call(t, "GET", "/api/v1/catalog/meta", "", nil)
	var meta struct {
		Colors []struct{ Code, Hex string } `json:"colors"`
		Rooms  []struct{ Code string }      `json:"rooms"`
	}
	r.into(t, &meta)
	if len(meta.Colors) < 10 || len(meta.Rooms) < 5 {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestSimilarAndHistory(t *testing.T) {
	artist := register(t, "artist")
	other := register(t, "artist")
	buyer := register(t, "buyer")
	img, _ := uploadColored(t, artist.Access, blue)
	src := publishWith(t, artist, "Исходная", 15_000_00, img, nil)
	img2, _ := uploadColored(t, other.Access, blue)
	similar := publishWith(t, other, "Похожая", 16_000_00, img2, nil)
	img3, _ := uploadColored(t, other.Access, yellow)
	far := publishWith(t, other, "Непохожая", 300_000_00, img3, map[string]any{"category": "photo", "style": "", "technique": ""})

	ids := listIDs(t, "/api/v1/artworks/"+src.ID+"/similar", "")
	if slices.Contains(ids, src.ID) {
		t.Fatal("artwork is similar to itself")
	}
	iSim, iFar := slices.Index(ids, similar.ID), slices.Index(ids, far.ID)
	if iSim < 0 || (iFar >= 0 && iFar < iSim) {
		t.Fatalf("similar order = %v (similar %d, far %d)", ids, iSim, iFar)
	}

	// просмотры: дубль в окне не считается, история — последние сверху
	expect(t, call(t, "GET", "/api/v1/artworks/"+src.ID+"?src=feed", buyer.Access, nil), http.StatusOK)
	expect(t, call(t, "GET", "/api/v1/artworks/"+src.ID+"?src=feed", buyer.Access, nil), http.StatusOK)
	expect(t, call(t, "GET", "/api/v1/artworks/"+similar.ID+"?src=similar", buyer.Access, nil), http.StatusOK)
	r := call(t, "GET", "/api/v1/artworks/"+src.ID, "", nil)
	var a artwork
	r.into(t, &a)
	if a.Views != 1 { // покупатель засчитан один раз; анонимный просмотр учтётся после ответа
		t.Fatalf("views = %d", a.Views)
	}
	hist := listIDs(t, "/api/v1/me/history", buyer.Access)
	if len(hist) != 2 || hist[0] != similar.ID {
		t.Fatalf("history = %v", hist)
	}
	expect(t, call(t, "DELETE", "/api/v1/me/history", buyer.Access, nil), http.StatusNoContent)
	if hist := listIDs(t, "/api/v1/me/history", buyer.Access); len(hist) != 0 {
		t.Fatalf("history after clear = %v", hist)
	}
}

func TestSavedSearchesAndPriceDrop(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")

	expect(t, call(t, "POST", "/api/v1/me/saved-searches", buyer.Access, map[string]any{"title": "Пусто", "filters": map[string]any{}}), http.StatusUnprocessableEntity)
	r := call(t, "POST", "/api/v1/me/saved-searches", buyer.Access, map[string]any{
		"title": "Синяя живопись", "filters": map[string]any{"category": "painting", "colors": []string{"blue"}, "price_max": 50_000_00},
	})
	expect(t, r, http.StatusCreated)
	var ss struct{ ID string }
	r.into(t, &ss)

	img, _ := uploadColored(t, artist.Access, blue)
	a := publishWith(t, artist, "Ночная гавань", 20_000_00, img, nil)
	data := waitNotification(t, buyer, "saved_search")
	if data["artwork_id"] != a.ID {
		t.Fatalf("saved search data = %v", data)
	}

	// снижение цены — тем, у кого работа в избранном
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/favorite", buyer.Access, nil), http.StatusNoContent)
	expect(t, call(t, "PATCH", "/api/v1/artworks/"+a.ID, artist.Access, map[string]any{"price_kop": 18_000_00}), http.StatusOK)
	data = waitNotification(t, buyer, "price_drop")
	if data["artwork_id"] != a.ID {
		t.Fatalf("price drop data = %v", data)
	}

	// «сообщить о похожих» из карточки
	r = call(t, "POST", "/api/v1/artworks/"+a.ID+"/similar-alert", buyer.Access, nil)
	expect(t, r, http.StatusCreated)
	r = call(t, "GET", "/api/v1/me/saved-searches", buyer.Access, nil)
	var list []struct {
		ID      string
		Filters struct {
			Category string   `json:"category"`
			Colors   []string `json:"colors"`
			PriceMin int64    `json:"price_min"`
		}
	}
	r.into(t, &list)
	if len(list) != 2 || list[0].Filters.Category != "painting" || list[0].Filters.PriceMin != 12_600_00 {
		t.Fatalf("saved searches = %+v", list)
	}
	expect(t, call(t, "DELETE", "/api/v1/me/saved-searches/"+ss.ID, buyer.Access, nil), http.StatusNoContent)
	expect(t, call(t, "DELETE", "/api/v1/me/saved-searches/"+ss.ID, buyer.Access, nil), http.StatusNotFound)
}

func TestCollections(t *testing.T) {
	artist := register(t, "artist")
	cheap := publishArtwork(t, artist, "Недорогая", 5_000_00)

	r := call(t, "GET", "/api/v1/collections", "", nil)
	expect(t, r, http.StatusOK)
	var cols []struct {
		Slug    string    `json:"slug"`
		Preview []artwork `json:"preview"`
	}
	r.into(t, &cols)
	found := false
	for _, c := range cols {
		if c.Slug == "under-10000" {
			for _, a := range c.Preview {
				found = found || a.ID == cheap.ID
			}
		}
	}
	if !found {
		t.Fatalf("cheap artwork not in under-10000: %+v", cols)
	}
	r = call(t, "GET", "/api/v1/collections/under-10000", "", nil)
	expect(t, r, http.StatusOK)
	if r.Meta["collection"] == nil {
		t.Fatal("collection meta missing")
	}
	expect(t, call(t, "GET", "/api/v1/collections/nope", "", nil), http.StatusNotFound)

	// ручная подборка администратора
	admin := register(t, "buyer")
	exec(t, `UPDATE users SET role = 'admin' WHERE id = $1`, admin.ID)
	adminAccess, _ := login(t, admin.Email, admin.Password)
	expect(t, call(t, "POST", "/api/v1/admin/collections", artist.Access, map[string]any{}), http.StatusForbidden)
	r = call(t, "POST", "/api/v1/admin/collections", adminAccess, map[string]any{
		"slug": "editors-choice", "title": "Выбор редакции", "kind": "manual", "artwork_ids": []string{cheap.ID},
	})
	expect(t, r, http.StatusOK)
	r = call(t, "GET", "/api/v1/collections/editors-choice", "", nil)
	var items []artwork
	r.into(t, &items)
	if len(items) != 1 || items[0].ID != cheap.ID {
		t.Fatalf("manual collection = %+v", items)
	}
	expect(t, call(t, "POST", "/api/v1/admin/collections", adminAccess, map[string]any{
		"slug": "editors-choice", "title": "Дубль", "kind": "manual",
	}), http.StatusUnprocessableEntity)
}

func TestVacationBlocksPurchase(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "На паузе", 9_000_00)
	until := time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
	expect(t, call(t, "PATCH", "/api/v1/me", buyer.Access, map[string]any{"vacation_until": until}), http.StatusUnprocessableEntity)
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"vacation_until": "2000-01-01T00:00:00Z"}), http.StatusUnprocessableEntity)
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"vacation_until": until, "vacation_note": "Уехал на пленэр"}), http.StatusOK)

	r := call(t, "GET", "/api/v1/artworks/"+a.ID, "", nil)
	var got struct {
		Artist struct {
			OnVacation bool `json:"on_vacation"`
		} `json:"artist"`
	}
	r.into(t, &got)
	if !got.Artist.OnVacation {
		t.Fatal("artist should be on vacation")
	}
	r = call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address})
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "artist_on_vacation" {
		t.Fatalf("code = %s", r.Error.Code)
	}
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"vacation_until": ""}), http.StatusOK)
	createOrder(t, buyer, a.ID)
}

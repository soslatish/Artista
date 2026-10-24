package apitest

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/soslatish/artista/backend/internal/db"
)

func getPage(t *testing.T, path string) (int, string, http.Header) {
	t.Helper()
	res, err := http.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b), res.Header
}

func TestSitePages(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Закат над Невой", 9_000_00)

	code, body, h := getPage(t, "/")
	if code != 200 || !strings.Contains(h.Get("Content-Type"), "text/html") || !strings.Contains(body, "Оригинальные работы") {
		t.Fatalf("home: %d %s", code, h.Get("Content-Type"))
	}
	code, body, _ = getPage(t, "/a/"+a.ID)
	if code != 200 || !strings.Contains(body, `property="og:title" content="«Закат над Невой»`) || !strings.Contains(body, "artista://artwork/"+a.ID) {
		t.Fatalf("artwork page: %d", code)
	}
	code, body, _ = getPage(t, "/u/"+artist.ID)
	if code != 200 || !strings.Contains(body, "Закат над Невой") {
		t.Fatalf("artist page: %d", code)
	}
	if code, _, _ := getPage(t, "/a/not-a-uuid"); code != 404 {
		t.Fatalf("bad artwork id: %d", code)
	}
	code, body, _ = getPage(t, "/collections/under-10000")
	if code != 200 || !strings.Contains(body, "Закат над Невой") {
		t.Fatalf("collection page: %d", code)
	}
	for _, p := range []string{"/legal/terms", "/legal/privacy", "/robots.txt", "/sitemap.xml", "/.well-known/assetlinks.json", "/static/site.css"} {
		if code, _, _ := getPage(t, p); code != 200 {
			t.Fatalf("%s: %d", p, code)
		}
	}
	if code, _, _ := getPage(t, "/.well-known/apple-app-site-association"); code != 404 {
		t.Fatalf("AASA without team id: %d", code)
	}
	code, body, h = getPage(t, "/no-such-page")
	if code != 404 || !strings.Contains(body, "Такой страницы нет") {
		t.Fatalf("404 page: %d", code)
	}
	code, _, h = getPage(t, "/api/v1/no-such-endpoint")
	if code != 404 || !strings.Contains(h.Get("Content-Type"), "application/json") {
		t.Fatalf("api 404: %d %s", code, h.Get("Content-Type"))
	}

	// страница сертификата после завершённой сделки
	ord := createOrder(t, buyer, a.ID)
	cert := completeOrder(t, buyer, artist, ord.ID, nil)
	code, body, _ = getPage(t, "/c/"+cert)
	if code != 200 || !strings.Contains(body, cert) || !strings.Contains(body, "Действителен") || !strings.Contains(body, `name="robots" content="noindex"`) {
		t.Fatalf("certificate page: %d", code)
	}
	// проданная работа остаётся доступна по ссылке
	if code, body, _ := getPage(t, "/a/"+a.ID); code != 200 || !strings.Contains(body, "продана") {
		t.Fatalf("sold artwork page: %d", code)
	}
}

func TestSiteExhibitionPage(t *testing.T) {
	artist := register(t, "artist")
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody("Премьера на сайте", 9_000_00, []string{uploadImage(t, artist.Access)}, false))
	var d artwork
	r.into(t, &d)
	r = call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Сайт-выставка", "starts_at": "2099-01-01T00:00:00Z", "artwork_ids": []string{d.ID},
	})
	expect(t, r, http.StatusUnprocessableEntity) // слишком далеко
	r = call(t, "POST", "/api/v1/exhibitions", artist.Access, map[string]any{
		"title": "Сайт-выставка", "starts_at": time.Now().Add(3 * time.Hour).UTC().Format(time.RFC3339), "artwork_ids": []string{d.ID},
	})
	expect(t, r, http.StatusCreated)
	var ex struct{ ID string }
	r.into(t, &ex)
	code, body, _ := getPage(t, "/e/"+ex.ID)
	if code != 200 || !strings.Contains(body, "Сайт-выставка") || !strings.Contains(body, "Премьера на сайте") {
		t.Fatalf("exhibition page: %d", code)
	}
}

func TestWebAppForBrowsers(t *testing.T) {
	artist := register(t, "artist")
	a := publishArtwork(t, artist, "Работа для браузера", 9_000_00)

	// страница работы предлагает купить в браузере — для тех, кто открыл ссылку в Telegram
	if _, body, _ := getPage(t, "/a/"+a.ID); !strings.Contains(body, `href="/app/artwork/`+a.ID+`"`) {
		t.Fatal("artwork page has no web app link")
	}
	// маршруты приложения отдают index.html, статика — с долгим кэшем
	code, body, h := getPage(t, "/app/artwork/"+a.ID)
	if code != 200 || !strings.Contains(body, "artista-webapp") || h.Get("Cache-Control") != "no-cache" {
		t.Fatalf("app route: %d %q", code, h.Get("Cache-Control"))
	}
	code, _, h = getPage(t, "/app/_expo/static/js/app-123.js")
	if code != 200 || !strings.Contains(h.Get("Cache-Control"), "immutable") {
		t.Fatalf("static: %d %q", code, h.Get("Cache-Control"))
	}
	if code, _, _ := getPage(t, "/app/missing.js"); code != 404 {
		t.Fatalf("missing asset: %d", code)
	}
	if code, body, _ := getPage(t, "/app/..%2f..%2fetc/passwd"); code == 200 && strings.Contains(body, "root:") {
		t.Fatal("path traversal")
	}
	if code, _, _ := getPage(t, "/app"); code != 200 {
		t.Fatalf("/app redirect: %d", code)
	}
}

func TestRebaseFileURLsAfterAddressChange(t *testing.T) {
	artist := register(t, "artist")
	a := publishArtwork(t, artist, "Работа со старым адресом", 9_000_00)
	ctx := context.Background()
	// сервер «переехал» на другой адрес, затем вернулся — ссылки следуют за ним
	if _, err := db.RebaseFileURLs(ctx, pool, "http://192.168.0.77:8080"); err != nil {
		t.Fatal(err)
	}
	var moved string
	if err := pool.QueryRow(ctx, `SELECT url FROM artwork_images WHERE artwork_id = $1 LIMIT 1`, a.ID).Scan(&moved); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(moved, "http://192.168.0.77:8080/files/") {
		t.Fatalf("not rebased: %s", moved)
	}
	n, err := db.RebaseFileURLs(ctx, pool, ts.URL)
	if err != nil || n == 0 {
		t.Fatalf("rebase back: %d %v", n, err)
	}
	// после возврата работа снова редактируется: фото проходят проверку «загружено через приложение»
	var got artwork
	call(t, "GET", "/api/v1/artworks/"+a.ID, artist.Access, nil).into(t, &got)
	if len(got.Images) == 0 || !strings.HasPrefix(got.Images[0], ts.URL+"/files/") {
		t.Fatalf("images: %v", got.Images)
	}
	if n, _ := db.RebaseFileURLs(ctx, pool, ts.URL); n != 0 {
		t.Fatalf("second run changed %d rows", n)
	}
}

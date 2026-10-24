package api

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// Сайт: лендинг и публичные страницы работ, художников, выставок, подборок и сертификатов.
// Страницы рендерятся на сервере — у ссылок в ВКонтакте и Telegram красивые превью (Open Graph),
// а на телефоне с установленным приложением они открываются в нём (App Links / Universal Links).

//go:embed site/*.html
var siteTemplates embed.FS

//go:embed site/static
var siteStatic embed.FS

// siteVersion — версия статики для сброса кэша браузера.
var siteVersion = fmt.Sprint(time.Now().Unix())

var siteFuncs = template.FuncMap{
	"rub": rub,
	"date": func(v any) string {
		switch t := v.(type) {
		case time.Time:
			return t.In(moscow).Format("02.01.2006")
		case *time.Time:
			if t != nil {
				return t.In(moscow).Format("02.01.2006")
			}
		}
		return ""
	},
	"datetime": func(t time.Time) string {
		return t.In(moscow).Format("02.01.2006 в 15:04")
	},
	"size":   formatSize,
	"rating": func(r *float64) string { return strings.Replace(fmt.Sprintf("%.1f", *r), ".", ",", 1) },
	"initial": func(name string) string {
		r := []rune(strings.TrimSpace(name))
		if len(r) == 0 {
			return "A"
		}
		return strings.ToUpper(string(r[0]))
	},
	"statusLabel": statusText,
	// sentence — текст без завершающей точки (чтобы не было «..» после подстановки)
	"sentence": func(t string) string { return strings.TrimRight(strings.TrimSpace(t), ".!") },
}

// sitePages — шаблоны страниц (каждая страница — layout + свой блок content).
var sitePages = func() map[string]*template.Template {
	pages := map[string]*template.Template{}
	for _, name := range []string{"home", "artwork", "artist", "exhibition", "collection", "certificate", "page"} {
		pages[name] = template.Must(template.New(name).Funcs(siteFuncs).ParseFS(siteTemplates, "site/layout.html", "site/"+name+".html"))
	}
	return pages
}()

type siteStores struct{ GooglePlay, RuStore, AppStore string }

// siteArtwork — работа для шаблонов сайта.
type siteArtwork struct {
	ID, Title, ArtistID, ArtistName, ArtistCity, Image, Facts, StatusText, Description string
	Images                                                                             []string
	PriceKop, AuctionKop                                                               int64
	W, Ratio                                                                           float64
	Year                                                                               *int
	ArtistPremium                                                                      bool
}

// sitePage — данные страницы (общие поля + поля конкретной страницы).
type sitePage struct {
	Title, Description, OGTitle, OGType, Canonical, Image, AppPath, Version, SupportEmail string
	Year                                                                                  int
	NoIndex                                                                               bool
	Stores                                                                                siteStores

	Wall, Recent, Similar, Works []siteArtwork
	Artwork                      *siteArtwork
	Exhibitions                  []exhibitionDTO
	Exhibition                   *exhibitionDTO
	Profile                      *userDTO
	Collection                   *collectionDTO
	Certificate                  *certificateDTO

	Heading  string
	Body     template.HTML
	Draft    bool
	ShowHome bool
}

func statusText(status string) string {
	switch status {
	case "reserved":
		return "зарезервирована"
	case "sold":
		return "продана"
	case "scheduled":
		return "скоро на выставке"
	case "auction":
		return "идёт аукцион"
	}
	return ""
}

func formatSize(w, h, d float64) string {
	num := func(v float64) string {
		return strings.Replace(strings.TrimSuffix(fmt.Sprintf("%.1f", v), ".0"), ".", ",", 1)
	}
	s := num(w) + " × " + num(h)
	if d > 0 {
		s += " × " + num(d)
	}
	return s + " см"
}

func toSiteArtwork(a artworkDTO, meta domain.Meta) siteArtwork {
	sa := siteArtwork{
		ID: a.ID, Title: a.Title, ArtistID: a.Artist.ID, ArtistName: a.Artist.Name, ArtistCity: a.Artist.City,
		Images: a.Images, PriceKop: a.PriceKop, W: a.WidthCm, Year: a.Year, Description: a.Description,
		StatusText: statusText(a.Status), ArtistPremium: a.Artist.IsPremium,
	}
	if len(a.Images) > 0 {
		sa.Image = a.Images[0]
	}
	if a.WidthCm > 0 && a.HeightCm > 0 {
		sa.Ratio = float64(int(a.WidthCm/a.HeightCm*1000)) / 1000
	} else {
		sa.Ratio = 1
	}
	if a.Auction != nil && a.Auction.CurrentKop != nil {
		sa.AuctionKop = *a.Auction.CurrentKop
	}
	facts := []string{}
	if t := optionLabel(meta.Techniques, a.Technique); t != "" {
		facts = append(facts, t)
	} else if c := optionLabel(meta.Categories, a.Category); c != "" {
		facts = append(facts, c)
	}
	facts = append(facts, formatSize(a.WidthCm, a.HeightCm, a.DepthCm))
	sa.Facts = strings.Join(facts, ", ")
	return sa
}

func (s *Server) basePage(r *http.Request, title, description string) sitePage {
	return sitePage{
		Title: title, OGTitle: title, Description: description,
		Canonical: s.siteURL() + r.URL.Path, Image: s.siteURL() + "/static/og.jpg",
		Version: siteVersion, Year: time.Now().In(moscow).Year(), SupportEmail: s.Config.SupportEmail,
		Stores: siteStores{GooglePlay: s.Config.StoreGooglePlay, RuStore: s.Config.StoreRuStore, AppStore: s.Config.StoreAppStore},
	}
}

// render отдаёт страницу; ошибка шаблона не ломает ответ наполовину — рендерим в буфер.
func (s *Server) render(w http.ResponseWriter, status int, name string, p sitePage) {
	var buf bytes.Buffer
	if err := sitePages[name].ExecuteTemplate(&buf, "layout", p); err != nil {
		s.Log.Error("render page", "page", name, "err", err)
		http.Error(w, "Внутренняя ошибка", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

func (s *Server) siteArtworks(ctx context.Context, sql string, args ...any) ([]siteArtwork, error) {
	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	items, err := collectArtworks(rows)
	if err != nil {
		return nil, err
	}
	meta := domain.CatalogMeta()
	out := make([]siteArtwork, 0, len(items))
	for _, a := range items {
		out = append(out, toSiteArtwork(a, meta))
	}
	return out, nil
}

// ---------- страницы ----------

const wallSize = 7

func (s *Server) siteHome(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p := s.basePage(r, "Artista — оригинальные работы художников",
		"Покупайте живопись, графику и скульптуру напрямую у художников. Безопасная сделка: автор получает оплату после того, как работа у вас.")
	p.Canonical = s.siteURL() + "/"
	sql, args := catalogQuery("", catalogFilter{}, "", "new", page{limit: 24})
	recent, err := s.siteArtworks(ctx, sql, args...)
	if err != nil {
		s.siteError(w, r, err)
		return
	}
	for _, a := range recent {
		if a.Image != "" && a.W > 0 && len(p.Wall) < wallSize {
			p.Wall = append(p.Wall, a)
		}
	}
	p.Recent = recent
	rows, err := s.DB.Query(ctx, exhibitionSelect+`WHERE e.cancelled_at IS NULL AND (e.opened_at IS NULL OR e.opened_at > now() - interval '14 days')
		AND u.deleted_at IS NULL ORDER BY (e.opened_at IS NULL) DESC, e.starts_at LIMIT 4`, nil)
	if err == nil {
		for rows.Next() {
			if e, err := scanExhibition(rows); err == nil {
				p.Exhibitions = append(p.Exhibitions, e)
			}
		}
		rows.Close()
	}
	s.render(w, http.StatusOK, "home", p)
}

func (s *Server) siteArtwork(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	a, err := loadArtwork(r.Context(), s.DB, id, "")
	if err != nil || !a.visibleTo("") {
		s.siteNotFound(w, r)
		return
	}
	sa := toSiteArtwork(a, domain.CatalogMeta())
	p := s.basePage(r, a.Title+" — "+a.Artist.Name+" | Artista",
		fmt.Sprintf("%s, %s. %s. Оригинал от художника на Artista.", sa.Facts, rub(a.PriceKop), a.Artist.Name))
	p.OGTitle = "«" + a.Title + "» — " + a.Artist.Name
	p.OGType = "product"
	p.AppPath = "artwork/" + a.ID
	if sa.Image != "" {
		p.Image = sa.Image
	}
	p.Artwork = &sa
	sql := `WITH src AS (SELECT id, artist_id, category, style, palette, price_kop FROM artworks WHERE id = $2) ` + artworkSelect + ` CROSS JOIN src
		WHERE a.id <> src.id AND ` + catalogStatuses + ` AND u.deleted_at IS NULL AND u.banned_at IS NULL
		ORDER BY ((a.category = src.category)::int * 3 + (a.style <> '' AND a.style = src.style)::int * 2
			+ cardinality(ARRAY(SELECT unnest(a.palette) INTERSECT SELECT unnest(src.palette))) * 1.5) DESC, a.published_at DESC NULLS LAST
		LIMIT 8`
	p.Similar, _ = s.siteArtworks(r.Context(), sql, nil, id)
	s.render(w, http.StatusOK, "artwork", p)
}

func (s *Server) siteArtist(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	var d userDTO
	err = s.DB.QueryRow(r.Context(), `SELECT u.id, u.name, u.role, u.city, u.bio, u.avatar_url,
			coalesce(u.premium_until > now(), false),
			(SELECT round(avg(rating)::numeric, 1)::float8 FROM reviews WHERE artist_id = u.id),
			coalesce(u.vacation_until > now(), false), CASE WHEN u.vacation_until > now() THEN u.vacation_until END,
			CASE WHEN u.vacation_until > now() THEN u.vacation_note ELSE '' END,
			u.accepts_commissions AND u.role = 'artist', u.commission_note
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL`, id).
		Scan(&d.ID, &d.Name, &d.Role, &d.City, &d.Bio, &d.AvatarURL, &d.IsPremium, &d.Rating,
			&d.OnVacation, &d.VacationUntil, &d.VacationNote, &d.AcceptsCommissions, &d.CommissionNote)
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	desc := d.Bio
	if desc == "" {
		desc = "Работы художника " + d.Name + " на Artista"
	}
	p := s.basePage(r, d.Name+" — художник | Artista", truncate(strings.ReplaceAll(desc, "\n", " "), 180))
	p.OGType = "profile"
	p.AppPath = "artist/" + d.ID
	if d.AvatarURL != "" {
		p.Image = d.AvatarURL
	}
	p.Profile = &d
	p.Works, err = s.siteArtworks(r.Context(), artworkSelect+`WHERE a.artist_id = $2 AND `+publicStatuses+`
		ORDER BY (a.status IN ('published','auction')) DESC, a.published_at DESC NULLS LAST LIMIT 60`, nil, id)
	if err != nil {
		s.siteError(w, r, err)
		return
	}
	if len(p.Works) > 0 && d.AvatarURL == "" && p.Works[0].Image != "" {
		p.Image = p.Works[0].Image
	}
	s.render(w, http.StatusOK, "artist", p)
}

func (s *Server) siteExhibition(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	e, err := s.loadExhibition(r.Context(), id, "")
	if err != nil || e.Status == "cancelled" {
		s.siteNotFound(w, r)
		return
	}
	when := "Откроется " + e.StartsAt.In(moscow).Format("02.01.2006 в 15:04") + " (МСК)"
	if e.Status == "open" {
		when = "Выставка открыта"
	}
	p := s.basePage(r, e.Title+" — выставка | Artista", when+". "+e.Artist.Name+" на Artista.")
	p.AppPath = "exhibition/" + e.ID
	if e.CoverURL != "" {
		p.Image = e.CoverURL
	}
	p.Exhibition = &e
	p.Works, err = s.siteArtworks(r.Context(), artworkSelect+`WHERE a.exhibition_id = $2 AND a.status NOT IN ('hidden','draft','archived','commission')
		ORDER BY a.created_at`, nil, id)
	if err != nil {
		s.siteError(w, r, err)
		return
	}
	s.render(w, http.StatusOK, "exhibition", p)
}

func (s *Server) siteCollection(w http.ResponseWriter, r *http.Request) {
	c, err := scanCollection(s.DB.QueryRow(r.Context(), `SELECT `+collectionCols+` FROM collections WHERE slug = $1 AND is_published`, r.PathValue("slug")))
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	items, err := s.collectionArtworks(r.Context(), c, "", page{limit: 48})
	if err != nil {
		s.siteError(w, r, err)
		return
	}
	desc := c.Subtitle
	if desc == "" {
		desc = "Подборка работ на Artista"
	}
	p := s.basePage(r, c.Title+" | Artista", desc)
	p.Collection = &c
	meta := domain.CatalogMeta()
	for _, a := range items {
		p.Works = append(p.Works, toSiteArtwork(a, meta))
	}
	if len(p.Works) > 0 && p.Works[0].Image != "" {
		p.Image = p.Works[0].Image
	}
	s.render(w, http.StatusOK, "collection", p)
}

func (s *Server) siteCertificate(w http.ResponseWriter, r *http.Request) {
	c, err := s.loadCertificate(r.Context(), r.PathValue("code"), "")
	if err != nil {
		s.siteNotFound(w, r)
		return
	}
	p := s.basePage(r, "Сертификат "+c.Code+" | Artista", "Сертификат подлинности работы «"+c.Artwork.Title+"», "+c.Artist.Name+".")
	p.NoIndex = true
	if c.Artwork.ImageURL != "" {
		p.Image = c.Artwork.ImageURL
	}
	p.Certificate = &c
	s.render(w, http.StatusOK, "certificate", p)
}

func (s *Server) siteLegal(w http.ResponseWriter, r *http.Request) {
	doc, ok := legalDocs[r.PathValue("doc")]
	if !ok {
		s.siteNotFound(w, r)
		return
	}
	p := s.basePage(r, doc.title+" | Artista", doc.title+" сервиса Artista")
	p.Heading, p.Body, p.Draft = doc.title, doc.body, true
	s.render(w, http.StatusOK, "page", p)
}

func (s *Server) siteNotFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		httpx.Fail(w, r, s.Log, httpx.NotFound("Не найдено"))
		return
	}
	p := s.basePage(r, "Страница не найдена | Artista", "Такой страницы нет на Artista.")
	p.NoIndex = true
	p.Heading = "Такой страницы нет"
	p.Body = template.HTML(`<p>Возможно, работу уже сняли с продажи или ссылка набрана с ошибкой.</p>`)
	p.ShowHome = true
	s.render(w, http.StatusNotFound, "page", p)
}

func (s *Server) siteError(w http.ResponseWriter, r *http.Request, err error) {
	s.Log.Error("site", "path", r.URL.Path, "err", err)
	p := s.basePage(r, "Ошибка | Artista", "")
	p.NoIndex = true
	p.Heading = "Не удалось загрузить страницу"
	p.Body = template.HTML(`<p>Попробуйте обновить её через минуту.</p>`)
	p.ShowHome = true
	s.render(w, http.StatusInternalServerError, "page", p)
}

// ---------- служебное: статика, robots, sitemap, ассоциация домена с приложением ----------

func (s *Server) siteStaticHandler() http.Handler {
	sub, _ := fs.Sub(siteStatic, "site/static")
	files := http.StripPrefix("/static/", http.FileServerFS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=604800")
		files.ServeHTTP(w, r)
	})
}

func (s *Server) robots(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, "User-agent: *\nDisallow: /api/\nDisallow: /c/\nSitemap: %s/sitemap.xml\n", s.siteURL())
}

func (s *Server) sitemap(w http.ResponseWriter, r *http.Request) {
	type loc struct {
		Loc     string `xml:"loc"`
		LastMod string `xml:"lastmod,omitempty"`
	}
	urls := []loc{{Loc: s.siteURL() + "/"}}
	add := func(sql, prefix string) {
		rows, err := s.DB.Query(r.Context(), sql)
		if err != nil {
			s.Log.Warn("sitemap", "err", err)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var mod time.Time
			if rows.Scan(&key, &mod) == nil {
				urls = append(urls, loc{Loc: s.siteURL() + prefix + key, LastMod: mod.Format("2006-01-02")})
			}
		}
	}
	add(`SELECT id::text, updated_at FROM artworks a WHERE a.status IN ('published','auction','reserved','sold') ORDER BY updated_at DESC LIMIT 20000`, "/a/")
	add(`SELECT u.id::text, max(a.updated_at) FROM users u JOIN artworks a ON a.artist_id = u.id AND a.status IN ('published','auction','sold')
		WHERE u.deleted_at IS NULL AND u.banned_at IS NULL GROUP BY u.id LIMIT 10000`, "/u/")
	add(`SELECT id::text, created_at FROM exhibitions WHERE cancelled_at IS NULL ORDER BY created_at DESC LIMIT 2000`, "/e/")
	add(`SELECT slug, created_at FROM collections WHERE is_published`, "/collections/")
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = w.Write([]byte(xml.Header))
	_ = xml.NewEncoder(w).Encode(struct {
		XMLName xml.Name `xml:"urlset"`
		NS      string   `xml:"xmlns,attr"`
		URLs    []loc    `xml:"url"`
	}{NS: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: urls})
}

const appPackage = "com.aleksandr.artista"

// assetLinks — Android App Links: ссылки на сайт открываются в приложении без диалога выбора.
func (s *Server) assetLinks(w http.ResponseWriter, _ *http.Request) {
	fps := s.Config.AndroidCertFingerprints
	if fps == nil {
		fps = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode([]map[string]any{{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target":   map[string]any{"namespace": "android_app", "package_name": appPackage, "sha256_cert_fingerprints": fps},
	}})
}

// appleAppSiteAssociation — Universal Links для iOS.
func (s *Server) appleAppSiteAssociation(w http.ResponseWriter, r *http.Request) {
	if s.Config.AppleTeamID == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"applinks": map[string]any{"details": []map[string]any{{
			"appIDs":     []string{s.Config.AppleTeamID + "." + appPackage},
			"components": []map[string]string{{"/": "/a/*"}, {"/": "/u/*"}, {"/": "/e/*"}, {"/": "/c/*"}},
		}}},
	})
}

func (s *Server) siteRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /{$}", s.siteHome)
	mux.HandleFunc("GET /a/{id}", s.siteArtwork)
	mux.HandleFunc("GET /u/{id}", s.siteArtist)
	mux.HandleFunc("GET /e/{id}", s.siteExhibition)
	mux.HandleFunc("GET /c/{code}", s.siteCertificate)
	mux.HandleFunc("GET /collections/{slug}", s.siteCollection)
	mux.HandleFunc("GET /legal/{doc}", s.siteLegal)
	mux.Handle("GET /static/", s.siteStaticHandler())
	mux.HandleFunc("GET /robots.txt", s.robots)
	mux.HandleFunc("GET /sitemap.xml", s.sitemap)
	mux.HandleFunc("GET /.well-known/assetlinks.json", s.assetLinks)
	mux.HandleFunc("GET /.well-known/apple-app-site-association", s.appleAppSiteAssociation)
	mux.HandleFunc("/", s.siteNotFound)
}

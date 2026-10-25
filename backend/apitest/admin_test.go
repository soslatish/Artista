package apitest

import (
	"net/http"
	"strings"
	"testing"
)

// makeAdmin — тестовый администратор (роль выдаётся в базе, как ADMIN_EMAIL при старте).
func makeAdmin(t *testing.T) user {
	t.Helper()
	u := register(t, "buyer")
	exec(t, `UPDATE users SET role = 'admin' WHERE id = $1`, u.ID)
	u.Role = "admin"
	return u
}

func TestAdminOnlyForAdmins(t *testing.T) {
	buyer := register(t, "buyer")
	for _, path := range []string{"/api/v1/admin/dashboard", "/api/v1/admin/users", "/api/v1/admin/settings", "/api/v1/admin/audit"} {
		expect(t, call(t, "GET", path, buyer.Access, nil), http.StatusForbidden)
	}
	// снятый администратор теряет доступ сразу, даже со старым токеном
	admin := makeAdmin(t)
	expect(t, call(t, "GET", "/api/v1/admin/dashboard", admin.Access, nil), http.StatusOK)
	exec(t, `UPDATE users SET role = 'buyer' WHERE id = $1`, admin.ID)
	expect(t, call(t, "GET", "/api/v1/admin/dashboard", admin.Access, nil), http.StatusForbidden)
}

func TestAdminSettingsChangeBusinessRules(t *testing.T) {
	admin := makeAdmin(t)
	var cur struct {
		Settings map[string]any `json:"settings"`
	}
	call(t, "GET", "/api/v1/admin/settings", admin.Access, nil).into(t, &cur)
	s := cur.Settings
	defer func() { // вернуть как было — остальные тесты ждут условий по умолчанию
		expect(t, call(t, "PUT", "/api/v1/admin/settings", admin.Access, s), http.StatusOK)
	}()

	changed := map[string]any{}
	for k, v := range s {
		changed[k] = v
	}
	changed["commission_bp"] = 1000
	changed["premium_price_kop"] = 500_00
	changed["announcement"] = "Скидки на доставку до конца месяца"
	changed["promotion_tariffs"] = []map[string]any{{"days": 5, "price_kop": 250_00}}
	expect(t, call(t, "PUT", "/api/v1/admin/settings", admin.Access, changed), http.StatusOK)

	var meta struct {
		CommissionBP int    `json:"commission_bp"`
		PremiumKop   int64  `json:"premium_price_kop"`
		Announcement string `json:"announcement"`
		Promotion    []struct {
			Days int `json:"days"`
		} `json:"promotion_tariffs"`
	}
	call(t, "GET", "/api/v1/catalog/meta", "", nil).into(t, &meta)
	if meta.CommissionBP != 1000 || meta.PremiumKop != 500_00 || meta.Announcement == "" || len(meta.Promotion) != 1 || meta.Promotion[0].Days != 5 {
		t.Fatalf("meta not updated: %+v", meta)
	}
	if _, body, _ := getPage(t, "/"); !strings.Contains(body, "10%") {
		t.Fatal("site home shows old commission")
	}

	// выключенные функции закрываются на сервере
	off := map[string]any{}
	for k, v := range changed {
		off[k] = v
	}
	off["registration_open"], off["offers_enabled"] = false, false
	expect(t, call(t, "PUT", "/api/v1/admin/settings", admin.Access, off), http.StatusOK)
	r := call(t, "POST", "/api/v1/auth/register", "", map[string]string{"email": "closed@test.ru", "password": "secret123", "name": "Закрыто", "role": "buyer"})
	expect(t, r, http.StatusForbidden)

	bad := map[string]any{}
	for k, v := range changed {
		bad[k] = v
	}
	bad["commission_bp"] = 9000
	expect(t, call(t, "PUT", "/api/v1/admin/settings", admin.Access, bad), http.StatusUnprocessableEntity)
}

func TestAdminUsersBanPremiumRole(t *testing.T) {
	admin := makeAdmin(t)
	artist := register(t, "artist")
	a := publishArtwork(t, artist, "Работа под баном", 9_000_00)

	var list []struct {
		ID, Email string
	}
	r0 := call(t, "GET", "/api/v1/admin/users?q="+artist.Email, admin.Access, nil)
	expect(t, r0, http.StatusOK)
	r0.into(t, &list)
	if len(list) != 1 || list[0].ID != artist.ID {
		t.Fatalf("search: %+v", list)
	}
	expect(t, call(t, "PATCH", "/api/v1/admin/users/"+admin.ID, admin.Access, map[string]any{"banned": true}), http.StatusConflict)

	// бан: вход закрыт, работы скрыты
	expect(t, call(t, "PATCH", "/api/v1/admin/users/"+artist.ID, admin.Access, map[string]any{"banned": true, "reason": "спам"}), http.StatusOK)
	expect(t, call(t, "GET", "/api/v1/me", artist.Access, nil), http.StatusUnauthorized)
	var arts []struct{ ID, Status string }
	call(t, "GET", "/api/v1/admin/artworks?artist_id="+artist.ID, admin.Access, nil).into(t, &arts)
	if len(arts) != 1 || arts[0].Status != "hidden" {
		t.Fatalf("artworks after ban: %+v", arts)
	}

	// разбан, Премиум на 30 дней, роль
	var d struct {
		BannedAt     *string `json:"banned_at"`
		PremiumUntil *string `json:"premium_until"`
		Role         string  `json:"role"`
		Actions      []any   `json:"admin_actions"`
	}
	call(t, "PATCH", "/api/v1/admin/users/"+artist.ID, admin.Access, map[string]any{"banned": false, "premium_days": 30, "role": "buyer"}).into(t, &d)
	if d.BannedAt != nil || d.PremiumUntil == nil || d.Role != "buyer" || len(d.Actions) < 2 {
		t.Fatalf("after unban: %+v", d)
	}
	// вернуть работу в продажу
	expect(t, call(t, "PATCH", "/api/v1/admin/artworks/"+a.ID, admin.Access, map[string]any{"status": "published", "price_kop": 12_000_00}), http.StatusOK)
	var pub artwork
	call(t, "GET", "/api/v1/artworks/"+a.ID, "", nil).into(t, &pub)
	if pub.Status != "published" {
		t.Fatalf("artwork status: %s", pub.Status)
	}
}

func TestAdminResolvesOrderDispute(t *testing.T) {
	admin := makeAdmin(t)
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Спорная работа", 9_000_00)
	o := createOrder(t, buyer, a.ID)
	payOrder(t, buyer, o.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/confirm", artist.Access, nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/ship", artist.Access, map[string]any{"tracking_number": "CDEK-1"}), http.StatusOK)

	// посылка не пришла — администратор отменяет отправленный заказ с возвратом
	var d struct {
		Status       string `json:"status"`
		PayoutStatus string `json:"payout_status"`
		CancelReason string `json:"cancel_reason"`
		Payments     []struct{ Status string }
	}
	call(t, "POST", "/api/v1/admin/orders/"+o.ID+"/cancel", admin.Access, map[string]any{"reason": "Посылка утеряна"}).into(t, &d)
	if d.Status != "cancelled" || d.PayoutStatus != "refunded" || d.CancelReason != "Посылка утеряна" || len(d.Payments) == 0 || d.Payments[0].Status != "refunded" {
		t.Fatalf("dispute: %+v", d)
	}
	expect(t, call(t, "POST", "/api/v1/admin/orders/"+o.ID+"/complete", admin.Access, nil), http.StatusConflict)

	var orders []struct{ ID string }
	call(t, "GET", "/api/v1/admin/orders?user_id="+buyer.ID, admin.Access, nil).into(t, &orders)
	if len(orders) != 1 {
		t.Fatalf("orders: %+v", orders)
	}
	var dash struct {
		Users struct{ Total int }
		Daily []any `json:"daily"`
	}
	call(t, "GET", "/api/v1/admin/dashboard", admin.Access, nil).into(t, &dash)
	if dash.Users.Total == 0 || len(dash.Daily) != 30 {
		t.Fatalf("dashboard: %+v", dash)
	}
	var log []struct{ Action string }
	call(t, "GET", "/api/v1/admin/audit", admin.Access, nil).into(t, &log)
	if len(log) == 0 || log[0].Action != "order.cancel" {
		t.Fatalf("audit: %+v", log)
	}
	var pays []struct{ ID string }
	call(t, "GET", "/api/v1/admin/payments?q="+o.ID, admin.Access, nil).into(t, &pays)
	if len(pays) == 0 {
		t.Fatal("payments search")
	}
}

func TestAdminDealsContentBroadcast(t *testing.T) {
	admin := makeAdmin(t)
	artist := register(t, "artist")
	bidder := register(t, "buyer")
	a := publishArtwork(t, artist, "Аукцион для админа", 9_000_00)
	var au struct{ ID string }
	call(t, "POST", "/api/v1/artworks/"+a.ID+"/auction", artist.Access, map[string]any{"start_kop": 5_000_00, "days": 3}).into(t, &au)
	expect(t, call(t, "POST", "/api/v1/auctions/"+au.ID+"/bids", bidder.Access, map[string]any{"amount_kop": 5_000_00}), http.StatusCreated)

	var deals []struct{ ID, Status string }
	call(t, "GET", "/api/v1/admin/deals/auctions?status=live", admin.Access, nil).into(t, &deals)
	if len(deals) == 0 {
		t.Fatal("no live auctions")
	}
	for _, kind := range []string{"offers", "commissions", "exhibitions"} {
		expect(t, call(t, "GET", "/api/v1/admin/deals/"+kind, admin.Access, nil), http.StatusOK)
	}
	expect(t, call(t, "POST", "/api/v1/admin/deals/auctions/"+au.ID+"/cancel", admin.Access, map[string]any{"reason": "накрутка"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/admin/deals/auctions/"+au.ID+"/cancel", admin.Access, nil), http.StatusConflict)
	var back artwork
	call(t, "GET", "/api/v1/artworks/"+a.ID, "", nil).into(t, &back)
	if back.Status != "published" {
		t.Fatalf("artwork after cancel: %s", back.Status)
	}

	var post struct{ ID string }
	call(t, "POST", "/api/v1/posts", artist.Access, map[string]any{"body": "Пост для модерации"}).into(t, &post)
	expect(t, call(t, "POST", "/api/v1/admin/content/posts/"+post.ID+"/hidden", admin.Access, map[string]any{"hidden": true}), http.StatusNoContent)
	var hidden []struct{ ID string }
	call(t, "GET", "/api/v1/admin/content/posts?status=hidden", admin.Access, nil).into(t, &hidden)
	found := false
	for _, p := range hidden {
		found = found || p.ID == post.ID
	}
	if !found {
		t.Fatal("hidden post not listed")
	}
	expect(t, call(t, "GET", "/api/v1/admin/content/questions", admin.Access, nil), http.StatusOK)
	expect(t, call(t, "GET", "/api/v1/admin/certificates", admin.Access, nil), http.StatusOK)

	var sent struct{ Sent int }
	call(t, "POST", "/api/v1/admin/broadcast", admin.Access, map[string]any{"audience": "artists", "title": "Новые правила", "body": "Обновили условия продвижения"}).into(t, &sent)
	if sent.Sent == 0 {
		t.Fatal("broadcast reached nobody")
	}
	waitNotification(t, artist, "announcement")
	expect(t, call(t, "POST", "/api/v1/admin/broadcast", admin.Access, map[string]any{"audience": "everyone", "title": "x", "body": "y"}), http.StatusUnprocessableEntity)
}

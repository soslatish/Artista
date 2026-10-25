package apitest

import (
	"context"
	"net/http"
	"testing"
)

// Прямые сделки (без «Безопасной сделки»): площадка не принимает оплату за работы,
// покупатель договаривается с художником в чате, художник отмечает работу проданной.
func TestDirectDeals(t *testing.T) {
	ctx := context.Background()
	if err := setDealMode(ctx, false); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = setDealMode(ctx, true) }()

	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Прямая продажа", 12_000_00)

	var meta struct {
		Features map[string]bool `json:"features"`
	}
	call(t, "GET", "/api/v1/catalog/meta", "", nil).into(t, &meta)
	if meta.Features["safe_deals"] || meta.Features["promotion_sales"] {
		t.Fatalf("features = %+v", meta.Features)
	}

	r := call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek"})
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "direct_deals" {
		t.Fatalf("code = %s", r.Error.Code)
	}
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/promote", artist.Access, map[string]any{"days": 7}), http.StatusConflict)

	// договорились в чате — художник отмечает работу проданной; чужой работе — нельзя
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/sold", buyer.Access, nil), http.StatusNotFound)
	var sold artwork
	r = call(t, "POST", "/api/v1/artworks/"+a.ID+"/sold", artist.Access, nil)
	expect(t, r, http.StatusOK)
	r.into(t, &sold)
	if sold.Status != "sold" {
		t.Fatalf("status = %s", sold.Status)
	}
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/sold", artist.Access, nil), http.StatusConflict)

	// заказ на создание принимается без оформления заказа и оплаты через площадку
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"accepts_commissions": true}), http.StatusOK)
	r = call(t, "POST", "/api/v1/commissions", buyer.Access, map[string]any{
		"artist_id": artist.ID, "description": "Пейзаж с маяком для гостиной, спокойные тона.", "category": "painting",
	})
	expect(t, r, http.StatusCreated)
	var c struct {
		ID      string  `json:"id"`
		Status  string  `json:"status"`
		OrderID *string `json:"order_id"`
	}
	r.into(t, &c)
	expect(t, call(t, "POST", "/api/v1/commissions/"+c.ID+"/quote", artist.Access, map[string]any{"price_kop": 20_000_00, "days": 14}), http.StatusOK)
	r = call(t, "POST", "/api/v1/commissions/"+c.ID+"/accept", buyer.Access, map[string]any{"expected_price_kop": 20_000_00})
	expect(t, r, http.StatusOK)
	r.into(t, &c)
	if c.Status != "accepted" || c.OrderID != nil {
		t.Fatalf("commission = %+v", c)
	}
}

// Премиум продвигает свежие работы художника в ленте «Новое».
func TestPremiumBoostsNewFeed(t *testing.T) {
	ctx := context.Background()
	premium := register(t, "artist")
	regular := register(t, "artist")
	boosted := publishArtwork(t, premium, "Работа премиум-художника", 9_000_00)
	fresh := publishArtwork(t, regular, "Свежая обычная работа", 9_000_00)
	if _, err := pool.Exec(ctx, `UPDATE users SET premium_until = now() + interval '30 days' WHERE id = $1`, premium.ID); err != nil {
		t.Fatal(err)
	}
	var items []artwork
	call(t, "GET", "/api/v1/artworks?feed=new&limit=50", "", nil).into(t, &items)
	pos := map[string]int{}
	for i, it := range items {
		pos[it.ID] = i + 1
	}
	if pos[boosted.ID] == 0 || pos[fresh.ID] == 0 || pos[boosted.ID] > pos[fresh.ID] {
		t.Fatalf("premium work should be above: premium=%d regular=%d", pos[boosted.ID], pos[fresh.ID])
	}
}

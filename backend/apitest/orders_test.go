package apitest

import (
	"context"
	"net/http"
	"testing"
)

var address = map[string]string{
	"city": "Москва", "street": "ул. Тверская, д. 1, кв. 5", "postal_code": "125009",
	"recipient_name": "Иван Покупатель", "phone": "+7 (900) 123-45-67",
}

type order struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	PriceKop      int64  `json:"price_kop"`
	DeliveryKop   int64  `json:"delivery_kop"`
	CommissionKop int64  `json:"commission_kop"`
	PayoutKop     int64  `json:"payout_kop"`
	TotalKop      int64  `json:"total_kop"`
	PayoutStatus  string `json:"payout_status"`
	MyRole        string `json:"my_role"`
	HasReview     bool   `json:"has_review"`
	Tracking      string `json:"tracking_number"`
	CancelReason  string `json:"cancel_reason"`
}

func createOrder(t *testing.T, buyer user, artworkID string) order {
	t.Helper()
	r := call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": artworkID, "delivery_method": "cdek", "address": address})
	expect(t, r, http.StatusCreated)
	var o order
	r.into(t, &o)
	return o
}

func payOrder(t *testing.T, buyer user, orderID string) {
	t.Helper()
	r := call(t, "POST", "/api/v1/orders/"+orderID+"/pay", buyer.Access, nil)
	expect(t, r, http.StatusCreated)
	var p struct {
		ID       string `json:"id"`
		TestMode bool   `json:"test_mode"`
	}
	r.into(t, &p)
	if !p.TestMode {
		t.Fatal("stub payments must report test_mode")
	}
	expect(t, call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", buyer.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", buyer.Access, nil), http.StatusConflict)
}

func getOrder(t *testing.T, u user, id string) order {
	t.Helper()
	r := call(t, "GET", "/api/v1/orders/"+id, u.Access, nil)
	expect(t, r, http.StatusOK)
	var o order
	r.into(t, &o)
	return o
}

func artworkStatus(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM artworks WHERE id=$1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestOrderHappyPath(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Полная сделка", 20_000_00)

	// валидация и запреты
	r := call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": map[string]string{"city": "М"}})
	expect(t, r, http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/orders", artist.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address}), http.StatusBadRequest)
	expect(t, call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "drone", "address": address}), http.StatusUnprocessableEntity)

	o := createOrder(t, buyer, a.ID)
	if o.Status != "awaiting_payment" || o.DeliveryKop != 500_00 || o.TotalKop != 20_500_00 || o.CommissionKop != 0 || o.MyRole != "buyer" {
		t.Fatalf("order %+v", o)
	}
	if artworkStatus(t, a.ID) != "reserved" {
		t.Fatal("artwork must be reserved")
	}
	// вторая покупка той же работы невозможна
	other := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/orders", other.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address}), http.StatusConflict)
	// посторонний не видит заказ и не может оплатить
	expect(t, call(t, "GET", "/api/v1/orders/"+o.ID, other.Access, nil), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/pay", other.Access, nil), http.StatusNotFound)
	// художник не может подтвердить неоплаченный
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/confirm", artist.Access, nil), http.StatusConflict)

	payOrder(t, buyer, o.ID)
	ao := getOrder(t, artist, o.ID)
	if ao.Status != "paid" || ao.PayoutStatus != "held" || ao.CommissionKop != 3_000_00 || ao.PayoutKop != 17_000_00 || ao.MyRole != "artist" {
		t.Fatalf("artist view %+v", ao)
	}
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/pay", buyer.Access, nil), http.StatusConflict)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/confirm", buyer.Access, nil), http.StatusForbidden)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/teleport", artist.Access, nil), http.StatusNotFound)

	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/confirm", artist.Access, nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/cancel", buyer.Access, nil), http.StatusForbidden)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/ship", artist.Access, map[string]string{"tracking_number": ""}), http.StatusUnprocessableEntity)
	r = call(t, "POST", "/api/v1/orders/"+o.ID+"/ship", artist.Access, map[string]string{"tracking_number": "CDEK-1234567"})
	expect(t, r, http.StatusOK)

	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/review", buyer.Access, map[string]any{"rating": 5}), http.StatusConflict)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/complete", artist.Access, nil), http.StatusForbidden)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/complete", buyer.Access, nil), http.StatusOK)

	done := getOrder(t, artist, o.ID)
	if done.Status != "completed" || done.PayoutStatus != "released" || done.Tracking != "CDEK-1234567" {
		t.Fatalf("completed %+v", done)
	}
	if artworkStatus(t, a.ID) != "sold" {
		t.Fatal("artwork must be sold")
	}

	// отзыв
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/review", buyer.Access, map[string]any{"rating": 7}), http.StatusUnprocessableEntity)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/review", artist.Access, map[string]any{"rating": 5}), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/review", buyer.Access, map[string]any{"rating": 5, "text": "Прекрасная работа!"}), http.StatusCreated)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/review", buyer.Access, map[string]any{"rating": 4}), http.StatusConflict)
	if !getOrder(t, buyer, o.ID).HasReview {
		t.Fatal("has_review")
	}
	r = call(t, "GET", "/api/v1/users/"+artist.ID+"/reviews", "", nil)
	var reviews []struct {
		Rating int `json:"rating"`
	}
	r.into(t, &reviews)
	if len(reviews) != 1 || reviews[0].Rating != 5 {
		t.Fatalf("reviews %+v", reviews)
	}

	// статистика художника
	r = call(t, "GET", "/api/v1/me/stats", artist.Access, nil)
	var st struct {
		SalesTotal      int64 `json:"sales_total"`
		RevenueMonthKop int64 `json:"revenue_month_kop"`
	}
	r.into(t, &st)
	if st.SalesTotal != 1 || st.RevenueMonthKop != 17_000_00 {
		t.Fatalf("stats %+v", st)
	}

	// списки заказов
	r = call(t, "GET", "/api/v1/orders?role=artist", artist.Access, nil)
	var list []order
	r.into(t, &list)
	if len(list) != 1 {
		t.Fatalf("artist orders %d", len(list))
	}
	r = call(t, "GET", "/api/v1/orders?status=completed", buyer.Access, nil)
	r.into(t, &list)
	if len(list) != 1 {
		t.Fatalf("buyer orders %d", len(list))
	}
	r = call(t, "GET", "/api/v1/orders?status=active", buyer.Access, nil)
	r.into(t, &list)
	if len(list) != 0 {
		t.Fatalf("active %d", len(list))
	}
	expect(t, call(t, "GET", "/api/v1/orders?role=admin", buyer.Access, nil), http.StatusBadRequest)

	// уведомления художника: оплата, завершение, отзыв
	r = call(t, "GET", "/api/v1/notifications", artist.Access, nil)
	var notes []struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	}
	r.into(t, &notes)
	if len(notes) < 3 || r.Meta["unread"].(float64) < 3 {
		t.Fatalf("notifications %+v meta %v", notes, r.Meta)
	}
	expect(t, call(t, "POST", "/api/v1/notifications/read", artist.Access, map[string]any{"ids": []string{notes[0].ID}}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/notifications/read", artist.Access, map[string]any{"ids": []string{"bad"}}), http.StatusBadRequest)
	expect(t, call(t, "POST", "/api/v1/notifications/read", artist.Access, nil), http.StatusNoContent)
	r = call(t, "GET", "/api/v1/notifications", artist.Access, nil)
	if r.Meta["unread"].(float64) != 0 {
		t.Fatalf("unread after read-all: %v", r.Meta)
	}
}

func TestOrderCancellations(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Отмены", 30_000_00)

	// отмена до оплаты — без возврата
	o := createOrder(t, buyer, a.ID)
	r := call(t, "POST", "/api/v1/orders/"+o.ID+"/cancel", buyer.Access, map[string]string{"reason": "Передумал"})
	expect(t, r, http.StatusOK)
	r.into(t, &o)
	if o.Status != "cancelled" || o.CancelReason != "Передумал" || artworkStatus(t, a.ID) != "published" {
		t.Fatalf("cancel unpaid %+v", o)
	}

	// отказ художника после оплаты — возврат
	o = createOrder(t, buyer, a.ID)
	payOrder(t, buyer, o.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/decline", artist.Access, nil), http.StatusOK)
	ao := getOrder(t, artist, o.ID)
	if ao.Status != "cancelled" || ao.PayoutStatus != "refunded" || ao.CancelReason == "" {
		t.Fatalf("decline %+v", ao)
	}
	var refunded int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM payments WHERE order_id=$1 AND status='refunded'`, o.ID).Scan(&refunded)
	if refunded != 1 {
		t.Fatal("payment must be refunded")
	}
	if artworkStatus(t, a.ID) != "published" {
		t.Fatal("artwork back on sale")
	}

	// покупатель отменяет оплаченный, но не подтверждённый
	o = createOrder(t, buyer, a.ID)
	payOrder(t, buyer, o.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/cancel", buyer.Access, nil), http.StatusOK)
	if getOrder(t, artist, o.ID).PayoutStatus != "refunded" {
		t.Fatal("refund on buyer cancel")
	}
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/cancel", buyer.Access, nil), http.StatusConflict)
}

func TestOrderDeadlines(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	ctx := context.Background()

	unpaid := createOrder(t, buyer, publishArtwork(t, artist, "Не оплачен", 10_000_00).ID)
	paid := createOrder(t, buyer, publishArtwork(t, artist, "Не подтверждён", 10_000_00).ID)
	payOrder(t, buyer, paid.ID)
	shipped := createOrder(t, buyer, publishArtwork(t, artist, "Не получен", 10_000_00).ID)
	payOrder(t, buyer, shipped.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+shipped.ID+"/confirm", artist.Access, nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+shipped.ID+"/ship", artist.Access, map[string]string{"tracking_number": "RU123456"}), http.StatusOK)

	exec(t, `UPDATE orders SET deadline_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, []string{unpaid.ID, paid.ID, shipped.ID})
	n, err := srv.ProcessDeadlines(ctx)
	if err != nil || n < 3 {
		t.Fatalf("processed %d, err %v", n, err)
	}
	if s := getOrder(t, buyer, unpaid.ID); s.Status != "cancelled" {
		t.Fatalf("unpaid: %s", s.Status)
	}
	if s := getOrder(t, artist, paid.ID); s.Status != "cancelled" || s.PayoutStatus != "refunded" {
		t.Fatalf("paid: %+v", s)
	}
	if s := getOrder(t, artist, shipped.ID); s.Status != "completed" || s.PayoutStatus != "released" {
		t.Fatalf("shipped: %+v", s)
	}
}

func TestPremiumSubscriptionZeroCommission(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/me/subscription", buyer.Access, nil), http.StatusForbidden)

	r := call(t, "POST", "/api/v1/me/subscription", artist.Access, nil)
	expect(t, r, http.StatusCreated)
	var p struct {
		ID        string `json:"id"`
		AmountKop int64  `json:"amount_kop"`
	}
	r.into(t, &p)
	if p.AmountKop != 990_00 {
		t.Fatalf("premium price %d", p.AmountKop)
	}
	expect(t, call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", buyer.Access, nil), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", artist.Access, nil), http.StatusNoContent)

	r = call(t, "GET", "/api/v1/me", artist.Access, nil)
	var me struct {
		IsPremium bool `json:"is_premium"`
	}
	r.into(t, &me)
	if !me.IsPremium {
		t.Fatal("premium not active")
	}

	a := publishArtwork(t, artist, "Премиум-продажа", 40_000_00)
	if !a.Artist.IsPremium {
		t.Fatal("artwork must show premium artist")
	}
	o := createOrder(t, buyer, a.ID)
	payOrder(t, buyer, o.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/confirm", artist.Access, nil), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/ship", artist.Access, map[string]string{"tracking_number": "RU999999"}), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+o.ID+"/complete", buyer.Access, nil), http.StatusOK)
	if c := getOrder(t, artist, o.ID).CommissionKop; c != 0 {
		t.Fatalf("premium commission = %d, want 0", c)
	}
	expect(t, call(t, "POST", "/api/v1/webhooks/payments", "", map[string]string{}), http.StatusNotImplemented)
}

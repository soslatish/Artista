package apitest

import (
	"context"
	"net/http"
	"testing"
)

func paymentStatus(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM payments WHERE id=$1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPayOrderReusesPendingPayment(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	o := createOrder(t, buyer, publishArtwork(t, artist, "Двойной клик", 10_000_00).ID)
	var p1, p2 struct {
		ID string `json:"id"`
	}
	call(t, "POST", "/api/v1/orders/"+o.ID+"/pay", buyer.Access, nil).into(t, &p1)
	call(t, "POST", "/api/v1/orders/"+o.ID+"/pay", buyer.Access, nil).into(t, &p2)
	if p1.ID == "" || p1.ID != p2.ID {
		t.Fatalf("second pay must return the same pending payment: %q %q", p1.ID, p2.ID)
	}
}

func TestLatePaymentAfterCancelIsRefunded(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	o := createOrder(t, buyer, publishArtwork(t, artist, "Поздняя оплата", 10_000_00).ID)
	var p struct {
		ID string `json:"id"`
	}
	call(t, "POST", "/api/v1/orders/"+o.ID+"/pay", buyer.Access, nil).into(t, &p)
	// заказ отменился (например, истёк срок), а провайдер прислал успех позже:
	// эмулируем «зависший» pending-платёж уже отменённого заказа
	exec(t, `UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1`, o.ID)
	r := call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", buyer.Access, nil)
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "order_cancelled" {
		t.Fatalf("code %s", r.Error.Code)
	}
	if st := paymentStatus(t, p.ID); st != "refunded" {
		t.Fatalf("late payment must be refunded, got %s", st)
	}
}

func TestRefundQueueRetries(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	o := createOrder(t, buyer, publishArtwork(t, artist, "Очередь возвратов", 10_000_00).ID)
	payOrder(t, buyer, o.ID)
	// возврат «упал» после отмены и остался в очереди
	exec(t, `UPDATE payments SET status='refund_pending', updated_at=now() - interval '5 minutes' WHERE order_id=$1`, o.ID)
	n, err := srv.ProcessRefunds(context.Background())
	if err != nil || n < 1 {
		t.Fatalf("refunds processed %d err %v", n, err)
	}
	var st string
	_ = pool.QueryRow(context.Background(), `SELECT status FROM payments WHERE order_id=$1`, o.ID).Scan(&st)
	if st != "refunded" {
		t.Fatalf("status %s", st)
	}
}

func TestUnpaidOrdersCap(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	for i := 0; i < 3; i++ {
		createOrder(t, buyer, publishArtwork(t, artist, "Резерв", 10_000_00).ID)
	}
	a := publishArtwork(t, artist, "Четвёртая", 10_000_00)
	r := call(t, "POST", "/api/v1/orders", buyer.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address})
	expect(t, r, http.StatusConflict)
	if r.Error.Code != "too_many_unpaid" {
		t.Fatalf("code %s", r.Error.Code)
	}
}

func TestResetCodesPerHourLimit(t *testing.T) {
	u := register(t, "buyer")
	for i := 0; i < 5; i++ {
		expect(t, call(t, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": u.Email}), http.StatusNoContent)
	}
	sent := 0
	for _, m := range mailer.Sent {
		if m.To == u.Email {
			sent++
		}
	}
	if sent != 3 {
		t.Fatalf("expected 3 reset mails per hour, got %d", sent)
	}
}

func TestLoginPerAccountLimit(t *testing.T) {
	u := register(t, "buyer")
	last := 0
	for i := 0; i < 11; i++ {
		last = call(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": u.Email, "password": "wrong-pass"}).Status
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("11th attempt status %d", last)
	}
}

func TestConversationRequiresPublicArtworkOfArtist(t *testing.T) {
	artist := register(t, "artist")
	other := register(t, "artist")
	buyer := register(t, "buyer")
	r := call(t, "POST", "/api/v1/artworks", artist.Access, artworkBody("Черновик", 10_000_00, nil, false))
	var draft artwork
	r.into(t, &draft)
	expect(t, call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID, "artwork_id": draft.ID}), http.StatusNotFound)
	pub := publishArtwork(t, other, "Чужая", 10_000_00)
	expect(t, call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID, "artwork_id": pub.ID}), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/conversations", buyer.Access, map[string]any{"user_id": artist.ID, "artwork_id": "00000000-0000-0000-0000-000000000000"}), http.StatusNotFound)
}

func TestRepublishDoesNotRenotifyFollowers(t *testing.T) {
	artist := register(t, "artist")
	fan := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/users/"+artist.ID+"/follow", fan.Access, nil), http.StatusNoContent)
	a := publishArtwork(t, artist, "Один раз", 9_000_00)
	srv.WaitBackground()
	expect(t, call(t, "DELETE", "/api/v1/artworks/"+a.ID, artist.Access, nil), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/publish", artist.Access, nil), http.StatusOK)
	srv.WaitBackground()
	var n int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE user_id=$1 AND type='new_artwork'`, fan.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("follower notified %d times, want 1", n)
	}
}

func TestLogoutRemovesDeviceToken(t *testing.T) {
	u := register(t, "buyer")
	expect(t, call(t, "POST", "/api/v1/me/devices", u.Access, map[string]string{"token": "ExponentPushToken[logout]", "platform": "android"}), http.StatusNoContent)
	expect(t, call(t, "POST", "/api/v1/auth/logout", "", map[string]string{"refresh_token": u.Refresh, "device_token": "ExponentPushToken[logout]"}), http.StatusNoContent)
	var n int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM device_tokens WHERE token='ExponentPushToken[logout]'`).Scan(&n)
	if n != 0 {
		t.Fatal("device token must be removed on logout")
	}
}

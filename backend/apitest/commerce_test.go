package apitest

import (
	"context"
	"net/http"
	"testing"
	"time"
)

type offer struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	AmountKop  int64  `json:"amount_kop"`
	CounterKop *int64 `json:"counter_kop"`
	AgreedKop  *int64 `json:"agreed_kop"`
	MyRole     string `json:"my_role"`
}

func offerCall(t *testing.T, u user, method, path string, body any, status int) offer {
	t.Helper()
	r := call(t, method, path, u.Access, body)
	expect(t, r, status)
	var o offer
	if status < 300 && len(r.Data) > 0 {
		r.into(t, &o)
	}
	return o
}

// completeOrder проводит оплаченный заказ до завершения и возвращает код сертификата из уведомления.
func completeOrder(t *testing.T, buyer, artist user, orderID string, shipBody map[string]any) string {
	t.Helper()
	payOrder(t, buyer, orderID)
	expect(t, call(t, "POST", "/api/v1/orders/"+orderID+"/confirm", artist.Access, nil), http.StatusOK)
	if shipBody == nil {
		shipBody = map[string]any{}
	}
	shipBody["tracking_number"] = "CDEK-12345"
	expect(t, call(t, "POST", "/api/v1/orders/"+orderID+"/ship", artist.Access, shipBody), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+orderID+"/complete", buyer.Access, nil), http.StatusOK)
	data := waitNotification(t, buyer, "certificate_issued")
	code, _ := data["certificate_code"].(string)
	if code == "" {
		t.Fatalf("no certificate code: %v", data)
	}
	return code
}

func TestOfferFlowCreatesOrderAtAgreedPrice(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	img := uploadImage(t, artist.Access)
	a := publishWith(t, artist, "Торг уместен", 20_000_00, img, map[string]any{"allow_offers": true})
	noOffers := publishArtwork(t, artist, "Без торга", 20_000_00)

	path := "/api/v1/artworks/" + a.ID + "/offers"
	offerCall(t, buyer, "POST", "/api/v1/artworks/"+noOffers.ID+"/offers", map[string]any{"amount_kop": 15_000_00}, http.StatusConflict)
	offerCall(t, artist, "POST", path, map[string]any{"amount_kop": 15_000_00}, http.StatusBadRequest)
	offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 9_000_00}, http.StatusUnprocessableEntity)
	offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 20_000_00}, http.StatusUnprocessableEntity)
	o := offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 15_000_00, "message": "Очень понравилась!"}, http.StatusCreated)
	if o.Status != "pending" || o.MyRole != "buyer" {
		t.Fatalf("offer = %+v", o)
	}
	offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 16_000_00}, http.StatusConflict) // уже есть открытое
	waitNotification(t, artist, "offer_new")

	// художник делает встречное, покупатель соглашается
	offerCall(t, artist, "POST", "/api/v1/offers/"+o.ID+"/counter", map[string]any{"amount_kop": 25_000_00}, http.StatusUnprocessableEntity)
	o = offerCall(t, artist, "POST", "/api/v1/offers/"+o.ID+"/counter", map[string]any{"amount_kop": 17_500_00}, http.StatusOK)
	if o.Status != "countered" || o.CounterKop == nil || *o.CounterKop != 17_500_00 {
		t.Fatalf("counter = %+v", o)
	}
	offerCall(t, buyer, "POST", "/api/v1/offers/"+o.ID+"/counter", map[string]any{"amount_kop": 16_000_00}, http.StatusConflict)
	o = offerCall(t, buyer, "POST", "/api/v1/offers/"+o.ID+"/accept", nil, http.StatusOK)
	if o.Status != "accepted" || o.AgreedKop == nil || *o.AgreedKop != 17_500_00 {
		t.Fatalf("accepted = %+v", o)
	}

	// заказ по согласованной цене; другой покупатель платит полную
	ord := createOrder(t, buyer, a.ID)
	if ord.PriceKop != 17_500_00 {
		t.Fatalf("order price = %d", ord.PriceKop)
	}
	o = offerCall(t, buyer, "GET", "/api/v1/offers/"+o.ID, nil, http.StatusOK)
	if o.Status != "used" {
		t.Fatalf("offer after order = %s", o.Status)
	}
	r := call(t, "GET", "/api/v1/offers?role=artist", artist.Access, nil)
	var list []offer
	r.into(t, &list)
	if len(list) != 1 || list[0].MyRole != "artist" {
		t.Fatalf("artist offers = %+v", list)
	}
}

func TestOfferDeclineWithdrawAndExpiry(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	img := uploadImage(t, artist.Access)
	a := publishWith(t, artist, "Отказ", 30_000_00, img, map[string]any{"allow_offers": true})
	path := "/api/v1/artworks/" + a.ID + "/offers"

	o := offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 20_000_00}, http.StatusCreated)
	offerCall(t, buyer, "POST", "/api/v1/offers/"+o.ID+"/decline", nil, http.StatusConflict) // покупатель не отклоняет своё
	o = offerCall(t, artist, "POST", "/api/v1/offers/"+o.ID+"/decline", nil, http.StatusOK)
	if o.Status != "declined" {
		t.Fatalf("declined = %s", o.Status)
	}

	o = offerCall(t, buyer, "POST", path, map[string]any{"amount_kop": 21_000_00}, http.StatusCreated)
	o = offerCall(t, artist, "POST", "/api/v1/offers/"+o.ID+"/accept", nil, http.StatusOK)
	o = offerCall(t, buyer, "POST", "/api/v1/offers/"+o.ID+"/withdraw", nil, http.StatusOK)
	if o.Status != "withdrawn" {
		t.Fatalf("withdrawn = %s", o.Status)
	}
	// после отзыва — обычная цена
	if ord := createOrder(t, buyer, a.ID); ord.PriceKop != 30_000_00 {
		t.Fatalf("price after withdraw = %d", ord.PriceKop)
	}

	// истечение срока
	b := publishWith(t, artist, "Истекает", 30_000_00, uploadImage(t, artist.Access), map[string]any{"allow_offers": true})
	o = offerCall(t, buyer, "POST", "/api/v1/artworks/"+b.ID+"/offers", map[string]any{"amount_kop": 20_000_00}, http.StatusCreated)
	exec(t, `UPDATE offers SET expires_at = now() - interval '1 minute' WHERE id = $1`, o.ID)
	offerCall(t, artist, "POST", "/api/v1/offers/"+o.ID+"/accept", nil, http.StatusConflict)
	if n, err := srv.ExpireOffers(context.Background()); err != nil || n < 1 {
		t.Fatalf("ExpireOffers = %d, %v", n, err)
	}
}

func TestAuctionFlow(t *testing.T) {
	artist := register(t, "artist")
	b1 := register(t, "buyer")
	b2 := register(t, "buyer")
	a := publishArtwork(t, artist, "Аукционная", 10_000_00)

	expect(t, call(t, "POST", "/api/v1/artworks/"+a.ID+"/auction", artist.Access, map[string]any{"start_kop": 10_000_00, "days": 9}), http.StatusUnprocessableEntity)
	r := call(t, "POST", "/api/v1/artworks/"+a.ID+"/auction", artist.Access, map[string]any{"start_kop": 10_000_00, "days": 3})
	expect(t, r, http.StatusCreated)
	var au struct {
		ID        string `json:"id"`
		StepKop   int64  `json:"step_kop"`
		MinBidKop int64  `json:"min_bid_kop"`
		IsLeader  bool   `json:"is_leader"`
		IWon      bool   `json:"i_won"`
		BidsCount int    `json:"bids_count"`
		Bids      []struct {
			Bidder string `json:"bidder"`
			IsMine bool   `json:"is_mine"`
		} `json:"bids"`
	}
	r.into(t, &au)
	if au.StepKop != 500_00 || au.MinBidKop != 10_000_00 || artworkStatus(t, a.ID) != "auction" {
		t.Fatalf("auction = %+v", au)
	}
	// купить напрямую нельзя
	r = call(t, "POST", "/api/v1/orders", b1.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address})
	expect(t, r, http.StatusConflict)

	bid := func(u user, amount int64, status int) {
		t.Helper()
		expect(t, call(t, "POST", "/api/v1/auctions/"+au.ID+"/bids", u.Access, map[string]any{"amount_kop": amount}), status)
	}
	bid(artist, 10_000_00, http.StatusBadRequest)
	bid(b1, 9_000_00, http.StatusUnprocessableEntity)
	bid(b1, 10_000_00, http.StatusCreated)
	bid(b1, 11_000_00, http.StatusConflict) // уже лидер
	bid(b2, 10_400_00, http.StatusUnprocessableEntity)
	bid(b2, 10_500_00, http.StatusCreated)
	waitNotification(t, b1, "auction_outbid")
	bid(b1, 12_000_00, http.StatusCreated)

	r = call(t, "GET", "/api/v1/auctions/"+au.ID, b1.Access, nil)
	r.into(t, &au)
	if !au.IsLeader || au.BidsCount != 3 || len(au.Bids) != 3 || au.Bids[0].Bidder != "Участник 1" || !au.Bids[0].IsMine {
		t.Fatalf("auction state = %+v", au)
	}
	expect(t, call(t, "POST", "/api/v1/auctions/"+au.ID+"/cancel", artist.Access, nil), http.StatusConflict)

	// ставка в последние минуты продлевает торги
	exec(t, `UPDATE auctions SET ends_at = now() + interval '1 minute' WHERE id = $1`, au.ID)
	bid(b2, 13_000_00, http.StatusCreated)
	var ends time.Time
	if err := pool.QueryRow(context.Background(), `SELECT ends_at FROM auctions WHERE id = $1`, au.ID).Scan(&ends); err != nil {
		t.Fatal(err)
	}
	if time.Until(ends) < 4*time.Minute {
		t.Fatalf("anti-snipe did not extend: %v", time.Until(ends))
	}

	// закрытие: победитель получает бронь и оформляет заказ по итоговой ставке
	exec(t, `UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, au.ID)
	if n, err := srv.CloseAuctions(context.Background()); err != nil || n != 1 {
		t.Fatalf("CloseAuctions = %d, %v", n, err)
	}
	if artworkStatus(t, a.ID) != "reserved" {
		t.Fatalf("status after auction = %s", artworkStatus(t, a.ID))
	}
	waitNotification(t, b2, "auction_won")
	r = call(t, "GET", "/api/v1/auctions/"+au.ID, b2.Access, nil)
	r.into(t, &au)
	if !au.IWon {
		t.Fatal("b2 should be the winner")
	}
	expect(t, call(t, "POST", "/api/v1/orders", b1.Access, map[string]any{"artwork_id": a.ID, "delivery_method": "cdek", "address": address}), http.StatusConflict)
	ord := createOrder(t, b2, a.ID)
	if ord.PriceKop != 13_000_00 {
		t.Fatalf("auction order price = %d", ord.PriceKop)
	}
}

func TestAuctionWithoutBidsAndExpiredWinner(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "Без ставок", 10_000_00)
	r := call(t, "POST", "/api/v1/artworks/"+a.ID+"/auction", artist.Access, map[string]any{"start_kop": 8_000_00, "days": 1})
	expect(t, r, http.StatusCreated)
	var au struct{ ID string }
	r.into(t, &au)
	expect(t, call(t, "POST", "/api/v1/auctions/"+au.ID+"/cancel", artist.Access, nil), http.StatusNoContent)
	if artworkStatus(t, a.ID) != "published" {
		t.Fatal("cancelled auction should return artwork to sale")
	}

	r = call(t, "POST", "/api/v1/artworks/"+a.ID+"/auction", artist.Access, map[string]any{"start_kop": 8_000_00, "days": 1})
	expect(t, r, http.StatusCreated)
	r.into(t, &au)
	expect(t, call(t, "POST", "/api/v1/auctions/"+au.ID+"/bids", buyer.Access, map[string]any{"amount_kop": 8_000_00}), http.StatusCreated)
	exec(t, `UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, au.ID)
	if _, err := srv.CloseAuctions(context.Background()); err != nil {
		t.Fatal(err)
	}
	// победитель не оформил заказ за 48 часов — работа снова в продаже
	exec(t, `UPDATE price_locks SET expires_at = now() - interval '1 second' WHERE source_id = $1`, au.ID)
	if n, err := srv.ReleaseExpiredLocks(context.Background()); err != nil || n != 1 {
		t.Fatalf("ReleaseExpiredLocks = %d, %v", n, err)
	}
	if artworkStatus(t, a.ID) != "published" {
		t.Fatalf("status = %s", artworkStatus(t, a.ID))
	}
}

func TestCommissionFlowWithCertificate(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	friend := register(t, "buyer")
	body := map[string]any{
		"artist_id": artist.ID, "description": "Портрет моей собаки по фото, тёплые тона, без фона.",
		"category": "painting", "width_cm": 30, "height_cm": 40, "budget_kop": 15_000_00, "desired_by": time.Now().AddDate(0, 1, 0).Format("2006-01-02"),
	}
	r := call(t, "POST", "/api/v1/commissions", buyer.Access, body)
	expect(t, r, http.StatusConflict) // художник не принимает заказы
	expect(t, call(t, "PATCH", "/api/v1/me", artist.Access, map[string]any{"accepts_commissions": true, "commission_note": "Портреты от 10 000 ₽"}), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/commissions", buyer.Access, map[string]any{"artist_id": artist.ID, "description": "коротко", "category": "painting"}), http.StatusUnprocessableEntity)
	r = call(t, "POST", "/api/v1/commissions", buyer.Access, body)
	expect(t, r, http.StatusCreated)
	var c struct {
		ID             string  `json:"id"`
		Status         string  `json:"status"`
		ConversationID *string `json:"conversation_id"`
		OrderID        *string `json:"order_id"`
	}
	r.into(t, &c)
	if c.Status != "requested" || c.ConversationID == nil {
		t.Fatalf("commission = %+v", c)
	}
	waitNotification(t, artist, "commission_new")
	// запрос продублирован в чат
	r = call(t, "GET", "/api/v1/conversations/"+*c.ConversationID+"/messages", artist.Access, nil)
	var msgs []struct{ Body string }
	r.into(t, &msgs)
	if len(msgs) != 1 {
		t.Fatalf("messages = %+v", msgs)
	}

	act := func(u user, action string, body any, status int) {
		t.Helper()
		r := call(t, "POST", "/api/v1/commissions/"+c.ID+"/"+action, u.Access, body)
		expect(t, r, status)
		if status == http.StatusOK {
			r.into(t, &c)
		}
	}
	act(buyer, "quote", map[string]any{"price_kop": 12_000_00, "days": 14}, http.StatusConflict)
	act(artist, "quote", map[string]any{"price_kop": 12_000_00, "days": 200}, http.StatusUnprocessableEntity)
	act(artist, "quote", map[string]any{"price_kop": 12_000_00, "days": 14, "note": "Эскиз пришлю через 3 дня"}, http.StatusOK)
	if c.Status != "quoted" {
		t.Fatalf("status = %s", c.Status)
	}
	act(buyer, "accept", map[string]any{"delivery_method": "cdek", "address": address}, http.StatusOK)
	if c.Status != "accepted" || c.OrderID == nil {
		t.Fatalf("accepted = %+v", c)
	}
	ord := getOrder(t, buyer, *c.OrderID)
	if ord.PriceKop != 12_000_00 {
		t.Fatalf("commission order price = %d", ord.PriceKop)
	}
	// работа на заказ не в каталоге
	var artworkID string
	if err := pool.QueryRow(context.Background(), `SELECT artwork_id FROM orders WHERE id = $1`, *c.OrderID).Scan(&artworkID); err != nil {
		t.Fatal(err)
	}
	expect(t, call(t, "GET", "/api/v1/artworks/"+artworkID, "", nil), http.StatusNotFound)

	// срок отправки — из предложения художника (14 дней + запас)
	payOrder(t, buyer, *c.OrderID)
	expect(t, call(t, "POST", "/api/v1/orders/"+*c.OrderID+"/confirm", artist.Access, nil), http.StatusOK)
	var deadline time.Time
	if err := pool.QueryRow(context.Background(), `SELECT deadline_at FROM orders WHERE id = $1`, *c.OrderID).Scan(&deadline); err != nil {
		t.Fatal(err)
	}
	if d := time.Until(deadline); d < 15*24*time.Hour || d > 17*24*time.Hour {
		t.Fatalf("ship deadline in %v", d)
	}
	photo := uploadImage(t, artist.Access)
	expect(t, call(t, "POST", "/api/v1/orders/"+*c.OrderID+"/ship", artist.Access, map[string]any{"tracking_number": "CDEK-777", "images": []string{photo}}), http.StatusOK)
	expect(t, call(t, "POST", "/api/v1/orders/"+*c.OrderID+"/complete", buyer.Access, nil), http.StatusOK)
	data := waitNotification(t, buyer, "certificate_issued")
	code := data["certificate_code"].(string)
	if artworkStatus(t, artworkID) != "commission" {
		t.Fatalf("commission artwork status = %s", artworkStatus(t, artworkID))
	}

	// сертификат: публичная проверка и передача
	r = call(t, "GET", "/api/v1/certificates/"+code, "", nil)
	expect(t, r, http.StatusOK)
	var cert struct {
		Code    string `json:"code"`
		Owner   string `json:"owner"`
		IsMine  bool   `json:"is_mine"`
		QRPNG   string `json:"qr_png"`
		History []struct {
			Owner  string `json:"owner"`
			Status string `json:"status"`
		} `json:"history"`
		Artwork struct {
			ImageURL string `json:"image_url"`
		} `json:"artwork"`
	}
	r.into(t, &cert)
	if cert.Code != code || cert.IsMine || len(cert.History) != 1 || len(cert.QRPNG) < 100 || cert.Artwork.ImageURL != photo {
		t.Fatalf("certificate = %+v", cert)
	}
	expect(t, call(t, "POST", "/api/v1/certificates/"+code+"/transfer", friend.Access, map[string]any{"email": buyer.Email}), http.StatusNotFound)
	expect(t, call(t, "POST", "/api/v1/certificates/"+code+"/transfer", buyer.Access, map[string]any{"email": "nobody@test.ru"}), http.StatusUnprocessableEntity)
	r = call(t, "POST", "/api/v1/certificates/"+code+"/transfer", buyer.Access, map[string]any{"email": friend.Email})
	expect(t, r, http.StatusOK)
	var tr struct{ Code string }
	r.into(t, &tr)
	r = call(t, "GET", "/api/v1/certificates/"+tr.Code, friend.Access, nil)
	r.into(t, &cert)
	if !cert.IsMine || len(cert.History) != 2 || cert.History[0].Status != "transferred" {
		t.Fatalf("transferred certificate = %+v", cert)
	}
	r = call(t, "GET", "/api/v1/me/certificates", buyer.Access, nil)
	var mine []struct{ Code string }
	r.into(t, &mine)
	if len(mine) != 0 {
		t.Fatalf("buyer still owns: %+v", mine)
	}
	res, err := http.Get(ts.URL + "/api/v1/certificates/" + tr.Code + "/qr.png")
	if err != nil || res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("qr.png: %v %v", res, err)
	}
	res.Body.Close()
}

func TestRegularSaleIssuesCertificate(t *testing.T) {
	artist := register(t, "artist")
	buyer := register(t, "buyer")
	a := publishArtwork(t, artist, "С сертификатом", 9_000_00)
	ord := createOrder(t, buyer, a.ID)
	code := completeOrder(t, buyer, artist, ord.ID, nil)
	r := call(t, "GET", "/api/v1/me/certificates", buyer.Access, nil)
	var mine []struct{ Code string }
	r.into(t, &mine)
	if len(mine) != 1 || mine[0].Code != code {
		t.Fatalf("certificates = %+v", mine)
	}
	// фото к обычному заказу при отправке не прикладываются
	b := publishArtwork(t, artist, "Без фото при отправке", 9_000_00)
	o2 := createOrder(t, buyer, b.ID)
	payOrder(t, buyer, o2.ID)
	expect(t, call(t, "POST", "/api/v1/orders/"+o2.ID+"/confirm", artist.Access, nil), http.StatusOK)
	photo := uploadImage(t, artist.Access)
	expect(t, call(t, "POST", "/api/v1/orders/"+o2.ID+"/ship", artist.Access, map[string]any{"tracking_number": "CDEK-1", "images": []string{photo}}), http.StatusUnprocessableEntity)
}

func TestPromotion(t *testing.T) {
	artist := register(t, "artist")
	plain := publishArtwork(t, artist, "Обычная", 9_000_00)
	promo := publishArtwork(t, artist, "Продвигаемая", 9_000_00)
	_ = plain
	expect(t, call(t, "POST", "/api/v1/artworks/"+promo.ID+"/promote", artist.Access, map[string]any{"days": 5}), http.StatusUnprocessableEntity)
	r := call(t, "POST", "/api/v1/artworks/"+promo.ID+"/promote", artist.Access, map[string]any{"days": 7})
	expect(t, r, http.StatusCreated)
	var p struct {
		ID        string `json:"id"`
		AmountKop int64  `json:"amount_kop"`
	}
	r.into(t, &p)
	if p.AmountKop != 399_00 {
		t.Fatalf("promotion price = %d", p.AmountKop)
	}
	expect(t, call(t, "POST", "/api/v1/payments/"+p.ID+"/stub-confirm", artist.Access, nil), http.StatusNoContent)

	ids := listIDs(t, "/api/v1/artworks?artist_id="+artist.ID, "")
	if len(ids) != 2 || ids[0] != promo.ID {
		t.Fatalf("promoted not first: %v", ids)
	}
	r = call(t, "GET", "/api/v1/me/promotions", artist.Access, nil)
	var list []struct {
		Status string `json:"status"`
		Days   int    `json:"days"`
	}
	r.into(t, &list)
	if len(list) != 1 || list[0].Status != "active" || list[0].Days != 7 {
		t.Fatalf("promotions = %+v", list)
	}
	// чужую работу продвигать нельзя
	other := register(t, "artist")
	expect(t, call(t, "POST", "/api/v1/artworks/"+promo.ID+"/promote", other.Access, map[string]any{"days": 3}), http.StatusNotFound)
}

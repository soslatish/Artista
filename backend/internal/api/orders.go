package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
	"github.com/soslatish/artista/backend/internal/providers"
)

// Address — адрес доставки.
type Address struct {
	City          string `json:"city"`
	Street        string `json:"street"`
	PostalCode    string `json:"postal_code"`
	RecipientName string `json:"recipient_name"`
	Phone         string `json:"phone"`
	Comment       string `json:"comment"`
}

func (a Address) validate() map[string]string {
	errs := map[string]string{}
	check := func(field, val string, minLen, maxLen int, msg string) {
		if n := utf8.RuneCountInString(strings.TrimSpace(val)); n < minLen || n > maxLen {
			errs["address."+field] = msg
		}
	}
	check("city", a.City, 2, 80, "Укажите город")
	check("street", a.Street, 5, 200, "Укажите улицу, дом и квартиру")
	check("recipient_name", a.RecipientName, 2, 80, "Укажите получателя")
	check("comment", a.Comment, 0, 300, "Комментарий — до 300 символов")
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, a.Phone)
	if len(digits) < 10 || len(digits) > 15 {
		errs["address.phone"] = "Укажите телефон"
	}
	if a.PostalCode != "" && (len(a.PostalCode) != 6 || strings.Trim(a.PostalCode, "0123456789") != "") {
		errs["address.postal_code"] = "Индекс — 6 цифр"
	}
	return errs
}

type orderArtwork struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
}

type party struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// orderDTO — заказ для клиента.
type orderDTO struct {
	ID             string       `json:"id"`
	Status         string       `json:"status"`
	PriceKop       int64        `json:"price_kop"`
	DeliveryKop    int64        `json:"delivery_kop"`
	CommissionKop  int64        `json:"commission_kop,omitempty"`
	PayoutKop      int64        `json:"payout_kop,omitempty"`
	TotalKop       int64        `json:"total_kop"`
	DeliveryMethod string       `json:"delivery_method"`
	Address        Address      `json:"address"`
	TrackingNumber string       `json:"tracking_number"`
	PayoutStatus   string       `json:"payout_status,omitempty"`
	CancelReason   string       `json:"cancel_reason"`
	DeadlineAt     *time.Time   `json:"deadline_at"`
	Artwork        orderArtwork `json:"artwork"`
	Buyer          party        `json:"buyer"`
	Artist         party        `json:"artist"`
	MyRole         string       `json:"my_role"`
	HasReview      bool         `json:"has_review"`
	PaidAt         *time.Time   `json:"paid_at"`
	ConfirmedAt    *time.Time   `json:"confirmed_at"`
	ShippedAt      *time.Time   `json:"shipped_at"`
	CompletedAt    *time.Time   `json:"completed_at"`
	CancelledAt    *time.Time   `json:"cancelled_at"`
	CreatedAt      time.Time    `json:"created_at"`
}

const orderSelect = `SELECT o.id, o.status, o.price_kop, o.delivery_kop, o.commission_kop, o.total_kop, o.delivery_method,
	o.address, o.tracking_number, o.payout_status, o.cancel_reason, o.deadline_at,
	a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''),
	b.id, b.name, b.avatar_url, ar.id, ar.name, ar.avatar_url,
	EXISTS(SELECT 1 FROM reviews WHERE order_id = o.id),
	o.paid_at, o.confirmed_at, o.shipped_at, o.completed_at, o.cancelled_at, o.created_at
FROM orders o
JOIN artworks a ON a.id = o.artwork_id
JOIN users b ON b.id = o.buyer_id
JOIN users ar ON ar.id = o.artist_id `

func scanOrder(row pgx.Row, viewerID string) (orderDTO, error) {
	var o orderDTO
	err := row.Scan(&o.ID, &o.Status, &o.PriceKop, &o.DeliveryKop, &o.CommissionKop, &o.TotalKop, &o.DeliveryMethod,
		&o.Address, &o.TrackingNumber, &o.PayoutStatus, &o.CancelReason, &o.DeadlineAt,
		&o.Artwork.ID, &o.Artwork.Title, &o.Artwork.ImageURL,
		&o.Buyer.ID, &o.Buyer.Name, &o.Buyer.AvatarURL, &o.Artist.ID, &o.Artist.Name, &o.Artist.AvatarURL,
		&o.HasReview, &o.PaidAt, &o.ConfirmedAt, &o.ShippedAt, &o.CompletedAt, &o.CancelledAt, &o.CreatedAt)
	if err != nil {
		return o, err
	}
	if viewerID == o.Artist.ID {
		o.MyRole = "artist"
		o.PayoutKop = o.PriceKop - o.CommissionKop
	} else {
		// покупатель не видит комиссию и выплату художнику
		o.MyRole = "buyer"
		o.CommissionKop, o.PayoutStatus = 0, ""
	}
	return o, nil
}

func loadOrder(ctx context.Context, q querier, id, viewerID string) (orderDTO, error) {
	o, err := scanOrder(q.QueryRow(ctx, orderSelect+`WHERE o.id = $1 AND (o.buyer_id = $2 OR o.artist_id = $2)`, id, viewerID), viewerID)
	if isNoRows(err) {
		return o, httpx.NotFound("Заказ не найден")
	}
	return o, err
}

// maxUnpaidOrders — сколько неоплаченных заказов может держать покупатель (защита от резервирования каталога).
const maxUnpaidOrders = 3

func (s *Server) createOrder(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		ArtworkID      string  `json:"artwork_id"`
		DeliveryMethod string  `json:"delivery_method"`
		Address        Address `json:"address"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if !isUUID(in.ArtworkID) {
		return httpx.Validation(map[string]string{"artwork_id": "Не выбрана работа"})
	}
	if errs := in.Address.validate(); len(errs) > 0 {
		return httpx.Validation(errs)
	}
	var orderID, artistID, title string
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var unpaid int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM orders WHERE buyer_id = $1 AND status = 'awaiting_payment'`, u.ID).Scan(&unpaid); err != nil {
			return err
		}
		if unpaid >= maxUnpaidOrders {
			return httpx.Conflict("too_many_unpaid", "Сначала оплатите или отмените неоплаченные заказы")
		}
		var status string
		var price int64
		var wcm, hcm, dcm float64
		err := tx.QueryRow(r.Context(), `SELECT artist_id, status, price_kop, title, width_cm::float8, height_cm::float8, depth_cm::float8
			FROM artworks WHERE id = $1 FOR UPDATE`, in.ArtworkID).Scan(&artistID, &status, &price, &title, &wcm, &hcm, &dcm)
		if isNoRows(err) {
			return httpx.NotFound("Работа не найдена")
		}
		if err != nil {
			return err
		}
		if artistID == u.ID {
			return httpx.BadRequest("Нельзя купить свою работу")
		}
		if status != "published" {
			return httpx.Conflict("artwork_unavailable", "Работа уже зарезервирована или продана")
		}
		quote, err := domain.QuoteDelivery(domain.DeliveryMethod(in.DeliveryMethod), in.Address.City, price, domain.MaxSide(wcm, hcm, dcm))
		if err != nil {
			return httpx.Validation(map[string]string{"delivery_method": deliveryErrorText(err)})
		}
		premium, err := isPremiumActive(r.Context(), tx, artistID)
		if err != nil {
			return err
		}
		monthSales, err := artistMonthSales(r.Context(), tx, artistID)
		if err != nil {
			return err
		}
		commission := domain.Commission(price, premium, monthSales)
		addr, _ := json.Marshal(in.Address)
		err = tx.QueryRow(r.Context(), `INSERT INTO orders (buyer_id, artist_id, artwork_id, price_kop, delivery_kop, commission_kop,
				total_kop, delivery_method, address, deadline_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
			u.ID, artistID, in.ArtworkID, price, quote.PriceKop, commission, price+quote.PriceKop,
			in.DeliveryMethod, addr, domain.DeadlineFor(domain.StatusAwaitingPayment, time.Now())).Scan(&orderID)
		if isUniqueViolation(err) {
			return httpx.Conflict("artwork_unavailable", "Работа уже зарезервирована")
		}
		if err != nil {
			return fmt.Errorf("insert order: %w", err)
		}
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET status = 'reserved', updated_at = now() WHERE id = $1`, in.ArtworkID)
		return err
	})
	if err != nil {
		return err
	}
	o, err := loadOrder(r.Context(), s.DB, orderID, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, o, nil)
	return nil
}

func artistMonthSales(ctx context.Context, q querier, artistID string) (int64, error) {
	var sum int64
	err := q.QueryRow(ctx, `SELECT coalesce(sum(price_kop), 0) FROM orders
		WHERE artist_id = $1 AND status = 'completed' AND completed_at >= date_trunc('month', now())`, artistID).Scan(&sum)
	return sum, err
}

func (s *Server) listOrders(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	role := r.URL.Query().Get("role")
	col := "o.buyer_id"
	if role == "artist" {
		col = "o.artist_id"
	} else if role != "" && role != "buyer" {
		return httpx.BadRequest("role: buyer или artist")
	}
	args := []any{u.ID}
	cond := col + " = $1"
	if st := r.URL.Query().Get("status"); st != "" {
		if st == "active" {
			cond += " AND o.status IN ('awaiting_payment','paid','confirmed','shipped')"
		} else {
			args = append(args, st)
			cond += " AND o.status = $2"
		}
	}
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf("%s WHERE %s ORDER BY o.created_at DESC LIMIT %d OFFSET %d",
		orderSelect, cond, p.limit, p.offset), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []orderDTO{}
	for rows.Next() {
		o, err := scanOrder(rows, u.ID)
		if err != nil {
			return err
		}
		items = append(items, o)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) getOrder(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	o, err := loadOrder(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, o)
	return nil
}

// orderAction — переходы, инициируемые участниками: confirm, decline, ship, complete, cancel.
func (s *Server) orderAction(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	action := domain.OrderAction(r.PathValue("action"))
	switch action {
	case domain.ActionConfirm, domain.ActionDecline, domain.ActionShip, domain.ActionComplete, domain.ActionCancel:
	default:
		return httpx.NotFound("Неизвестное действие")
	}
	var in struct {
		TrackingNumber string `json:"tracking_number"`
		Reason         string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	if action == domain.ActionShip {
		if n := utf8.RuneCountInString(strings.TrimSpace(in.TrackingNumber)); n < 4 || n > 40 {
			return httpx.Validation(map[string]string{"tracking_number": "Укажите трек-номер"})
		}
	}
	if utf8.RuneCountInString(in.Reason) > 300 {
		return httpx.Validation(map[string]string{"reason": "Причина — до 300 символов"})
	}
	req := transitionReq{orderID: id, action: action, userID: u.ID, tracking: strings.TrimSpace(in.TrackingNumber), reason: strings.TrimSpace(in.Reason)}
	if err := s.transition(r.Context(), req); err != nil {
		return err
	}
	o, err := loadOrder(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, o)
	return nil
}

// transitionReq — запрос на смену статуса. Пустой userID — действует система.
type transitionReq struct {
	orderID  string
	action   domain.OrderAction
	userID   string
	tracking string
	reason   string
	// timeout: переход по истечении срока; выполняется, только если под блокировкой
	// статус всё ещё expect и срок действительно истёк (иначе errStale).
	timeout bool
	expect  domain.OrderStatus
}

// errStale — заказ изменился после выборки воркером; переход пропускается.
var errStale = errors.New("order changed since it was selected")

// transition применяет действие к заказу.
func (s *Server) transition(ctx context.Context, req transitionReq) error {
	var effects orderEffects
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var err error
		effects, err = s.transitionTx(ctx, tx, req)
		return err
	})
	if err != nil {
		return err
	}
	s.applyEffects(ctx, effects)
	return nil
}

// orderEffects — действия после коммита (возвраты и уведомления).
type orderEffects struct {
	orderID, buyerID, artistID, title string
	to                                domain.OrderStatus
	refundPaymentID                   string
}

func (s *Server) transitionTx(ctx context.Context, tx pgx.Tx, req transitionReq) (orderEffects, error) {
	var e orderEffects
	var from domain.OrderStatus
	var artworkID string
	var price int64
	var deadline *time.Time
	err := tx.QueryRow(ctx, `SELECT o.buyer_id, o.artist_id, o.artwork_id, o.status, o.price_kop, o.deadline_at, a.title
		FROM orders o JOIN artworks a ON a.id = o.artwork_id WHERE o.id = $1 FOR UPDATE OF o`, req.orderID).
		Scan(&e.buyerID, &e.artistID, &artworkID, &from, &price, &deadline, &e.title)
	if isNoRows(err) {
		return e, httpx.NotFound("Заказ не найден")
	}
	if err != nil {
		return e, err
	}
	if req.timeout && (from != req.expect || deadline == nil || deadline.After(time.Now())) {
		return e, errStale
	}
	actor := domain.ActorSystem
	switch req.userID {
	case "":
	case e.buyerID:
		actor = domain.ActorBuyer
	case e.artistID:
		actor = domain.ActorArtist
	default:
		return e, httpx.NotFound("Заказ не найден")
	}
	to, err := domain.NextStatus(from, req.action, actor)
	if errors.Is(err, domain.ErrInvalidTransition) {
		return e, httpx.Conflict("invalid_transition", "Это действие недоступно для заказа в текущем статусе")
	}
	if err != nil {
		return e, httpx.Forbidden("Это действие вам недоступно")
	}
	e.orderID, e.to = req.orderID, to
	next := domain.DeadlineFor(to, time.Now())

	switch to {
	case domain.StatusPaid:
		_, err = tx.Exec(ctx, `UPDATE orders SET status=$2, paid_at=now(), payout_status='held', deadline_at=$3, updated_at=now() WHERE id=$1`, req.orderID, to, next)
	case domain.StatusConfirmed:
		_, err = tx.Exec(ctx, `UPDATE orders SET status=$2, confirmed_at=now(), deadline_at=$3, updated_at=now() WHERE id=$1`, req.orderID, to, next)
	case domain.StatusShipped:
		_, err = tx.Exec(ctx, `UPDATE orders SET status=$2, shipped_at=now(), tracking_number=$4, deadline_at=$3, updated_at=now() WHERE id=$1`, req.orderID, to, next, req.tracking)
	case domain.StatusCompleted:
		err = s.completeTx(ctx, tx, req.orderID, e.artistID, artworkID, price)
	case domain.StatusCancelled:
		err = s.cancelTx(ctx, tx, &e, from, artworkID, actor, req.reason)
	}
	return e, err
}

func (s *Server) completeTx(ctx context.Context, tx pgx.Tx, orderID, artistID, artworkID string, price int64) error {
	// блокируем художника: параллельные завершения не должны оба уложиться в лимит премиума
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, artistID); err != nil {
		return err
	}
	// комиссия пересчитывается на момент продажи (лимит премиума — по завершённым продажам месяца)
	premium, err := isPremiumActive(ctx, tx, artistID)
	if err != nil {
		return err
	}
	monthSales, err := artistMonthSales(ctx, tx, artistID)
	if err != nil {
		return err
	}
	commission := domain.Commission(price, premium, monthSales)
	if _, err := tx.Exec(ctx, `UPDATE orders SET status='completed', completed_at=now(), commission_kop=$2,
			payout_status='released', deadline_at=NULL, updated_at=now() WHERE id=$1`, orderID, commission); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE artworks SET status='sold', updated_at=now() WHERE id=$1`, artworkID)
	return err
}

// cancelTx отменяет заказ. Возврат денег ставится в очередь (refund_pending) в этой же
// транзакции — его выполнит refundPayment сразу после коммита или воркер с повторами.
func (s *Server) cancelTx(ctx context.Context, tx pgx.Tx, e *orderEffects, from domain.OrderStatus, artworkID string, actor domain.Actor, reason string) error {
	payout := "none"
	if domain.NeedsRefund(from) {
		payout = "refunded"
		err := tx.QueryRow(ctx, `UPDATE payments SET status='refund_pending', updated_at=now()
			WHERE order_id=$1 AND status='succeeded' RETURNING id`, e.orderID).Scan(&e.refundPaymentID)
		if err != nil && !isNoRows(err) {
			return err
		}
	}
	if reason == "" {
		reason = defaultCancelReason(actor, from)
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='cancelled', updated_at=now() WHERE order_id=$1 AND status='pending'`, e.orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET status='cancelled', cancelled_at=now(), cancel_reason=$2, payout_status=$3,
			deadline_at=NULL, updated_at=now() WHERE id=$1`, e.orderID, reason, payout); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE artworks SET status='published', updated_at=now() WHERE id=$1 AND status='reserved'`, artworkID)
	return err
}

func defaultCancelReason(actor domain.Actor, from domain.OrderStatus) string {
	switch {
	case actor == domain.ActorArtist:
		return "Художник отказался от заказа"
	case actor == domain.ActorBuyer:
		return "Отменён покупателем"
	case from == domain.StatusAwaitingPayment:
		return "Заказ не оплачен вовремя"
	case from == domain.StatusPaid:
		return "Художник не подтвердил заказ за 24 часа"
	default:
		return "Художник не отправил работу за 48 часов"
	}
}

// effectsTimeout — сколько даём на возврат и уведомления после коммита.
const effectsTimeout = 30 * time.Second

// applyEffects выполняет действия после коммита. Контекст запроса отвязывается от отмены:
// если клиент отключился, возврат и уведомления всё равно должны пройти.
func (s *Server) applyEffects(ctx context.Context, e orderEffects) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), effectsTimeout)
	defer cancel()
	if e.refundPaymentID != "" {
		if err := s.refundPayment(ctx, e.refundPaymentID); err != nil {
			s.Log.Warn("refund deferred to worker", "payment_id", e.refundPaymentID, "err", err)
		}
	}
	data := map[string]any{"order_id": e.orderID}
	switch e.to {
	case domain.StatusPaid:
		s.notify(ctx, e.artistID, "order_paid", "Новый заказ", fmt.Sprintf("«%s» оплачена. Подтвердите заказ в течение 24 часов.", e.title), data)
	case domain.StatusConfirmed:
		s.notify(ctx, e.buyerID, "order_confirmed", "Заказ подтверждён", fmt.Sprintf("Художник готовит «%s» к отправке.", e.title), data)
	case domain.StatusShipped:
		s.notify(ctx, e.buyerID, "order_shipped", "Заказ отправлен", fmt.Sprintf("«%s» в пути. Подтвердите получение, когда заберёте посылку.", e.title), data)
	case domain.StatusCompleted:
		s.notify(ctx, e.artistID, "order_completed", "Продажа завершена", fmt.Sprintf("Покупатель получил «%s». Выплата переведена.", e.title), data)
	case domain.StatusCancelled:
		s.notify(ctx, e.buyerID, "order_cancelled", "Заказ отменён", fmt.Sprintf("Заказ «%s» отменён.", e.title), data)
		s.notify(ctx, e.artistID, "order_cancelled", "Заказ отменён", fmt.Sprintf("Заказ «%s» отменён, работа снова в продаже.", e.title), data)
	}
}

// refundPayment выполняет возврат из очереди. Идемпотентно: обрабатывает только refund_pending.
func (s *Server) refundPayment(ctx context.Context, paymentID string) error {
	var externalID string
	var amount int64
	err := s.DB.QueryRow(ctx, `SELECT external_id, amount_kop FROM payments WHERE id = $1 AND status = 'refund_pending'`, paymentID).
		Scan(&externalID, &amount)
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.Payments.Refund(ctx, externalID, amount); err != nil {
		_, _ = s.DB.Exec(ctx, `UPDATE payments SET updated_at = now() WHERE id = $1`, paymentID) // отодвигаем в очереди
		return fmt.Errorf("refund: %w", err)
	}
	_, err = s.DB.Exec(ctx, `UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1 AND status = 'refund_pending'`, paymentID)
	return err
}

// ProcessRefunds повторяет невыполненные возвраты. Возвращает число успешных.
func (s *Server) ProcessRefunds(ctx context.Context) (int, error) {
	ids, err := collectIDs(ctx, s.DB, `SELECT id FROM payments WHERE status = 'refund_pending'
		AND updated_at < now() - interval '1 minute' ORDER BY updated_at LIMIT 50`)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, id := range ids {
		if err := s.refundPayment(ctx, id); err != nil {
			s.Log.Error("refund retry failed", "payment_id", id, "err", err)
			continue
		}
		done++
	}
	return done, nil
}

func collectIDs(ctx context.Context, q querier, sql string, args ...any) ([]string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------- платежи ----------

type paymentDTO struct {
	ID              string `json:"id"`
	Provider        string `json:"provider"`
	AmountKop       int64  `json:"amount_kop"`
	Status          string `json:"status"`
	ConfirmationURL string `json:"confirmation_url"`
	TestMode        bool   `json:"test_mode"`
}

func (s *Server) createPayment(ctx context.Context, userID, purpose string, orderID *string, amount int64, desc string) (paymentDTO, error) {
	var id string
	err := s.DB.QueryRow(ctx, `INSERT INTO payments (user_id, purpose, order_id, provider, amount_kop)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`, userID, purpose, orderID, s.Payments.Name(), amount).Scan(&id)
	if isUniqueViolation(err) && orderID != nil {
		return s.existingPayment(ctx, *orderID)
	}
	if err != nil {
		return paymentDTO{}, fmt.Errorf("insert payment: %w", err)
	}
	created, err := s.Payments.Create(ctx, providers.PaymentRequest{PaymentID: id, AmountKop: amount, Description: desc})
	if err != nil {
		_, _ = s.DB.Exec(ctx, `UPDATE payments SET status='cancelled', updated_at=now() WHERE id=$1`, id)
		return paymentDTO{}, fmt.Errorf("create payment: %w", err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE payments SET external_id=$2 WHERE id=$1`, id, created.ExternalID); err != nil {
		return paymentDTO{}, err
	}
	return paymentDTO{ID: id, Provider: s.Payments.Name(), AmountKop: amount, Status: "pending",
		ConfirmationURL: created.ConfirmationURL, TestMode: s.Config.StubPayments()}, nil
}

// existingPayment — живой платёж заказа (повторное нажатие «Оплатить» не создаёт второе списание).
func (s *Server) existingPayment(ctx context.Context, orderID string) (paymentDTO, error) {
	p := paymentDTO{Provider: s.Payments.Name(), TestMode: s.Config.StubPayments()}
	err := s.DB.QueryRow(ctx, `SELECT id, amount_kop, status FROM payments
		WHERE order_id = $1 AND status IN ('pending','succeeded')`, orderID).Scan(&p.ID, &p.AmountKop, &p.Status)
	if isNoRows(err) {
		return p, httpx.Conflict("payment_processed", "Платёж уже обработан")
	}
	if err == nil && p.Status != "pending" {
		return p, httpx.Conflict("invalid_transition", "Заказ уже оплачен")
	}
	return p, err
}

func (s *Server) payOrder(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var buyerID, status, title string
	var total int64
	err = s.DB.QueryRow(r.Context(), `SELECT o.buyer_id, o.status, o.total_kop, a.title FROM orders o
		JOIN artworks a ON a.id = o.artwork_id WHERE o.id = $1`, id).Scan(&buyerID, &status, &total, &title)
	if isNoRows(err) || (err == nil && buyerID != u.ID) {
		return httpx.NotFound("Заказ не найден")
	}
	if err != nil {
		return err
	}
	if status != string(domain.StatusAwaitingPayment) {
		return httpx.Conflict("invalid_transition", "Заказ уже оплачен или отменён")
	}
	p, err := s.createPayment(r.Context(), u.ID, "order", &id, total, "Artista: «"+title+"»")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, p, nil)
	return nil
}

func (s *Server) buySubscription(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Премиум доступен художникам")
	}
	p, err := s.createPayment(r.Context(), u.ID, "subscription", nil, domain.PremiumPriceKop, "Artista Премиум — 30 дней")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, p, nil)
	return nil
}

// stubConfirmPayment — подтверждение тестовой оплаты (только PAYMENTS_PROVIDER=stub).
func (s *Server) stubConfirmPayment(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if !s.Config.StubPayments() {
		return httpx.NotFound("Не найдено")
	}
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := s.markPaymentSucceeded(r.Context(), id, u.ID); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// markPaymentSucceeded — общий обработчик успешной оплаты (stub и будущий вебхук).
// Порядок блокировок как у отмены: сначала заказ, потом платёж — без взаимоблокировок.
// Если заказ уже отменён, деньги ставятся в очередь на возврат.
func (s *Server) markPaymentSucceeded(ctx context.Context, paymentID, userID string) error {
	var owner, purpose string
	var orderID *string
	err := s.DB.QueryRow(ctx, `SELECT user_id, purpose, order_id FROM payments WHERE id=$1`, paymentID).Scan(&owner, &purpose, &orderID)
	if isNoRows(err) || (err == nil && userID != "" && owner != userID) {
		return httpx.NotFound("Платёж не найден")
	}
	if err != nil {
		return err
	}
	var effects orderEffects
	lateRefund := false
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		var orderStatus domain.OrderStatus
		if orderID != nil {
			if err := tx.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1 FOR UPDATE`, *orderID).Scan(&orderStatus); err != nil {
				return err
			}
		}
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM payments WHERE id=$1 FOR UPDATE`, paymentID).Scan(&status); err != nil {
			return err
		}
		if status != "pending" {
			return httpx.Conflict("payment_processed", "Платёж уже обработан")
		}
		if purpose == "subscription" {
			if _, err := tx.Exec(ctx, `UPDATE payments SET status='succeeded', updated_at=now() WHERE id=$1`, paymentID); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE users SET premium_until = greatest(coalesce(premium_until, now()), now()) + interval '30 days'
				WHERE id=$1`, owner)
			return err
		}
		if orderStatus != domain.StatusAwaitingPayment {
			// оплата пришла после отмены/истечения — деньги нужно вернуть
			lateRefund = true
			effects.refundPaymentID = paymentID
			_, err := tx.Exec(ctx, `UPDATE payments SET status='refund_pending', updated_at=now() WHERE id=$1`, paymentID)
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE payments SET status='succeeded', updated_at=now() WHERE id=$1`, paymentID); err != nil {
			return err
		}
		var err error
		effects, err = s.transitionTx(ctx, tx, transitionReq{orderID: *orderID, action: domain.ActionPay})
		return err
	})
	if err != nil {
		return err
	}
	s.applyEffects(ctx, effects)
	if lateRefund {
		return httpx.Conflict("order_cancelled", "Заказ уже отменён — деньги вернутся на карту")
	}
	return nil
}

// paymentWebhook — заготовка под вебхук ЮKassa (проверка подписи/IP будет добавлена вместе с провайдером).
func (s *Server) paymentWebhook(w http.ResponseWriter, _ *http.Request) error {
	return &httpx.Error{Status: http.StatusNotImplemented, Code: "not_implemented", Message: "Платёжный провайдер не подключён"}
}

// ---------- фоновые таймауты ----------

// ProcessDeadlines двигает просроченные заказы (автоотмена/автозавершение). Возвращает число обработанных.
func (s *Server) ProcessDeadlines(ctx context.Context) (int, error) {
	rows, err := s.DB.Query(ctx, `SELECT id, status FROM orders
		WHERE status IN ('awaiting_payment','paid','confirmed','shipped') AND deadline_at < now()
		ORDER BY deadline_at LIMIT 100`)
	if err != nil {
		return 0, err
	}
	type item struct {
		id     string
		status domain.OrderStatus
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.status); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	done := 0
	for _, it := range items {
		action, ok := domain.TimeoutAction(it.status)
		if !ok {
			continue
		}
		err := s.transition(ctx, transitionReq{orderID: it.id, action: action, timeout: true, expect: it.status})
		if errors.Is(err, errStale) {
			continue // заказ успели оплатить/подтвердить — срок уже другой
		}
		if err != nil {
			s.Log.Warn("deadline transition", "order_id", it.id, "err", err)
			continue
		}
		done++
	}
	return done, nil
}

// RunWorker периодически обрабатывает дедлайны и очередь возвратов до отмены ctx.
func (s *Server) RunWorker(ctx context.Context) {
	t := time.NewTicker(s.Config.WorkerInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := s.ProcessDeadlines(ctx); err != nil {
				s.Log.Error("process deadlines", "err", err)
			} else if n > 0 {
				s.Log.Info("deadlines processed", "orders", n)
			}
			if n, err := s.ProcessRefunds(ctx); err != nil {
				s.Log.Error("process refunds", "err", err)
			} else if n > 0 {
				s.Log.Info("refunds processed", "payments", n)
			}
		}
	}
}

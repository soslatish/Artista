package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// Заказ на заказ: покупатель описывает работу → художник называет цену и срок →
// покупатель принимает и оплачивает через безопасную сделку → эскизы и вопросы — в чате.

type commissionDTO struct {
	ID             string     `json:"id"`
	Status         string     `json:"status"`
	Description    string     `json:"description"`
	Category       string     `json:"category"`
	WidthCm        *float64   `json:"width_cm"`
	HeightCm       *float64   `json:"height_cm"`
	BudgetKop      *int64     `json:"budget_kop"`
	DesiredBy      *string    `json:"desired_by"`
	Images         []string   `json:"images"`
	QuoteKop       *int64     `json:"quote_kop"`
	QuoteDays      *int       `json:"quote_days"`
	QuoteNote      string     `json:"quote_note"`
	DeclineReason  string     `json:"decline_reason"`
	OrderID        *string    `json:"order_id"`
	ConversationID *string    `json:"conversation_id"`
	ExpiresAt      *time.Time `json:"expires_at"`
	Buyer          party      `json:"buyer"`
	Artist         party      `json:"artist"`
	MyRole         string     `json:"my_role"`
	CreatedAt      time.Time  `json:"created_at"`
}

const commissionSelect = `SELECT c.id,
	CASE WHEN c.status IN ('requested','quoted') AND c.expires_at <= now() THEN 'expired' ELSE c.status END,
	c.description, c.category, c.width_cm::float8, c.height_cm::float8, c.budget_kop, to_char(c.desired_by, 'YYYY-MM-DD'), c.images,
	c.quote_kop, c.quote_days, c.quote_note, c.decline_reason, c.order_id, c.conversation_id, c.expires_at,
	b.id, b.name, b.avatar_url, ar.id, ar.name, ar.avatar_url, c.created_at
FROM commissions c JOIN users b ON b.id = c.buyer_id JOIN users ar ON ar.id = c.artist_id `

func scanCommission(row pgx.Row, viewerID string) (commissionDTO, error) {
	var c commissionDTO
	err := row.Scan(&c.ID, &c.Status, &c.Description, &c.Category, &c.WidthCm, &c.HeightCm, &c.BudgetKop, &c.DesiredBy, &c.Images,
		&c.QuoteKop, &c.QuoteDays, &c.QuoteNote, &c.DeclineReason, &c.OrderID, &c.ConversationID, &c.ExpiresAt,
		&c.Buyer.ID, &c.Buyer.Name, &c.Buyer.AvatarURL, &c.Artist.ID, &c.Artist.Name, &c.Artist.AvatarURL, &c.CreatedAt)
	c.MyRole = "buyer"
	if viewerID == c.Artist.ID {
		c.MyRole = "artist"
	}
	return c, err
}

func (s *Server) loadCommission(ctx context.Context, id, viewerID string) (commissionDTO, error) {
	c, err := scanCommission(s.DB.QueryRow(ctx, commissionSelect+`WHERE c.id = $1 AND (c.buyer_id = $2 OR c.artist_id = $2)`, id, viewerID), viewerID)
	if isNoRows(err) {
		return c, httpx.NotFound("Запрос не найден")
	}
	return c, err
}

const maxOpenCommissions = 5

type commissionInput struct {
	ArtistID    string   `json:"artist_id"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	WidthCm     *float64 `json:"width_cm"`
	HeightCm    *float64 `json:"height_cm"`
	BudgetKop   *int64   `json:"budget_kop"`
	DesiredBy   *string  `json:"desired_by"` // YYYY-MM-DD
	Images      []string `json:"images"`
}

func (in commissionInput) validate() map[string]string {
	errs := map[string]string{}
	if !isUUID(in.ArtistID) {
		errs["artist_id"] = "Не выбран художник"
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Description)); n < 20 || n > 3000 {
		errs["description"] = "Опишите работу подробнее (20–3000 символов)"
	}
	if !domain.IsValidCategory(in.Category) {
		errs["category"] = "Выберите категорию"
	}
	for _, v := range []*float64{in.WidthCm, in.HeightCm} {
		if v != nil && (*v <= 0 || *v > 1000) {
			errs["size"] = "Размер — от 1 до 1000 см"
		}
	}
	if in.BudgetKop != nil && (*in.BudgetKop < domain.MinArtworkPriceKop || *in.BudgetKop > domain.MaxArtworkPriceKop) {
		errs["budget_kop"] = "Бюджет — от 3 000 до 500 000 ₽"
	}
	if in.DesiredBy != nil && *in.DesiredBy != "" {
		d, err := time.Parse("2006-01-02", *in.DesiredBy)
		if err != nil || d.Before(time.Now().Add(-24*time.Hour)) || d.After(time.Now().AddDate(1, 0, 0)) {
			errs["desired_by"] = "Укажите дату в пределах года"
		}
	}
	if len(in.Images) > 5 {
		errs["images"] = "Не больше 5 фото-референсов"
	}
	return errs
}

// createCommission — запрос покупателя художнику.
func (s *Server) createCommission(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in commissionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	errs := in.validate()
	if in.ArtistID == u.ID {
		errs["artist_id"] = "Нельзя заказать работу у себя"
	}
	imgErrs, err := s.validateImages(r.Context(), u.ID, in.Images)
	if err != nil {
		return err
	}
	for k, v := range imgErrs {
		errs[k] = v
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	if in.Images == nil {
		in.Images = []string{}
	}
	if in.DesiredBy != nil && *in.DesiredBy == "" {
		in.DesiredBy = nil
	}
	desc := strings.TrimSpace(in.Description)
	var id, convID string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var role string
		var accepts bool
		err := tx.QueryRow(r.Context(), `SELECT role, accepts_commissions FROM users WHERE id = $1 AND deleted_at IS NULL AND banned_at IS NULL`, in.ArtistID).
			Scan(&role, &accepts)
		if isNoRows(err) {
			return httpx.NotFound("Художник не найден")
		}
		if err != nil {
			return err
		}
		if role != "artist" || !accepts {
			return httpx.Conflict("commissions_disabled", "Художник сейчас не принимает заказы")
		}
		if onVacation, until, err := artistOnVacation(r.Context(), tx, in.ArtistID); err != nil {
			return err
		} else if onVacation {
			return vacationError(until)
		}
		var open int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM commissions WHERE buyer_id = $1 AND status IN ('requested','quoted') AND expires_at > now()`, u.ID).Scan(&open); err != nil {
			return err
		}
		if open >= maxOpenCommissions {
			return httpx.Conflict("too_many_commissions", "У вас уже 5 открытых запросов — дождитесь ответов")
		}
		err = tx.QueryRow(r.Context(), `INSERT INTO conversations (buyer_id, artist_id, artwork_id) VALUES ($1, $2, NULL)
			ON CONFLICT (buyer_id, artist_id, coalesce(artwork_id, '00000000-0000-0000-0000-000000000000'::uuid))
			DO UPDATE SET buyer_id = excluded.buyer_id RETURNING id`, u.ID, in.ArtistID).Scan(&convID)
		if err != nil {
			return err
		}
		return tx.QueryRow(r.Context(), `INSERT INTO commissions (buyer_id, artist_id, description, category, width_cm, height_cm,
				budget_kop, desired_by, images, conversation_id, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11) RETURNING id`,
			u.ID, in.ArtistID, desc, in.Category, in.WidthCm, in.HeightCm, in.BudgetKop, in.DesiredBy, in.Images, convID,
			time.Now().Add(domain.CommissionAnswerTTL)).Scan(&id)
	})
	if err != nil {
		return err
	}
	// первое сообщение в чате — сам запрос, чтобы обсуждение эскизов шло рядом
	if _, err := s.postMessage(r.Context(), convID, u.ID, in.ArtistID, "Запрос на работу на заказ:\n"+truncate(desc, 1500), ""); err != nil {
		s.Log.Warn("commission message", "err", err)
	}
	s.notify(r.Context(), in.ArtistID, "commission_new", tr("Запрос на заказ", "Commission request"),
		tr("Вам предлагают написать работу на заказ — ответьте в течение 7 дней", "You have a commission request — reply within 7 days"),
		map[string]any{"commission_id": id})
	c, err := s.loadCommission(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, c, nil)
	return nil
}

func (s *Server) listCommissions(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	col := "c.buyer_id"
	switch r.URL.Query().Get("role") {
	case "artist":
		col = "c.artist_id"
	case "", "buyer":
	default:
		return httpx.BadRequest("role: buyer или artist")
	}
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf("%s WHERE %s = $1 ORDER BY c.updated_at DESC LIMIT %d OFFSET %d", commissionSelect, col, p.limit, p.offset), u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []commissionDTO{}
	for rows.Next() {
		c, err := scanCommission(rows, u.ID)
		if err != nil {
			return err
		}
		items = append(items, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) getCommission(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	c, err := s.loadCommission(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, c)
	return nil
}

// commissionRow — запрос под блокировкой.
type commissionRow struct {
	buyerID, artistID, status, description, category string
	widthCm, heightCm                                *float64
	quoteKop                                         *int64
	quoteDays                                        *int
	images                                           []string
	expiresAt                                        *time.Time
}

func lockCommission(ctx context.Context, tx pgx.Tx, id, userID string) (commissionRow, error) {
	var c commissionRow
	err := tx.QueryRow(ctx, `SELECT buyer_id, artist_id, status, description, category, width_cm::float8, height_cm::float8,
			quote_kop, quote_days, images, expires_at FROM commissions WHERE id = $1 FOR UPDATE`, id).
		Scan(&c.buyerID, &c.artistID, &c.status, &c.description, &c.category, &c.widthCm, &c.heightCm, &c.quoteKop, &c.quoteDays, &c.images, &c.expiresAt)
	if isNoRows(err) || (err == nil && userID != c.buyerID && userID != c.artistID) {
		return c, httpx.NotFound("Запрос не найден")
	}
	if err != nil {
		return c, err
	}
	if (c.status == "requested" || c.status == "quoted") && c.expiresAt != nil && !c.expiresAt.After(time.Now()) {
		return c, httpx.Conflict("commission_expired", "Срок запроса истёк")
	}
	return c, nil
}

// commissionAction: художник — quote, decline; покупатель — cancel, accept.
func (s *Server) commissionAction(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	action := r.PathValue("action")
	var in struct {
		PriceKop       int64   `json:"price_kop"`
		Days           int     `json:"days"`
		Note           string  `json:"note"`
		Reason         string  `json:"reason"`
		DeliveryMethod string  `json:"delivery_method"`
		Address        Address `json:"address"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	var notifyUser, typ string
	var heading, body text
	var orderID string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		c, err := lockCommission(r.Context(), tx, id, u.ID)
		if err != nil {
			return err
		}
		isArtist := u.ID == c.artistID
		open := c.status == "requested" || c.status == "quoted"
		switch {
		case isArtist && action == "quote" && open:
			errs := map[string]string{}
			if in.PriceKop < domain.MinArtworkPriceKop || in.PriceKop > domain.MaxArtworkPriceKop {
				errs["price_kop"] = "Цена — от 3 000 до 500 000 ₽"
			}
			if in.Days < 1 || in.Days > domain.CommissionMaxDays {
				errs["days"] = "Срок — от 1 до 120 дней"
			}
			if utf8.RuneCountInString(in.Note) > 1000 {
				errs["note"] = "Комментарий — до 1000 символов"
			}
			if len(errs) > 0 {
				return httpx.Validation(errs)
			}
			if _, err := tx.Exec(r.Context(), `UPDATE commissions SET status = 'quoted', quote_kop = $2, quote_days = $3, quote_note = $4,
					expires_at = $5, updated_at = now() WHERE id = $1`, id, in.PriceKop, in.Days, strings.TrimSpace(in.Note),
				time.Now().Add(domain.CommissionQuoteTTL)); err != nil {
				return err
			}
			notifyUser, typ = c.buyerID, "commission_quoted"
			heading = tr("Художник назвал цену", "The artist sent a quote")
			body = tr("%s, срок — %d дн. Примите предложение, чтобы начать работу.", "%s, %d days. Accept the quote to start the work.", rub(in.PriceKop), in.Days)
		case isArtist && action == "decline" && open:
			if _, err := tx.Exec(r.Context(), `UPDATE commissions SET status = 'declined', decline_reason = $2, updated_at = now() WHERE id = $1`,
				id, truncate(strings.TrimSpace(in.Reason), 300)); err != nil {
				return err
			}
			notifyUser, typ = c.buyerID, "commission_declined"
			heading = tr("Запрос отклонён", "Request declined")
			body = tr("Художник не сможет выполнить этот заказ", "The artist can’t take this commission")
		case !isArtist && action == "cancel" && open:
			if _, err := tx.Exec(r.Context(), `UPDATE commissions SET status = 'cancelled', updated_at = now() WHERE id = $1`, id); err != nil {
				return err
			}
			notifyUser, typ = c.artistID, "commission_cancelled"
			heading = tr("Запрос отменён", "Request cancelled")
			body = tr("Покупатель отменил запрос на заказ", "The buyer cancelled the commission request")
		case !isArtist && action == "accept" && c.status == "quoted":
			orderID, err = s.acceptCommissionTx(r.Context(), tx, id, c, domain.DeliveryMethod(in.DeliveryMethod), in.Address)
			if err != nil {
				return err
			}
			notifyUser, typ = c.artistID, "commission_accepted"
			heading = tr("Предложение принято", "Quote accepted")
			body = tr("Покупатель согласился на %s. Работа начнётся после оплаты.", "The buyer accepted %s. Work starts after payment.", rub(*c.quoteKop))
		default:
			return httpx.Conflict("invalid_transition", "Это действие недоступно")
		}
		return nil
	})
	if err != nil {
		return err
	}
	if notifyUser != "" {
		data := map[string]any{"commission_id": id}
		if orderID != "" {
			data["order_id"] = orderID
		}
		s.notify(r.Context(), notifyUser, typ, heading, body, data)
	}
	c, err := s.loadCommission(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, c)
	return nil
}

// defaultCommissionSideCm — размер, если покупатель его не указал (для тарифа доставки).
const defaultCommissionSideCm = 50.0

// acceptCommissionTx создаёт работу «на заказ» (вне каталога) и заказ на неё со сроком художника.
func (s *Server) acceptCommissionTx(ctx context.Context, tx pgx.Tx, id string, c commissionRow, method domain.DeliveryMethod, addr Address) (string, error) {
	if errs := addr.validate(); len(errs) > 0 {
		return "", httpx.Validation(errs)
	}
	var unpaid int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM orders WHERE buyer_id = $1 AND status = 'awaiting_payment'`, c.buyerID).Scan(&unpaid); err != nil {
		return "", err
	}
	if unpaid >= maxUnpaidOrders {
		return "", httpx.Conflict("too_many_unpaid", "Сначала оплатите или отмените неоплаченные заказы")
	}
	width, height := defaultCommissionSideCm, defaultCommissionSideCm
	if c.widthCm != nil {
		width = *c.widthCm
	}
	if c.heightCm != nil {
		height = *c.heightCm
	}
	price := *c.quoteKop
	quote, err := domain.QuoteDelivery(method, addr.City, price, domain.MaxSide(width, height, 0))
	if err != nil {
		return "", httpx.Validation(map[string]string{"delivery_method": deliveryErrorText(err)})
	}
	var artworkID string
	title := "Работа на заказ: " + truncate(strings.ReplaceAll(c.description, "\n", " "), 60)
	if err := tx.QueryRow(ctx, `INSERT INTO artworks (artist_id, title, description, category, width_cm, height_cm, price_kop, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'commission') RETURNING id`,
		c.artistID, title, c.description, c.category, width, height, price).Scan(&artworkID); err != nil {
		return "", fmt.Errorf("insert commission artwork: %w", err)
	}
	if err := replaceImages(ctx, tx, artworkID, c.images); err != nil {
		return "", err
	}
	commission, err := currentCommission(ctx, tx, c.artistID, price)
	if err != nil {
		return "", err
	}
	addrJSON, _ := json.Marshal(addr)
	var orderID string
	if err := tx.QueryRow(ctx, `INSERT INTO orders (buyer_id, artist_id, artwork_id, price_kop, delivery_kop, commission_kop,
			total_kop, delivery_method, address, deadline_at, kind, ship_days)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'commission',$11) RETURNING id`,
		c.buyerID, c.artistID, artworkID, price, quote.PriceKop, commission, price+quote.PriceKop, string(method), addrJSON,
		domain.DeadlineFor(domain.StatusAwaitingPayment, time.Now()), c.quoteDays).Scan(&orderID); err != nil {
		return "", fmt.Errorf("insert commission order: %w", err)
	}
	_, err = tx.Exec(ctx, `UPDATE commissions SET status = 'accepted', artwork_id = $2, order_id = $3, updated_at = now() WHERE id = $1`, id, artworkID, orderID)
	return orderID, err
}

// ExpireCommissions закрывает запросы без ответа. Возвращает число закрытых.
func (s *Server) ExpireCommissions(ctx context.Context) (int, error) {
	tag, err := s.DB.Exec(ctx, `UPDATE commissions SET status = 'expired', updated_at = now()
		WHERE status IN ('requested','quoted') AND expires_at <= now()`)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

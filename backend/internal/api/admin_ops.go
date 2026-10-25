package api

// Админка: заказы и платежи, сделки (аукционы, предложения, заказы на создание, выставки),
// контент (посты, вопросы), сертификаты, рассылка и журнал действий.

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

// ---------- заказы ----------

type adminOrderDTO struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Status         string          `json:"status"`
	PayoutStatus   string          `json:"payout_status"`
	ArtworkID      string          `json:"artwork_id"`
	ArtworkTitle   string          `json:"artwork_title"`
	ImageURL       string          `json:"image_url"`
	BuyerID        string          `json:"buyer_id"`
	BuyerName      string          `json:"buyer_name"`
	ArtistID       string          `json:"artist_id"`
	ArtistName     string          `json:"artist_name"`
	PriceKop       int64           `json:"price_kop"`
	DeliveryKop    int64           `json:"delivery_kop"`
	CommissionKop  int64           `json:"commission_kop"`
	TotalKop       int64           `json:"total_kop"`
	DeliveryMethod string          `json:"delivery_method"`
	Tracking       string          `json:"tracking_number"`
	CancelReason   string          `json:"cancel_reason"`
	Address        json.RawMessage `json:"address,omitempty"`
	DeadlineAt     *time.Time      `json:"deadline_at"`
	CreatedAt      time.Time       `json:"created_at"`
	PaidAt         *time.Time      `json:"paid_at"`
	CompletedAt    *time.Time      `json:"completed_at"`
	CancelledAt    *time.Time      `json:"cancelled_at"`
}

func (s *Server) adminOrders(ctx context.Context, where string, args []any, limit, offset int) ([]adminOrderDTO, error) {
	rows, err := s.DB.Query(ctx, `SELECT o.id, o.kind, o.status, o.payout_status, a.id, a.title,
			coalesce((SELECT url FROM artwork_images i WHERE i.artwork_id = a.id ORDER BY position LIMIT 1), ''),
			b.id, b.name, ar.id, ar.name, o.price_kop, o.delivery_kop, o.commission_kop, o.total_kop, o.delivery_method,
			o.tracking_number, o.cancel_reason, o.address, o.deadline_at, o.created_at, o.paid_at, o.completed_at, o.cancelled_at
		FROM orders o JOIN artworks a ON a.id = o.artwork_id JOIN users b ON b.id = o.buyer_id JOIN users ar ON ar.id = o.artist_id `+
		where+fmt.Sprintf(` ORDER BY o.created_at DESC LIMIT %d OFFSET %d`, limit, offset), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []adminOrderDTO{}
	for rows.Next() {
		var o adminOrderDTO
		if err := rows.Scan(&o.ID, &o.Kind, &o.Status, &o.PayoutStatus, &o.ArtworkID, &o.ArtworkTitle, &o.ImageURL, &o.BuyerID, &o.BuyerName,
			&o.ArtistID, &o.ArtistName, &o.PriceKop, &o.DeliveryKop, &o.CommissionKop, &o.TotalKop, &o.DeliveryMethod, &o.Tracking,
			&o.CancelReason, &o.Address, &o.DeadlineAt, &o.CreatedAt, &o.PaidAt, &o.CompletedAt, &o.CancelledAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Server) adminListOrders(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	q := r.URL.Query()
	p := parseAdminPage(r)
	var f filters
	if v := q.Get("status"); v != "" {
		f.add(`o.status = ?`, v)
	}
	if v := q.Get("kind"); v != "" {
		f.add(`o.kind = ?`, v)
	}
	if v := q.Get("q"); v != "" {
		f.add(`(a.title ILIKE ? OR b.name ILIKE ? OR ar.name ILIKE ? OR b.email ILIKE ? OR o.id::text = ?)`,
			likeQuery(v), likeQuery(v), likeQuery(v), likeQuery(v), strings.TrimSpace(v))
	}
	if v := q.Get("user_id"); isUUID(v) {
		f.add(`(o.buyer_id = ? OR o.artist_id = ?)`, v, v)
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM orders o JOIN artworks a ON a.id = o.artwork_id
		JOIN users b ON b.id = o.buyer_id JOIN users ar ON ar.id = o.artist_id`+f.sql(), f.args...).Scan(&total); err != nil {
		return err
	}
	items, err := s.adminOrders(r.Context(), f.sql(), f.args, p.limit, p.offset)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

type adminOrderDetail struct {
	adminOrderDTO
	Payments []adminPaymentDTO `json:"payments"`
	Actions  []auditDTO        `json:"admin_actions"`
}

func (s *Server) adminGetOrder(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	d, err := s.loadAdminOrder(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.OK(w, d)
	return nil
}

func (s *Server) loadAdminOrder(ctx context.Context, id string) (adminOrderDetail, error) {
	var d adminOrderDetail
	items, err := s.adminOrders(ctx, `WHERE o.id = $1`, []any{id}, 1, 0)
	if err != nil {
		return d, err
	}
	if len(items) == 0 {
		return d, httpx.NotFound("Заказ не найден")
	}
	d.adminOrderDTO = items[0]
	if d.Payments, err = s.adminPayments(ctx, `WHERE p.order_id = $1`, []any{id}, 20, 0); err != nil {
		return d, err
	}
	if d.Actions, err = s.auditEntries(ctx, `WHERE target_type = 'order' AND target_id = $1`, []any{id}, 20); err != nil {
		return d, err
	}
	return d, nil
}

// adminOrderAction: cancel — отменить с возвратом денег покупателю (в любом активном статусе),
// complete — завершить отправленный заказ (выплата художнику, сертификат покупателю).
func (s *Server) adminOrderAction(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	reason := truncate(strings.TrimSpace(in.Reason), 300)
	var action domain.OrderAction
	switch r.PathValue("action") {
	case "cancel":
		action = domain.ActionCancel
		if reason == "" {
			reason = "Отменён администратором"
		}
	case "complete":
		action = domain.ActionComplete
	default:
		return httpx.NotFound("Неизвестное действие")
	}
	if err := s.transition(r.Context(), transitionReq{orderID: id, action: action, admin: true, reason: reason}); err != nil {
		return err
	}
	if err := audit(r.Context(), s.DB, admin.ID, "order."+r.PathValue("action"), "order", id, map[string]any{"reason": reason}); err != nil {
		return err
	}
	d, err := s.loadAdminOrder(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.OK(w, d)
	return nil
}

// ---------- платежи ----------

type adminPaymentDTO struct {
	ID         string    `json:"id"`
	Purpose    string    `json:"purpose"`
	Status     string    `json:"status"`
	AmountKop  int64     `json:"amount_kop"`
	Provider   string    `json:"provider"`
	ExternalID string    `json:"external_id"`
	UserID     string    `json:"user_id"`
	UserName   string    `json:"user_name"`
	OrderID    *string   `json:"order_id"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *Server) adminPayments(ctx context.Context, where string, args []any, limit, offset int) ([]adminPaymentDTO, error) {
	rows, err := s.DB.Query(ctx, `SELECT p.id, p.purpose, p.status, p.amount_kop, p.provider, p.external_id, u.id, u.name, p.order_id, p.created_at, p.updated_at
		FROM payments p JOIN users u ON u.id = p.user_id `+where+fmt.Sprintf(` ORDER BY p.created_at DESC LIMIT %d OFFSET %d`, limit, offset), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []adminPaymentDTO{}
	for rows.Next() {
		var p adminPaymentDTO
		if err := rows.Scan(&p.ID, &p.Purpose, &p.Status, &p.AmountKop, &p.Provider, &p.ExternalID, &p.UserID, &p.UserName, &p.OrderID, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Server) adminListPayments(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	q := r.URL.Query()
	p := parseAdminPage(r)
	var f filters
	if v := q.Get("status"); v != "" {
		f.add(`p.status = ?`, v)
	}
	if v := q.Get("purpose"); v != "" {
		f.add(`p.purpose = ?`, v)
	}
	if v := q.Get("q"); v != "" {
		f.add(`(u.name ILIKE ? OR u.email ILIKE ? OR p.id::text = ? OR p.order_id::text = ?)`, likeQuery(v), likeQuery(v), strings.TrimSpace(v), strings.TrimSpace(v))
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM payments p JOIN users u ON u.id = p.user_id`+f.sql(), f.args...).Scan(&total); err != nil {
		return err
	}
	items, err := s.adminPayments(r.Context(), f.sql(), f.args, p.limit, p.offset)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

// ---------- сделки ----------

// adminDealDTO — общая строка для аукционов, предложений, заказов на создание и выставок.
type adminDealDTO struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	Title      string     `json:"title"`
	ImageURL   string     `json:"image_url"`
	ArtworkID  *string    `json:"artwork_id"`
	ArtistID   string     `json:"artist_id"`
	ArtistName string     `json:"artist_name"`
	OtherID    *string    `json:"other_id"`
	OtherName  string     `json:"other_name"`
	AmountKop  *int64     `json:"amount_kop"`
	Count      int        `json:"count"`
	At         *time.Time `json:"at"` // окончание аукциона, срок предложения, открытие выставки
	CreatedAt  time.Time  `json:"created_at"`
}

var dealQueries = map[string]string{
	"auctions": `SELECT au.id, 'auction', au.status, a.title,
			coalesce((SELECT url FROM artwork_images i WHERE i.artwork_id = a.id ORDER BY position LIMIT 1), ''),
			a.id, ar.id, ar.name, l.id, coalesce(l.name, ''), coalesce(au.current_kop, au.start_kop), au.bids_count, au.ends_at, au.created_at
		FROM auctions au JOIN artworks a ON a.id = au.artwork_id JOIN users ar ON ar.id = au.artist_id LEFT JOIN users l ON l.id = au.leader_id`,
	"offers": `SELECT o.id, 'offer', CASE WHEN o.status IN ('pending','countered','accepted') AND o.expires_at <= now() THEN 'expired' ELSE o.status END,
			a.title, coalesce((SELECT url FROM artwork_images i WHERE i.artwork_id = a.id ORDER BY position LIMIT 1), ''),
			a.id, ar.id, ar.name, b.id, b.name, coalesce(o.counter_kop, o.amount_kop), 0, o.expires_at, o.created_at
		FROM offers o JOIN artworks a ON a.id = o.artwork_id JOIN users ar ON ar.id = o.artist_id JOIN users b ON b.id = o.buyer_id`,
	"commissions": `SELECT c.id, 'commission', c.status, left(c.description, 120), coalesce(c.images[1], ''),
			NULL::uuid, ar.id, ar.name, b.id, b.name, coalesce(c.quote_kop, c.budget_kop), coalesce(c.quote_days, 0), c.expires_at, c.created_at
		FROM commissions c JOIN users ar ON ar.id = c.artist_id JOIN users b ON b.id = c.buyer_id`,
	"exhibitions": `SELECT e.id, 'exhibition',
			CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled' WHEN e.opened_at IS NOT NULL THEN 'open' ELSE 'upcoming' END,
			e.title, e.cover_url, NULL::uuid, ar.id, ar.name, NULL::uuid, '', NULL::bigint,
			(SELECT count(*) FROM artworks a WHERE a.exhibition_id = e.id), e.starts_at, e.created_at
		FROM exhibitions e JOIN users ar ON ar.id = e.artist_id`,
}

func (s *Server) adminListDeals(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	kind := r.PathValue("kind")
	base, ok := dealQueries[kind]
	if !ok {
		return httpx.NotFound("Неизвестный раздел")
	}
	p := parseAdminPage(r)
	sql := `SELECT * FROM (` + base + `) d(id, type, status, title, image_url, artwork_id, artist_id, artist_name, other_id, other_name, amount_kop, cnt, at, created_at)`
	var f filters
	if v := r.URL.Query().Get("status"); v != "" {
		f.add(`d.status = ?`, v)
	}
	if v := r.URL.Query().Get("q"); v != "" {
		f.add(`(d.title ILIKE ? OR d.artist_name ILIKE ? OR d.other_name ILIKE ?)`, likeQuery(v), likeQuery(v), likeQuery(v))
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM (`+sql+f.sql()+`) t`, f.args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.Query(r.Context(), sql+f.sql()+fmt.Sprintf(` ORDER BY d.created_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), f.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []adminDealDTO{}
	for rows.Next() {
		var d adminDealDTO
		if err := rows.Scan(&d.ID, &d.Type, &d.Status, &d.Title, &d.ImageURL, &d.ArtworkID, &d.ArtistID, &d.ArtistName, &d.OtherID, &d.OtherName,
			&d.AmountKop, &d.Count, &d.At, &d.CreatedAt); err != nil {
			return err
		}
		items = append(items, d)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

// adminCancelDeal отменяет живой аукцион (даже со ставками), открытое предложение,
// заказ на создание до оплаты или будущую выставку.
func (s *Server) adminCancelDeal(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	kind := r.PathValue("kind")
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	var notifyIDs []string
	var title string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var tag interface{ RowsAffected() int64 }
		var err error
		switch kind {
		case "auctions":
			var artworkID, artistID string
			var leader *string
			err = tx.QueryRow(r.Context(), `SELECT au.artwork_id, au.artist_id, au.leader_id, a.title FROM auctions au JOIN artworks a ON a.id = au.artwork_id
				WHERE au.id = $1 AND au.status = 'live' FOR UPDATE OF au`, id).Scan(&artworkID, &artistID, &leader, &title)
			if isNoRows(err) {
				return httpx.Conflict("deal_closed", "Аукцион уже завершён или отменён")
			}
			if err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `UPDATE auctions SET status = 'cancelled', ended_at = now() WHERE id = $1`, id); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'auction'`, artworkID); err != nil {
				return err
			}
			notifyIDs = append(notifyIDs, artistID)
			if leader != nil {
				notifyIDs = append(notifyIDs, *leader)
			}
			return audit(r.Context(), tx, admin.ID, "auction.cancel", "auction", id, map[string]any{"reason": in.Reason})
		case "offers":
			tag, err = tx.Exec(r.Context(), `UPDATE offers SET status = 'declined', updated_at = now() WHERE id = $1 AND status IN ('pending','countered','accepted')`, id)
			if err == nil {
				_, err = tx.Exec(r.Context(), `UPDATE price_locks SET released_at = now() WHERE source = 'offer' AND source_id = $1 AND used_at IS NULL AND released_at IS NULL`, id)
			}
		case "commissions":
			tag, err = tx.Exec(r.Context(), `UPDATE commissions SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('requested','quoted')`, id)
		case "exhibitions":
			tag, err = tx.Exec(r.Context(), `UPDATE exhibitions SET cancelled_at = now() WHERE id = $1 AND opened_at IS NULL AND cancelled_at IS NULL`, id)
			if err == nil && tag.RowsAffected() > 0 {
				_, err = tx.Exec(r.Context(), `UPDATE artworks SET status = 'draft', exhibition_id = NULL, updated_at = now() WHERE exhibition_id = $1 AND status = 'scheduled'`, id)
			}
		default:
			return httpx.NotFound("Неизвестный раздел")
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("deal_closed", "Сделка уже закрыта")
		}
		return audit(r.Context(), tx, admin.ID, strings.TrimSuffix(kind, "s")+".cancel", strings.TrimSuffix(kind, "s"), id, map[string]any{"reason": in.Reason})
	})
	if err != nil {
		return err
	}
	for _, uid := range notifyIDs {
		s.notify(r.Context(), uid, "auction_cancelled", tr("Аукцион отменён", "Auction cancelled"),
			tr("Администратор отменил аукцион «%s»", "An administrator cancelled the auction for “%s”", title), map[string]any{"auction_id": id})
	}
	httpx.NoContent(w)
	return nil
}

// ---------- контент ----------

type adminContentDTO struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Body       string     `json:"body"`
	Extra      string     `json:"extra"` // ответ на вопрос / название работы
	ImageURL   string     `json:"image_url"`
	AuthorID   string     `json:"author_id"`
	AuthorName string     `json:"author_name"`
	ArtworkID  *string    `json:"artwork_id"`
	HiddenAt   *time.Time `json:"hidden_at"`
	Reports    int        `json:"reports"`
	CreatedAt  time.Time  `json:"created_at"`
}

var contentQueries = map[string]string{
	"posts": `SELECT p.id, 'post', p.body, coalesce(a.title, ''), coalesce(p.images[1], ''), u.id, u.name, p.artwork_id, p.hidden_at,
			(SELECT count(*) FROM reports rp WHERE rp.target_type = 'post' AND rp.target_id = p.id), p.created_at
		FROM posts p JOIN users u ON u.id = p.artist_id LEFT JOIN artworks a ON a.id = p.artwork_id`,
	"questions": `SELECT q.id, 'question', q.body, q.answer, '', u.id, u.name, q.artwork_id, q.hidden_at,
			(SELECT count(*) FROM reports rp WHERE rp.target_type = 'question' AND rp.target_id = q.id), q.created_at
		FROM artwork_questions q JOIN users u ON u.id = q.author_id`,
}

func (s *Server) adminListContent(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	kind := r.PathValue("kind")
	base, ok := contentQueries[kind]
	if !ok {
		return httpx.NotFound("Неизвестный раздел")
	}
	p := parseAdminPage(r)
	sql := `SELECT * FROM (` + base + `) c(id, type, body, extra, image_url, author_id, author_name, artwork_id, hidden_at, reports, created_at)`
	var f filters
	switch r.URL.Query().Get("status") {
	case "hidden":
		f.add(`c.hidden_at IS NOT NULL`)
	case "visible":
		f.add(`c.hidden_at IS NULL`)
	case "reported":
		f.add(`c.reports > 0`)
	}
	if v := r.URL.Query().Get("q"); v != "" {
		f.add(`(c.body ILIKE ? OR c.author_name ILIKE ?)`, likeQuery(v), likeQuery(v))
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM (`+sql+f.sql()+`) t`, f.args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.Query(r.Context(), sql+f.sql()+fmt.Sprintf(` ORDER BY c.created_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), f.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []adminContentDTO{}
	for rows.Next() {
		var c adminContentDTO
		if err := rows.Scan(&c.ID, &c.Type, &c.Body, &c.Extra, &c.ImageURL, &c.AuthorID, &c.AuthorName, &c.ArtworkID, &c.HiddenAt, &c.Reports, &c.CreatedAt); err != nil {
			return err
		}
		items = append(items, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

func (s *Server) adminSetContentHidden(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	kind := r.PathValue("kind")
	table := map[string]string{"posts": "posts", "questions": "artwork_questions"}[kind]
	if table == "" {
		return httpx.NotFound("Неизвестный раздел")
	}
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Hidden bool `json:"hidden"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `UPDATE `+table+` SET hidden_at = CASE WHEN $2 THEN coalesce(hidden_at, now()) END WHERE id = $1`, id, in.Hidden)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Не найдено")
	}
	if err := audit(r.Context(), s.DB, admin.ID, strings.TrimSuffix(kind, "s")+".hidden", strings.TrimSuffix(kind, "s"), id, map[string]any{"hidden": in.Hidden}); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// ---------- сертификаты ----------

func (s *Server) adminListCertificates(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	p := parseAdminPage(r)
	var f filters
	if v := r.URL.Query().Get("q"); v != "" {
		f.add(`(c.code ILIKE ? OR a.title ILIKE ? OR o.name ILIKE ?)`, likeQuery(v), likeQuery(v), likeQuery(v))
	}
	from := ` FROM certificates c JOIN artworks a ON a.id = c.artwork_id JOIN users o ON o.id = c.owner_id JOIN users ar ON ar.id = a.artist_id`
	var total int
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*)`+from+f.sql(), f.args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT c.code, c.status, a.id, a.title, ar.name, o.id, o.name, c.issued_at`+from+f.sql()+
		fmt.Sprintf(` ORDER BY c.issued_at DESC LIMIT %d OFFSET %d`, p.limit, p.offset), f.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct {
		Code       string    `json:"code"`
		Status     string    `json:"status"`
		ArtworkID  string    `json:"artwork_id"`
		Title      string    `json:"title"`
		ArtistName string    `json:"artist_name"`
		OwnerID    string    `json:"owner_id"`
		OwnerName  string    `json:"owner_name"`
		IssuedAt   time.Time `json:"issued_at"`
	}
	items := []row{}
	for rows.Next() {
		var c row
		if err := rows.Scan(&c.Code, &c.Status, &c.ArtworkID, &c.Title, &c.ArtistName, &c.OwnerID, &c.OwnerName, &c.IssuedAt); err != nil {
			return err
		}
		items = append(items, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(total))
	return nil
}

// ---------- рассылка ----------

var broadcastAudiences = map[string]string{
	"all":     `SELECT id FROM users WHERE role <> 'admin'`,
	"buyers":  `SELECT id FROM users WHERE role = 'buyer'`,
	"artists": `SELECT id FROM users WHERE role = 'artist'`,
	"premium": `SELECT id FROM users WHERE premium_until > now()`,
}

func (s *Server) adminBroadcast(w http.ResponseWriter, r *http.Request, admin httpx.User) error {
	var in struct {
		Audience string `json:"audience"`
		Title    string `json:"title"`
		Body     string `json:"body"`
		TitleEn  string `json:"title_en"`
		BodyEn   string `json:"body_en"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	recipients, ok := broadcastAudiences[in.Audience]
	errs := map[string]string{}
	if !ok {
		errs["audience"] = "Получатели: all, buyers, artists или premium"
	}
	in.Title, in.Body = strings.TrimSpace(in.Title), strings.TrimSpace(in.Body)
	if n := utf8.RuneCountInString(in.Title); n < 2 || n > 100 {
		errs["title"] = "Заголовок — от 2 до 100 символов"
	}
	if n := utf8.RuneCountInString(in.Body); n < 2 || n > 500 {
		errs["body"] = "Текст — от 2 до 500 символов"
	}
	if utf8.RuneCountInString(in.TitleEn) > 100 || utf8.RuneCountInString(in.BodyEn) > 500 {
		errs["body_en"] = "Английский текст — до 100 / 500 символов"
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	if !s.socialLimiter.Allow("broadcast:" + admin.ID) {
		return httpx.TooMany()
	}
	titleEn, bodyEn := strings.TrimSpace(in.TitleEn), strings.TrimSpace(in.BodyEn)
	if titleEn == "" {
		titleEn = in.Title
	}
	if bodyEn == "" {
		bodyEn = in.Body
	}
	n := s.notifyMany(r.Context(), recipients, nil, "announcement", text{ru: in.Title, en: titleEn}, text{ru: in.Body, en: bodyEn}, map[string]any{})
	if err := audit(r.Context(), s.DB, admin.ID, "broadcast", "users", in.Audience, map[string]any{"title": in.Title, "sent": n}); err != nil {
		return err
	}
	httpx.OK(w, map[string]int{"sent": n})
	return nil
}

// ---------- журнал ----------

type auditDTO struct {
	ID         int64           `json:"id"`
	AdminID    *string         `json:"admin_id"`
	AdminName  string          `json:"admin_name"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Details    json.RawMessage `json:"details"`
	CreatedAt  time.Time       `json:"created_at"`
}

func (s *Server) auditEntries(ctx context.Context, where string, args []any, limit int) ([]auditDTO, error) {
	rows, err := s.DB.Query(ctx, `SELECT x.id, x.admin_id, coalesce(u.name, ''), x.action, x.target_type, x.target_id, x.details, x.created_at
		FROM admin_actions x LEFT JOIN users u ON u.id = x.admin_id `+where+fmt.Sprintf(` ORDER BY x.created_at DESC LIMIT %d`, limit), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []auditDTO{}
	for rows.Next() {
		var a auditDTO
		if err := rows.Scan(&a.ID, &a.AdminID, &a.AdminName, &a.Action, &a.TargetType, &a.TargetID, &a.Details, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Server) adminListAudit(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	p := parseAdminPage(r)
	items, err := s.auditEntries(r.Context(), "", nil, p.limit)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, nil)
	return nil
}

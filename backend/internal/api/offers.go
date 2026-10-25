package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

type offerDTO struct {
	ID         string       `json:"id"`
	Status     string       `json:"status"`
	AmountKop  int64        `json:"amount_kop"`
	CounterKop *int64       `json:"counter_kop"`
	AgreedKop  *int64       `json:"agreed_kop"` // итоговая цена после согласия
	Message    string       `json:"message"`
	ExpiresAt  time.Time    `json:"expires_at"`
	Artwork    orderArtwork `json:"artwork"`
	PriceKop   int64        `json:"price_kop"` // текущая цена работы
	Buyer      party        `json:"buyer"`
	Artist     party        `json:"artist"`
	MyRole     string       `json:"my_role"`
	CreatedAt  time.Time    `json:"created_at"`
}

const offerSelect = `SELECT o.id, CASE WHEN o.status IN ('pending','countered','accepted') AND o.expires_at <= now() THEN 'expired' ELSE o.status END,
	o.amount_kop, o.counter_kop, o.message, o.expires_at,
	a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''), a.price_kop,
	b.id, b.name, b.avatar_url, ar.id, ar.name, ar.avatar_url, o.created_at
FROM offers o
JOIN artworks a ON a.id = o.artwork_id
JOIN users b ON b.id = o.buyer_id
JOIN users ar ON ar.id = o.artist_id `

func scanOffer(row pgx.Row, viewerID string) (offerDTO, error) {
	var o offerDTO
	err := row.Scan(&o.ID, &o.Status, &o.AmountKop, &o.CounterKop, &o.Message, &o.ExpiresAt,
		&o.Artwork.ID, &o.Artwork.Title, &o.Artwork.ImageURL, &o.PriceKop,
		&o.Buyer.ID, &o.Buyer.Name, &o.Buyer.AvatarURL, &o.Artist.ID, &o.Artist.Name, &o.Artist.AvatarURL, &o.CreatedAt)
	if err != nil {
		return o, err
	}
	o.MyRole = "buyer"
	if viewerID == o.Artist.ID {
		o.MyRole = "artist"
	}
	if o.Status == "accepted" || o.Status == "used" {
		agreed := o.AmountKop
		if o.CounterKop != nil {
			agreed = *o.CounterKop
		}
		o.AgreedKop = &agreed
	}
	return o, nil
}

func (s *Server) loadOffer(ctx context.Context, id, viewerID string) (offerDTO, error) {
	o, err := scanOffer(s.DB.QueryRow(ctx, offerSelect+`WHERE o.id = $1 AND (o.buyer_id = $2 OR o.artist_id = $2)`, id, viewerID), viewerID)
	if isNoRows(err) {
		return o, httpx.NotFound("Предложение не найдено")
	}
	return o, err
}

// offersPerDay — сколько предложений покупатель может отправить за сутки (защита от спама).
const offersPerDay = 10

func (s *Server) createOffer(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	artworkID, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		AmountKop int64  `json:"amount_kop"`
		Message   string `json:"message"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	msg := strings.TrimSpace(in.Message)
	if utf8.RuneCountInString(msg) > 500 {
		return httpx.Validation(map[string]string{"message": "Сообщение — до 500 символов"})
	}
	var offerID, artistID, title string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var status string
		var price int64
		var allow bool
		err := tx.QueryRow(r.Context(), `SELECT artist_id, status, price_kop, allow_offers, title FROM artworks WHERE id = $1 FOR UPDATE`, artworkID).
			Scan(&artistID, &status, &price, &allow, &title)
		if isNoRows(err) {
			return httpx.NotFound("Работа не найдена")
		}
		if err != nil {
			return err
		}
		if artistID == u.ID {
			return httpx.BadRequest("Нельзя предложить цену за свою работу")
		}
		if status != "published" {
			return httpx.Conflict("artwork_unavailable", "Работа сейчас не продаётся")
		}
		if !domain.CurrentSettings().OffersEnabled {
			return httpx.Conflict("feature_disabled", "Предложения цены временно недоступны")
		}
		if !allow {
			return httpx.Conflict("offers_disabled", "Художник не принимает предложения цены за эту работу")
		}
		if onVacation, until, err := artistOnVacation(r.Context(), tx, artistID); err != nil {
			return err
		} else if onVacation {
			return vacationError(until)
		}
		switch err := domain.ValidateOffer(price, in.AmountKop); {
		case errors.Is(err, domain.ErrOfferTooHigh):
			return httpx.Validation(map[string]string{"amount_kop": "Предложение должно быть ниже цены — или просто купите работу"})
		case errors.Is(err, domain.ErrOfferTooLow):
			return httpx.Validation(map[string]string{"amount_kop": "Минимальное предложение — " + rub(domain.OfferMinimum(price))})
		}
		if _, err := tx.Exec(r.Context(), `UPDATE offers SET status = 'expired', updated_at = now()
			WHERE artwork_id = $1 AND buyer_id = $2 AND status IN ('pending','countered','accepted') AND expires_at <= now()`, artworkID, u.ID); err != nil {
			return err
		}
		var recent int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM offers WHERE buyer_id = $1 AND created_at > now() - interval '1 day'`, u.ID).Scan(&recent); err != nil {
			return err
		}
		if recent >= offersPerDay {
			return httpx.Conflict("too_many_offers", "Слишком много предложений за сутки — попробуйте завтра")
		}
		err = tx.QueryRow(r.Context(), `INSERT INTO offers (artwork_id, buyer_id, artist_id, amount_kop, message, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, artworkID, u.ID, artistID, in.AmountKop, msg, time.Now().Add(domain.OfferTTL)).Scan(&offerID)
		if isUniqueViolation(err) {
			return httpx.Conflict("offer_exists", "У вас уже есть открытое предложение по этой работе")
		}
		return err
	})
	if err != nil {
		return err
	}
	s.notify(r.Context(), artistID, "offer_new", tr("Предложение цены", "Price offer"),
		tr("За «%s» предлагают %s", "Someone offers %[2]s for “%[1]s”", title, rub(in.AmountKop)), map[string]any{"offer_id": offerID})
	o, err := s.loadOffer(r.Context(), offerID, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, o, nil)
	return nil
}

func (s *Server) listOffers(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	col := "o.buyer_id"
	switch r.URL.Query().Get("role") {
	case "artist":
		col = "o.artist_id"
	case "", "buyer":
	default:
		return httpx.BadRequest("role: buyer или artist")
	}
	cond := col + " = $1"
	if r.URL.Query().Get("status") == "open" {
		cond += " AND o.status IN ('pending','countered','accepted') AND o.expires_at > now()"
	}
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf("%s WHERE %s ORDER BY o.updated_at DESC LIMIT %d OFFSET %d", offerSelect, cond, p.limit, p.offset), u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []offerDTO{}
	for rows.Next() {
		o, err := scanOffer(rows, u.ID)
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

func (s *Server) getOffer(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	o, err := s.loadOffer(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, o)
	return nil
}

// offerAction: художник — accept, decline, counter; покупатель — accept (встречную цену), decline, withdraw.
func (s *Server) offerAction(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	action := r.PathValue("action")
	var in struct {
		AmountKop int64 `json:"amount_kop"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
	}
	var notifyUser, title, typ string
	var heading, body text
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var buyerID, artistID, artworkID, status, artStatus string
		var amount, price int64
		var counter *int64
		var expires time.Time
		err := tx.QueryRow(r.Context(), `SELECT o.buyer_id, o.artist_id, o.artwork_id, o.status, o.amount_kop, o.counter_kop, o.expires_at,
				a.price_kop, a.status, a.title
			FROM offers o JOIN artworks a ON a.id = o.artwork_id WHERE o.id = $1 FOR UPDATE OF o, a`, id).
			Scan(&buyerID, &artistID, &artworkID, &status, &amount, &counter, &expires, &price, &artStatus, &title)
		if isNoRows(err) || (err == nil && u.ID != buyerID && u.ID != artistID) {
			return httpx.NotFound("Предложение не найдено")
		}
		if err != nil {
			return err
		}
		if !expires.After(time.Now()) && (status == "pending" || status == "countered" || status == "accepted") {
			return httpx.Conflict("offer_expired", "Срок предложения истёк")
		}
		isArtist := u.ID == artistID
		switch {
		case isArtist && action == "accept" && status == "pending":
			if artStatus != "published" {
				return httpx.Conflict("artwork_unavailable", "Работа уже не продаётся")
			}
			if err := acceptOffer(r.Context(), tx, id, artworkID, buyerID, amount); err != nil {
				return err
			}
			notifyUser, typ = buyerID, "offer_accepted"
			heading = tr("Предложение принято", "Offer accepted")
			if domain.CurrentSettings().DirectDeals() {
				body = tr("«%s» за %s — напишите художнику, чтобы договориться об оплате и доставке", "“%s” for %s — message the artist to agree on payment and delivery", title, rub(amount))
			} else {
				body = tr("«%s» за %s — оформите заказ в течение 24 часов", "“%s” for %s — place the order within 24 hours", title, rub(amount))
			}
		case isArtist && action == "decline" && status == "pending":
			if err := setOfferStatus(r.Context(), tx, id, "declined"); err != nil {
				return err
			}
			notifyUser, typ = buyerID, "offer_declined"
			heading = tr("Предложение отклонено", "Offer declined")
			body = tr("Художник не принял предложение за «%s»", "The artist declined your offer for “%s”", title)
		case isArtist && action == "counter" && status == "pending":
			if in.AmountKop <= amount || in.AmountKop >= price {
				return httpx.Validation(map[string]string{"amount_kop": "Встречная цена — между предложением покупателя и ценой работы"})
			}
			if _, err := tx.Exec(r.Context(), `UPDATE offers SET status = 'countered', counter_kop = $2, expires_at = $3, updated_at = now() WHERE id = $1`,
				id, in.AmountKop, time.Now().Add(domain.OfferTTL)); err != nil {
				return err
			}
			notifyUser, typ = buyerID, "offer_countered"
			heading = tr("Встречное предложение", "Counter-offer")
			body = tr("Художник готов продать «%s» за %s", "The artist will sell “%s” for %s", title, rub(in.AmountKop))
		case !isArtist && action == "accept" && status == "countered":
			if artStatus != "published" {
				return httpx.Conflict("artwork_unavailable", "Работа уже не продаётся")
			}
			if err := acceptOffer(r.Context(), tx, id, artworkID, buyerID, *counter); err != nil {
				return err
			}
			notifyUser, typ = artistID, "offer_accepted"
			heading = tr("Встречная цена принята", "Counter-offer accepted")
			body = tr("Покупатель согласен на %s за «%s»", "The buyer agreed to %s for “%s”", rub(*counter), title)
		case !isArtist && action == "decline" && status == "countered":
			if err := setOfferStatus(r.Context(), tx, id, "declined"); err != nil {
				return err
			}
			notifyUser, typ = artistID, "offer_declined"
			heading = tr("Встречная цена отклонена", "Counter-offer declined")
			body = tr("Покупатель отказался от «%s»", "The buyer declined “%s”", title)
		case !isArtist && action == "withdraw" && (status == "pending" || status == "countered" || status == "accepted"):
			if err := setOfferStatus(r.Context(), tx, id, "withdrawn"); err != nil {
				return err
			}
			_, err := tx.Exec(r.Context(), `UPDATE price_locks SET released_at = now() WHERE source = 'offer' AND source_id = $1 AND used_at IS NULL`, id)
			return err
		default:
			return httpx.Conflict("invalid_transition", "Это действие недоступно")
		}
		return nil
	})
	if err != nil {
		return err
	}
	if notifyUser != "" {
		s.notify(r.Context(), notifyUser, typ, heading, body, map[string]any{"offer_id": id})
	}
	o, err := s.loadOffer(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, o)
	return nil
}

func setOfferStatus(ctx context.Context, tx pgx.Tx, id, status string) error {
	_, err := tx.Exec(ctx, `UPDATE offers SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	return err
}

// acceptOffer фиксирует согласие и выдаёт покупателю бронь цены на 24 часа.
func acceptOffer(ctx context.Context, tx pgx.Tx, offerID, artworkID, buyerID string, priceKop int64) error {
	exp := time.Now().Add(domain.AcceptedOfferTTL)
	if _, err := tx.Exec(ctx, `UPDATE offers SET status = 'accepted', expires_at = $2, updated_at = now() WHERE id = $1`, offerID, exp); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO price_locks (artwork_id, user_id, price_kop, source, source_id, expires_at)
		VALUES ($1, $2, $3, 'offer', $4, $5)`, artworkID, buyerID, priceKop, offerID, exp)
	return err
}

// ExpireOffers закрывает просроченные предложения. Возвращает число закрытых.
func (s *Server) ExpireOffers(ctx context.Context) (int, error) {
	tag, err := s.DB.Exec(ctx, `UPDATE offers SET status = 'expired', updated_at = now()
		WHERE status IN ('pending','countered','accepted') AND expires_at <= now()`)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// ReleaseExpiredLocks снимает истёкшие брони цены. Работа победителя аукциона, который не оформил
// заказ, возвращается в продажу.
func (s *Server) ReleaseExpiredLocks(ctx context.Context) (int, error) {
	// снятие брони и возврат работы в продажу — одна команда: работа не зависнет в «reserved»,
	// если второй шаг не выполнится
	var n int
	err := s.DB.QueryRow(ctx, `WITH released AS (
			UPDATE price_locks SET released_at = now()
			WHERE used_at IS NULL AND released_at IS NULL AND expires_at <= now()
			RETURNING artwork_id, source
		), relisted AS (
			UPDATE artworks a SET status = 'published', updated_at = now()
			WHERE a.id IN (SELECT artwork_id FROM released WHERE source = 'auction') AND a.status = 'reserved'
			AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.artwork_id = a.id AND o.status IN ('awaiting_payment','paid','confirmed','shipped'))
			RETURNING a.id
		)
		SELECT count(*) FROM released`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("release locks: %w", err)
	}
	return n, nil
}

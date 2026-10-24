package api

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

type promotionDTO struct {
	ID       string       `json:"id"`
	Artwork  orderArtwork `json:"artwork"`
	Days     int          `json:"days"`
	PriceKop int64        `json:"price_kop"`
	Status   string       `json:"status"`
	StartsAt *time.Time   `json:"starts_at"`
	EndsAt   *time.Time   `json:"ends_at"`
	Created  time.Time    `json:"created_at"`
}

// promoteArtwork — художник оплачивает поднятие работы в ленте и поиске.
func (s *Server) promoteArtwork(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Days int `json:"days"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if !s.socialLimiter.Allow("promote:" + u.ID) {
		return httpx.TooMany()
	}
	price, ok := domain.PromotionPrice(in.Days)
	if !ok {
		return httpx.Validation(map[string]string{"days": "Выберите срок продвижения из списка"})
	}
	var artistID, status, title string
	err = s.DB.QueryRow(r.Context(), `SELECT artist_id, status, title FROM artworks WHERE id = $1`, id).Scan(&artistID, &status, &title)
	if isNoRows(err) || (err == nil && artistID != u.ID) {
		return httpx.NotFound("Работа не найдена")
	}
	if err != nil {
		return err
	}
	if status != "published" && status != "auction" {
		return httpx.Conflict("artwork_unavailable", "Продвигать можно работу в продаже или на аукционе")
	}
	var promoID string
	if err := s.DB.QueryRow(r.Context(), `INSERT INTO promotions (artwork_id, artist_id, days, price_kop) VALUES ($1,$2,$3,$4) RETURNING id`,
		id, u.ID, in.Days, price).Scan(&promoID); err != nil {
		return err
	}
	p, err := s.createPayment(r.Context(), paymentSpec{userID: u.ID, purpose: "promotion", promotionID: &promoID, amount: price,
		desc: "Artista: продвижение «" + title + "»"})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, p, nil)
	return nil
}

// activatePromotion включает оплаченное продвижение; если работа уже продвигается — продлевает.
func activatePromotion(ctx context.Context, tx pgx.Tx, promotionID string) error {
	// блокируем работу: две оплаты подряд должны сложить сроки, а не начаться одновременно
	if _, err := tx.Exec(ctx, `SELECT 1 FROM artworks WHERE id = (SELECT artwork_id FROM promotions WHERE id = $1) FOR UPDATE`, promotionID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE promotions p SET status = 'active',
			starts_at = greatest(now(), coalesce((SELECT max(ends_at) FROM promotions x
				WHERE x.artwork_id = p.artwork_id AND x.status = 'active' AND x.id <> p.id), now())),
			ends_at = greatest(now(), coalesce((SELECT max(ends_at) FROM promotions x
				WHERE x.artwork_id = p.artwork_id AND x.status = 'active' AND x.id <> p.id), now())) + make_interval(days => p.days)
		WHERE p.id = $1 AND p.status = 'pending'`, promotionID)
	return err
}

func (s *Server) myPromotions(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	rows, err := s.DB.Query(r.Context(), `SELECT p.id, a.id, a.title,
			coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''),
			p.days, p.price_kop, CASE WHEN p.status = 'active' AND p.ends_at <= now() THEN 'ended' ELSE p.status END,
			p.starts_at, p.ends_at, p.created_at
		FROM promotions p JOIN artworks a ON a.id = p.artwork_id
		WHERE p.artist_id = $1 AND p.status <> 'pending' ORDER BY p.created_at DESC LIMIT 100`, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []promotionDTO{}
	for rows.Next() {
		var p promotionDTO
		if err := rows.Scan(&p.ID, &p.Artwork.ID, &p.Artwork.Title, &p.Artwork.ImageURL, &p.Days, &p.PriceKop, &p.Status,
			&p.StartsAt, &p.EndsAt, &p.Created); err != nil {
			return err
		}
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, items)
	return nil
}

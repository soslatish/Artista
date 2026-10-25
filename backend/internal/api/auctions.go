package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

type bidDTO struct {
	Bidder    string    `json:"bidder"` // «Участник 3» — имена участников не раскрываются
	AmountKop int64     `json:"amount_kop"`
	IsMine    bool      `json:"is_mine"`
	CreatedAt time.Time `json:"created_at"`
}

type auctionDTO struct {
	ID          string       `json:"id"`
	ArtworkID   string       `json:"artwork_id"`
	ArtistID    string       `json:"artist_id"`
	Status      string       `json:"status"`
	StartKop    int64        `json:"start_kop"`
	StepKop     int64        `json:"step_kop"`
	CurrentKop  *int64       `json:"current_kop"`
	MinBidKop   int64        `json:"min_bid_kop"`
	BidsCount   int          `json:"bids_count"`
	EndsAt      time.Time    `json:"ends_at"`
	IsLeader    bool         `json:"is_leader"`
	IWon        bool         `json:"i_won"`
	CheckoutTil *time.Time   `json:"checkout_until"`
	Bids        []bidDTO     `json:"bids"`
	Artwork     orderArtwork `json:"artwork"`
}

func (s *Server) loadAuction(ctx context.Context, id, viewerID string) (auctionDTO, error) {
	var a auctionDTO
	var leader, winner *string
	err := s.DB.QueryRow(ctx, `SELECT au.id, au.artwork_id, au.artist_id, au.status, au.start_kop, au.step_kop, au.current_kop,
			au.bids_count, au.ends_at, au.leader_id, au.winner_id, art.title,
			coalesce((SELECT url FROM artwork_images WHERE artwork_id = art.id ORDER BY position LIMIT 1), '')
		FROM auctions au JOIN artworks art ON art.id = au.artwork_id WHERE au.id = $1`, id).
		Scan(&a.ID, &a.ArtworkID, &a.ArtistID, &a.Status, &a.StartKop, &a.StepKop, &a.CurrentKop, &a.BidsCount, &a.EndsAt,
			&leader, &winner, &a.Artwork.Title, &a.Artwork.ImageURL)
	if isNoRows(err) {
		return a, httpx.NotFound("Аукцион не найден")
	}
	if err != nil {
		return a, err
	}
	a.Artwork.ID = a.ArtworkID
	a.MinBidKop = domain.MinNextBid(a.StartKop, a.StepKop, a.CurrentKop)
	a.IsLeader = viewerID != "" && leader != nil && *leader == viewerID
	a.IWon = viewerID != "" && winner != nil && *winner == viewerID
	if a.IWon {
		var until time.Time
		err := s.DB.QueryRow(ctx, `SELECT expires_at FROM price_locks WHERE source = 'auction' AND source_id = $1 AND user_id = $2
			AND used_at IS NULL AND released_at IS NULL`, id, viewerID).Scan(&until)
		if err == nil {
			a.CheckoutTil = &until
		} else if !isNoRows(err) {
			return a, err
		}
	}
	// участники нумеруются по первой ставке
	rows, err := s.DB.Query(ctx, `WITH firsts AS (
			SELECT user_id, row_number() OVER (ORDER BY min(created_at)) AS n FROM bids WHERE auction_id = $1 GROUP BY user_id)
		SELECT f.n, b.user_id = $2::uuid, b.amount_kop, b.created_at FROM bids b JOIN firsts f ON f.user_id = b.user_id
		WHERE b.auction_id = $1 ORDER BY b.amount_kop DESC LIMIT 20`, id, nullableID(viewerID))
	if err != nil {
		return a, err
	}
	defer rows.Close()
	a.Bids = []bidDTO{}
	for rows.Next() {
		var b bidDTO
		var n int
		if err := rows.Scan(&n, &b.IsMine, &b.AmountKop, &b.CreatedAt); err != nil {
			return a, err
		}
		b.Bidder = "Участник " + itoa(n)
		a.Bids = append(a.Bids, b)
	}
	return a, rows.Err()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// startAuction — художник выставляет работу на аукцион.
func (s *Server) startAuction(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	artworkID, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if !domain.CurrentSettings().AuctionsEnabled {
		return httpx.Conflict("feature_disabled", "Аукционы временно недоступны")
	}
	if !s.socialLimiter.Allow("auction:" + u.ID) {
		return httpx.TooMany()
	}
	var in struct {
		StartKop int64 `json:"start_kop"`
		Days     int   `json:"days"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	errs := map[string]string{}
	if in.StartKop < domain.MinArtworkPriceKop || in.StartKop > domain.MaxArtworkPriceKop {
		errs["start_kop"] = "Стартовая цена — от 3 000 до 500 000 ₽"
	}
	if in.Days < domain.AuctionMinDays || in.Days > domain.AuctionMaxDays {
		errs["days"] = "Длительность — от 1 до 7 дней"
	}
	if len(errs) > 0 {
		return httpx.Validation(errs)
	}
	var auctionID, title string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		cur, status, err := ownArtworkForUpdate(r.Context(), tx, artworkID, u.ID)
		if err != nil {
			return err
		}
		if status != "published" && status != "draft" {
			return httpx.Conflict("bad_status", "На аукцион можно выставить черновик или работу в продаже")
		}
		if errs := domain.ValidateArtwork(cur, true); len(errs) > 0 {
			return httpx.Validation(errs)
		}
		title = cur.Title
		if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'auction', published_at = coalesce(published_at, now()), updated_at = now() WHERE id = $1`, artworkID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE offers SET status = 'expired', updated_at = now()
			WHERE artwork_id = $1 AND status IN ('pending','countered','accepted')`, artworkID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE price_locks SET released_at = now() WHERE artwork_id = $1 AND used_at IS NULL AND released_at IS NULL`, artworkID); err != nil {
			return err
		}
		return tx.QueryRow(r.Context(), `INSERT INTO auctions (artwork_id, artist_id, start_kop, step_kop, ends_at)
			VALUES ($1,$2,$3,$4,$5) RETURNING id`, artworkID, u.ID, in.StartKop, domain.AuctionStep(in.StartKop),
			time.Now().Add(time.Duration(in.Days)*24*time.Hour)).Scan(&auctionID)
	})
	if err != nil {
		return err
	}
	s.background(time.Minute, func(ctx context.Context) {
		var artistName string
		if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, u.ID).Scan(&artistName); err != nil {
			return
		}
		s.notifyMany(ctx, `SELECT follower_id FROM follows WHERE artist_id = $1`, []any{u.ID}, "auction_started",
			tr("Аукцион: %s", "Auction by %s", artistName), tr("«%s» — торги начались", "“%s” — bidding is open", title),
			map[string]any{"artwork_id": artworkID, "auction_id": auctionID})
	})
	a, err := s.loadAuction(r.Context(), auctionID, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, a, nil)
	return nil
}

func (s *Server) getAuction(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	a, err := s.loadAuction(r.Context(), id, viewer.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, a)
	return nil
}

// maxBidMultiplier — ставка не больше чем в 10 раз выше стартовой (защита от опечатки).
const maxBidMultiplier = 10

func (s *Server) placeBid(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if !domain.CurrentSettings().AuctionsEnabled {
		return httpx.Conflict("feature_disabled", "Аукционы временно недоступны")
	}
	if !s.socialLimiter.Allow("bid:" + u.ID) {
		return httpx.TooMany()
	}
	var in struct {
		AmountKop int64 `json:"amount_kop"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	var artistID, artworkID, title string
	var prevLeader *string
	var participants []string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var status string
		var start, step int64
		var current *int64
		var ends time.Time
		err := tx.QueryRow(r.Context(), `SELECT au.artist_id, au.artwork_id, au.status, au.start_kop, au.step_kop, au.current_kop, au.ends_at, au.leader_id, a.title
			FROM auctions au JOIN artworks a ON a.id = au.artwork_id WHERE au.id = $1 FOR UPDATE OF au`, id).
			Scan(&artistID, &artworkID, &status, &start, &step, &current, &ends, &prevLeader, &title)
		if isNoRows(err) {
			return httpx.NotFound("Аукцион не найден")
		}
		if err != nil {
			return err
		}
		if artistID == u.ID {
			return httpx.BadRequest("Нельзя делать ставки на свою работу")
		}
		now := time.Now()
		if status != "live" || !ends.After(now) {
			return httpx.Conflict("auction_closed", "Торги уже завершены")
		}
		if prevLeader != nil && *prevLeader == u.ID {
			return httpx.Conflict("already_leading", "Ваша ставка и так лидирует")
		}
		minBid := domain.MinNextBid(start, step, current)
		if in.AmountKop < minBid {
			return httpx.Validation(map[string]string{"amount_kop": "Минимальная ставка — " + rub(minBid)})
		}
		if in.AmountKop > start*maxBidMultiplier {
			return httpx.Validation(map[string]string{"amount_kop": "Слишком большая ставка — проверьте сумму"})
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO bids (auction_id, user_id, amount_kop) VALUES ($1,$2,$3)`, id, u.ID, in.AmountKop); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE auctions SET current_kop = $2, leader_id = $3, bids_count = bids_count + 1, ends_at = $4 WHERE id = $1`,
			id, in.AmountKop, u.ID, domain.ExtendForSnipe(ends, now)); err != nil {
			return err
		}
		participants, err = collectIDs(r.Context(), tx, `SELECT DISTINCT user_id::text FROM bids WHERE auction_id = $1`, id)
		return err
	})
	if err != nil {
		return err
	}
	a, err := s.loadAuction(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	// всем участникам и художнику — обновление в реальном времени (без персональных полей)
	event := Event{Type: "auction_bid", Data: map[string]any{"auction_id": id, "artwork_id": artworkID,
		"current_kop": a.CurrentKop, "bids_count": a.BidsCount, "ends_at": a.EndsAt, "min_bid_kop": a.MinBidKop}}
	for _, p := range append(participants, artistID) {
		s.hub.Send(p, event)
	}
	if prevLeader != nil {
		s.notify(r.Context(), *prevLeader, "auction_outbid", tr("Вашу ставку перебили", "You have been outbid"),
			tr("«%s» — новая ставка %s", "“%s” — new bid %s", title, rub(in.AmountKop)),
			map[string]any{"artwork_id": artworkID, "auction_id": id})
	}
	httpx.JSON(w, http.StatusCreated, a, nil)
	return nil
}

// cancelAuction — художник снимает аукцион, пока ставок нет.
func (s *Server) cancelAuction(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var artistID, artworkID, status string
		var bids int
		err := tx.QueryRow(r.Context(), `SELECT artist_id, artwork_id, status, bids_count FROM auctions WHERE id = $1 FOR UPDATE`, id).
			Scan(&artistID, &artworkID, &status, &bids)
		if isNoRows(err) || (err == nil && artistID != u.ID) {
			return httpx.NotFound("Аукцион не найден")
		}
		if err != nil {
			return err
		}
		if status != "live" {
			return httpx.Conflict("auction_closed", "Аукцион уже завершён")
		}
		if bids > 0 {
			return httpx.Conflict("auction_has_bids", "Есть ставки — аукцион нельзя отменить")
		}
		if _, err := tx.Exec(r.Context(), `UPDATE auctions SET status = 'cancelled', ended_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE artworks SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'auction'`, artworkID)
		return err
	})
	if err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// CloseAuctions завершает торги с истёкшим сроком: победитель получает бронь цены на 48 часов,
// работа резервируется за ним. Без ставок работа возвращается в продажу. Возвращает число закрытых.
func (s *Server) CloseAuctions(ctx context.Context) (int, error) {
	ids, err := collectIDs(ctx, s.DB, `SELECT id FROM auctions WHERE status = 'live' AND ends_at <= now() ORDER BY ends_at LIMIT 50`)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, id := range ids {
		if err := s.closeAuction(ctx, id); err != nil {
			if !errors.Is(err, errStale) {
				s.Log.Warn("close auction", "auction_id", id, "err", err)
			}
			continue
		}
		done++
	}
	return done, nil
}

func (s *Server) closeAuction(ctx context.Context, id string) error {
	var artistID, artworkID, title string
	var leader *string
	var current *int64
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var status string
		var ends time.Time
		err := tx.QueryRow(ctx, `SELECT au.artist_id, au.artwork_id, au.status, au.ends_at, au.leader_id, au.current_kop, a.title
			FROM auctions au JOIN artworks a ON a.id = au.artwork_id WHERE au.id = $1 FOR UPDATE OF au`, id).
			Scan(&artistID, &artworkID, &status, &ends, &leader, &current, &title)
		if err != nil {
			return err
		}
		if status != "live" || ends.After(time.Now()) {
			return errStale // ставка продлила торги или аукцион уже закрыт
		}
		if _, err := tx.Exec(ctx, `UPDATE auctions SET status = 'ended', winner_id = leader_id, ended_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		if leader == nil {
			_, err := tx.Exec(ctx, `UPDATE artworks SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'auction'`, artworkID)
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE artworks SET status = 'reserved', updated_at = now() WHERE id = $1 AND status = 'auction'`, artworkID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // работу скрыл модератор — бронь победителю не выдаём
		}
		_, err = tx.Exec(ctx, `INSERT INTO price_locks (artwork_id, user_id, price_kop, source, source_id, expires_at)
			VALUES ($1, $2, $3, 'auction', $4, $5)`, artworkID, *leader, *current, id, time.Now().Add(domain.AuctionCheckoutTTL))
		return err
	})
	if err != nil {
		return err
	}
	data := map[string]any{"artwork_id": artworkID, "auction_id": id}
	if leader == nil {
		s.notify(ctx, artistID, "auction_ended", tr("Аукцион завершён", "Auction ended"),
			tr("Ставок на «%s» не было — работа снова в продаже по обычной цене", "No bids on “%s” — it is back on sale at the regular price", title), data)
		return nil
	}
	if domain.CurrentSettings().DirectDeals() {
		s.notify(ctx, *leader, "auction_won", tr("Вы выиграли аукцион", "You won the auction"),
			tr("«%s» за %s — напишите художнику, чтобы договориться об оплате и доставке", "“%s” for %s — message the artist to agree on payment and delivery", title, rub(*current)), data)
		s.notify(ctx, artistID, "auction_ended", tr("Аукцион завершён", "Auction ended"),
			tr("«%s» — итоговая ставка %s. Свяжитесь с победителем в чате.", "“%s” — winning bid %s. Contact the winner in the chat.", title, rub(*current)), data)
		return nil
	}
	s.notify(ctx, *leader, "auction_won", tr("Вы выиграли аукцион", "You won the auction"),
		tr("«%s» за %s — оформите заказ в течение 48 часов", "“%s” for %s — place the order within 48 hours", title, rub(*current)), data)
	s.notify(ctx, artistID, "auction_ended", tr("Аукцион завершён", "Auction ended"),
		tr("«%s» — итоговая ставка %s. Ждём оформления заказа победителем.", "“%s” — winning bid %s. Waiting for the winner to place the order.", title, rub(*current)), data)
	return nil
}

// cancelArtworkDeals отменяет живые аукционы, предложения и брони по работам, которые скрывает модератор
// (where — условие на artworks a с параметром $1).
func cancelArtworkDeals(ctx context.Context, tx pgx.Tx, where, arg string) error {
	for _, q := range []string{
		`UPDATE auctions SET status = 'cancelled', ended_at = now() WHERE status = 'live' AND artwork_id IN (SELECT a.id FROM artworks a WHERE ` + where + `)`,
		`UPDATE offers SET status = 'expired', updated_at = now() WHERE status IN ('pending','countered','accepted') AND artwork_id IN (SELECT a.id FROM artworks a WHERE ` + where + `)`,
		`UPDATE price_locks SET released_at = now() WHERE used_at IS NULL AND released_at IS NULL AND artwork_id IN (SELECT a.id FROM artworks a WHERE ` + where + `)`,
	} {
		if _, err := tx.Exec(ctx, q, arg); err != nil {
			return fmt.Errorf("cancel deals: %w", err)
		}
	}
	return nil
}

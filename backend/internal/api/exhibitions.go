package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// Выставка-дроп: художник анонсирует серию работ на время, подписчики получают напоминание,
// в момент открытия работы появляются в продаже разом.

type exhibitionDTO struct {
	ID            string      `json:"id"`
	Title         string      `json:"title"`
	Description   string      `json:"description"`
	CoverURL      string      `json:"cover_url"`
	StartsAt      time.Time   `json:"starts_at"`
	Status        string      `json:"status"` // upcoming | open | cancelled
	Artist        artistBrief `json:"artist"`
	ArtworksCount int         `json:"artworks_count"`
	Reminders     int         `json:"reminders"`
	Reminded      bool        `json:"reminded"`
}

// exhibitionSelect: $1 — зритель (может быть NULL).
const exhibitionSelect = `SELECT e.id, e.title, e.description,
	coalesce(nullif(e.cover_url, ''), (SELECT i.url FROM artworks a JOIN artwork_images i ON i.artwork_id = a.id AND i.position = 0
		WHERE a.exhibition_id = e.id ORDER BY a.created_at LIMIT 1), ''),
	e.starts_at, CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled' WHEN e.opened_at IS NOT NULL THEN 'open' ELSE 'upcoming' END,
	u.id, u.name, u.avatar_url, u.city, coalesce(u.premium_until > now(), false),
	(SELECT count(*) FROM artworks a WHERE a.exhibition_id = e.id AND a.status <> 'hidden'),
	(SELECT count(*) FROM exhibition_reminders r WHERE r.exhibition_id = e.id),
	EXISTS(SELECT 1 FROM exhibition_reminders r WHERE r.exhibition_id = e.id AND r.user_id = $1::uuid)
FROM exhibitions e JOIN users u ON u.id = e.artist_id `

func scanExhibition(row pgx.Row) (exhibitionDTO, error) {
	var e exhibitionDTO
	err := row.Scan(&e.ID, &e.Title, &e.Description, &e.CoverURL, &e.StartsAt, &e.Status,
		&e.Artist.ID, &e.Artist.Name, &e.Artist.AvatarURL, &e.Artist.City, &e.Artist.IsPremium,
		&e.ArtworksCount, &e.Reminders, &e.Reminded)
	return e, err
}

func (s *Server) loadExhibition(ctx context.Context, id, viewerID string) (exhibitionDTO, error) {
	e, err := scanExhibition(s.DB.QueryRow(ctx, exhibitionSelect+`WHERE e.id = $2`, nullableID(viewerID), id))
	if isNoRows(err) {
		return e, httpx.NotFound("Выставка не найдена")
	}
	return e, err
}

// listExhibitions — ?status=upcoming (по умолчанию: ближайшие и открытые за 14 дней), ?artist_id=.
func (s *Server) listExhibitions(w http.ResponseWriter, r *http.Request) error {
	viewer, _ := s.userFromRequest(r)
	q := r.URL.Query()
	b := &queryBuilder{}
	b.arg(nullableID(viewer.ID))
	b.add("e.cancelled_at IS NULL AND u.deleted_at IS NULL AND u.banned_at IS NULL")
	switch q.Get("status") {
	case "upcoming":
		b.add("e.opened_at IS NULL")
	case "open":
		b.add("e.opened_at IS NOT NULL")
	default:
		b.add("(e.opened_at IS NULL OR e.opened_at > now() - interval '14 days')")
	}
	if a := q.Get("artist_id"); a != "" {
		if !isUUID(a) {
			return httpx.BadRequest("Некорректный artist_id")
		}
		b.add("e.artist_id = ?", a)
	}
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf("%s %s ORDER BY (e.opened_at IS NULL) DESC, e.starts_at LIMIT %d OFFSET %d",
		exhibitionSelect, b.sql(), p.limit, p.offset), b.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []exhibitionDTO{}
	for rows.Next() {
		e, err := scanExhibition(rows)
		if err != nil {
			return err
		}
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) getExhibition(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	viewer, _ := s.userFromRequest(r)
	e, err := s.loadExhibition(r.Context(), id, viewer.ID)
	if err != nil {
		return err
	}
	if e.Status == "cancelled" && viewer.ID != e.Artist.ID {
		return httpx.NotFound("Выставка не найдена")
	}
	rows, err := s.DB.Query(r.Context(), artworkSelect+`WHERE a.exhibition_id = $2 AND a.status NOT IN ('hidden','draft','archived','commission')
		ORDER BY a.created_at`, nullableID(viewer.ID), id)
	if err != nil {
		return err
	}
	items, err := collectArtworks(rows)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, map[string]any{"exhibition": e})
	return nil
}

type exhibitionInput struct {
	Title       *string  `json:"title"`
	Description *string  `json:"description"`
	CoverURL    *string  `json:"cover_url"`
	StartsAt    *string  `json:"starts_at"` // RFC 3339
	ArtworkIDs  []string `json:"artwork_ids"`
}

func (s *Server) validateExhibition(ctx context.Context, in exhibitionInput, userID string, creating bool) (*time.Time, error) {
	errs := map[string]string{}
	if in.Title != nil || creating {
		t := ""
		if in.Title != nil {
			t = strings.TrimSpace(*in.Title)
		}
		if n := utf8.RuneCountInString(t); n < 2 || n > 100 {
			errs["title"] = "Название — от 2 до 100 символов"
		}
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > 2000 {
		errs["description"] = "Описание — до 2000 символов"
	}
	var starts *time.Time
	if in.StartsAt != nil || creating {
		raw := ""
		if in.StartsAt != nil {
			raw = *in.StartsAt
		}
		t, err := time.Parse(time.RFC3339, raw)
		now := time.Now()
		if err != nil || t.Before(now.Add(domain.ExhibitionMinLead)) || t.After(now.Add(domain.ExhibitionMaxLead)) {
			errs["starts_at"] = "Открытие — не раньше чем через 30 минут и не позже чем через 60 дней"
		} else {
			starts = &t
		}
	}
	if in.CoverURL != nil && *in.CoverURL != "" {
		*in.CoverURL = s.canonicalFileURL(*in.CoverURL)
		imgErrs, err := s.validateImages(ctx, userID, []string{*in.CoverURL})
		if err != nil {
			return nil, err
		}
		if imgErrs != nil {
			errs["cover_url"] = imgErrs["images"]
		}
	}
	if creating && (len(in.ArtworkIDs) == 0 || len(in.ArtworkIDs) > domain.ExhibitionMaxWork) {
		errs["artwork_ids"] = "Добавьте от 1 до 30 работ"
	}
	for _, id := range in.ArtworkIDs {
		if !isUUID(id) {
			errs["artwork_ids"] = "Некорректный id работы"
		}
	}
	if len(errs) > 0 {
		return nil, httpx.Validation(errs)
	}
	return starts, nil
}

// attachArtworks переводит черновики художника в статус «ждёт выставки».
func attachArtworks(ctx context.Context, tx pgx.Tx, exhibitionID, artistID string, ids []string) error {
	for _, id := range ids {
		cur, status, err := ownArtworkForUpdate(ctx, tx, id, artistID)
		if err != nil {
			return err
		}
		if status != "draft" {
			return httpx.Validation(map[string]string{"artwork_ids": "На выставку добавляются только черновики — новые работы"})
		}
		if errs := domain.ValidateArtwork(cur, true); len(errs) > 0 {
			return httpx.Validation(map[string]string{"artwork_ids": "«" + cur.Title + "»: заполните работу полностью (фото, цена, размер)"})
		}
		if _, err := tx.Exec(ctx, `UPDATE artworks SET status = 'scheduled', exhibition_id = $2, updated_at = now() WHERE id = $1`, id, exhibitionID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) createExhibition(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Выставки создают художники")
	}
	if !s.socialLimiter.Allow("exhibition:" + u.ID) {
		return httpx.TooMany()
	}
	var in exhibitionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	starts, err := s.validateExhibition(r.Context(), in, u.ID, true)
	if err != nil {
		return err
	}
	var id string
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		desc, cover := "", ""
		if in.Description != nil {
			desc = strings.TrimSpace(*in.Description)
		}
		if in.CoverURL != nil {
			cover = *in.CoverURL
		}
		if err := tx.QueryRow(r.Context(), `INSERT INTO exhibitions (artist_id, title, description, cover_url, starts_at)
			VALUES ($1,$2,$3,$4,$5) RETURNING id`, u.ID, strings.TrimSpace(*in.Title), desc, cover, *starts).Scan(&id); err != nil {
			return err
		}
		return attachArtworks(r.Context(), tx, id, u.ID, in.ArtworkIDs)
	})
	if err != nil {
		return err
	}
	title := strings.TrimSpace(*in.Title)
	s.background(time.Minute, func(ctx context.Context) {
		var name string
		if err := s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, u.ID).Scan(&name); err != nil {
			return
		}
		when := starts.In(moscow).Format("02.01 15:04")
		s.notifyMany(ctx, `SELECT follower_id FROM follows WHERE artist_id = $1`, []any{u.ID}, "exhibition_announced",
			tr("Скоро выставка: %s", "Upcoming show by %s", name),
			tr("«%s» откроется %s (МСК)", "“%s” opens on %s (Moscow time)", title, when),
			map[string]any{"exhibition_id": id})
	})
	e, err := s.loadExhibition(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, e, nil)
	return nil
}

// lockOwnExhibition — выставка художника, ещё не открытая и не отменённая.
func lockOwnExhibition(ctx context.Context, tx pgx.Tx, id, artistID string) error {
	var owner string
	var opened, cancelled *time.Time
	err := tx.QueryRow(ctx, `SELECT artist_id, opened_at, cancelled_at FROM exhibitions WHERE id = $1 FOR UPDATE`, id).Scan(&owner, &opened, &cancelled)
	if isNoRows(err) || (err == nil && owner != artistID) {
		return httpx.NotFound("Выставка не найдена")
	}
	if err != nil {
		return err
	}
	if opened != nil || cancelled != nil {
		return httpx.Conflict("exhibition_locked", "Выставка уже открыта или отменена")
	}
	return nil
}

func (s *Server) updateExhibition(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in exhibitionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	starts, err := s.validateExhibition(r.Context(), in, u.ID, false)
	if err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		if err := lockOwnExhibition(r.Context(), tx, id, u.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE exhibitions SET title = coalesce($2, title), description = coalesce($3, description),
				cover_url = coalesce($4, cover_url), starts_at = coalesce($5, starts_at) WHERE id = $1`,
			id, trimPtr(in.Title), trimPtr(in.Description), in.CoverURL, starts); err != nil {
			return err
		}
		if in.ArtworkIDs == nil {
			return nil
		}
		if len(in.ArtworkIDs) == 0 || len(in.ArtworkIDs) > domain.ExhibitionMaxWork {
			return httpx.Validation(map[string]string{"artwork_ids": "Добавьте от 1 до 30 работ"})
		}
		// убранные работы возвращаются в черновики
		if _, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'draft', exhibition_id = NULL, updated_at = now()
			WHERE exhibition_id = $1 AND status = 'scheduled' AND NOT (id = ANY($2::uuid[]))`, id, in.ArtworkIDs); err != nil {
			return err
		}
		var fresh []string
		for _, aid := range in.ArtworkIDs {
			var attached bool
			if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM artworks WHERE id = $1 AND exhibition_id = $2 AND status = 'scheduled')`, aid, id).Scan(&attached); err != nil {
				return err
			}
			if !attached {
				fresh = append(fresh, aid)
			}
		}
		return attachArtworks(r.Context(), tx, id, u.ID, fresh)
	})
	if err != nil {
		return err
	}
	e, err := s.loadExhibition(r.Context(), id, u.ID)
	if err != nil {
		return err
	}
	httpx.OK(w, e)
	return nil
}

func (s *Server) cancelExhibition(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		if err := lockOwnExhibition(r.Context(), tx, id, u.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE exhibitions SET cancelled_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `UPDATE artworks SET status = 'draft', exhibition_id = NULL, updated_at = now()
			WHERE exhibition_id = $1 AND status = 'scheduled'`, id)
		return err
	})
	if err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) remindExhibition(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `INSERT INTO exhibition_reminders (exhibition_id, user_id)
		SELECT id, $2 FROM exhibitions WHERE id = $1 AND opened_at IS NULL AND cancelled_at IS NULL ON CONFLICT DO NOTHING`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM exhibition_reminders WHERE exhibition_id = $1 AND user_id = $2)`, id, u.ID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.Conflict("exhibition_locked", "Выставка уже открыта или отменена")
		}
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) unremindExhibition(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `DELETE FROM exhibition_reminders WHERE exhibition_id = $1 AND user_id = $2`, id, u.ID); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// OpenExhibitions открывает выставки, время которых наступило: работы появляются в продаже,
// подписчики и те, кто просил напомнить, получают уведомление. Возвращает число открытых.
func (s *Server) OpenExhibitions(ctx context.Context) (int, error) {
	ids, err := collectIDs(ctx, s.DB, `SELECT id FROM exhibitions WHERE opened_at IS NULL AND cancelled_at IS NULL AND starts_at <= now()
		ORDER BY starts_at LIMIT 20`)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, id := range ids {
		var artistID, title string
		var artworks []string
		err := s.withTx(ctx, func(tx pgx.Tx) error {
			err := tx.QueryRow(ctx, `UPDATE exhibitions SET opened_at = now() WHERE id = $1 AND opened_at IS NULL AND cancelled_at IS NULL
				RETURNING artist_id, title`, id).Scan(&artistID, &title)
			if err != nil {
				return err
			}
			artworks, err = collectIDs(ctx, tx, `UPDATE artworks SET status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
				WHERE exhibition_id = $1 AND status = 'scheduled' RETURNING id::text`, id)
			return err
		})
		if isNoRows(err) {
			continue
		}
		if err != nil {
			s.Log.Warn("open exhibition", "exhibition_id", id, "err", err)
			continue
		}
		done++
		var name string
		_ = s.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, artistID).Scan(&name)
		s.notifyMany(ctx, `SELECT user_id FROM exhibition_reminders WHERE exhibition_id = $1
			UNION SELECT follower_id FROM follows WHERE artist_id = $2`, []any{id, artistID}, "exhibition_opened",
			tr("Выставка открылась", "The show is open"), tr("%s — «%s»", "%s — “%s”", name, title),
			map[string]any{"exhibition_id": id})
		for _, a := range artworks {
			s.matchSavedSearches(ctx, a)
		}
	}
	return done, nil
}

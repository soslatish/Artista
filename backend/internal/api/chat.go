package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/httpx"
)

const maxMessageLen = 2000

type messageDTO struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversation_id"`
	SenderID       string     `json:"sender_id"`
	Body           string     `json:"body"`
	ImageURL       string     `json:"image_url"`
	ReadAt         *time.Time `json:"read_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

type conversationDTO struct {
	ID          string        `json:"id"`
	Other       party         `json:"other"`
	Artwork     *orderArtwork `json:"artwork"`
	LastMessage *messageDTO   `json:"last_message"`
	Unread      int           `json:"unread"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// conversationParticipants проверяет участие и возвращает id собеседника.
func conversationOther(ctx context.Context, q querier, convID, userID string) (string, error) {
	var buyer, artist string
	err := q.QueryRow(ctx, `SELECT buyer_id, artist_id FROM conversations WHERE id = $1`, convID).Scan(&buyer, &artist)
	if isNoRows(err) || (err == nil && userID != buyer && userID != artist) {
		return "", httpx.NotFound("Диалог не найден")
	}
	if err != nil {
		return "", err
	}
	if userID == buyer {
		return artist, nil
	}
	return buyer, nil
}

func validateMessage(body, imageURL string) (string, error) {
	body = strings.TrimSpace(body)
	if (body == "" && imageURL == "") || utf8.RuneCountInString(body) > maxMessageLen {
		return "", httpx.Validation(map[string]string{"body": "Сообщение — от 1 до 2000 символов"})
	}
	return body, nil
}

// startConversation находит или создаёт диалог с пользователем и (опционально) пишет первое сообщение.
func (s *Server) startConversation(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		UserID    string  `json:"user_id"`
		ArtworkID *string `json:"artwork_id"`
		Message   string  `json:"message"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if !isUUID(in.UserID) || in.UserID == u.ID {
		return httpx.Validation(map[string]string{"user_id": "Некорректный собеседник"})
	}
	if in.ArtworkID != nil && !isUUID(*in.ArtworkID) {
		return httpx.Validation(map[string]string{"artwork_id": "Некорректная работа"})
	}
	var otherRole string
	err := s.DB.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, in.UserID).Scan(&otherRole)
	if isNoRows(err) {
		return httpx.NotFound("Пользователь не найден")
	}
	if err != nil {
		return err
	}
	// роли в диалоге: художник — тот, кто продаёт
	buyer, artist := u.ID, in.UserID
	if otherRole != "artist" {
		if u.Role != "artist" {
			return httpx.BadRequest("Писать можно художникам")
		}
		buyer, artist = in.UserID, u.ID
	}
	if in.ArtworkID != nil {
		var ok bool
		if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM artworks WHERE id = $1 AND artist_id = $2
			AND status IN ('published','reserved','sold'))`, *in.ArtworkID, artist).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return httpx.NotFound("Работа не найдена")
		}
	}
	var convID string
	err = s.DB.QueryRow(r.Context(), `INSERT INTO conversations (buyer_id, artist_id, artwork_id) VALUES ($1, $2, $3)
		ON CONFLICT (buyer_id, artist_id, coalesce(artwork_id, '00000000-0000-0000-0000-000000000000'::uuid))
		DO UPDATE SET buyer_id = excluded.buyer_id RETURNING id`, buyer, artist, in.ArtworkID).Scan(&convID)
	if err != nil {
		return fmt.Errorf("upsert conversation: %w", err)
	}
	if strings.TrimSpace(in.Message) != "" {
		if _, err := s.postMessage(r.Context(), convID, u.ID, in.UserID, in.Message, ""); err != nil {
			return err
		}
	}
	c, err := s.loadConversation(r.Context(), convID, u.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, c, nil)
	return nil
}

const conversationSelect = `SELECT c.id, c.last_message_at,
	o.id, o.name, o.avatar_url,
	a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''),
	m.id, m.sender_id, m.body, m.image_url, m.read_at, m.created_at,
	(SELECT count(*) FROM messages um WHERE um.conversation_id = c.id AND um.sender_id <> $1 AND um.read_at IS NULL)
FROM conversations c
JOIN users o ON o.id = CASE WHEN c.buyer_id = $1 THEN c.artist_id ELSE c.buyer_id END
LEFT JOIN artworks a ON a.id = c.artwork_id
LEFT JOIN LATERAL (SELECT * FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) m ON true `

func scanConversation(row pgx.Row) (conversationDTO, error) {
	var c conversationDTO
	var artID, artTitle, artImg, msgID, msgSender, msgBody, msgImage *string
	var msgRead, msgCreated *time.Time
	err := row.Scan(&c.ID, &c.UpdatedAt, &c.Other.ID, &c.Other.Name, &c.Other.AvatarURL,
		&artID, &artTitle, &artImg, &msgID, &msgSender, &msgBody, &msgImage, &msgRead, &msgCreated, &c.Unread)
	if err != nil {
		return c, err
	}
	if artID != nil {
		c.Artwork = &orderArtwork{ID: *artID, Title: *artTitle, ImageURL: deref(artImg)}
	}
	if msgID != nil {
		c.LastMessage = &messageDTO{ID: *msgID, ConversationID: c.ID, SenderID: *msgSender, Body: *msgBody, ImageURL: deref(msgImage),
			ReadAt: msgRead, CreatedAt: *msgCreated}
	}
	return c, nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *Server) loadConversation(ctx context.Context, id, userID string) (conversationDTO, error) {
	c, err := scanConversation(s.DB.QueryRow(ctx, conversationSelect+`WHERE c.id = $2 AND (c.buyer_id = $1 OR c.artist_id = $1)`, userID, id))
	if isNoRows(err) {
		return c, httpx.NotFound("Диалог не найден")
	}
	return c, err
}

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`%s WHERE (c.buyer_id = $1 OR c.artist_id = $1)
		AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id)
		ORDER BY c.last_message_at DESC LIMIT %d OFFSET %d`, conversationSelect, p.limit, p.offset), u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []conversationDTO{}
	for rows.Next() {
		c, err := scanConversation(rows)
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

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := conversationOther(r.Context(), s.DB, id, u.ID); err != nil {
		return err
	}
	p := parsePage(r)
	rows, err := s.DB.Query(r.Context(), fmt.Sprintf(`SELECT id, conversation_id, sender_id, body, image_url, read_at, created_at
		FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d`, p.limit, p.offset), id)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []messageDTO{}
	for rows.Next() {
		var m messageDTO
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ImageURL, &m.ReadAt, &m.CreatedAt); err != nil {
			return err
		}
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items, p.meta(len(items)))
	return nil
}

func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Body     string `json:"body"`
		ImageURL string `json:"image_url"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if in.ImageURL != "" {
		errs, err := s.validateImages(r.Context(), u.ID, []string{in.ImageURL})
		if err != nil {
			return err
		}
		if errs != nil {
			return httpx.Validation(map[string]string{"image_url": errs["images"]})
		}
	}
	other, err := conversationOther(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	m, err := s.postMessage(r.Context(), id, u.ID, other, in.Body, in.ImageURL)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, m, nil)
	return nil
}

func (s *Server) postMessage(ctx context.Context, convID, senderID, recipientID, body, imageURL string) (messageDTO, error) {
	body, err := validateMessage(body, imageURL)
	if err != nil {
		return messageDTO{}, err
	}
	var m messageDTO
	var senderName string
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, body, image_url) VALUES ($1, $2, $3, $4)
			RETURNING id, conversation_id, sender_id, body, image_url, read_at, created_at`, convID, senderID, body, imageURL).
			Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ImageURL, &m.ReadAt, &m.CreatedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = now() WHERE id = $1`, convID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, senderID).Scan(&senderName)
	})
	if err != nil {
		return messageDTO{}, err
	}
	s.hub.Send(recipientID, Event{Type: "message", Data: m})
	s.hub.Send(senderID, Event{Type: "message", Data: m})
	preview := truncate(body, 120)
	if preview == "" {
		preview = "📷"
	}
	s.pushOnly(ctx, recipientID, senderName, preview, map[string]any{"conversation_id": convID})
	return m, nil
}

func (s *Server) markConversationRead(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	other, err := conversationOther(r.Context(), s.DB, id, u.ID)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `UPDATE messages SET read_at = now()
		WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		s.hub.Send(other, Event{Type: "read", Data: map[string]string{"conversation_id": id}})
	}
	httpx.NoContent(w)
	return nil
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

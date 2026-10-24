package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	qrcode "github.com/skip2/go-qrcode"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// issueCertificate выпускает сертификат подлинности новому владельцу. Действующий сертификат
// работы (если есть) помечается переданным — так складывается история владения.
func issueCertificate(ctx context.Context, tx pgx.Tx, artworkID string, orderID *string, ownerID string, previousID *string) (string, error) {
	if previousID == nil {
		var prev string
		err := tx.QueryRow(ctx, `UPDATE certificates SET status = 'transferred' WHERE artwork_id = $1 AND status = 'active' RETURNING id`, artworkID).Scan(&prev)
		if err != nil && !isNoRows(err) {
			return "", err
		}
		if prev != "" {
			previousID = &prev
		}
	}
	for range 5 {
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			return "", fmt.Errorf("certificate code: %w", err)
		}
		code := domain.CertificateCode(b)
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO certificates (code, artwork_id, order_id, owner_id, previous_id)
			VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING id`, code, artworkID, orderID, ownerID, previousID).Scan(&id)
		if isNoRows(err) {
			continue // код совпал с существующим — пробуем другой
		}
		if err != nil {
			return "", fmt.Errorf("insert certificate: %w", err)
		}
		return code, nil
	}
	return "", fmt.Errorf("certificate code: too many collisions")
}

type certArtwork struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	ImageURL  string  `json:"image_url"`
	Category  string  `json:"category"`
	Technique string  `json:"technique"`
	Materials string  `json:"materials"`
	WidthCm   float64 `json:"width_cm"`
	HeightCm  float64 `json:"height_cm"`
	DepthCm   float64 `json:"depth_cm"`
	Year      *int    `json:"year"`
}

type certHistoryItem struct {
	Owner    string    `json:"owner"`
	IssuedAt time.Time `json:"issued_at"`
	Status   string    `json:"status"`
}

type certificateDTO struct {
	Code      string            `json:"code"`
	Status    string            `json:"status"`
	IssuedAt  time.Time         `json:"issued_at"`
	Artwork   certArtwork       `json:"artwork"`
	Artist    party             `json:"artist"`
	Owner     string            `json:"owner"`
	IsMine    bool              `json:"is_mine"`
	History   []certHistoryItem `json:"history,omitempty"`
	VerifyURL string            `json:"verify_url"`
	QRPNG     string            `json:"qr_png,omitempty"` // data:image/png;base64,…
}

// ownerLabel — «Александр Г.»: публичная страница сертификата не раскрывает полное имя владельца.
func ownerLabel(name string) string {
	parts := strings.Fields(name)
	switch len(parts) {
	case 0:
		return "Коллекционер"
	case 1:
		return parts[0]
	default:
		r := []rune(parts[1])
		return parts[0] + " " + string(r[0]) + "."
	}
}

const certSelect = `SELECT c.id, c.code, c.status, c.issued_at, c.owner_id, ow.name,
	a.id, a.title, coalesce((SELECT url FROM artwork_images WHERE artwork_id = a.id ORDER BY position LIMIT 1), ''),
	a.category, a.technique, a.materials, a.width_cm::float8, a.height_cm::float8, a.depth_cm::float8, a.year,
	ar.id, ar.name, ar.avatar_url
FROM certificates c
JOIN artworks a ON a.id = c.artwork_id
JOIN users ow ON ow.id = c.owner_id
JOIN users ar ON ar.id = a.artist_id `

func (s *Server) scanCertificate(row pgx.Row, viewerID string) (certificateDTO, string, error) {
	var c certificateDTO
	var id, ownerID, ownerName string
	err := row.Scan(&id, &c.Code, &c.Status, &c.IssuedAt, &ownerID, &ownerName,
		&c.Artwork.ID, &c.Artwork.Title, &c.Artwork.ImageURL, &c.Artwork.Category, &c.Artwork.Technique, &c.Artwork.Materials,
		&c.Artwork.WidthCm, &c.Artwork.HeightCm, &c.Artwork.DepthCm, &c.Artwork.Year,
		&c.Artist.ID, &c.Artist.Name, &c.Artist.AvatarURL)
	if err != nil {
		return c, "", err
	}
	c.Owner = ownerLabel(ownerName)
	c.IsMine = viewerID != "" && viewerID == ownerID
	c.VerifyURL = s.siteURL() + "/c/" + c.Code
	return c, id, nil
}

// siteURL — адрес сайта для публичных ссылок (по умолчанию совпадает с адресом API).
func (s *Server) siteURL() string {
	if s.Config.SiteURL != "" {
		return s.Config.SiteURL
	}
	return s.Config.PublicBaseURL
}

func (s *Server) myCertificates(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	rows, err := s.DB.Query(r.Context(), certSelect+`WHERE c.owner_id = $1 AND c.status = 'active' ORDER BY c.issued_at DESC LIMIT 200`, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []certificateDTO{}
	for rows.Next() {
		c, _, err := s.scanCertificate(rows, u.ID)
		if err != nil {
			return err
		}
		items = append(items, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, items)
	return nil
}

// loadCertificate — сертификат по коду с историей владения работой и QR-кодом проверки.
func (s *Server) loadCertificate(ctx context.Context, code, viewerID string) (certificateDTO, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	c, _, err := s.scanCertificate(s.DB.QueryRow(ctx, certSelect+`WHERE c.code = $1`, code), viewerID)
	if isNoRows(err) {
		return c, httpx.NotFound("Сертификат не найден")
	}
	if err != nil {
		return c, err
	}
	rows, err := s.DB.Query(ctx, `SELECT u.name, c.issued_at, c.status FROM certificates c JOIN users u ON u.id = c.owner_id
		WHERE c.artwork_id = $1 ORDER BY c.issued_at`, c.Artwork.ID)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var h certHistoryItem
		var name string
		if err := rows.Scan(&name, &h.IssuedAt, &h.Status); err != nil {
			return c, err
		}
		h.Owner = ownerLabel(name)
		c.History = append(c.History, h)
	}
	return c, rows.Err()
}

func (s *Server) getCertificate(w http.ResponseWriter, r *http.Request) error {
	viewer, _ := s.userFromRequest(r)
	c, err := s.loadCertificate(r.Context(), r.PathValue("code"), viewer.ID)
	if err != nil {
		return err
	}
	png, err := qrcode.Encode(c.VerifyURL, qrcode.Medium, 320)
	if err != nil {
		return fmt.Errorf("qr: %w", err)
	}
	c.QRPNG = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	httpx.OK(w, c)
	return nil
}

// certificateQR — PNG с QR-кодом страницы проверки (для сайта и печати).
func (s *Server) certificateQR(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	var exists bool
	if err := s.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM certificates WHERE code = $1)`, code).Scan(&exists); err != nil || !exists {
		http.NotFound(w, r)
		return
	}
	png, err := qrcode.Encode(s.siteURL()+"/c/"+code, qrcode.Medium, 320)
	if err != nil {
		http.Error(w, "qr", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(png)
}

// transferCertificate — владелец передаёт работу другому пользователю (продажа вне платформы, подарок).
func (s *Server) transferCertificate(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	// поиск получателя по e-mail — ограничиваем, чтобы нельзя было перебирать адреса
	if !s.socialLimiter.Allow("cert-transfer:" + u.ID) {
		return httpx.TooMany()
	}
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	var newCode, recipientID, title string
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var certID, ownerID, artworkID, status string
		err := tx.QueryRow(r.Context(), `SELECT c.id, c.owner_id, c.artwork_id, c.status, a.title FROM certificates c
			JOIN artworks a ON a.id = c.artwork_id WHERE c.code = $1 FOR UPDATE OF c`, code).Scan(&certID, &ownerID, &artworkID, &status, &title)
		if isNoRows(err) || (err == nil && ownerID != u.ID) {
			return httpx.NotFound("Сертификат не найден")
		}
		if err != nil {
			return err
		}
		if status != "active" {
			return httpx.Conflict("certificate_transferred", "Сертификат уже передан")
		}
		err = tx.QueryRow(r.Context(), `SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL AND banned_at IS NULL`,
			domain.NormalizeEmail(in.Email)).Scan(&recipientID)
		if isNoRows(err) {
			return httpx.Validation(map[string]string{"email": "Пользователь с таким e-mail не найден в Artista"})
		}
		if err != nil {
			return err
		}
		if recipientID == u.ID {
			return httpx.Validation(map[string]string{"email": "Это ваш e-mail"})
		}
		if _, err := tx.Exec(r.Context(), `UPDATE certificates SET status = 'transferred' WHERE id = $1`, certID); err != nil {
			return err
		}
		newCode, err = issueCertificate(r.Context(), tx, artworkID, nil, recipientID, &certID)
		return err
	})
	if err != nil {
		return err
	}
	s.notify(r.Context(), recipientID, "certificate_issued", tr("Вам передали работу", "An artwork was transferred to you"),
		tr("Сертификат подлинности на «%s»: %s", "Certificate of authenticity for “%s”: %s", title, newCode),
		map[string]any{"certificate_code": newCode})
	httpx.OK(w, map[string]string{"code": newCode})
	return nil
}

package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

const (
	resetCodeTTL         = 15 * time.Minute
	resetMaxAttempts     = 5  // попыток на один код
	resetCodesPerHour    = 3  // кодов на аккаунт в час
	resetFailuresPerHour = 10 // неверных кодов на аккаунт в час (по всем кодам)
)

// dummyHash — чтобы вход с несуществующим e-mail занимал столько же времени.
var dummyHash, _ = auth.HashPassword("timing-equalizer-password")

type tokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

type authResponse struct {
	User   meDTO     `json:"user"`
	Tokens tokenPair `json:"tokens"`
}

func (s *Server) issueTokens(ctx context.Context, q querier, userID, role string) (tokenPair, error) {
	access, err := s.Tokens.Issue(userID, role)
	if err != nil {
		return tokenPair{}, err
	}
	refresh, hash, err := auth.NewOpaqueToken()
	if err != nil {
		return tokenPair{}, err
	}
	tag, err := q.Exec(ctx, `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL AND banned_at IS NULL)`,
		userID, hash, time.Now().Add(s.Config.RefreshTTL))
	if err != nil {
		return tokenPair{}, fmt.Errorf("store refresh token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return tokenPair{}, httpx.Unauthorized("Аккаунт недоступен")
	}
	return tokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: int(s.Tokens.TTL().Seconds())}, nil
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) error {
	if !domain.CurrentSettings().RegistrationOpen {
		return httpx.Forbidden("Регистрация временно закрыта")
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		City     string `json:"city"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if in.Role == "" {
		in.Role = "buyer"
	}
	if errs := domain.ValidateRegistration(strings.TrimSpace(in.Email), in.Password, in.Name, in.Role); len(errs) > 0 {
		return httpx.Validation(errs)
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return err
	}
	var resp authResponse
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(r.Context(), `INSERT INTO users (email, password_hash, name, role, city)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			domain.NormalizeEmail(in.Email), hash, strings.TrimSpace(in.Name), in.Role, strings.TrimSpace(in.City)).Scan(&id)
		if isUniqueViolation(err) {
			return httpx.Conflict("email_taken", "Этот e-mail уже зарегистрирован")
		}
		if err != nil {
			return fmt.Errorf("insert user: %w", err)
		}
		if resp.Tokens, err = s.issueTokens(r.Context(), tx, id, in.Role); err != nil {
			return err
		}
		resp.User, err = loadMe(r.Context(), tx, id)
		return err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, resp, nil)
	return nil
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	email := domain.NormalizeEmail(in.Email)
	if !s.accountLimiter.Allow("login:" + email) {
		return httpx.TooMany()
	}
	var id, hash, role string
	var banned bool
	err := s.DB.QueryRow(r.Context(), `SELECT id, password_hash, role, banned_at IS NOT NULL FROM users
		WHERE lower(email) = $1 AND deleted_at IS NULL`, email).Scan(&id, &hash, &role, &banned)
	if isNoRows(err) {
		auth.CheckPassword(dummyHash, in.Password)
		return httpx.Unauthorized("Неверный e-mail или пароль")
	}
	if err != nil {
		return err
	}
	if !auth.CheckPassword(hash, in.Password) {
		return httpx.Unauthorized("Неверный e-mail или пароль")
	}
	if banned {
		return httpx.Forbidden("Аккаунт заблокирован модератором")
	}
	tokens, err := s.issueTokens(r.Context(), s.DB, id, role)
	if err != nil {
		return err
	}
	me, err := loadMe(r.Context(), s.DB, id)
	if err != nil {
		return err
	}
	httpx.OK(w, authResponse{User: me, Tokens: tokens})
	return nil
}

// refresh обменивает refresh-токен на новую пару (ротация). Повторное использование
// уже отозванного токена отзывает все сессии пользователя.
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	hash := auth.HashToken(in.RefreshToken)
	var tokens tokenPair
	reused := false
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var tokenID, userID, role string
		var expires time.Time
		var revoked *time.Time
		err := tx.QueryRow(r.Context(), `SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.role
			FROM refresh_tokens t JOIN users u ON u.id = t.user_id
			WHERE t.token_hash = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL FOR UPDATE OF t`, hash).
			Scan(&tokenID, &userID, &expires, &revoked, &role)
		if isNoRows(err) {
			return httpx.Unauthorized("Сессия истекла, войдите снова")
		}
		if err != nil {
			return err
		}
		if revoked != nil {
			reused = true
			_, err := tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
			return err
		}
		if time.Now().After(expires) {
			return httpx.Unauthorized("Сессия истекла, войдите снова")
		}
		if _, err := tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, tokenID); err != nil {
			return err
		}
		tokens, err = s.issueTokens(r.Context(), tx, userID, role)
		return err
	})
	if err != nil {
		return err
	}
	if reused {
		s.Log.Warn("refresh token reuse detected; all sessions revoked")
		return httpx.Unauthorized("Сессия недействительна, войдите снова")
	}
	httpx.OK(w, tokens)
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		RefreshToken string `json:"refresh_token"`
		DeviceToken  string `json:"device_token"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	var userID string
	err := s.DB.QueryRow(r.Context(), `UPDATE refresh_tokens SET revoked_at = now()
		WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id`, auth.HashToken(in.RefreshToken)).Scan(&userID)
	if err != nil && !isNoRows(err) {
		return err
	}
	// push на общем устройстве после выхода приходить не должен
	if userID != "" && in.DeviceToken != "" {
		if _, err := s.DB.Exec(r.Context(), `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`, in.DeviceToken, userID); err != nil {
			return err
		}
	}
	httpx.NoContent(w)
	return nil
}

// forgotPassword всегда отвечает 204, чтобы не раскрывать, зарегистрирован ли e-mail.
func (s *Server) forgotPassword(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	email := domain.NormalizeEmail(in.Email)
	var userID string
	var recent int
	err := s.DB.QueryRow(r.Context(), `SELECT u.id,
			(SELECT count(*) FROM password_resets pr WHERE pr.user_id = u.id AND pr.created_at > now() - interval '1 hour')
		FROM users u WHERE lower(u.email) = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL`, email).Scan(&userID, &recent)
	if isNoRows(err) {
		httpx.NoContent(w)
		return nil
	}
	if err != nil {
		return err
	}
	if recent >= resetCodesPerHour {
		// не раскрываем лимит: ответ тот же, письмо не отправляется
		httpx.NoContent(w)
		return nil
	}
	code, err := auth.NewResetCode()
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return err
	}
	if _, err := s.DB.Exec(r.Context(), `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, auth.HashToken(code), time.Now().Add(resetCodeTTL)); err != nil {
		return err
	}
	body := fmt.Sprintf("Код для восстановления пароля в Artista: %s\nКод действует 15 минут. Если вы не запрашивали сброс, просто проигнорируйте письмо.", code)
	if err := s.Mailer.Send(r.Context(), email, "Восстановление пароля Artista", body); err != nil {
		s.Log.Error("send reset mail", "err", err)
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if msg := domain.PasswordProblem(in.Password); msg != "" {
		return httpx.Validation(map[string]string{"password": msg})
	}
	invalid := httpx.BadRequest("Неверный или просроченный код")
	var codeOK bool
	err := s.withTx(r.Context(), func(tx pgx.Tx) error {
		var resetID, userID, codeHash string
		var attempts, hourFailures int
		err := tx.QueryRow(r.Context(), `SELECT pr.id, pr.user_id, pr.code_hash, pr.attempts,
				(SELECT coalesce(sum(attempts), 0) FROM password_resets h WHERE h.user_id = u.id AND h.created_at > now() - interval '1 hour')
			FROM password_resets pr JOIN users u ON u.id = pr.user_id
			WHERE lower(u.email) = $1 AND u.deleted_at IS NULL AND u.banned_at IS NULL
			  AND pr.used_at IS NULL AND pr.expires_at > now()
			ORDER BY pr.created_at DESC LIMIT 1 FOR UPDATE OF pr`, domain.NormalizeEmail(in.Email)).
			Scan(&resetID, &userID, &codeHash, &attempts, &hourFailures)
		if isNoRows(err) {
			return invalid
		}
		if err != nil {
			return err
		}
		if attempts >= resetMaxAttempts || hourFailures >= resetFailuresPerHour {
			return invalid
		}
		if auth.HashToken(strings.TrimSpace(in.Code)) != codeHash {
			_, err := tx.Exec(r.Context(), `UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1`, resetID)
			return err // попытку засчитываем (commit), ошибку вернём после транзакции
		}
		codeOK = true
		// bcrypt — только после верного кода, чтобы перебор не нагружал CPU
		hash, err := auth.HashPassword(in.Password)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE password_resets SET used_at = now() WHERE id = $1`, resetID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, userID, hash); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
		return err
	})
	if err != nil {
		return err
	}
	if !codeOK {
		return invalid
	}
	httpx.NoContent(w)
	return nil
}

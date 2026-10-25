package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
)

// LoadSettings читает параметры платформы из базы (при старте и на каждом шаге воркера,
// чтобы несколько экземпляров API подхватили изменение из админки).
func (s *Server) LoadSettings(ctx context.Context) error {
	var raw []byte
	err := s.DB.QueryRow(ctx, `SELECT data FROM platform_settings WHERE id = 1`).Scan(&raw)
	if isNoRows(err) {
		domain.ApplySettings(domain.DefaultSettings())
		return nil
	}
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	cfg := domain.DefaultSettings() // новые поля, которых нет в сохранённой версии, берутся по умолчанию
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return fmt.Errorf("decode settings: %w", err)
	}
	if errs := cfg.Validate(); len(errs) > 0 {
		s.Log.Warn("stored settings are invalid, using defaults", "errors", errs)
		cfg = domain.DefaultSettings()
	}
	domain.ApplySettings(cfg)
	return nil
}

// BootstrapAdmin делает администратором аккаунт ADMIN_EMAIL; если его нет и задан ADMIN_PASSWORD — создаёт.
func (s *Server) BootstrapAdmin(ctx context.Context) error {
	email := domain.NormalizeEmail(s.Config.AdminEmail)
	if email == "" {
		return nil
	}
	tag, err := s.DB.Exec(ctx, `UPDATE users SET role = 'admin', banned_at = NULL, updated_at = now()
		WHERE lower(email) = $1 AND deleted_at IS NULL`, email)
	if err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	if tag.RowsAffected() > 0 || s.Config.AdminPassword == "" {
		return nil
	}
	hash, err := auth.HashPassword(s.Config.AdminPassword)
	if err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Администратор', 'admin')`, email, hash); err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	s.Log.Info("admin account created", "email", email)
	return nil
}

// audit записывает действие администратора в журнал.
func audit(ctx context.Context, q querier, adminID, action, targetType, targetID string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)`,
		adminID, action, targetType, targetID, raw)
	return err
}

type settingsDTO struct {
	Settings  domain.Settings `json:"settings"`
	Defaults  domain.Settings `json:"defaults"`
	UpdatedAt *time.Time      `json:"updated_at"`
	UpdatedBy string          `json:"updated_by"`
}

func (s *Server) adminGetSettings(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
	d := settingsDTO{Settings: domain.CurrentSettings(), Defaults: domain.DefaultSettings()}
	err := s.DB.QueryRow(r.Context(), `SELECT p.updated_at, coalesce(u.name, '') FROM platform_settings p
		LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = 1`).Scan(&d.UpdatedAt, &d.UpdatedBy)
	if err != nil && !isNoRows(err) {
		return err
	}
	httpx.OK(w, d)
	return nil
}

func (s *Server) adminPutSettings(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	var in domain.Settings
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if errs := in.Validate(); len(errs) > 0 {
		return httpx.Validation(errs)
	}
	before := domain.CurrentSettings()
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	err = s.withTx(r.Context(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `INSERT INTO platform_settings (id, data, updated_by, updated_at) VALUES (1, $1, $2, now())
			ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`, raw, u.ID); err != nil {
			return err
		}
		return audit(r.Context(), tx, u.ID, "settings.update", "settings", "1", map[string]any{"before": before, "after": in})
	})
	if err != nil {
		return err
	}
	domain.ApplySettings(in)
	return s.adminGetSettings(w, r, u)
}

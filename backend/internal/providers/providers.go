// Package providers — интерфейсы внешних сервисов и их заглушки для MVP.
// Боевые реализации (ЮKassa, Expo Push, SMTP, S3) подключаются через те же интерфейсы.
package providers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// ---------- Платежи ----------

// PaymentRequest — что оплачиваем.
type PaymentRequest struct {
	PaymentID   string // наш id платежа
	AmountKop   int64
	Description string
}

// PaymentCreated — ответ провайдера.
type PaymentCreated struct {
	ExternalID      string
	ConfirmationURL string // куда отправить пользователя; пусто для stub
}

// Payments — платёжный провайдер.
type Payments interface {
	Name() string
	Create(ctx context.Context, req PaymentRequest) (PaymentCreated, error)
	Refund(ctx context.Context, externalID string, amountKop int64) error
}

// StubPayments — тестовые платежи: деньги не списываются, оплата подтверждается
// вызовом /payments/{id}/stub-confirm.
type StubPayments struct{ Log *slog.Logger }

func (StubPayments) Name() string { return "stub" }

func (p StubPayments) Create(_ context.Context, req PaymentRequest) (PaymentCreated, error) {
	id, err := randomHex(12)
	if err != nil {
		return PaymentCreated{}, err
	}
	p.Log.Info("stub payment created", "payment_id", req.PaymentID, "amount_kop", req.AmountKop)
	return PaymentCreated{ExternalID: "stub_" + id}, nil
}

func (p StubPayments) Refund(_ context.Context, externalID string, amountKop int64) error {
	p.Log.Info("stub refund", "external_id", externalID, "amount_kop", amountKop)
	return nil
}

// ---------- Push ----------

// Pusher отправляет push-уведомления на устройства.
type Pusher interface {
	Push(ctx context.Context, tokens []string, title, body string, data map[string]any) error
}

// LogPusher пишет push в лог (заглушка до подключения Expo Push).
type LogPusher struct{ Log *slog.Logger }

func (p LogPusher) Push(_ context.Context, tokens []string, title, body string, _ map[string]any) error {
	if len(tokens) > 0 {
		p.Log.Info("push (stub)", "devices", len(tokens), "title", title, "body", body)
	}
	return nil
}

// ---------- Почта ----------

// Mailer отправляет письма.
type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

// LogMailer пишет письма в лог (заглушка до подключения SMTP).
type LogMailer struct{ Log *slog.Logger }

func (m LogMailer) Send(_ context.Context, to, subject, body string) error {
	m.Log.Info("mail (stub)", "to", to, "subject", subject, "body", body)
	return nil
}

// MemoryMailer запоминает письма — для тестов.
type MemoryMailer struct {
	mu   sync.Mutex
	Sent []Mail
}

// Mail — отправленное письмо.
type Mail struct{ To, Subject, Body string }

func (m *MemoryMailer) Send(_ context.Context, to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Sent = append(m.Sent, Mail{to, subject, body})
	return nil
}

// Last — последнее письмо адресату.
func (m *MemoryMailer) Last(to string) (Mail, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.Sent) - 1; i >= 0; i-- {
		if m.Sent[i].To == to {
			return m.Sent[i], true
		}
	}
	return Mail{}, false
}

// ---------- Файлы ----------

// Storage сохраняет загруженные файлы и возвращает публичный URL.
type Storage interface {
	Save(ctx context.Context, ext string, r io.Reader) (url string, err error)
}

// LocalStorage хранит файлы на диске; API раздаёт их по /files/.
type LocalStorage struct {
	Dir     string
	BaseURL string
}

var safeName = regexp.MustCompile(`^[a-f0-9]{32}\.(jpg|png|webp)$`)

// ErrBadExtension — неподдерживаемый тип файла.
var ErrBadExtension = errors.New("unsupported file type")

func (s LocalStorage) Save(_ context.Context, ext string, r io.Reader) (string, error) {
	id, err := randomHex(16)
	if err != nil {
		return "", err
	}
	name := id + "." + ext
	if !safeName.MatchString(name) {
		return "", ErrBadExtension
	}
	if err := os.MkdirAll(s.Dir, 0o750); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}
	f, err := os.OpenFile(filepath.Join(s.Dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return "", fmt.Errorf("write file: %w", err)
	}
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("close file: %w", err)
	}
	return s.BaseURL + "/files/" + name, nil
}

// IsSafeFileName — имя файла сгенерировано нами (защита от path traversal при раздаче).
func IsSafeFileName(name string) bool { return safeName.MatchString(name) }

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	return hex.EncodeToString(b), nil
}

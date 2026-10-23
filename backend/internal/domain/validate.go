package domain

import (
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

// FieldErrors — ошибки валидации по полям (поле → сообщение для пользователя).
type FieldErrors map[string]string

// ArtworkInput — данные работы от художника.
type ArtworkInput struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Style       string   `json:"style"`
	Technique   string   `json:"technique"`
	Materials   string   `json:"materials"`
	WidthCm     float64  `json:"width_cm"`
	HeightCm    float64  `json:"height_cm"`
	DepthCm     float64  `json:"depth_cm"`
	Year        *int     `json:"year"`
	PriceKop    int64    `json:"price_kop"`
	Images      []string `json:"images"`
}

const (
	maxImages    = 10
	maxSideCm    = 1000
	maxDescLen   = 4000
	maxMaterials = 200
	minPassword  = 8
	maxPassword  = 72 // ограничение bcrypt
	maxNameLen   = 80
)

// ValidateArtwork проверяет поля работы. forPublish требует хотя бы одно фото.
func ValidateArtwork(in ArtworkInput, forPublish bool) FieldErrors {
	errs := FieldErrors{}
	title := strings.TrimSpace(in.Title)
	if n := utf8.RuneCountInString(title); n < 2 || n > 120 {
		errs["title"] = "Название — от 2 до 120 символов"
	}
	if utf8.RuneCountInString(in.Description) > maxDescLen {
		errs["description"] = "Описание — не длиннее 4000 символов"
	}
	if utf8.RuneCountInString(in.Materials) > maxMaterials {
		errs["materials"] = "Материалы — не длиннее 200 символов"
	}
	if !IsValidCategory(in.Category) {
		errs["category"] = "Выберите категорию"
	}
	if in.Style != "" && !isCode(styles, in.Style) {
		errs["style"] = "Неизвестный стиль"
	}
	if in.Technique != "" && !isCode(techniques, in.Technique) {
		errs["technique"] = "Неизвестная техника"
	}
	if in.PriceKop < MinArtworkPriceKop || in.PriceKop > MaxArtworkPriceKop {
		errs["price"] = "Цена — от 3 000 до 500 000 ₽"
	}
	if in.WidthCm <= 0 || in.WidthCm > maxSideCm {
		errs["width_cm"] = "Ширина — от 0,1 до 1000 см"
	}
	if in.HeightCm <= 0 || in.HeightCm > maxSideCm {
		errs["height_cm"] = "Высота — от 0,1 до 1000 см"
	}
	if in.DepthCm < 0 || in.DepthCm > maxSideCm {
		errs["depth_cm"] = "Глубина — от 0 до 1000 см"
	}
	if in.Year != nil && (*in.Year < 1000 || *in.Year > time.Now().Year()) {
		errs["year"] = "Некорректный год"
	}
	if len(in.Images) > maxImages {
		errs["images"] = "Не больше 10 фотографий"
	} else if forPublish && len(in.Images) == 0 {
		errs["images"] = "Добавьте хотя бы одно фото"
	}
	return errs
}

// ValidateRegistration проверяет данные регистрации.
func ValidateRegistration(email, password, name, role string) FieldErrors {
	errs := FieldErrors{}
	if !IsValidEmail(email) {
		errs["email"] = "Некорректный e-mail"
	}
	if msg := PasswordProblem(password); msg != "" {
		errs["password"] = msg
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(name)); n < 1 || n > maxNameLen {
		errs["name"] = "Укажите имя (до 80 символов)"
	}
	if role != "buyer" && role != "artist" {
		errs["role"] = "Роль: покупатель или художник"
	}
	return errs
}

// PasswordProblem возвращает текст ошибки или пустую строку.
func PasswordProblem(password string) string {
	if n := len(password); n < minPassword || n > maxPassword {
		return "Пароль — от 8 до 72 символов"
	}
	return ""
}

// IsValidEmail — простая проверка адреса.
func IsValidEmail(email string) bool {
	email = strings.TrimSpace(email)
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email && strings.Contains(email, ".")
}

// NormalizeEmail приводит адрес к единому виду.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// MaxSide — наибольшая сторона работы (для тарифа доставки).
func MaxSide(w, h, d float64) float64 {
	return max(w, h, d)
}

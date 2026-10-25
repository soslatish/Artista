package domain

import (
	"strings"
	"sync/atomic"
	"unicode/utf8"
)

// Settings — параметры платформы, которые администратор меняет без выпуска новой версии.
// Хранятся в таблице platform_settings; в памяти — текущая копия (атомарная замена целиком).
type Settings struct {
	CommissionBP        int               `json:"commission_bp"`          // комиссия с продажи, базисные пункты (1500 = 15%)
	PremiumPriceKop     int64             `json:"premium_price_kop"`      // цена Премиума за 30 дней
	PremiumFreeLimitKop int64             `json:"premium_free_limit_kop"` // продажи в месяц без комиссии для Премиума
	OfferMinShareBP     int               `json:"offer_min_share_bp"`     // минимальное предложение цены, доля от цены
	Promotion           []PromotionTariff `json:"promotion_tariffs"`
	Announcement        string            `json:"announcement"`      // объявление в приложении для всех (пусто — нет)
	RegistrationOpen    bool              `json:"registration_open"` // приём новых регистраций
	OffersEnabled       bool              `json:"offers_enabled"`
	AuctionsEnabled     bool              `json:"auctions_enabled"`
	CommissionsEnabled  bool              `json:"commissions_enabled"`
}

// DefaultSettings — значения из бизнес-плана.
func DefaultSettings() Settings {
	return Settings{
		CommissionBP:        1500,
		PremiumPriceKop:     990_00,
		PremiumFreeLimitKop: 100_000_00,
		OfferMinShareBP:     5000,
		Promotion: []PromotionTariff{
			{Days: 3, PriceKop: 199_00},
			{Days: 7, PriceKop: 399_00},
			{Days: 14, PriceKop: 699_00},
		},
		RegistrationOpen:   true,
		OffersEnabled:      true,
		AuctionsEnabled:    true,
		CommissionsEnabled: true,
	}
}

var current atomic.Pointer[Settings]

func init() {
	d := DefaultSettings()
	current.Store(&d)
}

// CurrentSettings — копия текущих параметров (срез тарифов тоже копируется).
func CurrentSettings() Settings {
	s := *current.Load()
	s.Promotion = append([]PromotionTariff(nil), s.Promotion...)
	return s
}

// ApplySettings заменяет параметры; вызывать только с проверенными значениями (Validate).
func ApplySettings(s Settings) {
	s.Promotion = append([]PromotionTariff(nil), s.Promotion...)
	s.Announcement = strings.TrimSpace(s.Announcement)
	current.Store(&s)
}

// Validate проверяет параметры; ключи ошибок совпадают с JSON-полями.
func (s Settings) Validate() map[string]string {
	errs := map[string]string{}
	if s.CommissionBP < 0 || s.CommissionBP > 5000 {
		errs["commission_bp"] = "Комиссия — от 0 до 50%"
	}
	if s.PremiumPriceKop < 0 || s.PremiumPriceKop > 100_000_00 {
		errs["premium_price_kop"] = "Цена Премиума — от 0 до 100 000 ₽"
	}
	if s.PremiumFreeLimitKop < 0 || s.PremiumFreeLimitKop > 10_000_000_00 {
		errs["premium_free_limit_kop"] = "Лимит — от 0 до 10 000 000 ₽"
	}
	if s.OfferMinShareBP < 1000 || s.OfferMinShareBP > 9900 {
		errs["offer_min_share_bp"] = "Минимальное предложение — от 10 до 99% цены"
	}
	if len(s.Promotion) == 0 || len(s.Promotion) > 6 {
		errs["promotion_tariffs"] = "От 1 до 6 тарифов продвижения"
	}
	seen := map[int]bool{}
	for _, t := range s.Promotion {
		if t.Days < 1 || t.Days > 90 || t.PriceKop < 0 || t.PriceKop > 100_000_00 || seen[t.Days] {
			errs["promotion_tariffs"] = "Тариф: срок 1–90 дней без повторов, цена до 100 000 ₽"
		}
		seen[t.Days] = true
	}
	if utf8.RuneCountInString(s.Announcement) > 300 {
		errs["announcement"] = "Объявление — до 300 символов"
	}
	return errs
}

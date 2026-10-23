package domain

import (
	"errors"
	"strings"
)

// Монетизация из бизнес-плана. Все суммы — в копейках.
const (
	CommissionRateBP    = 1500       // 15% в базисных пунктах
	PremiumFreeLimitKop = 100_000_00 // 0% комиссии для премиума до 100 000 ₽/мес
	PremiumPriceKop     = 990_00     // 990 ₽/мес
	MinArtworkPriceKop  = 3_000_00
	MaxArtworkPriceKop  = 500_000_00
	FreeDeliveryFromKop = 50_000_00
	largeArtworkSideCm  = 100.0
)

// Commission считает комиссию платформы с продажи.
// monthSalesKop — сумма уже завершённых продаж художника в текущем месяце.
func Commission(priceKop int64, isPremium bool, monthSalesKop int64) int64 {
	taxable := priceKop
	if isPremium {
		remainingFree := PremiumFreeLimitKop - monthSalesKop
		if remainingFree > 0 {
			taxable = max(priceKop-remainingFree, 0)
		}
	}
	return (taxable*CommissionRateBP + 5000) / 10000
}

// DeliveryMethod — способ доставки.
type DeliveryMethod string

const (
	DeliveryCDEK    DeliveryMethod = "cdek"    // СДЭК, вся Россия
	DeliveryExpress DeliveryMethod = "express" // курьер за 2–4 часа, только Москва и СПб
	DeliveryPost    DeliveryMethod = "post"    // Почта России
)

var (
	ErrUnknownDeliveryMethod = errors.New("unknown delivery method")
	ErrDeliveryUnavailable   = errors.New("delivery method unavailable for this city")
	ErrCityRequired          = errors.New("city is required")
)

// DeliveryQuote — стоимость и срок доставки.
type DeliveryQuote struct {
	Method   DeliveryMethod `json:"method"`
	PriceKop int64          `json:"price_kop"`
	DaysMin  int            `json:"days_min"`
	DaysMax  int            `json:"days_max"`
}

type tariff struct {
	capitalKop, regionKop           int64
	capitalLargeKop, regionLargeKop int64
	capitalDays, regionDays         [2]int
	capitalOnly                     bool
}

var tariffs = map[DeliveryMethod]tariff{
	DeliveryCDEK:    {500_00, 1_500_00, 800_00, 3_000_00, [2]int{1, 2}, [2]int{3, 7}, false},
	DeliveryExpress: {800_00, 0, 800_00, 0, [2]int{1, 1}, [2]int{0, 0}, true},
	DeliveryPost:    {500_00, 1_000_00, 800_00, 2_500_00, [2]int{2, 4}, [2]int{5, 14}, false},
}

// QuoteDelivery считает доставку по тарифной сетке бизнес-плана
// (заглушка до интеграции с API СДЭК).
func QuoteDelivery(method DeliveryMethod, city string, priceKop int64, maxSideCm float64) (DeliveryQuote, error) {
	t, ok := tariffs[method]
	if !ok {
		return DeliveryQuote{}, ErrUnknownDeliveryMethod
	}
	if strings.TrimSpace(city) == "" {
		return DeliveryQuote{}, ErrCityRequired
	}
	capital := IsCapital(city)
	if t.capitalOnly && !capital {
		return DeliveryQuote{}, ErrDeliveryUnavailable
	}
	large := maxSideCm > largeArtworkSideCm
	q := DeliveryQuote{Method: method}
	switch {
	case capital && large:
		q.PriceKop = t.capitalLargeKop
	case capital:
		q.PriceKop = t.capitalKop
	case large:
		q.PriceKop = t.regionLargeKop
	default:
		q.PriceKop = t.regionKop
	}
	days := t.regionDays
	if capital {
		days = t.capitalDays
	}
	q.DaysMin, q.DaysMax = days[0], days[1]
	if priceKop >= FreeDeliveryFromKop {
		q.PriceKop = 0
	}
	return q, nil
}

var capitalAliases = map[string]bool{
	"москва": true, "moscow": true, "мск": true,
	"санкт-петербург": true, "спб": true, "питер": true, "петербург": true,
	"saint petersburg": true, "st. petersburg": true, "sankt-peterburg": true,
}

// IsCapital — Москва или Санкт-Петербург (с распространёнными написаниями).
func IsCapital(city string) bool {
	return capitalAliases[strings.ToLower(strings.TrimSpace(city))]
}

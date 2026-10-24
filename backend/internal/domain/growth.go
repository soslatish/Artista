package domain

import (
	"errors"
	"time"
)

// ColorOption — цвет палитры для фильтра «по цвету».
type ColorOption struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Hex   string `json:"hex"`
}

// Colors — именованные цвета, на которые раскладывается палитра работы.
var Colors = []ColorOption{
	{"red", "Красный", "#C0392B"},
	{"orange", "Оранжевый", "#E67E22"},
	{"yellow", "Жёлтый", "#F1C40F"},
	{"green", "Зелёный", "#3E8E4F"},
	{"teal", "Бирюзовый", "#16A085"},
	{"blue", "Синий", "#2E6FD8"},
	{"purple", "Фиолетовый", "#8E44AD"},
	{"pink", "Розовый", "#E78FB3"},
	{"brown", "Коричневый", "#8B5A2B"},
	{"beige", "Бежевый", "#D9C3A0"},
	{"white", "Белый", "#F5F5F0"},
	{"gray", "Серый", "#8E8E8E"},
	{"black", "Чёрный", "#1E1E1E"},
}

// Rooms — интерьеры, для которых художник рекомендует работу.
var Rooms = []Option{
	{"living", "Гостиная"},
	{"bedroom", "Спальня"},
	{"kitchen", "Кухня"},
	{"office", "Кабинет и офис"},
	{"kids", "Детская"},
	{"hallway", "Прихожая"},
}

// IsColor — код цвета из палитры.
func IsColor(code string) bool {
	for _, c := range Colors {
		if c.Code == code {
			return true
		}
	}
	return false
}

// IsRoom — код интерьера из справочника.
func IsRoom(code string) bool { return isCode(Rooms, code) }

// ValidRooms проверяет список интерьеров (без повторов, только из справочника).
func ValidRooms(rooms []string) bool {
	if len(rooms) > len(Rooms) {
		return false
	}
	seen := map[string]bool{}
	for _, r := range rooms {
		if !IsRoom(r) || seen[r] {
			return false
		}
		seen[r] = true
	}
	return true
}

// ---------- продвижение ----------

// PromotionTariff — платное поднятие работы в ленте и поиске.
type PromotionTariff struct {
	Days     int   `json:"days"`
	PriceKop int64 `json:"price_kop"`
}

// PromotionTariffs — тарифы продвижения.
var PromotionTariffs = []PromotionTariff{
	{Days: 3, PriceKop: 199_00},
	{Days: 7, PriceKop: 399_00},
	{Days: 14, PriceKop: 699_00},
}

// PromotionPrice — цена продвижения на days дней; false, если такого тарифа нет.
func PromotionPrice(days int) (int64, bool) {
	for _, t := range PromotionTariffs {
		if t.Days == days {
			return t.PriceKop, true
		}
	}
	return 0, false
}

// ---------- предложения цены ----------

const (
	OfferMinShareBP  = 5000           // предложение — не меньше 50% цены
	OfferTTL         = 48 * time.Hour // художник отвечает за 48 часов
	AcceptedOfferTTL = 24 * time.Hour // после согласия покупатель оформляет заказ за 24 часа
)

var (
	ErrOfferTooLow  = errors.New("offer is below the allowed minimum")
	ErrOfferTooHigh = errors.New("offer is not below the price")
)

// ValidateOffer — сумма предложения: от 50% цены (и не ниже минимальной цены работы) и строго ниже цены.
func ValidateOffer(priceKop, amountKop int64) error {
	if amountKop >= priceKop {
		return ErrOfferTooHigh
	}
	if amountKop*10000 < priceKop*OfferMinShareBP || amountKop < MinArtworkPriceKop {
		return ErrOfferTooLow
	}
	return nil
}

// OfferMinimum — минимальная сумма предложения для цены.
func OfferMinimum(priceKop int64) int64 {
	m := (priceKop*OfferMinShareBP + 9999) / 10000
	return max(m, MinArtworkPriceKop)
}

// ---------- аукционы ----------

const (
	AuctionMinDays     = 1
	AuctionMaxDays     = 7
	AuctionSnipeWindow = 5 * time.Minute // ставка в последние 5 минут продлевает торги
	AuctionCheckoutTTL = 48 * time.Hour  // победитель оформляет заказ за 48 часов
	minStepKop         = 100_00
)

// AuctionStep — шаг ставки: 5% стартовой цены, но не меньше 100 ₽, округлён до 50 ₽.
func AuctionStep(startKop int64) int64 {
	step := startKop * 5 / 100
	step = (step + 49_99) / 50_00 * 50_00
	return max(step, minStepKop)
}

// MinNextBid — минимальная следующая ставка.
func MinNextBid(startKop, stepKop int64, currentKop *int64) int64 {
	if currentKop == nil {
		return startKop
	}
	return *currentKop + stepKop
}

// ExtendForSnipe — новое время окончания торгов, если ставка сделана в последние минуты.
func ExtendForSnipe(endsAt, now time.Time) time.Time {
	if endsAt.Sub(now) < AuctionSnipeWindow {
		return now.Add(AuctionSnipeWindow)
	}
	return endsAt
}

// ---------- заказы на заказ ----------

const (
	CommissionAnswerTTL = 7 * 24 * time.Hour // художник отвечает на запрос за 7 дней
	CommissionQuoteTTL  = 7 * 24 * time.Hour // покупатель принимает предложение за 7 дней
	CommissionMaxDays   = 120
	// ShipGraceDays — запас к сроку художника на отправку после подтверждения заказа.
	ShipGraceDays = 2
)

// ShipDeadline — срок отправки: стандартные 48 часов или срок из заказа на заказ (+ запас).
func ShipDeadline(confirmedAt time.Time, shipDays *int) time.Time {
	if shipDays == nil || *shipDays <= 0 {
		return confirmedAt.Add(ShipTimeout)
	}
	return confirmedAt.Add(time.Duration(*shipDays+ShipGraceDays) * 24 * time.Hour)
}

// ---------- выставки ----------

const (
	ExhibitionMinLead = 30 * time.Minute    // открытие — не раньше чем через 30 минут
	ExhibitionMaxLead = 60 * 24 * time.Hour // и не позже чем через 60 дней
	ExhibitionMaxWork = 30
)

// ---------- сертификаты ----------

// certAlphabet — без похожих символов (0/O, 1/I/L).
const certAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// CertificateCode превращает случайные байты в код вида ART-XXXX-XXXX.
func CertificateCode(random []byte) string {
	out := make([]byte, 0, 13)
	out = append(out, "ART-"...)
	for i := 0; i < 8 && i < len(random); i++ {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, certAlphabet[int(random[i])%len(certAlphabet)])
	}
	return string(out)
}

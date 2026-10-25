package domain

// Option — элемент справочника (код + подпись на русском).
type Option struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

var categories = []Option{
	{"painting", "Живопись"},
	{"graphics", "Графика"},
	{"sculpture", "Скульптура"},
	{"photo", "Фотография"},
	{"digital", "Цифровое искусство"},
	{"print", "Принты и тиражная графика"},
	{"mixed", "Смешанная техника"},
}

var styles = []Option{
	{"realism", "Реализм"},
	{"impressionism", "Импрессионизм"},
	{"expressionism", "Экспрессионизм"},
	{"abstract", "Абстракция"},
	{"minimalism", "Минимализм"},
	{"pop_art", "Поп-арт"},
	{"surrealism", "Сюрреализм"},
	{"naive", "Наивное искусство"},
	{"street_art", "Стрит-арт"},
	{"contemporary", "Современное искусство"},
}

var techniques = []Option{
	{"oil", "Масло"},
	{"acrylic", "Акрил"},
	{"watercolor", "Акварель"},
	{"gouache", "Гуашь"},
	{"pastel", "Пастель"},
	{"ink", "Тушь, чернила"},
	{"pencil", "Карандаш"},
	{"charcoal", "Уголь"},
	{"mixed_media", "Смешанная"},
	{"digital_print", "Цифровая печать"},
	{"etching", "Офорт, линогравюра"},
	{"bronze", "Бронза"},
	{"ceramics", "Керамика"},
	{"wood", "Дерево"},
	{"photo_print", "Фотопечать"},
}

var deliveryMethods = []Option{
	{string(DeliveryCDEK), "СДЭК"},
	{string(DeliveryExpress), "Курьер за 2–4 часа (Москва, СПб)"},
	{string(DeliveryPost), "Почта России"},
}

// Meta — справочники каталога для клиента.
type Meta struct {
	Categories      []Option          `json:"categories"`
	Styles          []Option          `json:"styles"`
	Techniques      []Option          `json:"techniques"`
	DeliveryMethods []Option          `json:"delivery_methods"`
	PriceMinKop     int64             `json:"price_min_kop"`
	PriceMaxKop     int64             `json:"price_max_kop"`
	CommissionBP    int               `json:"commission_bp"`
	PremiumPriceKop int64             `json:"premium_price_kop"`
	PremiumLimitKop int64             `json:"premium_free_limit_kop"`
	Announcement    string            `json:"announcement"`
	Features        map[string]bool   `json:"features"`
	Colors          []ColorOption     `json:"colors"`
	Rooms           []Option          `json:"rooms"`
	Promotion       []PromotionTariff `json:"promotion_tariffs"`
	OfferMinShareBP int               `json:"offer_min_share_bp"`
}

// CatalogMeta возвращает справочники (копии, чтобы клиенты не меняли исходные данные).
func CatalogMeta() Meta {
	cfg := CurrentSettings()
	return Meta{
		Categories:      append([]Option(nil), categories...),
		Styles:          append([]Option(nil), styles...),
		Techniques:      append([]Option(nil), techniques...),
		DeliveryMethods: append([]Option(nil), deliveryMethods...),
		PriceMinKop:     MinArtworkPriceKop,
		PriceMaxKop:     MaxArtworkPriceKop,
		CommissionBP:    cfg.CommissionBP,
		PremiumPriceKop: cfg.PremiumPriceKop,
		PremiumLimitKop: cfg.PremiumFreeLimitKop,
		Announcement:    cfg.Announcement,
		Features: map[string]bool{
			"registration": cfg.RegistrationOpen, "offers": cfg.OffersEnabled,
			"auctions": cfg.AuctionsEnabled, "commissions": cfg.CommissionsEnabled,
		},
		Colors:          append([]ColorOption(nil), Colors...),
		Rooms:           append([]Option(nil), Rooms...),
		Promotion:       cfg.Promotion,
		OfferMinShareBP: cfg.OfferMinShareBP,
	}
}

// IsValidCategory — код категории из справочника.
func IsValidCategory(code string) bool { return isCode(categories, code) }

// IsValidStyle — код стиля из справочника.
func IsValidStyle(code string) bool { return isCode(styles, code) }

// IsValidTechnique — код техники из справочника.
func IsValidTechnique(code string) bool { return isCode(techniques, code) }

func isCode(list []Option, code string) bool {
	for _, o := range list {
		if o.Code == code {
			return true
		}
	}
	return false
}

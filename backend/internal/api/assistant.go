package api

import (
	"context"
	"math"
	"net/http"

	"github.com/soslatish/artista/backend/internal/domain"
	"github.com/soslatish/artista/backend/internal/httpx"
	"github.com/soslatish/artista/backend/internal/providers"
)

type priceHint struct {
	SuggestedKop int64  `json:"suggested_kop"`
	MinKop       int64  `json:"min_kop"`
	MaxKop       int64  `json:"max_kop"`
	Basis        string `json:"basis"` // similar | category | default
	SampleSize   int    `json:"sample_size"`
}

type assistantDTO struct {
	providers.ArtworkSuggestion
	Palette []string  `json:"palette"`
	Price   priceHint `json:"price"`
}

// defaultRatePerCm — ориентир цены за сантиметр суммы сторон (ширина + высота), если похожих работ мало.
var defaultRatePerCm = map[string]float64{
	"painting": 150_00, "graphics": 80_00, "sculpture": 200_00, "photo": 60_00,
	"digital": 50_00, "print": 40_00, "mixed": 120_00,
}

const minPriceSample = 5

// artworkAssistant — черновик названия, описания и ориентир цены по похожим работам.
func (s *Server) artworkAssistant(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if u.Role != "artist" {
		return httpx.Forbidden("Помощник доступен художникам")
	}
	if !s.aiLimiter.Allow("ai:" + u.ID) {
		return httpx.TooMany()
	}
	var in struct {
		ImageURL  string   `json:"image_url"`
		Title     string   `json:"title"`
		Category  string   `json:"category"`
		Style     string   `json:"style"`
		Technique string   `json:"technique"`
		Materials string   `json:"materials"`
		WidthCm   float64  `json:"width_cm"`
		HeightCm  float64  `json:"height_cm"`
		Rooms     []string `json:"rooms"`
	}
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	if !domain.IsValidCategory(in.Category) {
		return httpx.Validation(map[string]string{"category": "Выберите категорию"})
	}
	if in.Style != "" && !domain.IsValidStyle(in.Style) || in.Technique != "" && !domain.IsValidTechnique(in.Technique) || !domain.ValidRooms(in.Rooms) {
		return httpx.BadRequest("Неизвестное значение справочника")
	}
	if in.WidthCm < 0 || in.WidthCm > 1000 || in.HeightCm < 0 || in.HeightCm > 1000 || len([]rune(in.Title)) > 120 || len([]rune(in.Materials)) > 200 {
		return httpx.BadRequest("Некорректные размеры или текст")
	}
	palette := []string{}
	if in.ImageURL != "" {
		in.ImageURL = s.canonicalFileURL(in.ImageURL)
		if errs, err := s.validateImages(r.Context(), u.ID, []string{in.ImageURL}); err != nil {
			return err
		} else if errs == nil {
			if palette, err = coverPalette(r.Context(), s.DB, []string{in.ImageURL}); err != nil {
				return err
			}
		}
	}
	var locale string
	if err := s.DB.QueryRow(r.Context(), `SELECT locale FROM users WHERE id = $1`, u.ID).Scan(&locale); err != nil {
		return err
	}
	meta := domain.CatalogMeta()
	hints := providers.ArtworkHints{
		Locale: locale, Title: in.Title, Materials: in.Materials, WidthCm: in.WidthCm, HeightCm: in.HeightCm,
		Category: optionLabel(meta.Categories, in.Category), Style: optionLabel(meta.Styles, in.Style),
		Technique: optionLabel(meta.Techniques, in.Technique),
	}
	for _, c := range palette {
		for _, o := range domain.Colors {
			if o.Code == c {
				hints.Colors = append(hints.Colors, o.Label)
			}
		}
	}
	for _, room := range in.Rooms {
		hints.Rooms = append(hints.Rooms, optionLabel(domain.Rooms, room))
	}
	sugg, err := s.Assistant.SuggestArtwork(r.Context(), hints)
	if err != nil {
		return err
	}
	price, err := s.priceHint(r.Context(), in.Category, in.Technique, in.WidthCm, in.HeightCm)
	if err != nil {
		return err
	}
	httpx.OK(w, assistantDTO{ArtworkSuggestion: sugg, Palette: palette, Price: price})
	return nil
}

func optionLabel(list []domain.Option, code string) string {
	for _, o := range list {
		if o.Code == code {
			return o.Label
		}
	}
	return ""
}

// priceHint — цена по похожим работам: медиана и квартили «цены за сантиметр суммы сторон».
func (s *Server) priceHint(ctx context.Context, category, technique string, wcm, hcm float64) (priceHint, error) {
	sides := wcm + hcm
	if sides <= 0 {
		sides = 100 // 50 × 50 см
	}
	type attempt struct {
		basis, technique string
	}
	tries := []attempt{{"category", ""}}
	if technique != "" {
		tries = append([]attempt{{"similar", technique}}, tries...)
	}
	for _, t := range tries {
		var n int
		var p25, p50, p75 *float64
		err := s.DB.QueryRow(ctx, `SELECT count(*),
				percentile_cont(0.25) WITHIN GROUP (ORDER BY price_kop / (width_cm + height_cm)),
				percentile_cont(0.5) WITHIN GROUP (ORDER BY price_kop / (width_cm + height_cm)),
				percentile_cont(0.75) WITHIN GROUP (ORDER BY price_kop / (width_cm + height_cm))
			FROM artworks WHERE category = $1 AND ($2 = '' OR technique = $2)
				AND status IN ('published','reserved','sold','auction') AND width_cm + height_cm > 0`, category, t.technique).
			Scan(&n, &p25, &p50, &p75)
		if err != nil {
			return priceHint{}, err
		}
		if n >= minPriceSample && p50 != nil {
			return priceHint{
				SuggestedKop: roundPrice(*p50 * sides), MinKop: roundPrice(*p25 * sides), MaxKop: roundPrice(*p75 * sides),
				Basis: t.basis, SampleSize: n,
			}, nil
		}
	}
	rate := defaultRatePerCm[category]
	return priceHint{
		SuggestedKop: roundPrice(rate * sides), MinKop: roundPrice(rate * sides * 0.7), MaxKop: roundPrice(rate * sides * 1.4),
		Basis: "default",
	}, nil
}

// roundPrice — до 500 ₽ и в допустимых пределах цены работы.
func roundPrice(kop float64) int64 {
	v := int64(math.Round(kop/500_00)) * 500_00
	return min(max(v, domain.MinArtworkPriceKop), domain.MaxArtworkPriceKop)
}

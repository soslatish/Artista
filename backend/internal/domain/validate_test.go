package domain

import (
	"strings"
	"testing"
)

func validArtwork() ArtworkInput {
	year := 2025
	return ArtworkInput{
		Title:     "Белые ночи",
		Category:  "painting",
		Style:     "impressionism",
		Technique: "oil",
		WidthCm:   60,
		HeightCm:  80,
		Year:      &year,
		PriceKop:  25_000_00,
		Images:    []string{"/files/a.jpg"},
	}
}

func TestValidateArtwork(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ArtworkInput)
		field  string
	}{
		{"valid", func(*ArtworkInput) {}, ""},
		{"short title", func(a *ArtworkInput) { a.Title = "A" }, "title"},
		{"long title", func(a *ArtworkInput) { a.Title = strings.Repeat("я", 121) }, "title"},
		{"long description", func(a *ArtworkInput) { a.Description = strings.Repeat("x", 4001) }, "description"},
		{"bad category", func(a *ArtworkInput) { a.Category = "nft" }, "category"},
		{"bad style", func(a *ArtworkInput) { a.Style = "weird" }, "style"},
		{"empty style ok", func(a *ArtworkInput) { a.Style = "" }, ""},
		{"bad technique", func(a *ArtworkInput) { a.Technique = "laser" }, "technique"},
		{"price too low", func(a *ArtworkInput) { a.PriceKop = 2_999_99 }, "price"},
		{"price too high", func(a *ArtworkInput) { a.PriceKop = 500_000_01 }, "price"},
		{"zero width", func(a *ArtworkInput) { a.WidthCm = 0 }, "width_cm"},
		{"huge height", func(a *ArtworkInput) { a.HeightCm = 1001 }, "height_cm"},
		{"negative depth", func(a *ArtworkInput) { a.DepthCm = -1 }, "depth_cm"},
		{"future year", func(a *ArtworkInput) { y := 3000; a.Year = &y }, "year"},
		{"too many images", func(a *ArtworkInput) { a.Images = make([]string, 11) }, "images"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validArtwork()
			tt.mutate(&in)
			errs := ValidateArtwork(in, false)
			if tt.field == "" {
				if len(errs) != 0 {
					t.Fatalf("unexpected errors: %v", errs)
				}
				return
			}
			if _, ok := errs[tt.field]; !ok {
				t.Fatalf("expected error on %q, got %v", tt.field, errs)
			}
		})
	}
}

func TestValidateArtworkPublishRequiresImage(t *testing.T) {
	in := validArtwork()
	in.Images = nil
	if errs := ValidateArtwork(in, false); len(errs) != 0 {
		t.Fatalf("draft without images must be valid, got %v", errs)
	}
	if errs := ValidateArtwork(in, true); errs["images"] == "" {
		t.Fatalf("publish without images must fail, got %v", errs)
	}
}

func TestValidateRegistration(t *testing.T) {
	tests := []struct {
		name, email, password, userName, role string
		field                                 string
	}{
		{"ok buyer", "a@b.ru", "secret123", "Анна", "buyer", ""},
		{"ok artist", "a@b.ru", "secret123", "Анна", "artist", ""},
		{"bad email", "nope", "secret123", "Анна", "buyer", "email"},
		{"short password", "a@b.ru", "1234567", "Анна", "buyer", "password"},
		{"long password", "a@b.ru", strings.Repeat("x", 73), "Анна", "buyer", "password"},
		{"empty name", "a@b.ru", "secret123", " ", "buyer", "name"},
		{"admin not allowed", "a@b.ru", "secret123", "Анна", "admin", "role"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := ValidateRegistration(tt.email, tt.password, tt.userName, tt.role)
			if tt.field == "" && len(errs) != 0 {
				t.Fatalf("unexpected: %v", errs)
			}
			if tt.field != "" && errs[tt.field] == "" {
				t.Fatalf("expected error on %s, got %v", tt.field, errs)
			}
		})
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Anna@Mail.RU "); got != "anna@mail.ru" {
		t.Errorf("got %q", got)
	}
}

func TestCatalogMetaConsistent(t *testing.T) {
	meta := CatalogMeta()
	if len(meta.Categories) == 0 || len(meta.Styles) == 0 || len(meta.Techniques) == 0 {
		t.Fatal("catalog meta must not be empty")
	}
	for _, c := range meta.Categories {
		if !IsValidCategory(c.Code) || c.Label == "" {
			t.Errorf("bad category %+v", c)
		}
	}
}

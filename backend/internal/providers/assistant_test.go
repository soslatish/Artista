package providers

import (
	"context"
	"strings"
	"testing"
)

func TestTemplateAssistantRussianMoods(t *testing.T) {
	a := TemplateAssistant{}
	if a.Name() != "template" {
		t.Fatal("name")
	}
	tests := []struct {
		color, want string
	}{
		{"Синий", "спокойное"}, {"Зелёный", "свежести"}, {"Жёлтый", "света"}, {"Красный", "энергия"},
		{"Серый", "графичная"}, {"Бежевый", "уют"}, {"Белый", "лёгкость"},
	}
	for _, tt := range tests {
		s, err := a.SuggestArtwork(context.Background(), ArtworkHints{
			Category: "Живопись", Technique: "Масло", Style: "Импрессионизм", Materials: "Холст",
			Colors: []string{tt.color}, Rooms: []string{"Гостиная"}, WidthCm: 50, HeightCm: 70.5,
		})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(s.Description, tt.want) || !strings.Contains(s.Description, "50 × 70,5 см") || len(s.Titles) < 3 {
			t.Fatalf("%s: %+v", tt.color, s)
		}
	}
}

func TestTemplateAssistantEnglishAndEmpty(t *testing.T) {
	s, err := TemplateAssistant{}.SuggestArtwork(context.Background(), ArtworkHints{Locale: "en", Title: "Dawn", Colors: []string{"Blue"}, WidthCm: 30, HeightCm: 40})
	if err != nil {
		t.Fatal(err)
	}
	if s.Titles[0] != "Dawn" || !strings.Contains(s.Description, "blue") || !strings.Contains(s.Description, "30 × 40 cm") {
		t.Fatalf("en = %+v", s)
	}
	s, _ = TemplateAssistant{}.SuggestArtwork(context.Background(), ArtworkHints{})
	if !strings.HasPrefix(s.Description, "Работа") || len(s.Tags) != 0 {
		t.Fatalf("empty = %+v", s)
	}
}

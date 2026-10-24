package providers

import (
	"context"
	"fmt"
	"strings"
)

// ---------- ИИ-помощник художника ----------

// ArtworkHints — что известно о работе на момент публикации (подписи на нужном языке).
type ArtworkHints struct {
	Locale    string   // ru | en
	Title     string   // если художник уже придумал название
	Category  string   // «Живопись»
	Style     string   // «Импрессионизм»
	Technique string   // «Масло»
	Materials string   // «холст, масло»
	Colors    []string // «синий», «золотой»
	Rooms     []string // «гостиная»
	WidthCm   float64
	HeightCm  float64
}

// ArtworkSuggestion — черновик названия и описания.
type ArtworkSuggestion struct {
	Titles      []string `json:"titles"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

// Assistant — генерация текстов для карточки работы (YandexGPT / GigaChat подключаются через этот интерфейс).
type Assistant interface {
	Name() string
	SuggestArtwork(ctx context.Context, h ArtworkHints) (ArtworkSuggestion, error)
}

// TemplateAssistant — заглушка без нейросети: собирает текст из шаблонов по свойствам работы.
type TemplateAssistant struct{}

func (TemplateAssistant) Name() string { return "template" }

func (TemplateAssistant) SuggestArtwork(_ context.Context, h ArtworkHints) (ArtworkSuggestion, error) {
	if h.Locale == "en" {
		return suggestEN(h), nil
	}
	return suggestRU(h), nil
}

func suggestRU(h ArtworkHints) ArtworkSuggestion {
	mood := moodRU(h.Colors)
	titles := []string{}
	if h.Title != "" {
		titles = append(titles, h.Title)
	}
	titles = append(titles, mood.title+" "+mood.place, "Этюд в "+mood.tone+" тонах", "Без названия №"+fmt.Sprint(int(h.WidthCm+h.HeightCm)%97+1))

	var b strings.Builder
	kind := strings.ToLower(nonEmpty(h.Category, "Работа"))
	b.WriteString(capitalize(kind))
	if h.Technique != "" {
		b.WriteString(" — " + strings.ToLower(h.Technique))
	}
	if h.Style != "" {
		b.WriteString(", " + strings.ToLower(h.Style))
	}
	b.WriteString(". ")
	if len(h.Colors) > 0 {
		b.WriteString(fmt.Sprintf("В работе преобладают %s тона — %s. ", strings.Join(lower(h.Colors), " и "), mood.feeling))
	}
	if h.WidthCm > 0 && h.HeightCm > 0 {
		b.WriteString(fmt.Sprintf("Размер %s × %s см", trimNum(h.WidthCm), trimNum(h.HeightCm)))
		if h.Materials != "" {
			b.WriteString(", " + strings.ToLower(h.Materials))
		}
		b.WriteString(". ")
	}
	if len(h.Rooms) > 0 {
		b.WriteString("Хорошо впишется в интерьер: " + strings.Join(lower(h.Rooms), ", ") + ". ")
	}
	b.WriteString("Оригинал в единственном экземпляре, подписан автором. Расскажите здесь, что вдохновило вас на эту работу, — покупатели любят истории.")
	return ArtworkSuggestion{Titles: unique(titles), Description: b.String(), Tags: tags(h)}
}

func suggestEN(h ArtworkHints) ArtworkSuggestion {
	titles := []string{}
	if h.Title != "" {
		titles = append(titles, h.Title)
	}
	titles = append(titles, "Quiet Light", "Study in "+nonEmpty(first(h.Colors), "Color"), "Untitled No. "+fmt.Sprint(int(h.WidthCm+h.HeightCm)%97+1))
	var b strings.Builder
	b.WriteString(capitalize(nonEmpty(h.Category, "Artwork")))
	if h.Technique != "" {
		b.WriteString(" — " + strings.ToLower(h.Technique))
	}
	b.WriteString(". ")
	if len(h.Colors) > 0 {
		b.WriteString("Dominated by " + strings.Join(lower(h.Colors), " and ") + " tones. ")
	}
	if h.WidthCm > 0 && h.HeightCm > 0 {
		b.WriteString(fmt.Sprintf("Size %s × %s cm. ", trimNum(h.WidthCm), trimNum(h.HeightCm)))
	}
	b.WriteString("A one-of-a-kind original signed by the artist. Tell buyers what inspired this piece — they love the story behind it.")
	return ArtworkSuggestion{Titles: unique(titles), Description: b.String(), Tags: tags(h)}
}

type mood struct{ title, place, tone, feeling string }

func moodRU(colors []string) mood {
	c := strings.ToLower(first(colors))
	switch c {
	case "синий", "бирюзовый":
		return mood{"Тишина", "у воды", "холодных", "спокойное, созерцательное настроение"}
	case "зелёный":
		return mood{"Летний", "сад", "зелёных", "ощущение свежести и покоя"}
	case "жёлтый", "оранжевый":
		return mood{"Солнце", "над полем", "тёплых", "много света и тепла"}
	case "красный", "розовый":
		return mood{"Пламя", "заката", "тёплых", "энергия и характер"}
	case "чёрный", "серый":
		return mood{"Город", "в тумане", "приглушённых", "графичная, сдержанная атмосфера"}
	case "коричневый", "бежевый":
		return mood{"Осень", "в деревне", "землистых", "уют и тепло"}
	default:
		return mood{"Свет", "утра", "светлых", "лёгкость и воздух"}
	}
}

func tags(h ArtworkHints) []string {
	out := []string{}
	for _, t := range []string{h.Category, h.Style, h.Technique} {
		if t != "" {
			out = append(out, strings.ToLower(t))
		}
	}
	return append(out, lower(h.Colors)...)
}

func lower(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = strings.ToLower(s)
	}
	return out
}

func first(in []string) string {
	if len(in) == 0 {
		return ""
	}
	return in[0]
}

func nonEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func capitalize(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func trimNum(v float64) string {
	s := fmt.Sprintf("%.1f", v)
	s = strings.TrimSuffix(s, ".0")
	return strings.ReplaceAll(s, ".", ",")
}

func unique(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

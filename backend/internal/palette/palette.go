// Package palette определяет основные цвета изображения и раскладывает их
// по именованной палитре (domain.Colors) — для поиска по цвету и «похожих работ».
package palette

import (
	"fmt"
	"image"
	_ "image/jpeg" // декодеры форматов, которые принимает загрузка
	_ "image/png"
	"io"
	"math"
	"sort"

	_ "golang.org/x/image/webp"
)

const (
	samplesPerSide = 96   // сетка выборки: ~9 тыс. точек достаточно для доли цвета
	minShare       = 0.08 // цвет попадает в палитру, если занимает от 8% площади
	maxColors      = 3
)

// Result — палитра и размеры изображения.
type Result struct {
	Colors        []string
	Width, Height int
}

// FromReader декодирует изображение (JPEG, PNG, WebP) и возвращает до трёх основных цветов.
func FromReader(r io.Reader) (Result, error) {
	img, _, err := image.Decode(r)
	if err != nil {
		return Result{}, fmt.Errorf("decode image: %w", err)
	}
	return FromImage(img), nil
}

// FromImage считает палитру уже декодированного изображения.
func FromImage(img image.Image) Result {
	b := img.Bounds()
	res := Result{Width: b.Dx(), Height: b.Dy()}
	if b.Dx() == 0 || b.Dy() == 0 {
		return res
	}
	counts := map[string]int{}
	total := 0
	stepX := max(1, b.Dx()/samplesPerSide)
	stepY := max(1, b.Dy()/samplesPerSide)
	for y := b.Min.Y; y < b.Max.Y; y += stepY {
		for x := b.Min.X; x < b.Max.X; x += stepX {
			r, g, bl, a := img.At(x, y).RGBA()
			if a < 0x8000 { // прозрачные пиксели не считаем
				continue
			}
			counts[Classify(uint8(r>>8), uint8(g>>8), uint8(bl>>8))]++
			total++
		}
	}
	if total == 0 {
		return res
	}
	type share struct {
		name string
		n    int
	}
	shares := make([]share, 0, len(counts))
	for name, n := range counts {
		shares = append(shares, share{name, n})
	}
	sort.Slice(shares, func(i, j int) bool {
		if shares[i].n != shares[j].n {
			return shares[i].n > shares[j].n
		}
		return shares[i].name < shares[j].name
	})
	for _, s := range shares {
		if len(res.Colors) == maxColors || float64(s.n)/float64(total) < minShare {
			break
		}
		res.Colors = append(res.Colors, s.name)
	}
	return res
}

// Classify относит цвет пикселя к одному из кодов domain.Colors.
func Classify(r, g, b uint8) string {
	h, s, l := hsl(r, g, b)
	switch {
	case l < 0.14:
		return "black"
	case l > 0.92:
		return "white"
	case s < 0.14:
		if l > 0.8 {
			return "white"
		}
		if l < 0.22 {
			return "black"
		}
		return "gray"
	}
	// тёплые приглушённые тона — коричневый и бежевый
	if h >= 15 && h < 50 {
		if l < 0.42 && s < 0.75 {
			return "brown"
		}
		if l > 0.62 && s < 0.55 {
			return "beige"
		}
	}
	switch {
	case h < 15 || h >= 345:
		if l > 0.7 {
			return "pink"
		}
		return "red"
	case h < 42:
		return "orange"
	case h < 70:
		return "yellow"
	case h < 160:
		return "green"
	case h < 195:
		return "teal"
	case h < 255:
		return "blue"
	case h < 290:
		return "purple"
	default:
		return "pink"
	}
}

// hsl переводит RGB в тон (0–360), насыщенность и светлоту (0–1).
func hsl(r8, g8, b8 uint8) (h, s, l float64) {
	r, g, b := float64(r8)/255, float64(g8)/255, float64(b8)/255
	mx := math.Max(r, math.Max(g, b))
	mn := math.Min(r, math.Min(g, b))
	l = (mx + mn) / 2
	if mx == mn {
		return 0, 0, l
	}
	d := mx - mn
	if l > 0.5 {
		s = d / (2 - mx - mn)
	} else {
		s = d / (mx + mn)
	}
	switch mx {
	case r:
		h = (g - b) / d
		if g < b {
			h += 6
		}
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return h * 60, s, l
}

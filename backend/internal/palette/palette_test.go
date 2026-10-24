package palette

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"slices"
	"strings"
	"testing"

	"github.com/soslatish/artista/backend/internal/domain"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name    string
		r, g, b uint8
		want    string
	}{
		{"pure red", 200, 30, 30, "red"},
		{"light red is pink", 245, 170, 170, "pink"},
		{"orange", 230, 126, 34, "orange"},
		{"yellow", 241, 196, 15, "yellow"},
		{"green", 40, 160, 70, "green"},
		{"teal", 22, 160, 133, "teal"},
		{"blue", 46, 111, 216, "blue"},
		{"purple", 142, 68, 173, "purple"},
		{"magenta", 220, 60, 170, "pink"},
		{"brown", 120, 75, 35, "brown"},
		{"beige", 225, 205, 170, "beige"},
		{"white", 250, 250, 248, "white"},
		{"gray", 128, 128, 128, "gray"},
		{"black", 15, 15, 20, "black"},
		{"dark gray is black", 45, 45, 45, "black"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Classify(tt.r, tt.g, tt.b)
			if got != tt.want {
				t.Fatalf("Classify(%d,%d,%d) = %s, want %s", tt.r, tt.g, tt.b, got, tt.want)
			}
			if !domain.IsColor(got) {
				t.Fatalf("%s is not a domain color", got)
			}
		})
	}
}

// stripes рисует картинку из горизонтальных полос заданных цветов и долей.
func stripes(w, h int, parts []struct {
	c     color.RGBA
	share float64
}) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	y := 0
	for i, p := range parts {
		end := y + int(float64(h)*p.share)
		if i == len(parts)-1 {
			end = h
		}
		for ; y < end; y++ {
			for x := 0; x < w; x++ {
				img.Set(x, y, p.c)
			}
		}
	}
	return img
}

func TestFromImageTopColors(t *testing.T) {
	img := stripes(300, 400, []struct {
		c     color.RGBA
		share float64
	}{
		{color.RGBA{46, 111, 216, 255}, 0.55}, // синий
		{color.RGBA{241, 196, 15, 255}, 0.30}, // жёлтый
		{color.RGBA{200, 30, 30, 255}, 0.10},  // красный
		{color.RGBA{40, 160, 70, 255}, 0.05},  // зелёный — меньше порога
	})
	res := FromImage(img)
	if res.Width != 300 || res.Height != 400 {
		t.Fatalf("size = %dx%d", res.Width, res.Height)
	}
	want := []string{"blue", "yellow", "red"}
	if !slices.Equal(res.Colors, want) {
		t.Fatalf("colors = %v, want %v", res.Colors, want)
	}
}

func TestFromReaderPNGAndErrors(t *testing.T) {
	var buf bytes.Buffer
	img := stripes(50, 50, []struct {
		c     color.RGBA
		share float64
	}{{color.RGBA{15, 15, 20, 255}, 1}})
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	res, err := FromReader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.Colors, []string{"black"}) {
		t.Fatalf("colors = %v", res.Colors)
	}
	if _, err := FromReader(strings.NewReader("not an image")); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestTransparentAndEmpty(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 10, 10)) // полностью прозрачная
	if res := FromImage(img); len(res.Colors) != 0 {
		t.Fatalf("transparent colors = %v", res.Colors)
	}
	if res := FromImage(image.NewRGBA(image.Rect(0, 0, 0, 0))); len(res.Colors) != 0 {
		t.Fatal("empty image has colors")
	}
}

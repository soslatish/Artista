package api

import (
	"bytes"
	"errors"
	"image"
	"io"
	"net/http"
	"path/filepath"

	"github.com/soslatish/artista/backend/internal/httpx"
	"github.com/soslatish/artista/backend/internal/palette"
	"github.com/soslatish/artista/backend/internal/providers"
)

var imageTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

const (
	// maxUploadPixels — ограничение разрешения: декодирование большего изображения съест слишком много памяти.
	maxUploadPixels = 50_000_000
	// decodeSlots — сколько изображений декодируется одновременно.
	decodeSlots = 2
)

// decodeSem ограничивает параллельное декодирование (память).
var decodeSem = make(chan struct{}, decodeSlots)

type uploadDTO struct {
	URL     string   `json:"url"`
	Palette []string `json:"palette"`
	Width   int      `json:"width"`
	Height  int      `json:"height"`
}

// upload принимает изображение (multipart, поле file). Тип определяется по содержимому, а не по имени.
// Сервер запоминает владельца файла и считает палитру (для поиска по цвету и похожих работ).
func (s *Server) upload(w http.ResponseWriter, r *http.Request, u httpx.User) error {
	if !s.uploadLimiter.Allow("upload:" + u.ID) {
		return httpx.TooMany()
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.Config.MaxUploadBytes+1024)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return &httpx.Error{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "Файл больше 10 МБ"}
		}
		return httpx.BadRequest("Прикрепите файл в поле file")
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, s.Config.MaxUploadBytes+1))
	if err != nil {
		return httpx.BadRequest("Не удалось прочитать файл")
	}
	if int64(len(data)) > s.Config.MaxUploadBytes {
		return &httpx.Error{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "Файл больше 10 МБ"}
	}
	ext, ok := imageTypes[http.DetectContentType(data)]
	if !ok {
		return httpx.Validation(map[string]string{"file": "Поддерживаются JPEG, PNG и WebP"})
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return httpx.Validation(map[string]string{"file": "Файл повреждён или это не изображение"})
	}
	if cfg.Width*cfg.Height > maxUploadPixels {
		return httpx.Validation(map[string]string{"file": "Слишком большое разрешение — до 50 мегапикселей"})
	}
	res := s.imagePalette(r, data)
	if res.Width == 0 {
		res.Width, res.Height = cfg.Width, cfg.Height
	}
	url, err := s.Storage.Save(r.Context(), ext, bytes.NewReader(data))
	if err != nil {
		return err
	}
	if res.Colors == nil {
		res.Colors = []string{}
	}
	if _, err := s.DB.Exec(r.Context(), `INSERT INTO uploads (url, user_id, palette, width, height) VALUES ($1, $2, $3, $4, $5)`,
		url, u.ID, res.Colors, res.Width, res.Height); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, uploadDTO{URL: url, Palette: res.Colors, Width: res.Width, Height: res.Height}, nil)
	return nil
}

// imagePalette считает палитру; ошибка декодирования не мешает загрузке (палитра будет пустой).
func (s *Server) imagePalette(r *http.Request, data []byte) palette.Result {
	select {
	case decodeSem <- struct{}{}:
	case <-r.Context().Done():
		return palette.Result{}
	}
	defer func() { <-decodeSem }()
	res, err := palette.FromReader(bytes.NewReader(data))
	if err != nil {
		s.Log.Warn("palette", "err", err)
	}
	return res
}

// serveFile раздаёт загруженные файлы (только имена, сгенерированные сервером).
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !providers.IsSafeFileName(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filepath.Join(s.Config.UploadDir, name))
}

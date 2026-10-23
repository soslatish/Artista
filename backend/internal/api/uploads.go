package api

import (
	"bufio"
	"errors"
	"io"
	"net/http"
	"path/filepath"

	"github.com/soslatish/artista/backend/internal/httpx"
	"github.com/soslatish/artista/backend/internal/providers"
)

var imageTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

// upload принимает изображение (multipart, поле file). Тип определяется по содержимому, а не по имени.
func (s *Server) upload(w http.ResponseWriter, r *http.Request, _ httpx.User) error {
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

	br := bufio.NewReaderSize(file, 512)
	head, _ := br.Peek(512)
	ext, ok := imageTypes[http.DetectContentType(head)]
	if !ok {
		return httpx.Validation(map[string]string{"file": "Поддерживаются JPEG, PNG и WebP"})
	}
	url, err := s.Storage.Save(r.Context(), ext, io.LimitReader(br, s.Config.MaxUploadBytes))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"url": url}, nil)
	return nil
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

package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Веб-версия приложения (экспорт Expo для web) живёт под /app/: так ей пользуются те, у кого
// приложение не установлено, — например, открыв ссылку во встроенном браузере Telegram.
// Сборка кладётся в WEB_APP_DIR; если её нет, сайт просто не показывает кнопку «Открыть в браузере».

const webAppPrefix = "/app"

// webAppURL — адрес веб-версии, если сборка установлена.
func (s *Server) webAppURL() string {
	if s.Config.WebAppDir == "" {
		return ""
	}
	if _, err := os.Stat(filepath.Join(s.Config.WebAppDir, "index.html")); err != nil {
		return ""
	}
	return webAppPrefix
}

// webApp отдаёт файлы сборки, а для маршрутов приложения (/app/artwork/…) — index.html:
// дальше страницу открывает expo-router на клиенте.
func (s *Server) webApp(w http.ResponseWriter, r *http.Request) {
	if s.webAppURL() == "" {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	rel := path.Clean("/" + strings.TrimPrefix(r.URL.Path, webAppPrefix))
	root, err := filepath.Abs(s.Config.WebAppDir)
	if err != nil {
		http.Error(w, "Внутренняя ошибка", http.StatusInternalServerError)
		return
	}
	file := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(file, root+string(filepath.Separator)) && file != root {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(file); err == nil && !info.IsDir() {
		if strings.HasPrefix(rel, "/_expo/static/") || strings.HasPrefix(rel, "/assets/") {
			// имена файлов содержат хэш содержимого — можно кэшировать надолго
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, file)
		return
	}
	if path.Ext(rel) != "" && !strings.HasSuffix(rel, ".html") {
		http.NotFound(w, r) // отсутствующий ресурс, а не маршрут приложения
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(root, "index.html"))
}

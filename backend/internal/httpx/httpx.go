// Package httpx — JSON-ответы, ошибки и middleware для HTTP API.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

// maxJSONBody — ограничение размера JSON-запроса.
const maxJSONBody = 1 << 20

// Error — ошибка API с кодом для клиента.
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Конструкторы типовых ошибок.
func BadRequest(msg string) *Error { return &Error{http.StatusBadRequest, "bad_request", msg, nil} }
func Validation(fields map[string]string) *Error {
	return &Error{http.StatusUnprocessableEntity, "validation", "Проверьте введённые данные", fields}
}
func Unauthorized(msg string) *Error {
	return &Error{http.StatusUnauthorized, "unauthorized", msg, nil}
}
func Forbidden(msg string) *Error { return &Error{http.StatusForbidden, "forbidden", msg, nil} }
func NotFound(msg string) *Error  { return &Error{http.StatusNotFound, "not_found", msg, nil} }
func Conflict(code, msg string) *Error {
	return &Error{http.StatusConflict, code, msg, nil}
}
func TooMany() *Error {
	return &Error{http.StatusTooManyRequests, "rate_limited", "Слишком много запросов, попробуйте позже", nil}
}

type envelope struct {
	Data  any `json:"data,omitempty"`
	Meta  any `json:"meta,omitempty"`
	Error any `json:"error,omitempty"`
}

// JSON пишет успешный ответ {"data": ..., "meta": ...}.
func JSON(w http.ResponseWriter, status int, data, meta any) {
	write(w, status, envelope{Data: data, Meta: meta})
}

// OK — 200 с данными.
func OK(w http.ResponseWriter, data any) { JSON(w, http.StatusOK, data, nil) }

// NoContent — 204.
func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// Fail пишет ошибку. Неизвестные ошибки логируются и отдаются как 500 без деталей.
func Fail(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		write(w, apiErr.Status, envelope{Error: apiErr})
		return
	}
	log.Error("internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	write(w, http.StatusInternalServerError, envelope{Error: &Error{Code: "internal", Message: "Внутренняя ошибка сервера"}})
}

func write(w http.ResponseWriter, status int, body envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Decode читает JSON-тело запроса в v с ограничением размера и запретом лишних полей.
func Decode(w http.ResponseWriter, r *http.Request, v any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		return BadRequest("Ожидается application/json")
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		if errors.Is(err, io.EOF) {
			return BadRequest("Пустое тело запроса")
		}
		return BadRequest("Некорректный JSON: " + err.Error())
	}
	return nil
}

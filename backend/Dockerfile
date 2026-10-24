# syntax=docker/dockerfile:1
# Собирается из корня репозитория (docker compose: context: ..):
# API на Go + веб-версия приложения (Expo export), которую API раздаёт по /app/.

FROM node:22-alpine AS web
WORKDIR /mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./
# API_URL не задаём: в браузере приложение обращается к тому же домену, с которого открыто
RUN EXPO_PUBLIC_API_URL= npx expo export -p web --output-dir /out/webapp

FROM golang:1.24-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app && mkdir -p /data/uploads && chown app /data/uploads
USER app
COPY --from=build /out/api /usr/local/bin/api
COPY --from=web /out/webapp /srv/webapp
ENV HTTP_ADDR=:8080 UPLOAD_DIR=/data/uploads WEB_APP_DIR=/srv/webapp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["api"]

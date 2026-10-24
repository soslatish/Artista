# Локальная разработка backend
DB ?= postgres://artista:artista@localhost:5432/artista?sslmode=disable
TEST_DB ?= postgres://artista:artista@localhost:5432/artista_test?sslmode=disable

.PHONY: run test cover lint webapp

run:
	DATABASE_URL=$(DB) JWT_SECRET=dev-secret-dev-secret-dev-secret-32 ALLOW_STUB_PAYMENTS=true go run ./cmd/api

test:
	TEST_DATABASE_URL=$(TEST_DB) go test -race -count=1 ./...

cover:
	TEST_DATABASE_URL=$(TEST_DB) go test -count=1 -coverpkg=./internal/... -coverprofile=cover.out ./...
	go tool cover -func=cover.out | tail -1

lint:
	gofmt -l . && go vet ./...

# веб-версия приложения для /app/ (локально; в Docker собирается автоматически)
webapp:
	cd ../mobile && EXPO_PUBLIC_API_URL= npx expo export -p web --output-dir ../backend/webapp

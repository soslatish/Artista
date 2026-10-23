# Artista — архитектура

```
┌──────────────────────────┐     HTTPS / JSON      ┌──────────────────────────────┐
│  mobile/ (Expo SDK 58)   │ ───────────────────▶  │  backend/ (Go 1.24)          │
│  iOS + Android, TS       │ ◀── WebSocket /ws ──  │  net/http, pgx, JWT          │
│  expo-router, TanStack Q │                       │                              │
└──────────────────────────┘                       │  ┌─ Payments (stub|yookassa) │
                                                   │  ├─ Delivery (tariff|cdek)  │
                                                   │  ├─ Push (log|expo)         │
                                                   │  ├─ Mailer (log|smtp)       │
                                                   │  └─ Storage (local|s3)      │
                                                   └──────────┬───────────────────┘
                                                              │
                                                     PostgreSQL 16 (+ файлы)
```

## Backend: структура

```
backend/
  cmd/api/main.go            — запуск: конфиг, миграции, HTTP, фоновые задачи
  internal/
    config/                  — переменные окружения, проверка обязательных
    db/migrations/*.sql      — встроенные миграции (embed), простой мигратор
    httpx/                   — JSON-ответы, ошибки, middleware (auth, recover, rate limit, CORS, логи)
    auth/                    — пароли (bcrypt), JWT, refresh-токены, сброс пароля
    users/                   — профиль, роли, удаление аккаунта, подписки на художников
    artworks/                — работы, фото, каталог, поиск, фильтры, избранное, статистика
    orders/                  — заказы, машина состояний, комиссия, фоновые таймауты
    payments/                — интерфейс Provider + stub; вебхук
    delivery/                — интерфейс Quoter + тарифная таблица
    chat/                    — диалоги, сообщения, WebSocket-хаб
    reviews/                 — отзывы и рейтинг
    notify/                  — in-app уведомления, push-токены, Pusher (log|expo)
    reports/                 — жалобы, модерация (admin)
    storage/                 — интерфейс Storage + локальный диск
    billing/                 — премиум-подписка художника
  apitest/                   — интеграционные тесты HTTP API на реальном Postgres
```

Каждый пакет: `model.go` (типы), `repo.go` (SQL через pgx), `service.go` (бизнес-логика,
зависит от интерфейсов), `handler.go` (HTTP). Бизнес-правила (машина состояний заказа,
комиссия, тарифы доставки, валидация) — чистые функции с юнит-тестами.

## Модель данных (основное)

| Таблица | Ключевые поля |
|---|---|
| users | id uuid, email uniq (citext), password_hash, name, role (buyer/artist/admin), city, bio, avatar_url, social jsonb, premium_until, deleted_at |
| refresh_tokens | id, user_id, token_hash, expires_at, revoked_at |
| password_resets | id, user_id, code_hash, expires_at, used_at, attempts |
| artworks | id, artist_id, title, description, category, style, technique, materials, width/height/depth_cm, year, price_kop bigint, status (draft/published/reserved/sold/archived/hidden), views, search tsvector |
| artwork_images | id, artwork_id, url, position |
| favorites | user_id, artwork_id, created_at (PK пара) |
| follows | follower_id, artist_id |
| orders | id, buyer_id, artist_id, artwork_id, price_kop, delivery_kop, commission_kop, total_kop, status, delivery_method, address jsonb, tracking_number, payment_id, payout_status, дедлайны и метки времени статусов |
| payments | id, order_id/subscription, provider, external_id, amount_kop, status, purpose |
| conversations / messages | buyer_id, artist_id, artwork_id; sender_id, body, read_at |
| reviews | order_id uniq, author_id, artist_id, rating 1–5, text |
| notifications | user_id, type, title, body, data jsonb, read_at |
| device_tokens | user_id, token, platform |
| reports | reporter_id, target_type, target_id, reason, status |

Деньги храним в копейках (`bigint`).

## API (v1, префикс `/api/v1`)

Ответ: `{"data": ..., "meta": {...}}`; ошибка: `{"error": {"code": "...", "message": "..."}}`.
Пагинация курсором: `?limit=20&cursor=...` → `meta.next_cursor`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | /auth/register, /auth/login, /auth/refresh, /auth/logout | аккаунт и токены |
| POST | /auth/password/forgot, /auth/password/reset | сброс пароля по коду |
| GET/PATCH/DELETE | /me | профиль, удаление аккаунта |
| POST | /me/become-artist | стать художником |
| GET | /me/stats | статистика художника |
| POST/DELETE | /me/devices | push-токены |
| POST | /me/subscription | купить премиум (stub-оплата) |
| GET | /users/{id}, /users/{id}/artworks, /users/{id}/reviews | публичный профиль |
| POST/DELETE | /users/{id}/follow | подписка на художника |
| GET | /artworks | каталог: q, category, style, technique, price_min/max, size_max, city, sort, feed=new/popular/for_you |
| POST | /artworks | создать работу |
| GET/PATCH/DELETE | /artworks/{id} | карточка, правка, архив |
| POST | /artworks/{id}/publish | опубликовать черновик |
| POST/DELETE | /artworks/{id}/favorite | избранное |
| GET | /me/favorites, /me/artworks | мои списки |
| GET | /catalog/meta | справочники категорий/стилей/техник |
| POST | /uploads | загрузка изображения (multipart) |
| GET | /delivery/quote | расчёт доставки |
| POST | /orders | оформить заказ |
| GET | /orders?role=buyer\|artist, /orders/{id} | мои заказы |
| POST | /orders/{id}/pay, /confirm, /decline, /ship, /complete, /cancel | переходы статусов |
| POST | /payments/{id}/stub-confirm | тестовая оплата (только PAYMENTS_PROVIDER=stub) |
| POST | /webhooks/payments | вебхук платёжки (заготовка) |
| GET/POST | /conversations, /conversations/{id}/messages | чат |
| POST | /conversations/{id}/read | прочитано |
| GET | /ws?token= | WebSocket: новые сообщения и уведомления |
| POST | /orders/{id}/review | отзыв |
| GET | /notifications, POST /notifications/read | уведомления |
| POST | /reports | жалоба |
| GET/POST | /admin/reports, /admin/reports/{id}/resolve | модерация |

## Мобильное приложение

```
mobile/
  app/                       — expo-router
    (auth)/  welcome, login, register, forgot
    (tabs)/  index (лента), search, sell|favorites, messages, profile
    artwork/[id], artwork/edit, artist/[id], checkout/[artworkId], orders/, orders/[id],
    chat/[id], notifications, settings, stats, premium
  src/
    api/       — fetch-клиент с авто-refresh, типы, хуки TanStack Query
    auth/      — хранилище токенов (expo-secure-store), контекст сессии
    ui/        — тема (бордо + золото), компоненты
    lib/       — форматирование цен, валидация (zod)
```

## Тестирование
- Go: юнит-тесты бизнес-правил (table-driven), интеграционные тесты API на Postgres (`apitest`), `-race`, покрытие ≥ 80%.
- Mobile: jest-expo + Testing Library для компонентов и API-клиента; проверка в веб-сборке через Playwright.

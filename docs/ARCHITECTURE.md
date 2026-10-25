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
| reports | reporter_id, target_type (artwork/user/message/question/post), target_id, reason, status |
| uploads | url, owner_id, palette — владелец файла и цвета обложки; чужие файлы в работах не принимаются |
| artwork_views | artwork_id, viewer_id, source, created_at — история, «похожие», источники в статистике |
| saved_searches | user_id, title, filters jsonb, notified_at |
| collections / collection_items | slug, title, kind (manual/filter), filters jsonb |
| series | artist_id, title, description, position; artworks.series_id |
| offers | artwork_id, buyer_id, amount_kop, counter_kop, status, expires_at |
| price_locks | artwork_id, user_id, price_kop, source (offer/auction), expires_at, used_at — применяется при заказе |
| auctions / bids | artwork_id, start_kop, step_kop, current_kop, leader_id, ends_at, status; bidder_id, amount_kop |
| commissions | buyer_id, artist_id, description, размеры, budget_kop, images, quote_kop, quote_days, order_id |
| certificates | code uniq, artwork_id, order_id, owner_id, status (active/transferred), previous_id |
| exhibitions / exhibition_reminders | artist_id, title, starts_at, opened_at, cancelled_at; artworks.exhibition_id |
| posts / post_likes, artwork_questions | лента мастерских и вопросы о работе |
| promotions | artwork_id, days, price_kop, status, starts_at, ends_at; оплата через payments (purpose=promotion) |
| platform_settings | одна строка jsonb с параметрами платформы; сервер перечитывает её на каждом шаге воркера |
| admin_actions | журнал действий администраторов: admin_id, action, target, details |

Новые поля: `artworks.palette, rooms, allow_offers`, статусы `scheduled / auction / commission`;
`users.vacation_until, accepts_commissions, commission_note, locale`; `orders.kind, price_lock_id, ship_days`;
`messages.image_url`. Деньги храним в копейках (`bigint`).

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
| GET | /artworks/{id}/similar, /me/history (DELETE — очистить) | похожие и история |
| GET/POST/DELETE | /me/saved-searches | сохранённые поиски |
| GET | /collections, /collections/{slug}; /admin/collections | подборки |
| POST/GET | /artworks/{id}/offers, /offers, /offers/{id}/{accept\|counter\|decline\|withdraw} | торг |
| POST/GET | /artworks/{id}/auction, /auctions/{id}, /auctions/{id}/bids, /auctions/{id}/cancel | аукционы |
| POST/GET | /commissions, /commissions/{id}/{quote\|decline\|cancel\|accept} | работы на заказ |
| GET/POST | /certificates/{code}, /certificates/{code}/qr.png, /certificates/{code}/transfer, /me/certificates | сертификаты |
| GET/POST | /feed/posts, /posts, /posts/{id}/like; /users/{id}/posts | посты |
| GET/POST/PATCH | /exhibitions, /exhibitions/{id}, /cancel, /remind | выставки |
| GET/POST/PATCH/DELETE | /users/{id}/series, /me/series | серии |
| GET/POST | /artworks/{id}/questions, /questions/{id}/answer | вопросы о работе |
| POST/GET | /artworks/{id}/promote, /me/promotions | продвижение |
| GET | /me/stats/detailed?days= | расширенная статистика (премиум) |
| POST | /assistant/artwork | помощник описания |
| GET | /admin/dashboard | сводка для админки |
| GET/PUT | /admin/settings | параметры платформы (комиссия, Премиум, тарифы, функции, объявление) |
| GET/PATCH | /admin/users, /admin/users/{id} | пользователи: блокировка, роль, Премиум, профиль |
| GET/PATCH | /admin/artworks, /admin/artworks/{id} | работы: статус, цена, название |
| GET/POST | /admin/orders, /admin/orders/{id}, /admin/orders/{id}/{cancel\|complete} | заказы и споры |
| GET | /admin/payments, /admin/certificates, /admin/audit | платежи, сертификаты, журнал |
| GET/POST | /admin/deals/{kind}, /admin/deals/{kind}/{id}/cancel | аукционы, предложения, заказы на создание, выставки |
| GET/POST | /admin/content/{kind}, /admin/content/{kind}/{id}/hidden | посты и вопросы |
| POST | /admin/broadcast | рассылка уведомлений |

Сайт (без префикса): `/`, `/a/{id}`, `/u/{id}`, `/e/{id}`, `/c/{code}`, `/collections/{slug}`, `/legal/{doc}`,
`/sitemap.xml`, `/robots.txt`, `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`.

## Мобильное приложение

```
mobile/src/
  app/         — expo-router: вкладки, работа, примерка, художник, заказ, предложения, аукцион,
                 работы на заказ, выставки, подборки, сертификаты, серии, посты, продвижение, настройки;
                 a/ u/ e/ c/ collections/ — короткие ссылки сайта, перенаправляют на экраны
  api/         — fetch-клиент с авто-refresh и Accept-Language, типы, хуки TanStack Query
  auth/        — сессия, токены в expo-secure-store
  features/    — формы и сценарии: работа, примерка, PDF сертификата, статусы сделок, realtime
  i18n/        — useT(), ключ — русская строка, словарь en.ts; scripts/extract-strings.mjs находит новые строки
  ui/          — tokens.ts (светлая и тёмная палитры), theme-context (makeStyles), компоненты
  lib/         — форматирование, валидация, фильтры каталога, настройки устройства
```

## Тестирование
- Go: юнит-тесты бизнес-правил (table-driven), интеграционные тесты API на Postgres (`apitest`), `-race`, покрытие ≥ 80%.
- Mobile: jest-expo + Testing Library для компонентов и API-клиента; проверка в веб-сборке через Playwright.

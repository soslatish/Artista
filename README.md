# Artista

Маркетплейс оригинальных работ художников: мобильное приложение для iOS и Android + API.
Модель из бизнес-плана: комиссия 15%, премиум художника 990 ₽/мес (0% до 100 000 ₽ продаж в месяц),
безопасная сделка — деньги уходят художнику после подтверждения получения.

```
backend/   Go 1.24 — API, Postgres, WebSocket, фоновые таймауты заказов
mobile/    Expo SDK 58 — React Native 0.88, expo-router, TanStack Query
infra/     docker-compose: Postgres + API + nginx
docs/      PRD.md (требования MVP), ARCHITECTURE.md (схема, модель данных, API)
.claude/   агенты, правила и скиллы everything-claude-code для разработки
```

## Что работает в MVP

| Покупатель | Художник |
|---|---|
| Лента «Новое / Популярное / Для вас», поиск с фильтрами | Публикация работ с камеры или из галереи, черновики, архив |
| Карточка работы, просмотр фото на весь экран с зумом | Подтверждение заказа, отправка с трек-номером |
| Покупка: адрес, расчёт доставки, оплата, статусы | Расчёт выплаты и комиссии, статистика |
| Подтверждение получения, отзыв | Премиум-подписка, отметка в ленте |
| Избранное, подписки на художников | Подписчики получают уведомление о новой работе |
| Чат с художником в реальном времени, уведомления, жалобы, удаление аккаунта |

Автоматика сделки: неоплаченный заказ отменяется через 30 минут, неподтверждённый — через 24 часа
(с возвратом), неотправленный — через 48 часов (с возвратом), полученный — завершается через 14 дней.

## Заглушки (подключаются через готовые интерфейсы)

| Сервис | Сейчас | Где менять |
|---|---|---|
| Платежи | тестовая оплата кнопкой в приложении | `backend/internal/providers` → ЮKassa «Безопасная сделка»; вебхук `/api/v1/webhooks/payments` |
| Доставка | тарифная сетка из бизнес-плана | `backend/internal/domain/money.go` → API СДЭК |
| Push | лог на сервере, токены устройств уже собираются | `providers.Pusher` → Expo Push; в `mobile/app.json` нужен `extra.eas.projectId` |
| Почта (сброс пароля) | код пишется в лог сервера | `providers.Mailer` → SMTP / Unisender |
| Файлы | локальный диск, раздача `/files/` | `providers.Storage` → Yandex Object Storage (S3) |

## Локальный запуск

**API** (нужен Postgres 16):
```bash
cd backend
make run            # DATABASE_URL по умолчанию postgres://artista:artista@localhost:5432/artista
python3 scripts/seed_demo.py   # демо-данные: buyer@demo.artista / demo12345, marina@demo.artista / demo12345
```
Или всё в Docker: `cd infra && cp .env.example .env && docker compose up -d --build`.

**Приложение:**
```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<IP компьютера>:8080 npx expo start
```
Нативные модули (камера, secure store, push) требуют development build — см. ниже. Веб-превью: `npx expo start --web`.

## Проверки

```bash
cd backend && make test        # юнит + интеграционные тесты API на Postgres, -race
cd backend && make cover       # покрытие (сейчас 83%)
cd mobile && npm run typecheck && npm run lint && npm test -- --coverage   # 79 тестов, 93% строк
```

## Сборка и публикация

Используем EAS Build — облачная сборка, Mac для iOS не нужен.

1. `npm i -g eas-cli && eas login` (аккаунт на expo.dev), затем в `mobile/`: `eas init` — пропишет `extra.eas.projectId`.
2. **Android (Google Play, RuStore):** `eas build -p android --profile production` → `.aab`.
   ID пакета оставлен прежним — `com.aleksandr.artista`, поэтому версия выйдет обновлением.
   Для Google Play загрузите AAB в существующее приложение (Play App Signing переподпишет его вашим ключом;
   если ключ загрузки утерян — сбросьте его в консоли). Для RuStore сборка должна быть подписана тем же ключом,
   что и опубликованная версия: загрузите его в `eas credentials`; APK собирается профилем `preview`.
3. **iOS (App Store):** нужен Apple Developer Program ($99/год). `eas build -p ios --profile production`,
   затем `eas submit -p ios`. Bundle ID — `com.aleksandr.artista`.
4. Перед публикацией: укажите боевой `EXPO_PUBLIC_API_URL` в `eas.json`, обновите `version` /
   `android.versionCode` / `ios.buildNumber` в `app.json`.

## Сервер в продакшене

- Российский хостинг (Yandex Cloud, Selectel, Timeweb) — данные пользователей хранятся в РФ (152-ФЗ).
- Тестовые платежи включаются только явно: `ALLOW_STUB_PAYMENTS=true`. В `APP_ENV=prod` они запрещены всегда,
  как и почта-заглушка, — сервер не стартует, пока не подключены настоящие провайдеры.
- TLS — на nginx/балансировщике. `TRUST_PROXY_HEADERS=true` (уже в compose) — API берёт IP клиента из `X-Real-IP`,
  который выставляет только свой nginx; без прокси переменную не включайте.
- Миграции применяются автоматически при старте.

## Ревью и что осталось на следующий этап

Код прошёл ревью агентами ECC (security-reviewer, go-reviewer + database-reviewer, typescript/react-reviewer).
Исправлено всё критичное и важное: блокировки аккаунтов, гонки в сделке и оплате, очередь возвратов,
двойные платежи, лимиты против перебора, утечки в логи, гонка выхода с обновлением токена, push после выхода,
WebSocket после истечения токена, офлайн-старт.

Осознанно отложено (не мешает запуску, понадобится с ростом каталога):
- сортировка «Популярное» и поиск: счётчик избранного колонкой и индексы `pg_trgm` вместо подзапросов и `ILIKE`;
- курсорная пагинация вместо смещения;
- учёт владельца загруженных файлов и удаление «сирот», перенос файлов в S3;
- счётчик просмотров отдельной таблицей;
- журнал запросов `X-Forwarded-For` от балансировщика хостинга (см. комментарий в `infra/nginx.conf`).

## Разработка с everything-claude-code

В `.claude/` лежат агенты (planner, architect, tdd-guide, code-reviewer, security-reviewer, go-reviewer,
typescript-reviewer, react-reviewer, database-reviewer, e2e-runner), правила для Go / TypeScript / React Native
и скиллы (golang-patterns, golang-testing, api-design, postgres-patterns, react-native-patterns, tdd-workflow,
verification-loop и др.). Процесс: план → тесты → код → ревью агентами → коммит.

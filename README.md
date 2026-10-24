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

## Что умеет

| Покупатель | Художник |
|---|---|
| Лента «Новое / Популярное / Для вас / Мастерские», поиск с фильтрами по цвету, интерьеру, размеру и цене | Публикация с камеры или из галереи; палитра определяется по фото автоматически |
| Примерка на стену в настоящем масштабе: три готовых интерьера или фото своей стены с калибровкой | Помощник описания: название, черновик текста и цена по похожим работам |
| Похожие работы, подборки, история просмотров, сохранённые поиски с уведомлениями | Серии, посты о процессе, выставки-премьеры с напоминаниями подписчикам |
| Предложение своей цены (от 50%), встречная цена, бронь согласованной цены на 24 часа | Аукционы: шаг 5%, продление при ставке в последние 5 минут, 48 часов на оформление |
| Работа на заказ: описание, референсы, бюджет → цена и срок от художника → заказ с доставкой | Пауза магазина (отпуск, пленэр), приём заказов на создание работ |
| Безопасная сделка: адрес, расчёт доставки, оплата, статусы, подтверждение получения | Расширенная статистика (премиум): просмотры по дням, источники, воронка |
| Сертификат подлинности с QR, PDF и передачей новому владельцу | Продвижение работы на 3 / 7 / 14 дней, премиум с 0% комиссии |
| Чат с фото, уведомления (по-русски или по-английски), отзывы, вопросы о работе | Подтверждение и отправка заказа с фото упаковки |

Оформление — светлая и тёмная тема (или как в системе), язык — русский или английский; настраиваются в
«Профиль → Оформление и язык».

Автоматика сделки: неоплаченный заказ отменяется через 30 минут, неподтверждённый — через 24 часа
(с возвратом), неотправленный — через 48 часов (с возвратом), полученный — завершается через 14 дней.
Фоновые задачи также закрывают аукционы, открывают выставки, снимают просроченные предложения и брони.

## Сайт

API отдаёт и публичный сайт (Go `html/template`, без отдельного фронтенда):

- `/` — лендинг: «стена» с работами в настоящем масштабе, кнопки магазинов;
- `/a/<id>`, `/u/<id>`, `/e/<id>`, `/collections/<slug>` — страницы работы, художника, выставки и подборки
  с OG-превью: ссылка из приложения раскрывается в мессенджерах картинкой;
- `/c/<код>` — проверка сертификата подлинности по QR;
- `/legal/terms`, `/legal/privacy`, `sitemap.xml`, `robots.txt`;
- `/.well-known/assetlinks.json` и `apple-app-site-association` — те же ссылки открываются сразу в приложении,
  если оно установлено (App Links / Universal Links).

## Заглушки (подключаются через готовые интерфейсы)

| Сервис | Сейчас | Где менять |
|---|---|---|
| Платежи | тестовая оплата кнопкой в приложении | `backend/internal/providers` → ЮKassa «Безопасная сделка»; вебхук `/api/v1/webhooks/payments` |
| Доставка | тарифная сетка из бизнес-плана | `backend/internal/domain/money.go` → API СДЭК |
| Push | лог на сервере, токены устройств уже собираются | `providers.Pusher` → Expo Push; в `mobile/app.json` нужен `extra.eas.projectId` |
| Почта (сброс пароля) | код пишется в лог сервера | `providers.Mailer` → SMTP / Unisender |
| Файлы | локальный диск, раздача `/files/` | `providers.Storage` → Yandex Object Storage (S3) |
| Помощник описания | шаблоны + перцентили цен похожих работ | `providers.Assistant` → YandexGPT / GigaChat |

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
Нативные модули (камера, secure store, push, PDF, снимок примерки) требуют development build — см. ниже.
Веб-превью: `npx expo start --web`. Сайт открывается на том же адресе, что и API: `http://localhost:8080/`.

## Проверки

```bash
cd backend && make test        # юнит + интеграционные тесты API на Postgres, -race
cd backend && make cover       # покрытие (сейчас 82%)
cd mobile && npm run typecheck && npm run lint && npm test -- --coverage   # 137 тестов, 91% строк
cd mobile && npm run i18n:check   # все русские строки интерфейса и ошибок сервера есть в словаре en.ts
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
5. Ссылки сайта в приложение: задайте в `eas.json` `EXPO_PUBLIC_SITE_HOST` (например, `proartista.ru`) и
   `EXPO_PUBLIC_SITE_URL` (`https://proartista.ru`) — `app.config.ts` добавит associated domains для iOS и
   intent filters для Android. На сервере укажите `SITE_URL`, `ANDROID_CERT_FINGERPRINTS` (SHA-256 ключа подписи
   из Play Console) и `APPLE_TEAM_ID`.

## Сервер в продакшене

- Российский хостинг (Yandex Cloud, Selectel, Timeweb) — данные пользователей хранятся в РФ (152-ФЗ).
- Тестовые платежи включаются только явно: `ALLOW_STUB_PAYMENTS=true`. В `APP_ENV=prod` они запрещены всегда,
  как и почта-заглушка, — сервер не стартует, пока не подключены настоящие провайдеры.
- TLS — на nginx/балансировщике. `TRUST_PROXY_HEADERS=true` (уже в compose) — API берёт IP клиента из `X-Real-IP`,
  который выставляет только свой nginx; без прокси переменную не включайте.
- Миграции применяются автоматически при старте.
- Переменные сайта: `SITE_URL`, `SUPPORT_EMAIL`, `STORE_GOOGLE_PLAY`, `STORE_RUSTORE`, `STORE_APP_STORE`,
  `ANDROID_CERT_FINGERPRINTS`, `APPLE_TEAM_ID` — все описаны в `infra/.env.example`.

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

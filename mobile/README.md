# Artista — мобильное приложение

Expo SDK 58, React Native 0.88, expo-router (нативные вкладки), TanStack Query, FlashList.
Общая инструкция — в корневом README.

```bash
npm install
EXPO_PUBLIC_API_URL=http://<IP>:8080 npx expo start
npm run typecheck && npm run lint && npm test
```

Структура: `src/app` — экраны (маршруты), `src/api` — клиент API и хуки данных,
`src/auth` — сессия, `src/ui` — тема и компоненты, `src/features` — сценарии (заказ, оплата, чат, push),
`src/lib` — форматирование и валидация.

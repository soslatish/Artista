# Artista — агрегатор для творческих людей

## Стек
- **Backend:** FastAPI (Python) + SQLite + Cloudinary
- **Mobile:** Expo + React Native (TypeScript)
- **Auth:** JWT (email/password)

---

## Быстрый старт

### 1. Бэкенд

```bash
cd backend

# Создать .env из примера
copy .env.example .env
# Заполнить CLOUDINARY_* и SECRET_KEY в .env

# Установить зависимости
pip install -r requirements.txt

# Запустить (SQLite создастся автоматически)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Swagger UI: http://localhost:8000/docs

---

### 2. Мобильное приложение

```bash
cd mobile

# Установить зависимости
npm install

# Узнать свой IP-адрес (Windows)
ipconfig
# Найти строку "IPv4" — например 192.168.1.100

# Прописать IP в services/api.ts:
# export const API_BASE_URL = 'http://192.168.1.100:8000';

# Запустить
npx expo start
```

Сканировать QR в приложении **Expo Go** (Android/iOS).

---

## Структура

```
Artista/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app
│   │   ├── models.py        # SQLAlchemy модели
│   │   ├── schemas.py       # Pydantic схемы
│   │   ├── routers/         # auth, users, services, events, messages, reviews
│   │   └── utils/           # JWT, Cloudinary
│   └── requirements.txt
└── mobile/
    ├── app/
    │   ├── (auth)/          # login, register
    │   ├── (tabs)/          # index (услуги), events, messages, profile
    │   ├── service/[id]     # страница услуги
    │   ├── event/[id]       # страница заказа
    │   ├── chat/[id]        # чат
    │   ├── user/[id]        # публичный профиль
    │   ├── create-service   # создать услугу
    │   ├── create-event     # создать заказ
    │   └── edit-profile     # редактировать профиль
    ├── components/          # UI-компоненты
    ├── store/auth.ts        # Zustand store
    ├── services/api.ts      # Axios клиент
    └── constants/theme.ts   # Цвета, категории

```

## Роли
- **Исполнитель (artist):** создаёт услуги, откликается на заказы, получает отзывы
- **Заказчик (customer):** создаёт заказы, оставляет заявки на услуги

## API эндпоинты
- `POST /auth/register` — регистрация
- `POST /auth/login` — вход
- `GET/POST /services/` — каталог / создать услугу
- `POST /services/{id}/apply` — заявка на услугу
- `GET/POST /events/` — каталог заказов / создать заказ
- `POST /events/{id}/apply` — отклик на заказ
- `GET /messages/chats` — список чатов
- `GET/POST /messages/{user_id}` — переписка
- `POST /reviews/` — оставить отзыв

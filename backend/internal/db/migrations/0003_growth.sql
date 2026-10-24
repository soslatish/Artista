-- Функции роста: цвет и интерьер, история, подборки, сохранённые поиски, серии, торг,
-- заказы на заказ, вопросы, посты, сертификаты, выставки, аукционы, продвижение, отпуск, локаль.

-- ---------- работы ----------

-- scheduled — ждёт открытия выставки; auction — на аукционе; commission — сделана на заказ (вне каталога)
ALTER TABLE artworks DROP CONSTRAINT artworks_status_check;
ALTER TABLE artworks ADD CONSTRAINT artworks_status_check
    CHECK (status IN ('draft', 'published', 'reserved', 'sold', 'archived', 'hidden', 'scheduled', 'auction', 'commission'));

ALTER TABLE artworks
    ADD COLUMN palette       text[]  NOT NULL DEFAULT '{}', -- основные цвета обложки (коды из domain.Colors)
    ADD COLUMN rooms         text[]  NOT NULL DEFAULT '{}', -- для каких интерьеров (коды из domain.Rooms)
    ADD COLUMN allow_offers  boolean NOT NULL DEFAULT false,
    ADD COLUMN series_id     uuid,
    ADD COLUMN exhibition_id uuid;
CREATE INDEX artworks_palette_idx ON artworks USING gin (palette);
CREATE INDEX artworks_rooms_idx ON artworks USING gin (rooms);

-- ---------- пользователи ----------

ALTER TABLE users
    ADD COLUMN vacation_until      timestamptz,
    ADD COLUMN vacation_note       text    NOT NULL DEFAULT '',
    ADD COLUMN accepts_commissions boolean NOT NULL DEFAULT false,
    ADD COLUMN commission_note     text    NOT NULL DEFAULT '',
    ADD COLUMN locale              text    NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en'));

-- ---------- загрузки: владелец и палитра ----------

CREATE TABLE uploads (
    url        text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    palette    text[] NOT NULL DEFAULT '{}',
    width      int NOT NULL DEFAULT 0,
    height     int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uploads_user_idx ON uploads (user_id, created_at DESC);

-- ---------- просмотры: история и источники для статистики ----------

CREATE TABLE artwork_views (
    id         bigserial PRIMARY KEY,
    artwork_id uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    user_id    uuid REFERENCES users (id) ON DELETE CASCADE,
    source     text NOT NULL DEFAULT 'other',
    viewed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artwork_views_artwork_idx ON artwork_views (artwork_id, viewed_at);
CREATE INDEX artwork_views_user_idx ON artwork_views (user_id, viewed_at DESC) WHERE user_id IS NOT NULL;

-- ---------- сохранённые поиски («сообщить о похожих») ----------

CREATE TABLE saved_searches (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title            text NOT NULL,
    filters          jsonb NOT NULL,
    last_notified_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_user_idx ON saved_searches (user_id, created_at DESC);

-- ---------- подборки ----------

CREATE TABLE collections (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         text NOT NULL UNIQUE,
    title        text NOT NULL,
    subtitle     text NOT NULL DEFAULT '',
    kind         text NOT NULL CHECK (kind IN ('manual', 'filter')),
    filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
    position     int NOT NULL DEFAULT 0,
    is_published boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_items (
    collection_id uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
    artwork_id    uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    position      int NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, artwork_id)
);
CREATE INDEX collection_items_artwork_idx ON collection_items (artwork_id);

INSERT INTO collections (slug, title, subtitle, kind, filters, position) VALUES
    ('under-10000', 'Работы до 10 000 ₽', 'Оригиналы для первой коллекции', 'filter', '{"price_max": 1000000}', 1),
    ('new-names', 'Новые имена', 'Художники, которые недавно с нами', 'filter', '{"new_artists": true}', 2),
    ('saint-petersburg', 'Петербургские художники', 'Работы авторов из Санкт-Петербурга', 'filter', '{"city": "Санкт-Петербург"}', 3),
    ('for-living-room', 'Для гостиной', 'Крупные и спокойные работы', 'filter', '{"room": "living"}', 4);

-- ---------- серии ----------

CREATE TABLE series (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    position    int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX series_artist_idx ON series (artist_id, position);
ALTER TABLE artworks ADD CONSTRAINT artworks_series_fk FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE SET NULL;
CREATE INDEX artworks_series_idx ON artworks (series_id) WHERE series_id IS NOT NULL;

-- ---------- предложения цены и ценовые брони ----------

CREATE TABLE offers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id  uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    buyer_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artist_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    amount_kop  bigint NOT NULL CHECK (amount_kop > 0),
    counter_kop bigint CHECK (counter_kop > 0),
    message     text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'used')),
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- одно открытое предложение покупателя на работу
CREATE UNIQUE INDEX offers_open_uniq ON offers (artwork_id, buyer_id) WHERE status IN ('pending', 'countered', 'accepted');
CREATE INDEX offers_artist_idx ON offers (artist_id, created_at DESC);
CREATE INDEX offers_buyer_idx ON offers (buyer_id, created_at DESC);
CREATE INDEX offers_expiry_idx ON offers (expires_at) WHERE status IN ('pending', 'countered', 'accepted');

-- бронь цены: покупатель может оформить заказ по согласованной цене (принятое предложение, выигранный аукцион)
CREATE TABLE price_locks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    price_kop  bigint NOT NULL CHECK (price_kop > 0),
    source     text NOT NULL CHECK (source IN ('offer', 'auction')),
    source_id  uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_locks_lookup_idx ON price_locks (artwork_id, user_id) WHERE used_at IS NULL AND released_at IS NULL;
CREATE INDEX price_locks_expiry_idx ON price_locks (expires_at) WHERE used_at IS NULL AND released_at IS NULL;
CREATE INDEX price_locks_user_idx ON price_locks (user_id);

ALTER TABLE orders
    ADD COLUMN kind          text NOT NULL DEFAULT 'artwork' CHECK (kind IN ('artwork', 'offer', 'auction', 'commission')),
    ADD COLUMN price_lock_id uuid REFERENCES price_locks (id),
    ADD COLUMN ship_days     int CHECK (ship_days BETWEEN 1 AND 120);

-- ---------- заказы на заказ ----------

CREATE TABLE commissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artist_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    description     text NOT NULL,
    category        text NOT NULL,
    width_cm        numeric(7, 1),
    height_cm       numeric(7, 1),
    budget_kop      bigint CHECK (budget_kop > 0),
    desired_by      date,
    images          text[] NOT NULL DEFAULT '{}',
    status          text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'quoted', 'accepted', 'declined', 'cancelled', 'expired')),
    quote_kop       bigint CHECK (quote_kop > 0),
    quote_days      int CHECK (quote_days BETWEEN 1 AND 120),
    quote_note      text NOT NULL DEFAULT '',
    decline_reason  text NOT NULL DEFAULT '',
    artwork_id      uuid REFERENCES artworks (id),
    order_id        uuid REFERENCES orders (id),
    conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (buyer_id <> artist_id)
);
CREATE INDEX commissions_buyer_idx ON commissions (buyer_id, created_at DESC);
CREATE INDEX commissions_artist_idx ON commissions (artist_id, created_at DESC);
CREATE INDEX commissions_expiry_idx ON commissions (expires_at) WHERE status IN ('requested', 'quoted');
CREATE INDEX commissions_order_idx ON commissions (order_id) WHERE order_id IS NOT NULL;

-- фото в чате (эскизы, детали работы)
ALTER TABLE messages ADD COLUMN image_url text NOT NULL DEFAULT '';

-- ---------- вопросы под работой ----------

CREATE TABLE artwork_questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id  uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body        text NOT NULL,
    answer      text NOT NULL DEFAULT '',
    answered_at timestamptz,
    hidden_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artwork_questions_artwork_idx ON artwork_questions (artwork_id, created_at DESC);
CREATE INDEX artwork_questions_author_idx ON artwork_questions (author_id, created_at DESC);

-- ---------- посты художников ----------

CREATE TABLE posts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body       text NOT NULL DEFAULT '',
    images     text[] NOT NULL DEFAULT '{}',
    artwork_id uuid REFERENCES artworks (id) ON DELETE SET NULL,
    hidden_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_artist_idx ON posts (artist_id, created_at DESC);
CREATE INDEX posts_recent_idx ON posts (created_at DESC) WHERE hidden_at IS NULL;

CREATE TABLE post_likes (
    post_id    uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_likes_user_idx ON post_likes (user_id);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
    CHECK (target_type IN ('artwork', 'user', 'message', 'question', 'post'));

-- ---------- сертификаты подлинности ----------

CREATE TABLE certificates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    artwork_id  uuid NOT NULL REFERENCES artworks (id),
    order_id    uuid REFERENCES orders (id),
    owner_id    uuid NOT NULL REFERENCES users (id),
    previous_id uuid REFERENCES certificates (id),
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred')),
    issued_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX certificates_owner_idx ON certificates (owner_id, issued_at DESC);
CREATE INDEX certificates_artwork_idx ON certificates (artwork_id, issued_at);
CREATE UNIQUE INDEX certificates_active_artwork_uniq ON certificates (artwork_id) WHERE status = 'active';

-- ---------- выставки и дропы ----------

CREATE TABLE exhibitions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    cover_url    text NOT NULL DEFAULT '',
    starts_at    timestamptz NOT NULL,
    opened_at    timestamptz,
    cancelled_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exhibitions_pending_idx ON exhibitions (starts_at) WHERE opened_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX exhibitions_artist_idx ON exhibitions (artist_id, starts_at DESC);
ALTER TABLE artworks ADD CONSTRAINT artworks_exhibition_fk FOREIGN KEY (exhibition_id) REFERENCES exhibitions (id) ON DELETE SET NULL;
CREATE INDEX artworks_exhibition_idx ON artworks (exhibition_id) WHERE exhibition_id IS NOT NULL;

CREATE TABLE exhibition_reminders (
    exhibition_id uuid NOT NULL REFERENCES exhibitions (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exhibition_id, user_id)
);
CREATE INDEX exhibition_reminders_user_idx ON exhibition_reminders (user_id);

-- ---------- аукционы ----------

CREATE TABLE auctions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id  uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    artist_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    start_kop   bigint NOT NULL CHECK (start_kop > 0),
    step_kop    bigint NOT NULL CHECK (step_kop > 0),
    current_kop bigint,
    leader_id   uuid REFERENCES users (id),
    bids_count  int NOT NULL DEFAULT 0,
    ends_at     timestamptz NOT NULL,
    status      text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended', 'cancelled')),
    winner_id   uuid REFERENCES users (id),
    ended_at    timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auctions_live_artwork_uniq ON auctions (artwork_id) WHERE status = 'live';
CREATE INDEX auctions_live_end_idx ON auctions (ends_at) WHERE status = 'live';
CREATE INDEX auctions_artwork_idx ON auctions (artwork_id, created_at DESC);

CREATE TABLE bids (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL REFERENCES auctions (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    amount_kop bigint NOT NULL CHECK (amount_kop > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bids_auction_idx ON bids (auction_id, amount_kop DESC);
CREATE INDEX bids_user_idx ON bids (user_id, created_at DESC);

-- ---------- продвижение ----------

CREATE TABLE promotions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    artist_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    days       int NOT NULL CHECK (days > 0),
    price_kop  bigint NOT NULL CHECK (price_kop > 0),
    status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled')),
    starts_at  timestamptz,
    ends_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotions_active_idx ON promotions (artwork_id, ends_at) WHERE status = 'active';
CREATE INDEX promotions_artist_idx ON promotions (artist_id, created_at DESC);

ALTER TABLE payments DROP CONSTRAINT payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('order', 'subscription', 'promotion'));
ALTER TABLE payments ADD COLUMN promotion_id uuid REFERENCES promotions (id);
CREATE INDEX payments_promotion_idx ON payments (promotion_id) WHERE promotion_id IS NOT NULL;

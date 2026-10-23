-- Artista: начальная схема

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    password_hash text NOT NULL,
    name          text NOT NULL,
    role          text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'artist', 'admin')),
    city          text NOT NULL DEFAULT '',
    bio           text NOT NULL DEFAULT '',
    avatar_url    text NOT NULL DEFAULT '',
    social        jsonb NOT NULL DEFAULT '{}'::jsonb,
    premium_until timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_email_uniq ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE refresh_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE password_resets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash  text NOT NULL,
    attempts   int NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

CREATE TABLE artworks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    category    text NOT NULL,
    style       text NOT NULL DEFAULT '',
    technique   text NOT NULL DEFAULT '',
    materials   text NOT NULL DEFAULT '',
    width_cm    numeric(7, 1) NOT NULL,
    height_cm   numeric(7, 1) NOT NULL,
    depth_cm    numeric(7, 1) NOT NULL DEFAULT 0,
    year        int,
    price_kop   bigint NOT NULL CHECK (price_kop > 0),
    status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'reserved', 'sold', 'archived', 'hidden')),
    views       bigint NOT NULL DEFAULT 0,
    search      tsvector GENERATED ALWAYS AS (
                    to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
                                           coalesce(style, '') || ' ' || coalesce(technique, ''))
                ) STORED,
    published_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artworks_artist_idx ON artworks (artist_id, created_at DESC);
CREATE INDEX artworks_status_pub_idx ON artworks (status, published_at DESC, id DESC);
CREATE INDEX artworks_search_idx ON artworks USING gin (search);

CREATE TABLE artwork_images (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    url        text NOT NULL,
    position   int NOT NULL DEFAULT 0
);
CREATE INDEX artwork_images_artwork_idx ON artwork_images (artwork_id, position);

CREATE TABLE favorites (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artwork_id uuid NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, artwork_id)
);
CREATE INDEX favorites_artwork_idx ON favorites (artwork_id);

CREATE TABLE follows (
    follower_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artist_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, artist_id),
    CHECK (follower_id <> artist_id)
);
CREATE INDEX follows_artist_idx ON follows (artist_id);

CREATE TABLE orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        uuid NOT NULL REFERENCES users (id),
    artist_id       uuid NOT NULL REFERENCES users (id),
    artwork_id      uuid NOT NULL REFERENCES artworks (id),
    price_kop       bigint NOT NULL,
    delivery_kop    bigint NOT NULL,
    commission_kop  bigint NOT NULL,
    total_kop       bigint NOT NULL,
    status          text NOT NULL DEFAULT 'awaiting_payment'
                    CHECK (status IN ('awaiting_payment', 'paid', 'confirmed', 'shipped', 'completed', 'cancelled')),
    delivery_method text NOT NULL,
    address         jsonb NOT NULL,
    tracking_number text NOT NULL DEFAULT '',
    payout_status   text NOT NULL DEFAULT 'none' CHECK (payout_status IN ('none', 'held', 'released', 'refunded')),
    cancel_reason   text NOT NULL DEFAULT '',
    deadline_at     timestamptz,
    paid_at         timestamptz,
    confirmed_at    timestamptz,
    shipped_at      timestamptz,
    completed_at    timestamptz,
    cancelled_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_buyer_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_artist_idx ON orders (artist_id, created_at DESC);
CREATE INDEX orders_deadline_idx ON orders (status, deadline_at) WHERE status IN ('awaiting_payment', 'paid', 'confirmed', 'shipped');
-- не более одного активного заказа на работу
CREATE UNIQUE INDEX orders_active_artwork_uniq ON orders (artwork_id)
    WHERE status IN ('awaiting_payment', 'paid', 'confirmed', 'shipped');

CREATE TABLE payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id),
    purpose     text NOT NULL CHECK (purpose IN ('order', 'subscription')),
    order_id    uuid REFERENCES orders (id),
    provider    text NOT NULL,
    external_id text NOT NULL DEFAULT '',
    amount_kop  bigint NOT NULL,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'cancelled', 'refunded')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artist_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artwork_id      uuid REFERENCES artworks (id) ON DELETE SET NULL,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (buyer_id <> artist_id)
);
CREATE UNIQUE INDEX conversations_pair_uniq ON conversations (buyer_id, artist_id, coalesce(artwork_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX conversations_artist_idx ON conversations (artist_id, last_message_at DESC);
CREATE INDEX conversations_buyer_idx ON conversations (buyer_id, last_message_at DESC);

CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body            text NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE reviews (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   uuid NOT NULL UNIQUE REFERENCES orders (id),
    author_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artist_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rating     int NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_artist_idx ON reviews (artist_id, created_at DESC);

CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       text NOT NULL,
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE device_tokens (
    token      text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform   text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

CREATE TABLE reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('artwork', 'user', 'message')),
    target_id   uuid NOT NULL,
    reason      text NOT NULL,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
    resolution  text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE INDEX reports_status_idx ON reports (status, created_at);

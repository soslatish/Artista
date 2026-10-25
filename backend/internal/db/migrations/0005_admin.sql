-- Админка: параметры платформы и журнал действий администраторов.

CREATE TABLE platform_settings (
    id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data       jsonb NOT NULL,
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_actions (
    id          bigserial PRIMARY KEY,
    admin_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    action      text NOT NULL,
    target_type text NOT NULL DEFAULT '',
    target_id   text NOT NULL DEFAULT '',
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_created_idx ON admin_actions (created_at DESC);
CREATE INDEX admin_actions_target_idx ON admin_actions (target_type, target_id);

-- списки админки по дате
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at DESC);

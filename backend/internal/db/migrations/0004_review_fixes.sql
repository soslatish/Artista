-- Владельцы файлов, загруженных до 0003: без записи в uploads чужой URL можно было вставить в свою работу.
INSERT INTO uploads (url, user_id)
SELECT DISTINCT ON (i.url) i.url, a.artist_id
FROM artwork_images i JOIN artworks a ON a.id = i.artwork_id
ORDER BY i.url, a.created_at
ON CONFLICT (url) DO NOTHING;

INSERT INTO uploads (url, user_id)
SELECT DISTINCT ON (avatar_url) avatar_url, id FROM users WHERE avatar_url <> '' ORDER BY avatar_url, created_at
ON CONFLICT (url) DO NOTHING;

INSERT INTO uploads (url, user_id)
SELECT DISTINCT ON (image_url) image_url, sender_id FROM messages WHERE image_url <> '' ORDER BY image_url, created_at
ON CONFLICT (url) DO NOTHING;

-- Повторный просмотр той же работы тем же пользователем ищется по этому индексу.
CREATE INDEX IF NOT EXISTS artwork_views_dedup_idx ON artwork_views (artwork_id, user_id, viewed_at DESC) WHERE user_id IS NOT NULL;

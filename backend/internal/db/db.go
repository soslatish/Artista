// Package db открывает пул соединений с Postgres и применяет встроенные миграции.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open создаёт пул и проверяет соединение.
func Open(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

// Migrate применяет ещё не применённые миграции по порядку имён файлов.
// Каждая миграция выполняется в отдельной транзакции; параллельный запуск
// защищён advisory-блокировкой.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire: %w", err)
	}
	defer conn.Release()

	const lockID = 7_311_204_559
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID) //nolint:errcheck

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	names, err := migrationNames()
	if err != nil {
		return err
	}
	for _, name := range names {
		var exists bool
		if err := conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, name).Scan(&exists); err != nil {
			return fmt.Errorf("check %s: %w", name, err)
		}
		if exists {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
	}
	return nil
}

func migrationNames() ([]string, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("list migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// filePattern — ссылки на файлы, которые раздаёт сам API (/files/<имя>), с любым хостом.
const filePattern = `^https?://[^/]+/files/([^/]+)$`

// RebaseFileURLs переписывает ссылки на загруженные файлы под текущий PUBLIC_BASE_URL.
// Адрес сервера может смениться (другой IP в локальной сети, новый домен) — без этого старые фото
// перестают открываться и не проходят проверку «фото загружено через приложение». Если всё совпадает — ничего не делает.
func RebaseFileURLs(ctx context.Context, pool *pgxpool.Pool, base string) (int64, error) {
	prefix := strings.TrimRight(base, "/") + "/files/"
	repl := prefix + `\1`
	var total int64
	scalar := []string{
		`UPDATE uploads u SET url = regexp_replace(u.url, $1, $2) WHERE u.url ~ $1 AND left(u.url, length($3)) <> $3
			AND NOT EXISTS (SELECT 1 FROM uploads x WHERE x.url = regexp_replace(u.url, $1, $2))`,
		`UPDATE artwork_images SET url = regexp_replace(url, $1, $2) WHERE url ~ $1 AND left(url, length($3)) <> $3`,
		`UPDATE users SET avatar_url = regexp_replace(avatar_url, $1, $2) WHERE avatar_url ~ $1 AND left(avatar_url, length($3)) <> $3`,
		`UPDATE messages SET image_url = regexp_replace(image_url, $1, $2) WHERE image_url ~ $1 AND left(image_url, length($3)) <> $3`,
		`UPDATE exhibitions SET cover_url = regexp_replace(cover_url, $1, $2) WHERE cover_url ~ $1 AND left(cover_url, length($3)) <> $3`,
	}
	for _, table := range []string{"posts", "commissions"} {
		scalar = append(scalar, `UPDATE `+table+` SET images = ARRAY(SELECT regexp_replace(x, $1, $2) FROM unnest(images) WITH ORDINALITY t(x, o) ORDER BY o)
			WHERE EXISTS (SELECT 1 FROM unnest(images) x WHERE x ~ $1 AND left(x, length($3)) <> $3)`)
	}
	for _, q := range scalar {
		tag, err := pool.Exec(ctx, q, filePattern, repl, prefix)
		if err != nil {
			return total, fmt.Errorf("rebase file urls: %w", err)
		}
		total += tag.RowsAffected()
	}
	return total, nil
}

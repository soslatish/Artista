// Command api запускает HTTP API Artista.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/soslatish/artista/backend/internal/api"
	"github.com/soslatish/artista/backend/internal/auth"
	"github.com/soslatish/artista/backend/internal/config"
	"github.com/soslatish/artista/backend/internal/db"
	"github.com/soslatish/artista/backend/internal/providers"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	srv := api.New(api.Deps{
		Config:   cfg,
		DB:       pool,
		Tokens:   auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTTL),
		Payments: providers.StubPayments{Log: log},
		Pusher:   providers.LogPusher{Log: log},
		Mailer:   providers.LogMailer{Log: log, Verbose: cfg.Env != "prod"},
		Storage:  providers.LocalStorage{Dir: cfg.UploadDir, BaseURL: cfg.PublicBaseURL},
		Log:      log,
	})
	workerCtx, stopWorker := context.WithCancel(context.Background())
	srv.StartWorker(workerCtx)
	// при любом выходе: остановить воркер и дождаться фоновых задач до закрытия пула БД (defer выше)
	defer func() {
		stopWorker()
		srv.Shutdown()
	}()

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	httpSrv.RegisterOnShutdown(srv.CloseRealtime) // WebSocket-подключения Shutdown сам не закрывает
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr, "env", cfg.Env, "payments", cfg.PaymentsProvider)
		errCh <- httpSrv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

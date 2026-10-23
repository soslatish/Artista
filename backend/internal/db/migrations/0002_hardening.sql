-- Итоги ревью безопасности и Go: блокировки, очередь возвратов, один платёж на заказ, индексы.

-- блокировка модератором — отдельным полем, а не порчей password_hash
ALTER TABLE users ADD COLUMN banned_at timestamptz;

-- возврат сначала ставится в очередь в транзакции отмены, затем выполняется воркером с повторами
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'succeeded', 'cancelled', 'refund_pending', 'refunded'));
CREATE INDEX payments_refund_queue_idx ON payments (updated_at) WHERE status = 'refund_pending';

-- не больше одного живого платежа на заказ (защита от двойного списания)
CREATE UNIQUE INDEX payments_order_live_uniq ON payments (order_id)
    WHERE order_id IS NOT NULL AND status IN ('pending', 'succeeded');

-- индексы под внешние ключи с каскадным удалением и частые выборки
CREATE INDEX payments_user_idx ON payments (user_id);
CREATE INDEX messages_sender_idx ON messages (sender_id);
CREATE INDEX reviews_author_idx ON reviews (author_id);
CREATE INDEX orders_buyer_unpaid_idx ON orders (buyer_id) WHERE status = 'awaiting_payment';
CREATE INDEX password_resets_recent_idx ON password_resets (user_id, created_at DESC);

-- FlowBoard schema (Neon Postgres)
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS boards (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lists (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cards (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES cards(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT DEFAULT 'biasa',
  start_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  color TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  reminder_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES cards(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'biasa';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS sync_state TEXT NOT NULL DEFAULT 'clean';

CREATE INDEX IF NOT EXISTS idx_lists_board ON lists(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_list ON cards(list_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_at);
CREATE INDEX IF NOT EXISTS idx_cards_parent ON cards(parent_id);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Feature: Labels (per-board, multi-label per card)
-- ============================================================
CREATE TABLE IF NOT EXISTS labels (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, name)
);

CREATE TABLE IF NOT EXISTS card_labels (
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
CREATE INDEX IF NOT EXISTS idx_card_labels_label ON card_labels(label_id);

-- ============================================================
-- Feature: Activity log / audit trail per card
-- ============================================================
CREATE TABLE IF NOT EXISTS card_history (
  id BIGSERIAL PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_history_card ON card_history(card_id, created_at DESC);

-- ============================================================
-- Feature: Recurring cards (template + schedule)
-- rule_kind: 'none' | 'daily' | 'weekly' | 'monthly'
-- rule_dow: 0-6 array (Sun..Sat) for weekly
-- rule_dom: 1-31 for monthly
-- ============================================================
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rule_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rule_dow INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rule_dom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cards_recurring ON cards(next_run_at) WHERE rule_kind <> 'none';

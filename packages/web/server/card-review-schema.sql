CREATE SCHEMA IF NOT EXISTS card_review;
CREATE TABLE IF NOT EXISTS card_review.responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash text NOT NULL UNIQUE CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  reviewer_name text NOT NULL CHECK (length(reviewer_name) BETWEEN 1 AND 100),
  favourite text CHECK (favourite IN ('38','43','46','35','29','32','33','21','22','15','02','01-v2','05')),
  comments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(comments) = 'object'),
  general_comment text NOT NULL DEFAULT '' CHECK (length(general_comment) <= 2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS card_review.rate_limits (
  key text NOT NULL CHECK (key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS card_review_rate_expiry ON card_review.rate_limits (expires_at);

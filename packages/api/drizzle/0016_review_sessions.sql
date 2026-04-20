-- -----------------------------------------------------------------------------
-- 0016_review_sessions
--
-- Tracks staff members currently viewing a review. Powers the
-- "Catherine is viewing this review" presence indicator in
-- ReviewsView so two staff don't accidentally double-approve.
--
-- Design: polling-based presence over WebSocket. A viewer's client
-- POSTs /review/:configId/viewers/heartbeat every ~10s while the
-- review detail is open; the server upserts `last_seen_at = now()`.
-- GET /review/:configId/viewers returns every row whose last_seen_at
-- is within the 30s window. Rows outside the window are stale;
-- periodic cleanup (`cleanupStaleReviewSessions`) prunes them.
--
-- Why not WS: polling is stateless, survives server restarts without
-- a reconnect dance, and works behind any HTTP proxy. The presence
-- signal only needs "viewing within the last 30s" granularity — WS
-- overhead isn't justified.
--
-- PK is `(configuration_id, user_id)` so a viewer's heartbeat is a
-- single UPSERT rather than an INSERT-then-DELETE-old churn. One row
-- per (config, user) is the invariant.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "review_sessions" (
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("configuration_id", "user_id")
);

-- Hot query: "who is viewing this config right now?" — index on
-- (configuration_id, last_seen_at) for fast time-window filtering.
CREATE INDEX IF NOT EXISTS "review_sessions_config_last_seen_idx"
  ON "review_sessions" ("configuration_id", "last_seen_at" DESC);

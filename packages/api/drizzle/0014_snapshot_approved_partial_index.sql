-- -----------------------------------------------------------------------------
-- 0014_snapshot_approved_partial_index
--
-- Partial index on `configuration_sheet_snapshots` covering ONLY rows
-- with `approved_at IS NOT NULL`. This is the predicate used by every
-- hot-path "latest approved snapshot for this config" lookup from:
--
--   - `resolveApproval` (every hallkeeper sheet request — PDF + tablet)
--   - `loadLatestApprovedSnapshotPayload` (the snapshot-frozen read)
--   - `getLatestApprovedSnapshot` (admin snapshot-browser route)
--
-- Without this index, the planner's re-submit history accumulates
-- unapproved snapshot rows in the same table. A 50-event venue with
-- a handful of revisions per event means each approved lookup
-- traverses O(versions × events) rows. Partial index is O(log
-- events) and roughly 10× smaller than a full index because only
-- the approved subset lives in it.
--
-- Safety: idempotent (IF NOT EXISTS). Adding an index is non-blocking
-- when CREATE INDEX CONCURRENTLY is used. We use the non-concurrent
-- form here because this migration ships alongside 0013 (snapshot
-- table creation) and the table is empty or near-empty at this point.
-- For production rollouts AFTER the table has grown, operators should
-- replace with CONCURRENTLY or run `apply-migration-0014.ts` during a
-- low-traffic window.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_approved_idx"
  ON "configuration_sheet_snapshots" ("configuration_id", "version" DESC)
  WHERE "approved_at" IS NOT NULL;

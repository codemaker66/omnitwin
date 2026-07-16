# Diary production rollout — 0050 + 0051 (owner-run)

**Task:** T-520 · **Written:** 2026-07-16 · **Script:** `packages/api/src/scripts/apply-diary-rollout.ts`
**Scope:** apply exactly two additive migrations — `0050_diary_bookings` (bookings/turnaround/history tables, ink exclusion constraint, additive columns on events/event_phases/spaces) and `0051_diary_enquiry_link` (bookings.enquiry_id) — to the production Neon database, with correct drizzle ledger records.

Everything here was **rehearsed end-to-end on 2026-07-16** against a disposable local database brought to the exact production-like state (ledger at `0048_event_architect_ops_reviews`): dry-run report, refusal path, apply, idempotent re-run, byte-identical ledger rows, and a live `23P01` constraint probe. The outputs shown below are real rehearsal outputs.

**Why this is safe to do before the code ships:** both migrations are purely additive (new tables, new nullable columns, one new unique constraint on `spaces`). The production API code (which predates the Diary) never touches any of it. Order of operations is therefore: **migrations now, Diary code whenever the branch merges.**

---

## 0. Before you start (5 minutes)

- [ ] **Create a Neon backup branch.** Neon console → your project → Branches → *Create branch* from `production`'s head, name it `pre-diary-rollout-2026-07-DD`. This is an instant copy-on-write snapshot — the nuclear rollback is restoring from it.
- [ ] **Confirm the target.** `packages/api/.env`'s `DATABASE_URL` must be the production pooled connection string (it is, today). The script prints the host and database before doing anything — read that line.
- [ ] **Timing.** All statements take only brief locks (the heavy objects are brand-new tables), but run off-peak anyway. Total runtime is seconds.
- [ ] **Know the cursor consequence** (§3) — you will be asked to acknowledge it.

## 1. Dry run (changes nothing)

```
pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts
```

Expected output (from the rehearsal — production should match except the host line):

```
=== Diary rollout (T-520) — 0050 + 0051 ===
target host: <your-neon-host>  database: neondb
mode: DRY RUN (no changes will be made)

ledger newest: 0048_event_architect_ops_reviews
0050_diary_bookings: PENDING
0051_diary_enquiry_link: PENDING
prerequisites: venues, spaces, users, events, event_phases, enquiries — all present

CURSOR WARNING: 0049_reconstruction_foundry unapplied and older than 0050 ...

DRY RUN complete. 2 migration(s) would be applied.
```

**Stop and investigate if:** `ledger newest` is not `0048_event_architect_ops_reviews` (production has drifted from what we believe — tell the Diary session before continuing), any prerequisite is missing, or a migration already shows applied.

## 2. Apply

```
pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts --apply --accept-cursor-jump --host <the-hostname-the-dry-run-printed>
```

Three deliberate hurdles (post-security-review): `--apply` arms it, `--accept-cursor-jump` acknowledges §3, and `--host` must repeat the exact hostname the dry run printed — naming the wrong target aborts with no changes. The script also refuses to run if either migration file's sha256 differs from the pinned, reviewed value (drift = stop), and takes an advisory lock so two invocations can't interleave.

Each migration runs in its own transaction; a failure rolls that migration back and aborts. Expected tail:

```
applied 0050_diary_bookings (ledger row recorded).
applied 0051_diary_enquiry_link (ledger row recorded).

POST-CHECKS PASSED:
  - btree_gist extension installed
  - ink exclusion constraint: EXCLUDE USING gist (space_id WITH =, tstzrange(starts_at, ...
  - bookings.enquiry_id present
```

Re-running afterwards prints `Nothing to do` — the script is idempotent.

## 3. The cursor consequence (why `--accept-cursor-jump` exists)

drizzle's migrator only compares against the **newest** ledger row. Recording 0050/0051 moves that cursor past `0049_reconstruction_foundry` (whose journal timestamp is older), so from now on **plain `drizzle-kit migrate` will silently skip 0049 forever**. Action for you: tell whoever owns the Foundry chain (0049, 0052–0058) that their production application must be by hand — the same technique this script uses (apply the file, insert the ledger row with the file's sha256 and the journal `when`). This is a one-line heads-up, not a blocker.

## 4. Post-apply verification (2 minutes)

The script's own post-checks already confirmed the objects. Belt-and-braces spot checks from any psql:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'bookings_ink_no_overlap';   -- 1 row
SELECT count(*) FROM bookings;                                                  -- 0 (new, empty)
SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2;
-- expected rows (sha256 of the two files — verified in rehearsal):
--   f5811ab63c69131361272536ea668e27c31db7ae43bf556421efc94378837add | 1783900800000  (0051)
--   6620f095a54c233e4a68ad4382bb1f855757f41260b1489a9ea00e743ad209f5 | 1783776800000  (0050)
```

Production app smoke: venviewer.com loads, sign-in works, the planner and enquiries behave as before. (The Diary UI itself is not in production code yet — nothing user-facing changes with this rollout.)

## 5. Rollback

Both migrations are additive, so rollback is exact and safe while the Diary code is not yet deployed (nothing reads these objects).

**Before any rollback, re-assert that precondition** (security review): if this returns anything but `0`, real bookings exist — STOP; the Neon backup-branch restore is then the only safe path.

```sql
SELECT count(*) FROM bookings;  -- must be 0 before running the DROPs below
```

```sql
-- 0051 first
DROP INDEX IF EXISTS bookings_enquiry_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS enquiry_id;

-- then 0050
DROP TABLE IF EXISTS booking_status_history;
DROP TABLE IF EXISTS turnaround_rules;
DROP TABLE IF EXISTS bookings;
DROP INDEX IF EXISTS events_client_account_idx;
DROP INDEX IF EXISTS events_opportunity_idx;
ALTER TABLE events DROP COLUMN IF EXISTS client_account_id;
ALTER TABLE events DROP COLUMN IF EXISTS opportunity_id;
ALTER TABLE events DROP COLUMN IF EXISTS headcount_guaranteed;
ALTER TABLE events DROP COLUMN IF EXISTS headcount_expected;
ALTER TABLE events DROP COLUMN IF EXISTS headcount_set_for;
DROP INDEX IF EXISTS event_phases_space_idx;
ALTER TABLE event_phases DROP COLUMN IF EXISTS space_id;
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_id_venue_unique;
-- btree_gist extension: harmless — leave installed.

-- ledger bookkeeping
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1783776800000, 1783900800000);
```

Nuclear option: restore the Neon backup branch from step 0.

## 6. What this does NOT do

- Does not deploy any Diary code (the feature branch is still local).
- Does not apply 0049 or 0052–0058 (Foundry chain — its owner's action, see §3).
- Does not seed any data — production `bookings` starts empty; the venue's first pencils are real ones.

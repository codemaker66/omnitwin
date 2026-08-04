# Migration tail 0044-0048 readiness — 2026-07-10

Status: **blocked pending explicit production migration authority**. This is a
read-only readiness record; no migration or database write was performed.

## Configured database evidence

Catalog-only queries were run against the database configured in
`packages/api/.env`. Credentials and row data were not printed.

The retained, secret-free machine-readable report
[`migration-tail-readiness-2026-07-10.json`](./migration-tail-readiness-2026-07-10.json)
captures the database catalogue before additive migration 0048 was authored.
The database has not changed; the local journal now has one additional entry.

- Drizzle migrations applied: 42.
- Local journal entries: 47.
- Pending, in order:
  1. `0044_placed_objects_render_to_real`
  2. `0045_event_scenario_phase_scope`
  3. `0046_event_mission_control`
  4. `0047_event_architect_proof`
  5. `0048_event_architect_ops_reviews`
- `event_missions` present: no.
- `event_architect_runs` present: no.
- `placed_objects.coordinate_space` present: no.
- Rows in tables locked by 0044:
  - `placed_objects`: 0
  - `configuration_layout_revisions`: 0
  - `configuration_sheet_snapshots`: 0
  - `proposal_versions`: 1
  - `phase_layout_snapshots`: 0
- Event scenario/phase cross-event mismatches repaired by 0045: 0.

The low row counts reduce the expected data volume; they do not remove the
need for production approval, a maintenance window, or recovery evidence.

## Why 0044 is a release gate

Migration 0044 deliberately takes `ACCESS EXCLUSIVE` locks over five tables,
labels immutable historical artifacts, converts legacy live X/Z placement
coordinates from render space to real metres, backfills write tokens, and
installs a trigger that rejects the old coordinate-write protocol. It is not a
schema-only change and has no automatic down migration.

Migrations 0046 through 0048 are additive, but they cannot be cherry-picked ahead
of 0044/0045 through the journal-driven deploy path. Shipping any commit that
contains this pending journal tail can therefore cause the production deploy
workflow to execute 0044 automatically.

## Required release procedure

Before application:

1. Identify the exact release commit and verify API/web builds and the complete
   test matrix for that commit.
2. Run the read-only migration-tail verifier and retain its secret-free report.
3. Confirm the production environment protection/reviewer path is active.
4. Establish a Neon restore point or branch immediately before migration.
5. Announce a write maintenance window; stop planner/configuration writes and
   snapshot/version creation for the migration interval.
6. Obtain explicit authority for the 0044 coordinate conversion and exclusive
   locks. A generic request to continue implementation is not this authority.

The deployment workflow now runs that verifier before `db:migrate`. While 0044
is pending, the protected production environment must supply
`APPROVED_MIGRATION_0044_SHA256` with this exact canonical SQL digest:

`c1114fa53a21c9f9b30bfc5973d6ab769d4265152eaf3e289597975260537146`

The verifier ignores the approval value after 0044 is recorded as applied. It
also canonicalizes CRLF/LF before comparing historical migration hashes; the
observed 0025 variance was proven to be line-ending-only, with the normalized
local SQL matching the database journal exactly.

Application, only after those gates:

1. Run the canonical journal-driven command from the exact release commit:
   `pnpm --filter @omnitwin/api db:migrate`.
2. Re-run the read-only verifier. Require 47 applied migrations, an exact
   journal prefix match, all target tables/constraints/indexes present, zero
   legacy placement rows, zero missing write tokens, and zero scenario/phase
   mismatches.
3. Verify `/health/live`, `/health/ready`, and `/health/version` on the API
   release carrying the matching coordinate contract.
4. Smoke-test configuration create/save, Event Architect run/select/review,
   expiry and rejection behavior, approved snapshot compilation gates, and
   Mission Control start/read/replay using authorized non-fixture records.
5. End the maintenance window only after catalog checks and smoke tests pass.

If application or smoke verification fails, stop writes and restore or branch
from the pre-migration recovery point. Do not attempt an improvised coordinate
rewrite reversal.

## Boundaries that remain

- This record does not authorize or apply the migrations.
- It does not approve Event Architect guest-flow evidence; current candidate
  evidence remains a blocking Ops gate.
- It does not bind a selected draft configuration to an event or approve that
  configuration.
- It does not promote/sign the staged capture or close T-091.

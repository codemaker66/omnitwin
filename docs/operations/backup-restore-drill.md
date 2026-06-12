# Backup Restore Drill

Date: 2026-06-12
Status: procedure, not a completed restore
Owner: Venviewer engineering / operations

Backups are not verified until a restore has been performed, inspected, and recorded. This document defines the drill. It does not claim that the drill has been completed.

## Scope

Primary data store: Neon Postgres production branch.

Drill target: a disposable Neon branch or local Postgres instance. Do not restore into production.

## Preconditions

- Production `DATABASE_URL` is available to the operator through the secret manager.
- Neon project access is available to Blake or the assigned engineer.
- Current migration files are present under `packages/api/drizzle/`.
- No customer-facing system depends on the restore target.

## Drill Steps

1. Record the production branch, timestamp, and migration journal state.
2. Create a restore target from the latest backup or point-in-time recovery.
3. Run schema checks against restored tables and critical columns.
4. Compare row counts for core tables: venues, spaces, configurations, placed objects, enquiries, proposals, events, evidence packs, handoff packs, and integration metadata.
5. Run read-only smoke queries for latest configuration, latest event, latest proposal, and latest handoff pack.
6. Apply any pending migrations to the restore target only.
7. Run the API schema smoke tests against the restore target if credentials are available.
8. Destroy the restore target after evidence is captured.

## Evidence Template

Fill this section only after a real drill.

| Field | Value |
|---|---|
| Drill date | Not performed |
| Operator | Not performed |
| Source branch | Not performed |
| Restore target | Not performed |
| Backup/PITR timestamp | Not performed |
| Schema check result | Not performed |
| Row-count check result | Not performed |
| Migration replay result | Not performed |
| API smoke result | Not performed |
| Restore target destroyed | Not performed |
| Follow-up issues | Not performed |

## Failure Handling

- If restore creation fails, open an incident and capture provider error output.
- If schema or row counts drift unexpectedly, stop and inspect before deleting the target.
- If migration replay fails, preserve the target until the failed SQL and journal state are recorded.
- Do not mark backup verification complete while any required evidence row remains `Not performed`.

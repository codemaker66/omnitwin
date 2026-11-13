# Backup Restore Drill

Date: 2026-06-12; first drill performed 2026-10-25
Status: procedure, with one completed drill (evidence below)
Owner: Venviewer engineering / operations

Backups are not verified until a restore has been performed, inspected, and recorded. This document defines the drill and records each one performed. The first was on 25 October 2026 (T-062).

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

Fill a column only after a real drill.

| Field | 25 October 2026 |
|---|---|
| Drill date | Sunday 25 October 2026, 10:13–10:16 UTC |
| Operator | The L1 pilot-gates session, with Blake's approval on 24 October ("Yes, reads and drill") |
| Source branch | The production branch of the Neon project (aws-eu-west-2), the branch Railway's API connects to (host compared, credentials never read) |
| Restore target | A throwaway Neon branch with its own compute, restored from a snapshot of production taken at the restore point. The restore was not finalized, so production kept its own branch and compute throughout. |
| Backup/PITR timestamp | Restore point 2026-10-25T09:53:00Z, 20 minutes before the drill. Production's last write before it was 09:37:07Z. |
| Schema check result | 227 public base tables on both. |
| Row-count check result | 753 rows on both. The md5 of every `table:count` matched. The md5 of the full row text of ten key tables (venues, users, bookings, events, enquiries, configurations, placed_objects, spaces, user_invitations, workspaces) matched, and so did each table's own hash. |
| Migration replay result | Not needed: 99 applied migrations on both, the journal current. |
| API smoke result | Production `/health/ready` answered 200 before and after; the restored branch answered its first query 6 s after its compute started. |
| Time to verified data | About 64 s from the snapshot request to the matching readback (10:13:48 → 10:14:52). |
| Restore target destroyed | Yes, the branch and the snapshot, 10:15:20–10:15:43. Neither remained, and production read ready 99/99. |
| Follow-up issues | Three, all closed on 25 October with Blake's approval: history retention raised from 6 hours to 7 days; a daily snapshot at 04:00 UTC, kept 14 days; the production branch protected (it cannot be deleted or reset). |

### Provider trap

The Neon `restore_snapshot` operation **finalizes by default** when it restores
as a new branch: it moves the computes and swaps the names, so the restored
branch replaces the original. A drill always passes `finalize: false` and never
calls `finalize_branch_restore`. Its result can name production as
`restored_as` even when nothing was finalized, so check afterwards that
production's endpoint is still on its own branch.

## Failure Handling

- If restore creation fails, open an incident and capture provider error output.
- If schema or row counts drift unexpectedly, stop and inspect before deleting the target.
- If migration replay fails, preserve the target until the failed SQL and journal state are recorded.
- Do not mark backup verification complete while any required evidence row remains `Not performed`.

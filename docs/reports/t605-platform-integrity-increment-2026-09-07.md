# T-605: event integrity prerequisites — 7 September 2026

This is the first application increment of [Goal 12](../../goals/12-intelligent-venue-platform.md),
prepared in `codex/intelligent-venue-platform-20260907` from `04ca4563`.
It repairs demonstrated correctness problems before composing the full intelligent
event journey. It is locally qualified; integration, CI and live verification are
recorded separately as they occur. The full goal remains active.

## Behavior repaired

- Event updates lock current state before merging partial edits. The event, change
  feed and staff notifications commit together; no-op edits preserve the update
  marker and produce no false change. Booking updates similarly preserve concurrent
  edits, reject stale state and recover cleanly from constraint denials inside an
  owning transaction. Hold transitions retain their ordered ladder locking.
- Server-side event and booking digests allow the future decision executor to reject
  changed input. They bind individual rows, not a complete event or release.
- Snapshot cleanup retains sources referenced by handoffs, evidence packs and stored
  comparisons, protecting their dependent operational history. Future comparison
  writers still need to pin hash-linked previous sources within their transaction.
- Venue admins can author and discover their own venue's quotes and proposals;
  other-venue denials and platform overrides remain covered. Legacy lifecycle
  overrides do not make these operating records immutable release evidence.
- Local database connections honor the explicit TCP port, without changing Neon's
  global configuration. The API owns and drains its pool. The required CI database
  runner validates its disposable target, all migration hashes/timestamps and replay,
  then rejects any failed, missing or skipped required test.

## Verification

Evidence root: `D:/claude/venviewer-platform-evidence-20260907/`. Failed baseline
evidence is retained alongside corrected runs. No production database was used.

| Check | Recorded result |
| --- | --- |
| Frozen pnpm install | Passed with private dependencies |
| PostgreSQL 16.6 migration baseline | All 67 journal migrations applied to a new disposable database; hashes/timestamps match; replay inert |
| Required `test:platform-db` gate | 6 files, 60 tests passed, zero skips; migration and JSON test receipts retained |
| Full API suite | 172 files passed, 5 skipped; 2,902 tests passed, 113 skipped; 424.78 seconds |
| API typecheck | Passed after correcting test-fixture typing; first failure retained |
| Full API lint | Passed after explicit string conversion of the runner's timestamp; first failure retained |
| API production build | Passed |
| Built API HTTP smoke | Actual loopback listener; live, ready and version probes all HTTP 200 against the disposable database; server close completed and process exited 0 |
| Dependency audit | Passed, no known vulnerabilities |
| Workflow/configuration review | CI and dev database YAML parse; required service and gate present; diff whitespace check passes |

The ordinary API command excludes `integration.test.ts` and contains conditionally
disabled infrastructure fixtures. Its skipped tests are not counted as verified.
The new required database gate separately executes every one of its specified cases.
The HTTP smoke uses the deployed runtime's `--conditions=omnitwin-dist` resolver;
the initial invocation without that existing condition failed and is retained.
This local smoke is neither a Linux container test nor real-provider qualification.

The focused red/green cases demonstrate lost-update and notification rollback
failures, booking constraint/concurrency failures, deletion of historical snapshot
dependencies, and own-venue admin denials before their repairs. Cross-venue, role,
stale-input, deletion, nested rollback and no-op cases pass on real PostgreSQL.

## Delivery and remaining scope

There is no schema change in this increment and no migration to apply on release.
Coordinate with the active T-601 owner, integrate current master without replacing
its new CI/browser work, and follow applicable CI, Railway and Vercel outcomes.
Confirm the exact deployed API source; exercise an authenticated empty-object
PATCH on the already-authorized private DEMO ONLY event, then confirm its update
marker/change feed and approved operational evidence remain unchanged. Do not send
messages or alter genuine venue operations as a release smoke.

Rollback uses the prior compatible API deployment with the database preserved.
The shared decision/release, complete sales-to-operations journey, currencies,
model evaluations, feedback/ranking, GPU work, two-venue portability, recovery and
performance gates remain open. See the [engineering record](../engineering/intelligent-platform.md)
for their concrete integration boundaries; this increment does not claim them.

# T601 — internal demonstration review notifications

The ordinary supported submit/approve routes can now run an explicitly internal
demonstration without team email. Both accept optional `notifyTeam`; omission and
`true` retain the existing notification behavior. The editor submission panel and
dashboard review show a checked-by-default **Notify team** choice only when the
server reports eligibility. Success copy uses the returned notification policy;
it does not claim that requested email was delivered.

Suppression requires existing authenticated staff/admin authority for the venue,
a claimed, nondeleted private configuration, and at least one associated event.
The persisted configuration name and every associated event must start exactly
`DEMO ONLY - ` or `DEMO ONLY — ` followed by nonempty text. Every event must match
the venue. All three association paths are checked: explicit links, layout
variants and phase snapshots. Mutable labels do not grant authorization; arbitrary
metadata and client-supplied scope do not qualify. Public/unlisted plans and real
event associations are rejected. Do not rename real records to force eligibility.

The configuration is locked before rechecking scope; existing association/event
rows are share-locked. Snapshot, review state/history and structured suppression
audit commit in one outer transaction. Audit failure rolls all of them back.
The existing `general_audit_log` records actor, configuration, snapshot,
transition and event IDs under `configuration.review.notifications_suppressed`.
No database migration is added. Current `approval.recorded` subscribers only log;
the explicit suppressed path never invokes email transport. PDF and frozen-sheet
behavior remain intact.

Verified locally in the isolated `codex/internal-demo-review` worktree based on
`577b8f79`: 86 API tests including actual PostgreSQL review/snapshot/rollback and
concurrent scope checks; 20 UI tests including suppression response, preview
guards and same-ID stale-session cleanup; full API/web/E2E TypeScript; changed-file
ESLint; API build; Vite test-mode build; and diff hygiene. Independent source
review found no remaining blocker. PostgreSQL tests use only the explicit
`venviewer_internal_demo_review_test` database on `127.0.0.1:55476`; email/PDF
transports are mocked. No production database or real email was exercised.

Detailed supported preparation bodies, stop cases and preserved failed receipts:
`D:/claude/venviewer-final-demo-20260906/internal-demo-review-handoff.md`.
Root owns actual browser rehearsal on a separate synthetic database/API3011/
Vite5221. Test-mode build success is not a deployable production-auth artifact.
T601 remains the sole production release owner and must qualify the integrated
real-account flow before claiming it live.

## Browser-driven follow-up — 7 September

The actual isolated browser run exposed two UI defects: the transparent fixed
submission row overlapped the room controls, and Start Review changed the badge
without refreshing available actions or history. The review controls now live
in a compact backed disclosure with a viewport-constrained scrolling body.
Closing it preserves the explicit notification choice; Escape returns focus to
the summary and preview locks still disable mutations. After a review status
change, the detail fetches fresh transitions and history; a failed refresh has a
retry path instead of retaining stale actions. Request generations reject older
StrictMode/read responses, and action ownership prevents a late decision from
closing a different review. Withdrawal settlement is bound to its editor session.
Each new submit/withdraw attempt clears the previous confirmation; the existing
withdrawn result and transition policy are unchanged.

The actual submitted → under_review contract was reproduced as a failing
regression before the fix. Six additional stale-response/completion regressions
also failed before their corrections. Final checks: 29 focused UI tests, full web/E2E
TypeScript, changed-file lint, Vite test-mode build and diff hygiene passed.
API behavior is unchanged. Root owns the actual browser recheck; these source
checks do not establish responsive visual acceptance or production readiness.

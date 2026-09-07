# Intelligent venue platform: implementation and evidence

[Goal 12](../../goals/12-intelligent-venue-platform.md) is active as T-605. This
record distinguishes implementation increments from its eventual completion.
The current demo release, Diary, reconstruction and environment owners remain
separate; consult the latest shared GOAL.md before integration or compute work.

## Baseline

The isolated `codex/intelligent-venue-platform-20260907` worktree starts at clean
combined release `04ca45631793ba865127626d3e650ebc7591d24a`. Its private frozen
pnpm install passes. All 67 journal migrations apply to a new disposable
PostgreSQL 16.6 database; SQL hashes and timestamps match and a repeated migrate
is inert. This is a local baseline, not a production or load qualification.

Evidence lives in `D:/claude/venviewer-platform-evidence-20260907/`. The database
ownership receipt under `postgres/ownership.json` records the exact loopback
target, PID, data path and shutdown command. Tests must explicitly name this
disposable target; they do not inherit an ambient production DATABASE_URL.

## First increment: transaction and evidence prerequisites

- [Event mutations](../../packages/api/src/services/event-mutations.ts) expose
  `updateEventCore` to direct editing and subsequent decision execution. It locks
  the current event, checks venue permission, validates merged dates, applies the
  patch and records the change plus staff notifications in one transaction.
  Concurrent partial edits cannot restore an older value. A no-op does not invent
  a notification or change the update marker. An enclosing transaction can roll
  back all these writes through the same connection.
- [Booking mutations](../../packages/api/src/services/booking-mutations.ts) lock
  before merging partial edits. Transitions retain the ordered hold-ladder locks,
  reject changed timing/room/state and preserve ranks advanced by an earlier exit.
  Constraint denials roll back the nested savepoint. The enclosing Diary command
  can still persist its denial receipt.
- Both cores accept optional server-prepared `expectedStateDigest` preconditions.
  Domain-prefixed canonical digests bind relevant content and update markers;
  timestamps alone do not detect every existing writer. They bind their own rows,
  not a whole event release. The executor must also bind and revalidate every
  dependent booking, phase, commercial, layout, stock and policy source.
- [Database connections](../../packages/api/src/db/client.ts) use the URL's own
  TCP port for local PostgreSQL and Neon for remote URLs. `createDbConnection`
  provides an idempotent pool close operation, used by the API's `onClose` hook.
  Driver selection does not mutate Neon's global configuration. Existing scripts
  using database-only `createDb` keep their interface; new long-lived owners
  should own and close their connection.
- [Snapshot retention](../../packages/api/src/services/sheet-snapshot.ts) keeps
  historical sources referenced by handoff or evidence packs and persisted
  comparisons, in addition to recent drafts and the latest approved snapshot.
  Row locks serialize pruning against FK-linked pack insertion. Mission
  baselines retain their handoff dependencies. Future comparison-hash writes
  still need writer-side source pinning; hashes are not foreign keys.
- Commercial authoring admits the venue's admins alongside staff; platform
  overrides and other roles retain their existing scope. This repairs admin
  denial and discovery of colleagues' venue records. Direct issued-record edits
  remain guarded, but legacy admin state transitions can revert terminal records.
  Do not treat those mutable headers as immutable release evidence.

The event core deliberately preserves the legacy guestCount, contractual
guaranteed count, expected count and physical set-for count as distinct fields.
Changing the working count alone proves neither seating nor contractual consent.
Likewise, moving the event timestamps alone does not reschedule its bookings or
phases. These cores are prerequisites for the compound decision executor.

`recordEventPlanChange` now makes a change and its notifications atomic. Its
other callers do not automatically gain source-mutation atomicity; that requires
passing their owning transaction. External delivery and a release outbox are
still to be connected.

The locking approach follows PostgreSQL's [row-lock and savepoint semantics](https://www.postgresql.org/docs/16/explicit-locking.html)
and Drizzle's [nested transactions](https://orm.drizzle.team/docs/transactions).
Reproduce concurrency with held row locks and observed waiting sessions rather
than relying on arbitrary timing sleeps. PostgreSQL statistics cache inside a
transaction; clear its statistics snapshot when polling lock waiters.

## Remaining integration design

Use one immutable decision revision and one immutable event-release manifest.
The decision contains typed guest-count, booking-time or shortage alternatives,
their exact mutations, dependencies, constraints, unknowns and consequences.
Approval binds venue, actor capability, decision revision, option digest, basis,
policy and expiry. Reauthorization and revocation checks occur at execution,
outside any language model. A command id reused with different content conflicts.

The transaction-owning executor calls domain cores, appends the qualified release
and execution receipt, and records durable dependent work. It does not compose
standalone HTTP calls and call them atomic. Follow the existing phase-freeze lock
order: phase advisory key, then event/phase, then configuration/canonical evidence.
Acquire multiple phase keys deterministically before taking later locks.

The release must bind both frozen phase/canonical/proof lineage and approved
configuration-sheet lineage. They are not interchangeable because they refer to
the same configuration. Quote and proposal content must be frozen through verified
same-venue commercial relationships. Retain every historical release dependency.
An inventory assessment with complete evidence can still have a shortage; an
approved internal hire request is not confirmed stock.

## Goal acceptance remains open

| Gate | Current evidence and next requirement |
| --- | --- |
| Complete event and three change classes | Mutation prerequisites under verification; still connect enquiry, options, exact quotes, booking, layouts, stock, release, phone/print, acknowledgement and actuals, with successful and no-fit branches |
| Two venues | A separate benchmark proposal specifies two labelled synthetic configurations and dinner/theatre arithmetic; materialized full journeys, room flip, GBP/USD and DST checks remain |
| Integrity and recovery | Disposable migration baseline and initial concurrency/rollback tests; approval/revocation, durable execution, worker restart, tenant isolation across retrieval/artifacts/exports and backup/restore remain |
| Intelligence | No model tuning or model-quality claim. Materialize and independently review the proposed evaluation manifest before freezing thresholds; real models, ranking, feedback and useful GPU integration remain |
| Performance | CPU-only layout probes are descriptive. Freeze workload-specific budgets and measure API/jobs/UI, multi-tenant load and noisy neighbours before optimization claims |
| Reviewable release | Qualify each integrated increment and record exact commits/checks. Final rendered desktop/mobile journey, full dependent checks, rollout/rollback and goal completion remain |

The independent preregistration proposal is
`D:/claude/venviewer-platform-evidence-20260907/benchmark-proposal.md`; it is not yet
an executable held-out dataset. It proposes 24 deterministic integration cases,
120 AI cases with explicit splits, 100% hard-boundary pass, at least 90% task
success and zero material unsupported claims. Proposed model latency/cost and
correction-effort targets need a recorded executable baseline before tuning.
Synthetic success establishes fixture portability, not customer onboarding or
real-world predictive accuracy.

## Commercial integration seams to resolve next

The existing database path is event → opportunity → source enquiry →
configuration. Selected layouts also use event-configuration links. Architect
selection does not create that full link, and the legacy event create/update
schemas omit opportunityId. Quotes and proposals independently validate linked
records' venues, without proving that every link identifies the same event and
opportunity. Explicit source binding must precede release compilation.

Architect's current null pricing catalogue reflects missing asset-complete,
versioned venue prices. Existing pricing_rules are room/venue charges without
asset IDs; do not infer asset prices by display name. The price calculator's
currency selection and source line identity require review before reuse across
currencies. GBP/USD needs forward database constraint migrations plus shared
schemas, validators, canonical evidence and UI formatting. Old migrations and
accepted historical content must remain unchanged.

Proposal-version creation currently accepts a caller-supplied quote snapshot and
loads layout state outside the version transaction. The controlled release path
must instead freeze trusted, mutually bound commercial/layout sources inside its
owning transaction. An admin's lifecycle override is not a substitute for that
historical evidence.

# ARCHITECT — Backend and API reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Design understandable contracts, trustworthy data boundaries and reliable state changes. Inspect the installed stack, current schema and relevant ADRs before recommending a design.

## Questions to work through

- What user outcome does this endpoint or model support? Which invariants are required by the real domain, and which are assumptions?
- Where is authority enforced: authentication, venue-scoped authorization, runtime validation, database constraints and transactions? Check tenant isolation at every accessible boundary, including assets and background jobs.
- Are request and response contracts compatible with callers? Reuse shared domain types where appropriate without forcing every local implementation type into `@omnitwin/types`.
- Can concurrent updates, duplicate requests, retries or partial failures corrupt state? Define atomicity, idempotency, optimistic concurrency and recovery where the operation needs them.
- Are database reads bounded and indexes appropriate to actual query patterns? Inspect SQL and query plans rather than banning SQL or prescribing a join for every problem.
- Can a migration coexist with old and new application versions? Identify backfill, rollback and deployment ordering.
- Are errors actionable and logs sufficient for diagnosis without leaking credentials or personal data?

## Evidence and output

Describe the contract, the important invariants, the chosen tradeoffs and the verification performed. Add regression tests for changed behavior; use real database tests when constraints, isolation or races are material. Types improve safety but do not prove runtime behavior or eliminate operational failures.

Use the repository's actual authentication, persistence and job infrastructure. A historical persona is not a mandate to introduce a new auth system, endpoint taxonomy, save interval or service.

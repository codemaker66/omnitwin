# Diary Slice 1 — Report

**Date:** 2026-07-11 · **Branch:** `feature/diary-p0-slice-1` (never pushed; no deploys; production untouched)
**Prompt:** `docs/strategy/diary-slice-1-prompt.md` · **Authority:** Diary Research Canon v1.5 (`docs/strategy/the-diary-research-canon.md`) per `docs/strategy/authority-map.md`

## Status: GREEN

Everything the slice mandated is built, tested, and verified: whole-tree typecheck, lint, and full test suites pass (types 82 files / 1,807 · api 108 files / 2,149 · web 244 files / 2,955), api tsc build and web Vite production build green. Caveats that keep this honest rather than triumphant: migration 0050 is written and journaled but **not applied to any database** (owner-gated, consistent with the July-10 deploy-path posture where 0044+ are pending); the exclusion constraint and transition race have therefore been exercised by contract tests and code review, not against live Postgres; and this session ran **concurrently with the CARD A1 session in one working tree** (see deviations 9–10).

## Files created / changed

**Docs (commits `4e51d585`, `c6da08a8`):** Diary docs install (canon v1.5 edits, `authority-map.md`, `diary-slice-1-prompt.md`, `r3-client-journey.md`, `docs/design/concepts/` ×5, `docs/proposals/constellation-calendar.md`, cards-README build-order note, CLAUDE.md governance pointer) · `docs/strategy/venue-calendar-planner-architecture.md` (new, build-facing distillation) · `docs/state/tasks.md` rows T-487–T-493.

**Code (commits `0fa858a4`, `9a8b4b85`, `aa61d123`, `8af609ea`):**

| File | Action |
|---|---|
| `packages/types/src/booking.ts` (+ index export) | NEW — vocabulary, transition matrix, derive/columns helpers, all booking/calendar/conflict Zod schemas |
| `packages/types/src/__tests__/booking.test.ts` | NEW — 41 tests |
| `packages/api/src/db/schema.ts` | EXTENDED — `bookings`, `bookingStatusHistory`, `turnaroundRules`; `spaces` composite identity; `events` CRM FKs + headcount triple; `eventPhases.spaceId` |
| `packages/api/drizzle/0050_diary_bookings.sql` + `meta/_journal.json` | NEW — btree_gist, partial EXCLUDE `bookings_ink_no_overlap`, 5 CHECKs, composite tenant FKs (incl. PG15 column-targeted `ON DELETE SET NULL ("event_id")`), additive events/phases/spaces ALTERs |
| `packages/api/src/__tests__/diary-schema.test.ts` | NEW — 8 contract tests (migration↔Drizzle column parity, EXCLUDE pin, additive-only) |
| `packages/api/src/__tests__/migration-tail-readiness.test.ts` | EDIT — `EXPECTED_TAIL` + `0050_diary_bookings` (pinned-list maintenance) |
| `packages/api/src/state-machines/booking.ts` | NEW — role-policy layer; tests ×11 (exhaustive 8×8 valid+invalid, bidirectional drift guards) |
| `packages/api/src/services/calendar-conflicts.ts` | NEW — pure conflict engine v0; tests ×20 (DST both directions, midnight-spanning, multi-per-room-per-day, honesty, determinism) |
| `packages/api/src/services/hold-hygiene.ts` | NEW — pure ladder resequence + T-7/3/1 reminder instants; tests ×12 |
| `packages/api/src/routes/bookings.ts` | NEW — create/get/patch/transition; hygiene enforcement; 23P01→409 `INK_SLOT_TAKEN`; transaction = update + history + resequence |
| `packages/api/src/routes/calendar.ts` | NEW — `GET /calendar` shared read model |
| `packages/api/src/index.ts` | EDIT — register `/bookings` + `/calendar` |
| `packages/api/src/__tests__/bookings-routes.test.ts`, `calendar-routes.test.ts` | NEW — 27 tests (auth/validation boundary + source-contract pins) |
| `packages/api/src/db/seed.ts` | EXTENDED — 5 turnaround rules, Mackenzie–Ross wedding event + 3-phase Grand Hall footprint, 22 bookings across six rooms |
| Cross-workstream (T-486 foundry, all behaviour-preserving — see deviation 8) | `reconstruction-foundry/src/glb.ts`, `api/src/routes/reconstruction-foundry.ts`, `api/src/services/reconstruction-foundry-integrations.ts`, `web/.../FoundryReleaseDetail.tsx` |

## Task IDs added

T-487 (schema + exclusion, **done**) · T-488 (state machine, **done**) · T-489 (calendar read model, **done**) · T-490 (conflict engine v0, **done**) · T-491 (hold hygiene, **done**) · T-492 (dev seed, **done**) · T-493 (the Board timeline v1, **not-started** — Slice 2).

## Tests

**121 new Diary tests** (types 41 · diary-schema 8 · state machine 11 · conflict engine 20 · hold hygiene 12 · booking routes 15 · calendar routes 12 · migration-tail extension assertions within the existing suite). Pure cores were built red→green (TDD); the route layer was verified with the house inject + source-pin pattern written alongside the wiring.

**Full-suite pass counts (this session, this tree):** `@omnitwin/types` 82 files / **1,807** · `@omnitwin/api` 108 files / **2,149** · `@omnitwin/web` 244 files / **2,955**. Typecheck + ESLint green on all three; `api` tsc build green; `web` Vite production build green (16.6s, local validation Clerk key).

## Deviations from the Canon / prompt, with reasons

1. **Survey staleness (Step 0b, mandated check):** `schema.ts` grew 2,351 → 3,109 lines since 2026-07-04 — new families: capture factory (T-480), Mission Control ×7 (T-482), Event Architect ×5 (T-481/485), Reconstruction Foundry ×9 (T-486, uncommitted); `event-mission.ts` joined the state machines; migrations reached 0049; survey §6's proposed T-472–477 were taken (renumbered to T-487+). **No claim this slice depends on was wrong** — `events`/`event_phases` gaps were exactly as surveyed; the new `(id, venue_id)` unique on `events` (0046) *helped* (adopted as the tenant-FK pattern). Full table in architecture doc §0.
2. **`kind`/`status` two-column split with derived state** — Canon §2.1 names `kind`, §1 names `bookings.state`; the split satisfies both while preserving wash-rate provenance (a released hold remains knowably a hold, which §3's forecasting calibration needs) and giving the exclusion constraint an exact predicate. Documented in architecture §1.1.
3. **Creation writes no history row** (architecture doc §5b originally sketched `(created)→state`) — follows the house convention (enquiry/proposal history records transitions only); creation state is recoverable from the row + `createdAt`.
4. **Holds require `nextActionDueAt` too**, not just the action text — strictest honest reading of §17's "a next action, an owner, and a date"; matches the opportunities pairing.
5. **Turnaround gap participants are inks + room-scoped phases (merged per event); holds are excluded from gap checks in v0** — ladder overlap is by-design, so hold-gap noise would bury real warnings. Canon §4 doesn't specify; flagged as a v1 revisit.
6. **Reminder job not built** (prompt allows "may be stubbed") — shipped `computeHoldReminderInstants` as a tested pure core plus an explicit P1 note instead of a pretend scheduler. Nothing claims delivery exists.
7. **`events` CRM FKs + headcount triple are DB/Drizzle-level only** — not yet exposed through `EventSchema`/serializers. Extending the shared schema ripples into web fixtures; deferred as architecture §8 open question 3 rather than done sloppily inside this slice. The columns are live for the Diary (the seed populates them).
8. **Cross-workstream gate unblocks (T-486 foundry, uncommitted in this tree):** whole-tree typecheck/lint — which this slice must leave green — failed on four foundry sites. Fixed minimally and behaviour-preservingly: triple-slash reference making the existing `gltf-validator.d.ts` visible to downstream compilations; byte-identical ETag unescape; removal of a provably-dead disposition guard (type is `"created" | "exists"`; `verifyCandidateObject` remains the real check); `Array<T>` constructor generic replacing an `any[]` assignment. **Flagged for the T-486 owner.** The four touched foundry files are committed in full in `8af609ea` (they were untracked; git cannot commit a hunk of an untracked file).
9. **Step 1 staged the Diary set explicitly rather than literal `git add docs`** — the docs tree also contained reconstruction-foundry docs and unrelated edits from the concurrent workstream; committing them under the Diary message would have falsified history. CLAUDE.md's 2-line Diary governance pointer was included (outside `docs/` but part of the same install). Foundry docs remain with their workstream.
10. **Concurrent-session interleave:** this session ran alongside the CARD A1 session in one working tree and one branch; A1 committed `88861196` (T-494) directly onto `feature/diary-p0-slice-1` between the Diary commits, so this branch now carries both workstreams' history interleaved. Shared files committed by the Diary (schema.ts, `_journal.json`, migration-tail test, tasks.md) necessarily carried the other workstreams' pre-existing uncommitted hunks; each commit message declares its riders. If Blake wants the Diary isolated for review, `git log --grep="diary"` selects its commits cleanly; all Diary commits used explicit pathspecs.

## Open questions (none blocking)

1. `max_hold_rank` per-venue setting (Canon proposes default 3) — lands with the challenge engine (P1); v0 accepts any rank ≥ 1.
2. Availability/blackout **rules that generate** `internal_block` rows — survey says build a rules table; Canon phases it later; this slice ships manual blocks only.
3. How far to surface the events CRM FKs + headcount triple through `EventSchema` (deviation 7).
4. **When to apply migration 0050** — owner-gated `db:migrate` (the production deploy path currently holds 0044–0050 pending behind the fail-closed digest gate from 2026-07-10). Until it runs somewhere, the exclusion constraint is verified by contract tests, not live Postgres.

## Recommendation for Slice 2 (one line)

Build the Board (T-493): the DOM-first multi-room timeline consuming `GET /calendar` against the seeded Trades Hall week — lanes, zoom, now-line, holding tray, keyboard DnD, undo — per Canon §8/§9 and the Ink & Gilt concept A.

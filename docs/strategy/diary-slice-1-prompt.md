# Diary Slice 1 — paste-ready Claude Code prompt (corrected 11 Jul 2026)

Corrections vs the original handoff: the referenced docs are now IN the repo (installed 11 Jul); the repo survey is from a 2026-07-04 snapshot and the repo has moved since (Event Architect, Mission Control, capture factory landed 10 Jul) — a re-verify step is added; proposed task IDs T-472–T-477 may collide with the now-used T-480+ range — renumber from the live table; the constellation proposal already exists at `docs/proposals/constellation-calendar.md` (do not write it again); `docs/strategy/authority-map.md` resolves cross-document authority.

---

PROJECT HANDOFF — Venviewer "Diary" (venue calendar & booking command centre)

STEP 0 — READ FIRST (mandatory, in order):
1. docs/strategy/the-diary-research-canon.md (v1.5 — single source of truth for this domain)
2. docs/strategy/calendar-repo-survey.md (ground truth as of 2026-07-04 — STALE BY DESIGN, see Step 0b)
3. docs/strategy/authority-map.md (which rulebook governs what; translucency ruling; naming)
4. CLAUDE.md at repo root (conventions, handoff protocol, quality bar)
5. Skim docs/research/ (r1–r11 + cross-checks) — cite when relevant.
If any file is missing, STOP and report which — do not improvise.

STEP 0b — RE-VERIFY THE SURVEY: the survey predates 2026-07-10 work (Event Architect T-160/481, Mission Control T-482, capture factory T-480). Before writing any migration, re-check survey §2/§3 claims against the live `packages/api/src/db/schema.ts` — especially `events`, `event_phases`, and anything those July-10 features touched. Report deviations in the slice report.

AUTHORITY RULE: the Canon overrides everything in this domain except claim-safety doctrine and CLAUDE.md gates (see authority-map.md). The constellation calendar remains a parked proposal at docs/proposals/constellation-calendar.md — do NOT build it in this slice.

STEP 1 — COMMIT THE DOCS: `git add docs` → commit
"Add Diary research canon v1.5, repo survey, research library, design concepts, authority map"
Work on branch feature/diary-p0-slice-1. Never push to main. No deploys. (Production is live.)

STEP 2 — ARCHITECTURE DOC: write docs/strategy/venue-calendar-planner-architecture.md — build-facing distillation of Canon §§1–5, §9, §10: concrete Drizzle schema sketches, API surface, booking state machine, conflict engine design, file-level implementation map for this slice. Decision tables over prose. Then add task rows to docs/state/tasks.md per repo convention — take the next free T-numbers from the LIVE table (T-472+ may be taken; renumber; source column cites Canon §s and docs/research files). Keep statuses honest.

STEP 3 — BUILD SLICE 1 (backend only):
a) Schema per Canon §2: one `bookings` table (kind: prospect|hold|ink|internal_block; spaceId; eventId nullable; venueId; startsAt/endsAt timestamptz; rank + joint flag; decisionAt; ownerUserId; nextAction + nextActionDueAt; seriesId nullable; soft delete per house style). Extend event_phases with spaceId. Extend events with clientAccountId, opportunityId, and headcount triple (guaranteed/expected/setFor). booking_status_history per existing convention. Minimal turnaround_rules table (per space + eventType, minutes), shaped like pricing_rules.
b) Raw SQL migration: enable btree_gist; exclusion constraint so two kind='ink' bookings can never overlap in one space (holds/prospects exempt by design). Drizzle can't express EXCLUDE — custom migration.
c) api/src/state-machines/booking.ts per house pattern (prospect → hold → ink; exits released/expired/cancelled/lost; joint-first ink race resolved by the DB constraint) + tests.
d) GET /calendar read model: rooms, entries (bookings + phases), conflicts for ?from&to&spaceIds — one endpoint all views share. Zod schemas, house route/validation/error conventions, tests.
e) Conflict engine v0 as a PURE function over (bookings, phases, turnaround rules) → typed conflicts with severity (blocking|warning|info) and plain-English explanations. Types this slice: ink double-book, hold overlap (advisory), insufficient turnaround gap. Honest defaults — unchecked things report not_checked, never OK. Tests MUST include Europe/London DST boundaries (late March + late October), midnight-spanning events, multiple bookings per room per day.
f) Hold hygiene at the API: creating/editing a hold REQUIRES decisionAt, owner, next action (reject otherwise). Pure auto-resequence function (release/expiry promotes ranks, flags who to notify) + tests. Reminder job (T-7/3/1) may be stubbed.
g) Dev seed: Trades Hall venue + its six rooms + a believable week of mixed bookings, several per room per day.

GUARDRAILS: strict typing, zero `any`; pnpm typecheck + lint + full test suites must pass; never weaken or delete existing tests; reuse existing systems (audit log, status-history pattern, task tables) — no duplicates; claim-safe copy only (planning support / human review; no compliance badges).

STEP 4 — REPORT: write docs/reports/slice-1-report.md AND output the same report in the session:
GREEN / YELLOW / RED · files created/changed · task IDs added · tests added + full-suite pass counts · deviations from the Canon (including survey-staleness findings from Step 0b) with reasons · open questions · one-line recommendation for Slice 2.

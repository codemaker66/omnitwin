# Venue Calendar Planner — Build Architecture (Diary Slice 1)

**Status:** Build-facing distillation of the Diary Research Canon v1.5 (§§1–5, §9, §10) for the P0 backend slice.
**Date:** 2026-07-11 · **Authority:** `docs/strategy/the-diary-research-canon.md` governs this domain (see `docs/strategy/authority-map.md`); this document adds implementation-level decisions only and never overrides the Canon.
**Scope of this slice:** backend only — schema, exclusion constraint, booking state machine, `GET /calendar` read model, conflict engine v0, hold hygiene, dev seed. No timeline UI, no websocket commands, no challenge engine (P1).

---

## 0. Survey re-verification (2026-07-11, mandated by the slice prompt)

`docs/strategy/calendar-repo-survey.md` was surveyed from a 2026-07-04 snapshot. Verified against the live working tree (including uncommitted July-10/11 work):

| Survey claim | Live status 2026-07-11 | Consequence |
|---|---|---|
| `schema.ts` is 2,351 lines | **3,109 lines** | Line refs in survey §2 are drift-approximate; table claims re-verified individually below |
| `events` has no `clientAccountId`/`opportunityId`, `clientName` bare string | **Still true** (schema.ts:1149) | Extensions land in this slice as planned |
| `event_phases` has no `spaceId` | **Still true** (schema.ts:1178) | Keystone migration lands in this slice as planned |
| `spaces` has no capacity/hierarchy/combinability | **Still true** | Unchanged; hierarchy is P1+ |
| State machines: `config-review`, `enquiry`, `proposal` | **Four now** — `event-mission.ts` added (T-482) | `booking.ts` follows the newer two-layer pattern (structural matrix in `@omnitwin/types`, role policy in api) |
| Highest migration 00NN | **0049_reconstruction_foundry** (uncommitted, in tree) | Diary migration is **0050**; journal `when` must be strictly increasing; `migration-tail-readiness.test.ts` `EXPECTED_TAIL` must gain `0050_diary_bookings` |
| Survey §6 proposes T-472–T-477 | **Taken.** Live table tops out at T-486 | Diary rows renumbered **T-487–T-493** |
| No booking/hold table anywhere | **Still true** — verified across all 130 tables incl. July-10 additions | The core of this slice is genuinely greenfield |
| — (not in survey) | `events` gained `events_id_venue_unique (id, venue_id)` (migration 0046) | Bookings reuse the Mission Control composite-FK tenant-integrity pattern |
| — (not in survey) | New table families since survey: capture factory (T-480), Mission Control ×7 (T-482), Event Architect ×5 (T-160/481/485), Reconstruction Foundry ×9 (T-486, uncommitted) | None occupy the space-time booking domain; no collision. Mission Control is the run-the-day axis and consumes phases, not bookings |
| ~92 api test files | 90+ files, plus `migration-tail-readiness` now pins migration↔Drizzle column parity | New migration must match Drizzle column order exactly and use the house `CREATE TABLE IF NOT EXISTS "name" (` … `);` formatting its parser reads |

No survey claim that this slice depends on was found to be wrong; the deltas are additive drift.

---

## 1. Domain model (Canon §1–§2)

### 1.1 The `kind` / `status` split (implementation decision)

Canon §2.1 names `kind: prospect | hold | ink | internal_block`. Canon §1 names `bookings.state` with lifecycle `prospect → hold → ink` and exits `released / expired / cancelled / lost`. Both are satisfied by **two columns**:

| Column | Values | Mutates when |
|---|---|---|
| `kind` | `prospect \| hold \| ink \| internal_block` | Promotion only (prospect→hold, hold→ink, prospect→ink) |
| `status` | `active \| released \| expired \| cancelled \| lost` | Exit only; default `active` |

The Canon's "state" is **derived**: `state = status === 'active' ? kind : status`. Rationale:

1. **Wash-rate provenance (Canon §3):** a released hold must remain knowably a hold (`kind='hold', status='released'`); a single mutating state column destroys the hold/prospect conversion denominators the yield engine needs.
2. **Exclusion-constraint predicate:** `WHERE kind='ink' AND status='active' AND deleted_at IS NULL` is exact and index-friendly.
3. **House pattern fit:** the state machine still exposes one flat state vocabulary (like enquiry/proposal machines) via `deriveBookingState()`.

### 1.2 `bookings` (new)

```ts
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  spaceId: uuid("space_id").notNull().references(() => spaces.id),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 20 }).$type<BookingKind>().notNull(),
  status: varchar("status", { length: 20 }).$type<BookingLiveness>().notNull().default("active"),
  title: varchar("title", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 80 }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  rank: integer("rank"),                       // option ladder position; holds only
  jointFlag: boolean("joint_flag").notNull().default(false),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  nextAction: varchar("next_action", { length: 500 }),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  seriesId: uuid("series_id"),                 // day-one nullable group id (Canon §2.1); no series table yet
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt / updatedAt / deletedAt            // house soft-delete triple
}, (table) => [
  unique("bookings_id_venue_unique").on(table.id, table.venueId),
  foreignKey({ columns: [table.eventId, table.venueId], foreignColumns: [events.id, events.venueId], name: "bookings_event_venue_fk" }),
  foreignKey({ columns: [table.spaceId, table.venueId], foreignColumns: [spaces.id, spaces.venueId], name: "bookings_space_venue_fk" }),
  index("bookings_venue_starts_idx").on(table.venueId, table.startsAt),
  index("bookings_space_starts_idx").on(table.spaceId, table.startsAt),
  index("bookings_event_idx").on(table.eventId),
  index("bookings_venue_kind_status_idx").on(table.venueId, table.kind, table.status),
  index("bookings_venue_decision_idx").on(table.venueId, table.decisionAt),
  index("bookings_venue_next_action_idx").on(table.venueId, table.nextActionDueAt),
]);
```

Notes:
- **Tenant integrity at the DB boundary** mirrors Mission Control: composite FKs pin `event.venueId === booking.venueId` and `space.venueId === booking.venueId`. The latter needs a new `spaces_id_venue_unique (id, venue_id)` unique constraint (additive; same move 0046 made on `events`). `eventId` is nullable — Postgres MATCH SIMPLE skips composite-FK enforcement when it is NULL, which is exactly right.
- **Times are `timestamptz` and NOT NULL** (unlike `events.startsAt`): a booking that does not occupy time is not a booking. UTC in storage; venue-local evaluation per Canon §2.10.
- `rank` is only meaningful for holds — CHECK-guarded (below). It is **cleared on promotion to ink** (the ladder is resolved).
- **Prospects never block and may overlap** (Canon §2.1) — they carry no ladder rank.

DB CHECK constraints (raw migration): `bookings_time_valid CHECK (ends_at > starts_at)` · `bookings_kind_check` · `bookings_status_check` · `bookings_rank_positive CHECK (rank IS NULL OR rank >= 1)` · `bookings_rank_hold_only CHECK (rank IS NULL OR kind = 'hold')`.

### 1.3 The hard floor — exclusion constraint (Canon §2.2)

Drizzle cannot express `EXCLUDE`; raw SQL in `drizzle/0050_diary_bookings.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ink_no_overlap"
  EXCLUDE USING gist (
    "space_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("kind" = 'ink' AND "status" = 'active' AND "deleted_at" IS NULL);
```

- `btree_gist` supplies uuid equality inside a GiST index (Neon supports it).
- **Half-open `[)` ranges:** back-to-back inks (one ends 18:00, next starts 18:00) are legal; the turnaround rule engine — not the constraint — decides whether the gap is operationally sufficient.
- Holds, prospects, blocks are exempt **by design** (holds overlap = the option ladder).
- The constraint is the **final arbiter of the joint-first ink race** (Canon §3): two coordinators converting simultaneously → exactly one COMMIT wins; the loser receives Postgres error `23P01` (exclusion_violation), surfaced as a 409 `INK_SLOT_TAKEN` with maître-d' copy, never a stack trace.

### 1.4 `booking_status_history` (new; house convention)

Mirrors `enquiry_status_history`: `id, bookingId (cascade), fromState, toState, changedBy (set null), note, createdAt`, index on `bookingId`. `fromState`/`toState` store **derived states** (the §1.1 vocabulary), so history reads as the Canon's lifecycle.

### 1.5 `turnaround_rules` (new; shaped like `pricing_rules`)

```
id · venueId (notNull) · spaceId (nullable = venue-wide) · eventType (nullable = all types)
· name (notNull) · minutes (notNull, CHECK >= 0) · isActive (default true)
· deletedAt · createdAt · updatedAt
```

Specificity resolution (conflict engine): `space+eventType > space > venue+eventType > venue-wide`; among equal specificity the **largest minutes** wins (safe direction). No matching active rule ⇒ the pair is reported `not_checked`, never OK (Canon §4 honesty pattern).

### 1.6 `events` extensions (Canon §2.4; survey keystone #3)

Additive columns: `clientAccountId uuid → client_accounts (set null)` · `opportunityId uuid → opportunities (set null)` · headcount triple `headcountGuaranteed / headcountExpected / headcountSetFor integer` (all nullable). Existing `guestCount` stays as the legacy single number; the triple is authoritative where present (R2). Indexes on both FKs.

### 1.7 `event_phases.spaceId` (Canon §2.3; survey keystone #2)

Additive nullable `spaceId uuid → spaces (set null)` + index. Phases become room-scoped (the Occupancy Footprint) as data arrives; existing rows stay venue-global (`NULL`) and are excluded from room lanes until scoped. Buffer/turnaround **templates that generate phases** are P1; this slice only makes the column exist and consumes it in the read model + conflict engine.

---

## 2. Booking state machine (Canon §1, §3)

House two-layer pattern (the `proposal.ts` refinement):

- **Structural matrix** in `@omnitwin/types` `booking.ts`: `VALID_BOOKING_TRANSITIONS`, `isValidBookingTransition`, `deriveBookingState`, `bookingStateToColumns`.
- **Role policy** in `api/src/state-machines/booking.ts`: `canTransitionBooking(current, next, role)`, `getAvailableBookingTransitions`, admin override, drift-guard key export.

| From \ To | hold | ink | released | expired | cancelled | lost |
|---|---|---|---|---|---|---|
| **prospect** | ✓ | ✓ | — | — | — | ✓ |
| **hold** | — | ✓ | ✓ | ✓ | — | ✓ |
| **ink** | — | — | — | — | ✓ | — |
| **internal_block** | — | — | ✓ | — | — | — |
| exits (all four) | terminal — no transitions out | | | | | |

Semantics: `released` = venue-side release (incl. displaced when a challenger inks); `expired` = decision date lapsed (auto-lapse, Canon §3); `lost` = client withdrew/went elsewhere; `cancelled` = post-ink cancellation. Ink never downgrades — cancel and re-book (truthful history).

Role policy: `staff`/`admin` perform all transitions; `hallkeeper` none (ops surface is read-facing here); `client`/`planner` none (clients act through enquiry/proposal/portal, never directly on the diary). Admin override = house rule (any transition).

Transition side-effects (route layer, one transaction):
1. Write `bookings.kind`/`status` per `bookingStateToColumns(toState)` (promotion to ink clears `rank`).
2. Insert `booking_status_history` row.
3. If a **hold** exits (released/expired/lost): run ladder auto-resequence (§4) over surviving overlapping holds in the same space; apply rank changes; return promotions in the response payload (the "human ping" of Canon §3 — notification wiring is P1).
4. `→ ink` relies on the DB constraint: catch `23P01` → 409 `INK_SLOT_TAKEN`, transaction rolls back, nothing half-applied.

---

## 3. Conflict engine v0 (Canon §4)

**A pure, deterministic, side-effect-free function** — no DB, no clock reads; callers pass everything:

```ts
detectCalendarConflicts({ bookings, phases, turnaroundRules, range }): ConflictReport

type ConflictSeverity = "blocking" | "warning" | "info";
type CalendarConflictType = "ink_double_book" | "hold_overlap" | "insufficient_turnaround";

interface CalendarConflict {
  id: string;                    // deterministic: type + sorted participant ids
  type: CalendarConflictType;
  severity: ConflictSeverity;
  spaceId: string;
  entryIds: readonly [string, string];
  explanation: string;           // plain English, names both sides (Canon §4 clash-dialog doctrine)
}

interface ConflictReport {
  conflicts: readonly CalendarConflict[];
  checks: {                      // honesty layer — unchecked ≠ OK
    inkDoubleBook: { status: "checked" };
    holdOverlap:   { status: "checked" };
    turnaround:    { status: "checked" | "partial" | "not_checked"; uncoveredPairCount: number; detail: string };
  };
}
```

| Type | Trigger | Severity | Notes |
|---|---|---|---|
| `ink_double_book` | two active inks overlap in one space | `blocking` | DB-prevented; the engine still reports it if present in data (imports, constraint gaps) — belt and braces |
| `hold_overlap` | active hold overlaps active hold | `info` | The ladder working as designed; explanation states ladder order ("2nd option behind the MacLeod wedding") |
| `hold_overlap` | active hold overlaps active ink | `warning` | The hold cannot convert; suggest release or another date |
| `insufficient_turnaround` | gap between consecutive same-space occupancies (bookings and/or room-scoped phases) < applicable rule minutes | `warning` | Gap measured **between instants** (real elapsed minutes — immune to DST wall-clock illusions) |

Rules of the engine:
- Prospects and internal blocks generate no conflicts in v0 (prospects never block; blocks *are* unavailability — block-vs-ink surfacing is a later type).
- Soft-deleted and exited rows are ignored.
- Pairs with **no applicable turnaround rule** are counted in `checks.turnaround.uncoveredPairCount` and the status degrades `checked → partial → not_checked` — never silently OK (Canon §4 honesty; house `not_checked` convention).
- All copy is planning-support language; **no compliance/OK badges** (Canon §4, R7).
- **Mandatory tests:** Europe/London **spring-forward (late March)** and **fall-back (late October)** boundaries, midnight-spanning events, several bookings per room per day (the normal case, Canon §8).

---

## 4. Hold hygiene (Canon §3 — the wedge)

**At the API boundary (create + edit):** a `hold` is rejected (400, field-level details) unless it carries `decisionAt`, `ownerUserId`, `nextAction`, and `nextActionDueAt` — the §17 universal law ("nothing exists without a next action, an owner, and a date") enforced at creation, not reported after death. Edits cannot strip these from a live hold.

**Auto-resequence (pure):** `resequenceHolds(ladder: LadderHold[]): ResequenceResult` in `api/src/services/hold-hygiene.ts` —
- Input: the surviving **active** holds of one space whose ranges overlap the departed hold.
- Sort by `(rank asc, createdAt asc)`; reassign contiguous ranks from 1, **preserving joint ties** (equal rank + jointFlag stays shared).
- Output: `{ changes: {id, fromRank, toRank}[], promotedToFirst: {id, ownerUserId, title}[] }` — `promotedToFirst` is the "MacLeod wedding is now 1st option — tell them" ping payload.

**Reminder schedule (pure, job stubbed):** `computeHoldReminderInstants(decisionAt)` returns T-7/T-3/T-1 instants (clamped to future). The scheduler/email wiring is explicitly **P1**; slice 1 ships the pure function + tests so the job has a tested core to call.

---

## 5. `GET /calendar` read model (Canon §12 P0)

One endpoint every view shares (board, day, week, avails):

```
GET /calendar?venueId=<uuid>&from=<ISO>&to=<ISO>&spaceIds=<uuid,uuid,…>   (auth: authenticate + canManageVenue)
```

- `from < to`, range ≤ 366 days (guard), `spaceIds` optional filter (comma-separated).
- Overlap semantics: an entry appears iff `startsAt < to AND endsAt > from` (half-open).

```ts
CalendarResponse = {
  venueId, range: { from, to },
  rooms: { id, name, slug, sortOrder }[],                    // venue's spaces, lane order
  entries: CalendarEntry[],                                   // discriminated union
  conflicts: ConflictReport,                                  // §3 output, same data, same request
}
CalendarEntry =
  | { entryType: "booking", id, spaceId, kind, status, state, title, eventType, startsAt, endsAt,
      rank, jointFlag, decisionAt, ownerUserId, nextAction, nextActionDueAt, eventId, seriesId }
  | { entryType: "phase",   id, spaceId, eventId, eventName, name, startsAt, endsAt, sortOrder }   // room-scoped, timed phases only
```

Phases enter lanes only when they have `spaceId` AND `startsAt` (endsAt = startsAt + durationMinutes). Bookings of every kind/status within range are returned (the board renders exits/prospects differently; filtering is a view concern, not a truth concern) — **except** soft-deleted rows.

Zod schemas (`@omnitwin/types` `booking.ts`): `BookingKindSchema`, `BookingStatusSchema` (liveness), `BookingStateSchema` (derived vocabulary), `BookingSchema`, `CreateBookingSchema` (with the hold-hygiene refinement), `UpdateBookingSchema`, `TransitionBookingSchema`, `TurnaroundRuleSchema`, `CalendarQuerySchema`, `CalendarEntrySchema`, `CalendarConflictSchema`, `ConflictReportSchema`, `CalendarResponseSchema`.

## 5b. Booking write surface (needed for hygiene to mean anything)

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /bookings` | create prospect/hold/ink/block | hold hygiene enforced; direct ink allowed (constraint arbitrates); history row `(created)→state` |
| `PATCH /bookings/:id` | edit fields, move times | never changes kind/status; hold hygiene invariants preserved; ink time-moves hit the constraint (23P01→409) |
| `POST /bookings/:id/transition` | lifecycle moves | two-layer machine validation; §2 side-effects; returns `resequence` payload on hold exits |
| `GET /bookings/:id` | fetch one | serializer emits derived `state` |
| `GET /calendar` | §5 read model | separate route file; registered `prefix: "/calendar"` |

Error envelope: house `{ error, code, details? }`; codes: `VALIDATION_ERROR`, `HOLD_HYGIENE_REQUIRED`, `BOOKING_NOT_FOUND`, `INVALID_TRANSITION`, `TRANSITION_ROLE_FORBIDDEN`, `INK_SLOT_TAKEN`, `SPACE_VENUE_MISMATCH`, `EVENT_VENUE_MISMATCH`.

---

## 6. File-level implementation map

| File | Action | Content |
|---|---|---|
| `packages/types/src/booking.ts` | NEW | kinds/status/state vocab, structural matrix, derive/columns helpers, all Zod schemas above |
| `packages/types/src/index.ts` | EDIT | export the booking module |
| `packages/types/src/__tests__/booking.test.ts` | NEW | vocab locks, matrix exhaustive (valid + invalid), derive round-trip, hygiene refinement, calendar schema shapes |
| `packages/api/src/db/schema.ts` | EDIT | `bookings`, `bookingStatusHistory`, `turnaroundRules`; `spaces` + `(id, venue_id)` unique; `events` + CRM FKs + headcount triple; `eventPhases` + `spaceId` |
| `packages/api/drizzle/0050_diary_bookings.sql` | NEW | §1.3 SQL + tables + ALTERs, idempotent house style, column order = Drizzle order |
| `packages/api/drizzle/meta/_journal.json` | EDIT | idx 48, tag `0050_diary_bookings`, increasing `when` |
| `packages/api/src/state-machines/booking.ts` | NEW | role-policy layer |
| `packages/api/src/services/calendar-conflicts.ts` | NEW | pure conflict engine v0 |
| `packages/api/src/services/hold-hygiene.ts` | NEW | pure resequence + reminder instants |
| `packages/api/src/routes/bookings.ts` | NEW | §5b write surface |
| `packages/api/src/routes/calendar.ts` | NEW | §5 read model |
| `packages/api/src/index.ts` | EDIT | register both routes |
| `packages/api/src/db/seed.ts` | EDIT | turnaround rules + one linked event with room-scoped phases + a believable mixed week (several bookings per room per day) |
| `packages/api/src/__tests__/state-machines/booking.test.ts` | NEW | every valid AND invalid transition; role policy; drift guard |
| `packages/api/src/__tests__/services/calendar-conflicts.test.ts` | NEW | conflict types, severities, explanations, DST (March + October), midnight-spanning, multi-per-room-per-day, honest not_checked |
| `packages/api/src/__tests__/services/hold-hygiene.test.ts` | NEW | resequence incl. joint ties, promotions payload, reminder instants |
| `packages/api/src/__tests__/bookings-routes.test.ts` | NEW | 401 / 400 / hygiene rejection / valid-shape acceptance; source-contract pins (23P01 mapping before insert, venue scoping) |
| `packages/api/src/__tests__/calendar-routes.test.ts` | NEW | query validation, range guard, response schema |
| `packages/api/src/__tests__/diary-schema.test.ts` | NEW | migration↔Drizzle column parity for the three new tables; EXCLUDE/btree_gist/CHECK pins; additive-only guard |
| `packages/api/src/__tests__/migration-tail-readiness.test.ts` | EDIT | `EXPECTED_TAIL` + `0050_diary_bookings` (list maintenance, not weakening) |
| `packages/api/src/routes/events.ts` | EDIT | serializer + create/update accept CRM FKs & headcount triple (only if `EventSchema` is extended — see open question 3) |

## 7. Decision log (this slice)

| # | Decision | Why | Canon fit |
|---|---|---|---|
| 1 | `kind` + `status` split, derived `state` | wash-rate provenance, constraint predicate, house-pattern machine | Satisfies §1 and §2.1 simultaneously |
| 2 | Composite tenant FKs via `(id, venue_id)` uniques | Mission Control precedent; cross-venue writes fail at the DB | §10 reuse doctrine |
| 3 | Holds also require `nextActionDueAt` (not just the action text) | §17 universal law names "a date"; opportunities pair action+due | Strictest honest reading |
| 4 | Turnaround tie-break = most specific rule, then largest minutes | fail-safe direction | §4 |
| 5 | `hold_overlap` severity computed (info hold-hold, warning hold-ink) | ladder is by-design; dead holds are actionable | §3/§4 |
| 6 | Exits keep `rank` (except ink promotion which clears it) | historical ladder position is analytics truth | §3 |
| 7 | Reminder job = pure schedule fn + explicit P1 stub note | "may be stubbed" without pretending a scheduler exists | §12 |
| 8 | No new audit stream — `booking_status_history` + existing `general_audit_log` conventions | survey §3 verdict "don't duplicate" | §2.9 |

## 8. Open questions for Blake (none blocking this slice)

1. `max_hold_rank` venue setting (Canon proposes default 3) — deferred with the challenge engine (P1); v0 accepts any rank ≥ 1.
2. Should `internal_block` rows be generatable from availability rules now? Survey says BUILD a rules table; Canon phases it later — this slice ships manual blocks only.
3. How far to surface `events` CRM FKs through the public `EventSchema` (blast radius into web fixtures) — slice implements DB + types; if web fixture fallout exceeds the slice budget, exposure notes go in the report.

## 9. Out of scope (pointers)

Timeline UI (P0 remainder, next slice) · websocket command channel (Canon §9) · challenge engine + joint ultimatums (P1) · waitlist (P1) · buffer/turnaround **templates** generating phases (P1) · resource singletons, room hierarchy/combinability (P1+) · ICS poller (P0 tail) · reminders delivery via Resend (P1).

---

## 10. Slice 2 — the Board (T-493; Canon §8/§9/§12/§18)

**Scope:** the DOM-first multi-room timeline consuming `GET /calendar`. Lanes (six Trades Hall rooms), day/week/month zoom, venue-local now-line, drag with 15-min snap + live-conflict ghost + state-gated ink confirm, keyboard navigation **and keyboard drag day one**, undo, conflict rail with honest checks, needs-action holding tray, Ink & Gilt visuals (concept A). Route: `/diary` (staff/admin write; hallkeeper read — the Slice-1 write gate already enforces the server side).

### 10.1 File map

| File | Content |
|---|---|
| `web/src/pages/diary/board-copy.ts` (+test) | copy-as-data, claim-guard swept |
| `web/src/pages/diary/lib/board-time.ts` (+test) | pure: venue-local day/week/month ranges via Intl (Europe/London; DST-tested both directions), time↔x math, 15/1-min snapping, now position, axis ticks |
| `web/src/pages/diary/lib/board-layout.ts` (+test) | pure: interval packing into sub-rows (deterministic), footprint segment grouping (phases inside their booking's block; orphan phases standalone), needs-action selection |
| `web/src/pages/diary/lib/board-drag.ts` (+test) | pure reducer: idle→pending(5px)→dragging→confirming(ink)→idle; pointer + keyboard share it; ghost validity vs active inks (blocked/warning + inline reason); commit payload builder |
| `web/src/api/diary.ts` | `getCalendar(venueId, from, to, signal)` / `moveBooking(id, patch)` — Zod-validated via shared schemas |
| `web/src/pages/diary/hooks/useCalendar.ts` | fetch + abort + refetch; optimistic entry override during commit |
| `web/src/pages/diary/hooks/useUndoStack.ts` (+test) | move history; Ctrl+Z + toast undo → PATCH back |
| `web/src/pages/diary/DiaryBoardPage.tsx` (+test) | shell: view/date state in URL (`?view=week&date=`), loading/error/empty, header (zoom, date nav, legend), composition |
| `web/src/pages/diary/components/` | `BoardGrid` (sticky room rail + axis, lanes, now-line), `BoardBlock` (state visuals, focus, aria), `ConflictRail`, `HoldingTray`, `UndoToast` |
| `web/src/pages/diary/diary-board.css` | Ink & Gilt board language; local `--diary-paper`/hatch tokens pending the A3 merged token layer |
| `web/src/router.tsx` | lazy `/diary` behind `ProtectedRoute` (admin/staff/hallkeeper) |
| `types/booking.ts` + `api/routes/bookings.ts` | `UpdateBookingSchema` gains optional `spaceId` (cross-lane moves); PATCH validates space∈venue (composite FK backs it; 23P01 already → 409) |

### 10.2 Decisions

| # | Decision | Why |
|---|---|---|
| 1 | No dnd-kit / no TanStack Virtual | neither is installed; 6 lanes × a week is tiny DOM (virtualisation is a later add per Canon §9 budget); the repo's drag culture is custom hooks. Keyboard DnD implemented in the shared reducer with live-region announcements — the Canon's requirement is the capability, not the library |
| 2 | Venue timezone constant `Europe/London` in board-time | `GET /calendar` doesn't carry `venues.timezone` yet; single-venue reality. Response gains it with multi-venue (flagged) |
| 3 | Ink "resists": drop of an ink enters a confirm step (Enter/click to confirm, Esc cancels); pencils commit instantly | Canon §8 "explicit intent required" without a modal |
| 4 | Undo = PATCH back to previous values (client stack, Ctrl+Z + toast ≥5s) | no server undo endpoint; honest and simple; concurrent-edit caveat documented |
| 5 | Tray v1 = needs-action rail (overdue next actions/decisions, unranked pencils; click focuses block) — **drag-from-tray deferred** | bookings.spaceId is NOT NULL and enquiry→booking conversion is Slice 3; a display+focus tray is honest, a fake drop target is not |
| 6 | Keyboard-initiated commits animate nothing; pointer drags get transform-only ghost + spring snap-back on invalid | Emil doctrine + Canon §8 feel budget |
| 7 | Mutations refetch in the background after optimistic apply | no websocket channel yet (Canon §9 is a later slice); refetch keeps conflicts honest |
| 8 | Closed-day hatching deferred | no availability-rules data exists (schema question §8.2) |

### 10.3 Zoom table

| View | Window | px/hour | Disclosure |
|---|---|---|---|
| day | venue-local midnight→midnight | 96 | colour + title + times + chips |
| week | Monday→Monday | 18 | colour + title (+times ≥ 90px width) |
| month | 1st→1st | 3 (72/day) | colour bars + title when it fits |

---

## 11. Slice 3 — drawer, enquiry→hold, live channel (T-495–T-497)

**Scope:** close the working loop. (1) The **booking drawer**: create pencil/ink/block, edit fields, and perform role-gated lifecycle transitions from the Board (Enter opens the drawer; Space lifts for keyboard drag — key split replaces Slice 2's Enter-lift). (2) **Enquiry→hold conversion** (Canon §12 P0 "enquiry→hold"): the tray gains the venue's open enquiries; "Pencil in…" opens the drawer in convert mode prefilled from the enquiry (spaceId, preferredDate, eventType, guest name) and submits `POST /bookings/from-enquiry` — hygiene enforced, provenance kept via new `bookings.enquiry_id`. (3) **Live channel** (Canon §9/§15 first tranche): `/ws/diary` — first-message auth (auto-save convention), presence per venue, 20-second heartbeat with stale termination, and `diary.event` broadcasts fanned out from the house event bus; every successful booking mutation emits `diary.changed` AFTER its transaction commits. The Board subscribes (`useDiaryLive`): events → debounced refetch; presence → header chips; exponential-backoff reconnect with fresh snapshot on reconnect (refetch on open).

| Decision | Why |
|---|---|
| Mutations stay REST; the ws carries **events + presence**, not command envelopes yet | The Canon's correctness core (validate in a transaction, exclusion constraint arbitrates, commit → broadcast) is preserved; migrating the write path to command envelopes is the explicit remaining §9 step, deferred until offline queueing needs it. Flagged, not silent |
| `bookings.enquiry_id` (migration 0051, additive, SET NULL) | conversion provenance; the Slice-1 parity pin becomes `0050 CREATE columns + 0051 ALTER additions` — documented maintenance |
| Conversion does NOT move the enquiry's own status | the commitment axis and the enquiry axis stay independent (Canon §1); staff may pencil an enquiry still under review |
| Hub state is a single-process registry | Canon §15: fine until a second replica; Redis backplane is that precondition, restated here |
| Presence is advisory display only | never a correctness mechanism (Canon §9) |

File map: `api/src/services/diary-events.ts` (emit helper + EventMap extension in `observability/event-bus.ts`) · `api/src/ws/diary-live.ts` (`DiaryLiveHub` pure-ish core + `registerDiaryLive`) · `api/drizzle/0051_diary_enquiry_link.sql` + journal + EXPECTED_TAIL · `api/src/routes/bookings.ts` (+from-enquiry route, + event emissions) · web: `pages/diary/components/BookingDrawer.tsx`, `lib/drawer-form.ts` (pure form⇄payload mapping + venue-local datetime helpers in board-time), `hooks/useDiaryLive.ts` (+ pure `live-protocol.ts` message reducer), tray + page wiring. Tests per unit, house patterns.

## 12. Slice 7 — first-live-week operations (T-527; Canon §12/§15/§18)

The hold-hygiene reminder core (§3, `computeHoldReminderInstants`) gains its
delivery layer, and the first live week gets a repeatable operations pack.

**Delivery design (`api/src/services/hold-reminders.ts`):**

| Decision | Rationale |
| --- | --- |
| NO new schema — idempotency keys ride `email_sends`' UNIQUE constraint | the sent-marker already exists, survives restarts, and dedupes racing crons at the database; a bespoke reminders table would duplicate it (house rule: reuse, no duplicates) |
| Key = `hold-reminder:{bookingId}:{decision-day}:t-{n}`, decision day venue-local (Europe/London), built via `formatToParts` | a MOVED decision date must earn fresh T-7/3/1 reminders — the old date's send must not dedupe the new date's; `formatToParts` keeps the string independent of locale ordering because it lives inside a UNIQUE db key |
| 24h freshness window; stale instants are skipped, never sent late | "7 days to decide" on day 5 is misinformation; the ladder's ≥48h gaps mean at most one instant is ever due (proved in tests) |
| Nothing sends at/after the decision moment | overdue-decision comms are hold hygiene's resequence conversation, not a countdown |
| Owner join is LEFT | ownerless holds still count in `scanned` (honest summaries) and are skipped as unreachable — `configuration-reviews` changed_by precedent |
| Per-reminder failure isolation (key derivation inside the try) | one undeliverable reminder never starves the pass |
| Scheduling = pure pass + `POST /admin/diary/hold-reminders` (dryRun) + `scripts/run-hold-reminders.ts` for cron | the house cleanup convention — no in-process timers; the CLI exists because the admin endpoint requires a signed-in Clerk platform admin, which a scheduler cannot be. Exit 1 on failures feeds cron alerting |

**Operations pack:** `docs/operations/diary-first-week-operations.md` — smoke
cadence + append-only results log + triage tree (per-surface failure→cause→
action, retry-safety rules) + the reminder cron recipe and its rehearsed
safety properties. Claim-safe throughout: reminders are a planning nudge;
decisions stay with people.

File map: `api/src/services/hold-reminders.ts` (pure due-selection +
injected-send orchestration + fetch) · `api/src/services/email-templates.tsx`
(`HoldDecisionReminderEmail`) · `api/src/routes/admin.ts`
(`POST /admin/diary/hold-reminders`) · `api/src/scripts/run-hold-reminders.ts`
(cron path) · tests: `services/hold-reminders.test.ts` (16),
`admin-hold-reminders.test.ts` (5, service-mocked in an isolated file).

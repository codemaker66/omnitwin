# Prepared decisions (goal 09 M1)

A consequential change reaches the venue as a **prepared decision**: what it
is for, the options with a recommendation and its reasons, each option's
consequences and the exact change it would make, what is not known, and who
may approve it. It executes only on approval, through the Diary's own command,
after the venue's current state is read again. Every step is kept in the
decision's history.

AI proposes, deterministic checks evaluate, people authorise (goal 09). A
decision is prepared by deterministic code from the venue's own records; a
language model never prepares, approves or executes one.

## Where it lives

| Part | File |
| --- | --- |
| The object, its classes, who approves | `packages/types/src/decision.ts` |
| Storage and history | `packages/api/drizzle/0105_decisions.sql`; `decisions`, `decision_events` in `db/schema.ts` |
| Prepare, decide, withdraw, read | `packages/api/src/services/decisions.ts` |
| Routes | `packages/api/src/routes/decisions.ts` (`/decisions`) |
| Tests | `packages/types/src/__tests__/decision.test.ts`; `packages/api/src/__tests__/decisions.test.ts`; `packages/api/src/__tests__/decisions-postgres.test.ts` (platform database gate) |

## The first decision: moving a booking (M2's first)

`POST /decisions/booking-time-moves { bookingId, startsAt, endsAt, reason? }`
prepares from what the Diary holds; the same move asked for again while one
stands is answered with it. Times are between the years 2000 and 2199.

- **The phases that move with it** are the ones the Diary's move carries: its
  event's phases in the booking's room from a day before the booking until it
  ends, set-up included, except a phase inside another live booking of the
  same event (`phaseMovesWithBooking`, beside the SQL in `event-binding.ts`).
  They are part of what the decision is prepared on: a phase added or moved
  since makes it stale.
- **Its consequences** come from the Diary's own conflict engine
  (`services/calendar-conflicts.ts`), run on the room's bookings and phases a
  day either side, with and without the move. A consequence is any finding
  after the move that was not there, word for word, before: a confirmed
  booking in the way (blocking), a hold it would overlap, less turnaround
  either side, a gap that gets shorter, the same event's other day (warnings),
  or a pair no turnaround rule covers (not checked). Two more come from the
  Diary's rules the engine does not weigh: a room closure at the new time,
  and a live hold the Diary's update would refuse to move without its
  decision date, owner and next action (both blocking).
- At most 30 are listed, blocking first; the rest are counted ("And 12 more
  like those above").
- **Move** is executable unless something blocks it, and recommended only with
  no warnings. Its mutation is the Diary's `booking.update`, with a command id
  minted when it was prepared.
- **Keep** changes nothing; deciding it is the decline, whatever has changed.
- **Not worked out yet**, said on every time move: the staff rota, catering and
  equipment. They are M2's remaining consequences.

A decision is checked against its schema before it is kept, and read back in
the same transaction, so one that could not be shown is never kept. A row an
older version kept that this one cannot read is left out of the venue's list
and answered 409 `DECISION_UNREADABLE`, rather than failing the list.

## Deciding

`POST /decisions/:id/decide { optionId, decisionDigest }`, by someone who holds
the approval for the decision's class at its venue (`DECISION_APPROVER_ROLES`,
from `docs/operations/people-matrix.md` §4; never `canManageVenue`). A time
is approved by the venue's staff or admin (Blake, 10 October 2026), exactly
the Diary's write roles (a test keeps them equal). A guest-count change, a
stock shortage and an unanswered request are approved by its admin, with the
manager only if Blake says so, and cannot be carried out yet
(`NOT_CARRIED_OUT_YET`). A platform admin is not a member of the venue and
approves none. One class's approval never implies another's.

`decisionDigest` is the `digest` of the decision as read: the answer names the
decision it is for, so another decision on the same booking, or one read
before it changed, is never decided by mistake (409 `DECISION_MISMATCH`).

In one transaction, under a lock on the decision (taken once the person is
known to work at its venue):

1. A decided decision answers the same choice as it did the first time, a
   refusal included (`Idempotency-Replay: true`), and refuses another (409
   `DECISION_CLOSED`).
2. "Keep" declines, with nothing to check.
3. The booking is read again, locked, and the move's consequences worked out
   again. If the booking, the phases moving with it or the consequences
   changed, or the decision expired (a day, or the booking's start if
   sooner), **nothing executes**: the decision is superseded by a revised one,
   which is returned (409 `DECISION_STALE`, `details.revised`).
4. The move runs as `updateBookingCore` with the prepared booking state as its
   precondition, and is recorded in the `diary_commands` ledger under the
   decision's command id. If the venue's own rules refuse it, nothing changes
   and the decision is `failed` with the refusal in its receipt.
5. The receipt and the history row are written in the same transaction. An
   unexpected error while carrying it out rolls the whole step back, the
   decision stays `prepared`, and an `execution_error` row is written to its
   history.

An executed move is announced to the live Diary after commit (`diary.changed`),
as its own writes are. Not covered: a hold pencilled into the new time in the
instant between the last read and the move is not seen; a confirmed booking
there is refused by the database's own no-overlap rule.

## The decision history, and what is kept

`decision_events` keeps one row per step: `prepared`, `executed`, `declined`,
`failed`, `stale` (with the revised decision's id), `withdrawn`, and
`execution_error`. Each row records who took the step and its particulars. It
is append-only: triggers refuse update, delete and truncate. A decision's
`body` (what it was prepared as) never changes. Its status changes once, from
`prepared`. Decided decisions are final at the database (`decisions_guard_update`).
`GET /decisions/:id` returns the decision with its history.

Kept for good, so nothing kept names a person. A decision holds ids, times,
rooms and the Diary's refusal codes; its consequences are written from times,
never from a booking's title (a viewing's title is the enquirer's name). The
booking's title is read from the Diary when the decision is read
(`subjectTitle`, null once the booking is deleted). The asker's reason, free
text that can name someone, is in its own column, which can be erased (set to
null) at any time and nothing else with it. Preparing is limited to 30 a
minute a person.

## The rest of goal 09, as of 27 October 2026

| Slice | State | What it needs |
| --- | --- | --- |
| M1 decision object | Landed for the booking time move: types, storage, capability, revalidate-on-stale, receipts, history, tests for scope, stale approval, duplicate execution, partial failure, withdrawal, recovery, and the release review's cases | A screen for prepared decisions (the Diary today moves by direct action, which expresses approval) |
| M2 first three decisions | The time move is prepared and executed. A guest-count change and a stock shortage have classes and approvers only | Their preparation from goal 06 S8 and goal 05 S7; the rota, catering and equipment consequences |
| M3 unanswered request | The class and its approver only; requests escalate today (`services/requests.ts`) | HUMAN.md 8: the duty admin, by name |
| M4 brief to alternatives | Event Architect's three deterministic candidates with repair hints; no explicit no-fit | HUMAN.md 13: three hard real briefs and the venue's rules |
| M5 feasible offers | Not started | Goal 05 stock and goal 06 holds as inputs |
| M6 Truth Mode, selection-aware | Configuration-level summary only | Per-target evidence |
| M7 Guest Flow Replay | Seeded and deterministic per run | Runs across seeds; T-306's bar-queue zone |
| M8 Event Memory | Not started | Real actuals from goal 06 events |
| M9 bounded delegation | Not started | HUMAN.md 16, and shadow runs to exist first |

Goal 09's done-when needs every row and an admin-effort baseline measured
before any improvement factor is claimed. None is claimed here.

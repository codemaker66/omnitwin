# The bind: every hold and ink belongs to its event

Event-spine Phase A (the red-teamed upgrade brief's number 1, July's "one thing").
Migration `0090_booking_event_bind`. Phases B (parties) and C (moving a date) are
separate slices and are not built.

## The rule

- A provisional option (`hold`) and a confirmed booking (`ink`) always have an
  event. The database holds it: `bookings_bound_to_event` is
  `CHECK (kind NOT IN ('hold', 'ink') OR event_id IS NOT NULL)`. Interest only
  (`prospect`) and the venue's own blocks (`internal_block`) may stand alone.
- Both foreign keys from `bookings` to `events` are `ON DELETE RESTRICT`
  (`bookings_event_id_fkey`, `bookings_event_venue_fk`). Events are
  soft-deleted through `deleted_at`; no code deletes an event row.
- The event is always at the booking's venue: the composite key
  `(event_id, venue_id)` enforces it, and every writer checks it before writing.

## Who writes, and how

Every writer binds inside the booking's own transaction through
`packages/api/src/services/event-binding.ts`:

| Writer | Path | Joins |
| --- | --- | --- |
| Enquiries desk, "Hold the date" | `POST /bookings/from-enquiry` (`routes/bookings.ts`) | the event the enquiry's other bookings already have, else a new one; the enquiry row is locked, so two holds at once share one event |
| Diary create | `createBookingCore` (REST and `/ws/diary` commands) | the named event (checked to be this venue's), else a new one |
| Diary edit | `updateBookingCore` | may move a booking to another event of its venue; `eventId: null` on a hold or ink is refused (`EVENT_REQUIRED`) |
| Diary transitions | `transitionBookingCore` | interest only made provisional or confirmed takes its enquiry's event or a new one |
| Client's proposed window | `proposeWindowCore` (`services/window-proposals.ts`) | the client's own event, as before |
| Seed, importer, database fixtures | `insertBoundBookings` | as the cores: a named event, the enquiry's (one event per enquiry within a batch), else new; one transaction for the batch |

Joining is never a guess: only by enquiry or by an event someone named. A new
event takes the booking's title, type and times, the enquiry's name as client,
the booking's fixture marker, the house's default phases with no room or time,
and headcount 0 (unknown).

The switching-day importer must call `insertBoundBookings` (or the cores). The
CHECK refuses anything that skips them, so it is never relaxed for an import.

## The event's status follows its bookings

`deriveEventStatus` in `packages/types/src/event-binding.ts`, re-run by
`syncEventStatus` after every booking write (it locks the event row and then
reads the bookings, so a booking committed meanwhile is always seen). The lock
is `FOR NO KEY UPDATE`: each booking written or moved onto an event holds
`FOR KEY SHARE` on it through the foreign key, and `FOR UPDATE` conflicts with
that, so two writers adding rooms to one event at once (or moving bookings
between two events in opposite directions) would deadlock. Both cases have
Postgres tests.

| Its bookings (deleted rows and house blocks are not evidence) | Its status |
| --- | --- |
| a confirmed booking is live | `confirmed`, or the later step people recorded (`in_planning`, `ready_for_ops`, `executed`, `closed`) |
| only options or interest are live | `draft`, or `proposed` when recorded |
| nothing live; a confirmed booking was cancelled | `cancelled` |
| nothing live; options released, lapsed or lost | `lost` (new status) |
| no booking at all | unchanged |

`PATCH /events/:id` refuses a status the Diary would change straight back
(`EVENT_STATUS_FOLLOWS_DIARY`). The Diary calendar no longer paints or checks
the phases of a `lost` or `cancelled` event, so a released competing option's
plan leaves the room.

## Migration 0090 on existing rows

One transaction, five-second lock limit, re-runnable without change:
`lost` joins the status check; every hold or ink without an event joins its
enquiry's event or gets one per group (one enquiry's bookings together); every
event the Diary speaks for takes its derived status; then the RESTRICT keys and
the CHECK. Nothing is deleted. A group of only deleted bookings gets a deleted
event.

Deploying it: Railway's pre-deploy step runs 0090 while the previous API
container still serves. From the moment 0090 commits until the new container
takes over, the old code's unbound writes (a hold made from an enquiry, a Diary
hold or ink with no event, interest made provisional) are refused by the CHECK
and write nothing: an integrity error, or a server error for the transition.
They succeed again once the new container is live, so deploy at a quiet time.
The migration takes `SHARE ROW EXCLUSIVE` on both tables and later
`ACCESS EXCLUSIVE` for its `ALTER TABLE`s; a request holding a read lock and
then writing can deadlock with that upgrade, and Postgres then aborts one
side: the request (one failed write) or the migration (the deploy fails, the
old container keeps serving, and the deploy can be run again).

`event_binding_reviews` lists what a person should look at: a booking whose
enquiry was already split across events (`enquiry_events_differ`), a new event
that may be the same occasion as another booking's (`possibly_same_event`:
same title, same venue, within twelve hours; the seed's demo rows are left
out), and every existing event whose status changed, with the status it had
(`event_status_derived`). It is written once by the migration and read by SQL.

## Checks

- `packages/types/src/__tests__/event-binding.test.ts`: the table row by row,
  every combination of up to three bookings and every prior status, and 2,000
  seeded walks of the real transition matrix.
- `packages/api/src/__tests__/booking-event-bind-postgres.test.ts` (platform
  database gate): the CHECK and RESTRICT, every writer, two holds from one
  enquiry at once, a release racing a confirmation and two releases at once,
  two writers adding rooms to one event at once, two bookings moved between
  two events in opposite directions at once,
  a released option's phases leaving the calendar, the Diary's time on the
  hallkeeper's sheet, and 0090 run by the real migrator over a database written
  before it (backfill, review list, the SQL statuses checked against
  `deriveEventStatus` over every prior status and booking mix, and a replay
  that changes nothing).
- `packages/api/src/__tests__/booking-event-bind.test.ts`: the migration text,
  the Drizzle schema and the types agree.
- Production, once after 0090 deploys (read only):
  `pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts`
  prints `unboundBookings`, `contradictingEvents` (both must be 0) and the
  review list's size by reason.

## Not in this slice

The "join which event?" question for a second hold that may be the same
occasion under a different enquiry; showing lost events and their reasons in
the pipeline; whether the Day Board should hide live holds (it shows them as
options today); event-owned door schedule and dietary reads, which wait for a
versioned sheet hash. See the session note for 17 October 2026.

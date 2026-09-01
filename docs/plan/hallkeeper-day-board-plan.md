# The Day Board — live hallkeeper timetable, planner time-setting, slot messaging

**Date:** 2026-08-27 · **Status:** plan, awaiting Blake's go · **Owner request:** plan a room
in the visual viewer, set WHEN it happens with a genuinely fun control, feed a real-time
colour-coded timetable for hallkeepers, and let organisers message hallkeepers on any slot
with live replies.

---

## 1. The one architectural decision everything hangs on

**Times are set through the Diary booking. The planner never grows a second clock.**

"Grand Hall occupied 12–4pm" already has a home: a `bookings` row with `startsAt`/`endsAt`,
guarded by the exclusion constraint (double-book impossible for ink), checked by the
turnaround engine, broadcast over `/ws/diary`, and — since T-539 — linked to the floor plan
via `eventId`. The planner's new time control **reads and writes that booking** through the
existing idempotent command path (T-537/T-538). No parallel store, no divergence, and the
hallkeeper board inherits every safety rail the Diary already has.

Likewise the timetable is **a projection of `GET /calendar`** (which already returns
bookings, phase entries AND per-gap turnaround status) plus a clock. Almost no new read API.

## 2. The planner's "When" control — fun, but honest

A **time ribbon** docked in the planner cockpit (the plan already knows its booking through
the T-539 corridor):

- A horizontal day strip for the plan's room. The current booking is a **draggable ingot**
  (gilt bar) — drag to move, pull the ends to resize, spring-settled snapping to 15 minutes
  (house motion rules; transform-only).
- Other bookings in that room render as **ink ghosts** — you feel the day's shape and
  physically cannot draft into an inked slot: the ingot compresses and bounces back off the
  exclusion zone, with the turnaround gap shown as a hatched buffer.
- Release = a booking PATCH through `updateBooking` (idempotent, undoable, live-broadcast).
  The Diary board and the Day Board update in real time over the existing ws channel.
- If the plan has no booking yet, the ribbon offers "add this to the Diary" → the existing
  drawer flow.

Fun comes from feel (springs, snap, resistance), not decoration.

## 3. The Day Board — colour and motion system

One screen per venue-day, four room lanes, slots = bookings with their setup/teardown
phases. Reference images: **none found in the repo** — drop them in
`docs/plan/reference/day-board/` and the build consumes them; until then the board follows
the Diary's Ink & Gilt language.

### State machine (per slot, all client-derived from times + one shared clock)

| State | Trigger | Colour | Motion |
|---|---|---|---|
| Scheduled | > 90m out | quiet ink card | none |
| **Organisers due** | setup window opens ≤ 60m | **green** edge + dot | pulse, 4s |
| **Guests due** | doors ≤ 30m | **amber** | pulse, 3s |
| Imminent | doors ≤ 10m | deep amber | pulse, 2s |
| **In progress** | between start and end | **claret "LIVE"** with a gilt breathing dot | breathe, 4s |
| Turnaround | between events | slate, hatched | none |
| Done | ended + marked done | faded ink | none |
| **Exception** | overrun / turnaround at risk / urgent unread message | **red** | pulse, 1.5s |

**One deliberate divergence from the spoken brief (flagged, not silently changed):** the
brief had *in progress = slow pulsing red*. Recommendation: a red pulse sustained for a
four-hour event fatigues the eye and leaves nothing for genuine alarms. So in-progress is a
calm heritage **claret LIVE** state, and **red is reserved exclusively for exceptions** —
overrun past the scheduled end, a compressed turnaround, an urgent message nobody has
acknowledged. The countdown ramp (green → amber → deep amber, quickening cadence) keeps the
traffic-light intuition. If Blake wants literal red-in-progress it is a one-line token
change.

### Motion laws (non-negotiable)
- All pulses phase-locked to **one global 4s clock** (2s/3s as harmonics) — synchronised
  breathing reads calm; free-running pulses read as noise.
- `transform`/`opacity` only, CSS keyframes, zero re-renders on tick (the clock lives in one
  context; slots derive state at minute granularity).
- `prefers-reduced-motion`: pulses become static chips with countdown text
  ("Guests · 28m") — information is never lost, only motion.
- Every state legible without colour: icon + text on every chip (colour-blind safe), AA
  contrast in both themes (the `/fresh` contrast failure is the standing lesson).

## 4. Slot messaging — organiser ⇄ hallkeeper, exactly-once

Nothing exists today (no messaging tables anywhere in the schema). Design:

- **Schema:** `booking_messages` (id, venueId, bookingId, authorUserId, authorRole,
  body ≤ 2k, urgent bool, createdAt) + `booking_message_receipts` (messageId, userId,
  readAt, ackedAt). Command-envelope idempotency reused verbatim: messages ride `/ws/diary`
  as a new command kind through the `diary_commands` ledger, REST fallback with
  `Idempotency-Key` — the T-537/T-538 machinery gets its second consumer.
- **UX:** tap a slot → thread drawer (Ink & Gilt, same drawer physics as the Diary).
  Unread = gilt count badge on the slot with a single 200ms arrive animation; **urgent**
  unacknowledged = the slot enters the red exception state until a hallkeeper taps
  **Acknowledge** — the organiser then sees "Seen by Elaine · 14:02".
- **Fan-out beyond the glass:** if an urgent message is unacknowledged after 3 minutes and
  no hallkeeper session is on the ws channel, fall back to the existing notification row +
  email paths (`event_plan_notifications` / `email_sends` patterns). A wall tablet cannot be
  the only delivery guarantee.
- **Permissions:** staff/admin write, hallkeeper replies, clients never see the thread.
  Everything audited (ledger + action-log pattern). Retention: 12 months, then a prune job.

## 5. What the brief missed — the real-world list

1. **Setup ≠ start.** "Organisers due" keys off the *setup phase* opening, not event start —
   phase entries already exist in the calendar response.
2. **Overrun & done.** Hallkeepers get two taps per slot: *doors open* and *mark done*.
   Without a done signal, overrun detection is impossible.
3. **Kiosk reality:** wall-tablet mode — auto-reconnect (exists in `useDiaryLive`), Clerk
   session refresh so the board never dies overnight on token expiry, day rollover at
   04:00, optional chime for urgent messages (off by default).
4. **Offline:** reuse the EventDayOps offline-queue pattern for ack/done taps.
5. **DST / cross-midnight / multi-day:** `board-time.ts` already solved venue-local time —
   reuse, never re-derive.
6. **Multi-room events:** one event spanning rooms renders one slot per room, badged.
7. **Single-replica constraint:** ws is in-process; fine for one venue. The Redis backplane
   remains the documented gate before a second API replica.
8. **Demo-ability:** the production diary is empty; slice 1 includes seeding a real Trades
   Hall week (owner-provided JSON, dry-run by default) so the board is alive on first look.
9. **API deploys are manual** — schema + ws changes ship only via migrate + `railway up`
   (Blake-gated). Web-only slices deploy on master push.
10. **Print fallback:** link the existing hallkeeper PDF sheet from each slot.

## 6. Slices (each independently shippable)

- **S1 — The Day Board, read-only.** Route `/hallkeeper/today` (hallkeeper/staff/admin,
  inside the app shell). Calendar projection, full state machine, colours + motion,
  reduced-motion + a11y, seeded week, e2e + visual check. *Web-only.*
- **S2 — The When ribbon** in the planner cockpit, writing through the booking. *Web-only.*
- **S3 — Slot messaging:** schema, migration, ws command kind, thread drawer, badges, ack,
  urgent fan-out. *API + web; needs migrate + `railway up`.*
- **S4 — Ops states:** doors-open / mark-done, overrun + turnaround-at-risk exceptions.
- **S5 — Kiosk polish:** rollover, chime, offline queue, 60fps perf proof, print link.

Gates per slice: typecheck, lint, full web (+ api where touched) suites, the visual-check
harness, claim-safe copy sweep, and a live walkthrough before merge. PR per slice — CI now
has Build + Test green, and a PR is the only way a branch gets tested.

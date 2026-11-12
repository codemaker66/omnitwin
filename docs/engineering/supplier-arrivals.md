# Supplier arrivals on the Day Board

Who comes to the building for a booking, when, and at which door (T-692). The
office enters an arrival against one of its bookings; the floor marks each
supplier arrived and gone from the booking's panel; today's sentence names who
is late at the door and who is due within the hour. A supplier pass (see
[Supplier passes](supplier-passes.md)) stays what the supplier is sent; an
arrival is the floor's record of the door.

## Where it lives

| Part | Code |
| --- | --- |
| Contracts, limits and retention | `packages/types/src/supplier-arrivals.ts` (`SupplierArrivalSchema`, the strict create and update schemas, `SUPPLIER_ARRIVAL_RETENTION`) |
| Tables | `packages/api/drizzle/0109_booking_supplier_arrivals.sql` (`booking_supplier_arrivals`, `booking_supplier_arrival_events`) |
| Routes | `packages/api/src/routes/supplier-arrivals.ts` (`/venues/:venueId/supplier-arrivals`) |
| Rules | `packages/api/src/services/supplier-arrivals.ts` |
| Retention pass | `packages/api/src/services/supplier-arrival-retention.ts`, run by `scripts/run-cleanup.ts` and `POST /admin/cleanup`; dry run at `POST /admin/retention/supplier-contacts` |
| Board | `packages/web/src/pages/hallkeeper/DayBoardSuppliers.tsx`, `lib/use-supplier-arrivals.ts`, `lib/supplier-times.ts`, `lib/supplier-notices.ts` |
| Proof on PostgreSQL | `packages/api/src/__tests__/supplier-arrivals-postgres.test.ts` |

## Rules the code holds

- **Who.** The floor reads (`canManageVenue`) and marks the door
  (`canRecordObservation`); the office plans (`canAdministerVenue`). Every
  read and write is scoped by venue, and the composite key onto
  `bookings(id, venue_id)` keeps any writer from filing one venue's supplier
  under another venue's booking. The wall reads none: it shows no contacts.
- **Off the Diary.** A booking deleted, or released, expired, cancelled or
  lost (`isLiveBooking`), takes its suppliers off the floor's read and steps,
  and the office adds and changes none (409 `BOOKING_NOT_ACTIVE`). A supplier
  marked in and not out stays, whatever became of the booking: still read,
  still marked gone, and that Gone can be taken back, because lock-up must
  know who is in the building. Their arrival is not taken back off the Diary;
  Gone records when they left.
- **Serialised with the Diary.** An add or change holds the booking `FOR
  SHARE` while it is judged and written. A Diary move or exit (`FOR UPDATE`)
  goes wholly before or after it, so an add that waited is judged against
  where the move left the booking. A move or a proposal moves the arrivals
  not yet marked by the booking's own shift, in its transaction.
- **Facts at the door.** First tap wins; a second reads it back. A tap that
  writes an arrival time must fall between twelve hours before the supplier
  is due and a day after they were due to leave. Gone for someone already in
  is never refused for lateness.
- **Once per Save.** An add may carry the house `Idempotency-Key`: a resend
  answers with the first add (200, `idempotency-replay: true`), two at once
  make one, and the key with another booking is refused.
- **History.** Every mark, mark taken back and removal writes a
  `booking_supplier_arrival_events` row in the same transaction. Marks carry
  the person's name; a removal keeps only the account, and its row outlives
  the arrival.
- **The day's read.** The board reads from the shown date's midnight to the
  next boundary hour, so it holds the small hours of the night before as well.
  The panel lists the board's own day (`boardDayOf`); a supplier from the
  night before shows only while still marked in or late now, with that day
  named. Typed times are placed on the board's night only once the venue's
  boundary hour is read (`useDayBoundary`).

## Retention (Blake, 12 November 2026)

- A supplier's contact and the office's note are cleared
  `SUPPLIER_ARRIVAL_RETENTION.daysAfterBooking` (365) days after the booking
  ends, by the nightly clean-up. The pass is idempotent and moves the
  revision, so a form opened before it cannot write the contact back.
- The supplier's name, the times, the door and the door marks stay as the
  venue's record. The names of the staff who marked a supplier in or out
  (`arrived_by_name`, `left_by_name`, and the history's names) are kept as the
  record of who was in the building, after an account is closed too. There
  is no erasure path for them by design; the privacy policy says so.

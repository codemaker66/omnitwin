# The Diary holds the whole book: design

Design, 14 November 2026; revised on 15 November after a builder's check, and after the release lead's review of 16
November; both are answered here. Nothing Blake decided is changed.
Status: **approved by Blake on 16 November 2026**, by button: "Approve it (Recommended)". His answers to its
decisions are recorded word for word in section 14; one decision (4) has not been put to him yet.
Piece A of the platform plan (`docs/superpowers/specs/2026-11-13-platform-plan-design.md`, section 5.2), ledger row
T-703. Branch `claude/platform-diary-design`. Code was read at master `7c3461e7`; every `path:line` below is from the
repository root at that commit, and the cited lines are unchanged at master `e138dc00`. The two approved designs this
piece meets are on master: the spine (`docs/superpowers/specs/2026-11-13-the-spine-design.md`, pull request #427) and
the plumbing (`docs/superpowers/specs/2026-11-13-the-plumbing-design.md`, pull request #425). First read on their
branches, they were checked again on master `a3fdff12`, unchanged where cited.

**Section 1 is the one screen for Blake. Sections 2 to 19 are for whoever builds and reviews it.**

## 1. On one screen

**What this adds.** Today the Diary holds only what someone has typed into it. The venue's real bookings are still
in its old system, so every question about a date is answered there, and a new booking would be typed twice. This
piece brings the old diary's future bookings and holds into Venviewer, adds the four things a diary keeper would
refuse to lose (2 to 5 below), and switches reminders on.

1. **The old diary brought in.** Its future bookings and holds, with their dates, rooms, option numbers, decision
   dates, owners and client contacts. No money. A report comes first: what would come in, what would be left out,
   and why. A named person at the venue checks how the old room names and words match ours, and signs it. Running
   it a second time changes nothing. The latest run can be undone, except what staff have changed since.
2. **A regular hirer's term, entered once.** "Every Tuesday, 7pm to 9.30pm, September to December", with the weeks
   that differ: a week skipped, a room changed, an early finish.
3. **Rooms sold together.** Confirming the whole stops anyone confirming a part, and the other way round. The
   database refuses it, not just the screen.
4. **Set-up and breakdown time** before and after a booking. It keeps the room and shows as what it is, never as a
   longer event.
5. **A hold that lapses.** When its decision date passes, it comes up for release. A named person releases it in
   one tap. The next in line's owner is told, with a drafted email to send. Nothing is released by the clock alone.
6. **Reminders to hold owners.** You decided in October that they are to be on. This design keeps them off until
   the old diary's holds are in, so the trial run you see is on the real holds; they go on after your yes.

**What you and the staff will see.** A page for bringing in the old diary: the report and the matching of rooms,
words and owners, with a button to sign. A page for the sales lead: thirty Saturdays laid out as Venviewer holds
them, line by line, to tick against the old diary. In the Diary: a weekly booking marked as part of its term; a
combined booking on every room it uses; set-up and breakdown as striped time either side; a "Lapsed" list whose
Release button says what will happen before you tap it. Hallkeepers see the same Diary, read only, with set-up shown.

**What it costs.** No new supplier and no new monthly bill. It uses the plumbing's list of work: a short job each
morning for each venue. The build is seven stages; four change the database. The venue's time: a named person signs
the matching for each run, and the sales lead checks thirty Saturdays.

**What waits on the read-only login.** The import itself (turning the old system's export into our file, and
matching its rooms, words and owners), and with it the thirty Saturdays, switching reminders on, public dates and the
plan's "done when". Lapsed holds, rooms sold together, set-up time and terms do not wait for it.

**What you decided, on 16 November 2026** (section 14 has your words).

1. This design: approved.
2. The reminder trial run happens on the real holds, once they are in.
3. A room's dates may show on the public page after the thirty Saturdays are ticked and the venue's admin or
   manager records it.
4. Still to ask you: what the public page shows for a room that is part of a booked combination. We recommend:
   Booked, or Held. It decides only one line of stage 2.
5. A seller may not place a provisional hold. Your 10 October decision stands: only staff and admin write the
   Diary, and sellers ask the office to hold a date.

**What the venue decides** (section 15): which rooms are sold together, how long a hold lasts, standard set-up
times, the office's words, and where a new booking is entered while both diaries run. Until it answers, nothing
changes from today.

## 2. Why, and what this piece is not

A venue will not switch to a diary that does not hold its book, and the plan's first real booking (by 31 January)
cannot go into one (platform plan, section 5.6). The plan's text for this piece is
`docs/superpowers/specs/2026-11-13-platform-plan-design.md:313-320`. The October design's rule stands: the importer
comes first, and no room is shown publicly as "available" or "free" until its forward book is reconciled
(`docs/superpowers/specs/2026-10-18-replacement-map-design.md:62`, `:117`).

**Not this piece:** money and the forward value (piece K, the switching day, which joins its money to bookings by
the old ids this piece keeps); the event page (piece C); the People screens (piece D); sending from the product
(piece F); the planner; the Day Board (open pull requests #361 to #365); the hallkeeper's sheet PDF (#415). Each is
named where this piece meets it (section 16).

## 3. What exists today

**The book.** One table, `bookings`, holds every commitment (`packages/api/src/db/schema.ts:3848-3920`): `kind`
says what it is (interest only, provisional hold, confirmed, house block, viewing), `status` whether it is live
(`:3830-3838`), and a hold carries its option number, joint flag, decision date, owner and next action
(`:3863-3870`). `series_id` is a bare column (`:3871-3873`; no key in `packages/api/drizzle/0050_diary_bookings.sql:45`)
that nothing reads for logic; the API writes whatever a caller sends, on create and on edit
(`packages/api/src/services/booking-mutations.ts:386`, `:522`; `packages/types/src/booking.ts:366`, `:422`). There
is no source column: the only marker, `fixture_source`, is the seed's, and the Pricing desk hides rows that carry it
(`packages/api/src/db/schema.ts:3883-3886`; `packages/api/src/services/pricing-desk-data.ts:186`). The one database
rule against double booking, `bookings_ink_no_overlap`, keeps two live confirmed bookings apart in one room, back to
back allowed (`packages/api/drizzle/0050_diary_bookings.sql:61-76`); holds, house blocks and viewings are outside it.
A refusal becomes `409 INK_SLOT_TAKEN`, chosen by the error code alone
(`packages/api/src/services/booking-mutations.ts:107-118`, `:177-183`). Hold hygiene (decision date, owner, next
action and its date) is an API rule (`:299-314`); an edit that leaves a live hold without one is refused (`:530`).

**The bind.** A hold or confirmed booking cannot exist without its event, of the same venue
(`bookings_bound_to_event`, `packages/api/src/db/schema.ts:3901-3906`). `insertBoundBookings` was written for "the
switching-day importer when it lands" (`packages/api/src/services/event-binding.ts:27-28`, `:421-473`), and the
importer must use it or the cores (`docs/engineering/the-bind.md:38`). It binds each row to the event it names, its
enquiry's event or a new one (`:449-455`), inserts all rows at once (`:469`), then works out each event's status
(`:470`). It records no source, skips the API's hold checks, takes no room lock, gives a new event no client name
(`:456-464`), and one bad row aborts the whole call. A new event takes guest count 0, meaning nobody has said
(`:104-121`). The event's `client_account_id` is a single-column key that nothing writes
(`packages/api/src/db/schema.ts:1676`); the spine pins it to the venue first and expects this import to be its first
writer, "from a person's choice or an import that names its source" (spine, sections 5.1 and 5.8). Lock order:
bookings, then the enquiry, then the event, taken `FOR NO KEY UPDATE`
(`packages/api/src/services/event-binding.ts:41-45`, `:337-350`).

**Rooms.** `spaces` has no idea of a combination or of rooms that cannot be sold together
(`packages/api/src/db/schema.ts:181-202`); the platform roadmap of 26 September leaves the question open
(`docs/design/platform-2026-09-26/roadmap.md:1420`). The cores lock only the booking's own room
(`packages/api/src/services/booking-mutations.ts:353`, `:504`, `:713`), and a room's delete counts only the bookings
filed under it (`packages/api/src/routes/spaces.ts:304-305`). 6.3 lists the readers that learn combinations and those
left on the lead room; any reader it does not name sees a combined booking on its lead room, where it is filed.

**Set-up and breakdown.** Nothing on the booking. Changeover rules between bookings are guidance only
(`packages/api/src/db/schema.ts:3960-3994`; `packages/api/src/services/calendar-conflicts.ts:135-142`); an event's
timed phases find set-up by its name (`packages/types/src/event-phase-graph.ts:46-49`); the planner's handles say
"Setup" and "Clear-down" (`packages/web/src/components/editor/cockpit/when-ribbon-copy.ts:79`, `:82`).

**Holds over time.** "Nothing lapses on the clock" (`packages/types/src/booking.ts:101-108`): a passed hold stays live
on the Decisions due list (`:772-787`; at most 50 holds, `:775`) until staff record its exit, "Mark expired"
(`packages/web/src/pages/diary/board-copy.ts:419`, `:467`), which the notice calls "marked as lapsed"
(`packages/api/src/services/hold-promotion.ts:115`). When a 1st option leaves, the ladder moves up in the same
transaction, re-checking only the hold being moved (`packages/api/src/services/booking-mutations.ts:703-708`), and the
next owner is told in the app with a drafted email: "Nothing is sent automatically"
(`packages/api/src/services/hold-promotion.ts:30-46`). The notice goes to the owner if they still work at the venue
in a hold-owner role, else to the office as a whole (`:208-225`); the draft goes to the event's client account's main
contact, else to the enquirer (`:324-353`).

**Reminders.** Built and switched off. Owners, never clients, are emailed 7, 3 and 1 days before the decision
(`packages/api/src/services/hold-reminders.ts:20-35`), at exact multiples of 24 hours
(`packages/api/src/services/hold-hygiene.ts:16-17`, `:178-193`). The schedule is commented out until Blake has seen a
dry run (`.github/workflows/diary-hold-reminders.yml:14-17`, `:54-55`). The dry run route
(`packages/api/src/routes/admin.ts:170-231`) runs the pass once and lists only reminders whose instant fell in the
last 24 hours (`packages/api/src/services/hold-reminders.ts:61-71`), nothing about later days. Blake has decided
reminders are to be on (`GOAL.md:11`); the dry run is his condition.

**The public door.** A room's dates are public only while a record stands that its whole forward book is on the
Diary; otherwise "Ask the team" (`packages/types/src/booking.ts:187-218`; `packages/api/src/db/schema.ts:6655-6685`).
Only the venue's admin or manager records it (`packages/types/src/forward-book.ts:19-23`), for any of its rooms
(`packages/api/src/routes/forward-book.ts:143-193`). An empty day is then "Nothing on our diary, the team confirms",
never "free" (`packages/types/src/booking.ts:138-147`); the staff Diary's "Go to date" says "Free" with no such gate
(`packages/web/src/pages/diary/board-copy.ts:383`).

**People and owners.** People and organisations carry `source_system` and `source_id`, unique per venue
(`packages/api/src/db/schema.ts:910-925`, `:954-972`); their writer cannot set them, but can set a last contact
(`packages/api/src/services/people-records.ts:120-133`). Records link only on an exact email held by exactly one
person; the rest are suggestions (`docs/superpowers/specs/2026-10-18-people-book-design.md:131-138`). A hold's owner
must be a user at the venue with role staff, admin, manager or sales
(`packages/api/src/services/booking-mutations.ts:143-152`).

**Who writes the Diary.** Staff and admin only, Blake's decision of 10 October
(`packages/api/src/services/booking-mutations.ts:124-130`; the state machine's roles,
`packages/api/src/state-machines/booking.ts:39`; the web's mirror, `packages/web/src/lib/role-capabilities.ts:111`;
a drift test holds them together, `packages/api/src/state-machines/booking.ts:22-25`). Goal 19's table gives creating
a hold to staff, admin and the client's side through its link, not to sales (`goals/19-the-living-timetable.md:69-70`).
The read-only line still says "Read-only · Sales team edits bookings." (`packages/web/src/pages/diary/board-copy.ts:75`).

## 4. Part 1: the old diary brought in

### 4.1 Approaches

**A. Straight in, through the bulk writer,** with a fixed id for each row from its old id. *Why not:* nothing of the
old rows is kept; no review before writing; one bad row stops the run; a row changed later cannot be updated; the
only undo is a backup.

**B. A command like the stock import,** the only importer today (`packages/api/src/scripts/import-venue-stock.ts`: a
dry run by default, fixed ids so a re-run replays, apply only with a named backup; `:141`, `:159-163`, `:347-351`).
*Why not:* the report and the signature would live on an operator's machine that holds the production address,
where the venue's people cannot see them, and the check and the undo need records in the database anyway.

**C. A place in the database for each run, worked through API routes (chosen).** The rows kept as they came; the
matching kept as a signed record; a plan reported row by row; the signed plan written in small steps through the
bind, each row's result recorded; an undo that reads those records. *Costs:* six new tables and three columns each
on bookings and events. It is the shape of the People Book's own import
(`docs/superpowers/specs/2026-10-18-people-book-design.md:191-200`), which can use the same tables later.

### 4.2 The file in between

The old system is unseen, so the import reads a plain file whose columns we define. One small converter, written
once we can see the export, runs in the browser on the import page and turns the export into this file, so the raw
export never reaches Venviewer, as in the People Book's import
(`docs/superpowers/specs/2026-10-18-people-book-design.md:182-185`). It only picks and renames columns, never
translates a value; all translation happens in the signed matching (4.3).

The file: UTF-8 text, one header row, comma separated, double quotes around any cell that needs them. One row for
each booking in each room for each unbroken span of time. Every cell is read as text.

| Column | Required | What it holds |
|---|---|---|
| `source_system` | yes | A short name for the old system, the same on every row of a file, at most 40 characters (the People Book's column width) |
| `source_id` | yes | The old system's own id for this row, exactly as given. Compared exactly; letter case kept. Unique in the file, and the same in every export. Where the old system gives one row per day of one record, the converter builds the id from the record's id and the day, and that rule is written down with the converter |
| `occasion_id` | no | The old system's id for the whole piece of business. Rows that share it become one event |
| `room` | yes | The room as the old system names it |
| `starts_at`, `ends_at` | yes | Either an instant with its offset (`2027-03-27T22:00:00+00:00`), or the venue's wall-clock time with no offset (`2027-03-27T22:00`). A date alone means "no times given" |
| `status` | yes | The old system's own status word |
| `option`, `joint` | no | The old system's own option number or label, and its own mark for a joint option |
| `decision_at` | no | When the client must decide, written as `starts_at` is |
| `owner` | no | The old system's owner as it gives it: a name, an email or its own user id |
| `title`, `event_type` | title yes | The booking's name and kind of event, as written |
| `setup_minutes`, `breakdown_minutes` | no | Whole minutes, where the old system records them |
| `next_action`, `next_action_due` | no | The old system's own follow-up, where it has one |
| `client_kind` | no | `organisation` or `household`, where the old system says |
| `client_org_id`, `client_org_name` | no | The organisation's id and name in the old system |
| `client_person_id`, `client_person_name`, `client_email`, `client_phone` | no | The main contact for the booking in the old system |
| `deleted` | no | The old system's own "deleted" mark, if its export has one |

There is no money column and no free-text notes column. A file with any other column is refused, so a typing
mistake in a header cannot drop data without anyone noticing. A value longer than its column holds (a title of 200
characters, an event type of 80, a next action of 500: `packages/api/src/db/schema.ts:3859-3860`, `:3869`) is
refused with a reason, never cut.

### 4.3 The steps

1. **Stage.** The page sends the file's rows to the API a few hundred at a time (4.6). Each line becomes a staged row:
   each cell as read, the line's number and a fingerprint of its contents. A row whose client is a person since
   erased, or that is already known to be left out (ended before today, or marked deleted), has its personal cells
   blanked as it is staged (4.8). Nothing else is written. The batch records the file's name and fingerprint and the
   converter's version.
2. **Plan, the dry run.** The plan reads the staged rows, the current matching and the Diary as it stands, in one
   read-only transaction, and gives every row one outcome, with a plain reason:
   - **make**: a new booking will be written;
   - **update**: the old diary changed this row since it was last brought in, and nobody here has touched it since;
   - **link**: a person chose "Link it" for a row that may already be here; the old id is written onto that booking;
   - **exit**: a booking brought in before whose old status is now one the matching maps to an exit (released,
     lapsed, lost or cancelled); it takes that move, by the person who applies;
   - **unchanged**: nothing to do;
   - **left out**: never brought in, and its status is matched to "leave out" (lost, turned down, cancelled), it
     ended before today, or the old system marks it deleted;
   - **held for a person,** nothing written: it may already be here (a booking in Venviewer with no old id, in the
     same room or a combination that uses it, overlapping in time, with the same client or the same title), until a
     person chooses "Link it" or "A different booking"; it changed in both places; its status moved in a way the
     Diary does not allow (confirmed back to provisional); or it has gone from the old diary while still in the
     future (a row that has passed and left the export is not listed);
   - **refused**: a room, status or event type with no match; a hold whose owner has no match and no default owner;
     no times; a wall-clock time that happens twice or not at all (01:00 to 01:59 on 31 October 2027 happens twice;
     on 28 March 2027 it does not happen); an end not after its start; a value too long; a provisional hold with no
     decision date; an option number on something that is not a hold; a clash with another confirmed row in the
     file (both are refused and listed together); a clash with a confirmed booking already in Venviewer, directly,
     through a combined room, or through set-up and breakdown; a client who is a person since erased;
   - **flagged, without stopping the row:** two 1st options on one date that are not marked joint; a client who may
     be someone already in the People Book; two events that may be one occasion (the same client, overlapping
     dates), which go on the spine's list of joins to check (spine, section 5.6) and are never joined by guess.

   The report gives counts by outcome, by reason, and by month and status, so the venue can set them beside the old
   system's own report, and lists every clash. The plan uses the same rules as the database (sections 6 and 7); the
   database stays the final judge when the rows are written.
3. **Match and sign.** On the import page, the venue's admin or manager sees each old room name, status word, event
   type, option label and owner, and its match: a room or a combination; Confirmed, Provisional, Interest only, House
   block or leave out, and for an old exit status the move a booking already here takes; a Venviewer event type or
   "keep as written"; an option number; a member of staff, with an optional default owner for unmatched holds. The
   held rows and the exits are listed by name, and the "Link it" choices are made here. Each change makes a new
   version and a fresh plan. When the report reads right, they sign: who, when, the matching's version and a
   fingerprint of the exact plan they saw. A signed matching cannot be changed.
4. **Apply.** A named staff member or admin at the venue taps Apply, and the API writes the stored, signed plan,
   step by step. Before the first step it refuses unless the batch is signed, the matching is still the signed
   version, the stored plan still matches the signed fingerprint, and a backup has been recorded. Each row is then
   written as planned and checked again as written (its room live, its owner at the venue, a booking it updates as
   the plan saw it), and the database judges every clash; a row whose outcome would now differ is refused and
   listed, the rest go in. Each row's result is saved with its write, so a stopped apply carries on with the rows
   not yet done, with no new signature. The Diary's open boards are told once a step commits.
5. **Check.** The sales lead's thirty Saturdays (4.7).
6. **Undo.** Only the latest batch for a source can be undone, as the People Book's design says
   (`docs/superpowers/specs/2026-10-18-people-book-design.md:198-200`). Undo sets the deleted date of each booking
   the batch made that nobody has touched since; puts back the times, room, option, decision date, owner and title of
   each booking it updated, where nobody has touched it and the old values still fit (one that would now clash is
   refused and listed); and takes the old id off a booking it linked. It does not reverse a change of status: that is
   listed. It removes each event the batch made once nothing is left on it, and lists any other event left with no
   live booking, whose status nothing would change (`packages/types/src/event-binding.ts:140-146`). Anything a person
   changed is left, and named in the report. Where a removed hold leaves others, the ladder is put back in order: a
   hold the batch made moves up with no notice; any other hold that becomes 1st option gets the normal notice, since
   a promotion of real business is never silent (`packages/api/src/services/hold-promotion.ts:30-34`). People the
   batch made stay in the People Book; the next run matches them again by their old id. Undo run twice changes
   nothing.
7. **Run again.** Until the switch the office keeps taking bookings in the old diary, and each new export is a new
   batch, matched on old ids, with the outcomes of step 2. Nothing is deleted because it is missing. Where the office
   enters a new booking first, while both diaries run, is the venue's choice (section 15, question 7).

**Who may do what** (the routes in 4.6 carry each role). Applying is a named staff member or admin at the venue,
signed in as themselves, since only they write the Diary (`packages/api/src/services/booking-mutations.ts:130-134`).
Signing is the venue's admin or manager, with no shortcut for a platform admin, for the forward-book record's reason:
they know the venue's own diary (`packages/types/src/forward-book.ts:19-23`). Undoing is the venue's admin, because
undo writes bookings and a manager may not (`packages/api/src/services/booking-mutations.ts:417`). Hallkeepers do not
see the staged cells, which hold client emails and phones.

### 4.4 How imported rows meet the event, people and owners

**Wrap `insertBoundBookings`, and leave it unchanged.** The spine says the import goes through it unchanged (spine,
section 10), and the spine's first stage edits the bind itself, so two lanes editing one function would collide. Its
contract (all or nothing, insert only) suits its other callers; the import's duties (source, grouping, room locks,
report, undo) are the import's. The wrapper uses the exported checks (`holdHygieneIssues`, `ownerWorksAtVenue`,
`lockLiveRoom`) and copies none.

Each step of the apply, in this order:

1. **People first, in their own transactions,** in the People Book's lock order. For each client: find the
   organisation or household and the main contact by their old id; else by an exact email held by exactly one live
   person at the venue; else make them, with their old id (the People Book's writer gains an optional source). Each
   old id met is recorded in `import_people` (4.5). A new person's last contact is the latest end among their
   imported bookings, so the 24-month clock runs from their last booking, never from the import
   (`packages/api/src/services/people-records.ts:131`). A possible duplicate is made as new and appears on the People
   Book's list of suggestions. Nothing merges silently.
2. **Then the bookings, one small transaction per step,** its rows sorted by room and start. Lock every room the step
   writes to, every part of a combination included, in id order, with `lockLiveRoom`. For each occasion: find its
   event by its old id (following a merge to the event it now belongs to), else make one with
   `bindBookingToEvent(tx, seed, { join: "new" })` (`packages/api/src/services/event-binding.ts:155-195`), passing
   the client's name, which the seed accepts (`:59-60`), and record the occasion's old id on the event. Then call
   `insertBoundBookings` with every new row naming its event and carrying its source and batch, so the bind only
   joins. Updates and exits go through `updateBookingCore` and `transitionBookingCore`; an exit's history note says
   "From the old diary, batch N", so nobody reads it as their own tap (`packages/api/src/db/schema.ts:3954`). Rows
   that share no occasion id each get their own event.
3. **Last, the event's client account,** where it is empty, from the import's own named source: after
   `insertBoundBookings` and its status sync, so the step takes the event after its bookings, as every writer does.
   This needs the spine's first migration, which pins that key to the venue first.
4. **Before commit,** the bind's two counts (`readBindInvariant`,
   `packages/api/src/services/event-binding.ts:517-548`) are read over only the bookings and events the step
   touched, and both must be zero. Counting nothing else keeps the step from being stopped by an unrelated fault at
   the venue, by a record another writer commits meanwhile, or by the spine's list of joins while it is not yet empty
   (spine, section 6). The count gains a scope of ids beside its venue scope (`:517-519`), added in stage 4 after the
   spine's first stage, which edits that file.

If the database refuses a step (another person confirmed the same room a moment earlier, or two writers met in a
deadlock, `40P01`), the step is rolled back and written again one row at a time, each in its own savepoint, an
occasion's new event made inside its first row's savepoint: a refused row is named, leaves no empty event, and the
rest go in. **Locks** follow the full order in 6.2: the batch's row first, then its rooms, then its bookings, the
event last. The import names no enquiry, so it takes no enquiry lock.

**Owners.** Every live hold must leave the import with its four hygiene fields, or every later edit would first
have to supply them (`packages/api/src/services/booking-mutations.ts:530`). Its owner comes from the signed
matching, or its default owner, and must work at the venue (`:145-152`). A confirmed booking or house block whose
owner has no match comes in with no owner: only holds need one (`:299-314`). The decision date comes from the row; a
hold without one is refused. The next action comes from the row, else the venue's default wording (section 15,
question 6), due on the row's date, else the decision date. **Option numbers** come in as the old diary has them;
duplicates are flagged, and the ladder repairs itself on the next exit, as today. **Not written:** no enquiry (it
would count in the funnel and the People Book), no status history for a new booking (the cores write none for a
create), nothing about money.

### 4.5 The places in the database

- `import_batches`: the venue, source system, file name and fingerprint, converter version, state (staged, planned,
  signed, applying, applied, undone, abandoned: 4.8), the signed matching version and plan fingerprint, who signed
  and when, who applied, the backup recorded, who undid, and counts. Never a personal detail.
- `import_rows`: the batch, venue, line number, old id, cells as they came and their fingerprint, the plan's outcome
  and reason, a person's choice for a held row, the booking made, matched or linked, the id of the person matched, a
  fingerprint of what the import wrote (so a later edit here can be seen), the values an update replaced (for undo),
  and the applied result.
- `import_mappings`: the venue, source system, version, the matches (rooms, statuses and exits, event types, options,
  owners, the default owner, the default wording), who wrote it, who signed it and when. A signed version cannot change.
- `import_people`: for each old person or organisation id met, a hash of the venue, source system and old id, and the
  person or organisation matched or made. It names nobody by itself, and it outlives an erasure (4.8).
- `import_checks`: one for each venue, naming its sales lead (`sales_lead_user_id`), who named them and when, and
  the check's first Saturday (section 15, question 11). `import_day_checks`: the Saturday ticks (4.7).
- `bookings` and `events` each gain `source_system`, `source_id` (both or neither, as on people) and
  `import_batch_id`; the pair is unique per venue among rows not deleted, so one old row cannot become two live
  bookings or two events.

Every table carries its venue and uses the house's `(id, venue_id)` keys, so a batch of one venue cannot point at
another venue's room or booking. A user row has no such key (`packages/api/src/db/schema.ts:208-233`), so an owner
or sales lead is checked as a hold's owner is: a user of the venue in a hold-owner role
(`packages/api/src/services/booking-mutations.ts:143-152`), when named and again when written or counted.

### 4.6 Routes and screens

The import runs as API routes, each a short transaction, called in turn by the import page, which shows progress with
the house's activity component (`packages/web/src/components/shared/Activity.tsx`). No operator's machine holds the
production address, and the API's checks and logs apply, as for the reminder workflow
(`.github/workflows/diary-hold-reminders.yml:10-11`). All but the last are under `/venues/:venueId/diary-import`.

| Route | What it does | Who |
|---|---|---|
| `POST /batches` | Open a batch: source system, file name and fingerprint, converter version | admin, manager, staff |
| `POST /batches/:batchId/rows` | Stage the next few hundred lines; a part sent twice is kept once, by line number | admin, manager, staff |
| `GET /mappings/:sourceSystem`, `PUT` the same | Read the current matching; save a new version | read: admin, manager, staff; save: admin, manager |
| `POST /batches/:batchId/plan` | Work out the plan, the dry run | admin, manager, staff |
| `GET /batches/:batchId`, `GET /batches/:batchId/rows` | The report, and its rows by outcome, a page at a time | admin, manager, staff, sales |
| `POST /batches/:batchId/rows/:rowId/choice` | "Link it" or "A different booking", for a row that may already be here | admin, manager, staff |
| `POST /batches/:batchId/sign` | Sign the matching's version and the plan's fingerprint | admin, manager |
| `POST /batches/:batchId/apply` | Apply the next step; called until done | staff, admin |
| `POST /batches/:batchId/undo` | Undo the next step; called until done | admin |
| `PUT /sales-lead` | Name the person whose ticks count for the check: a user of the venue in a hold-owner role | admin, manager |
| `GET /saturdays`, `POST /saturdays/:date` | The thirty Saturdays; a tick, "Same" or "Something differs" with a note | read: as the report; tick: admin, manager, staff, sales |
| `POST /admin/diary-import/batches/:batchId/backup` | Record the backup taken before the apply | Venviewer operator |

The screens: the import page (report, matching, signature, apply and undo, each room ready or not and why, section 9)
and the thirty-Saturday page.

### 4.7 The side-by-side check, for the sales lead

The test is the sales lead checking thirty forward Saturdays against the old diary, so the check is a page built for
that, not a count that says "matched".

- The next thirty Saturdays, each from 04:00 that morning to 04:00 on Sunday, the Diary's own day
  (`packages/api/src/services/public-discovery.ts:80`), so a wedding that ends at 01:00 is on Saturday's card.
- For each, every live booking and hold that day, room by room, in time order: times, Confirmed or Provisional with
  its option, title, owner, decision date and old diary reference; under each line, in small type, the old diary's
  own values as they came, so a matching slip shows on the line. Below: every row for that day that was left out,
  held or refused, with the reason.
- She opens the old diary beside it and taps "Same as the old diary" or "Something differs", with a note. The page
  records who ticked each Saturday and when, and keeps a fingerprint of the day's lines: a later change shows "changed
  since you checked".
- The check is met when all thirty stand as "Same" by the ticks of the sales lead the venue has named, none stale.
  Others' ticks are shown, and do not meet it.

Comparing the import with its own copy of the old rows would only prove it agrees with itself; a mistake in the
converter would pass. Her eyes on the old system are the outside proof.

### 4.8 Personal data

- Staged rows keep names, emails and phones only while they are needed. A row already known to be left out (ended
  before today, or marked deleted) is blanked as it is staged; at signing, every other row the matching leaves out
  (lost, turned down) is emptied. The rest are emptied once a newer batch for the source is applied, or the switch
  is complete (piece K). What stays is the old ids, the fingerprints and the outcomes. No notes and no money are
  ever sent (4.2).
- **Abandoned batches.** Signing a batch abandons every earlier batch for its source that is staged, planned or
  signed and not yet applying. The nightly cleanup abandons a batch not signed within the venue's limit (section 15,
  question 10), with a count only in its public log, as its allergy-note passes do
  (`packages/api/src/scripts/run-cleanup.ts:21-25`). An abandoned batch cannot be planned, signed or applied, and
  its personal cells are emptied as it is abandoned.
- An erased person never comes back: a staged row whose client's old id leads, through `import_people`, to a person
  since erased or no longer there is blanked as it is staged, and refused, whatever the erasure did to the person's
  own source columns.
- Each staged row carries its venue and the id of the person matched, so erasing a person (#247, and piece I) finds
  it exactly, not by matching text. That erasure work needs to include these rows.
- Reports, counts and test data in the repository or a workflow log never carry a client's name; details are on the
  page behind sign-in, as the reminders' workflow already does (`.github/workflows/diary-hold-reminders.yml:38-42`).

## 5. Part 2: a regular hirer's term

### 5.1 Approaches

**A. Keep only the rule, and work out the nights when read** (the calendar standard's way). *Why not:* no rows for
the database's rule to compare, every reader works the nights out, and the bind needs a row for each held night.

**B. Copies with no rule,** as one sales-and-catering system's help describes copying a booking's events by date
(Amadeus, read 14 November). *Why not:* nothing remembers the pattern, so "change later weeks" becomes guesswork.

**C. The rule, and every night a real booking linked to it (chosen).** The database's rule works on each night; the
rule lets the term be extended, changed from a date, or finished early. *Costs:* a table; `series_id` becomes a key.

### 5.2 What is stored

- `booking_series`: the venue, a title, the room (or a combination), Provisional or Confirmed, the event type, the
  weekdays, the first and last date, weeks apart (one to four), start and end time on the venue's clock (an end at or
  before the start means the next day), set-up and breakdown minutes, the time zone (copied from the venue,
  `packages/api/src/db/schema.ts:139`), the dates skipped before they were written, and, for a provisional term, its
  one decision date, owner and next action. A term is at most 366 days, the Diary's longest read
  (`packages/types/src/booking.ts:649`); every term ends. It stores no event: its event is any live night's.
- Each night is an ordinary booking with `series_id` (now a key to the term, pinned to the venue) and `series_date`,
  its original date; the pair is unique among rows not deleted, so a term saved twice writes each night once. A
  moved night keeps its original date, so it is still "the 3 November night" (RFC 5545's `RECURRENCE-ID` rule).
- `seriesId` leaves the public create and edit schemas (`packages/types/src/booking.ts:366`, `:422`); only the term
  code sets it, always with `series_date`.

### 5.3 How the nights are made, and the clock

Each night is the venue's wall-clock time on that date, in the venue's own zone, never a fixed number of hours after
the last: 19:00 on Saturday 20 March 2027 and on 3 April 2027 is 19:00 and 18:00 universal time. A night that falls
in an hour the clocks skip or repeat is shown to the person entering the term, who chooses; it is never moved silently.

### 5.4 Entering a term, and what each person sees

- **Entering.** In the Diary, "New weekly booking": room, weekdays, times, first and last date. Before saving, the
  Diary shows every night: clear; "you would be 2nd option"; taken by a confirmed booking; under a house block; the
  clocks change. For each problem night the person skips it, picks another room or time, or, under a house block,
  keeps it, as a single booking may be. One save writes every night in one transaction, sorted by room and start, or
  none: a night taken a moment earlier is named, and the preview refreshes.
- **One term, one event.** The term is one piece of business with one client and, later, one agreement: the spine's
  agreements may name only their own event's bookings (spine, section 8.2), and the bind already puts an enquiry's
  bookings in one event (`packages/api/src/services/event-binding.ts:31-35`). The first night makes or joins the
  event and the rest name it.
- **The hallkeeper's sheet** takes the earliest live booking of the event in its room
  (`packages/api/src/services/hallkeeper-sheet-v2-data.ts:513-524`), so a term would show its first night for ever.
  The fix takes the earliest not yet ended, after #400, which changes that file (6.3, 16).
- **Changing it.** From any night's drawer: "Change this night only" (an ordinary edit, shown as changed from the
  term); "Change this and later nights" (later nights that still match move in one transaction; nights changed by
  hand are listed and left); "Skip this night" (cancelled, or released if provisional); "Finish the term early"
  (later nights listed, then ended in one transaction). "Confirm the term" confirms every live provisional night in
  one transaction, or none, naming any night in the way. A provisional term lapses and is released as one (8.3).
- **The term is the only writer of its hold fields.** A provisional night's decision date, owner and next action
  are the term's: `updateBookingCore` and `transitionBookingCore` refuse a change to any of them on a night, and the
  term's own change ("Extend a week" included) writes the term and every live night in one transaction.
- **Who sees what.** Those who write the Diary enter and change terms, as for any booking. The sales lead sees the
  term in its own panel: its pattern, each night, and which nights differ. The hallkeeper sees each night as an
  ordinary booking, marked "Weekly, 4 of 12".
- **Routes.** `POST /bookings/series` (with `preview: true`, the preview; without, the save) and
  `POST /bookings/series/:seriesId/change` (this and later, skip, finish early, confirm, extend, release). Saving is
  a new Diary command, `series.save`, beside create, update and transition
  (`packages/api/src/services/diary-commands.ts:176-182`), so it takes the same `Idempotency-Key` and ledger
  (`packages/api/src/routes/bookings.ts:115-121`): a double tap saves once, and the open boards are told once.

Imported regular hirers arrive as single bookings, each correct in the book; grouping them into terms is not this
piece.

## 6. Part 3: rooms sold together

### 6.1 Approaches

**A. Book each part separately, in one go,** so today's rule works as it is. *Why not:* one sale becomes several
bookings, each with its own option, ladder, reminders and decision; moving one and not the others is easy; and
nothing stops someone booking the parts one at a time and forgetting one, which is how a room gets sold twice.

**B. A trigger that checks overlaps across a room's family**, with locks in a fixed order. *Why not:* a hand-written
check under concurrency is harder to prove than a constraint the database keeps by itself.

**C. Each booking writes, through the database itself, a claim on every room it uses, and the database refuses two
claims that overlap (chosen).** One sales-and-catering system's help describes the same rule: a combination cannot
be blocked while any part is, and blocking it blocks every part (Amadeus help, "Conflict checking", read 14
November). One sale stays one booking; every writer gets the rule for free; the same claims carry set-up and
breakdown (section 7). *Costs:* a table and a trigger on `bookings`, and the room-by-room readers learn claims.

### 6.2 The change

- `room_combinations`: the venue, a name ("Grand Hall and Saloon", if the venue says so), the lead room a combined
  booking is filed under (one of its parts), when it was retired, who made it; `room_combination_parts`, at least
  two rooms. A retired combination takes no new booking; parts cannot change under a live booking (retire and remake).
- `bookings.combination_id`, with a key on the combination and its lead room, so a combined booking is filed there.
- `booking_room_claims`: for every live provisional hold, confirmed booking and house block, rows for each room it
  uses (the room alone, or every part): one for its own times, and one each for its set-up and breakdown bands (none
  for 0 minutes). Each row carries the booking's event. Rows of confirmed bookings block.
- **The rules,** two exclusion constraints on the claims, of the same kind as today's
  (`packages/api/drizzle/0050_diary_bookings.sql:61-76`), using the extension already installed (`:19`): no two
  blocking claims of booked time overlap in one room; and no two blocking claims of different events overlap in one
  room. So bookings of one event are exempt from each other's set-up and breakdown, never from each other's booked
  times: a ceremony and the dinner after it may share the turn-round of their room.
- **A trigger keeps the claims true.** After any insert or change of a booking's room, combination, times, set-up,
  breakdown, kind, status, event or deleted date, it rewrites that booking's claims. It first takes the
  combination's row `FOR SHARE` and refuses a retired one; changing a combination's parts, or retiring it, takes that
  row `FOR UPDATE`, so the two never miss each other. The constraints and the trigger are immediate, never deferred:
  the Diary's commands rely on a refusal arriving inside the core's savepoint
  (`packages/api/src/services/diary-commands.ts:101-108`, `:168-185`).
- **Every part is locked.** Every writer of a combined booking takes every part with `lockLiveRoom`, in id order,
  before it writes. A room's delete counts the live claims on it as well as the bookings filed under it, so a part
  cannot be deleted under a confirmed combined booking.
- **The full lock order,** for every writer: (1) an import batch's row; (2) bookings, a ladder in id order
  (`packages/api/src/services/booking-mutations.ts:679-691`) or many rows sorted by room and start; (3) the
  combination, `FOR SHARE`, in the claims trigger as each booking is written; (4) a term's row; (5) the proposal,
  the enquiry and the deal, in the spine's order (spine, section 5.4); (6) the event, last, with the status sync's
  lock (`packages/api/src/services/event-binding.ts:41-45`). Rooms stand outside it, taken `FOR KEY SHARE`
  (`packages/api/src/services/room-liveness.ts:19-24`): before the bookings in a create and an import step, after
  them in an update and a transition (in `packages/api/src/services/booking-mutations.ts`: `:353`; `:442` then
  `:504`; `:679-703` then `:713`). Both are safe: key-share locks never wait for each other, and the one stronger
  room lock, a room's delete, takes the room `FOR UPDATE` and then only counts
  (`packages/api/src/routes/spaces.ts:297-317`). A parts change or retirement takes the combination `FOR UPDATE` and
  only reads bookings, so it closes no cycle either.
- **Many rows at once.** A term's save, "Change this and later", "Confirm the term" and an import step write their
  confirmed rows sorted by room and start. Every writer treats a deadlock (`40P01`) as a clash: a writer of many rows
  tries once more, then names the night; the cores answer 409 "try again", not a 500, since today they catch only
  the refusal's code (`packages/api/src/services/booking-mutations.ts:401-404`, `:428-431`, `:862-866`).
- **A refusal says what is taken.** The cores read the constraint's name as well as the code: today's words for
  `bookings_ink_no_overlap`, which stays as it is; for the claims, the room taken and when, so a set-up overlap is not
  reported as someone else confirming first.
- House blocks and holds get claims but do not block, as today.

### 6.3 Holds, ladders and the readers that work room by room

A hold on the whole sits on its lead room's ladder, a hold on a part on the part's: the ladders stay by room, as
today (`packages/api/src/services/booking-mutations.ts:674-691`, `packages/api/src/services/window-proposals.ts:96`,
`packages/api/src/services/hold-promotion.ts:371`). The Diary shows them side by side as contested, and a hold that
crosses a confirmed booking through a part gets today's warning that it cannot be confirmed while that stands.

| Reader | What changes | Stage |
|---|---|---|
| The Diary's read of its lanes (`packages/api/src/routes/calendar.ts:272`) | Reads claims, so a combined booking is drawn on every room it uses: in full on the lead room, lighter on the others, with the combination's name | 2, after #400 |
| The conflict engine (`packages/api/src/services/calendar-conflicts.ts:252-268`) | Reads each booking's rooms from its claims, so overlaps across parts are reported | 2, after #400 |
| A time move's neighbours (`packages/api/src/services/decisions.ts:226`) | The same | 2, after #400 |
| The room's day on the When ribbon (`packages/api/src/services/room-day.ts:94`) | Shows a combined booking on each part | 2 |
| A room's delete (`packages/api/src/routes/spaces.ts:304-305`) | Counts live claims | 2 |
| The hallkeeper's sheet timing (`packages/api/src/services/hallkeeper-sheet-v2-data.ts:513-521`) | Finds a combined booking from a part's layout; for a term, the next night (5.4) | 2 and 5, after #400, agreed with its owner |
| A layout's review facts (`packages/api/src/services/pending-review-facts.ts:95`, `:117`) | Finds a combined booking from a part's layout, as the sheet does | 2 |
| The Pricing desk and the occupancy report (`packages/api/src/services/pricing-desk-data.ts:196-199`, `packages/api/src/routes/revenue-analytics.ts:379`) | Read claims, so a combined booking is demand on every room it uses | 2 |
| What one booking shows a client or a supplier: the client's schedule (`packages/api/src/services/client-event-schedule.ts:129`), passes (`packages/api/src/services/supplier-passes.ts:99-101`), a client's request (`packages/api/src/services/requests.ts:448-450`), an observation (`packages/api/src/services/observations.ts:80`) | Stays on the lead room, where the booking is filed; where a room's name is shown, a combined booking shows its combination's name | 2 |
| The public read (`packages/api/src/services/public-discovery.ts:627`) | Counts a booking against every room it uses, as Blake decides (decision 4) | 2, last |
| The Day Board (#361 to #365) | Shows a combined booking on its lead room only, until its owner reads claims | its owner |

**Defining combinations** is a venue admin's task, beside the rooms (`/venues/:venueId/room-combinations`: list,
make, retire). **Rooms that may not be sold to two clients at once** are asked about (section 15, question 1), not
built; the claims can carry that later.

## 7. Part 4: set-up and breakdown either side

### 7.1 Approaches

**A. Longer booking times.** *Why not:* the event's and the client's times would be wrong; the plan says never as a
longer event. **B. The event's timed phases.** *Why not:* they are the planner's timetable, in no database rule, and
set-up is found by its name (`packages/types/src/event-phase-graph.ts:46-49`). **C. Bookings of a new "set-up"
kind.** *Why not:* twice the rows, moving together, and a new kind for every reader. **D. Minutes either side, on the
booking, feeding the claims of section 6 (chosen):** shown as their own band, blocking the room in the database,
with the booking's and the event's times unchanged.

### 7.2 The change

- `bookings.setup_minutes` and `bookings.breakdown_minutes`: whole minutes, 0 to 1,440, the changeover rules' range
  (`packages/api/src/db/schema.ts:3986`), 0 when nobody has said. A room's standard minutes, once the venue gives
  them, are offered for a new booking there (two columns on the room, empty until then).
- **They block the room.** A confirmed booking's bands may not overlap another event's confirmed booking or bands in
  one room; back to back stays legal; one event's bookings are exempt from each other's bands (6.2). Staff may change
  the minutes on one booking, which is how a tight changeover is made to fit: an explicit edit, never silent.
- The event's dates still follow the bookings' own times (`packages/api/src/services/event-binding.ts:214-223`).
- **What people see.** The drawer gains "Setup" and "Clear-down" in minutes (or the venue's words, section 15); the
  Diary draws them as labelled striped bands either side, never as part of the booking.
- **Left alone:** the changeover rules and their warning, which still measures the gap between booked times, and the
  event's phases. The venue may want shorter changeovers once set-up is recorded (section 15, question 3).

## 8. Part 5: a hold that lapses, and reminders on

### 8.1 What "lapsed" means, and who decides

- **Lapsed:** a live provisional hold whose decision date has passed. Nothing is stored to say so; it is worked out
  when read, so a decision date moved later takes the hold straight off the list.
- **The venue's rule** (section 15, question 2): a new hold's decision date starts that many days after it is placed;
  a later date needs a reason, kept on the hold with who gave it. Imported holds keep the old diary's dates until
  their date is next changed. Until the venue sets a rule, decision dates work as today and no reason is asked.

### 8.2 Approaches

**A. A job for each hold, due at its decision moment.** *Why not:* seven writers of a decision date to change (the
three cores, an enquiry's first hold, the client's proposed time, the import and the term), several in files other
open pull requests are changing.

**B. One job each morning for each venue, on the plumbing's list (chosen).** It writes one notice for each live hold
whose decision date has passed and which has no notice yet for that decision date. A record of each notice (the hold,
or its term, and the decision date, unique together) makes a second run write nothing, with no window to work out,
so an imported hold already past its date, or one moved back into a day already run, is still noticed. It only
changes our own database, so its notices and its completion commit together (plumbing, section 5.2). It reads the
database once a morning, which is not polling: a sweep every 15 seconds once "kept the production database awake
around the clock" (`packages/api/src/services/escalation-scheduler.ts:12-13`).

**C. Release automatically at the decision date.** *Why not:* Blake's rule of 18 October: "confirming a date,
releasing a hold or a refund waits for one tap by a named person"
(`docs/superpowers/specs/2026-10-18-replacement-map-design.md:63-65`).

### 8.3 What happens

1. **The moment the decision date passes,** the hold appears at the top of the Diary's Decisions due list under
   "Lapsed". Nothing is needed for this but a read; it can ship first.
2. **Each line says what one tap will do,** before it is tapped: "Release: the Fraser wedding becomes 1st option;
   Alex is told, with a draft to send." (made-up names). Then two buttons: **Release** and **Extend a week** (the
   Diary's existing extension, `packages/web/src/pages/diary/lib/extend-decision.ts:4-10`; with a reason if the
   venue's rule needs one). The sentence beside the button is the confirmation; there is no second box.
3. **The tap sends the promotions the person read.** Release records the hold as `released`, as the drawer's Release
   does (`packages/web/src/pages/diary/board-copy.ts:466`), by the person who tapped, through the existing
   transition, which staff and admin may make (`packages/api/src/state-machines/booking.ts:46`;
   `packages/api/src/services/booking-mutations.ts:664-669`). The history's note, written by the server from the
   hold, says it had lapsed: its decision date had passed (`packages/api/src/db/schema.ts:3954`). Under the ladder's
   locks it works the promotions out again; if they differ from those sent, it writes nothing and answers "This
   changed: here is what Release will do now". Otherwise the ladder moves up in the same transaction, as for any
   exit, and the next in line's owner is told in the app that the hold was released, with a drafted email to send,
   exactly as built (`packages/api/src/services/hold-promotion.ts:30-46`, `:113-117`); for an imported hold, the
   draft goes to the client account's main contact the import recorded (4.4).
4. **A release and a confirmation at the same moment:** the existing check on the row's state lets one through and
   tells the other that the booking has just changed (`packages/api/src/services/booking-mutations.ts:703-708`).
5. **The next morning,** once the plumbing's list exists, the morning job tells the hold's owner in the app that it
   has lapsed, if they still work at the venue in a hold-owner role, otherwise the office as a whole: the rule
   promotion notices already use (`packages/api/src/services/hold-promotion.ts:208-225`). No email.
6. **A provisional term is one hold to the people working it:** one line on the Lapsed and Decisions due lists, one
   lapse notice, one reminder each morning one is due; "Release the term" exits every live night in one transaction,
   sorted by room and start, with one promotion notice for each term or single hold that moves up; "Extend a week"
   moves the term's decision date and every live night's in one transaction (5.4).
7. **Nothing is ever released by a timer.** No code but a person's transition ends a hold (test 34).
8. **Who may tap:** those who write the Diary at the venue: staff and admin. Sellers do not (decision 5, answered
   no on 16 November).

### 8.4 Reminders on

- **The day, not the hour.** A reminder goes "on the morning seven days before the decision date, by the venue's
  calendar", not "exactly 168 hours before": from one morning run, an instant later in the day, or moved by a clock
  change, would go a day late (test 39). The plumbing leaves this choice to this piece; stage 7 replaces the
  plumbing's test 11 (exactly 168 hours) with test 39, and asks for its section 5.2 reminder row to name a term's key.
  A reminder whose morning has passed is not sent late. Each key stays as it is
  (`packages/api/src/services/hold-reminders.ts:165-170`), so nothing sent is sent again; a term's is keyed by the term.
- **The trial run is on the real holds.** Today's dry run lists only what is due at the moment it runs
  (`packages/api/src/routes/admin.ts:221-229`): a handful of lines, by a rule that will not run. Once reminders count
  calendar days, it gains a forward list: for every live hold, each morning a reminder will go and to whom, sending
  nothing. After the import is applied, that list is run against production and put in front of Blake privately,
  never in the repository or a workflow log.
- **Then the schedule.** On Blake's yes, reminders become a second daily kind on the plumbing's list, at the
  office's morning; GitHub's commented-out schedule is never switched on (plumbing, section 6, step 5). Until the
  list exists, only the Lapsed list runs, and the workflow is a dry run by hand.

## 9. The public door

- **When a room's forward book counts as reconciled:** the latest batch for the old diary is applied with nothing
  refused or held for that room on a future date, and, as Blake decided (decision 3), the thirty
  Saturdays stand as "Same", none stale. The import page shows each room as ready or not, and why.
- **Who records it:** the venue's admin or manager, on the existing control
  (`packages/api/src/routes/forward-book.ts:143`); the product never records it by itself. At a venue that has
  brought in an old diary, the control refuses a room the import page shows as not ready, and says why; elsewhere it
  works as today. One sentence is added: recording it means every new booking for this room goes into Venviewer first.
- **What the public page says:** unchanged words. Before, "Ask the team"; after, its dates as today: Booked, Held, or
  "Nothing on our diary, the team confirms" (`packages/types/src/booking.ts:164-185`). A part of a booked combination
  shows what Blake decides (decision 4). Set-up and breakdown do not change a day's public answer.
- **The staff Diary** says "Nothing on Venviewer's diary" instead of "Free" for a room whose record does not stand, so
  staff and the public page agree; once it stands, "Free" returns.

## 10. The rules in the database, and the checks that prove them

| Rule | In the database | The check |
|---|---|---|
| An old row cannot become two live bookings, nor an occasion two events | Unique `(venue_id, source_system, source_id)` on bookings and on events, among rows not deleted; source pair both or neither | Test 18 |
| An import names its venue's rooms, bookings, batches, owners and sales lead only | `(id, venue_id)` keys from every import table and from the new booking columns; owners and the sales lead by the owner check (4.5), since a user row has no such key | Test 28 |
| A signed matching cannot change | A trigger refuses an update to a signed version | Test 29 |
| An erased person is not made again | `import_people` keeps a hash of each old id and the person's id | Test 27 |
| Staged personal cells are kept only while needed | Blanked at staging or signing; an abandoned or superseded batch emptied (4.8) | Test 27 |
| A combined booking is filed under its combination's lead room | Key from `(combination_id, space_id)` to the combination's id and lead room | Filing it under another part is refused |
| A combination's parts are its venue's rooms, unchanged under a live booking; a retired one takes no booking | `(space_id, venue_id)` keys; the claims trigger takes the combination `FOR SHARE`, a change takes it `FOR UPDATE` | Tests 6 and 7 |
| No room is taken twice by confirmed booked time, whole or part | Exclusion constraint on blocking claims of booked time | Tests 1 and 2 |
| No set-up or breakdown overlaps another event's confirmed booking or band | Exclusion constraint on blocking claims, with the event | Tests 3 and 4 |
| A claim's time is never empty | A check on the claim's range | A booking that would make one is refused |
| One night of a term once | Unique `(series_id, series_date)` among rows not deleted; `series_id` a key to the term, pinned to the venue | Test 12 |
| A provisional term's nights carry its hold fields | An API rule: the term's own change is their only writer (5.4) | Test 16 |
| Set-up and breakdown are sensible | 0 to 1,440 minutes | 1,441 is refused |
| One lapse notice for each hold and decision date | Unique record of each notice | Test 34 |
| A hold's later decision date has its reason, where the venue has a rule | An API rule, beside the existing hold hygiene; the database does not know the rule's start | Test 38 |
| Nothing is released by the clock | No code path but a person's transition writes a hold's exit | Test 34 |
| Every hold and booking keeps its event | Unchanged: `bookings_bound_to_event`; an import step leaves the bind's counts at zero on what it touched | Test 31 |

## 11. Tests first

Written before the code they test. Database tests run on real PostgreSQL with an explicit throwaway target, in the
platform database suite (`packages/api/src/scripts/run-platform-postgres-tests.ts:15`), never production. Dates are
real 2027 dates: clocks go forward at 01:00 on Sunday 28 March 2027 and back at 02:00 on Sunday 31 October 2027;
Good Friday is Friday 26 March 2027; Christmas falls on a Saturday, so Monday 27 and Tuesday 28 December 2027 are
substitute bank holidays (gov.uk, read 14 November 2026). Fixtures use made-up names only.

**Rooms and time.**

1. Two people confirm the same room for Saturday 6 March 2027 at once, from two connections: exactly one wins; the
   other is told, in today's words.
2. The Saloon is confirmed 18:00 to 23:00 on Saturday 6 March 2027: confirming "Grand Hall and Saloon" 19:00 to 22:00
   is refused, naming the Saloon and the time; the reverse order too; both at once from two connections: exactly one.
3. A booking ends at 23:00 with 60 minutes' breakdown: another event's confirmed booking in that room from 23:30 with
   no set-up is refused; one from midnight stands.
4. One event's changeover: a ceremony in the Saloon 14:00 to 16:00 with 60 minutes' breakdown and the same event's
   dinner there from 16:30 with 30 minutes' set-up both stand; the dinner as another event's is refused; the same
   event's dinner from 15:30 is refused, because the booked times overlap.
5. Set-up never lengthens the event. Holds never block, across parts too, but the conflict report shows a hold on the
   whole against a booking on a part.
6. Claims stay true when a booking moves room, time, event or combination, or is released, cancelled or deleted. A
   booking naming a retired combination is refused. A parts change racing a new combined booking waits, and is
   refused once the booking commits. A part cannot be deleted under a confirmed combined booking.
7. Tenancy: a combination of venue A naming venue B's room is refused by the database; through the routes, venue B's
   admin cannot list, make or retire venue A's combinations.
8. Two confirmed terms saved at once, crossing on two nights in opposite order: one saves, the other is told which
   night; never a 500.

**A regular hirer's term.**

9. Every Saturday 19:00 to 23:00 from 6 March to 10 April 2027: every night at 19:00 by the hall's clock, 19:00
   universal time before 28 March and 18:00 after.
10. Overnight: 22:00 Saturday 27 March to 04:00 Sunday 28 March 2027 lasts 5 hours; 22:00 Saturday 30 October to
    04:00 Sunday 31 October 2027 lasts 7 hours. A night starting at 01:30 on either Sunday is shown to the person,
    never moved silently.
11. A closed day: a house block on Good Friday, 26 March 2027, flags that night in a Friday term's preview; kept, it
    is written and still flagged; skipped, nothing is written. A Monday term across 27 December 2027, recorded as a
    house block, likewise.
12. A term saved twice with the same key writes one term, each night once.
13. A confirmed term saved while another person confirms one of its nights: one wins; if the single booking wins,
    the whole term is refused, that night named, nothing written.
14. Change one night; change this and later (a night changed by hand is left and listed); skip; finish early: the rows
    are exactly as expected, and the hallkeeper's sheet shows the next night, not the first.
15. Confirming a provisional term is all or nothing, naming any night in the way.
16. A provisional term of twelve nights: one reminder each morning one is due, one Decisions due line, one lapse
    notice; "Release the term" exits all twelve in one transaction, one promotion notice per term or hold moved up.
    A change to one night's decision date, owner or next action is refused; "Extend a week" moves the term's date
    and all twelve nights' in one transaction.
17. A public create or edit that sends a `seriesId` is refused. Venue B's staff cannot preview, save or change venue
    A's term through the term routes.

**The import.**

18. Run twice: the second run makes, changes and sends nothing (bookings, events and people and their `updated_at`
    unchanged; no notice, no job).
19. Killed after its third step: apply called again finishes, nothing doubled, no new signature.
20. Two applies of one batch at once: one is refused.
21. The old diary's own clash (two confirmed bookings overlapping in one room): neither comes in; both are listed.
22. The import and a person confirming the same room at once: one wins; the loser is listed (the import) or told.
23. Undo removes only what nobody touched and names the rest; a moved booking whose old times would clash is refused
    and listed; another event left with no live booking is listed; a hold the batch made moves up with no notice, a
    staff hold that becomes 1st option gets the normal notice; run twice, it changes nothing.
24. Run again: changed in the old diary only, updated; changed in both, held; gone and still in the future, held, not
    removed; gone and past, not listed; a confirmed booking now cancelled there is cancelled by the person who
    applies, noted "From the old diary, batch N"; one now provisional there is held, unchanged; a status matched to
    "leave out" never touches a booking brought in before.
25. A hold keyed into both diaries is held; "Link it" writes the old id onto the existing booking, and the next run
    finds it unchanged; "A different booking" makes it.
26. "2027-10-31T01:30" with no offset is refused as happening twice; "2027-10-31T01:30:00+01:00" is exact;
    "2027-03-28T01:30" is refused as not happening. A title of 201 characters is refused, never cut.
27. People: one old contact twice makes one person; an email held by one person links; by two, a new person and a
    suggestion; an erased person's old id is never made again, even once the erasure clears their source columns,
    and their row is blanked at staging. A row ended before today or marked deleted is blanked at staging, other
    left-out rows at signing. An unsigned batch older than the limit, or one a newer signed batch supersedes, is
    abandoned and holds no personal cell; an applied batch holds none once a newer one is applied.
28. Tenancy: venue B's admin cannot stage, sign, apply or undo venue A's batch; a matching cannot name venue B's room
    or owner; a platform admin with no role at the venue cannot sign; a hallkeeper cannot read the staged cells. The
    sales lead must be a user of the venue in a hold-owner role; naming venue B's user is refused, and one who has
    left no longer meets the check.
29. Editing a signed matching is refused. A stored plan that no longer matches the signed fingerprint: apply is
    refused before its first step. A booking changed after signing: that row is refused and listed, the rest applied.
30. A provisional hold with no decision date is refused and listed; every hold that comes in has all four hygiene
    fields and can be edited; a confirmed booking whose owner has no match comes in with no owner.
31. No apply or undo step leaves the bind's counts above zero on what it touched; an unrelated contradicting event
    at the venue, or another writer committing a contradicting record there during the step, does not stop it.

**A hold that lapses, and reminders.**

32. A Release tap and a confirmation of the same hold at once: exactly one; the other is told it changed.
33. Releasing a lapsed 1st option records `released`, the history's note saying its decision date had passed; it
    moves the 2nd up and tells its owner; the draft goes to the imported client account's main contact, or the
    enquirer when there is no account.
34. The morning job leaves every lapsed hold live and writes one notice each, a second run none; an imported hold
    already past its date gets one; a hold moved back into a day already run gets one; an owner in sales is told by
    name; a hold whose owner has left goes to the office; nobody outside the hold's venue is ever told.
35. Release after the ladder changed (a new 2nd option, or the 2nd released meanwhile): refused with the new sentence.
36. A decision moved later: the morning run that would have noticed it does nothing.
37. Two servers, one reminder (the plumbing's own test, used here).
38. With the venue's rule set, a later decision date without a reason is refused, and with one it is kept; an
    imported hold keeps its date until it is next changed.
39. A decision at 09:00 on Wednesday 3 November 2027 gives its 7-day reminder on the morning of Wednesday 27 October
    (168 hours earlier is 10:00 that day by the hall's clock, after the morning run); one at 17:00 that Wednesday, the
    same morning; one on Saturday 3 April 2027, the morning of Saturday 27 March, across the spring change. A
    reminder whose morning has passed is not sent. The forward list shows each hold's mornings and owner, sending
    nothing.

**The public door and the words.**

40. A part of a confirmed combination answers as Blake decides once its room's record stands; "Ask the team" before.
41. No staff screen says "Free" for a room whose forward-book record does not stand.
42. At a venue with an import, the forward-book control refuses a room the import page shows as not ready.

## 12. Migrations, backfill and rollback

Four database changes, each in its own merge slot, numbered by orchestration at merge. Every one adds; none removes.
The project has no down migrations; each change has a written undo and the backup as the last resort. Production
held very few records when the spine counted it on 13 November (spine, section 3); bookings were not counted, so no
backfill here relies on being small.

| Change | Adds | Backfill | To undo |
|---|---|---|---|
| 1. Rooms together, and set-up | `room_combinations`, `room_combination_parts`, `booking_room_claims` with its two constraints and trigger; on bookings `combination_id`, `setup_minutes`, `breakdown_minutes`; on rooms the two standard minutes | Claims for every live hold, confirmed booking and house block. With no combinations and no set-up yet, the confirmed claims are exactly today's rule, so the backfill cannot fail on data today's rule accepts | Drop the trigger, the claims and the new tables and columns while no combination is in use. Today's rule is never touched |
| 2. The import's place | `import_batches`, `import_rows`, `import_mappings`, `import_people`, `import_checks`, `import_day_checks`; on bookings and events `source_system`, `source_id`, `import_batch_id` | None: every new column starts empty | Before any batch is applied, drop. Once one is applied, disable the import's routes and keep the tables and columns: undo reverses only the latest batch, and piece K needs the old ids |
| 3. A regular hirer's term | `booking_series`; `bookings.series_date`; `series_id` becomes a key | None invented: if any row has a `series_id` (the API writes one only when a caller sends it; the web sends none), the migration stops and reports the count | Drop the key and the new column and table; `series_id` is a bare column again |
| 4. The venue's hold rule, and lapse notices | `venue_settings.hold_days` and the office's morning (`packages/api/src/db/schema.ts:6364-6384`; a venue with no row reads 07:00, since a row cannot be made without its escalation window, `:6367`); on bookings `decision_reason` and who gave it; the record of lapse notices | None | Drop the columns and the table |

## 13. Build order

At most one database change for each stage. Each stage is useful by itself.

| Stage | Database | What it does | Waits for |
|---|---|---|---|
| 1. Lapsed holds and honest words | No | The Lapsed list with one-tap Release, its promotions checked; the read-only line corrected; "Free" only for rooms whose record stands. No change for sellers (decision 5: no) | Nothing |
| 2. Rooms sold together, and set-up | Change 1 | Combinations, claims, set-up and breakdown; part locks, the room delete, refusal words and deadlocks; the readers of 6.3 | #400, for the Diary's lane read, the conflict engine, time moves and the sheet; Blake's decision 4, for the public read; the Day Board stack (#361 to #365) to land or rebase, since both touch `booking-mutations.ts` |
| 3. The import's place, and the dry run | Change 2 | The converter's frame, staging, the matching and its signature, the plan and its page; abandoned batches emptied (4.8) | Stage 2 (rooms and set-up must exist to match to) |
| 4. Apply, undo and the check | No | Apply through the bind, people and clients, undo, run again, the thirty-Saturday page, rooms shown as ready, the control's refusal | The spine's first migration (client account key pinned; its list of joins), for production. The read-only login, for the converter and the matching's values |
| 5. A regular hirer's term | Change 3 | Terms with their exceptions; a term lapses and is listed as one; `seriesId` out of the public schemas; the sheet shows the next night | Stage 2 (the combination key and the set-up columns it copies); #400 and its owner, for the sheet |
| 6. The venue's hold rule, and the morning notice | Change 4 | The rule and its reason; the office's morning; the morning job that tells owners a hold has lapsed | The plumbing's first stage |
| 7. Reminders on | No | Reminders by calendar day, one for a term; the forward trial run on the real holds for Blake; then the morning kind on the list | #400; stage 4 applied on production; the plumbing's first stage; Blake's yes |

Stage 5 does not depend on stages 3 and 4 and may be built beside them; only its merge waits for its slot.

## 14. What only Blake decides

**His answers, 16 November 2026, by button, word for word.** The questions were put to him in the merge
coordinator's question form, with this design in front of him.

| Decision | His answer | What it means |
|---|---|---|
| 1. This design | "Approve it (Recommended)" | Approved. Building may start with the stages that do not wait on the read-only login |
| 2. The reminder trial run | "On the real holds (Recommended)" | After the import, he sees for every live hold the mornings its reminders would go and to whom. Reminders go on only after his yes |
| 3. When a room's dates may show publicly | "After thirty Saturdays (Recommended)" | A room can be opened only once the latest import is clean for it and the thirty Saturdays stand as "Same"; the venue's admin or manager then records it |
| 4. A part of a booked combination on the public page | Not yet asked | Open. It decides one line of stage 2 (the public read) and nothing else |
| 5. May a seller place a provisional hold | "No, keep it to the office" | His 10 October decision stands: only staff and admin write the Diary. Sellers ask the office to hold a date. Nothing in this piece changes for sellers, and stage 1 carries no seller change |

The options as they were put to him are kept below for the record.

1. **This design.** Approve it, or say what to change first.
2. **The reminder trial run.**
   - *On the real holds, once they are in (recommended):* after the import, you see privately, for every live hold,
     the mornings its reminders would go and to whom; reminders go on only after your yes.
   - *Now, on today's Diary:* you see it this week, before the old diary's holds are in, and look again after.
   - *Not until the switch:* reminders stay off until the old diary goes read-only (piece K); owners rely on the
     Decisions due list.
3. **When a room's dates may show on the public page.** The page's words do not change in any of these.
   - *After the thirty Saturdays (recommended):* the control accepts a room once the latest import is clean for it
     and the thirty Saturdays stand as "Same"; the venue's admin or manager then records it.
   - *After the import alone:* before the Saturdays are checked; faster, but an import slip could show a wrong date.
   - *Not until the switch:* every room stays on "Ask the team" until piece K.
4. **What the public page shows for a room that is part of a booked combination.**
   - *Booked, or Held (recommended):* as the combination is confirmed or held, so a part never looks empty while the
     whole is sold.
   - *"Ask the team" for that date:* safe, but tells the visitor less.
   - *Its own bookings only:* the part looks empty while the whole is sold.
5. **Whether a seller may place a provisional hold while the caller is on the phone** (the plan's own question,
   section 10, item 10). On 10 October you decided that only staff and admin write the Diary, which took holds from
   sellers. Yes changes part of that decision, for holds a seller owns.
   - *Yes, for holds they own, never confirm (recommended):* stage 1 lets a seller place, extend and release a hold
     they own; confirming, other people's bookings and house blocks stay with staff and admin. Its tests: a seller's
     hold is theirs; they cannot place a confirmed booking, house block or viewing, confirm, or touch a hold they do
     not own; they can extend and release their own; the drift test keeps the four role lists in step
     (`packages/api/src/state-machines/booking.ts:22-25`; `packages/api/src/services/diary-commands.ts:111-116`;
     `packages/web/src/lib/role-capabilities.ts:111`).
   - *No, keep it to the office:* your decision stands; sellers ask the office to hold a date, and nothing here
     changes beyond the stale screen line.

**Calls made here, for you to overrule:** undo leaves the people it made in the People Book; a term is one event,
not one for each night; reminders count calendar days, not hours.

## 15. Questions for the venue

Each has a default that is safe until the venue answers: it changes nothing from today, or it holds a row back for a
person rather than guessing.

1. **Which rooms are sold together, and under which room is each combination filed?** For example, whether the
   Grand Hall and the Saloon are ever sold as one, or the two galleries (the roadmap's own examples, not facts).
   And are there rooms that may not be sold to two different clients at the same time? *Default:* none; every room
   stands alone, as today.
2. **How long does a provisional hold last before its decision date, and when does a longer one need a reason?**
   *Default:* no rule; staff set decision dates as today; no reason asked.
3. **Standard set-up and breakdown time for each room, and should changeover times change once set-up is
   recorded?** *Default:* none recorded (zero); set-up entered on a booking blocks the room; changeover times stay as
   they are.
4. **The office's own words** for set-up, breakdown, a regular hirer's term, a combined booking and a lapsed hold.
   *Default:* "Setup" and "Clear-down" (the planner's words), "Weekly booking", the combination's own name, "Lapsed".
5. **Closed days and bank holidays.** Does a regular hirer's booking go ahead on a bank holiday, and which days is
   the hall closed? *Default:* each night is shown when a term is entered; a night under a house block is flagged and
   written only if the person keeps it; nothing is skipped by itself.
6. **For the import** (with the matching, after the login): which old statuses mean Confirmed, Provisional,
   Interest only, House block or leave out, and which Venviewer exit each old exit status means; which old room and
   event type is which; who owns each hold, and whether one person takes holds whose owner has left; what an old
   hold's next step says when it has none. *Default:* nothing comes in until a named person signs; no default owner,
   so an unmatched hold is refused; the next step reads "Confirm or release", due on its decision date.
7. **While both diaries run, where is a new booking entered first?** *Default:* in the old diary until a room's
   forward-book record stands, then in Venviewer first; one keyed into both is caught as "may already be here".
8. **A row with a date and no times.** *Default:* refused and listed; the office adds times in the old diary, and the
   next export brings it in.
9. **When the office's day starts,** for the morning notices and reminders. *Default:* 07:00 by the hall's clock (the
   reminders' existing schedule starts at 07:00 universal time, `.github/workflows/diary-hold-reminders.yml:49-55`).
10. **Who signs the matching, whose ticks count, and how long an unsigned run may wait.** *Default:* the venue's
    admin or manager signs; only the ticks of the person the venue names as its sales lead meet the check; a run not
    signed within 14 days is abandoned and its personal cells emptied (4.8).
11. **Which thirty Saturdays.** *Default:* the next thirty from the day the check starts.

## 16. Neighbours and open pull requests

**The spine (pull request #427).** The import wraps `insertBoundBookings` unchanged and is the first writer of the
event's client account, last in each step (4.4). Doubtful occasions go on the spine's list of joins, which never
stops an import (4.4 step 4). Events gain source columns and claims carry each booking's event; a merge leaves the
first on the event merged away, the import follows it, and claims follow it. No new table points at events, so the
merge guard needs no new entry. **Asked of the spine's owner:** amend the spine's section 5.4 to the full lock order
of 6.2 here. This design does not edit the spine's text.

**The plumbing (pull request #425).** Two daily kinds for each venue at the office's morning: lapse notices, done
exactly once since they only change our database, and later reminders, through the outbox. Ids only in the job; each
run reads again. Needs its first stage only.

**Open pull requests, which stay with their owners:**

- **#400** changes, among others, `hold-reminders.ts` (owners who have left are no longer emailed),
  `calendar-conflicts.ts`, `routes/calendar.ts`, `decisions.ts` and `hallkeeper-sheet-v2-data.ts`. This piece's
  changes to them land after it; the sheet's timing fix (5.4, 6.3) is agreed with #400's owner; the trial run waits
  for it and runs with it in place.
- **#361 to #365** (the Day Board) change `booking-mutations.ts`, as stages 1, 2, 5 and 6 do; whichever lands second
  rebases. The Day Board shows a combined booking on its lead room only until its owner reads claims.
- **#415** (the sheet PDF): not touched; its files are the PDF's, not the sheet's data.
- **#247** (erase a person): staged rows are a new store of personal data, carrying their venue and the person
  matched, and erasure must reach them; the import never depends on #247 keeping a person's old id (4.8). An
  imported client is linked to its booking through the event's client account, which is how #247 sees the booking.
- Every new database suite adds a file to the platform test list, as #247, #400 and #361 to #365 do; whichever lands
  second rebases.

**Pieces C, D, E and K.** C shows terms, combinations and sources on the event page; D may group imported weekly
bookings into terms and reuses the import's tables; E's agreements can name a whole term; K owns the forward value
and the money history, and joins money to bookings by their old ids.

## 17. Done when

Unchanged from the plan: **the sales lead checks thirty forward Saturdays against the old diary and finds no
difference, and a real term of weekly bookings is entered once.**

It is watched on the real book: the thirty Saturdays on the page of section 4.7, and a real hirer's term entered by
the office.

## 18. What is not known

- The export (4.2): its fields, rows per booking or per day, the zone of its times, whether deleted rows appear; and
  whether the old diary has combinations, terms, a hold rule, set-up times or date-only rows, and how many rows (the
  October design's "1,204 bookings" was an illustration). Nothing here rests on search summaries of Salesforce's
  help. The converter is tested on the real export, with a booking that crosses a clock change.
- Whether concurrent inserts into the claims behave as today's rule does: tests 1 and 2 prove it first.
- Whether the venue's time zone in production is the default. Not read.
- Whether #247's nightly pass reads a person's bookings through the event's client account: inferred from its
  description, not read in its code.
- How long the staged rows may lawfully be kept after the switch: piece I and the solicitor.

## 19. Left to the builder

Table and column names; index choices; the size of each apply step and each staged part; the exact wording of
refusals, inside the glossary; how the report and the check page page a long list; the converter's code once the
export is seen; whether the trigger that keeps claims true is one function or two (but never deferred, 6.2); how the
morning job keys its run; the order of pull requests inside each stage.

**Read this when:** changing what the Enquiries desk's decision panel says about the Diary, the panel's hold link, the approval email, or the wording a day is answered in.

# Where the enquiry stands in the Diary — design record (T-635, 13–14 October 2026)

Roadmap §3.2, Tier A #4: "availability answered inside the enquiry panel, one-press provisional hold,
reply draft joined to real availability and price guide … removes a surface switch and the retyping of
every reply". The desk could hold a date (N6, "Hold a date in the Diary") but could not say whether the
date was free, whether a room big enough was free, or whether the enquiry already held something. Find
(Tier A #8) answers a typed date room by room (`pages/diary/lib/day-answer.ts`), but it needs Ctrl/⌘K
and a typed date, shows no capacities, and cannot tell an enquiry's own hold from anyone else's.

This record was revised after a six-lens critique (veteran booker, Diary correctness, freshness and
races, accessibility and layout, tenancy and the API, scope and value): 58 findings, 9 high, every high
one checked against the code and upheld. The changes it forced are folded in below.

## Why this next

#9 (hold lifecycle) waits on Blake's D4 and H1, and #10's sync on A5; Find's leftovers (commands, recent
records) save less. Over Find, this slice adds the answer without being asked, the guests against each
room's published figure, the enquiry's own hold wherever it is, and what Approve is about to tell the
client. #4 stays Partial: the one-press hold and the reply joined to availability remain. Phone
quick-entry (#3) is unblocked and comes next; a phone enquiry entered with a date gets this answer at once.

## What it is

For a booking enquiry at the reader's own venue, opened by someone who reads that Diary:

1. **In the facts, one more fact: In the Diary.** A full-width fourth group of the facts list, label
   "In the Diary", answer below it, reserved at two lines from the first paint and clamped there.
   - **The enquiry's own booking leads, wherever it is.** "1st option for this enquiry, decides Tue 1 Dec"
     when it is on the date and in the room asked for; "1st option for this enquiry: Saloon, Fri 21 May
     2027, decides Tue 1 Dec" when the booker held another room or date. Read from the enquiry's own
     live bookings (`GET /bookings?enquiryId=`), not from one day's calendar.
   - **Otherwise the room asked for, that day, in the Diary's words:** "Free", "Free from 01:00",
     "Confirmed, Smith wedding, 12:00–23:00", "1st option MacLeod wedding, 12:00–23:00, decision was due
     Mon 5 Oct", "House block, Floor polishing, 08:00–10:00", "In use for Fraser wedding (Drinks
     reception), 17:00–18:30". Several bookings: "2 bookings: Confirmed 08:00–11:00 · 1st option
     18:00–23:00, decides Tue 1 Dec" (titles in the list below).
   - **With the guests against the room's published figure** where the venue publishes one and the
     occasion has a format (wedding and dinner: dinner; conference: theatre; drinks reception: reception,
     as the public composer measures them): "Free · seats 60 for dinner" when the room is smaller than
     the party. No figure is ever estimated.
   - **No room chosen (the website's form sends none):** the rooms that hold the guests and are free:
     "Free and seats 140 for dinner: Grand Hall", "No room that seats 140 for dinner is free". Without a
     guest count or a format, Find's count: "5 of 6 rooms free", "All 6 rooms free", "No room free".
2. **Below the next step, In the Diary.** Its actions first, so nothing below moves when the Diary
   answers: Try again (only after a failure), "Hold a date in the Diary" (moved here from Tools), "Open
   this day in the Diary". Then the enquiry's own bookings elsewhere, then the asked day room by room:
   the room asked for first and marked "asked for", then the rooms that hold the guests, then the rest,
   each with its published figure when there is one, each booking on its own line, the enquiry's own
   marked "For this enquiry".
3. **Approve always says what the Diary says, before the client is emailed.** One sentence in a slot
   reserved above the note, described to the confirm button: reading; could not be read ("…so this does
   not say whether the Grand Hall is free"); held for this enquiry; free and nothing holds it yet; or the
   Diary's words for what has the room ("The email does not mention it."). It informs; it never refuses.
   Approving reads the day again at once, and the sentence then changes at most once.
4. **The approval email names the date as a person would.** It printed the ISO date ("on 2027-05-14")
   and opened "Great news!", against the brief. It now reads "Your enquiry for the Grand Hall at Trades
   Hall Glasgow on Friday 14 May 2027 has been approved." under "Enquiry approved", and the panel's
   consequence names the same room and date.
5. **Two fixes in the Diary's own wording, so Find and Go to date gain them too.** An option whose
   decision moment has passed reads "decision was due Mon 5 Oct" (the Diary's existing words), never
   "decides". A room used that day by another event's timed phase, with no booking of its own, reads "In
   use for …" and is not counted free.

A closed enquiry (declined, withdrawn, done) reads no day; if it still holds a room the line says so:
"Still held for this enquiry: 1st option, Grand Hall, Fri 14 May 2027".

## Who sees it

The answer, the line and the list follow Find's rule: the venue floor and sales (and a platform admin
with a venue) for enquiries at **their own venue** — narrower than the API's `canReadDiary`, never refused,
and on the venue's own clock. An enquiry at another venue shows no Diary fact, because the Diary opens
only on your own venue. "Open this day in the Diary" follows the same rule. "Hold a date in the Diary"
needs a Diary writer and the Diary's own `holdRefusal` to be null, as the drawer does. A planner sees none
of it. `diaryVenueOf(user)` in `lib/role-capabilities.ts` holds the rule (Find uses it too), pinned by a test over
every role, platform role and venue.

## Behaviour that matters

- **Nothing moves under the pointer.** The fact reserves its label and two lines from the first paint and
  clamps the answer there; the full words are in the list and the accessible name. Waiting is an
  `ActivityIndicator` with "Reading the Diary…" inside the slot, mounted only once a request is out (not
  during the settle). Try again lives in the section's action row, never in the slot. A browser case
  pins Start review's and Approve's position from waiting, to a long answer, to a failure, at 1440 and
  390 px.
- **Read where the person stops; show what is kept at once.** Answers are kept per venue and day (rooms
  and entries, not worded lines, so each enquiry works out its own standing) in the view, at most 32,
  gone with the view. On every show the kept answer appears at once and the day is read again a quarter
  of a second later, so stepping with J and K reads only where the person stops. The day is also read on
  return to the page, when Approve is pressed (at once), and on Try again. No polling. Only the answer for
  the enquiry now shown is ever used; aborted reads change nothing.
- **Honest failures.** A day that cannot be read says "The Diary could not be read for that day." and the
  section offers Try again, which keeps focus while it reads. A read again that fails keeps the last
  answer; an answer more than two minutes old says "As read at 14:02". A refusal (401 or 403) hides the
  fact and the list and reads no more. A missing guest count, format or published figure means no fit is
  shown, never a guess.
- **One announcement.** The panel's existing polite region says the answer once per enquiry when it
  lands after opening, and again only if a read again changes it. "Reading…" is never announced.
- **One wording.** The day's lines are `day-answer.ts`'s; the free-room count is the same function Find
  announces with; the hold words are Blake's ("Provisional", "1st option", "2nd option", "Joint 1st",
  "Confirmed").
- **Calm.** Words carry every meaning; marks are drawn with borders in the Diary legend's shapes, in the
  register's lit inks (all AA on forest), and survive forced colours. No entrance motion.

## Approaches considered

1. **The Diary's own calendar read, worded by `day-answer.ts`, plus the enquiry's own bookings** (chosen).
   The rules for what holds a room stay in one place. The new read lists what was booked for the
   enquiry; it is not a second definition of free. Own bookings are matched by id, so the calendar's
   entries need no new field.
2. **An availability endpoint per enquiry.** Rejected for now: a second definition of "free" beside the
   Diary's would drift. It earns its place when the ledger marks every row's date.
3. **A link to the Diary only.** Rejected: it keeps the surface switch the roadmap names.

## Decisions for Blake (built with these defaults)

1. **Weddings as exclusive use.** Trades Hall prices weddings as "Exclusive wedding use of Trades Hall".
   Should a wedding enquiry's answer cover the whole venue? Default: not assumed; every room is listed, so
   another room's booking that day is in view.
2. **Formats for the other occasions** (corporate, ceremony, concert, private, other). Default: no fit.
3. **Approving a date that is not free.** Default: allowed after the Diary sentence.
4. **The approval email's words** above. Default: built, per the brief's "no praise" rule.
5. **The look of the new fact and section** on the reference desk. Blake's verdict.

## Not in this slice

A hold made in the panel itself (the drawer asks for the option, decision date and next action a
provisional hold must carry; D4); a mark on every ledger row whose date is taken; the reply draft joined
to availability and the price guide; Decline offering the free rooms; owners' names; reading on the
Diary's live events instead of on show; a lean day mode for `GET /calendar`.

## Known divergence

The panel's day is the Diary's: midnight to midnight in the venue's zone, with the night before forgiven
until 06:00. T-649's public answer counts 04:00 to 04:00. A wedding ending at 05:00 on Sunday is "busy"
on Sunday to an AI assistant and "Free from 05:00" here. One rule in `@omnitwin/types` is for the ledger
mark's many-date read.

## Measure

Before: to know whether a room that seats 140 for dinner is free on a website enquiry's date, a booker
opens Find (Ctrl/⌘K), types the date, reads every room and recalls each room's capacity, which Find does
not show. After: nothing to do; the fact is there when the enquiry opens. The browser case counts the
interactions to the answer (zero).

## Build plan

1. API: `GET /bookings?enquiryId=` (live bookings of one enquiry, gated by `canReadDiary` on its venue:
   404 `ENQUIRY_NOT_FOUND` for an unknown enquiry, 403 for one the caller may not read, as the house's
   other reads answer), proven on PostgreSQL; the approval email's date and words.
2. `day-answer.ts`: lines keep kind, booking id and time parts; overdue decisions; phases; the free-room
   count moves there from Find.
3. `enquiry-standing.ts`: the panel's words, pure, every state pinned.
4. `use-enquiry-day.ts`: the reads, the store, settle, return, Approve, refusal and failure.
5. The panel's fact, its In the Diary section and Approve's sentence; the gate from `DashboardPage`.
6. A browser case on a desk and a phone (positions held, zero interactions to the answer), admitted to
   the reviewed inventory; then CI, merge, deploy, and the live panel checked signed in.

## As built (16 October 2026)

Steps 1–6 are built on `claude/t635-enquiry-day`. Where the build settled what this record left open:

- **Room asked for** is read from `roomChosen`, never `spaceId`: a roomless enquiry is filed under the
  venue's first room.
- **Published figures** are Trades Hall's constants, so they are shown only when the venue's slug is
  Trades Hall's (`isTradesHallVenueSlug`); formats follow the public composer's `ENQUIRY_EVENT_TYPES`:
  "seats 140 for dinner", "seats 80 theatre style", "holds 200 standing".
- **Phases** follow the conflict engine: a timed phase uses a room unless its event has a booking there;
  a phase of no length uses nothing; the night before's phase ending by 06:00 leaves the room free from
  then.
- **A hold behind a confirmed booking** (the Diary leaves it out of the day's lines) still leads:
  "2nd option for this enquiry, behind Confirmed, …".
- **Either read failing** (the day or the enquiry's own bookings) is a failure; only 401 and 403 hide
  the Diary. An undated enquiry's failure reads "The Diary could not be read."
- **Approve's consequence** names the room and date as the email does: "…to say the enquiry for the
  Grand Hall on Friday 14 May 2027 is approved." The email's room-case subjects gain the article
  ("for the Grand Hall"), approved and declined alike.
- **The declined email** still prints the ISO date and "We'd love to help"; left for a later slice.

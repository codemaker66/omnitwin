**Read this when:** changing what the Enquiries desk's decision panel says about the Diary, the panel's hold link, or the wording a day is answered in.

# The enquiry answers its date — design record (T-635, 13 October 2026)

Roadmap §3.2, Tier A #4: "availability answered inside the enquiry panel, one-press provisional hold,
reply draft joined to real availability and price guide … removes a surface switch and the retyping of
every reply". The desk could hold a date (N6, "Hold a date in the Diary") but not say whether the date
was free: the first question about any enquiry meant leaving it for the Diary. Find (Tier A #8) now
answers a typed date room by room in the Diary's own words (`pages/diary/lib/day-answer.ts`); this slice
gives the enquiry the same answer without being asked.

## What it is

For a booking enquiry with a date that has not passed, opened by someone who reads that venue's Diary:

1. **Under the facts, one line: that day.** The room the guest chose, in the Diary's own words: "Free",
   "Free from 01:00", "Confirmed, Smith wedding, 12:00–23:00", "1st option MacLeod wedding, 12:00–23:00,
   decides Tue 1 Dec". When the room holds more than one booking that day, the line names the one that
   decides (confirmed, then a house block, then an option) and says how many more. An enquiry that named
   no room reads the venue's count, worded as Find says it: "5 of 8 rooms free". A booking made for this
   enquiry is marked as its own, so the enquiry's own hold never reads as someone else's.
2. **Below the next step, In the Diary.** Every room that day, each booking on its own line, as Find and
   Go to date show it, the room asked for marked. "Hold a date in the Diary" moves here from Tools,
   beside "Open this day in the Diary", so the answer and the action sit together.
3. **Approve says when the date is not free.** Approving emails the client that their enquiry "for the
   Grand Hall … on 14 May 2027 has been approved". When the room asked for is confirmed, blocked or held
   for someone else that day (or, with no room chosen, no room is free), the confirmation says so in the
   Diary's words before anything is sent. It informs; it does not refuse.

Who sees it follows the API: the calendar route admits the venue floor and sales at their own venue, and
platform admins (`canReadDiary`). Anyone else, a planner for instance, sees no line, no list and no read.
An access request or Venviewer enquiry asks for no date and gets none of this. "In the Diary" still holds
the hold link, for those who write the Diary, when there is no date to answer.

## Behaviour that matters

- **Nothing moves under the pointer.** The line above the next step keeps one line's height from the
  moment the panel opens ("Reading the Diary…", the shared `ActivityStatus`) to the answer, so Start
  review or Approve never shift as the Diary answers. The list's length moves nothing the person is about
  to press, because it sits below them.
- **Read where the person stops.** The day is read a quarter of a second after an enquiry is shown, so
  stepping through the desk with J and K reads only the enquiry the person stops on; a newer enquiry
  cancels an older read, and only the answer for the enquiry now shown is used.
- **True while it is open.** Answers are kept per venue and day, and read again once a minute old: when
  the enquiry is shown again, each minute while it stays open and the page is visible, on return to the
  page, and when Approve is pressed, so the confirmation speaks from a fresh read. A read again keeps the
  answer on screen rather than flashing back to waiting.
- **Honest failures.** A day that cannot be read says "The Diary could not be read for that day." with
  Try again; the hold and open links still work. If a read again fails, the last answer stays, and once
  it is more than two minutes old it says when it was read ("As read at 14:02").
- **One wording.** The lines are `day-answer.ts`'s; the count is the same function Find announces with.
  The calendar's booking entries now carry their `enquiryId` (optional, so older servers and recorded
  fixtures stay valid), which is how a booking is known to be this enquiry's own.
- **Calm.** The line takes the panel's eyebrow for its label and the register's lit inks for its mark:
  sage for free (the word says it), copper for an option, cream for confirmed, so colour never carries the
  meaning alone. No entrance motion; reduced motion has nothing to remove.

## Approaches considered

1. **The Diary's own calendar read, worded by `day-answer.ts`** (chosen). No new endpoint; the rules for
   what holds a room (the night before running late, an option under a confirmed booking, interest only)
   stay in one place, so the panel, Find and Go to date cannot disagree.
2. **An availability endpoint per enquiry.** Rejected for now: a second definition of "free" beside the
   Diary's would drift. It would earn its place when the ledger marks every row's date, which needs a
   read across many dates at once.
3. **A link to the Diary only.** Rejected: it keeps the surface switch the roadmap names.

## Not in this slice

A hold made in the panel itself without the Diary's drawer (the drawer asks for the option, decision date
and next action a provisional hold must carry); a quiet mark on every ledger row whose date is taken; the
reply draft joined to availability and the price guide; the guest count against each room's capacities by
layout (Tier B #17).

## Build plan

1. The calendar's booking entries carry `enquiryId` (types, route, route test).
2. `day-answer.ts`: each line keeps its kind and enquiry; the free-room count moves there from Find.
3. `enquiry-day.ts`: the panel's view of a day, pure and pinned by tests.
4. `use-enquiry-day.ts`: the read, its settling, cache, refresh and failure states.
5. The panel's line, its In the Diary section, the moved hold link and Approve's note; the view's gate
   from `DashboardPage`.
6. A browser case on a desk and a phone, admitted to the reviewed inventory.

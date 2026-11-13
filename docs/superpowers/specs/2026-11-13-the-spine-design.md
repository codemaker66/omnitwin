# The spine: design

Design, 13 November 2026. Status: **approved by Blake on 13 November 2026** (his answers are in section 2).
Next comes the build plan, then the build with tests first.
A builder's check was done on 13 November by a fresh reader with the code open; its nine questions and four
corrections are answered in the text.
Piece B of the platform plan (`docs/superpowers/specs/2026-11-13-platform-plan-design.md`, section 5.2), ledger row
T-704. Branch `claude/platform-spine-design`. Code was read at master `85a17749`; every line reference is to that
commit.

## 1. What this is, in plain words

Today a held date or a booking cannot exist without its event. The database itself refuses one. Nothing else has
that rule. A proposal, an agreement and a deposit request reach an event only by a roundabout path: through a
floor plan that somebody happened to link. So a client who was priced, signed and paid without anyone drawing a
plan has papers that belong to no event, and cannot see their own event.

This piece gives the rest the same rule, in the database first:

- A proposal, a deal and an enquiry that someone has worked each point straight at their event. Agreements and
  deposit requests reach it through their proposal.
- Who may see an event is written down on the event, instead of being worked out from who owns a floor plan.
- The old records are joined by a repeatable step that never guesses. Doubtful ones go on a list a person works
  through, on a screen.
- A check counts every record that breaks the rule. It runs on every change and in production, and must read
  zero.
- The money design is settled here, on paper only, before anything takes money.

Nobody at the venue sees a new screen from this piece except the short list of joins to check. What they get is
what every later screen stands on: the event page, People and Money.

## 2. What Blake has decided, and what only he decides here

Decided on 13 November: the spine is one of the first three pieces, to be designed first and approved before any
code. Design approvals never proceed by default. Real money moves only on his explicit yes.

What only he decides in this design, and his answers of 13 November, by button, verbatim:

1. **When an enquiry becomes an event:** "When first worked (Recommended)" (section 5.2).
2. **Whether Trades Hall takes card deposits into its own payment account, with the Hall as the merchant:** "Yes,
   the Hall's own account (Recommended)" (section 8.3). Nothing goes live on this answer; it settles the design.
3. **A read-only count on the live database:** "Yes, read-only count (Recommended)". It was run the same evening
   (sections 3 and 7).
4. **The design itself:** "Approve it (Recommended)".

Not asked here: the stage words. They go to the first-click test with venue people (plan, section 3.6).

## 3. What exists today

All paths are under `packages/`. "schema" is `api/src/db/schema.ts`.

**What is tied to its event**

- A hold or a confirmed booking must have an event: the check `bookings_bound_to_event` (schema:3906) and a key
  that pins the event to the same venue, refusing deletion (schema:3901-3905). A viewing must have none
  (schema:3894).
- The writers go through one service, `api/src/services/event-binding.ts`. A booking joins the event its writer
  names, or the event its enquiry's other bookings already have, or a new one (lines 155-195). An event's status
  is worked out from its bookings and stored (`deriveEventStatus`, `types/src/event-binding.ts:140-146`); its
  dates follow its bookings (`syncEventStatus`, event-binding.ts:337-376).
- A read-only count, `readBindInvariant` (event-binding.ts:517-548), must be zero. It is asserted in one test file
  in CI. In production it exists only as a script run by hand
  (`api/src/scripts/check-booking-event-bind.ts`); no workflow or schedule runs it.

**What is not**

| Record | Its link to an event today | Where |
|---|---|---|
| Enquiry | None. No event column and no deal column | schema:774-863 |
| Deal (`opportunities`) | None. It knows only its enquiry (`source_enquiry_id`, not unique) | schema:1068-1093 |
| Proposal | None. It points at a deal, an enquiry and a floor plan | schema:2501-2530 |
| Quote | None | schema:2680-2703 |
| Agreement (contract versions and signatures) | None. Tied to the proposal; cannot be changed or deleted | schema:2818-2853; `api/drizzle/0104_deposits_and_signatures.sql:197-228` |
| Deposit request | A nullable event, filled by a lookup | schema:2768 |
| The event's own `client_account_id` and `opportunity_id` | Columns exist; nothing writes them. Both are single keys that would allow another venue's record | schema:1676-1677; the only inserts are event-binding.ts:113 and `api/src/routes/events.ts:411` |

- **How a proposal finds its event today:** `loadProposalEventContext` (`api/src/routes/proposals.ts:298-326`).
  No floor plan means no event. A floor plan linked to two events returns whichever row comes first: one row is
  taken with no ordering (line 310).
- **Who may see an event today:** a client or planner sees an event only through a floor plan they own that is
  linked to it (`api/src/services/client-event-schedule.ts:61-102`). The code is explicit that nothing else is a
  grant (lines 21-27). There is no table of who may see an event.
- **That rule is written three times, with three strengths.** The schedule page is strictest. The client's home
  adds its own conditions (`api/src/services/client-home.ts:54-79`). A looser test,
  `clientHoldsEventLink` (`api/src/services/conversations.ts:136-152`), decides messages, requests, the room's
  day, proposing a time and phone notices. A plan whose room was deleted fails the first and passes the third.
- **No screen or route can give a client that link.** The only two writers of a plan link refuse a plan owned by
  a client or planner (`api/src/routes/events.ts:101-131`, the refusal `CONFIGURATION_OWNER_IS_CUSTOMER`),
  because linking it would hand over the event. So a client can see an event today only if a row was put in the
  database by hand, as the tests do.
- **A plan's owner reads some event facts by owning the plan alone:** the hallkeeper sheet routes return the
  event's timings to the plan's owner with no check on the event (`api/src/routes/hallkeeper-sheet.ts:142-162`).
- **What a proposal calls its event is not the event record.** The date, guests and room shown on a proposal and
  copied into its agreement are facts taken from the deal and the enquiry and frozen into each version
  (`api/src/services/proposal-taken.ts:39-85`).
- **Leak tests exist in part.** One file proves a planner cannot reach another client's event at several doors
  (`api/src/__tests__/client-home-postgres.test.ts:207-245`). The schedule's own test puts both clients on the
  same event. The CI gate named for event access runs two files and neither is that one
  (`api/src/scripts/run-event-access-postgres-tests.ts:15-18`).
- **The October join left a list nobody can see.** Migration 0090 wrote `event_binding_reviews` (schema:3927-3943)
  for bookings it could not place with certainty. It has no screen. The migration kept no record of what it
  joined, so it cannot be undone except by restoring a backup.
- **Events without a booking already exist:** `POST /events` makes one (routes/events.ts:411). The count above
  ignores them, because it only looks at events that have bookings (event-binding.ts:532-534).
- **A first-reply stamp exists** on the enquiry (schema:806-809, written by
  `api/src/services/enquiry-funnel.ts:82-109`). Three things set it: a reply a member of staff reports, a
  proposal being sent (`api/src/routes/proposals.ts:1524-1535`), and a decision on the enquiry, whether it says
  yes or turns it down (`api/src/routes/enquiries.ts:376-385`). Making a hold, a viewing, a deal or a draft
  proposal does not.
- **A proposal can be made from a plan alone**, with no deal and no enquiry (`api/src/routes/proposals.ts:595-620`).
  A deal can be made with no enquiry (`api/src/routes/opportunities.ts:216-258`). A quote's proposal is optional
  (schema:2684). One enquiry can have two open deals: nothing in the database stops it (schema:1073, 1091).
- **Deploys:** Railway builds and releases the server by itself and migrates before it promotes the new one
  (`railway.json:23`). The repository's deploy workflow only migrates, as an audited second pass; it neither
  releases nor blocks a release (`.github/workflows/deploy.yml:1-20`).
- **Deposits** are a card-checkout record that the database keeps in test mode
  (`deposit_payments_test_mode_only`, 0104:135), for one venue named in the server's settings. It cannot hold a
  payment by bank or by hand (schema:2788-2816).

**Measured in production** on 13 November 2026, with Blake's yes: one read-only transaction, counts only, nothing
personal read and nothing written. The exact figures are kept with the lane's notes, outside the repository.

- Production holds very few records of these kinds. Every record that must have an event and has none belongs
  to one chain: an enquiry that has been worked, its one deal and its one sent proposal. No path reaches an
  event for them, because no date has been held and no plan is linked to a live event.
- Nothing is doubtful. No record reaches more than one event; no two paths disagree; no enquiry has two deals;
  no link crosses venues.
- There is no agreement, no deposit request and no card payment.
- Nobody can see an event through a plan they own. There are no client or planner accounts.
- The event's `client_account_id` and `opportunity_id` are empty on every row. The October review list is empty.

## 4. Approaches considered

**A. Each record points straight at its event (chosen).** A nullable `event_id` on proposals, deals and
enquiries, each pinned to the same venue by the key, filled for old records by a step that can be undone, then
made compulsory once production reads zero. It is the method holds and bookings already use: a rule in the
database, and a count that proves it.
*Costs:* a change to three busy tables and one careful backfill. Three links can disagree with each other, so the
count also has to catch disagreement.

**B. One link table for everything** (event, kind of record, record id). One table, easy to add kinds, easy to
drop.
*Why not:* the database cannot hold a real key from "a record of some kind" to the record, so it cannot refuse a
live proposal with no event, and cannot pin a link to its venue. Every rule would live in code and triggers. It
gives up the one thing this piece is for.

**C. Keep the roundabout path and make the lookup stricter.** No new columns; fix `loadProposalEventContext` to
prefer the enquiry's bookings and to refuse a tie.
*Why not:* cheapest by far, but a proposal with no floor plan and no held date still has no event, nothing is
enforced, and every reader keeps paying for the lookup. The plan's test ("no live proposal without its event")
cannot be met by a lookup.

**D. Make the deal the hub**, as a sales database does: everything hangs on the deal, and the event hangs on it
too.
*Why not:* holds and bookings already hang on the event, the plan's shape has two kinds of page (an event and a
person), and piece C is to remove the word "opportunity" from every screen. It would build the spine around the
record the plan is folding away.

## 5. The change

### 5.1 The links

- `enquiries.event_id`, `opportunities.event_id`, `proposals.event_id`: nullable at first, each with the key
  `(event_id, venue_id)` to `events (id, venue_id)`, refusing deletion, as bookings have.
- A deal's link is unique among open deals: an event has at most one deal that is not lost, archived or deleted.
  Old lost deals may still point at the event as history. (My call: the brief says "unique"; a strict
  one-deal-ever rule would stop a client who comes back after a lost deal.) From the first release, making a
  second open deal on an event is refused with a message that names the first. The unique index itself is added
  in the second migration, after old collisions have been settled on the review list.
- First, `opportunities` gains `unique (id, venue_id)`. `client_accounts` already has it (schema:920). Then the
  event's `client_account_id` key is rebuilt to include the venue, before anything writes it.
- **Which records must have an event** (one definition, used by the writers, the backfill and the count):
  - a proposal that is not deleted and has been sent (sent, changes requested or accepted), or has an agreement,
    or has a deposit request in force, or is a draft made for a deal or an enquiry;
  - a deal that is not deleted, lost or archived;
  - an enquiry that has been worked (section 5.2) and is not rejected, withdrawn or archived; or that any held
    date, booking, deal or proposal with an event points at.
- **Where each gets it.** A proposal takes the event of its deal, or else of its enquiry, when it is made. A
  draft made from a plan alone has none until it is sent; then it takes the one event its plan is linked to, or
  a new one. (The plan allows a sketch that joins an event later; a draft price on that sketch is the same.) A
  deal takes its enquiry's event, or a new one when it has no enquiry. Changing a proposal's deal or enquiry
  moves its event with it in the same transaction, and is refused once the proposal has an agreement or a
  deposit request in force.
- Agreements carry no event of their own: they reach it through their proposal. They cannot be changed, so they
  could not be backfilled or moved in a merge anyway. A quote reaches its event through its proposal, or else
  its deal, or else its enquiry. A quote tied to nothing but a room is a price check, not business, and has none.
- The deposit request keeps its existing `event_id` column for now. Today it is filled once, from the lookup,
  read before the transaction opens, and nothing reads it back (`api/src/routes/deposits.ts:152-178`). After
  this it is copied from its proposal inside the transaction, under the proposal's lock. The count checks the
  two agree. A later tidy-up may remove the column; that is left to the builder.
- `loadProposalEventContext` is deleted. Its two callers read the proposal's own link. One effect: a proposal
  that had no event said nothing when staff changed it; now its changes are announced on its event, to staff,
  as linked proposals' changes are today.
- **A link, once made, can be moved but never removed.** A small trigger refuses setting any of the three back to
  empty. Only the merge and the review list move a link.
- The event's unused `opportunity_id` is retired: the deal now points at the event, and two pointers in opposite
  directions would drift. It is dropped in the second migration if production still has none set.
- **The spine does not write the event's `client_account_id`.** An event's people are read through its enquiry
  (the person who asked) and its deal (the client), which now both reach the event. The column stays for the
  Diary import (piece A), where a booking arrives with a client and no enquiry. Section 5.8 says what happens to
  hold promotion when it is first written.

### 5.2 When an enquiry becomes an event (decided by Blake, 13 November)

**When someone first works it.** Until then it is only an enquiry, and opens as the Enquiries panel.
Working it means the first of:

- a reply is recorded (by email, phone, in person, a proposal sent, or a decision that says yes). A decision
  that turns the enquiry down is not working it and makes no event;
- a date is held or booked for it (as today);
- the venue books a viewing for it;
- a price is made for it: a deal, a quote or a proposal;
- a person chooses "open as an event".

The two choices he was offered beside it, and did not take:

- *When it arrives.* Simplest to explain. But every spam and duplicate enquiry becomes an event, the Events list
  fills with things nobody has looked at, and merging is needed from the first day.
- *Only when a date is first held* (today's behaviour). Nothing changes for the Diary. But a proposal sent before
  any date is held would still have no event, so a price would have to make one anyway.

How it is built: **one function, `ensureEnquiryEvent`,** is the only way an enquiry gets its event. It locks the
enquiry row, returns the event it already has, or makes one and writes `enquiries.event_id`. Every act in the
list above calls it. The bind then joins `enquiries.event_id` first, before looking at the enquiry's bookings, so
the first hold on a worked enquiry joins its event instead of making a second one. An event made this way has no
dates of its own: the date the client asked for stays on the enquiry and is shown as "asked for".

### 5.3 Who may see an event

A new table, `event_participants`: the event (pinned to its venue), the user, their part (client or planner), how
they came to be there, who added them and when, and when and by whom they were removed. One live row per user and
event.

- A client or planner may see an event when they have a live row. Staff are let in by their venue and role, as
  today, and need no row.
- **One rule, in one helper, replaces the three.** The schedule, the client's home, messages, requests, the
  room's day, proposing a time and phone notices all ask the same question. The old tests are deleted, not kept
  beside it.
- The table is about accounts that can sign in. A person in the People Book is not given sight of an event by
  being in the book: that rule of the People Book design stands
  (`docs/superpowers/specs/2026-10-18-people-book-design.md`, anti-goals).
- A row is made only by a plain act of a member of staff: adding the client to the event. Never by matching an
  email address, and never as a side effect of linking a plan.
- **Sight no longer hangs on a plan.** A client who has signed and paid keeps their event whether or not a plan
  was ever drawn, and until a person removes them.
- Someone who may see an event sees its shared facts (name, dates, timetable, its held dates) and only the plans
  that are theirs, as today.
- **A plan's owner no longer reads event facts by owning the plan alone.** The sheet and the handoff pack return
  an event's timings to a client or planner only if they may see that event.
- Linking a plan stops being a decision about access, so the reason for refusing to link a client's own plan
  goes. Whether to lift that refusal is left to the builder, with its tests.
- The rule answers one question: may this person see this event. Each page keeps its own choice of what to
  list. The client's home still leaves out events that are lost or cancelled; the schedule still lists only
  plans whose room exists.
- **What ships here and what does not.** The table, the rule, the helper, the leak test, and a staff route to add
  and remove a person. No button: it arrives with the event page (piece C), and Blake sees it first, because it
  decides what a client can open.
- **Nobody loses a door.** The backfill gives a row to everyone who passes the loosest of today's three rules.
  Someone who today passes the loose rule and fails the strict one would gain the schedule page for an event
  they can already message about. In production today that is nobody (section 3): no route can make the link.
- Lane L4 (planners) will use the same table when a planner invites a venue onto an event. This design leaves
  room for it and builds nothing for it.

### 5.4 The stage, the status and the dates

- **The stage is one pure function** in `@omnitwin/types`, worked out each time it is read and stored nowhere.
  It reads three things: the stored status, whether the event has a live hold, and whether it is over.

  | Stored status | Stage |
  |---|---|
  | draft or proposed, with no live hold | enquiry |
  | draft or proposed, with a live hold | provisional |
  | confirmed, in planning or ready for ops, not yet over | confirmed |
  | executed or closed, or any of the three above once the date has passed | done |
  | lost | lost |
  | cancelled | cancelled |

  Every stored status has a stage, including an event made by hand with no bookings, so the function can never
  disagree with the status. The words shown to people are chosen later by the first-click test; the code uses
  plain keys.
- The rank of a held date (1st option, 2nd option) stays on the held date. One event can hold a confirmed room
  and an option on another, so the stage never tries to say it.
- "Accepted", "signed" and "deposit received" are not stages. They are read from the proposal, the agreement and
  the payments when the event page asks. So a payment notice or a signature never has to write to the event at
  all.
- **The stored status stays worked out from bookings**, exactly as now. Nothing in this piece stores a new
  status word.
- **Dates move only through bookings.** Today an edit to an event's dates is accepted and then silently
  overwritten by the next Diary write (`api/src/services/event-mutations.ts:71-162`). After this, an edit to the
  dates of an event that has a live held date or booking is refused with a plain message that says to move the
  booking, the same way a status that disagrees with the Diary is refused today.
- **The lock order is the one the code already keeps, written down in full:** bookings, then the proposal, then
  the enquiry, then the deal, then the event. The bind locks bookings, the enquiry, then the event
  (event-binding.ts:41-45). Sending a proposal locks the proposal and then writes to its enquiry
  (`api/src/routes/proposals.ts:856-877`). Saving a version locks the proposal and then writes to its deal
  (proposals.ts:1219-1272). The People Book's merge writes enquiries before deals. Every new writer follows the
  same order. `ensureEnquiryEvent` locks the enquiry and then the event, so it fits when called from a send.
- New writers take the event with the lighter lock the status sync uses. The one heavier lock that exists, an
  edit of the event itself, stays as it is: it takes the event alone and only reads bookings.
- A payment notice or an acceptance writes its own rows and never needs the event, because nothing about them
  is stored on it.

### 5.5 Merge and split

Events will now be made earlier, so two enquiries about the same occasion will sometimes become two events. Merge
has to exist before that starts.

- **Merge** folds one event into another at the same venue. A named person does it and gives a reason. It is one
  transaction, and it takes its locks in the order of section 5.4, the two events last and lower id first.
- **What moves to the survivor:** held dates and bookings (the survivor's status and dates are then worked out
  afresh), the enquiry, deal and proposal links, deposit requests, plan links, who may see it, passes, packs,
  tasks, shifts and the plumbing's mail rows. Where the survivor already holds the same thing (the same plan
  linked the same way, the same person given sight), the duplicate is folded into one.
- **What stays on the loser:** its history. Its message threads (an event has one thread for each audience, by
  a rule of the database, schema:6518-6523), its feed of changes and its notices stay where they are. A page that shows an
  event's Story also reads the events merged into it. Its timetable stays too, unless a person has worked on it:
  every event is born with the same eight empty phases (event-binding.ts:126), and moving those would give the
  survivor two timetables. Phases someone has given a room or a time do move, for a person to tidy.
- **The loser is kept, never deleted.** It is marked as merged into the survivor by a new pointer and by the
  soft-delete date events already have. Its status word is not changed, and no new status word is stored.
- **A write that arrives on a merged event follows it.** A booking or a link written onto the loser at the same
  moment as the merge is re-pointed to the survivor by the writer itself, in the place every writer already
  passes (the status sync, and `ensureEnquiryEvent`). The count has a line that proves none is left behind.
- **Undo, for 30 days,** the same promise and the same rules as the People Book's merge
  (`api/src/services/people-merge.ts`): every move is logged; undo moves back only the rows that are still where
  the merge put them and names the rest in a report; a later merge of the same survivor must be undone first.
- Merge refuses when both events have an open deal, and says so: a person closes one as a duplicate first.
- **The guard that keeps merge honest:** a test reads the database's own list of every table that points at
  events, and fails if merge does not say, for each one, which of three things it does: move the rows; move them
  and fold duplicates (the same person given sight of both events becomes one row); or leave them, with the
  reason written down. A new table that points at events breaks the test until merge knows about it.
- **Split** is designed here and built with the event page (piece C), which is where a person would do it. A
  person picks the held dates, proposals and plans that leave; a new event is made for them and remembers which
  event it came from, so the Story is kept. After a split the enquiry stays with the first event, so a deal or a
  proposal may rightly sit on a different event from its enquiry; the count allows that. A signed agreement is
  never separated from the held dates it was signed for. Until agreements name their bookings (section 8.2,
  built by piece E) that means an event with a signed agreement cannot be split.
- Moving records between events on the review list (section 5.6) is the small version of the same operation and
  is built now. A deal and its proposals move together, because a proposal prices its deal's occasion. A
  proposal with no deal moves alone. The enquiry's own link is a separate question on the list.

### 5.6 The list of joins to check, and its screen

One new table, `event_link_reviews`, and one staff screen. A row is one question for a person: the record (a
proposal, a deal, an enquiry or a booking), why the join was doubtful, the events it could belong to, and, once
answered, who answered and what they chose. The 0090 rows that never had a screen are copied in, so there is one
list.

What the screen holds, in the desk composition already approved for the Enquiries desk:

```
Joins to check                                   3 to check, 41 joined by themselves
---------------------------------------------------------------------------
Proposal: Burns Supper, sent 2 November          could belong to 2 events
   ( ) Burns Supper, Saturday 23 January, Grand Hall, 1st option
   ( ) Burns Supper, Sunday 24 January, Saloon, provisional
   ( ) Neither: give it its own event
                                                  [ Join ]
---------------------------------------------------------------------------
Two events may be the same occasion              Trades House dinner, 12 March
   [ Merge them ]   [ They are different ]
```

The numbers in the sketch are made up. Each choice says what it will do before it does it, and each can be
undone. The screen ships only after Blake has seen it.

### 5.7 Headcount

The bind makes every event with a guest count of 0, meaning "nobody has said" (event-binding.ts:104-106, 121).
This piece does not own the numbers: piece G does. It adds one read that returns the numbers the record holds,
each with where it came from (the enquiry's estimate, the deal's count, the event's own three numbers), and
treats 0 as "not stated", never as a fact. Piece C shows them.

### 5.8 What it leaves alone, and three things it must say

- The Diary's bookings, the bind's own rule and its status table: unchanged.
- The viewing rule (a viewing has no event): unchanged. A viewing reaches the event through its enquiry.
- Handoff packs and supplier passes keep their optional event. They move in a merge; making them compulsory is
  not this piece.
- Notes still attach to a deal. "A note from anywhere" is piece D.
- No owner on events or enquiries here: that is piece C.
- The facts frozen into a proposal's version and its agreement stay as they are. They are the record of what was
  offered. Showing the event's own facts beside them is piece C.
- The payment and signing code is not changed here beyond reading the new link. A payment notice locks one
  payment row and never touches an event or a booking (`api/src/services/payments/deposit-ledger.ts:111-138`),
  which is why the lock order survives it.
- **Hold promotion.** When a 1st option lapses, the next in line's owner is given a drafted email. Nothing is
  sent by the server. Today the draft is addressed to the person on the enquiry. A dormant branch addresses it
  to the client account's main contact instead, as soon as the event has a client account
  (`api/src/services/hold-promotion.ts:324-353`). The spine does not write that column, so nothing changes now.
  Whoever writes it first changes the addressee and the greeting of that draft, and the label the sender sees
  becomes "the client's main contact". The spine makes that safe ahead of time: the key is pinned to the venue,
  and a test fixes the behaviour of both branches. The rule for the first writer: set it only from a person's
  choice or an import that names its source, never by inference.
- **Erasing a person (open pull request #247)** deletes an erased person's enquiries. Today that silently cuts
  the path from a proposal to its event. After the spine it does not: the proposal and the deal hold their own
  link. #247 finds a person's events through the event's `opportunity_id`, which this design retires; its owner
  will need to follow the deal's new link instead. Both pieces add a file to the same test list
  (`api/src/scripts/run-platform-postgres-tests.ts`), so whichever lands second rebases. It stays with its owner.
- **The People Book's merge** moves six kinds of record and its undo reads a fixed list
  (`api/src/services/people-merge.ts`). This design adds no table that links a person to an event, so that merge
  needs no change.

## 6. The rule in the database, and the check that proves it

The definition of which records must have an event is in section 5.1. There is one.

**The rules, once tightened (second migration):**

- A proposal that has been sent, or is a draft for a deal or an enquiry, must have an event: a check on the
  table, like the one bookings have.
- An open deal must have an event: the same. At most one open deal for each event: a unique index.
- A deposit request in force must have an event.
- Every link is pinned to its venue by its key. A link cannot be emptied.
- The parts of the definition a single table's check cannot see are held by the other rules together. A
  proposal has always been sent before it can have an agreement or a deposit request, so it already has its
  event by then, and the link cannot be emptied afterwards. The count proves it.

**The count** (`readBindInvariant`, extended). Every number must be zero:

| Count | What it finds |
|---|---|
| Unbound bookings; events that contradict their bookings | As today |
| Proposals without an event | A proposal that must have one (section 5.1) and has none |
| Agreements without an event | An agreement whose proposal has no event |
| Deposit requests without an event | In force, and no event |
| Open deals without an event; worked enquiries without an event | The same rule for the other two links |
| Events with two open deals | Held by the unique index once tightened |
| Links that disagree | A proposal and its deal on different events; a deposit request and its proposal on different events. A deal or proposal on a different event from its enquiry is allowed: that is what a split leaves |
| Links to a closed event | A record that must have an event pointing at a deleted or merged-away one |
| The event's `opportunity_id` in use | Must stay empty until it is dropped |

**Where it runs:**

- **On every change:** in CI, in the required database test job, on a throwaway database. Counts that the
  database makes impossible are asserted across the whole test database; the rest for the test's own venue,
  because that database is shared between tests.
- **In production:** twice, both with the existing read-only script. After every release, as a step of the
  deploy workflow following its migrations. And nightly, in the scheduled workflow that already runs against
  production (`.github/workflows/cleanup.yml`), so drift between releases is caught. A count above zero turns
  the run red and is reported. When the plumbing's job list exists (piece 0) the nightly run moves there and can
  raise an alert to a phone.
- **It reports; it does not block a release.** Railway releases by itself, and the count is deliberately not put
  in its pre-release step: a fault in the data must never be able to block the release that fixes it. (My call.)
- Until the list of joins to check is empty, production's count will not be zero. Each run states the number,
  and it must fall, never rise. The second migration cannot run before it reaches zero.

## 7. The backfill, the migration and the rollback

**Two migrations, each in its own merge slot.** Their numbers are fixed at merge by orchestration.

**The first adds and joins.** It is additive: the new columns and keys, `event_participants`,
`event_link_reviews`, the merge log, and a mapping table. Then it joins old records, in this order, never
guessing:

1. A record whose enquiry's held dates all sit in one event joins that event.
2. Otherwise, a record whose floor plan is linked to exactly one event joins that event.
3. Otherwise, a proposal whose deal's enquiry leads to exactly one event joins that event.
4. A record that must have an event (section 5.1) and that no path reaches gets a new event of its own, as a
   booking with no event did in October. A closed enquiry with nothing live pointing at it gets none.
5. A record that paths place in more than one event, or that two paths place in different events, is not joined.
   It goes on the list of joins to check. So do two open deals that would land on one event: neither is joined
   until a person closes one or gives it its own event.

Then it gives a row of sight to anyone who can reach an event today by the loosest of the three rules
(section 5.3), so nobody loses a door on the day.

- **What the step will meet in production, as measured on 13 November (section 3):** it makes one new event, for
  the one worked chain; it puts nothing on the list of joins to check; it gives no rows of sight. So the second
  migration can follow the first as soon as the writers are live and the count has read zero. The step is still
  built and tested for every path and every kind of doubt: the Diary import (piece A) will bring old records of
  all these kinds, and a second venue will bring its own.
- **The mapping table** records every join the step made: the record, the event, which path, and whether the
  event was made by the step. Migration 0090 kept none; this is what makes the step reversible.
- **The step is one repeatable database function.** It runs in the migration. Until the second migration, the
  deploy workflow and the nightly workflow each run it again before they count, to pick up anything the old
  server wrote in the minutes around a release. Running it twice changes nothing.
- **The second migration tightens:** it runs the step once more, refuses to continue unless the count is zero,
  then adds the checks and the unique index of section 6 and drops the retired column.

**Rollback.** The project has no down migrations; its rule is additive changes, a hand-written undo, and the
database backup as the last resort.

- The new server can be rolled back alone: the old server ignores the new columns.
- The joins can be undone by a function that reads the mapping table: it empties each link that still holds the
  value the step gave it, removes the events and the rows of sight the step made where nothing else has attached
  since, and leaves anything a person has changed, naming it in a report.
- The schema of the first migration is undone by a short written runbook that drops what it added.
- The second migration's checks can be dropped at any time. Its one destructive step, dropping the retired
  column, runs only if the column is empty.
- Last resort: the backup branch, as for every migration.

## 8. The money ledger (design only)

Nothing here is built by this piece, and nothing takes money. It is settled now so that "the yes that confirms"
(piece E) and "money right" (wave 1b) build on one design.

### 8.1 Payments

One ledger, `payments`, for money in and money back, by card, bank transfer, cash or cheque.

- Each row: the event and, where there is one, the agreement and the schedule line it pays; the amount; the
  method; the day the money arrived; who recorded it (a named person, or the payment provider); and the
  provider's reference or the bank reference.
- **Rows are never edited or deleted**, the rule agreements already follow. A mistake is put right by a new row
  that reverses the old one.
- A card payment arrives as the provider's notice. The same transaction writes the ledger row and queues the
  receipt, so each happens once. The existing card-checkout table stays as the record of attempts.
- A bank or cash payment is recorded by a person, with the evidence they saw. Money records never start from a
  typed sentence.
- Test payments are marked and never count in real totals.

### 8.2 What is due, and what an agreement covers

- **A schedule of what is due:** lines for the event (deposit, instalment, balance, damage deposit), each with an
  amount and a due day in the venue's own calendar. A payment is set against one or more lines, so one bank
  transfer can settle a deposit and part of the balance, and money not yet set against a line shows as "on
  account". Today's deposit request becomes the first kind of line.
- **Agreements name the bookings they cover:** a list written with each agreement version and, like it, never
  changed. "Ready to confirm" (piece E) can then ask: is there a signed agreement that names this held date, and
  has the venue's rule about money been met? The count gains one line: no agreement may name a booking in a
  different event.

### 8.3 A payment account for each venue (decided for Trades Hall by Blake, 13 November: option 1)

Compared on Stripe's own UK documentation and price pages, read 13 November 2026:

| | Who is the merchant | Who carries a chargeback | What we store | Our cost |
|---|---|---|---|---|
| **1. The venue's own Stripe account, connected to Venviewer; each payment made directly on the venue's account (recommended)** | The venue; its name is on the client's statement | The venue; Stripe covers losses | The account's reference, which is not a secret | None |
| 2. Accounts we control, with the money passing through ours | Venviewer | Venviewer | The same | Stripe's fees on every payment, to be recovered from the venue |
| 3. The venue's own account and a restricted key it pastes in | The venue | The venue | A key and a signing secret for each venue, encrypted | None |

- Option 1 is the plan's principle made real: the venue is the merchant, we take no commission and never hold a
  client's money. One notice address serves every venue.
- Option 2 makes Venviewer the merchant and puts client money through our account. That is the opposite of the
  principle, and it raises the question of permission from the financial regulator.
- Option 3 works and Stripe permits it as a fallback, but each venue sets up its own notices by hand, and we
  would hold every venue's key. It is kept as the fallback for a venue whose existing Stripe account cannot be
  connected; the plumbing (piece 0) provides the encrypted store for it.
- **What the venue pays Stripe** (its price page, 13 November): a standard UK card, 1.5% plus 20p; a premium UK
  card, 2.8% plus 20p. On a £1,500 deposit that is £22.70 or £42.20. A payment made from the client's bank app
  costs 0.5%, capped at about £5. So the design steers larger sums to bank payment and records a plain bank
  transfer at no fee.
- Stripe's charity discount needs most of an account's takings to be donations, so hall hire will not qualify.
- **Before any live payment:** the venue opens or connects its account; the accountant and a Scottish solicitor
  review; legal advice confirms that Venviewer, which never touches the money, needs no permission of its own;
  and Blake says yes in so many words. The database's test-only rule is lifted by a migration written for that
  day and no sooner.

**What this needs from the plumbing (agreed by message with lane L2):** queueing a follow-up inside the same
transaction as the ledger row; jobs that carry ids and read the ledger again when they run, so a moved due date
needs no cancelling; and the encrypted store, used only for option 3.

## 9. Tests first

Written before the code they test. Database tests run on real PostgreSQL with an explicit throwaway target.

- **The rule:** a live proposal, an open deal and a deposit request in force cannot be written without an event
  once tightened; a link to another venue's event is refused by the database; a link cannot be emptied.
- **Tenancy and the leak test** (the plan's own test): two clients with one event each at one venue, and a third
  at another venue. At every door that returns anything about an event (the schedule, the client's home, the
  room's day, proposing a time, messages and threads, requests, the sheet and the handoff pack of a plan, and
  notices), each client gets their own and is refused the others'. The list of doors is checked against the
  server's own route table, so a new route with no entry fails the test. It runs in the event-access gate in CI,
  with the existing client-home and conversation suites added to that gate.
- **One rule:** a case that today passes the loose test and fails the strict one (a plan whose room was deleted)
  gets the same answer at every door.
- **Becoming an event:** each act in section 5.2 makes exactly one event; a turned-down enquiry makes none; two
  acts at the same moment on one enquiry make one event, not two; the first hold on a worked enquiry joins its
  event. A draft made from a plan alone has no event until it is sent. A second open deal on an event is
  refused. Changing a proposal's deal moves its event; with an agreement in place it is refused.
- **Concurrent writes and the lock order:** a proposal being sent, a hold being placed and a merge, all on the
  same enquiry and event at once, finish without a deadlock; so do a payment notice, an acceptance and a booking
  write; two merges that cross finish or one is refused cleanly.
- **The stage:** every stored status gives a stage, with and without a live hold, before and after the date. For
  every pairing of status and bookings that the count accepts, the stage agrees with the status. A structural
  test fails if a stage column is ever added.
- **Dates:** an edit to the dates of an event with a live booking is refused; one with none is accepted.
- **The backfill:** a database written before the migration, with one case for each path and each kind of doubt;
  the real migrator; the expected joins, new events and review rows; then a second run that changes nothing.
- **The backfill's rollback:** after the undo, the touched tables match what was there before, row for row; a
  link a person changed in between is left and reported.
- **Merge:** every table that points at events is moved, folded or named as left; a duplicate plan link and a
  person with sight of both become one row; untouched default phases stay behind and worked ones move; a booking
  written onto the loser during the merge ends on the survivor; the undo restores what is still where the merge
  put it and reports the rest; a merge of two open deals is refused.
- **Hold promotion:** both branches of the addressee, fixed.
- **The count:** each line of the table in section 6 has a test that makes it non-zero and sees it counted.

## 10. Neighbours

- **Lane L2, the plumbing** (agreed by message, 13 November): it owns the job list, the outbox and the encrypted
  store. A follow-up is queued inside this piece's own transaction. Jobs carry ids and read the record again when
  they run. Its message rows carry the event, the enquiry or both, and never drop the enquiry once the event is
  set; mail on an enquiry nobody has worked reaches its event later through the enquiry's link. The act that
  records a staff reply (piece F) calls `ensureEnquiryEvent`. Its keys to events are pinned to the venue, refuse
  deletion and stay changeable, so merge can move them; where two events each hold a reply address for the same
  person, both addresses stay alive on the survivor. Its job runner opens no transaction around a handler, and
  its handlers follow the lock order of section 5.4.
- **Lane L3, the Diary:** imports bookings through `insertBoundBookings`, unchanged. It is the likely first
  writer of the event's client account, under the rule in section 5.8.
- **Lane L4, planners** (agreed by message, 13 November, subject to Blake): a planner's own event is the
  planner's record and is never a row in a venue's events. It points at the venue's event once the venue takes
  it in; the pointer sits on the planner's side, refuses deletion and stays changeable for merge. Taking it in is
  the venue working an enquiry that arrived from the planner, so there is one door into a venue's Events list.
  The planner is then added to `event_participants` by that act. L4 needs the refusal to link a planner's own
  plan lifted (section 5.3), so that is no longer only the builder's choice: it is lifted when L4's piece is
  built, with its tests.
- **#247, erase a person; the People Book's merge:** section 5.8.
- **Piece C** builds the event page, split, owners and the stage words on top of this. **Piece D** builds People
  on the enquiry and deal links. **Piece E** builds the ledger of section 8. **Piece G** owns the numbers.

## 11. Found while reading, for their owners

Not fixed by this piece. Each is named so it is not lost.

- Opening a card payment checks that the proposal is still accepted before its transaction, not inside it, so a
  withdrawal in between is not caught (`api/src/routes/deposits.ts:315-438`). Piece E.
- Withdrawing or archiving a proposal leaves its deposit request in force. Piece E.
- Signing an agreement takes no lock and is not tied to a change of the proposal's status at the same moment
  (`api/src/routes/contracts.ts:222-287`). Piece E.
- A proposal's share link has a "revoked" column and no route that sets it. Piece F.
- The production check of the Diary's own rule has never been scheduled. This piece schedules it (section 6).

## 12. Done when

Unchanged from the plan: a check that runs on every change and in production finds no live proposal, agreement or
deposit request without its event, and a test fails if one client can see another's event.

## 13. Calls made in this design, for Blake to check while reading

- One open deal for each event, with lost deals kept as history, in place of one deal ever. A second open deal
  on the same event is refused.
- A viewing the venue books counts as working an enquiry; a reply that turns it down does not.
- A draft proposal made from a plan alone has no event until it is sent. Every other proposal has one from the
  moment it is made.
- The production check reports and turns red; it does not block a release.
- In a merge, the loser's messages, change feed and untouched timetable stay on the loser and are read through
  it; everything else moves.
- Everyone who can reach any client door of an event today keeps it (the backfill uses the loosest of today's
  three rules).
- Sight of an event is given only by a member of staff adding the person, and lasts until a person removes it.
  It no longer depends on a floor plan. The button for it waits for the event page and Blake's eye.
- A plan's owner stops reading an event's timings by owning the plan alone.
- The spine does not write the event's client account; the Diary import is expected to be first.
- The event's unused deal pointer is retired in favour of the deal pointing at the event.
- Merge is built now; split is designed now and built with the event page.
- The production check runs in the deploy workflow and the nightly workflow until the job list exists.

## 14. Left to the builder

Table and column names; whether the deposit request's own event column is later removed; the exact wording of
refusals; index choices; how the review screen pages a long list; the order of the build's pull requests inside
the two migration slots.

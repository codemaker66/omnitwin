# The spine's links: every proposal, deal and enquiry that must have an event has one

Stage 1 of the spine ([design](../superpowers/specs/2026-11-13-the-spine-design.md),
sections 5.1, 6 and 7). The spine's links migration (`*_event_spine_links` in
`packages/api/drizzle`; its number is fixed when it merges). [The bind](the-bind.md)
already gives every hold and ink its event; this gives a proposal, a deal
(`opportunities`) and an enquiry the same link, so the event is the one place a
client's occasion is found. The rule is counted, not yet enforced: the links stay
nullable until a second migration tightens them (stage 6).

## The rule

One definition, in [`packages/types/src/event-spine.ts`](../../packages/types/src/event-spine.ts);
the SQL that counts and joins mirrors it and takes its sets as values:

- **A proposal** must have an event once it is sent (`sent`, `changes_requested`,
  `accepted`), when an agreement or a deposit request in force stands on it, or when
  it is a draft written for a deal or an enquiry. A deleted proposal never must.
- **A deal** must have an event while it is open (any stage but `lost` or
  `archived`). A deleted deal never must.
- **An enquiry** must have an event when something made from it (a booking, deal or
  proposal) sits in a live event of its venue, or once it has been worked (a first
  reply, a live hold, booking or viewing, a deal, proposal or quote) and is still
  open. A draft, or an enquiry that asks to book nothing (`isBookingEnquiry` false),
  never has one and never may.

What the database holds already:

- `enquiries.event_id`, `opportunities.event_id`, `proposals.event_id`, nullable,
  each pinned to its own venue by the key `(event_id, venue_id)` to
  `events (id, venue_id)`, `ON DELETE RESTRICT` (events are soft-deleted; no code
  deletes an event row). A deposit request's `event_id` (from the deposits
  migration) is pinned the same way.
- A link may be moved but never emptied: the trigger `event_link_is_kept` refuses
  setting it back to null, except inside the undo.
- At most one open deal per event (`opportunities_one_open_per_event`).
- An event's client account is its own venue's (`events_client_account_venue_fk`).
- Joining is never a guess: nothing is matched by name, email, title or date.

## Who writes each link

| Writer | From | What it writes |
| --- | --- | --- |
| The bind (`services/event-binding.ts`) | this pull request | a booking bound through its enquiry keeps the enquiry's link in step with the event it joined (not for a draft, or an enquiry that asks to book nothing); and when a person moves the enquiry's last live booking in its linked event to another event, the link moves with it (`followBookingToEvent`) |
| The deposit route (`routes/deposits.ts`, see [deposits](deposits-and-signatures.md)) | this pull request | a new request takes the event its proposal holds, read under the proposal's lock, or none when the proposal has none yet; the join then fills both together |
| The join of old records, `spine_join_old_records()` | this pull request | every link it can settle (below), every night, and by hand when asked to join |
| The undo, `spine_undo_joins()` | this pull request | empties what the join wrote; by hand only |
| Enquiries, deals and proposals (their routes) | the next pull request | each keeps its own link as it is made or moved |

The bind writes an enquiry's link only when nothing else of the enquiry's own (its
bookings, deals and proposals, its floor plan, or what a proposal of it with no event
reaches, as the join reads it below) reaches another live event of its venue; otherwise the booking joins its event as before and the link is left for the
list, where the join puts the enquiry for a person. Joining is never a guess, in the
bind as in the join. (One case is not listed: an enquiry whose link already names a
deleted event keeps that link, and the join reads only enquiries with no link. The
count shows it as a link to a closed event.)

Until the next pull request lands, the join is what joins new enquiries, deals and
proposals, so the count can read above zero between a record being made and the
next run.

## The join of old records

`spine_join_old_records()` returns `(joined, events_made, listed)`. The migration
calls it once; the nightly run, and a run by hand asked to join, call it again. Run
twice, the second run changes nothing, unless a chain of records needed more than the
four rounds one run makes (below): a later run finishes it. It is the only writer
of `event_link_joins`, the record of every
join it made (what makes it undoable). Its steps:

0. An open question whose record has its event by now (a writer gave it one) is
   closed as joined. One a person is answering at that moment is left to them.
1. **Enquiries** that may become an event, with none: joined to the one live event
   their bookings, deals and proposals sit in, or listed when they sit in several,
   or when their floor plan, or a proposal of theirs with no event, reaches another.
   With none, joined to the one live event their floor plan and their proposals with
   no event reach, or listed when they reach several. An event is made for one only
   when nothing of its own (held dates, deals, proposals, floor plan, and what its
   proposals with no event reach) reaches a live event.
2. **Deals** with no event, oldest first: joined to their enquiry's live event. With
   none, an open deal waits for its enquiry when the enquiry may become an event,
   has none, and something of the enquiry's own reaches one; otherwise it joins the
   one live event its own proposals with no event reach, or is listed when they
   reach several, and an event is made for it only when they reach none: for its
   enquiry too when the enquiry may become one and has none, so `eventsMade` can
   come from this step as well as from steps 1 and 3. An open deal is listed
   (`second_open_deal`), not joined, where an open deal already is. A closed deal
   whose enquiry has no live event is left, whatever its proposals reach.
3. **Proposals** with no event: joined to their deal's live event, else their
   enquiry's, else the one their deposit request in force names, and listed when the
   deposit request names another or a deleted event; one that must have an event is
   listed, too, when its floor plan is linked to a live event other than that one.
   With none of these, one that must have an event joins its floor plan's one live
   event, is listed when the plan reaches several, or has an event made, only after
   every proposal that reaches an existing event has been joined; one that need not
   joins its plan's one live event as history when it is over, and is otherwise
   left. A deposit request in force with no event takes its proposal's event in the
   same step.
4. Every event the join made gets the house's default phases, as 0090's did.

**What a proposal with no event reaches** is one rule, written once in the function
(`proposals_reach`): a live event through its deal's event, through its deposit
request in force, or through its floor plan when the plan is linked to exactly one;
a plan linked to several reaches them all, but only for a proposal that must have an
event. It is read for an enquiry's proposals (by `enquiry_id`) and for a deal's (by
`opportunity_id`), so nothing is made for either while a proposal of it reaches an
existing event. A proposal that names only its deal counts for that deal, not for
the deal's enquiry: when the enquiry is worked and open and nothing of its own
reaches an event, step 1 still makes its event and the deal joins it; such a
proposal that must have an event is then listed if its floor plan is linked to
another.

Steps 1 to 3 repeat while a round joins anything, **in up to four rounds**, so an
enquiry is settled from all of its deals and proposals together and the result
never depends on reading order. A made event is named by the enquiry, deal or
proposal it was made for (never an email; `Event` when blank), with its occasion cut
to 80 characters. **An event the join makes for an enquiry is named by the person's
name alone** (not "name — occasion", as the API will name one), and keeps that name
when its first date is held from the enquiry; staff can rename it. The join trims an
occasion and turns a blank one into none before cutting it; the bind only cuts it.

**Locks.** No table lock, and every row lock it asks for is `SKIP LOCKED`, so it
never waits for one of those. Each record is decided
on a plain read, then the rows it will write are locked `FOR NO KEY UPDATE SKIP
LOCKED` in the writers' order and decided again; an event it joins is taken `FOR KEY
SHARE SKIP LOCKED`. **Every value an event it makes is given (a name, a title, an
occasion) is read under a lock the join holds**: a row it writes is re-checked under
its lock to still hold the title or occasion it read, and a row it only reads one
from (the enquiry of a deal or a proposal when the event is not made for that
enquiry, the deal of a proposal) is taken `FOR SHARE SKIP LOCKED`, which a writer
changing that row conflicts with. So a row being changed (a title an erasure is
rewording) is skipped, and a change begun after the join took the row waits for its
run to commit, as a change to a row it writes does. **A row it cannot have at once,
or that changed, is left to the next run.** It can wait in two places. A deal's update that meets a writer's
uncommitted open deal on the same event waits at most 100 ms (set and restored
inside the function), and the deal is then listed or left. And its foreign keys take
key shares on venue rows: only a venue row held `FOR UPDATE` makes those wait, up to
the run's 5 s lock limit, and the whole run then rolls back. Every lock it takes is
held until it commits, which is why the runs keep it short (below).

**The list of joins to check** is `event_link_reviews`: one open question per record
and reason (`reaches_many_events`, `paths_disagree`, `second_open_deal`), with
counts and kinds in its text, never a name. October's two kinds of question
(`enquiry_events_differ`, `possibly_same_event`) were copied in without their text
and carry the id of the row they came from. A listed record is never touched by the
join; a deal or proposal whose enquiry is listed, and a proposal whose open deal has
no event, wait with it.

## The count

`readSpineInvariant` (`services/event-spine-invariant.ts`) is one read-only
statement: **nine numbers from thirteen sub-selects**, each of which can be scoped
to one venue. Every number must read zero:

| Number | What it counts |
| --- | --- |
| `proposalsWithoutEvent` | proposals that must have an event and have none |
| `agreementsWithoutEvent` | agreements whose undeleted proposal has no event |
| `depositRequestsWithoutEvent` | deposit requests in force with no event |
| `openDealsWithoutEvent` | undeleted open deals with no event |
| `workedEnquiriesWithoutEvent` | enquiries that must have an event and have none |
| `eventsWithTwoOpenDeals` | events with more than one undeleted open deal |
| `disagreeingLinks` | two parts: a proposal and its deal of the same venue on two events, and a deposit request in force and its proposal on two events (a deal or proposal on another event from its enquiry is allowed: a split leaves that) |
| `linksToClosedEvents` | four parts: proposals, deposit requests in force, deals and enquiries counted as needing an event whose event is deleted |
| `eventDealPointersInUse` | events naming a deal (`events.opportunity_id`, to be retired) |

**A deposit request in force is counted in its own right**, in all three places,
whatever became of its proposal: the later rule reads the request's own row, so a
deleted proposal must not hide one. This leaves a known gap in the money path:
soft-deleting an accepted proposal leaves its request in force. The count shows it
while the request has no event; once both carry the event, nothing counts it. A
later piece owns that; until then it is repaired by hand.

A listed record that must have an event is counted; one that need not (an unworked
enquiry whose floor plan reaches several events, say), and October's copies, are
not. A record waiting with a listed one (above) is counted too, while it must have
an event: it is why a red count can name more records than the list.
**So the count is expected to be above zero while a question is open on the
list**; the list is worked in a later stage (October's copies wait for stage 4).
`spineInvariantHolds` is true when all nine are zero.

## Where it runs

The operator's command, read-only unless `--join` is given:

```
pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts [--join]
```

The check itself is `services/event-rules-check.ts`. With `--join` it first runs the
join in a `READ COMMITTED` transaction of its own, with a 5 s lock limit, a 60 s
statement limit and a 30 s idle-in-transaction limit (the job stops at five minutes,
and every event the join links stays key-share-locked until it commits). A join that
fails rolls back whole and is reported as `joinRun: { error }`, by its error's name
and SQLSTATE only; the read still runs. Then one `REPEATABLE READ, READ ONLY`
transaction reads the bind's two counts, the spine's nine, the enquiries apart from
their bookings (`enquiriesApartFromTheirBookings`, see "Repairs by hand"), 0090's
list (`reviewList`) and the open questions (`joinsToCheck`), and a short read-only
transaction reads the migration state: the migrations ledger against the journal
the code ships (`migrations: { applied, local, pending }`).

It prints one line of JSON: `status` (`holds` when all eleven counts are zero,
`broken` when one is not), the counts, `enquiriesApartFromTheirBookings`, both
lists, `migrations`, and `joinRun` (`{ joined, eventsMade, listed }`) with
`--join`. The two lists and `enquiriesApartFromTheirBookings` never change the
status. When the read fails the line says `status: "unread"` with `readError`,
and still carries `migrations` and the join's outcome. An undefined function, table
or column is said in plain words: the spine's migration is not applied to this
database. Exit 0 when the rules hold; 1 when a count is not zero or the join failed;
2 for a setup error, a failed read, or a run stopped by a failure outside any
statement (a connection lost between two statements; then no line is printed).
Neither the connection string nor a database error's message is printed: the
workflow log is public.

**Every night, and by hand.** The Event rules workflow
([`event-rules.yml`](../../.github/workflows/event-rules.yml), "Event rules (reports
only; blocks nothing)") runs the command once a night with `--join`, and whenever
someone runs it from the Actions page (right after a release, say; by hand it reads
only unless asked to join, as below). **Run it from
master**: the job runs only on master's code, so a run started from another branch
does nothing. **By hand it reads only, unless its `join` box is ticked** (the input
defaults to false); the schedule joins every night whatever that default. A join by
hand against production is the founder's call.

The approved design planned a run after each release as well. It is not built:
Railway makes the release on its own clock, so a job in the deploy workflow could
not run after it.

- It names no environment, so no approval holds it. It reads the repository's
  `DATABASE_URL` secret, scoped to the one step that runs the command.
- It reports and turns red; **it blocks nothing**. No other workflow waits on it,
  and Railway releases by itself.
- One join runs at a time (its concurrency group). GitHub may start a scheduled run
  hours late, into the working day, so what protects the venue's writers is the
  join's short limits and its never waiting for a row it can skip, not the hour.
- **To know it read the right database**, look at `migrations` in its line. A
  database that Railway's releases migrate
  ([deploy flow](../operations/deploy-flow-current.md)) shows nothing pending once
  the release that carries a migration is live. A pending list that stays, or a
  count of applied migrations that differs from the journal's, means the secret names
  a database the releases do not migrate.

The `--join` flag goes when the rule is tightened (stage 6); the run then only
reads.

## Erasing a person, and the 24-month pass

A person's erasure (`services/people-erasure.ts`, `around()`) and the 24-month pass
(`services/people-retention.ts`, `lapsedPeople`) follow the three links: the events a
person's enquiries, deals and proposals point at are found whether the join made
them, a writer linked them, or nothing in `event_link_joins` records it. An event the
join made for one of those records is also found through `event_link_joins` after
the record's link has moved (a Diary edit that moves an enquiry's last booking, the
bind, or a repair by hand), so it cannot keep the name it was given. The join
names an event it makes, and its client, from the record (an enquiry's name, a deal's
or a proposal's title); erasure deletes the person's enquiries, rewords their deals and
proposals, and takes their names out of every event it finds, so a later run of the
join has no name to copy back.

- An event found through a link is the person's own unless another live person's
  record points at it too (`tiedToAnotherPerson`: their enquiry, deal or proposal
  linked to it, a booking of their enquiry in it, or it is their deal's); then it is
  near them, as the event of a deal another live person leads is. An event the join
  made for the person's record, with nothing tying it to another live person, is
  theirs. Own or near, the event is kept and loses only the erased person's names;
  an own event's confirmed booking or live hold, or a deposit request naming it,
  refuses the erasure.
- A confirmed booking or live hold from the person's own enquiry refuses the erasure
  in a near event too, as before the links, unless the event is another live
  person's deal's (its event, or one laid out from its proposal). An event that is
  near only because another person's record points at it does not take the person's
  own booking from them; the other person's bookings there never count as theirs.
- The events of a proposal the person only answered on (someone else's proposal they
  commented on or accepted for) are near them: their names leave those events as
  they leave the proposal's title.
- When the 24-month pass keeps a person for a booking and removes their enquiries
  that never became one, nothing of theirs is reworded. An event the join made for
  such an enquiry that nothing points at any more (no row of any table with a key to
  the event or to one of its phases, its own phases apart, and no deal or client
  account of its own) is renamed `Event` and its client name cleared; an event
  something still points at is left alone.
- A record of theirs linked between the erasure's reads and its locks makes it
  answer RETRY, as a booking written meanwhile does.
- The join copies a name only from a row it holds (above). An erasure under way when
  the join reaches the person's records makes it leave them for its next run, which
  reads the reworded text; an erasure that meets rows the join holds waits for the
  join's run to commit (at most the run's 60 s statement limit), then finds the
  new event through the record's link and answers RETRY, and tried again rewords it.
- The pass reads the same links with the same expression, so what it reads as kept
  or near agrees with what its step finds.
- **Whoever adds a new way to tie a record to an event** (another column that names
  an event, or a writer that makes events from a person's record) teaches `around()`
  and `lapsedPeople` the same day, with a case in
  `people-erasure-spine-links-postgres.test.ts`. Otherwise a person's name outlives
  their erasure on an event tied to nobody. When stage 6 retires
  `events.opportunity_id`, erasure's read of it and the expression's clause for it go
  in the same change.

## The lock rules later stages keep

The full order, combined with the Diary's, is kept in section 5.4 of the
[spine's design](../superpowers/specs/2026-11-13-the-spine-design.md) ("The stage,
the status and the dates").

- One order: a person, then a decision, then bookings, the proposal, the enquiry,
  the deal, the event. A decision (`decideDecision`, `services/decisions.ts`) is
  taken `FOR UPDATE`, then the one booking it moves `FOR UPDATE`, then
  `updateBookingCore` takes that booking again and reaches its event. A decision
  moves only a booking's times, never its event, so its path never reaches an
  enquiry, a deal or a proposal.
- An enquiry row is locked `FOR NO KEY UPDATE`, never `FOR UPDATE`, before any row
  that references it is inserted in the same transaction.
- New code takes an event only `FOR NO KEY UPDATE` (every row written onto an event
  holds `FOR KEY SHARE` on it, which `FOR UPDATE` would wait for). The one exception
  is the undo (`spine_undo_joins()`): it takes an event it removes, and that event's
  phases, `FOR UPDATE SKIP LOCKED`, so it never waits; an event it cannot have at
  once is left to its next run.
- No table locks in product code. The spine's migration takes its tables first, in
  two statements right after its 5 s lock limit, before any of its other steps
  (section 0 of the file; its comment says the same in the same words):
  - **On tables that existed before this migration, every lock stronger than ROW
    EXCLUSIVE is taken by these two statements, and no later statement takes a new
    one**: what a later statement takes on such a table is ROW EXCLUSIVE or weaker,
    or, on one of these seven, no stronger than what it holds here, so it shuts out
    nothing these two did not already.
  - `venues` and `users` first, in SHARE ROW EXCLUSIVE, the mode the keys of the two
    new tables (step 5) take on them. A writer such as an inventory decision updates
    its venue's row and then reads events; had the release held the five tables
    below and then waited for venues, it and such a writer could wait for each
    other. Taken first, venues makes the release wait for that writer while it holds
    nothing. Nothing was found that touches any of the five and then writes a row of
    venues or users, which would meet this order the other way round.
  - Then the five the steps lock outright (ACCESS EXCLUSIVE), in one statement in
    the writers' order: a proposal, its enquiry, the deal, the event, then the client
    account (`proposals`, `enquiries`, `opportunities`, `events`, `client_accounts`).
    Left to the steps, they would be taken deals first and proposals last, against
    that order, while a proposal sent during the release holds the proposal and then
    writes its enquiry: the two could wait for each other. With the lock limit set
    above, a table that cannot be had within five seconds fails the release cleanly,
    and nothing changes.
  - Later statements lock existing tables no more strongly, each to the end of the
    transaction: the five, the modes their steps' keys, indexes, triggers and writes
    take (SHARE, SHARE ROW EXCLUSIVE, ROW EXCLUSIVE, ROW SHARE, ACCESS SHARE), and
    ACCESS EXCLUSIVE again in the statements that add a column or a unique key, drop
    a key, or drop a trigger that is there, all under the ACCESS EXCLUSIVE held here; `venues`, `users`: SHARE ROW EXCLUSIVE again, and
    ACCESS SHARE, by step 5 (the new tables' keys to them); `venues`: ROW SHARE by
    steps 6 and 7 (the key checks of their inserts); `event_binding_reviews`: ACCESS
    SHARE by step 6 (the copy reads it); `bookings`, `event_configuration_links`,
    `proposal_contract_versions`, `quotes`: ACCESS SHARE by step 7 (the join reads
    them); `proposal_deposit_requests`: up to ROW EXCLUSIVE by step 7 (the join reads
    them, and a request takes its proposal's event); `event_phases`: ROW EXCLUSIVE by
    step 7 (the phases of the events it makes). Outside the seven, these modes
    conflict only with DDL and explicit table locks, never with a reader or a writer
    of rows.
  - A case pins it (`event-spine-links-migration-postgres.test.ts`, "the
    migration's locks on the tables it found"): on a database with rows, the
    strongest mode held on each existing table, read after the two statements and
    again before the commit, is these seven and nothing else.

## What a later migration must keep

The join and the undo are functions in the database, frozen as the spine's migration
wrote them, and the nightly run keeps calling the join. A later migration must keep
these four points, or replace the function in the same file:

- **No new `NOT NULL` column without a default on `events` or `event_phases`** while
  the join is still called: its inserts name their columns and are frozen.
- **No wholesale write to `events.updated_at` or `event_phases.updated_at`.** The undo
  keeps every made event whose `updated_at` is no longer its `created_at`, so a
  backfill that stamps every row would make the undo leave them all alone.
- **A second key to `events` on enquiries, deals, proposals or deposit requests**
  must replace `spine_undo_joins()` in the same file: it excludes recorded records by
  table, not by column.
- **A new deal stage, proposal status, enquiry state or request type that books
  nothing** must replace `spine_join_old_records()` in the same file: its four lists
  are written into it, not read from the definition in `@omnitwin/types`, and
  `event-spine-invariant-postgres.test.ts` fails, reading the function from the
  database, until they agree again.

## Repairs by hand

Each of these runs in production only on the founder's word, in a transaction with
`SET LOCAL lock_timeout = '5s'`, and the event rules are read afterwards.

- **A deposit request in force with no event whose proposal already has one.** Only
  an instance still running the previous release during a switch-over can write it,
  and the join does not repair it (it starts from proposals with no event). Copy the
  proposal's event onto it, only from an undeleted proposal whose event is live (a
  request on a soft-deleted proposal is the gap above, for a person; one copied onto
  a deleted event would only move to `linksToClosedEvents`):

  ```sql
  UPDATE proposal_deposit_requests r
  SET event_id = p.event_id
  FROM proposals p
  WHERE p.id = r.proposal_id AND p.venue_id = r.venue_id AND p.deleted_at IS NULL
    AND r.cancelled_at IS NULL AND r.event_id IS NULL AND p.event_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = p.event_id AND e.deleted_at IS NULL);
  ```

- **A deposit request naming a different event from its proposal** (it shows in
  `disagreeingLinks`) is a question for a person, not a statement to run: which
  event is the occasion has to be decided first.
- **A request in force on a soft-deleted proposal** (the gap above) is repaired by
  a person deciding whether the request still stands.
- **An enquiry apart from its bookings** (`enquiriesApartFromTheirBookings` in the
  line): its link names an event that holds none of its undeleted bookings, while
  some of those bookings sit in another live event of its venue. No writer of this
  release makes one and the join never does, so it is expected to read 0 right
  after a release. An instance still running the previous release during the
  switch-over can: the migration's join has given a worked enquiry with no held
  date an event of its own, and the old code, which ignores the link, puts the
  enquiry's first hold in a new event. Release in a quiet hour and read this number
  in the after-merge read. A person repairs one, deciding first which event is the
  occasion. If it is the enquiry's, move the booking into it from the Diary (an
  edit may move a booking to another event of its venue). If it is the bookings',
  move the enquiry's link to it, with the links of the enquiry's deals and
  proposals that name the first event, in one transaction (a link is moved, never
  emptied). In the same transaction the event left behind, which the join named
  from the enquiry, is renamed `Event` and its client name cleared. They are found
  by id alone:

  ```sql
  SELECT q.id AS enquiry_id, q.venue_id, q.event_id AS linked_event
  FROM enquiries q
  WHERE q.event_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b
      WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL AND b.event_id = q.event_id)
    AND EXISTS (SELECT 1 FROM bookings b JOIN events e ON e.id = b.event_id
      WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL
        AND e.deleted_at IS NULL AND e.venue_id = q.venue_id AND e.id <> q.event_id);
  ```

## Rolling back

Every production step below is taken only on the founder's word. The order is the
one Railway's pre-deploy gate allows (`scripts/migrate-before-deploy.ts` runs
`scripts/verify-migration-tail-readiness.ts` before it migrates). The gate refuses
a deploy when the migrations ledger is not an exact prefix of the image's journal
(more rows than the journal has, or a timestamp out of place), and when a pending
migration would create a table that already exists. So this order holds only while
the spine's migration is the newest one applied; once a later migration has been
applied on top of it, removing its row breaks the prefix, and the way back is
forward. Stop the joins (step 1), run the undo (step 2), then take the spine's code
out by a new commit that keeps the migration file and its journal entry. The columns
stay, nullable, holding only the links that writers other than the join wrote (the
bind's, in this pull request) and any join the undo left alone; the older writers
ignore them. (The backup branch remains the last resort.)

1. **Stop the joins.** Disable the Event rules workflow (Actions → Event rules →
   Disable workflow; it stops nothing else), or remove `--join` from it. Otherwise
   its next run joins again whatever the undo empties.
2. **Undo the joins, bounded:**

   ```sql
   BEGIN ISOLATION LEVEL READ COMMITTED;
   SET LOCAL lock_timeout = '5s';
   SET LOCAL statement_timeout = '120s';
   SELECT * FROM spine_undo_joins();
   COMMIT;
   ```

   `READ COMMITTED` is stated because the undo decides again under its locks, which
   needs a fresh snapshot for each statement (under `REPEATABLE READ` it could raise
   instead of leaving a row for its next call). An event the undo removes while a
   writer is attaching a row to it (a plan link, say) makes that writer's request
   fail on the key, which is why it runs at a quiet moment.

   It returns `(emptied, events_removed, left_alone)`. It empties each link that
   still holds the event the join gave it, removes an event the join made only when
   nothing has attached to it since, deletes the join's own open questions
   (October's copies stay), and leaves alone, counting it, anything a person has
   worked on since. It never waits for a row: what it could not lock stays in force,
   and a second call finishes it. The rows it does lock stay locked until it
   commits, and a writer that wants one waits for it; 120 s bounds that wait. If the
   limit is reached the undo rolls back whole and nothing is undone; run it again
   at a quieter moment, or with a longer limit. **It is slow on a large database**
   (one check per foreign key to events and phases for every made event, under
   locks). It is an operator's tool: run by hand, never on a schedule, and in
   production only on the founder's word.

   Events the undo keeps (counted in `left_alone`) stay, with their phases, after
   the columns are dropped below. The data is then not exactly as it was before the
   migration, by design: a person worked on them.
3. **Delete the spine's row from the migrations ledger:**
   `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <the journal's when for the *_event_spine_links tag>;`
   The running server reads the ledger on every `/health/ready`, so between this
   step and step 4 it answers 503 there (`MIGRATIONS_PENDING`). Railway reads that
   path only when it deploys, so nothing restarts, but an outside monitor on it will
   alarm: that is expected. Before this step a release from before the spine is refused
   by the gate, because the ledger holds more migrations than its journal.
4. **Revert the spine's merge on master** (or deploy the commit before it) and
   wait until that release is live. While the ledger row is gone and the objects
   remain, a deploy of any commit that still carries the spine is refused by the
   gate (its migration is pending and would create tables that already exist).
   That refusal is safe, and it is why master is reverted before anything is
   dropped: the older release passes the gate and ignores the new columns.
5. **Drop what the migration added**, by hand, in reverse order, in one transaction
   whose lock limit holds every statement short:

   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   DROP FUNCTION IF EXISTS spine_undo_joins();
   DROP FUNCTION IF EXISTS spine_join_old_records();
   DROP TABLE IF EXISTS event_link_reviews;
   DROP TABLE IF EXISTS event_link_joins;
   DROP TRIGGER IF EXISTS proposals_event_link_kept ON proposals;
   DROP TRIGGER IF EXISTS opportunities_event_link_kept ON opportunities;
   DROP TRIGGER IF EXISTS enquiries_event_link_kept ON enquiries;
   DROP FUNCTION IF EXISTS event_link_is_kept();
   DROP INDEX IF EXISTS opportunities_one_open_per_event;
   DROP INDEX IF EXISTS proposals_event_idx;
   DROP INDEX IF EXISTS opportunities_event_idx;
   DROP INDEX IF EXISTS enquiries_event_idx;
   ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_event_venue_fk;
   ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_event_venue_fk;
   ALTER TABLE enquiries DROP CONSTRAINT IF EXISTS enquiries_event_venue_fk;
   ALTER TABLE proposals DROP COLUMN IF EXISTS event_id;
   ALTER TABLE opportunities DROP COLUMN IF EXISTS event_id;
   ALTER TABLE enquiries DROP COLUMN IF EXISTS event_id;
   ALTER TABLE events ADD CONSTRAINT events_client_account_id_fkey
     FOREIGN KEY (client_account_id) REFERENCES client_accounts(id) ON DELETE SET NULL;
   ALTER TABLE events DROP CONSTRAINT IF EXISTS events_client_account_venue_fk;
   ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_id_venue_unique;
   COMMIT;
   ```

   The statements undo the migration's steps in reverse, object by object: the undo
   and the join functions, the two tables, the three triggers before their function,
   the indexes before the keys and the keys before the columns, then the
   single-column client-account key back in place before the venue-pinned one goes,
   and last the deal's `(id, venue_id)` key, which nothing else references. A
   deposit request's `event_id` belongs to the deposits migration and stays; the
   undo has already emptied what the join wrote there. A later release may then
   apply the migration afresh.
6. The last resort, as for every migration, is the backup branch taken before the
   release.

## Checks

- `packages/types/src/__tests__/event-spine.test.ts`: the definition, rule by rule.
- `packages/api/src/__tests__/event-spine-links-schema-postgres.test.ts`: the
  venue-pinned keys, a link moved never emptied, one open deal per event.
- `packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts`: the
  migration run by the real migrator over rows written before it, the join's paths
  and kinds of doubt, a replay that changes nothing, and the undo.
- `packages/api/src/__tests__/event-spine-bind-postgres.test.ts`: a hold joins its
  enquiry's own event first and keeps the enquiry's link in step, and writes no link
  where the join would list the enquiry (checked against the join itself).
- `packages/api/src/__tests__/event-spine-invariant.test.ts` and
  `event-spine-invariant-postgres.test.ts`: the count, each number counting what it
  names and nothing else, one venue at a time.
- `packages/api/src/__tests__/event-rules-check-postgres.test.ts`: the check and its
  command. The read writes nothing; a join refused a lock within 5 s rolls back whole
  and the counts are still read; a shorter statement limit ends the join first; the
  join settles a worked chain (enquiry, deal, sent proposal, deposit request) to
  zero; the lists leave the status alone; an unknown argument exits 2 before
  anything is read; the command prints one line of JSON, with the migration state
  and without the connection string; and on a database the spine's migration has not
  reached it exits 2 and says so in plain words, with the join's outcome and the
  pending tag.
- `packages/api/src/__tests__/deposits-postgres.test.ts`: a deposit request is for
  its proposal's own event, or none while the proposal has none.
- `packages/api/src/__tests__/people-erasure-spine-links-postgres.test.ts`: erasure
  and the 24-month pass follow the links. The join's made events for an enquiry, a
  deal and a proposal lose the person's name; a link with no record of the join is
  found the same; an event a second live person is tied to is kept and near, and the
  person's own booking there still keeps them; a made event whose record's link has
  moved is found through the join's record; the event of a proposal they only
  answered on is near; a kept person's removed enquiry leaves its made event named
  `Event` once nothing points at it; the pass's readings agree with its step; a link
  written while the erasure waits answers RETRY; the join and the undo run cleanly
  afterwards.

Each spine suite makes and drops a database of its own on the platform test
cluster; the platform gate (`test:platform-db`) names them all.

## Not in this slice

The enquiry, deal and proposal writers (the next pull request); the screen for the
list of joins to check; merge and split; who may see an event; and the second
migration, which refuses to run unless the count reads zero, then adds the checks
and the unique rules and retires `events.opportunity_id` (stage 6).

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
| The bind (`services/event-binding.ts`) | this pull request | a booking bound through its enquiry keeps the enquiry's link in step with the event it joined (not for a draft, or an enquiry that asks to book nothing) |
| The deposit route (`routes/deposits.ts`, see [deposits](deposits-and-signatures.md)) | this pull request | a new request takes the event its proposal holds, read under the proposal's lock, or none when the proposal has none yet; the join then fills both together |
| The join of old records, `spine_join_old_records()` | this pull request | every link below, after each release and each night |
| The undo, `spine_undo_joins()` | this pull request | empties what the join wrote; by hand only |
| Enquiries, deals and proposals (their routes) | the next pull request | each keeps its own link as it is made or moved |

Until the next pull request lands, the join is what joins new enquiries, deals and
proposals, so the count can read above zero between a record being made and the
next run.

## The join of old records

`spine_join_old_records()` returns `(joined, events_made, listed)`. The migration
calls it once; the two production runs call it again. Run twice, the second run
changes nothing. It is the only writer of `event_link_joins`, the record of every
join it made (what makes it undoable). Its steps:

0. An open question whose record has its event by now (a writer gave it one) is
   closed as joined. One a person is answering at that moment is left to them.
1. **Enquiries** that may become an event, with none: joined to the one live event
   their bookings, deals and proposals sit in, or listed when they sit in several;
   an event is made for one only when nothing of its own (held dates, deals,
   proposals, floor plan) reaches a live event.
2. **Deals** with no event, oldest first: joined to their enquiry's event; a second
   open deal on that event is listed (`second_open_deal`), not joined.
3. **Proposals** with no event: joined through their deal, their enquiry or their
   floor plan, or listed when the paths disagree or reach several events; an event
   is made only after every proposal that reaches an existing one has been joined.
   A deposit request in force with no event takes its proposal's event in the same
   step.
4. Every event the join made gets the house's default phases, as 0090's did.

Steps 1 to 3 repeat while a round joins anything, **in up to four rounds**, so an
enquiry is settled from all of its deals and proposals together and the result
never depends on reading order. A made event is named by the enquiry, deal or
proposal it was made for (never an email; `Event` when blank), with its occasion cut
to 80 characters.

**Locks.** No table lock, and it never waits for a row lock. Each record is decided
on a plain read, then the rows it will write are locked `FOR NO KEY UPDATE SKIP
LOCKED` in the writers' order and decided again; an event it joins is taken `FOR KEY
SHARE SKIP LOCKED`. **A row it cannot have at once, or that changed, is left to the
next run.** Its one bounded wait is a deal's update meeting a writer's uncommitted
open deal on the same event: at most 100 ms, set and restored inside the function.
Its foreign keys take key shares on venue rows; only a venue row held `FOR UPDATE`
makes those wait, up to the run's 5 s lock limit, and the whole run then rolls back.
Every lock it takes is held until it commits, which is why the production runs keep
it short (below).

**The list of joins to check** is `event_link_reviews`: one open question per record
and reason (`reaches_many_events`, `paths_disagree`, `second_open_deal`), with
counts and kinds in its text, never a name. October's two kinds of question
(`enquiry_events_differ`, `possibly_same_event`) were copied in without their text
and carry the id of the row they came from. A listed record is never touched by the
join, and a deal or proposal whose enquiry is listed waits with it.

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
soft-deleting an accepted proposal leaves its request in force, and the count will
show it. A later piece owns that; until then it is repaired by hand.

A listed record that must have an event is counted; one that need not (an unworked
enquiry whose floor plan reaches several events, say), and October's copies, are
not. **So the count is expected to be above zero while a question is open on the
list**; the list is worked in a later stage (October's copies wait for stage 4).
`spineInvariantHolds` is true when all nine are zero.

## Where it runs

The operator's command, read-only unless `--join` is given:

```
pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts [--join]
```

With `--join` it first runs the join in a transaction of its own with
`lock_timeout = 5s` and `statement_timeout = 90s` (the jobs stop at five minutes,
and every event the join links stays key-share-locked until it commits). A join that
fails rolls back whole and is reported as `joinRun: { error }`, by its error's name
and SQLSTATE only; the read still runs. Then one `REPEATABLE READ, READ ONLY`
transaction reads the bind's two counts, the spine's nine, 0090's list
(`reviewList`) and the open questions (`joinsToCheck`), and it prints one line of
JSON: `status` (`holds` when all eleven counts are zero), the counts, both lists,
and `joinRun` (`{ joined, eventsMade, listed }`) with `--join`. The two lists never
change the status. Exit 0 when the rules hold; 1 when a count is not zero or the join
failed; 2 for a setup error or a failed read. Neither the connection string nor a
database error's message is printed: the workflow logs are public.

Two production runs, both with `--join`, each a job of its own named "Event rules
(reports only; never blocks a release)". No job needs either, so **a red run
reports; it blocks no release** (Railway releases by itself):

- **Every night**, the `event-rules` job in
  [`cleanup.yml`](../../.github/workflows/cleanup.yml), beside the clean-up on the
  same schedule. Like the clean-up it names no environment, so no approval holds it,
  and it reads the repository's `DATABASE_URL` secret, the one the clean-up uses.
  **This is the run that happens in practice today.**
- **After every release**, the `event-rules` job in
  [`deploy.yml`](../../.github/workflows/deploy.yml), with `needs: migrate` and the
  migrate job's own `if:` and `environment: production`. It runs only when the
  migrate job does, and it waits for its own approval on the Production environment.
  For this run to happen, someone must approve the Deploy workflow's runs: the
  migrate job waits there for a reviewer, and while one run waits, the workflow's
  concurrency group holds every later run queued behind it, each cancelled by the
  next. In practice Railway's pre-deploy command applies migrations
  ([deploy flow](../operations/deploy-flow-current.md)), and through it the
  migration's own call of the join.

The `--join` flag goes from both jobs when the rule is tightened (stage 6); they
then only read.

## The lock rules later stages keep

- One order: a person, then bookings, the proposal, the enquiry, the deal, the
  event.
- An enquiry row is locked `FOR NO KEY UPDATE`, never `FOR UPDATE`, before any row
  that references it is inserted in the same transaction.
- New code takes an event only `FOR NO KEY UPDATE` (every row written onto an event
  holds `FOR KEY SHARE` on it, which `FOR UPDATE` would wait for).
- No table locks.

## Repairs by hand

Each of these runs in production only on the founder's word, in a transaction with
`SET LOCAL lock_timeout = '5s'`, and the event rules are read afterwards.

- **A deposit request in force with no event whose proposal already has one.** Only
  an instance still running the previous release during a switch-over can write it,
  and the join does not repair it (it starts from proposals with no event). Copy the
  proposal's event onto it:

  ```sql
  UPDATE proposal_deposit_requests r
  SET event_id = p.event_id
  FROM proposals p
  WHERE p.id = r.proposal_id AND p.venue_id = r.venue_id
    AND r.cancelled_at IS NULL AND r.event_id IS NULL AND p.event_id IS NOT NULL;
  ```

- **A deposit request naming a different event from its proposal** (it shows in
  `disagreeingLinks`) is a question for a person, not a statement to run: which
  event is the occasion has to be decided first.
- **A request in force on a soft-deleted proposal** (the gap above) is repaired by
  a person deciding whether the request still stands.

## Rolling back

1. **Stop the two production runs of the join first**: remove `--join` from both
   `event-rules` jobs, or disable them. Otherwise the next run joins again whatever
   the undo empties.
2. Undo the joins: `SELECT * FROM spine_undo_joins();` It returns
   `(emptied, events_removed, left_alone)`. It empties each link that still holds
   the event the join gave it, removes an event the join made only when nothing has
   attached to it since, deletes the join's own open questions (October's copies
   stay), and leaves alone, counting it, anything a person has worked on since. It
   never waits for a row; what it could not lock stays in force and a second call
   finishes it. **It is slow on a large database** (one check per foreign key to
   events and phases for every made event, under locks), and it is an operator's
   tool: run by hand, never on a schedule, and in production only on the founder's
   word.
3. Roll the server back to the release before the spine (the older server ignores
   the new columns). The steps below drop what this release's code reads, so they
   come only after that.
4. Drop what the migration added, in reverse order, in one transaction with
   `SET LOCAL lock_timeout = '5s'`:

   ```sql
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
   ```

   A deposit request's `event_id` belongs to the deposits migration and stays; the
   undo has already emptied what the join wrote there. Then delete the migration's
   own row from `drizzle.__drizzle_migrations` (its `created_at` is the journal's
   `when` for the `*_event_spine_links` tag), so a later release applies it afresh.
5. The last resort, as for every migration, is the backup branch taken before the
   release.

## Checks

- `packages/types/src/__tests__/event-spine.test.ts`: the definition, rule by rule.
- `packages/api/src/__tests__/event-spine-links-schema-postgres.test.ts`: the
  venue-pinned keys, a link moved never emptied, one open deal per event.
- `packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts`: the
  migration run by the real migrator over rows written before it, the join's paths
  and kinds of doubt, a replay that changes nothing, and the undo.
- `packages/api/src/__tests__/event-spine-bind-postgres.test.ts`: a hold joins its
  enquiry's own event first and keeps the enquiry's link in step.
- `packages/api/src/__tests__/event-spine-invariant.test.ts` and
  `event-spine-invariant-postgres.test.ts`: the count, each number counting what it
  names and nothing else, one venue at a time.
- `packages/api/src/__tests__/event-rules-check-postgres.test.ts`: the operator's
  command. The read writes nothing; a join refused a lock within 5 s rolls back whole
  and the counts are still read; the join settles a worked chain (enquiry, deal, sent
  proposal, deposit request) to zero; the lists leave the status alone; the command
  prints one line of JSON without the connection string.
- `packages/api/src/__tests__/deposits-postgres.test.ts`: a deposit request is for
  its proposal's own event, or none while the proposal has none.

Each spine suite makes and drops a database of its own on the platform test
cluster; the platform gate (`test:platform-db`) names them all.

## Not in this slice

The enquiry, deal and proposal writers (the next pull request); the screen for the
list of joins to check; merge and split; who may see an event; and the second
migration, which refuses to run unless the count reads zero, then adds the checks
and the unique rules and retires `events.opportunity_id` (stage 6).

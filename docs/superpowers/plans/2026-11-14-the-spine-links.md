# The links (stage 1 of the spine, T-704) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every proposal, deal and worked enquiry points at its event in the database, old records are joined
without a guess, and a count that must read zero proves it on every change and in production.

**Architecture:** Three nullable `event_id` columns, each pinned to its venue by a composite key to `events`, the
way a booking's already is. One definition of "must have an event" lives in `@omnitwin/types`; the writers, a
repeatable SQL join for old records and a read-only count all follow it. One function, `ensureEnquiryEvent`, is
the only way an enquiry gets its event, and the bind joins the enquiry's own link before it looks at bookings.
The columns stay nullable in this stage; the rule is tightened in a later stage, once production has read zero.

**Tech Stack:** TypeScript strict, Fastify, PostgreSQL through Drizzle (hand-written SQL migrations, PL/pgSQL for
the join and its undo), Zod, Vitest on real PostgreSQL, GitHub Actions for the two production runs.

**Spec:** `docs/superpowers/specs/2026-11-13-the-spine-design.md` (sections 3, 5.1, 5.2, 5.8, 6, 7 and 9). Read it
with this plan: the plan argues from it. Blake approved it on 13 November 2026.

## The whole build, in order

This plan is stage 1. Each later stage gets its own plan when the one before it is building.

| Stage | What it builds | Database change | Waits for |
|---|---|---|---|
| **1. The links (this plan)** | The three links, the join of old records and its undo, the count, the bind and every writer | Yes: slot 1 | Nothing |
| 2. Who may see an event | `event_participants`; one rule in place of the three (spec 5.3); a staff route to add and remove a person; the leak test in the event-access gate; a plan's owner no longer reads an event's timings by owning the plan | Yes: slot 2 (the table, and a row for everyone who can reach an event today) | Nothing in stage 1's code; its slot follows slot 1 |
| 3. The event's own facts | The stage as one pure function in `@omnitwin/types` (spec 5.4); an edit to the dates of an event with a live booking refused; the headcount read with its sources (spec 5.7) | None | Nothing |
| 4. Merge, and the list of joins to check | `events.merged_into_event_id`, the merge log, merge and its 30-day undo, the guard test over every key to `events`, writers that follow a merged event; the review list's routes (spec 5.5, 5.6) | Yes: slot 3 | Stages 1 and 2 |
| 5. The screen for the joins to check | The staff screen of spec 5.6. Blake sees it before it ships | None | Stage 4 |
| 6. Tighten | The checks of spec section 6; `events.opportunity_id` dropped; the two workflows stop joining | Yes: slot 4 | Production reading zero with the list empty, and pull request #247 no longer reading that column |

The money ledger (spec section 8) is a design only. Pieces E and wave 1b build it.

**Where this plan departs from the design's letter, and why.** None changes what Blake approved.

1. **Four small database changes, not two.** The design put every new table in the first migration. Here each
   table lands with the code that writes it, so no table sits unused, which is the project's own rule and the
   platform plan's complaint about "a table nothing writes". Each still merges alone in its own slot.
2. **The one-open-deal index lands now, not at tightening.** Production holds no enquiry with two deals
   (measured 13 November), and the join never puts a second open deal on an event, so the index cannot fail.
   The database then backs the refusal from the first day, including when two people press at once.
3. **`readSpineInvariant` stands beside `readBindInvariant`** instead of widening it. Nine existing assertions
   compare the bind's result exactly, and they stay untouched.
4. **A deal or proposal whose enquiry is on the list of joins to check waits with it.** It is not given a new
   event while its enquiry's event is in doubt.
5. **An enquiry that asks to book nothing never becomes an event.** Access requests and enquiries about
   Venviewer ride the enquiry route (`NON_BOOKING_ENQUIRY_TYPES`); the design did not name them.

**Left open for piece C's design, not decided here:** what closes an event that never had a booking when its
enquiry is later turned down or withdrawn. Today such an event stays a draft.

**Not in this plan.** Stages 2 to 6 above. Anything a client sees. Any write to `events.client_account_id` or
`events.opportunity_id`. Pull request #247 (erase a person) and the People Book's merge, which stay with their
owners.

## Global Constraints

- **One definition of "must have an event"** (Task 1). The writers, the SQL join and the count each follow it,
  and Task 3's test fails if the SQL and the TypeScript drift apart.
- **A link may be moved, never emptied.** A trigger refuses setting `event_id` back to null. Only the undo
  function may, inside its own transaction.
- **Every link is pinned to its venue** by the key `(event_id, venue_id)` to `events (id, venue_id)`,
  `ON DELETE RESTRICT`.
- **Joining is never a guess.** Nothing is matched by name, email, title or date. A record that paths place in
  more than one event is listed for a person and left alone.
- **A draft enquiry, or one that asks to book nothing (`isBookingEnquiry` false), never becomes an event,** and
  the bind writes no link for one.
- **Lock order: bookings, then the proposal, then the enquiry, then the deal, then the event.** A person is
  locked before any of them, as the People Book's merge requires (`services/people-merge.ts:50-80`). New code
  takes an event only `FOR NO KEY UPDATE`, never `FOR UPDATE`, and never calls an outside service while holding
  a row lock on an event or a booking.
- **An enquiry row is locked `FOR NO KEY UPDATE`, never `FOR UPDATE`,** by the bind, by `ensureEnquiryEvent` and
  by the join. Every row that references an enquiry holds a key share on it, and `FOR UPDATE` taken after such
  an insert deadlocks two writers. `event_id` is not a key column, so the lighter lock is enough. The enquiry is
  also locked before any row that references it is inserted in the same transaction.
- **No table lock anywhere.** The join and its undo lock each record by its own row, in the order above, and
  read its condition again under that lock before writing.
- **An event's `event_type` is cut to its column's 80 characters wherever an event is made.** An enquiry's or a
  deal's may hold 100.
- **Product code never deletes an event row.** Only the undo function removes events the join itself made, and
  only when nothing else points at them.
- **This stage writes neither `events.client_account_id` nor `events.opportunity_id`.** The count proves the
  second stays empty.
- **The migration is hand-written SQL,** as every recent one is: `--> statement-breakpoint` between statements;
  `SET LOCAL lock_timeout = '5s'` first and `SET LOCAL lock_timeout TO DEFAULT` last (the migrator runs every
  pending file in one transaction, as `0090:299` and `0104:233` note); every step skips what is already in
  place, so running the file again changes nothing. Its number is the next free one on the branch and is fixed in the merge slot (Task 14). Only
  Task 2 and that slot touch `schema.ts` or `drizzle/meta/_journal.json`.
- **Tests run on real PostgreSQL, on the explicit throwaway platform database**
  (`VENVIEWER_PLATFORM_TEST_DATABASE_URL`, database `venviewer_platform_test` on `127.0.0.1:55477`). Never
  `DATABASE_URL`, never `.env`. That database is shared and never truncated, so every test makes its own venue.
  Every new suite is named in `PLATFORM_POSTGRES_TEST_FILES`
  (`packages/api/src/scripts/run-platform-postgres-tests.ts`), which fails the run if a file is missing or skips.
- **TypeScript strict, no `any`.** Relative imports carry `.js`. Tests live in `packages/api/src/__tests__/`, and
  a database suite's name ends `-postgres.test.ts`.
- **A refusal is plain words with an UPPER_SNAKE code,** as the routes around it are.
- **No personal data in a review row, a log or a report:** kinds, ids and counts only.
- **The repository is public.** No address, local path, session id or venue-private fact in code, tests, logs or
  commit messages.
- **Commits** name their files explicitly and end with the project's co-author line.

## Review Focus

Inputs and failures the spec implies but does not test, most likely first. Each has its test in the task that
owns the code.

1. **A reply recorded on an enquiry that asks to book nothing.** It must not become an event. (Task 8: "an
   access request never becomes an event".)
2. **A reply recorded on an enquiry already turned down, withdrawn or marked done.** No event. (Task 8: "a reply
   reported on a turned-down enquiry makes none".)
3. **An enquiry whose link points at a deleted event.** The next hold must not join a deleted event: a new one
   is made and the link moves. (Task 6: "a link to a deleted event is not joined".)
4. **A proposal edited to have no deal and no enquiry.** It keeps its event; the edit answers 200, not a 500
   from the trigger. (Task 10: "taking its deal and enquiry away keeps its event".)
5. **Two deals pressed at the same moment from one enquiry by two routes,** and a platform admin reopening a
   lost deal beside an open one. One open deal stands; the other press is answered plainly, never a 500.
   (Task 12: "two deals pressed at once"; Task 9: "reopening a lost deal".)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/event-spine.ts` | The one definition: which records must have an event |
| `packages/api/drizzle/<next>_event_spine_links.sql` | Columns, keys, the open-deal index, the kept-link trigger, the two tables, the join and its undo |
| `packages/api/src/db/schema.ts` | The same, for Drizzle |
| `packages/api/src/services/event-spine-invariant.ts` | The read-only count |
| `packages/api/src/services/event-binding.ts` | The bind joins the enquiry's own link first, and writes it |
| `packages/api/src/services/enquiry-event.ts` | `ensureEnquiryEvent`; how an event made for an enquiry is named |
| `packages/api/src/services/event-links.ts` | The event a new deal takes; the event a proposal takes; the open-deal refusal |
| `packages/api/src/routes/enquiries.ts`, `bookings.ts`, `quotes.ts`, `crm.ts`, `opportunities.ts`, `proposals.ts`, `deposits.ts` | Each writer calls the two services above |
| `packages/api/src/scripts/check-booking-event-bind.ts` | The operator's read, now of both counts, with `--join` |
| `.github/workflows/deploy.yml`, `.github/workflows/cleanup.yml` | The two production runs |
| `docs/engineering/the-spine.md` | The rule, who writes, the join, the count, how to roll back |

---

# Part one: pull request 1 (the database slot)

Tasks 1 to 7. After it merges, old records are joined, the bind keeps an enquiry and its held dates on one
event, and the count runs after every release and every night. Records made by the old writers between then and
pull request 2 are joined by the next run of the join.

### Task 1: The one definition

**Files:**
- Create: `packages/types/src/event-spine.ts`
- Modify: `packages/types/src/index.ts` (add `export * from "./event-spine.js";` beside the line for
  `event-binding.js`, near line 2570)
- Test: `packages/types/src/__tests__/event-spine.test.ts`

**Interfaces:**
- Produces:
  - `OPEN_OPPORTUNITY_STAGES = ["new", "qualified", "proposal_drafting", "proposal_sent", "negotiation", "won"] as const satisfies readonly OpportunityStage[]`
  - `CLOSED_OPPORTUNITY_STAGES = ["lost", "archived"] as const satisfies readonly OpportunityStage[]`
  - `isOpenOpportunityStage(stage: OpportunityStage): boolean`
  - `SENT_PROPOSAL_STATUSES = ["sent", "changes_requested", "accepted"] as const satisfies readonly ProposalStatus[]`
  - `CLOSED_ENQUIRY_STATES = ["rejected", "withdrawn", "archived"] as const satisfies readonly EnquiryStatus[]`
  - `interface ProposalEventFacts { readonly status: ProposalStatus; readonly deleted: boolean; readonly hasDeal: boolean; readonly hasEnquiry: boolean; readonly hasAgreement: boolean; readonly hasDepositRequestInForce: boolean }`
  - `proposalMustHaveEvent(facts: ProposalEventFacts): boolean`
  - `dealMustHaveEvent(facts: { readonly stage: OpportunityStage; readonly deleted: boolean }): boolean`
  - `interface EnquiryWorkFacts { readonly replied: boolean; readonly hasHeldDate: boolean; readonly hasViewing: boolean; readonly hasDeal: boolean; readonly hasProposal: boolean; readonly hasQuote: boolean }`
  - `enquiryWorked(facts: EnquiryWorkFacts): boolean` (true when any one is true)
  - `enquiryMustHaveEvent(facts: { readonly state: EnquiryStatus; readonly eventType: string | null; readonly worked: boolean; readonly childHasEvent: boolean }): boolean`
  - `enquiryMayBecomeEvent(facts: { readonly state: EnquiryStatus; readonly eventType: string | null }): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
describe("which records must have an event", () => {
  it("a sent proposal must; a declined, expired, withdrawn or archived one need not", () => {
    for (const status of SENT_PROPOSAL_STATUSES) expect(proposalMustHaveEvent({ ...bare, status })).toBe(true);
    for (const status of ["declined", "expired", "withdrawn", "archived"] as const) {
      expect(proposalMustHaveEvent({ ...bare, status })).toBe(false);
    }
  });
  it("a draft must only when it is for a deal or an enquiry", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "draft" })).toBe(false);
    expect(proposalMustHaveEvent({ ...bare, status: "draft", hasDeal: true })).toBe(true);
    expect(proposalMustHaveEvent({ ...bare, status: "draft", hasEnquiry: true })).toBe(true);
  });
  it("an agreement or a deposit request in force makes any proposal need one", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "archived", hasAgreement: true })).toBe(true);
    expect(proposalMustHaveEvent({ ...bare, status: "withdrawn", hasDepositRequestInForce: true })).toBe(true);
  });
  it("a deleted proposal never must", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "accepted", deleted: true })).toBe(false);
  });
  it("a deal must unless it is lost, archived or deleted", () => {
    for (const stage of OPPORTUNITY_STAGES) {
      expect(dealMustHaveEvent({ stage, deleted: false })).toBe(stage !== "lost" && stage !== "archived");
      expect(dealMustHaveEvent({ stage, deleted: true })).toBe(false);
    }
  });
  it("an open enquiry must once it is worked; a closed one only when a child of it has an event", () => {
    expect(enquiryMustHaveEvent({ state: "submitted", eventType: "wedding", worked: false, childHasEvent: false })).toBe(false);
    expect(enquiryMustHaveEvent({ state: "under_review", eventType: null, worked: true, childHasEvent: false })).toBe(true);
    for (const state of CLOSED_ENQUIRY_STATES) {
      expect(enquiryMustHaveEvent({ state, eventType: null, worked: true, childHasEvent: false })).toBe(false);
      expect(enquiryMustHaveEvent({ state, eventType: null, worked: true, childHasEvent: true })).toBe(true);
    }
  });
  it("a draft, or an enquiry that asks to book nothing, never must and never may", () => {
    expect(enquiryMustHaveEvent({ state: "draft", eventType: null, worked: true, childHasEvent: true })).toBe(false);
    for (const eventType of NON_BOOKING_ENQUIRY_TYPES) {
      expect(enquiryMustHaveEvent({ state: "submitted", eventType, worked: true, childHasEvent: true })).toBe(false);
      expect(enquiryMayBecomeEvent({ state: "submitted", eventType })).toBe(false);
    }
    expect(enquiryMayBecomeEvent({ state: "draft", eventType: null })).toBe(false);
    expect(enquiryMayBecomeEvent({ state: "archived", eventType: null })).toBe(true);
  });
  it("open and closed stages together are every stage", () => {
    expect([...OPEN_OPPORTUNITY_STAGES, ...CLOSED_OPPORTUNITY_STAGES].sort()).toEqual([...OPPORTUNITY_STAGES].sort());
  });
});
```

`bare` is `{ status: "draft", deleted: false, hasDeal: false, hasEnquiry: false, hasAgreement: false, hasDepositRequestInForce: false }`.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/event-spine.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `event-spine.ts`** with the exports above. `enquiryMayBecomeEvent` is
  `state !== "draft" && isBookingEnquiry(eventType)`. `enquiryMustHaveEvent` is `enquiryMayBecomeEvent(...)` and
  (`childHasEvent`, or `worked` with a state outside `CLOSED_ENQUIRY_STATES`). A header comment states the three
  rules in plain words and names spec section 5.1.

- [ ] **Step 4: Run the test and the package's typecheck**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/event-spine.test.ts` then
`pnpm --filter @omnitwin/types typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/event-spine.ts packages/types/src/index.ts packages/types/src/__tests__/event-spine.test.ts
git commit -m "feat(types): which records must have an event (T-704)"
```

### Task 2: The columns, the keys and the rules in the database

**Files:**
- Create: `packages/api/drizzle/<next>_event_spine_links.sql`
- Modify: `packages/api/drizzle/meta/_journal.json` (one entry added by hand: `idx` is its position in the
  array; `version` "7"; `when` strictly later than the previous entry's; `tag` the file's name without `.sql`;
  `breakpoints` true. The existing test "keeps every SQL migration journaled once with contiguous order and an
  increasing timestamp" in `migration-tail-readiness.test.ts` checks it)
- Modify: `packages/api/src/db/schema.ts` (`enquiries` near 774-863, `opportunities` 1068-1093, `events`
  1662-1702, `proposals` 2501-2530; two new tables after `eventBindingReviews`, near 3943)
- Test: `packages/api/src/__tests__/event-spine-links-schema-postgres.test.ts`
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts` (name the new suite in
  `PLATFORM_POSTGRES_TEST_FILES`, with a one-line comment, as its neighbours have)

**Interfaces:**
- Produces, in the database and in Drizzle:
  - `enquiries.eventId`, `opportunities.eventId`, `proposals.eventId`: `uuid("event_id")`, nullable. Keys
    `enquiries_event_venue_fk`, `opportunities_event_venue_fk`, `proposals_event_venue_fk`:
    `(event_id, venue_id)` to `events (id, venue_id)`, `ON DELETE RESTRICT`. In Drizzle a `foreignKey({...})` in
    the table's callback with `.onDelete("restrict")`; a table declared before `events` may name it there, as
    `inventory_reservation_releases` does (schema.ts:436-443). A partial index on `event_id` where it is not
    null, on each.
  - `unique("opportunities_id_venue_unique").on(id, venueId)`.
  - `uniqueIndex("opportunities_one_open_per_event").on(eventId)` where
    `event_id IS NOT NULL AND deleted_at IS NULL AND stage NOT IN ('lost', 'archived')`.
  - `events_client_account_venue_fk`: `(client_account_id, venue_id)` to `client_accounts (id, venue_id)`,
    `ON DELETE SET NULL (client_account_id)`. It replaces the single-column key. In Drizzle the column loses its
    `.references(...)` and the table gains the `foreignKey`; the delete rule lives in the SQL only, as it does
    for `proposal_deposit_requests_event_venue_fk` (schema.ts:2782).
  - The trigger function `event_link_is_kept()` and three triggers named `<table>_event_link_kept`,
    `BEFORE UPDATE OF event_id`, on the three tables. It raises `restrict_violation` with the message
    `An event link cannot be removed, only moved (<table>)` when `OLD.event_id IS NOT NULL AND NEW.event_id IS
    NULL`, unless `current_setting('venviewer.undo_event_links', true) = 'on'`.
  - Table `event_link_joins` (Drizzle `eventLinkJoins`), the record of every join the function makes:
    `id uuid` primary key; `venue_id uuid NOT NULL` to `venues`; `subject_kind varchar(20) NOT NULL`, one of
    `enquiry`, `opportunity`, `proposal`, `deposit_request`; `subject_id uuid NOT NULL`;
    `event_id uuid NOT NULL` (no key to `events`: it is a record, and must outlive an event the undo removes);
    `path varchar(20) NOT NULL`, one of `enquiry_bookings`, `plan_link`, `enquiry`, `deal`, `deposit_request`,
    `new_event`; `event_made boolean NOT NULL DEFAULT false`; `joined_at timestamptz NOT NULL DEFAULT now()`;
    `undone_at timestamptz`. Unique on `(subject_kind, subject_id)` where `undone_at IS NULL`.
  - Table `event_link_reviews` (Drizzle `eventLinkReviews`), one question for a person:
    `id uuid` primary key; `venue_id uuid NOT NULL` to `venues`; `subject_kind varchar(20) NOT NULL`, one of
    `enquiry`, `opportunity`, `proposal`, `booking`, `event`; `subject_id uuid NOT NULL`;
    `reason varchar(40) NOT NULL`, one of `reaches_many_events`, `paths_disagree`, `second_open_deal`,
    `enquiry_events_differ`, `possibly_same_event`, `event_status_derived`;
    `candidate_event_ids uuid[] NOT NULL DEFAULT '{}'`; `detail text NOT NULL`;
    `binding_review_id uuid` (the `event_binding_reviews` row it was copied from, unique where not null);
    `created_at timestamptz NOT NULL DEFAULT now()`; `resolved_at timestamptz`;
    `resolved_by uuid` to `users`, `ON DELETE SET NULL`; `resolution varchar(20)`, one of `joined`, `own_event`,
    `merged`, `kept_apart`, `noted`; `resolved_event_id uuid`. A check that `resolved_at` and `resolution` are
    both set or both empty. Unique on `(subject_kind, subject_id, reason)` where `resolved_at IS NULL AND
    binding_review_id IS NULL`. An index on `(venue_id, created_at)` where `resolved_at IS NULL`. Stage 4 writes
    the `resolved_*` columns; this stage only adds rows.
- Produces: an enquiry's customer is not shown `eventId`. `asSeenBy` (`routes/enquiries.ts:112-115`) drops it
  for a reader who is not the venue's team, beside the funnel fields it already drops.
- Produces, for the tests: the file's own `venue(label)` fixture, modelled on the one in
  `booking-event-bind-postgres.test.ts:126-154`, returning `{ venueId, rooms, admin }` and helpers
  `event(venueId, name)`, `enquiry(venueId, state?, eventType?)`, `deal(venueId, stage?, enquiryId?)`,
  `proposal(venueId, status?, links?)`, `clientAccount(venueId)` and `insertReview(row)` that insert directly
  and return ids. Tasks 5 and 8 to 12 reuse them by importing from
  `packages/api/src/__tests__/helpers/event-spine-fixtures.ts` (create it here; each takes the suite's `Pool`).

- [ ] **Step 1: Write the failing test**

```ts
describe.skipIf(target === undefined)("the spine: the rules the database holds", () => {
  it.each(["enquiries", "opportunities", "proposals"] as const)("refuses a link from %s to another venue's event", async (table) => {
    const here = await venue("links here"), there = await venue("links there");
    const theirs = await event(there.venueId, "Their event");
    await expect(link(table, await record(table, here.venueId), theirs)).rejects.toThrow(new RegExp(`${table}_event_venue_fk`));
  });
  it.each(["enquiries", "opportunities", "proposals"] as const)("lets a link on %s be moved, and refuses emptying it", async (table) => {
    const v = await venue("kept link");
    const id = await record(table, v.venueId);
    await link(table, id, await event(v.venueId, "First"));
    await link(table, id, await event(v.venueId, "Second"));
    await expect(link(table, id, null)).rejects.toThrow(/An event link cannot be removed, only moved/);
  });
  it("refuses a second open deal on one event, and allows a lost one beside it", async () => {
    const v = await venue("one open deal");
    const e = await event(v.venueId, "Dinner");
    await link("opportunities", await deal(v.venueId, "new"), e);
    await link("opportunities", await deal(v.venueId, "lost"), e);
    await expect(link("opportunities", await deal(v.venueId, "qualified"), e)).rejects.toThrow(/opportunities_one_open_per_event/);
  });
  it("refuses an event that names another venue's client account", async () => {
    const here = await venue("accounts here"), there = await venue("accounts there");
    const account = await clientAccount(there.venueId);
    await expect(pool.query("UPDATE events SET client_account_id = $1 WHERE id = $2", [account, await event(here.venueId, "Ours")]))
      .rejects.toThrow(/events_client_account_venue_fk/);
  });
  it("refuses deleting an event a link points at", async () => {
    const v = await venue("restrict");
    const e = await event(v.venueId, "Held");
    await link("proposals", await proposal(v.venueId, "sent"), e);
    await expect(pool.query("DELETE FROM events WHERE id = $1", [e])).rejects.toThrow(/proposals_event_venue_fk/);
  });
  it("keeps one open question for each record and reason", async () => {
    const v = await venue("one question");
    const row = { venue_id: v.venueId, subject_kind: "proposal", subject_id: randomUUID(), reason: "reaches_many_events", detail: "It reaches 2 events." };
    await insertReview(row);
    await expect(insertReview(row)).rejects.toThrow(/event_link_reviews_open_unique/);
  });
});
```

`link(table, id, eventId)` runs `UPDATE <table> SET event_id = $2 WHERE id = $1`; `record(table, venueId)` makes
one row of that table. Name the open-question index `event_link_reviews_open_unique`.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/api test:platform-db` (the gate migrates, then runs every platform file)
Expected: FAIL, column `event_id` does not exist.

- [ ] **Step 3: Write the migration's first half.** A header comment in the manner of
  `0090_booking_event_bind.sql:1-41`: what changes, in order, and that running it again changes nothing. Then:

  1. `SET LOCAL lock_timeout = '5s';`
  2. `opportunities_id_venue_unique`, added only if absent.
  3. A `DO` block that raises `event_spine_links: an event names a client account of another venue` if any
     `events` row does. Then drop every foreign key from `events.client_account_id` found in `pg_constraint`
     (the name was given by PostgreSQL, so look it up as `0090:267-288` does for bookings) and add
     `events_client_account_venue_fk`.
  4. The three columns, their keys, their indexes, and `opportunities_one_open_per_event`.
  5. `event_link_is_kept()` and its three triggers (`DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`).
  6. The two tables with `CREATE TABLE IF NOT EXISTS`, their checks and indexes.
  7. Copy every `event_binding_reviews` row into `event_link_reviews`: `subject_kind` `booking` and `subject_id`
     the booking when it has one, else `event` and the event; `candidate_event_ids` the one event; `reason` and
     `created_at` as they are; `binding_review_id` its id; `ON CONFLICT DO NOTHING`. Its `detail` is NOT
     copied: October's text holds event names and booking titles. Write one fixed sentence for each reason
     ("Carried over from October's list: this booking's enquiry had bookings in more than one event." and its
     two fellows); the screen reads the old text through `binding_review_id` if it needs it.
  8. `SET LOCAL lock_timeout TO DEFAULT;` as the file's last statement (Tasks 3 and 4 add theirs above it).

- [ ] **Step 4: Mirror it in `schema.ts`** and add the journal entry.

- [ ] **Step 4a: Keep the new column from readers outside the venue's team.** Change `asSeenBy` as the
  Interfaces block says, and add `eventId` beside the withheld funnel fields in the existing test of what an
  enquiry's customer reads (search the tests for a customer not being shown `firstResponseAt`). Then read the
  public proposal views (`publicProposalRoutes`, `routes/proposals.ts:1729` onward) and the client's deposit
  and contract views: each must build its answer field by field. If one spreads a proposal row, keep `eventId`
  out of it and add a case to that route's test.

- [ ] **Step 5: Run the gate and the migration-tail test**

Run: `pnpm --filter @omnitwin/api test:platform-db`, then
`pnpm --filter @omnitwin/api exec vitest run src/__tests__/migration-tail-readiness.test.ts`, then
`pnpm --filter @omnitwin/api typecheck`
Expected: the new suite passes; the gate's replay reports no change; the journal test passes; no type errors.
`hold-promotion-postgres.test.ts` (in the same gate) still passes: it sets an event's client account directly,
and that account must now be at the event's own venue, which pins both branches of the addressee (spec 5.8).

- [ ] **Step 6: Commit**

```bash
git add packages/api/drizzle/*_event_spine_links.sql packages/api/drizzle/meta/_journal.json packages/api/src/db/schema.ts packages/api/src/__tests__/event-spine-links-schema-postgres.test.ts packages/api/src/__tests__/helpers/event-spine-fixtures.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(db): proposals, deals and enquiries point at their event (T-704)"
```

### Task 3: The join of old records

**Files:**
- Modify: `packages/api/drizzle/<next>_event_spine_links.sql` (append the function and one call of it)
- Test: `packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts`
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts` (name the suite)

**Interfaces:**
- Produces: the SQL function
  `spine_join_old_records() RETURNS TABLE (joined integer, events_made integer, listed integer)`. It is the
  only writer of `event_link_joins`. The migration calls it once, `SELECT * FROM spine_join_old_records();`,
  just above its closing `SET LOCAL lock_timeout TO DEFAULT;`.
- Consumes: Task 2's tables; `readSpineInvariant` from Task 5 is added to this test in Task 5.

**What the function does, exactly.** "A live event" is an `events` row with `deleted_at IS NULL` at the record's
own venue. "Listed" means the record has a row in `event_link_reviews` with `resolved_at IS NULL` and
`binding_review_id IS NULL`. A listed record is never touched. The SQL writes the definition of Task 1 out in
full, with the two values of `NON_BOOKING_ENQUIRY_TYPES` as literals compared with `btrim(event_type)`, as
`isBookingEnquiry` trims.

**How it locks.** It takes no table lock: a table lock here can deadlock against a writer that has already
written an event and is about to write a booking. It walks the records one at a time. For each it locks that
record's own row `FOR NO KEY UPDATE` (an enquiry before its deal, a proposal before its enquiry: the order of
the Global Constraints), reads again under the lock whether the record still has no event, and only then
decides. A record a writer has just given an event is skipped.

0. Close every open question whose record has an event by now: `resolution 'joined'`, `resolved_event_id` that
   event, `resolved_at now()`, `resolved_by` null. (A writer may have given a listed record its event.)
1. **Enquiries** with no event, not listed, that may become an event (not a draft, asks to book a room). Let A
   be the live events its undeleted bookings sit in, and B the live events its own plan
   (`enquiries.configuration_id`) is linked to in `event_configuration_links`.
   - A has more than one: list it, `reaches_many_events`, candidates A.
   - A has one and B holds any event that is not it: list it, `paths_disagree`, candidates A and B.
   - A has one: join it, path `enquiry_bookings`.
   - A is empty and B has more than one: list it, `reaches_many_events`, candidates B.
   - A is empty and B has one: join it, path `plan_link`.
   - Both empty, and it is open and worked (Task 1): make an event for it and join it, path `new_event`.
2. **Deals**, undeleted, with no event, not listed, oldest first (`created_at`, then `id`). Skip a deal whose
   enquiry is listed.
   - Its enquiry has a live event: if the deal is open and that event already has an open deal, list the deal,
     `second_open_deal`, candidate that event. Otherwise join it, path `enquiry`. The update sits in a block
     that catches `unique_violation` on `opportunities_one_open_per_event` and lists the deal the same way, so
     a deal a writer opened in the same moment cannot fail the run.
   - Its enquiry has none (or it has no enquiry) and the deal is open: when the enquiry may become an event,
     make the event for the enquiry, join the enquiry (path `new_event`) and the deal (path `enquiry`);
     otherwise make an event named by the deal and join the deal, path `new_event`.
   - A closed deal that reaches no event is left.
3. **Proposals**, undeleted, with no event, not listed, oldest first. Skip one whose enquiry is listed, or whose
   deal is open and has no event (it waits with its deal). Let `base` be its deal's event, else its enquiry's
   event, and `asked` the event of its deposit request in force, if any.
   - `base` and `asked` both set and different: list it, `paths_disagree`, candidates both.
   - `base` set: join it, path `deal` or `enquiry`. Else `asked` set: join it, path `deposit_request`.
   - Neither, and its plan is linked to more than one live event: list it, `reaches_many_events`.
   - Neither, and its plan is linked to one: join it, path `plan_link`.
   - Neither, no plan link, and it must have an event (Task 1): make an event named by the proposal and join
     it, path `new_event`.
   - When a proposal is joined and its deposit request in force has no event, set it, and record it with
     `subject_kind` `deposit_request`.
4. Every join writes one `event_link_joins` row; `event_made` is true on the row for which an event was made.
   Every listing is `INSERT ... ON CONFLICT DO NOTHING`, with a `detail` of counts and kinds only ("Its held
   dates sit in 2 events."), never a name.
5. **An event the function makes:** `status 'draft'`, `guest_count 0`, no dates, `created_by` null, the
   enquiry's `fixture_source` when it has one, and the eight default phases exactly as
   `0090_booking_event_bind.sql:147-165` inserts them. Its name is the enquiry's `name` trimmed and cut to 200,
   or `Event` when that is blank or holds an `@`: an event is never named by an email address
   (`packages/types/src/event-name.ts:13-17`). For a deal or a proposal it is the `title`. `client_name` is the
   enquiry's `name`, or null when it is blank or holds an `@`. `event_type` is the enquiry's or the deal's,
   trimmed and cut to 80. (The API names an enquiry's event "name — occasion"; SQL has no table of occasions,
   so a joined event carries the name alone. The note in `the-spine.md` says so.)

- [ ] **Step 1: Write the failing test.** Model it on the 0090 case in
  `booking-event-bind-postgres.test.ts:586-812`: a database of its own on the platform cluster, migrated up to
  the entry before this migration, filled with raw SQL, then given the real migrator. Find the entry before by
  reading the journal for the tag that ends `_event_spine_links`, so a renumbering does not break the test.

```ts
it("joins what one path reaches, lists what is in doubt, makes an event where none can be reached, and changes nothing when run again", async () => {
  // In venue `mixed`, one case of each kind (letters as in the comment block above the test):
  //  A  a worked enquiry, no held date, with one open deal and one sent proposal for that deal
  //  B  an enquiry with two holds in one event, its deal and its proposal
  //  C  an enquiry whose holds sit in two live events, with an open deal and a sent proposal
  //  D  an unworked, submitted enquiry
  //  E  a turned-down enquiry that had a reply
  //  F  an enquiry with no held date whose plan is linked to one live event
  //  G  an enquiry with a hold in X whose plan is linked to Y
  //  H  one worked enquiry with two open deals and one lost deal
  //  I  an open deal with no enquiry; a lost deal with no enquiry
  //  J  proposals from a plan alone: a draft; a sent one whose plan is linked to one event; to two; to none
  //  K  an accepted proposal whose deposit request in force names Z while its deal's event is W;
  //     and one whose deposit request names no event
  //  L  an access request (event_type 'venue-access') with a reply
  //  M  an enquiry named only by an email address, worked; one whose name is blank; and one whose
  //     event_type is 100 characters long
  //  N  three event_binding_reviews rows, one of each reason, whose detail text holds a booking's title
  // In venue `clean`, cases A, B, F, I and the second K only.
  await migrate(drizzle(legacy), { migrationsFolder: MIGRATIONS });

  // A: one new event; the enquiry, the deal and the proposal all on it.
  expect(new Set([await eventOf("enquiries", a.enquiry), await eventOf("opportunities", a.deal), await eventOf("proposals", a.proposal)]).size).toBe(1);
  expect(await eventRow(await eventOf("enquiries", a.enquiry))).toMatchObject({ status: "draft", guest_count: 0, starts_at: null, deleted_at: null });
  expect(await phaseCount(await eventOf("enquiries", a.enquiry))).toBe(8);
  // B and F: the event one path reaches.
  expect(await eventOf("enquiries", b.enquiry)).toBe(b.event);
  expect(await eventOf("proposals", b.proposal)).toBe(b.event);
  expect(await eventOf("enquiries", f.enquiry)).toBe(f.event);
  // C and G: listed, not joined; C's deal and proposal wait with it.
  for (const [table, id] of [["enquiries", c.enquiry], ["opportunities", c.deal], ["proposals", c.proposal], ["enquiries", g.enquiry]] as const) {
    expect(await eventOf(table, id)).toBeNull();
  }
  // D, E, L: nothing.
  for (const id of [d.enquiry, e.enquiry, l.enquiry]) expect(await eventOf("enquiries", id)).toBeNull();
  // H: the older open deal joins, the lost one joins as history, the newer open one is listed.
  expect(await eventOf("opportunities", h.first)).toBe(await eventOf("enquiries", h.enquiry));
  expect(await eventOf("opportunities", h.lost)).toBe(await eventOf("enquiries", h.enquiry));
  expect(await eventOf("opportunities", h.second)).toBeNull();
  // I: an event of its own for the open one, named by the deal; none for the lost one.
  expect((await eventRow(await eventOf("opportunities", i.open)))["name"]).toBe("Chamber dinner");
  expect(await eventOf("opportunities", i.lost)).toBeNull();
  // J.
  expect(await eventOf("proposals", j.draft)).toBeNull();
  expect(await eventOf("proposals", j.oneLink)).toBe(j.event);
  expect(await eventOf("proposals", j.twoLinks)).toBeNull();
  expect(await eventOf("proposals", j.noLink)).not.toBeNull();
  // K: the disagreement is listed; the empty deposit request takes its proposal's event.
  expect(await eventOf("proposals", k.disagrees)).toBeNull();
  expect(await depositEvent(k.emptyRequest)).toBe(await eventOf("proposals", k.agrees));
  // M: a readable name, never '' and never an address; a long occasion is cut, not refused.
  expect((await eventRow(await eventOf("enquiries", m.blank)))["name"]).toBe("Event");
  expect(await eventRow(await eventOf("enquiries", m.address))).toMatchObject({ name: "Event", client_name: null });
  expect(String((await eventRow(await eventOf("enquiries", m.longType)))["event_type"])).toHaveLength(80);

  // The list: exactly these open questions, and the three copied from 0090 once.
  expect(await openReviews(mixed)).toEqual(sorted([
    ["enquiry", c.enquiry, "reaches_many_events"], ["enquiry", g.enquiry, "paths_disagree"],
    ["opportunity", h.second, "second_open_deal"], ["proposal", j.twoLinks, "reaches_many_events"],
    ["proposal", k.disagrees, "paths_disagree"],
  ]));
  expect(await copiedReviewCount(mixed)).toBe(3);
  // No review row holds a name or an address.
  expect(await reviewDetails(mixed)).not.toEqual(expect.arrayContaining([expect.stringMatching(/@|Gordon|Chamber/)]));
  // Every join is recorded, and nothing crossed venues.
  expect(await joinsWithoutRecord()).toBe(0);
  expect(await crossVenueLinks()).toBe(0);

  // Run again: nothing changes.
  const before = await snapshot();
  expect((await q("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 0, events_made: 0, listed: 0 });
  expect(await snapshot()).toEqual(before);
});
```

`snapshot()` reads `id, event_id` of the three tables and of `proposal_deposit_requests`, `id, status,
deleted_at` of `events`, and the row counts of `event_phases`, `event_link_joins` and `event_link_reviews`.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/api test:platform-db`
Expected: FAIL, function `spine_join_old_records()` does not exist.

- [ ] **Step 3: Write the function** in the migration, `CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql`, with a
  dollar-quoted body as `0104_deposits_and_signatures.sql:197-204` has, then the one call.

- [ ] **Step 4: Run the gate**

Run: `pnpm --filter @omnitwin/api test:platform-db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/drizzle/*_event_spine_links.sql packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(db): join old proposals, deals and enquiries to their events, never by a guess (T-704)"
```

### Task 4: The undo

**Files:**
- Modify: `packages/api/drizzle/<next>_event_spine_links.sql` (add the function before the call of the join)
- Test: `packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts` (a second case)

**Interfaces:**
- Produces: `spine_undo_joins() RETURNS TABLE (emptied integer, events_removed integer, left_alone integer)`.

**What it does, exactly.** It locks rows as the join does, and takes no table lock.

1. `PERFORM set_config('venviewer.undo_event_links', 'on', true);` (this transaction only).
2. **Decide first which events the join made may go.** An event made by the join (`event_made` on a row not yet
   undone) may go only when nothing has attached to it since: every recorded join to it still holds; no phase
   of it has been given a room or a time; and no row points at it other than those recorded subjects and its
   own phases. To test the last, read every foreign key to `events` from `pg_constraint` and test each
   referencing column with a dynamic `SELECT EXISTS`, leaving out the recorded subjects. An event that may not
   go is kept WITH its joins: every `event_link_joins` row for it is counted in `left_alone` and left as it is.
3. For each remaining row with `undone_at IS NULL`, newest first: when its subject's `event_id` still equals the
   row's `event_id`, set the subject's `event_id` to null and stamp `undone_at`; otherwise (a person moved it)
   count it in `left_alone` and leave both.
4. Delete the events of step 2 that may go (their phases go with them); count them in `events_removed`.
5. Delete the open questions the join wrote (`binding_review_id IS NULL AND resolved_at IS NULL`). Copied 0090
   rows stay.

- [ ] **Step 1: Write the failing test**

```ts
it("undoes its own joins row for row, and leaves what a person changed", async () => {
  // A fresh database, the cases of the first test, and `before` = the snapshot taken before the migration ran
  // (every event_id null; the events and phases that existed).
  await migrate(drizzle(legacy), { migrationsFolder: MIGRATIONS });
  // A person moves one proposal to another event, and links a plan to one event the join made.
  await q("UPDATE proposals SET event_id = $1 WHERE id = $2", [otherEvent, b.proposal]);
  await q("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')", [await eventOf("opportunities", i.open), plan]);

  const report = (await q("SELECT * FROM spine_undo_joins()")).rows[0];
  // Left: the proposal a person moved, and the one join to the made event a plan is now linked to.
  expect(report.left_alone).toBe(2);
  // Everything else is as it was before the migration.
  expect(await eventOf("proposals", b.proposal)).toBe(otherEvent);
  expect(await eventOf("opportunities", i.open)).toBe(iOpenEvent);   // kept with its event, not orphaned
  expect(withoutThose(await snapshot())).toEqual(withoutThose(before));
  // The rule still stands outside the undo.
  await expect(q("UPDATE proposals SET event_id = NULL WHERE id = $1", [b.proposal])).rejects.toThrow(/cannot be removed/);
  // The join can be run again afterwards and lands where it did.
  await q("SELECT * FROM spine_join_old_records()");
  expect(await eventOf("enquiries", b.enquiry)).toBe(b.event);
});
```

- [ ] **Step 2: Run it to see it fail** (`pnpm --filter @omnitwin/api test:platform-db`; the function does not
  exist).
- [ ] **Step 3: Write the function.**
- [ ] **Step 4: Run the gate.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/api/drizzle/*_event_spine_links.sql packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts
git commit -m "feat(db): the join of old records can be undone from its own record (T-704)"
```

### Task 5: The count

**Files:**
- Create: `packages/api/src/services/event-spine-invariant.ts`
- Test: `packages/api/src/__tests__/event-spine-invariant.test.ts` (no database: the parsing)
- Test: `packages/api/src/__tests__/event-spine-invariant-postgres.test.ts`
- Modify: `packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts` (two assertions)
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts` (name the suite)

**Interfaces:**
- Consumes: `InvariantReader` and the helper pattern of `readBindInvariant`
  (`packages/api/src/services/event-binding.ts:494-548`); Task 1's constants, passed into the SQL as parameters
  the way `sqlList(EVENT_BOUND_BOOKING_KINDS)` is, so the count and the definition cannot drift. `sqlList` is
  private today (event-binding.ts:512-515): export it. `countFrom` is private too and its message names the
  bind: the new file has its own, with the message below. An enquiry's kind is tested on `btrim(event_type)`.
- Produces:

```ts
export interface SpineInvariant {
  readonly proposalsWithoutEvent: number;
  readonly agreementsWithoutEvent: number;
  readonly depositRequestsWithoutEvent: number;
  readonly openDealsWithoutEvent: number;
  readonly workedEnquiriesWithoutEvent: number;
  readonly eventsWithTwoOpenDeals: number;
  readonly disagreeingLinks: number;
  readonly linksToClosedEvents: number;
  readonly eventDealPointersInUse: number;
}
export async function readSpineInvariant(conn: InvariantReader, venueId: string | null = null): Promise<SpineInvariant>;
export function spineInvariantHolds(counts: SpineInvariant): boolean;
```

**What each number counts** (one statement, nine sub-selects, each scoped by `venueId` when one is given):

| Field | Counts |
|---|---|
| `proposalsWithoutEvent` | Undeleted proposals with no event that must have one by Task 1 |
| `agreementsWithoutEvent` | `proposal_contract_versions` rows whose undeleted proposal has no event |
| `depositRequestsWithoutEvent` | Deposit requests in force (`cancelled_at IS NULL`) with no event |
| `openDealsWithoutEvent` | Undeleted deals in an open stage with no event |
| `workedEnquiriesWithoutEvent` | Enquiries with no event that must have one by Task 1. "Worked" is a first reply, a live hold, booking or viewing, an undeleted deal, proposal or quote. "A child has an event" is an undeleted booking, deal or proposal of it with an event |
| `eventsWithTwoOpenDeals` | Events with more than one undeleted deal in an open stage |
| `disagreeingLinks` | A proposal and its deal with two different events, both set; plus a deposit request in force and its proposal with two different events, both set. A deal or proposal on a different event from its enquiry is not counted |
| `linksToClosedEvents` | Records counted as needing an event above whose event has `deleted_at` set |
| `eventDealPointersInUse` | `events` rows with `opportunity_id` set |

- [ ] **Step 1: Write the failing tests.** Without a database: a fake reader returns strings and the function
  returns numbers; a missing or negative count throws `The spine invariant returned no <label> count`. With a
  database, one case for each field, each in its own venue, each asserting that field is 1 and every other is 0:

```ts
it.each([
  ["proposalsWithoutEvent", async (v) => { await proposal(v.venueId, "sent"); }],
  ["agreementsWithoutEvent", async (v) => { await agreementFor(await proposal(v.venueId, "archived")); }],   // also 1 proposal
  ["depositRequestsWithoutEvent", async (v) => { await depositRequestFor(await proposalOnEvent(v, "accepted"), null); }],
  ["openDealsWithoutEvent", async (v) => { await deal(v.venueId, "qualified"); }],
  ["workedEnquiriesWithoutEvent", async (v) => { await repliedEnquiry(v.venueId); }],
  ["disagreeingLinks", async (v) => { await proposalAndDealOnTwoEvents(v); }],
  ["linksToClosedEvents", async (v) => { await proposalOnDeletedEvent(v); }],
  ["eventDealPointersInUse", async (v) => { await eventNamingADeal(v); }],
] as const)("counts %s", async (field, arrange) => {
  const v = await venue(`counts ${field}`);
  await arrange(v);
  const counts = await readSpineInvariant(db, v.venueId);
  expect(counts[field]).toBe(1);
  expect(spineInvariantHolds(counts)).toBe(false);
});
it("reads zero for a venue where every writer's rule was kept", async () => { /* one of each record, all linked */ });
it("does not count a draft made from a plan alone, a lost deal, a turned-down enquiry or an access request", async () => { /* all zero */ });
```

  The `agreementsWithoutEvent` case expects `proposalsWithoutEvent` to be 1 as well, and says so.
  `eventsWithTwoOpenDeals` cannot be arranged while the unique index stands; assert instead that the field is
  present and zero, and that the index's name is in `pg_indexes`.

  In the migration test add: `expect(await readSpineInvariant(drizzle(legacy), clean)).toEqual(allZero)`, and
  for `mixed` the exact non-zero counts its five listed records give. This is the proof that the SQL join and
  the TypeScript definition agree.

- [ ] **Step 2: Run them to see them fail.** `pnpm --filter @omnitwin/api exec vitest run
  src/__tests__/event-spine-invariant.test.ts` and the platform gate. Expected: FAIL, module not found.
- [ ] **Step 3: Write `event-spine-invariant.ts`.**
- [ ] **Step 4: Run both.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/event-spine-invariant.ts packages/api/src/__tests__/event-spine-invariant.test.ts packages/api/src/__tests__/event-spine-invariant-postgres.test.ts packages/api/src/__tests__/event-spine-links-migration-postgres.test.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(api): a read-only count of records without their event (T-704)"
```

### Task 6: The bind joins the enquiry's own link first, and writes it

**Files:**
- Modify: `packages/api/src/services/event-binding.ts` (`EventSeed` 52-63, `createEventFor` 110-128,
  `bindBookingToEvent` 155-195, and the header comment 17-46)
- Modify: `packages/api/src/services/booking-mutations.ts` (a booking moved to a named event, 478-487)
- Test: `packages/api/src/__tests__/booking-event-bind-postgres.test.ts` (new cases beside the existing ones)

**Interfaces:**
- Produces:
  - `EventSeed.startsAt` and `EventSeed.endsAt` become `Date | null` (an event made for an enquiry has no dates).
  - `export async function createEventFor(conn: BindConn, seed: EventSeed): Promise<string>` (now exported). It
    cuts `seed.eventType` to 80 characters, the column's width.
  - `export async function enquiryEventOf(conn: BindConn, enquiry: { readonly id: string; readonly venueId: string; readonly eventId: string | null }): Promise<string | null>`:
    the enquiry's own link when it names a live event at its venue; otherwise the event its bookings have, by
    today's query (176-190); otherwise null. Call it with the enquiry row locked.
  - `export async function setEnquiryEvent(conn: BindConn, enquiryId: string, eventId: string): Promise<void>`.
  - `export async function followBookingToEvent(conn: BindConn, move: { readonly enquiryId: string | null; readonly fromEventId: string | null; readonly toEventId: string }): Promise<void>`:
    when a person moves an enquiry's booking to another event, and the enquiry's link named the old event, and
    no other undeleted booking of that enquiry is left in the old event, the link moves to the new one.
    Otherwise nothing. It locks the enquiry row (`FOR NO KEY UPDATE`) after the booking, as the order requires.
- Behaviour, in the `join: "enquiry"` branch:
  - The enquiry row is locked `FOR NO KEY UPDATE` (today `FOR UPDATE`, line 173), and the select also reads
    `eventId`, `state` and `eventType`. It still serialises two holds pencilled at once.
  - When `enquiryEventOf` returns an event, the booking joins it. When it returns none, the new event is made
    as today.
  - The enquiry's link is then written to that event if it differs, but only when
    `enquiryMayBecomeEvent({ state, eventType })`. A hold on a draft, or on a request that books nothing, binds
    exactly as it does today and writes no link.
- Behaviour, in `updateBookingCore`: after a hold or booking is moved to an event its writer names
  (booking-mutations.ts:478-487), call `followBookingToEvent`.

- [ ] **Step 1: Write the failing tests.** Use the file's own fixtures: `venue(label)` (lines 126-154) gives
  `{ venueId, rooms, admin, enquiry }`, and `holdFromEnquiry(actor, body)` (line 156) posts to
  `/bookings/from-enquiry`. Three small readers are new, written here beside them: `enquiryEvent(enquiryId)`
  (the enquiry's `event_id`), `datelessEvent(venueId, name)` (inserts an event with no dates, returns its id)
  and `eventCount(venueId)`. `holdBody(v, enquiryId, overrides?)` below stands for the body the existing tests
  already build for that route.

```ts
it("a hold made from an enquiry writes the enquiry's link", async () => {
  const hold = (await holdFromEnquiry(v.admin, holdBody(v, enquiryId))).json().data;
  expect(await enquiryEvent(enquiryId)).toBe(hold.eventId);
});
it("the first hold on an enquiry that already has an event joins it, and the event takes the hold's dates", async () => {
  const eventId = await datelessEvent(v.venueId, "Opened from the enquiry");
  await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [eventId, enquiryId]);
  const before = await eventCount(v.venueId);
  const hold = (await holdFromEnquiry(v.admin, holdBody(v, enquiryId, { startsAt: at("18:00"), endsAt: at("23:00") }))).json().data;
  expect(hold.eventId).toBe(eventId);
  expect(await eventCount(v.venueId)).toBe(before);
  expect((await eventRow(eventId)).starts_at).toEqual(new Date(at("18:00")));
});
it("the enquiry's own link wins over an older booking's event", async () => { /* booking in E2, link to E1: the new hold joins E1 */ });
it("a link to a deleted event is not joined: a new event is made and the link moves", async () => {
  const gone = await datelessEvent(v.venueId, "Removed");
  await pool.query("UPDATE enquiries SET event_id = $1 WHERE id = $2", [gone, enquiryId]);
  await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [gone]);
  const hold = (await holdFromEnquiry(v.admin, holdBody(v, enquiryId))).json().data;
  expect(hold.eventId).not.toBe(gone);
  expect(await enquiryEvent(enquiryId)).toBe(hold.eventId);
});
it("a hold on a request that books nothing binds as before and writes no link", async () => {
  await pool.query("UPDATE enquiries SET event_type = $1 WHERE id = $2", [VENUE_ACCESS_ENQUIRY_TYPE, enquiryId]);
  const hold = (await holdFromEnquiry(v.admin, holdBody(v, enquiryId))).json().data;
  expect(hold.eventId).not.toBeNull();
  expect(await enquiryEvent(enquiryId)).toBeNull();
});
it("an occasion of 100 characters makes an event whose type is cut to 80, not a refusal", async () => { /* createEventFor directly, eventType "x".repeat(100) */ });
it("a booking a person moves to another event takes its enquiry's link with it when it was the last one there", async () => {
  /* hold from the enquiry in E1; PATCH the booking to E2 through updateBookingCore: the link is E2.
     With a second booking of the enquiry still in E1: the link stays E1. */
});
it("two holds pencilled at once from one enquiry still share one event, and the link names it", async () => { /* Promise.all, as the existing race test does */ });
it("a viewing and a hold made at the same moment for one enquiry both finish", async () => {
  /* The viewing's insert holds a key share on the enquiry while the hold's bind takes its lock:
     with FOR NO KEY UPDATE neither waits on the other in a ring. Ten rounds; no 500. */
});
```

- [ ] **Step 2: Run to see them fail** (`pnpm --filter @omnitwin/api test:platform-db`).
- [ ] **Step 3: Change the bind** as the Interfaces block says, and rewrite its header comment: a booking joins
  the event its writer names, or its enquiry's own event, or the event its enquiry's bookings have, or a new
  one, and the enquiry's link is kept in step.
- [ ] **Step 4: Run the gate.** Expected: the new cases and every existing bind case pass.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/event-binding.ts packages/api/src/services/booking-mutations.ts packages/api/src/__tests__/booking-event-bind-postgres.test.ts
git commit -m "feat(api): the bind joins an enquiry's own event first and keeps its link (T-704)"
```

### Task 7: The operator's read, the two production runs and the engineering note

**Files:**
- Modify: `packages/api/src/scripts/check-booking-event-bind.ts`
- Modify: `.github/workflows/deploy.yml` (a new job, `event-rules`, with `needs: migrate`)
- Modify: `.github/workflows/cleanup.yml` (a new job, `event-rules`, beside `cleanup`)
- Create: `docs/engineering/the-spine.md`
- Modify: `docs/engineering/the-bind.md` (its "Checks" and "Not in this slice" sections point at the new note)
- Modify: `docs/engineering/README.md` (one line in its map, in the form its neighbours have)

**Interfaces:**
- Consumes: `readSpineInvariant`, `spineInvariantHolds` (Task 5); `spine_join_old_records()` (Task 3).
- Produces: the script accepts `--join`. With it, before the read, it opens one transaction, runs
  `SET LOCAL lock_timeout = '5s'` and `SELECT * FROM spine_join_old_records()`, and reports the three numbers.
  The read-only transaction then reads both counts, the 0090 list by reason (as today) and the open questions in
  `event_link_reviews` by reason. It prints one line of JSON:
  `{ status, unboundBookings, contradictingEvents, ...SpineInvariant, reviewList, joinsToCheck, joinRun }`
  (`joinRun` only with `--join`). `status` is `"holds"` when the two bind counts and the nine spine counts are
  all zero. `reviewList` and `joinsToCheck` are information and never change the status: a question that
  matters already shows in a count, and October's copied rows cannot be answered until stage 4. Exit codes stay
  0, 1, 2. The connection string is never printed.

- [ ] **Step 1: Change the script.** Keep its header comment true: say what `--join` does and that the join is
  the script's only write.
- [ ] **Step 2: Add a job of its own to each workflow,** so a red result reads "event rules" and never fails
  the migration job or the clean-up. It repeats the checkout, pnpm, Node, install and "Build @omnitwin/types"
  steps of `deploy.yml`'s `migrate` job, then:

```yaml
  event-rules:
    name: Event rules (reports only; never blocks a release)
    # deploy.yml: needs: migrate.   cleanup.yml: no needs; it runs beside the clean-up.
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      # ...the same set-up steps as the migrate job...
      - name: Join old records and read the event rules
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts --join
```

  In `deploy.yml` the job copies `migrate`'s `if:` and `environment:` exactly, so it runs only when that job
  does. A comment above each says: Railway releases by itself, so a red run here reports and blocks nothing;
  the `--join` flag goes when the rule is tightened (stage 6).
- [ ] **Step 3: Run the script against the platform test database** after the gate has migrated it:
  `DATABASE_URL=<the platform test URL> pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts --join`
  Expected: one JSON line with `"joinRun"` and every count a number. (Other suites' leftovers may make the
  status `broken` there; the shape is what is checked.)
- [ ] **Step 4: Write `the-spine.md`:** the rule and the definition; who writes each link; the join's five
  steps; the count's nine numbers; where it runs; and "Rolling back", which is `SELECT * FROM
  spine_undo_joins();` followed by the hand-written statements that drop what Task 2 added, in reverse order,
  with the note that the backup branch is the last resort as for every migration.
- [ ] **Step 5: Run the whole check for the API** (`pnpm --filter @omnitwin/api typecheck`, `lint`, the
  platform gate) and open pull request 1 as a draft. Its text says: a database change that wants its own merge
  slot; what it adds; that the links stay nullable; the rollback.
- [ ] **Step 6: Commit**

```bash
git add packages/api/src/scripts/check-booking-event-bind.ts .github/workflows/deploy.yml .github/workflows/cleanup.yml docs/engineering/the-spine.md docs/engineering/the-bind.md docs/engineering/README.md
git commit -m "feat(ops): the event rules are read after every release and every night (T-704)"
```

---

# Part two: pull request 2 (no database change)

Tasks 8 to 13, on a branch cut from pull request 1's head. After it merges, every writer keeps the links, and
the join has nothing left to do for new records.

### Task 8: `ensureEnquiryEvent`, and every act that works an enquiry

**Files:**
- Create: `packages/api/src/services/enquiry-event.ts`
- Modify: `packages/api/src/routes/bookings.ts` (`enquiryTitleName`, line 73, moves to the new service and is
  re-exported from here, because `bookings-routes.test.ts:464` imports it from this file; the viewing route,
  471-560). The hold route's own naming lines (380-388) are NOT rewritten: the same test, lines 474-475, reads
  the route's source for `enquiryTitleName(enquiry)` and `fallbackTitle.slice(0, MAX_BOOKING_TITLE_LENGTH)`
- Modify: `packages/api/src/routes/enquiries.ts` (the decision, 361-390; the reply report, 509-545; one new route)
- Modify: `packages/api/src/routes/quotes.ts` (the create transaction, near 211)
- Modify: `packages/types/src/enquiry.ts` (the new route's result schema)
- Test: `packages/api/src/__tests__/event-spine-writers-postgres.test.ts` (named in
  `PLATFORM_POSTGRES_TEST_FILES`)

**Interfaces:**
- Consumes: `createEventFor`, `enquiryEventOf`, `setEnquiryEvent`, `BindConn` (Task 6); `enquiryMayBecomeEvent`
  (Task 1); `occasionLabel`, `holdsEmailAddress` from `@omnitwin/types`.
- Produces:

```ts
export type EnquiryEventOutcome =
  | { readonly ok: true; readonly eventId: string; readonly created: boolean }
  | { readonly ok: false; readonly code: "ENQUIRY_NOT_FOUND" | "ENQUIRY_NOT_SENT" | "NOT_A_BOOKING_ENQUIRY" };

/** The enquiry's event, made if it has none. The only way an enquiry gets its event. Locks the enquiry row
 *  FOR NO KEY UPDATE, then (when it makes one) writes the event. Call inside the caller's transaction, before
 *  any insert in it that references the enquiry. */
export async function ensureEnquiryEvent(conn: BindConn, enquiryId: string, byUserId: string | null): Promise<EnquiryEventOutcome>;

/** The title and client name an enquiry gives its first hold and its event. */
export function enquiryEventNaming(enquiry: { readonly name: string; readonly email: string; readonly eventType: string | null }): { readonly title: string; readonly clientName: string | null };
export function enquiryTitleName(enquiry: { readonly name: string; readonly email: string }): string;
```

  `enquiryEventNaming` gives the same title and client name the hold route works out inline
  (`routes/bookings.ts:380-388`): the title is `"<who> — <occasion>"` cut to the booking title's length, and
  the client name is null when the name is an email address. The hold route keeps its own lines; a test below
  holds the two to the same answer, so a hold's event and an enquiry's event are named alike.
- Produces: `POST /enquiries/:id/event`, for the venue's commercial team (`canManageCommercial`). 200 with
  `{ data: { enquiryId, eventId, created } }` (`EnquiryEventResultSchema` in `@omnitwin/types`). 404 when the
  enquiry is missing, 403 for anyone else, 422 `ENQUIRY_NOT_SENT` for a draft with "This enquiry has not been
  sent yet, so it cannot be opened as an event.", 422 `NOT_A_BOOKING_ENQUIRY` with "This request asks to book
  nothing, so it has no event."
- Behaviour, each inside the transaction that records the act:
  - The decision: after `stampFirstResponse`, call `ensureEnquiryEvent` when the new state is `approved`. Not
    for `rejected`.
  - The reply report: after `stampFirstResponse`, read the enquiry's state again inside the transaction (the
    row is locked by `lockFirstResponse`; the state read before the transaction, lines 450-455, may be stale)
    and call it when that state is not in `CLOSED_ENQUIRY_STATES`. A refusal by kind is not an error there: the
    reply is still recorded.
  - A viewing: call it BEFORE the booking insert (after the room is locked). The viewing itself still has no
    event.
  - A quote: when the new quote names an `enquiryId`, call it before the quote insert, whether or not it also
    names a deal.

- [ ] **Step 1: Write the failing tests** (the file registers the enquiry, booking, CRM, deal, proposal and quote
  routes on one Fastify instance, signs in as the bind's test does, and uses Task 2's fixtures):

```ts
it("a reply reported on an open enquiry makes its event, once", async () => {
  await reportReply(v, enquiryId); await reportReply(v, enquiryId);
  const eventId = await enquiryEvent(enquiryId);
  expect(await eventRow(eventId)).toMatchObject({ status: "draft", starts_at: null, guest_count: 0, name: "Iona Reid — Wedding", client_name: "Iona Reid" });
  expect(await phaseCount(eventId)).toBe(8);
  expect(await eventCount(v.venueId)).toBe(1);
});
it("an approval makes the event; a turn-down makes none", async () => { /* two enquiries, POST /transition */ });
it("a reply reported on a turned-down enquiry makes none", async () => { /* state rejected; the reply is still recorded; event_id null */ });
it("an access request never becomes an event", async () => {
  const id = await enquiry(v.venueId, "submitted", VENUE_ACCESS_ENQUIRY_TYPE);
  expect((await reportReply(v, id)).statusCode).toBe(200);
  expect(await enquiryEvent(id)).toBeNull();
});
it("a reply reported as the enquiry is turned down at the same moment makes no event", async () => {
  /* Promise.all of the report and the rejection, ten rounds: whenever the enquiry ends rejected with the
     rejection committed first, event_id is null; never a 500. */
});
it("a viewing makes the enquiry's event and has none itself", async () => { /* POST /bookings/viewings */ });
it("two viewings booked at once for one enquiry both finish, on one event", async () => { /* Promise.all; no 500 */ });
it("a quote priced for an enquiry makes its event, with or without a deal named", async () => { /* POST /quotes */ });
it("names an enquiry's event as its first hold would be titled", async () => {
  expect(enquiryEventNaming({ name: "Iona Reid", email: "iona@example.test", eventType: "wedding" }))
    .toEqual({ title: "Iona Reid — Wedding", clientName: "Iona Reid" });
  /* and a hold made through the route for the same enquiry carries that title */
});
it("opens an enquiry as an event; a second press returns the same one", async () => {
  const first = await openAsEvent(v, enquiryId), second = await openAsEvent(v, enquiryId);
  expect([first.json().data.created, second.json().data.created]).toEqual([true, false]);
  expect(second.json().data.eventId).toBe(first.json().data.eventId);
});
it("refuses a draft, a request, and another venue's team", async () => { /* 422 ENQUIRY_NOT_SENT, 422 NOT_A_BOOKING_ENQUIRY, 403 */ });
it("an enquiry named only by an email address gets an event named by its occasion", async () => { /* name not an address; client_name null */ });
it("the first hold on a worked enquiry joins its event", async () => { /* reply, then POST /bookings/from-enquiry: one event */ });
```

- [ ] **Step 2: Run to see them fail** (`pnpm --filter @omnitwin/api test:platform-db`).
- [ ] **Step 3: Write the service,** then wire the four acts and the new route.
- [ ] **Step 4: Run the gate and `typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/enquiry-event.ts packages/api/src/routes/bookings.ts packages/api/src/routes/enquiries.ts packages/api/src/routes/quotes.ts packages/types/src/enquiry.ts packages/api/src/__tests__/event-spine-writers-postgres.test.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(api): an enquiry becomes its event when someone first works it (T-704)"
```

### Task 9: A deal takes its event when it is made

**Files:**
- Create: `packages/api/src/services/event-links.ts`
- Modify: `packages/api/src/routes/crm.ts` (the insert, near 165)
- Modify: `packages/api/src/routes/opportunities.ts` (the insert, near 234; the edit, 426-560)
- Test: `packages/api/src/__tests__/event-spine-writers-postgres.test.ts`

**Interfaces:**
- Consumes: `ensureEnquiryEvent` (Task 8); `createEventFor` (Task 6); `isOpenOpportunityStage` (Task 1).
- Produces:

```ts
export type DealEventOutcome =
  | { readonly ok: true; readonly eventId: string }
  | { readonly ok: false; readonly code: "EVENT_HAS_OPEN_DEAL"; readonly dealId: string };

/** The event a new deal belongs to: its enquiry's (made if need be), else one of its own named by the deal.
 *  Refuses when that event already has an open deal. Call inside the deal's own transaction, before the insert. */
export async function eventForNewDeal(conn: BindConn, deal: {
  readonly venueId: string; readonly sourceEnquiryId: string | null; readonly title: string;
  readonly eventType: string | null; readonly createdBy: string | null;
}): Promise<DealEventOutcome>;

/** True for the unique violation of opportunities_one_open_per_event. */
export function isOpenDealConflict(error: unknown): boolean;
export const EVENT_HAS_OPEN_DEAL = { status: 409, code: "EVENT_HAS_OPEN_DEAL", error: "This event already has an open deal. Close that one first, or make this deal without the enquiry." } as const;
```

- Behaviour:
  - Both create routes call `eventForNewDeal` and insert the deal with `eventId`. An enquiry that may not
    become an event (a draft, a request) gives the deal an event of its own. A refusal answers
    `EVENT_HAS_OPEN_DEAL` with the first deal's id as `dealId`.
  - **Where the call goes.** After the person is settled, never before: in `POST /opportunities` after
    `refuseLinks` (opportunities.ts:229-232, which holds the contact); in `POST /crm/from-enquiry` after
    `ensureEnquiryPerson` and `ensurePrimaryAccount`. Taking the enquiry before the person would wait in a ring
    with a People Book merge.
  - **Two presses at once.** The unique index is the guard. Catch `isOpenDealConflict` OUTSIDE the transaction
    (around the whole `db.transaction(...)` call: inside it the transaction is already aborted), then read the
    open deal's id in a fresh statement and answer `EVENT_HAS_OPEN_DEAL`.
  - **The edit, `PATCH /opportunities/:id`:**
    - A platform admin may move a deal to any stage (line 454), so a lost deal can be reopened beside an open
      one. Its catch (lines 546-553) gains `isOpenDealConflict`, answered `EVENT_HAS_OPEN_DEAL`.
    - Changing a deal's enquiry leaves the deal's event alone. If the newly named enquiry may become an event
      and has none, it takes the deal's event (`setEnquiryEvent`, the enquiry locked `FOR NO KEY UPDATE` after
      the person), because a child of it now has one.

- [ ] **Step 1: Write the failing tests**

```ts
it("a deal made from an enquiry takes the enquiry's event", async () => { /* POST /crm/from-enquiry/:id; both links equal and set */ });
it("a deal with no enquiry gets an event of its own, named by the deal", async () => { /* POST /opportunities; name = title; 8 phases */ });
it("a second open deal on the same event is refused, and names the first", async () => {
  const first = (await dealFromEnquiry(v, enquiryId)).json().data.opportunity.id;
  const again = await createDeal(v, { sourceEnquiryId: enquiryId, title: "Second" });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ code: "EVENT_HAS_OPEN_DEAL", dealId: first });
});
it("a lost deal does not stand in the way of a new one", async () => { /* PATCH stage lost, then create: 201, same event */ });
it("a deal for a draft enquiry gets its own event and the enquiry none", async () => { /* ... */ });
it("changing a deal's enquiry leaves its event where it was, and the new enquiry takes that event when it had none", async () => {
  /* PATCH sourceEnquiryId: deal.event_id unchanged; the new enquiry's event_id = the deal's.
     A new enquiry that already has another event keeps its own. The count stays zero for the venue. */
});
it("a platform admin reopening a lost deal beside an open one is refused plainly", async () => {
  /* PATCH stage "new" on the lost deal as a platform admin: 409 EVENT_HAS_OPEN_DEAL, not a 500 */
});
```

  Use the response shape the route already returns; read it from the route, do not assume it.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Write `event-links.ts` (this task's half) and wire the two routes.**
- [ ] **Step 4: Run the gate (it includes `deal-stage-race-postgres.test.ts`), and `crm-postgres.test.ts`,**
  which runs on its own database (its variable is named at the top of `check-required-postgres-suites.ts`).
  Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/event-links.ts packages/api/src/routes/crm.ts packages/api/src/routes/opportunities.ts packages/api/src/__tests__/event-spine-writers-postgres.test.ts
git commit -m "feat(api): a deal takes its event when it is made; one open deal for each event (T-704)"
```

### Task 10: A proposal takes its event, keeps it, and announces on it

**Files:**
- Modify: `packages/api/src/services/event-links.ts`
- Modify: `packages/api/src/routes/proposals.ts` (`loadProposalEventContext` 298-326 removed;
  `recordProposalLifecycleChange` 371-477; create 595-620; edit 689-756; the send in `/transition` 855-882; the
  send in `/share-token` 1069-1130)
- Test: `packages/api/src/__tests__/event-spine-writers-postgres.test.ts`

**Interfaces:**
- Consumes: `ensureEnquiryEvent`; `createEventFor`; `ProposalLinks` from `services/proposal-links.ts`;
  `SENT_PROPOSAL_STATUSES` (Task 1).
- Produces, in `event-links.ts`:

```ts
/** The event a proposal takes from its links: its deal's, else its enquiry's (made if need be); null for a
 *  proposal made from a plan alone, or whose deal has no event yet. */
export async function eventForProposalLinks(conn: BindConn, venueId: string, links: Pick<ProposalLinks, "opportunityId" | "enquiryId">, byUserId: string | null): Promise<string | null>;

/** Gives a proposal being sent its event when it has none: its links', else the one live event its plan is
 *  linked to, else a new one named by the proposal. Call with the proposal's row locked. */
export async function ensureProposalEvent(conn: BindConn, proposal: { readonly id: string; readonly venueId: string; readonly eventId: string | null; readonly opportunityId: string | null; readonly enquiryId: string | null; readonly configurationId: string | null; readonly title: string }, byUserId: string | null): Promise<string>;

/** The proposal's event and its newest handoff pack, read from the proposal's own link. */
export async function proposalEventContext(db: Database, proposalId: string): Promise<{ readonly eventId: string; readonly venueId: string; readonly handoffPackId: string | null } | null>;
```

- Behaviour:
  - **Create** runs in one transaction: `eventForProposalLinks`, then the insert with `eventId`.
  - **Edit.** Today the edit runs with no transaction and no row lock (proposals.ts:699-735). It becomes one
    transaction that takes `holdProposal` first and answers `PROPOSAL_STATUS_CHANGED` when the held status is
    not the one read, as the other moves do. Inside it: when the deal or the enquiry changes, the new event is
    `eventForProposalLinks(...)`, or the event it already has when that is null (a link is never emptied). If
    the event would change and the proposal has an agreement or a deposit request in force, answer 409
    `PROPOSAL_EVENT_FIXED`, "This proposal has an agreement or a deposit request, so it stays with its event."
    The link moves in the same statement as the other links.
  - **Becoming sent.** Whenever a move takes a proposal from a status outside `SENT_PROPOSAL_STATUSES` into
    one of them, inside the same transaction and after `stampSendAsFirstReply` when that runs:
    `ensureProposalEvent(tx, held, request.user.id)`, written to the row. That is the send in `/transition`,
    the send in `/share-token`, and also an admin's direct move from draft to accepted or to changes requested
    (`state-machines/proposal.ts:79` lets the admin role make any move), which never passes the send branch.
  - **Announcing:** `recordProposalLifecycleChange` calls `proposalEventContext(db, proposal.id)`. A proposal
    that had no plan said nothing when staff changed it; now it has an event, so the change is announced on
    it, to the same audience as a linked proposal's. A proposal with no event keeps today's two behaviours.

- [ ] **Step 1: Write the failing tests**

```ts
it("a proposal for a deal takes the deal's event; for an enquiry alone, the enquiry's; from a plan alone, none", async () => { /* three creates */ });
it("sending a proposal made from a plan alone gives it the one event its plan is linked to", async () => { /* /transition to sent */ });
it("...or an event of its own, named by the proposal, when its plan is linked to none or to two", async () => { /* two cases */ });
it("sending by a client link does the same", async () => { /* POST /:id/share-token */ });
it("an admin marking a draft accepted without sending it still gives it its event", async () => { /* /transition draft -> accepted */ });
it("an edit made as a colleague sends it changes nothing and says so", async () => { /* PATCH racing /transition: 409 PROPOSAL_STATUS_CHANGED or the edit lands first; never both half-applied */ });
it("changing its deal moves its event with it", async () => { /* PATCH opportunityId */ });
it("taking its deal and enquiry away keeps its event", async () => {
  const res = await patchProposal(v, id, { opportunityId: null, enquiryId: null });
  expect(res.statusCode).toBe(200);
  expect(await proposalEvent(id)).toBe(eventBefore);
});
it("with an agreement, a change that would move its event is refused", async () => { /* platform admin, accepted, agreement: 409 PROPOSAL_EVENT_FIXED */ });
it("a staff change to a proposal with no plan is announced on its event", async () => {
  await patchProposal(v, id, { title: "Burns Supper, revised" });
  expect(await planChanges(await proposalEvent(id))).toEqual([expect.objectContaining({ proposal_id: id })]);
});
it("nothing in the API reads a proposal's event through its plan any more", async () => {
  expect(await sourceOf("routes/proposals.ts")).not.toMatch(/loadProposalEventContext/);
  expect(await sourceOf("routes/deposits.ts")).not.toMatch(/loadProposalEventContext/);
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Write the three functions and change the routes.**
- [ ] **Step 4: Run the platform gate and the existing proposal suites**
  (`proposals-announcement-isolation-postgres.test.ts`, `proposals-client-response-postgres.test.ts`,
  `proposals-desk-postgres.test.ts`; each needs its own database variable, named at the top of
  `check-required-postgres-suites.ts`). Expected: PASS. An existing expectation that a plan-less proposal's
  change writes nothing is updated to the new behaviour, and the commit message says so.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/event-links.ts packages/api/src/routes/proposals.ts packages/api/src/__tests__/event-spine-writers-postgres.test.ts
git commit -m "feat(api): a proposal takes its event from its links, keeps it, and announces on it (T-704)"
```

### Task 11: A deposit request carries its proposal's event

**Files:**
- Modify: `packages/api/src/routes/deposits.ts` (150-178)
- Modify: `packages/api/src/__tests__/helpers/payments-db.ts` (`seedAcceptedProposal` already returns `eventId`,
  the event its plan is linked to, lines 147-198. It now also makes a SECOND event, sets the proposal's own
  `event_id` to it, and returns it as `proposalEventId`)
- Test: `packages/api/src/__tests__/deposits-postgres.test.ts`

**Interfaces:**
- Behaviour: the lookup before the transaction goes. Inside it, under the proposal's lock, the insert takes
  `eventId: held.eventId`.

- [ ] **Step 1: Write the failing test.** The fixture's two events differ on purpose: the old lookup picks the
  plan's, so the test fails until the route reads the proposal's own link.

```ts
it("a deposit request carries its proposal's own event, not the event its plan is linked to", async () => {
  const row = await requestRow(requestId);
  expect(row.event_id).toBe(fixture.proposalEventId);
  expect(row.event_id).not.toBe(fixture.eventId);
});
```

- [ ] **Step 2: Run to see them fail** (this suite uses `VENVIEWER_PAYMENTS_TEST_DATABASE_URL`; run the one file).
- [ ] **Step 3: Change the route and the fixture.**
- [ ] **Step 4: Run the file, and `stripe-webhook-postgres.test.ts` and `contract-signatures-postgres.test.ts`,**
  which share the fixture. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/deposits.ts packages/api/src/__tests__/helpers/payments-db.ts packages/api/src/__tests__/deposits-postgres.test.ts
git commit -m "feat(api): a deposit request takes its proposal's event under the proposal's lock (T-704)"
```

### Task 12: Acts at the same moment

**Files:**
- Test: `packages/api/src/__tests__/event-spine-writers-postgres.test.ts`
- Modify: whichever service the tests show to be wrong

- [ ] **Step 1: Write the tests.** Each fires its requests with `Promise.all`, as the bind's own race tests do,
  and repeats ten times in a loop so an unlucky order is met.

```ts
it("two replies reported at once make one event", async () => { /* events for the venue: 1 */ });
it("a reply, a hold and a deal at once on one enquiry make one event, and all three finish", async () => {
  const [reply, hold, deal] = await Promise.all([reportReply(v, id), holdFromEnquiryRaw(v, id), dealFromEnquiry(v, id)]);
  expect([reply.statusCode, hold.statusCode, deal.statusCode]).toEqual([200, 201, 201]);
  expect(await eventCount(v.venueId)).toBe(1);
});
it("a proposal sent while a hold is placed on its enquiry: both finish, on one event", async () => { /* ... */ });
it("two deals pressed at once from one enquiry by two routes: one open deal stands, and neither press is a 500", async () => {
  const [fromEnquiry, direct] = await Promise.all([dealFromEnquiry(v, id), createDeal(v, { sourceEnquiryId: id, title: "Other route" })]);
  // Either the enquiry's route wins and the direct one is refused, or the direct one wins and the enquiry's
  // route lands on the deal it finds (it answers 200 with the existing deal, crm.ts:128-132).
  expect([[201, 409], [200, 201]]).toContainEqual([fromEnquiry.statusCode, direct.statusCode]);
  expect(await openDealCount(await enquiryEvent(id))).toBe(1);
});
it("no request in this file ended in a deadlock or a 500", async () => { expect(serverErrors).toEqual([]); });
```

  `serverErrors` is filled by a Fastify `onResponse` hook that records any status of 500 or above.
- [ ] **Step 2: Run the gate.** If a case fails, fix the cause in the service (the order locks are taken in, or
  a missing catch of `isOpenDealConflict`), never the test.
- [ ] **Step 3: Commit**

```bash
git add packages/api/src/__tests__/event-spine-writers-postgres.test.ts
git commit -m "test(api): a reply, a hold, a deal and a send at the same moment keep one event (T-704)"
```

### Task 13: The notes, and pull request 2

**Files:**
- Modify: `docs/engineering/the-spine.md` ("Who writes" now names every writer and its function)
- Modify: `docs/engineering/enquiry-funnel.md` (one paragraph: a reply, a decision that says yes, a viewing and a
  price each make the enquiry's event)
- Modify: `docs/state/tasks.md` (row T-704: what is built, what is not)
- Modify: `docs/sessions/<the day>.md` (what was built, what was tested, what is switched off)

- [ ] **Step 1: Write them.** Plain words. The session log names anything not yet proved.
- [ ] **Step 2: Run the whole check** (`typecheck`, `lint`, the platform gate, the API's own `test`) and open
  pull request 2 against master once pull request 1 has merged. Its text says: no database change; what each
  writer now does; the one behaviour staff will notice (a plan-less proposal's changes are announced).
- [ ] **Step 3: Commit**

```bash
git add docs/engineering/the-spine.md docs/engineering/enquiry-funnel.md docs/state/tasks.md docs/sessions/*.md
git commit -m "docs(spine): who writes each link, and the ledger (T-704)"
```

---

### Task 14: The merge slot, and the check on the live site

This task belongs to pull request 1 and is done with the merge coordinator. Nothing in it is done alone.

- [ ] **Step 1: Ask the merge coordinator for a database slot.** Wait for it. Do not push while another
  database pull request is landing.
- [ ] **Step 2: In the slot, bring the branch up to master.** Rename the migration to the number above master's
  highest; give its journal entry the next `idx` and a `when` later than master's last; run the platform gate
  and the journal test again.
- [ ] **Step 3: Compare the journal's `when` with production's newest applied migration.** Drizzle applies only
  entries later than the newest it has recorded, so an entry with an older `when` is skipped silently. Reading
  production needs Blake's yes in the same chat, asked as a button.
- [ ] **Step 4: Send the tested head** to the merge coordinator and the release lead. Do not push after that. Do
  not merge it yourself.
- [ ] **Step 5: After it is released, read production,** with Blake's yes: run the script without `--join`.
  Expected: `"status":"holds"`. On 13 November production held one worked enquiry with one deal and one sent
  proposal and nothing in doubt, so `event_link_joins` should hold their three rows on one new event, and
  `event_link_reviews` no open question. If it reads anything else, stop and report the numbers: do not run the
  undo without Blake's word.
- [ ] **Step 6: After pull request 2 is released,** run the same read again. No test record is written to
  production: the proof on real work is the count still at zero after the office next works an enquiry.
- [ ] **Step 7: Report** what is live, what was read, and what is not yet proved, and update row T-704.

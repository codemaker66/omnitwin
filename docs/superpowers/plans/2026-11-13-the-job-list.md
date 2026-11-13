# The job list (stage 1 of the plumbing, T-702) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A list of work in PostgreSQL that the API carries out later, safely with two servers, with anything that
gives up shown to a person.

**Architecture:** One table, `jobs`. Kinds of work are declared in code. `enqueueJob(tx, …)` writes a row in the
caller's own transaction. A worker inside each API process takes due rows with `FOR UPDATE SKIP LOCKED` under a
fresh claim token, runs each handler outside any transaction and against a time limit, and sleeps until the next
row is due or the next hour. A platform-admin page lists what gave up. The same migration adds the columns
`email_sends` needs for the next plan, so stage 1 changes the database once.

**Tech Stack:** TypeScript strict, Fastify, PostgreSQL through Drizzle (`sql` for the claim), Zod, Vitest on real
PostgreSQL, `tsx` for child processes, React for one plain page.

**Spec:** `docs/superpowers/specs/2026-11-13-the-plumbing-design.md` (sections 5.1, 5.2, 5.7, 7, 8 and 9). Read it
with this plan: the plan argues from it.

**Not in this plan.** Email through the list (plan 2: the provider's key on today's path, `queueEmail`, the
`email.send` kind, the nine callers, the team invitation). The escalation wake and the daily clean-up moving onto
the list (plan 3). Stages 2 to 4 of the spec. Each gets its own plan when this one is building.

## Global Constraints

- **A job carries ids, not facts.** A payload holds ids only, is checked by Zod when written and when run, and is
  at most 2,048 bytes.
- **Every handler is safe to repeat.** The list promises at least once.
- **A handler talks to the database and to a provider, nothing heavier,** and its time limit is 15 seconds or
  less.
- **A handler runs outside any transaction.** It takes locks in the order booking, then enquiry, then event, and
  never holds a row lock on an event or a booking while it calls an outside service.
- **States:** `queued`, `running`, `done`, `dead`, `abandoned`. No others.
- **Retries:** after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then `dead`. Six tries by default.
- **Lost claims:** the first puts the job back after 5 minutes; the second makes it `dead`.
- **The database's clock decides** what is due and whose claim has run out. No comparison uses `Date.now()`.
- **No polling.** The worker asks the database when something is due, when it is poked, when it starts, and on
  each hour. `JOBS_MAX_SLEEP_MINUTES` (default 60) is the only setting for that.
- **Nothing the worker waits for is unbounded:** each handler and each of the worker's own database calls is
  raced against a limit, and whatever the loser does later is caught and logged.
- **No personal data in a log or an alert:** the kind, the job's id and the venue's id only. Every error passes
  through `scrubErrorMessage` (`packages/api/src/observability/redact.ts`).
- **Tests run on real PostgreSQL, on an explicit throwaway target:** `VENVIEWER_JOBS_TEST_DATABASE_URL`, database
  `venviewer_jobs_test` on `127.0.0.1`. Never `DATABASE_URL`, never `.env`. The suites are named in
  `REQUIRED_POSTGRES_TEST_FILES`, so CI fails if one is skipped.
- **TypeScript strict, no `any`.** Relative imports carry `.js`. Tests live in `packages/api/src/__tests__/`, and
  a database suite's name ends `-postgres.test.ts`.
- **The migration's number is fixed at merge.** It is written as the next free number on the branch and
  renumbered in the merge slot (Task 11). No other task edits `schema.ts` or the journal.
- **Every visible loading state uses** `packages/web/src/components/shared/Activity.tsx`.
- **The repository is public.** No address, local path, session id or venue-private fact in code, tests, logs or
  commit messages.
- **Commits** name their files explicitly and end with the project's co-author line.

## Review Focus

Inputs and failures the spec implies but does not test, most likely first. Each has its test in the task that owns
the code.

1. **Rows of an older shape after a deploy.** A kind whose data changed still meets rows written last week. They
   must run, not die. (Task 4: "reads old shapes".)
2. **The database unreachable for minutes.** The worker must keep trying at a calm pace, alert once for the
   outage and not once a second, and carry on when it returns. (Task 4: "a database fault".)
3. **A backlog of thousands after an outage.** The worker must drain it one at a time and give the API its turn
   between jobs. (Task 4: "yields between jobs".)
4. **Bad input when a job is written:** a key too long, data that does not match the kind, a venue's kind with no
   venue. The caller must get a clear error at once, in its own transaction, not a dead job later. (Task 2.)
5. **Two admins press Try again at the same moment.** One wins; the other is told it is already queued. (Task 8.)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/api/drizzle/<next>_job_list.sql` | The `jobs` table; the new columns and the status rule on `email_sends` |
| `packages/api/src/db/schema.ts` | The same, for Drizzle |
| `packages/api/src/services/jobs/kinds.ts` | Declaring a kind; the handler's context; the three errors a handler may throw |
| `packages/api/src/services/jobs/store.ts` | Every statement that touches `jobs` |
| `packages/api/src/services/jobs/worker.ts` | The loop: plan, take, run against a limit, finish, sleep |
| `packages/api/src/services/jobs/repeating.ts` | Work that repeats: making sure the next run exists |
| `packages/api/src/services/jobs/local-time.ts` | "09:00 at the venue" as an instant |
| `packages/api/src/services/jobs/alerts.ts` | What is reported, and the Sentry reporter |
| `packages/api/src/services/jobs/invariant.ts` | The read that finds anything stuck unseen |
| `packages/api/src/services/jobs/wake.ts` | Installing the worker, and poking it from any service |
| `packages/api/src/services/jobs/runtime.ts` | Building the registry and the worker from the environment |
| `packages/api/src/services/jobs/kinds/selftest.ts`, `daily.ts` | The harmless test kind; the daily tidy, check and check-in |
| `packages/api/src/routes/admin-jobs.ts` | Stuck work: list, try again, close, self-test |
| `packages/types/src/jobs.ts` | The shapes the routes and the page share |
| `packages/web/src/api/jobs.ts`, `components/dashboard/StuckWork.tsx` | The Stuck work page and its client |
| `packages/api/src/scripts/check-job-list-invariant.ts` | The release check |
| `docs/engineering/the-job-list.md` | How to add a kind, and the rules |

---

### Task 1: The table

**Files:**
- Create: `packages/api/drizzle/<next>_job_list.sql` (next free number on the branch; see Task 11)
- Modify: `packages/api/drizzle/meta/_journal.json` (one entry: `idx` the previous plus 1, `version` "7",
  `when` later than the previous entry's, `tag` the file's name, `breakpoints` true)
- Modify: `packages/api/src/db/schema.ts` (add `jobs`; add columns to `emailSends`, lines 1300-1315)
- Create: `packages/api/src/__tests__/helpers/jobs-db.ts`
- Test: `packages/api/src/__tests__/jobs-schema-postgres.test.ts`
- Modify: `.github/workflows/ci.yml` (create `venviewer_jobs_test`; set the variable beside lines 404-419)
- Modify: `packages/api/src/scripts/check-required-postgres-suites.ts` (name this suite)

**Interfaces:**
- Produces: the Drizzle table `jobs` and these `emailSends` columns: `venueId`, `eventId`, `enquiryId`,
  `fromHeader`, `replyTo`, `html`, `firstTriedAt`, `deliveredAt`, `expiresAt`, `attemptEpoch`.
- Produces: `openJobsDatabase(name: string): Promise<{ readonly pool: Pool; readonly db: Database }>`,
  `jobsTestUrl: string | undefined`, and `resetJobs(pool: Pool): Promise<void>` (truncates `jobs`), modelled on
  `helpers/payments-db.ts` including its check that the target is the loopback `venviewer_jobs_test`.

- [ ] **Step 1: Write the failing test**

```ts
describe.skipIf(jobsTestUrl === undefined)("jobs: the rules in the database", () => {
  it("refuses a venue's job with no venue", async () => {
    await expect(insertJob({ scope: "venue", venue_id: null })).rejects.toThrow(/jobs_scope_venue/);
  });
  it("refuses a platform job that names a venue", async () => {
    await expect(insertJob({ scope: "platform", venue_id: venueId })).rejects.toThrow(/jobs_scope_venue/);
  });
  it("refuses the same kind and key twice", async () => {
    await insertJob({ kind: "t", key: "k" });
    await expect(insertJob({ kind: "t", key: "k" })).rejects.toThrow(/jobs_kind_key_unique/);
  });
  it("refuses a running row with no claim, and a claim on a row that is not running", async () => {
    await expect(insertJob({ state: "running" })).rejects.toThrow(/jobs_claim/);
    await expect(insertJob({ state: "queued", claim_token: randomUUID() })).rejects.toThrow(/jobs_claim/);
  });
  it("refuses a payload over 2,048 bytes", async () => {
    await expect(insertJob({ payload: { pad: "x".repeat(2100) } })).rejects.toThrow(/jobs_payload_small/);
  });
  it("refuses a state outside the five", async () => {
    await expect(insertJob({ state: "paused" })).rejects.toThrow(/jobs_state/);
  });
  it("refuses a send status outside the nine", async () => {
    await expect(insertSend({ status: "maybe" })).rejects.toThrow(/email_sends_status/);
  });
  it("accepts today's five send statuses and the four new ones", async () => {
    for (const status of ["pending", "sent", "failed", "suppressed", "dev_mode", "queued", "not_sent", "bounced", "complained"]) {
      await expect(insertSend({ status })).resolves.toBeDefined();
    }
  });
  it("refuses a send that names another venue's event, or an event with no venue", async () => {
    await expect(insertSend({ venue_id: venueB, event_id: eventOfVenueA })).rejects.toThrow(/email_sends_event_venue_fk/);
    await expect(insertSend({ venue_id: null, event_id: eventOfVenueA })).rejects.toThrow(/email_sends_link_needs_venue/);
  });
});
```

`insertJob` and `insertSend` are local helpers that run plain SQL through the pool with defaults for every
column not given.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-schema-postgres.test.ts`
Expected: FAIL, `relation "jobs" does not exist`.

- [ ] **Step 3: Write the migration**

The file opens with a comment in the house style saying what the table is for. The statements, in full, because
every name here is one a later task or test relies on:

```sql
CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "key" text NOT NULL,
  "scope" text NOT NULL,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE CASCADE,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer NOT NULL,
  "lost_claims" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "claim_token" uuid,
  "claimed_by" text,
  "claim_expires_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "jobs_kind_key_unique" UNIQUE ("kind", "key"),
  CONSTRAINT "jobs_scope" CHECK ("scope" IN ('venue', 'platform')),
  CONSTRAINT "jobs_scope_venue" CHECK (("scope" = 'venue') = ("venue_id" IS NOT NULL)),
  CONSTRAINT "jobs_state" CHECK ("state" IN ('queued', 'running', 'done', 'dead', 'abandoned')),
  CONSTRAINT "jobs_claim" CHECK (
    ("state" = 'running' AND "claim_token" IS NOT NULL AND "claimed_by" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
    OR ("state" <> 'running' AND "claim_token" IS NULL AND "claimed_by" IS NULL AND "claim_expires_at" IS NULL)),
  CONSTRAINT "jobs_payload_small" CHECK (octet_length("payload"::text) <= 2048),
  CONSTRAINT "jobs_key_length" CHECK (char_length("key") BETWEEN 1 AND 300),
  CONSTRAINT "jobs_counts" CHECK ("attempts" >= 0 AND "lost_claims" >= 0 AND "max_attempts" BETWEEN 1 AND 20),
  CONSTRAINT "jobs_abandoned_has_note" CHECK ("state" <> 'abandoned' OR ("resolved_at" IS NOT NULL AND "resolution" IS NOT NULL))
);
CREATE INDEX "jobs_due_idx" ON "jobs" ("run_at") WHERE "state" = 'queued';
CREATE INDEX "jobs_claims_idx" ON "jobs" ("claim_expires_at") WHERE "state" = 'running';
CREATE INDEX "jobs_dead_idx" ON "jobs" ("finished_at") WHERE "state" = 'dead';
CREATE INDEX "jobs_venue_state_idx" ON "jobs" ("venue_id", "state");

ALTER TABLE "email_sends"
  ADD COLUMN "venue_id" uuid REFERENCES "venues"("id"),
  ADD COLUMN "event_id" uuid,
  ADD COLUMN "enquiry_id" uuid,
  ADD COLUMN "from_header" text,
  ADD COLUMN "reply_to" text,
  ADD COLUMN "html" text,
  ADD COLUMN "first_tried_at" timestamp with time zone,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD COLUMN "attempt_epoch" integer DEFAULT 0 NOT NULL;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_event_venue_fk"
  FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_enquiry_venue_fk"
  FOREIGN KEY ("enquiry_id", "venue_id") REFERENCES "enquiries"("id", "venue_id") ON DELETE RESTRICT;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_link_needs_venue"
  CHECK (("event_id" IS NULL AND "enquiry_id" IS NULL) OR "venue_id" IS NOT NULL);
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_status" CHECK ("status" IN
  ('pending', 'sent', 'failed', 'suppressed', 'dev_mode', 'queued', 'not_sent', 'bounced', 'complained')) NOT VALID;
ALTER TABLE "email_sends" VALIDATE CONSTRAINT "email_sends_status";
CREATE INDEX "email_sends_venue_created_idx" ON "email_sends" ("venue_id", "created_at");
```

Separate the statements the way the newest migrations do. The two foreign keys to the pair (id, venue) rely on
`events_id_venue_unique` (`schema.ts:1693`) and `enquiries_id_venue_unique` (`schema.ts:821`). The columns on
`email_sends` are unused until plan 2; the status rule is live at once and allows everything today's code writes
(`pending`, `sent`, `failed`, `suppressed`, `dev_mode`).

The `VALIDATE` reads every existing row, and the migration runs before each production deploy, so one stray old
status would stop a release. Task 11 reads production's distinct statuses before the merge slot for that reason.

- [ ] **Step 4: Mirror it in `schema.ts`, write the helper, name the suite in CI**

In `ci.yml`, create `venviewer_jobs_test` where the other throwaway databases are created and add
`VENVIEWER_JOBS_TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:55476/venviewer_jobs_test` beside the
others. In `check-required-postgres-suites.ts`, add this file under a comment naming the variable, as the other
groups do. Every later `-postgres.test.ts` file in this plan is added to that same group by its own task.

- [ ] **Step 5: Run it and see it pass**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-schema-postgres.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/drizzle packages/api/src/db/schema.ts packages/api/src/__tests__/helpers/jobs-db.ts \
  packages/api/src/__tests__/jobs-schema-postgres.test.ts .github/workflows/ci.yml \
  packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): the jobs table and the columns email_sends needs (T-702)"
```

---

### Task 2: Declaring a kind, and writing a job

**Files:**
- Create: `packages/api/src/services/jobs/kinds.ts`
- Create: `packages/api/src/services/jobs/store.ts` (the writing half)
- Test: `packages/api/src/__tests__/jobs-enqueue-postgres.test.ts`

**Interfaces:**
- Produces, in `kinds.ts`:

```ts
export type JobScope = "venue" | "platform";
export type JobTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type JobExecutor = Database | JobTransaction;

export interface JobLogger {
  readonly info: (obj: Record<string, unknown>, msg?: string) => void;
  readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
  readonly error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface JobContext<P> {
  readonly db: Database;
  readonly jobId: string;
  readonly venueId: string | null;
  readonly payload: P;
  /** 1 for the first try. */
  readonly attempt: number;
  /** Aborted at the kind's time limit and when the server is stopping. Pass it to every outside call. */
  readonly signal: AbortSignal;
  readonly logger: JobLogger;
  /** Marks the job done inside the caller's transaction. Throws ClaimLostError if the claim has gone. */
  readonly completeIn: (tx: JobTransaction) => Promise<void>;
}

/** Cannot get better: the job is dead at once. */
export class PermanentJobError extends Error {}
/** Try again after this many seconds instead of the usual wait. The try still counts. */
export class RetryJobIn extends Error { constructor(readonly seconds: number, message: string) }
/** The claim passed to another taker. The worker stops quietly; the handler's transaction rolls back. */
export class ClaimLostError extends Error {}

export interface JobKind<P> {
  readonly kind: string;
  readonly version: number;
  readonly reads: readonly number[];
  readonly scope: JobScope;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly parse: (payload: unknown) => P;
  readonly run: (ctx: JobContext<unknown>) => Promise<void>;
  readonly onManualRetry?: (tx: JobTransaction, payload: unknown) => Promise<void>;
}

export function defineJobKind<P>(definition: {
  readonly kind: string;                 // lower case, dots: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/
  readonly version: number;              // the shape this code writes
  readonly reads?: readonly number[];    // shapes this code can run; default [version]
  readonly scope: JobScope;
  readonly timeoutMs: number;            // 1..15_000, else it throws at definition
  readonly maxAttempts?: number;         // default 6
  readonly payload: z.ZodType<P>;
  readonly handler: (ctx: JobContext<P>) => Promise<void>;
  readonly onManualRetry?: (tx: JobTransaction, payload: P) => Promise<void>;
}): JobKind<P>;

export type JobRegistry = ReadonlyMap<string, JobKind<unknown>>;
/** Throws if two definitions share a kind. */
export function buildJobRegistry(kinds: readonly JobKind<unknown>[]): JobRegistry;
```

- Produces, in `store.ts`:

```ts
export class JobInputError extends Error {}
export interface EnqueueInput<P> {
  readonly key: string;
  readonly venueId?: string | null;
  readonly runAt?: Date;                 // default: the database's now()
  readonly payload: P;
}
/** Writes the job in the caller's transaction. A second write of the same kind and key changes nothing. */
export function enqueueJob<P>(tx: JobExecutor, kind: JobKind<P>, input: EnqueueInput<P>):
  Promise<{ readonly id: string; readonly created: boolean }>;
```

`enqueueJob` uses `INSERT … ON CONFLICT ("kind", "key") DO NOTHING RETURNING "id"`, never a caught unique
violation: an error inside the caller's transaction would abort the caller's own work. When nothing is returned it
reads the existing row's id.

- [ ] **Step 1: Write the failing tests**

```ts
const effect = defineJobKind({ kind: "test.effect", version: 1, scope: "platform", timeoutMs: 1000,
  payload: z.object({ n: z.number().int() }).strict(), handler: async () => {} });
const venueKind = defineJobKind({ kind: "test.venue", version: 1, scope: "venue", timeoutMs: 1000,
  payload: z.object({}).strict(), handler: async () => {} });

it("a transaction that rolls back leaves no job", async () => {
  await expect(db.transaction(async (tx) => {
    await enqueueJob(tx, effect, { key: "a", payload: { n: 1 } });
    throw new Error("undo");
  })).rejects.toThrow("undo");
  expect(await countJobs()).toBe(0);
});
it("a transaction that commits leaves its job, queued and due now", async () => {
  const { created } = await db.transaction((tx) => enqueueJob(tx, effect, { key: "a", payload: { n: 1 } }));
  expect(created).toBe(true);
  expect(await oneJob("test.effect", "a")).toMatchObject({ state: "queued", attempts: 0, max_attempts: 6, version: 1, scope: "platform" });
  expect(await isDueNow("test.effect", "a")).toBe(true);   // run_at <= now() by the database's clock
});
it("twenty writers of the same key make one row", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => enqueueJob(db, effect, { key: "same", payload: { n: 1 } })));
  expect(results.filter((r) => r.created)).toHaveLength(1);
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  expect(await countJobs()).toBe(1);
});
it("a duplicate inside a transaction does not abort it", async () => {
  await enqueueJob(db, effect, { key: "dup", payload: { n: 1 } });
  await db.transaction(async (tx) => {
    expect((await enqueueJob(tx, effect, { key: "dup", payload: { n: 1 } })).created).toBe(false);
    await tx.execute(sql`SELECT 1`);                          // still usable
  });
});
it("refuses data that does not match the kind, before any statement", async () => {
  await expect(enqueueJob(db, effect, { key: "a", payload: { n: "one" } as never })).rejects.toThrow(JobInputError);
  await expect(enqueueJob(db, effect, { key: "a", payload: { n: 1, name: "Ada" } as never })).rejects.toThrow(JobInputError);
});
it("refuses a venue's kind with no venue, a platform kind with one, and a key over 300 characters", async () => {
  await expect(enqueueJob(db, venueKind, { key: "a", payload: {} })).rejects.toThrow(JobInputError);
  await expect(enqueueJob(db, effect, { key: "a", venueId, payload: { n: 1 } })).rejects.toThrow(JobInputError);
  await expect(enqueueJob(db, effect, { key: "k".repeat(301), payload: { n: 1 } })).rejects.toThrow(JobInputError);
});
it("refuses a kind with a time limit over 15 seconds, and two kinds of one name", () => {
  expect(() => defineJobKind({ ...effectDefinition, timeoutMs: 15_001 })).toThrow();
  expect(() => buildJobRegistry([effect, effect])).toThrow();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-enqueue-postgres.test.ts`
Expected: FAIL, cannot find `../services/jobs/kinds.js`.

- [ ] **Step 3: Implement `kinds.ts` and `enqueueJob`**

`defineJobKind` returns an object whose `parse` runs the Zod schema and whose `run` parses `ctx.payload` and then
calls the handler, so the registry needs no `any`. `enqueueJob` validates in this order: the key's length, the
scope against `venueId`, the payload through `kind.parse` (wrapping a `ZodError` in `JobInputError` with the
issue paths only, never the values).

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/jobs/kinds.ts packages/api/src/services/jobs/store.ts \
  packages/api/src/__tests__/jobs-enqueue-postgres.test.ts packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): declare a kind and write a job in the caller's transaction (T-702)"
```

---

### Task 3: Taking, finishing, failing and recovering

**Files:**
- Modify: `packages/api/src/services/jobs/store.ts`
- Test: `packages/api/src/__tests__/jobs-claim-postgres.test.ts`

**Interfaces:**
- Consumes: `JobKind`, `JobRegistry`, `JobExecutor`, `ClaimLostError` from Task 2.
- Produces:

```ts
export const RETRY_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const LOST_CLAIM_PAUSE_SECONDS = 300;
export const CLAIM_MARGIN_SECONDS = 15;

export interface ClaimedJob {
  readonly id: string; readonly kind: string; readonly version: number; readonly venueId: string | null;
  readonly payload: unknown; readonly attempts: number; readonly claimToken: string;
}
export interface RecoveredJob {
  readonly id: string; readonly kind: string; readonly venueId: string | null;
  readonly state: "queued" | "dead"; readonly lostClaims: number;
}
/** Puts back every claim that has run out. Second lost claim, or no tries left: dead. */
export function recoverLostClaims(db: Database, pauseSeconds?: number): Promise<readonly RecoveredJob[]>;
/** Takes the oldest due job among the kinds and versions in the registry, or null. */
export function claimNextJob(db: Database, registry: JobRegistry, serverId: string): Promise<ClaimedJob | null>;
/** True if this claim finished it. False if the claim had gone. */
export function finishJob(executor: JobExecutor, id: string, claimToken: string): Promise<boolean>;
export type FailOutcome = "queued" | "dead" | "lost";
export function failJob(db: Database, id: string, claimToken: string, error: string,
  options: { readonly permanent: boolean; readonly retryInSeconds?: number }): Promise<FailOutcome>;
/** Gives the job back without counting the try. */
export function handBackJob(db: Database, id: string, claimToken: string): Promise<boolean>;
/** Seconds until the next thing this server should wake for, by the database's clock, and that clock's now.
 *  `boundaryInSeconds` is the time to the next whole multiple of `sleepMinutes` since the epoch: with 60, the
 *  top of the hour. Every server computes the same boundary, so they wake the database together. */
export function planNextWake(db: Database, registry: JobRegistry, sleepMinutes: number):
  Promise<{ readonly dueInSeconds: number | null; readonly boundaryInSeconds: number; readonly now: Date }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("two takers never take the same job", async () => {
  await seedQueued(50);
  const taken = await Promise.all(Array.from({ length: 50 }, (_, i) => claimNextJob(db, registry, i % 2 === 0 ? "a" : "b")));
  const ids = taken.filter((job) => job !== null).map((job) => job.id);
  expect(ids).toHaveLength(50);
  expect(new Set(ids).size).toBe(50);
});
it("takes the oldest due job, and leaves what is not yet due", async () => {
  await seedJob({ key: "later", runAt: sql`now() + interval '1 hour'` });
  await seedJob({ key: "older", runAt: sql`now() - interval '2 minutes'` });
  await seedJob({ key: "newer", runAt: sql`now() - interval '1 minute'` });
  expect((await claimNextJob(db, registry, "a"))?.id).toBe(await idOf("older"));
  expect((await claimNextJob(db, registry, "a"))?.id).toBe(await idOf("newer"));
  expect(await claimNextJob(db, registry, "a")).toBeNull();
});
it("takes only kinds and versions the registry knows", async () => {
  await seedJob({ kind: "test.unknown" });
  await seedJob({ kind: "test.effect", version: 9 });
  expect(await claimNextJob(db, registry, "a")).toBeNull();
  expect(await stateOfAll()).toEqual(["queued", "queued"]);
});
it("a claim lasts the kind's time limit plus the margin, and counts the try", async () => {
  await seedJob({ key: "a" });                      // test.effect has timeoutMs 1000
  const job = await claimNextJob(db, registry, "a");
  expect(job?.attempts).toBe(1);
  expect(await claimSecondsLeft("a")).toBeGreaterThan(14);
  expect(await claimSecondsLeft("a")).toBeLessThanOrEqual(16);
});
it("only the claim's own token finishes it", async () => {
  const job = await takeOne();
  expect(await finishJob(db, job.id, randomUUID())).toBe(false);
  expect(await stateOf(job.id)).toBe("running");
  expect(await finishJob(db, job.id, job.claimToken)).toBe(true);
  expect(await rowOf(job.id)).toMatchObject({ state: "done", claim_token: null, claimed_by: null, claim_expires_at: null });
});
it("fails after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then is dead", async () => {
  await seedJob({ key: "a" });
  for (const seconds of RETRY_SECONDS) {
    const job = await takeOne();
    expect(await failJob(db, job.id, job.claimToken, "no", { permanent: false })).toBe("queued");
    expect(Math.abs(await dueInSeconds("a") - seconds)).toBeLessThan(2);
    await makeDueNow("a");
  }
  const last = await takeOne();
  expect(last.attempts).toBe(6);
  expect(await failJob(db, last.id, last.claimToken, "no", { permanent: false })).toBe("dead");
  expect(await rowOf(last.id)).toMatchObject({ state: "dead", last_error: "no" });
});
it("a permanent failure is dead at once; a stated wait is used instead of the usual one", async () => {
  const a = await takeOne();
  expect(await failJob(db, a.id, a.claimToken, "never", { permanent: true })).toBe("dead");
  await seedJob({ key: "b" });
  const b = await takeOne();
  expect(await failJob(db, b.id, b.claimToken, "later", { permanent: false, retryInSeconds: 40_000 })).toBe("queued");
  expect(Math.abs(await dueInSeconds("b") - 40_000)).toBeLessThan(2);
});
it("a failure reported under a lost claim changes nothing", async () => {
  const job = await takeOne();
  expect(await failJob(db, job.id, randomUUID(), "no", { permanent: false })).toBe("lost");
  expect(await stateOf(job.id)).toBe("running");
});
it("handing back does not count the try", async () => {
  const job = await takeOne();
  expect(await handBackJob(db, job.id, job.claimToken)).toBe(true);
  expect(await rowOf(job.id)).toMatchObject({ state: "queued", attempts: 0, claim_token: null });
});
it("a claim that ran out is put back once, after the pause, and the second time is dead", async () => {
  const first = await takeOne();
  await expireClaim(first.id);
  expect(await recoverLostClaims(db)).toEqual([expect.objectContaining({ id: first.id, state: "queued", lostClaims: 1 })]);
  expect(Math.abs(await dueInSecondsById(first.id) - LOST_CLAIM_PAUSE_SECONDS)).toBeLessThan(2);
  await makeDueNowById(first.id);
  const second = await takeOne();
  await expireClaim(second.id);
  expect(await recoverLostClaims(db)).toEqual([expect.objectContaining({ id: first.id, state: "dead", lostClaims: 2 })]);
});
it("two servers recovering at once count one lost claim", async () => {
  const job = await takeOne();
  await expireClaim(job.id);
  const both = await Promise.all([recoverLostClaims(db), recoverLostClaims(db)]);
  expect(both.flat()).toHaveLength(1);
  expect((await rowOf(job.id)).lost_claims).toBe(1);
});
it("a claim that has not run out is left alone", async () => {
  const job = await takeOne();
  expect(await recoverLostClaims(db)).toEqual([]);
  expect(await stateOf(job.id)).toBe("running");
});
it("plans from the database's clock", async () => {
  await seedJob({ key: "soon", runAt: sql`now() + interval '90 seconds'` });
  const plan = await planNextWake(db, registry, 60);
  expect(Math.abs((plan.dueInSeconds ?? 0) - 90)).toBeLessThan(2);
  expect(plan.boundaryInSeconds).toBeGreaterThan(0);
  expect(plan.boundaryInSeconds).toBeLessThanOrEqual(3600);
  expect((await planNextWake(db, registry, 5)).boundaryInSeconds).toBeLessThanOrEqual(300);
});
it("plans for another server's claim running out, and for nothing when nothing is due", async () => {
  expect((await planNextWake(db, registry, 60)).dueInSeconds).toBeNull();
  await takeOne();
  const plan = await planNextWake(db, registry, 60);
  expect(plan.dueInSeconds).toBeGreaterThan(13);
  expect(plan.dueInSeconds).toBeLessThanOrEqual(16);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-claim-postgres.test.ts`
Expected: FAIL, `claimNextJob` is not exported.

- [ ] **Step 3: Implement the statements**

Each function is one statement, so each works through a pooled connection. The two that are algorithms:

```sql
-- claimNextJob. `known` is built from the registry: one row for each kind and each version it reads,
-- with lease_seconds = ceil(timeoutMs / 1000) + CLAIM_MARGIN_SECONDS. With an empty registry, skip the query.
WITH known(kind, version, lease_seconds) AS (VALUES ($1::text, $2::integer, $3::integer) /* , … */),
next AS (
  SELECT j.id, k.lease_seconds
  FROM jobs j JOIN known k ON k.kind = j.kind AND k.version = j.version
  WHERE j.state = 'queued' AND j.run_at <= now()
  ORDER BY j.run_at, j.id
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1
)
UPDATE jobs SET state = 'running', attempts = jobs.attempts + 1, claim_token = gen_random_uuid(),
  claimed_by = $server, claim_expires_at = now() + make_interval(secs => next.lease_seconds), updated_at = now()
FROM next WHERE jobs.id = next.id
RETURNING jobs.id, jobs.kind, jobs.version, jobs.venue_id, jobs.payload, jobs.attempts, jobs.claim_token;

-- recoverLostClaims. $pause defaults to LOST_CLAIM_PAUSE_SECONDS.
UPDATE jobs SET
  lost_claims = lost_claims + 1,
  state = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
  run_at = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN run_at
                ELSE now() + make_interval(secs => $pause) END,
  finished_at = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN now() ELSE NULL END,
  last_error = 'The server that took this job never answered.',
  claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
WHERE state = 'running' AND claim_expires_at < now()
RETURNING id, kind, venue_id, state, lost_claims;
```

`failJob` waits `RETRY_SECONDS[attempts - 1]` unless `retryInSeconds` is given, and makes the job `dead` when
`permanent` is true or `attempts >= max_attempts`. `finishJob`, `failJob` and `handBackJob` all carry
`WHERE id = $id AND claim_token = $token AND state = 'running'`. `planNextWake` returns, in one statement, the
seconds to the earlier of the next due job this registry knows and the next claim to run out among all running
jobs; the seconds to the next boundary
(`ceil(extract(epoch from now()) / ($minutes * 60)) * ($minutes * 60) - extract(epoch from now())`); and `now()`.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/jobs/store.ts packages/api/src/__tests__/jobs-claim-postgres.test.ts \
  packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): take, finish, fail, hand back and recover, each under a claim token (T-702)"
```

---

### Task 4: The worker

**Files:**
- Create: `packages/api/src/services/jobs/worker.ts`
- Create: `packages/api/src/services/jobs/alerts.ts` (the interface and a recording fake only; Sentry is Task 7)
- Test: `packages/api/src/__tests__/jobs-worker-postgres.test.ts`

**Interfaces:**
- Consumes: everything Task 3 produces.
- Produces, in `alerts.ts`:

```ts
export interface JobAlerts {
  readonly jobDead: (job: { readonly id: string; readonly kind: string; readonly venueId: string | null; readonly reason: string }) => void;
  readonly claimLost: (job: { readonly id: string; readonly kind: string; readonly venueId: string | null; readonly lostClaims: number }) => void;
  /** Raised once when a fault begins, and not again until `workerRecovered` has been raised for it. */
  readonly workerFault: (what: "database" | "loop", detail: string) => void;
  readonly workerRecovered: (what: "database" | "loop") => void;
  readonly checkIn: (monitor: string) => void;
}
export function recordingJobAlerts(): JobAlerts & { readonly calls: readonly (readonly [string, unknown])[] };
```

- Produces, in `worker.ts`:

```ts
export interface JobWorkerDeps {
  readonly db: Database;
  readonly registry: JobRegistry;
  readonly serverId: string;
  readonly logger: JobLogger;
  readonly alerts: JobAlerts;
  readonly sleepMinutes?: number;            // default 60; from JOBS_MAX_SLEEP_MINUTES
  readonly dbCallTimeoutMs?: number;         // default 10_000
  readonly faultRetryMs?: number;            // default 60_000
  readonly lostClaimPauseSeconds?: number;   // default LOST_CLAIM_PAUSE_SECONDS; tests pass 0
  /** Called at the end of every pass with the database's now; Task 6 uses it for work that repeats. */
  readonly afterPass?: (now: Date) => Promise<void>;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly yieldToLoop?: () => Promise<void>;   // default: setImmediate
}
export interface JobWorkerStatus {
  readonly started: boolean;
  readonly lastPassAt: number | null;          // epoch ms of the last pass that finished
  readonly nextWakeAt: number | null;
  readonly currentJob: { readonly id: string; readonly kind: string; readonly since: number } | null;
  readonly abandonedHandlers: number;
  readonly fault: "database" | "loop" | null;
}
export class JobWorker {
  constructor(deps: JobWorkerDeps);
  /** Plans from the database. Returns at once. */
  start(): void;
  /** Wakes it now. Calls made while a pass is running fold into one more pass. */
  poke(): void;
  /** Takes nothing new, waits up to graceMs for the running job, hands back what is unfinished. */
  stop(graceMs: number): Promise<void>;
  /** From memory only. Never touches the database. */
  status(): JobWorkerStatus;
}
```

One pass is: `recoverLostClaims` (raising `claimLost` or `jobDead` for each row returned); then take and run one
job at a time until none is due, yielding to the event loop after each; then `afterPass`; then `planNextWake` and
one timer for the earlier of `dueInSeconds` and `boundaryInSeconds`. Pokes in the same tick fold into one pass.

- [ ] **Step 1: Write the failing tests**

Each test builds a worker with injected `setTimer` and `clearTimer` that record the wait and let the test fire
the timer by hand, and counts statements with a wrapper round `db.execute`.

```ts
it("runs a due job and marks it done", async () => {
  await enqueueJob(db, effect, { key: "a", payload: { n: 1 } });
  worker.start(); await idle(worker);
  expect(await stateOfKey("a")).toBe("done");
  expect(ran).toEqual([1]);
});
it("sleeps until the next job is due and asks the database nothing in between", async () => {
  await enqueueJob(db, effect, { key: "later", runAt: inSeconds(90), payload: { n: 2 } });
  worker.start(); await idle(worker);
  expect(timers.at(-1)?.ms).toBeGreaterThan(80_000);
  expect(timers.at(-1)?.ms).toBeLessThanOrEqual(90_000);
  const before = statements.count;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(statements.count).toBe(before);
});
it("with nothing due, wakes on the hour by the database's clock", async () => {
  worker.start(); await idle(worker);
  expect(timers.at(-1)?.ms).toBeGreaterThan(0);
  expect(timers.at(-1)?.ms).toBeLessThanOrEqual(3_600_000);
  expect(Math.abs((timers.at(-1)?.ms ?? 0) / 1000 - await secondsToNextHour())).toBeLessThan(3);
});
it("a poke wakes it at once, and pokes during a pass fold into one more", async () => {
  worker.start(); await idle(worker);
  await enqueueJob(db, effect, { key: "now", payload: { n: 3 } });
  worker.poke(); worker.poke(); worker.poke(); await idle(worker);
  expect(await stateOfKey("now")).toBe("done");
  expect(passes.count).toBe(2);
});
it("a handler that never returns is failed at its limit, told to stop, and the next job runs", async () => {
  await enqueueJob(db, hangs, { key: "hung", payload: {} });      // timeoutMs 50; awaits a promise that never settles
  await enqueueJob(db, effect, { key: "after", payload: { n: 4 } });
  worker.start(); await idle(worker);
  expect(await rowOfKey("hung")).toMatchObject({ state: "queued", attempts: 1, last_error: expect.stringContaining("time limit") });
  expect(await stateOfKey("after")).toBe("done");
  expect(seenSignal?.aborted).toBe(true);
  expect(worker.status().abandonedHandlers).toBe(1);
});
it("what an abandoned handler does later is caught", async () => {
  const stray = vi.fn(); process.on("unhandledRejection", stray);
  await enqueueJob(db, rejectsLate, { key: "late", payload: {} });  // rejects 100 ms after its 50 ms limit
  worker.start(); await idle(worker); await new Promise((resolve) => setTimeout(resolve, 250));
  process.off("unhandledRejection", stray);
  expect(stray).not.toHaveBeenCalled();
});
it("a poisoned job goes dead with one alert while other jobs keep moving", async () => {
  await enqueueJob(db, alwaysThrows, { key: "poison", payload: {} });   // maxAttempts 2
  await enqueueJob(db, effect, { key: "fine", payload: { n: 5 } });
  worker.start(); await idle(worker); await makeDueNowByKey("poison"); worker.poke(); await idle(worker);
  expect(await stateOfKey("poison")).toBe("dead");
  expect(await stateOfKey("fine")).toBe("done");
  expect(alerts.calls.filter(([name]) => name === "jobDead")).toHaveLength(1);
  expect(JSON.stringify(alerts.calls)).not.toContain("@");
});
it("PermanentJobError is dead at once; RetryJobIn sets the wait; ClaimLostError changes nothing", async () => { /* three kinds, three assertions on state and run_at */ });
it("completeIn commits the handler's change with done, and undoes it when the claim has gone", async () => {
  // kind A: inserts into job_test_effects and calls ctx.completeIn(tx) → one row, state done.
  // kind B: the test clears its claim_token before completeIn → ClaimLostError, no row, state unchanged.
});
it("reads old shapes: a kind that reads versions 1 and 2 runs a version 1 row", async () => {
  await seedJob({ kind: "test.shaped", version: 1, payload: { old: true } });   // shaped: version 2, reads [1, 2]
  worker.start(); await idle(worker);
  expect(await stateOfKind("test.shaped")).toBe("done");
});
it("never takes a version it does not know, and still plans its next wake", async () => {
  await seedJob({ kind: "test.effect", version: 9 });
  worker.start(); await idle(worker);
  expect(await stateOfKind("test.effect")).toBe("queued");
  expect(timers.at(-1)).toBeDefined();
});
it("a database fault: one alert for the outage, a retry a minute later, and it carries on", async () => {
  breakDatabase();                                  // every statement rejects
  worker.start(); await idle(worker);
  expect(timers.at(-1)?.ms).toBe(60_000);
  timers.at(-1)?.fire(); await idle(worker);
  expect(alerts.calls.filter(([name]) => name === "workerFault")).toHaveLength(1);
  expect(worker.status().fault).toBe("database");
  mendDatabase(); timers.at(-1)?.fire(); await idle(worker);
  expect(alerts.calls.filter(([name]) => name === "workerRecovered")).toHaveLength(1);
  expect(worker.status().fault).toBeNull();
});
it("a database call of its own that never returns does not block it", async () => {
  hangNextStatement();                              // the next statement never settles
  worker = makeWorker({ dbCallTimeoutMs: 50 }); worker.start(); await idle(worker);
  expect(worker.status().fault).toBe("database");
  expect(timers.at(-1)?.ms).toBe(60_000);
});
it("yields between jobs", async () => {
  await seedQueued(3);
  worker.start(); await idle(worker);
  expect(yields.count).toBe(3);
});
it("stop takes nothing new, waits for the running job, then hands back what is unfinished", async () => {
  await enqueueJob(db, waitsForRelease, { key: "slow", payload: {} });
  await enqueueJob(db, effect, { key: "queued-behind", payload: { n: 6 } });
  worker.start(); await started("slow");
  await worker.stop(100);
  expect(await rowOfKey("slow")).toMatchObject({ state: "queued", attempts: 0 });
  expect(await stateOfKey("queued-behind")).toBe("queued");
  expect(timers.filter((timer) => !timer.cleared && !timer.fired)).toHaveLength(0);
});
it("status never touches the database", async () => {
  worker.start(); await idle(worker);
  const before = statements.count; worker.status();
  expect(statements.count).toBe(before);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-worker-postgres.test.ts`
Expected: FAIL, cannot find `../services/jobs/worker.js`.

- [ ] **Step 3: Implement `JobWorker`**

Three things the signatures do not settle:

- **Racing.** `withLimit(promise, ms)` attaches `.catch` to `promise` before racing it, so a loser that rejects
  later is logged and never becomes an unhandled rejection. The handler's race also aborts the
  `AbortController` whose signal is in the context. On a limit the worker calls
  `failJob(…, "The handler passed its time limit of N ms.", { permanent: false })` and counts one abandoned
  handler.
- **Faults.** Any rejection or limit on one of the worker's own statements ends the pass, sets `fault`, raises
  `workerFault` only if `fault` was null, and sets one timer for `faultRetryMs`. The first pass that completes
  afterwards raises `workerRecovered` and clears `fault`.
- **One pass at a time.** A flag marks a pass as running. `poke()` during a pass sets a second flag, and the pass
  runs once more when it ends. `stop()` sets a third flag that the take-loop checks before each claim.

A handler's outcome maps so: it returns, `finishJob` (unless it already called `completeIn`); `PermanentJobError`,
`failJob` permanent and `jobDead`; `RetryJobIn`, `failJob` with its seconds; `ClaimLostError`, nothing; any other
throw, `failJob` not permanent, and `jobDead` if the answer is `"dead"`. The message is always
`scrubErrorMessage(error)`.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/jobs/worker.ts packages/api/src/services/jobs/alerts.ts \
  packages/api/src/__tests__/jobs-worker-postgres.test.ts packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): the worker, which wakes when work is due and never waits unbounded (T-702)"
```

---

### Task 5: Two servers

**Files:**
- Create: `packages/api/src/__tests__/fixtures/job-worker-child.ts`
- Test: `packages/api/src/__tests__/jobs-two-process-postgres.test.ts`

**Interfaces:**
- Consumes: `JobWorker`, `defineJobKind`, `buildJobRegistry`, `enqueueJob`, `finishJob`.
- Produces: nothing other tasks use. This is the first test in the repository that starts two processes.

The child is started with `fork(fixturePath, [], { execArgv: ["--import", "tsx"], env })`. It reads
`VENVIEWER_JOBS_TEST_DATABASE_URL`, builds a worker with a server id from its arguments and
`lostClaimPauseSeconds: 0`, registers four kinds, starts, and sends `{ ready: true }`. It stops gracefully on the
message `{ stop: true }` (a message, not a signal, so the test means the same on Windows and Linux), then exits 0.

| Kind in the child | What it does |
|---|---|
| `test.effect` | Inserts one row into `job_test_effects (key text, server text)` and returns. The table has no unique rule, so a job taken twice would show |
| `test.waits` | Sends `{ started: key }` to the parent, waits for `{ release: key }`, then inserts its row |
| `test.dies` | Sends `{ dying: key }`, then calls `process.kill(process.pid, "SIGKILL")` |
| `test.slow` | Sends `{ started: key }`, then waits 10 seconds (time limit 12 seconds) |

- [ ] **Step 1: Write the failing tests**

```ts
it("two servers, one list: 200 jobs, every effect there once", async () => {
  await seedEffects(200);
  const [a, b] = await Promise.all([startChild("a"), startChild("b")]);
  await waitUntil(async () => (await countState("done")) === 200, 60_000);
  const rows = await effects();
  expect(rows).toHaveLength(200);
  expect(new Set(rows.map((row) => row.key)).size).toBe(200);
  expect(new Set(rows.map((row) => row.server))).toEqual(new Set(["a", "b"]));
  await Promise.all([stopChild(a), stopChild(b)]);
}, 90_000);
it("a server killed mid-job: the job is put back when its claim runs out, and its effect is there once", async () => {
  await enqueueJob(db, waits, { key: "w", payload: {} });
  const a = await startChild("a");
  await messageFrom(a, { started: "w" });
  a.kill("SIGKILL"); await exited(a);
  await expireClaimOfKey("w");                      // stands in for waiting out the claim
  const b = await startChild("b");
  await messageFrom(b, { started: "w" }); b.send({ release: "w" });
  await waitUntil(async () => (await stateOfKey("w")) === "done", 20_000);
  expect(await effectsFor("w")).toHaveLength(1);
  expect((await rowOfKey("w")).lost_claims).toBe(1);
  await stopChild(b);
}, 60_000);
it("a job that takes its server down does so twice and is then dead, never a third time", async () => {
  await enqueueJob(db, dies, { key: "d", payload: {} });
  for (const name of ["a", "b"]) {
    const child = await startChild(name);
    await messageFrom(child, { dying: "d" }); await exited(child);
    await expireClaimOfKey("d");
  }
  const c = await startChild("c");
  await waitUntil(async () => (await stateOfKey("d")) === "dead", 20_000);
  expect((await rowOfKey("d")).lost_claims).toBe(2);
  expect(c.exitCode).toBeNull();                    // the third server is still alive
  await stopChild(c);
}, 60_000);
it("a deploy: a server told to stop mid-job hands it back without counting the try, and exits in time", async () => {
  await enqueueJob(db, slow, { key: "s", payload: {} });
  const a = await startChild("a", { stopGraceMs: 500 });
  await messageFrom(a, { started: "s" });
  const began = Date.now(); a.send({ stop: true });
  expect(await exited(a)).toBe(0);
  expect(Date.now() - began).toBeLessThan(5_000);
  expect(await rowOfKey("s")).toMatchObject({ state: "queued", attempts: 0, lost_claims: 0 });
}, 30_000);
it("a job written while no server is running is run when one starts", async () => {
  const a = await startChild("a"); await stopChild(a);
  await enqueueJob(db, effect, { key: "after-restart", payload: { n: 1 } });
  const b = await startChild("b");
  await waitUntil(async () => (await stateOfKey("after-restart")) === "done", 20_000);
  await stopChild(b);
}, 30_000);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-two-process-postgres.test.ts`
Expected: FAIL, the fixture does not exist.

- [ ] **Step 3: Write the fixture.** No product code changes in this task. If a test fails, the fault is in Tasks
  2 to 4: fix it there, with a test in that task's own file that fails first.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 5 tests, in under two minutes.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/__tests__/fixtures/job-worker-child.ts \
  packages/api/src/__tests__/jobs-two-process-postgres.test.ts packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "test(jobs): two processes on one list, a killed server, a job that kills its server (T-702)"
```

---

### Task 6: Work that repeats, and times on the venue's clock

**Files:**
- Create: `packages/api/src/services/jobs/local-time.ts`
- Create: `packages/api/src/services/jobs/repeating.ts`
- Test: `packages/api/src/__tests__/jobs-local-time.test.ts` (no database)
- Test: `packages/api/src/__tests__/jobs-repeating-postgres.test.ts`

**Interfaces:**
- Consumes: `enqueueJob`, `JobKind`, `JobWorkerDeps.afterPass`.
- Produces:

```ts
/** The first instant strictly after `after` at which the zone's wall clock reads `hhmm` ("09:00"). A time that
 *  does not exist that day (clocks go forward) becomes the first instant after the gap; a time that happens
 *  twice (clocks go back) is its first occurrence. */
export function nextLocalTime(after: Date, hhmm: string, timeZone: string): Date;

export interface RepeatingJob {
  readonly kind: JobKind<{ readonly occurrence: string }>;
  /** The next run strictly after `after`. */
  readonly next: (after: Date) => Date;
}
/** Makes sure each repeating kind has its next run on the list. Key: the ISO instant of that run. */
export function ensureNextRuns(db: Database, repeating: readonly RepeatingJob[], now: Date): Promise<void>;
```

Before writing `nextLocalTime`, read `packages/api/src/services/escalation-clock.ts`: `quietHoursEndAfter` already
turns a venue's local time into an instant. Reuse its conversion if it fits these tests; do not add a date
library.

- [ ] **Step 1: Write the failing tests**

```ts
// jobs-local-time.test.ts. In 2027 the clocks change on Sunday 28 March and Sunday 31 October.
it("09:00 in London across the spring change", () => {
  expect(nextLocalTime(new Date("2027-03-27T09:00:00Z"), "09:00", "Europe/London").toISOString()).toBe("2027-03-28T08:00:00.000Z");
  expect(nextLocalTime(new Date("2027-03-28T08:00:00Z"), "09:00", "Europe/London").toISOString()).toBe("2027-03-29T08:00:00.000Z");
});
it("09:00 in London across the autumn change", () => {
  expect(nextLocalTime(new Date("2027-10-30T08:00:00Z"), "09:00", "Europe/London").toISOString()).toBe("2027-10-31T09:00:00.000Z");
  expect(nextLocalTime(new Date("2027-10-31T09:00:00Z"), "09:00", "Europe/London").toISOString()).toBe("2027-11-01T09:00:00.000Z");
});
it("a time that does not exist becomes the first instant after the gap", () => {
  expect(nextLocalTime(new Date("2027-03-28T00:00:00Z"), "01:30", "Europe/London").toISOString()).toBe("2027-03-28T01:00:00.000Z");
});
it("a time that happens twice is its first occurrence", () => {
  expect(nextLocalTime(new Date("2027-10-30T23:30:00Z"), "01:30", "Europe/London").toISOString()).toBe("2027-10-31T00:30:00.000Z");
});
it("is strictly after, and refuses a malformed time or zone", () => {
  expect(nextLocalTime(new Date("2027-06-01T08:00:00Z"), "09:00", "Europe/London").toISOString()).toBe("2027-06-02T08:00:00.000Z");
  expect(() => nextLocalTime(new Date(), "9am", "Europe/London")).toThrow();
  expect(() => nextLocalTime(new Date(), "09:00", "Mars/Olympus")).toThrow();
});
it("pins what hold reminders do today: seven days before is exactly 168 hours", () => {
  const decision = new Date("2027-03-29T08:00:00Z");                    // 09:00 in London, the day after the change
  const sevenDays = computeHoldReminderInstants(decision).find((instant) => instant.daysBefore === 7);
  expect(sevenDays?.at.toISOString()).toBe("2027-03-22T08:00:00.000Z"); // 08:00 by London's clock, an hour early
});

// jobs-repeating-postgres.test.ts
it("writes the next run once, however often and by however many servers it is asked", async () => {
  const daily: RepeatingJob = { kind: occurrenceKind, next: (after) => nextLocalTime(after, "03:00", "UTC") };
  const now = new Date("2027-01-10T12:00:00Z");
  await Promise.all([ensureNextRuns(db, [daily], now), ensureNextRuns(db, [daily], now), ensureNextRuns(db, [daily], now)]);
  expect(await jobsOfKind(occurrenceKind.kind)).toEqual([expect.objectContaining({ key: "2027-01-11T03:00:00.000Z", state: "queued" })]);
});
it("a run that is taken has its next run written at the end of that pass, and a dead run does not end the series", async () => {
  // worker with afterPass: (now) => ensureNextRuns(db, [daily], now); the occurrence kind always throws, maxAttempts 1.
  // After the pass: the due occurrence is dead, and the next occurrence exists, queued.
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-local-time.test.ts src/__tests__/jobs-repeating-postgres.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement both.** `ensureNextRuns` is one `enqueueJob` for each repeating kind with
  `key = next(now).toISOString()`, `runAt = next(now)` and `payload = { occurrence: key }`.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/jobs/local-time.ts packages/api/src/services/jobs/repeating.ts \
  packages/api/src/__tests__/jobs-local-time.test.ts packages/api/src/__tests__/jobs-repeating-postgres.test.ts \
  packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): work that repeats, on the venue's own clock (T-702)"
```

---

### Task 7: Alerts, the release check, and wiring into the API

**Files:**
- Modify: `packages/api/src/services/jobs/alerts.ts` (add the Sentry and the log reporters)
- Create: `packages/api/src/services/jobs/invariant.ts`
- Create: `packages/api/src/services/jobs/kinds/selftest.ts`, `packages/api/src/services/jobs/kinds/daily.ts`
- Create: `packages/api/src/services/jobs/wake.ts`, `packages/api/src/services/jobs/runtime.ts`
- Create: `packages/api/src/scripts/check-job-list-invariant.ts`
- Modify: `packages/api/src/env.ts` (two variables), `packages/api/src/index.ts` (install; one health route),
  `packages/api/package.json` (one script), `.github/workflows/production-receipt.yml` (note `/health/worker`
  beside `/health/ready`, lines 134-135)
- Test: `packages/api/src/__tests__/jobs-alerts.test.ts` (no database)
- Test: `packages/api/src/__tests__/jobs-runtime-postgres.test.ts`

**Interfaces:**
- Consumes: `JobWorker`, `JobAlerts`, `RepeatingJob`, `ensureNextRuns`, `nextLocalTime`.
- Produces:

```ts
// alerts.ts
export function logJobAlerts(logger: JobLogger): JobAlerts;
/** Reports through @sentry/node when SENTRY_DSN is set; otherwise returns logJobAlerts(logger). */
export function buildJobAlerts(env: Pick<Env, "SENTRY_DSN">, logger: JobLogger): Promise<JobAlerts>;

// invariant.ts
export interface JobListInvariant {
  readonly overdueJobs: number;        // queued, due more than 2 hours ago, of a kind this code knows
  readonly expiredClaims: number;      // running, claim ran out more than 1 hour ago
  readonly staleQueuedSends: number;   // email_sends with status 'queued' written more than 1 day ago
  readonly unreadableJobs: number;     // queued, of a kind or version this code does not know
}
export function readJobListInvariant(db: Database, registry: JobRegistry): Promise<JobListInvariant>;
export function isHealthy(invariant: JobListInvariant): boolean;

// kinds/selftest.ts and kinds/daily.ts
export const selfTestJob: JobKind<{ readonly nonce: string }>;     // "jobs.selftest", platform, 5 s; does nothing
export function dailyJob(deps: { readonly registry: () => JobRegistry; readonly alerts: JobAlerts }):
  RepeatingJob;                                                     // "jobs.daily", 03:00 UTC, 15 s, 2 tries

// wake.ts, after the pattern of services/escalation-wake.ts
export function installJobWorker(worker: JobWorker | null): void;
/** Wakes the installed worker. Does nothing when none is installed. Call it after your transaction commits. */
export function pokeJobWorker(): void;
export function installedJobWorker(): JobWorker | null;

// runtime.ts
/** Every kind this build knows, and which of them repeat. The one place a new kind is added. */
export function buildJobKinds(alerts: JobAlerts):
  { readonly kinds: readonly JobKind<unknown>[]; readonly repeating: readonly RepeatingJob[] };
/** Builds the registry; with JOBS_WORKER on, starts a worker (sleepMinutes from JOBS_MAX_SLEEP_MINUTES, afterPass
 *  calling ensureNextRuns) and installs it. With it off, installs nothing. */
export function startJobs(deps: { readonly db: Database; readonly env: Env; readonly logger: JobLogger }):
  Promise<{ readonly worker: JobWorker | null; readonly registry: JobRegistry; readonly stop: (graceMs: number) => Promise<void> }>;
```

`jobs.daily` does three things, each in its own short statement: deletes up to 1,000 `done` or `abandoned` rows
finished more than 90 days ago (and enqueues itself again with a fresh key if it deleted 1,000); reads the
invariant and raises `workerFault("loop", …)` with the four counts if it is not healthy; and calls
`alerts.checkIn("job-list-daily")`.

Environment, in `env.ts`: `JOBS_WORKER: z.enum(["on", "off"]).default("off")` and
`JOBS_MAX_SLEEP_MINUTES: z.coerce.number().int().min(1).max(360).default(60)`.

The health route, `GET /health/worker`, answers from `installedJobWorker()?.status()` and never touches the
database. It answers 200 with `{ worker: "off" }` when none is installed; 200 with the status when all is well;
and 503 with the status when the worker has a fault, when `nextWakeAt` passed more than two minutes ago with no
pass running, or when `currentJob.since` is more than 60 seconds old.

In `index.ts`, `startJobs` is called after the database connection is made, and its `stop(20_000)` is registered
so that it runs before the hook that closes the database pool. Check the order in which Fastify runs `onClose`
hooks against the installed version before choosing where to register it, and prove it with the test below.

- [ ] **Step 1: Write the failing tests**

```ts
// jobs-alerts.test.ts
it("an alert carries the kind, the job and the venue, and no address", () => {
  const sent = captureSentry();                                   // a stand-in for the Sentry client
  alerts.jobDead({ id: "j1", kind: "email.send", venueId: "v1", reason: scrubErrorMessage("refused ada@example.org") });
  expect(sent[0]).toMatchObject({ level: "error", tags: { "job.kind": "email.send", "job.id": "j1", "venue.id": "v1" } });
  expect(JSON.stringify(sent[0])).not.toContain("@");
});
it("groups one job's alerts together and keeps different jobs apart", () => {
  expect(fingerprintOf(deadEvent("j1"))).toEqual(fingerprintOf(deadEvent("j1")));
  expect(fingerprintOf(deadEvent("j1"))).not.toEqual(fingerprintOf(deadEvent("j2")));
});
it("without a DSN it logs instead, at error level, with the same fields", async () => { /* buildJobAlerts({ SENTRY_DSN: undefined }, logger) */ });

// jobs-runtime-postgres.test.ts
it("with JOBS_WORKER off nothing is installed and the health route says so", async () => {
  const response = await server.inject({ method: "GET", url: "/health/worker" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ worker: "off" });
});
it("with JOBS_WORKER on the worker runs, and the health route reports it without a statement", async () => {
  const before = statements.count;
  const response = await onServer.inject({ method: "GET", url: "/health/worker" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ started: true, fault: null });
  expect(statements.count).toBe(before);
});
it("the health route answers 503 when the worker is overdue or has a fault", async () => { /* stub status(); two cases */ });
it("closing the server stops the worker before the database pool closes", async () => {
  // a job is running when server.close() is called: afterwards its row is queued with attempts 0, and no
  // "Cannot use a pool after calling end" error was logged.
});
it("the self-test job runs and ends done", async () => {
  await enqueueJob(db, selfTestJob, { key: "t1", payload: { nonce: "t1" } }); pokeJobWorker();
  await waitUntil(async () => (await stateOfKey("t1")) === "done", 5_000);
});
it("a clean list is healthy; each kind of stuck row is counted", async () => {
  expect(isHealthy(await readJobListInvariant(db, registry))).toBe(true);
  await seedJob({ key: "old", runAt: sql`now() - interval '3 hours'` });
  await seedRunning({ key: "gone", claimExpiresAt: sql`now() - interval '2 hours'` });
  await seedJob({ kind: "test.unknown", key: "alien" });
  await seedSend({ status: "queued", createdAt: sql`now() - interval '2 days'` });
  await seedSend({ status: "pending", createdAt: sql`now() - interval '2 days'` });   // today's path: not counted
  expect(await readJobListInvariant(db, registry)).toEqual({ overdueJobs: 1, expiredClaims: 1, staleQueuedSends: 1, unreadableJobs: 1 });
});
it("the daily job tidies old finished rows, reads the invariant and checks in", async () => { /* seeds a done row 91 days old */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/jobs-alerts.test.ts src/__tests__/jobs-runtime-postgres.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement.** The Sentry reporter uses `captureMessage` with tags `job.kind`, `job.id` and
  `venue.id`, a fingerprint of the alert's name and the job's id, and `captureCheckIn` for `checkIn`, creating the
  monitor on first use with a daily schedule. `check-job-list-invariant.ts` opens the database from
  `DATABASE_URL`, prints the four counts and nothing else, and exits 1 unless `isHealthy`. Its package script is
  `"db:check-job-list": "tsx src/scripts/check-job-list-invariant.ts"`.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/jobs packages/api/src/scripts/check-job-list-invariant.ts packages/api/src/env.ts \
  packages/api/src/index.ts packages/api/package.json packages/api/src/__tests__/jobs-alerts.test.ts \
  packages/api/src/__tests__/jobs-runtime-postgres.test.ts packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): alerts, the release check, and the worker inside the API behind a switch (T-702)"
```

---

### Task 8: Stuck work, the routes

**Files:**
- Create: `packages/types/src/jobs.ts` (and its line in the types barrel)
- Create: `packages/api/src/routes/admin-jobs.ts`
- Modify: `packages/api/src/services/jobs/store.ts` (three functions), `packages/api/src/index.ts` (register)
- Test: `packages/api/src/__tests__/admin-jobs-postgres.test.ts`

**Interfaces:**
- Consumes: `JobRegistry`, `enqueueJob`, `selfTestJob`, `pokeJobWorker`, `installedJobWorker`.
- Produces, in `packages/types/src/jobs.ts`:

```ts
export const StuckJobSchema = z.object({
  id: z.uuid(), kind: z.string(), venueId: z.uuid().nullable(), venueName: z.string().nullable(),
  attempts: z.number().int(), lostClaims: z.number().int(), reason: z.string().nullable(),
  dueAt: z.iso.datetime(), gaveUpAt: z.iso.datetime(),
});
export const JobWorkerStatusSchema = z.object({
  started: z.boolean(), lastPassAt: z.number().nullable(), nextWakeAt: z.number().nullable(),
  currentJob: z.object({ id: z.uuid(), kind: z.string(), since: z.number() }).nullable(),
  abandonedHandlers: z.number().int(), fault: z.enum(["database", "loop"]).nullable(),
});
export const StuckWorkSchema = z.object({
  jobs: z.array(StuckJobSchema).max(200),
  counts: z.object({ queued: z.number().int(), running: z.number().int(), dead: z.number().int(), oldPendingSends: z.number().int() }),
  worker: z.union([z.object({ worker: z.literal("off") }), JobWorkerStatusSchema]),
});
export const CloseStuckJobSchema = z.object({ note: z.string().trim().min(1).max(500) });
export type StuckJob = z.infer<typeof StuckJobSchema>;
export type StuckWork = z.infer<typeof StuckWorkSchema>;
```

- Produces, in `store.ts`:

```ts
export function listStuckWork(db: Database): Promise<Omit<StuckWork, "worker">>;   // newest 200 dead jobs
/** Dead back to queued, due now, tries and lost claims reset. Runs the kind's onManualRetry in the same
 *  transaction. False if the job was not dead. */
export function retryDeadJob(db: Database, registry: JobRegistry, id: string, byUserId: string): Promise<boolean>;
export function abandonDeadJob(db: Database, id: string, byUserId: string, note: string): Promise<boolean>;
```

- Routes, all behind `authenticate` and `authorizePlatformAdmin()` as `routes/admin.ts` does:
  `GET /admin/jobs/stuck`; `POST /admin/jobs/:id/retry`; `POST /admin/jobs/:id/close`; `POST /admin/jobs/selftest`.
  A retry or close of a job that is not dead answers 409 with the code `JOB_NOT_STUCK`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a venue's admin, a hallkeeper and a signed-out caller are refused on all four routes", async () => { /* 403, 403, 401 */ });
it("lists dead jobs with their venue's name, newest first, and the counts", async () => {
  const body = (await asPlatformAdmin("GET", "/admin/jobs/stuck")).json().data;
  expect(body.jobs.map((job: StuckJob) => job.id)).toEqual([newerDeadId, olderDeadId]);
  expect(body.jobs[0]).toMatchObject({ kind: "test.venue", venueName: "Test Hall", reason: "no" });
  expect(body.counts).toEqual({ queued: 1, running: 0, dead: 2, oldPendingSends: 1 });
});
it("Try again puts a dead job back, due now, with its tries reset, and records who", async () => {
  expect((await asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`)).statusCode).toBe(200);
  expect(await rowOf(deadId)).toMatchObject({ state: "queued", attempts: 0, lost_claims: 0, resolved_by: adminId, resolution: "Tried again" });
});
it("Try again runs the kind's own preparation in the same transaction", async () => { /* onManualRetry writes a marker; it is there */ });
it("two admins pressing Try again at the same moment: one 200, one 409", async () => {
  const both = await Promise.all([asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`), asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`)]);
  expect(both.map((response) => response.statusCode).sort()).toEqual([200, 409]);
});
it("Close needs a note of 1 to 500 characters and records it", async () => {
  expect((await asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "  " })).statusCode).toBe(400);
  expect((await asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "Sent by hand" })).statusCode).toBe(200);
  expect(await rowOf(deadId)).toMatchObject({ state: "abandoned", resolution: "Sent by hand", resolved_by: adminId });
});
it("a job that is not dead cannot be tried again or closed", async () => { /* 409 JOB_NOT_STUCK for queued, running, done */ });
it("the self-test route writes one job and pokes the worker", async () => { /* 200, { data: { id } }, row exists */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/admin-jobs-postgres.test.ts`
Expected: FAIL, 404 on every route.

- [ ] **Step 3: Implement.** `retryDeadJob` and `abandonDeadJob` are each one conditional `UPDATE … WHERE id = $id
  AND state = 'dead'`, so the second of two callers changes nothing.

- [ ] **Step 4: Run them and see them pass**

Run: the same command. Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/jobs.ts packages/types/src/index.ts packages/api/src/routes/admin-jobs.ts \
  packages/api/src/services/jobs/store.ts packages/api/src/index.ts \
  packages/api/src/__tests__/admin-jobs-postgres.test.ts packages/api/src/scripts/check-required-postgres-suites.ts
git commit -m "feat(jobs): Stuck work for platform admins: list, try again, close (T-702)"
```

---

### Task 9: Stuck work, the page

**Files:**
- Create: `packages/web/src/api/jobs.ts`
- Create: `packages/web/src/components/dashboard/StuckWork.tsx`
- Modify: `packages/web/src/components/dashboard/DashboardLayout.tsx:66-97` (the view `"stuckWork"`, labelled
  "Stuck work", with the capability `platformAdmin`, after "Admin")
- Modify: `packages/web/src/pages/DashboardPage.tsx` (`DASHBOARD_VIEW_VALUES` at :45, `ADMIN_ONLY_VIEWS` at :89,
  and where a view is rendered)
- Test: `packages/web/src/components/dashboard/__tests__/StuckWork.test.tsx`
- Test: the existing tests that list the header's entries for a platform admin gain the new entry

**Interfaces:**
- Consumes: `StuckWorkSchema`, `StuckWork`, `StuckJob`, `CloseStuckJobSchema` from `@omnitwin/types`; the web's
  `api.get(path, schema, signal)` and `api.post(path, body, skipAuth, schema, options)` (`api/client.ts`).
- Produces, in `api/jobs.ts`:

```ts
export function getStuckWork(signal?: AbortSignal): Promise<StuckWork>;      // GET /admin/jobs/stuck
export function retryStuckJob(id: string): Promise<void>;                    // POST /admin/jobs/:id/retry
export function closeStuckJob(id: string, note: string): Promise<void>;      // POST /admin/jobs/:id/close
export function runSelfTest(): Promise<{ readonly id: string }>;             // POST /admin/jobs/selftest
```

- Produces: `export function StuckWork(): ReactElement`.

What the page is, decided here so nobody has to invent it:

- It is a view of the dashboard that only a platform admin is offered, as "Admin" and "Clients & access" are
  (`DashboardLayout.tsx:96-97` and `:137`). It adds no place for venue staff.
- **One sentence of real counts first.** "2 jobs gave up. 1 is waiting. The worker last ran 3 minutes ago."
  With nothing stuck: "Nothing is stuck." With the worker off: "The worker is switched off." With a fault: "The
  worker cannot reach the database."
- **A plain table**, newest first: what kind, whose venue, when it gave up, tries, the reason. Each row has two
  buttons, **Try again** and **Close with a note**. The note is asked for in place, 1 to 500 characters.
- **One line for old sends:** "14 old sends were never recorded as sent or failed." No button.
- **One button, Run the self-test.** It says "The self-test ran." when the list is read again and the job is not
  on it.
- Loading and working states use `ActivityStatus` from `components/shared/Activity.tsx`. A refusal shows the
  server's own words. The page reads the list when it opens and after each action, never on a timer.
- No decoration: the dashboard's own type, table and buttons. Nothing new is drawn.

- [ ] **Step 1: Write the failing tests** (mock `../../../api/jobs.js` with `vi.hoisted`, as
  `__tests__/AdminPanel.test.tsx:12-32` mocks its clients)

```ts
it("says nothing is stuck when the list is empty", async () => {
  mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [], counts: { queued: 0, running: 0, dead: 0, oldPendingSends: 0 } }));
  render(<StuckWork />);
  expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
});
it("counts in a sentence, and lists each job with its venue and reason", async () => {
  mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job("j1", { kind: "email.send", venueName: "Test Hall", reason: "The address was refused." })] }));
  render(<StuckWork />);
  expect(await screen.findByText(/1 job gave up\./)).toBeDefined();
  const row = screen.getByRole("row", { name: /email\.send/ });
  expect(within(row).getByText("Test Hall")).toBeDefined();
  expect(within(row).getByText("The address was refused.")).toBeDefined();
});
it("says when the worker is switched off, and when it has a fault", async () => { /* two renders, two sentences above */ });
it("Try again calls the route, reads the list again, and the row is gone", async () => {
  mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job("j1")] })).mockResolvedValueOnce(stuck({ jobs: [] }));
  mocks.retryStuckJob.mockResolvedValue(undefined);
  render(<StuckWork />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => { expect(mocks.retryStuckJob).toHaveBeenCalledWith("j1"); });
  expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
});
it("a job someone else already put back says so", async () => {
  mocks.retryStuckJob.mockRejectedValue(new ApiError(409, "JOB_NOT_STUCK", "This job is already back on the list."));
  /* click Try again → the text "This job is already back on the list." is shown, and the list is read again */
});
it("Close asks for a note and will not send an empty one", async () => {
  /* click "Close with a note" → a labelled text box; "Close" is disabled while the note is blank;
     type "Sent by hand" → click Close → closeStuckJob("j1", "Sent by hand") */
});
it("shows the count of old sends only when there are some", async () => { /* 14 → the sentence; 0 → no such line */ });
it("shows its loading state through ActivityStatus, and the server's words when the list cannot be read", async () => {
  /* a pending promise → role "status"; a rejection with ApiError(500, "X", "The list could not be read.") → that text and a "Try again" for the read */
});
```

  And in the header's own tests: a platform admin is offered "Stuck work"; a venue admin, a manager and a
  hallkeeper are not; `canOpenDashboardView("stuckWork", role, "none")` is false for every venue role.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/dashboard/__tests__/StuckWork.test.tsx`
Expected: FAIL, cannot find `../StuckWork.js`.

- [ ] **Step 3: Implement** the client, the component and the view's entry.

- [ ] **Step 4: Run them and see them pass**

Run: the same command, then the header's and the dashboard page's existing test files.
Expected: PASS, 8 new tests, and no existing test changed except to add the entry.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/jobs.ts packages/web/src/components/dashboard/StuckWork.tsx \
  packages/web/src/components/dashboard/DashboardLayout.tsx packages/web/src/pages/DashboardPage.tsx \
  packages/web/src/components/dashboard/__tests__/StuckWork.test.tsx
git commit -m "feat(jobs): the Stuck work page, for platform admins only (T-702)"
```

Add to that commit any existing test file changed for the new entry, by name.

---

### Task 10: The notes

**Files:**
- Create: `docs/engineering/the-job-list.md`
- Modify: `docs/engineering/README.md` (one entry)
- Modify: `docs/operations/diary-first-week-operations.md:171`
- Modify: `docs/state/tasks.md` (row T-702) and the day's `docs/sessions/` file

- [ ] **Step 1: Write `the-job-list.md`**, short and for the next engineer: what the list promises (at least once);
  how to add a kind (the `defineJobKind` call, a key that names the thing, ids only); the seven rules from this
  plan's Global Constraints, each with its reason in a clause; how a kind's data is changed in two deploys; how to
  call `enqueueJob` inside a transaction and `pokeJobWorker` after it; how to read Stuck work and
  `/health/worker`; and the two switches.
- [ ] **Step 2: Replace the line in the operations note** that says the cron owns timing with: "The job list owns
  timing; the code owns being safe to repeat (`docs/engineering/the-job-list.md`). The request-escalation wake
  still runs by itself until it moves onto the list."
- [ ] **Step 3: Update the ledger row and the session log**, saying what is built, what is switched off, and what
  is not yet proved.
- [ ] **Step 4: Check** every link resolves and `git diff --check` is clean.
- [ ] **Step 5: Commit**

```bash
git add docs/engineering/the-job-list.md docs/engineering/README.md docs/operations/diary-first-week-operations.md \
  docs/state/tasks.md docs/sessions
git commit -m "docs(jobs): how the job list works, and the rule it replaces (T-702)"
```

---

### Task 11: The whole check, the merge slot, and switching on

No product code. Each step has a result to record in the pull request.

- [ ] **Step 1: The whole check on the branch.** `pnpm --filter @omnitwin/types build`, then for the API
  `typecheck`, `lint` and `test`; for the web `typecheck`, `lint` and the page's tests. Heavy runs go through the
  house queue, one at a time. Expected: all pass, and the required-suites check names every file this plan added.
- [ ] **Step 2: Open the pull request** as a draft with what was built, what was tested, and what is switched off.
- [ ] **Step 3: Ask orchestration for a merge slot.** Before it: read, without changing anything, the distinct
  values of `email_sends.status` in production, and write them in the pull request. If any is outside the nine,
  stop and ask; do not widen the rule to fit. In the slot: bring master in; rename the migration to master's
  highest number plus one; set the journal entry's `idx` to the previous plus one and its `when` later than both
  the previous entry's and production's newest; run Task 1's suite again; run the whole check again.
- [ ] **Step 4: Send the tested head** to orchestration and the release lead. Do not push again. Do not merge.
- [ ] **Step 5: After the deploy, with the switch still off:** `/health/ready` is 200, `/health/worker` says
  `{ "worker": "off" }`, and `pnpm --filter @omnitwin/api db:check-job-list` exits 0.
- [ ] **Step 6: Switch on,** with the release lead: set `JOBS_WORKER=on` on the API service. After the restart:
  `/health/worker` shows `started: true` and `fault: null`; press Run the self-test and see "The self-test ran.";
  the next morning, the daily job has run once and Sentry shows its check-in.
- [ ] **Step 7: The rehearsal through Neon's pooled address.** With Blake's yes for a throwaway, free Neon project
  holding no real data: run Task 5's suite against its pooled address, then delete the project. Record the
  result. This is the one thing CI cannot show, because CI's database has no pooler in front of it.
- [ ] **Step 8: Point one outside check at `/health/worker`** (Sentry's included uptime monitor), so a worker that
  has stopped is noticed by something that is not the worker.

**To undo this plan's work:** set `JOBS_WORKER=off`. Nothing else uses the list until plan 2, so nothing else
changes. The table and the new columns are harmless left in place; dropping them is a later migration of its own.

---

## Two things to read from the code before the task that needs them

1. **Task 7, the order of shutdown.** Which way the installed Fastify runs `onClose` hooks decides where the
   worker's stop is registered. Read it from the installed version; Task 7's fourth runtime test proves the
   choice.
2. **Task 7 and Task 11, where the release check runs.** The existing database check of this kind is
   `packages/api/src/scripts/check-booking-event-bind.ts`. Search the workflows and `package.json` for its name
   and wire `check-job-list-invariant.ts` the same way. The production receipt holds no database address
   (`.github/workflows/production-receipt.yml`), so there the check is the health route: add `/health/worker`
   beside its `/health/ready` line (`:134-135`). Inside production, the daily job reads the invariant itself.

## What comes after this plan

- **Plan 2, email through the list:** today's path gives Resend the send's key; `queueEmail(tx, …)`; the
  `email.send` kind with the provider's answers from the spec's section 5.3; the nine callers behind one switch;
  the team invitation's third state.
- **Plan 3:** the escalation wake and the five clean-up passes as kinds on the list.
- Then the spec's stages 2, 3 and 4, each with its own plan and its own merge slot.

The spec's "done when" has two halves. This plan proves the machinery under the first half: one job, two
servers, once. Blake's own rehearsal of "a reminder goes out once, even with two servers" comes with plan 2,
when an email can travel through the list. The second half, a reply landing on its event, comes with stage 3.

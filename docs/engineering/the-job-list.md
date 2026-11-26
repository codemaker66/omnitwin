# The job list: work that runs later, at least once

**Read this when:** adding a kind of work that runs later, changing a kind's data,
switching the worker on, or reading Stuck work or `/health/worker`.

The job list is a table, `jobs`, and a worker inside each API process. A request
writes a job in its own transaction, so the job exists exactly when the request's
change does. A worker takes due jobs one at a time and runs each kind's handler. A job
survives a restart and is tried again when it fails. The code is in
`packages/api/src/services/jobs/`; the design is
[the plumbing](../superpowers/specs/2026-11-13-the-plumbing-design.md), section 5.1.

Two kinds exist today, in `services/jobs/kinds/`: `jobs.selftest` (does nothing, ends
`done`) and `jobs.daily` (the list's own tidy and check). Read them first; each is one
`defineJobKind` call.

## What the list promises

**At least once, never exactly once.** A handler must be safe to repeat. A job runs
twice when:

- its server dies or hangs and the job's claim (the hold a worker takes on it while it
  runs) runs out, so the job is put back;
- its handler passes its time limit, the worker records a failed try, and the handler
  later finishes anyway (Node cannot stop a running function);
- a person presses Try again on Stuck work.

A job is `queued`, `running`, `done`, `dead` (out of tries) or `abandoned` (closed by a
person with a note). The table's check allows no other state. The database's clock
decides what is due and whose claim has run out: nothing that decides either reads the
server's clock.

## Add a kind

1. Define it, in `services/jobs/kinds/<name>.ts`. This is an example, not a kind that
   exists:

   ```ts
   export const holdReminderJob = defineJobKind({
     kind: "holds.reminder",          // lower case words joined by dots
     version: 1,                      // the shape of the payload this code writes
     scope: "venue",                  // "venue" needs a venue id; "platform" takes none
     timeoutMs: 10_000,               // 1 to 15,000
     payload: z.object({ holdId: z.uuid() }).strict(),
     handler: async (ctx) => {
       await ctx.db.transaction(async (tx) => {
         // Read the hold again and do what is true now (nothing, if it was released).
         await ctx.completeIn(tx);    // marks the job done in this same transaction
       });
     },
   });
   ```

   Optional: `maxAttempts` (default 6, at most 20), `reads` (default `[version]`) and
   `onManualRetry(tx, payload)`, which runs inside Try again's transaction.
   `defineJobKind` throws for a name, version, limit or attempt count outside these.

2. Add it to the array in `buildJobKinds` (`services/jobs/runtime.ts`), the one place a
   kind is added. Two kinds with one name throw when the registry is built. A kind
   that repeats (see Work that repeats) is registered there too, but as a
   `RepeatingJob` in the `repeating` list; its kind joins the registry from that list,
   so it is not added to the array a second time.

3. Write the job in the transaction that makes it necessary, and poke the worker after
   that transaction commits:

   ```ts
   const { id, created } = await db.transaction(async (tx) => {
     // ...the change that makes the reminder necessary...
     return enqueueJob(tx, holdReminderJob, {
       key: `hold:${hold.id}`,                // names the thing, not the attempt
       venueId: hold.venueId,
       runAt: remindAt,                       // optional; default is now, by the database
       payload: { holdId: hold.id },
     });
   });
   pokeJobWorker();
   ```

   - **The key names the thing.** A second write of the same kind and key changes
     nothing and answers `created: false` with the first job's id. A key is 1 to 300
     characters. A job keeps its key while it exists. A `dead` job keeps it until a
     person closes the job, and the daily tidy deletes a `done` or `abandoned` job 90
     days after it finished or was closed, whichever was later. A key you want to use
     again later must carry what makes the work new (a date, a version).
   - **Poke after the commit.** A poke inside the transaction can wake the worker before
     the job is visible. `pokeJobWorker()` wakes this process's worker only, and does
     nothing when none runs. A job written by a server with no worker waits for another
     server's worker to look, up to `JOBS_MAX_SLEEP_MINUTES` (60 by default).
   - **`enqueueJob` refuses before it sends a statement**, with `JobInputError`, because
     a failed statement would abort your transaction and with it your own work. It
     refuses a key or payload text PostgreSQL cannot store, a venue id on a platform
     kind or none on a venue kind, a venue id that is not shaped like an id, a run time
     that is not a date, and a payload that does not fit the schema, is not an object,
     holds a number written with an exponent (jsonb prints it in full), or is over
     2,048 bytes as PostgreSQL prints it (jsonb puts a space after every `:` and `,`).
   - **One refusal it cannot make.** A venue id with the shape of an id that names no
     venue fails the table's foreign key and aborts your transaction. Pass a venue you
     read in that transaction, never an id taken on trust. A venue's job goes when the
     venue does.

4. Test it on real PostgreSQL (see Tests, below).

### What a handler gets, and how it ends

`ctx` carries `db`, `jobId`, `venueId`, `payload` (parsed again by your schema as the
job runs), `attempt` (1 for the first try), `signal`, `logger` and `completeIn`. It does
not carry the job's version.

- **Return:** the worker marks the job `done`. A handler whose work only changes our
  own database opens its own transaction and calls `ctx.completeIn(tx)` there, so the
  change and `done` commit together. If the claim has gone, `completeIn` throws
  `ClaimLostError`, the transaction rolls back and the worker stops quietly. Call
  `completeIn` as the transaction's last step, and let any error from it or from the
  transaction leave the transaction's callback. The worker counts the job done once
  `completeIn` has answered, so a handler that catches the transaction's failure and
  returns leaves the job `running` until its claim runs out.
- **Throw:** a failed try (see Retries). `PermanentJobError` makes the job `dead` at
  once. `RetryJobIn(seconds, message)` asks for its own wait instead of the usual one;
  the worker holds it between 1 second and 7 days, and the try still counts.
- **Pass `ctx.signal` to every outside call.** It is aborted when the kind's limit
  passes. On a stop it is aborted only if the handler is still running when the stop's
  allowance (18 seconds) runs out, and no limit is over 15 seconds, so a handler cannot
  rely on the signal to learn that the server is stopping. A statement already sent to
  the database is not cancelled by the signal. A listener on the signal must not throw:
  the worker aborts the signal from its own timer, where nothing catches what the
  listener throws.

## The seven rules

Each rule is for the author of a kind. The reason follows it.

1. **A payload holds ids only, is checked by Zod when written and when run, and is at
   most 2,048 bytes.** The handler reads the record again and does what is true then,
   so nobody cancels a job when plans change, and no personal data sits in the list.
   The table refuses a larger payload (`jobs_payload_small`).
2. **Every handler is safe to repeat.** The list promises at least once (above). A
   promise a handler starts and does not await needs its own catch: the API has no
   handler for a stray rejection, so one ends the server, the job comes back as a lost
   claim, and after two lost claims it is `dead`.
3. **A handler talks to the database and to a provider, nothing heavier, and its limit
   is 15 seconds or less.** A server works one job at a time, so a slow kind would
   crowd the API; `timeoutMs` above 15,000 throws at definition.
4. **A handler runs outside any transaction.** It opens its own short ones. The worker
   races a handler against its limit and cannot stop it, so a transaction around the
   whole handler would hold its row locks through every outside call, and past the
   limit if the handler hangs.
5. **Take locks in this order: bookings, then the proposal, then the enquiry, then the
   deal, then the event.** The code already keeps it, and the spine's design sets it
   out in [section 5.4](../superpowers/specs/2026-11-13-the-spine-design.md). Two
   writers that take the same rows in different orders can deadlock, and PostgreSQL
   then aborts one of them.
6. **Never hold a row lock on an event or a booking while calling an outside service.**
   A slow provider would hold up every other write to that row.
7. **No personal data in a log or an alert, and every error's text passes through
   `jobErrorText`.** Log the kind, the job's id and the venue's id. `jobErrorText`
   (`services/jobs/kinds.ts`) removes query parameters, replaces any email address with
   `[email address]`, cuts the text to 500 characters and never throws. It does not
   remove a name, so do not write one into an error's message. The worker passes every
   error it stores, logs or alerts through it, and the alert reporters do so once more.

## Retries, lost claims and stopping

- **Retries.** A failed try waits 1 minute, 5 minutes, 30 minutes, 2 hours, then 6
  hours before the next (`RETRY_SECONDS` in `store.ts`); a kind with more than six
  tries waits 6 hours each time after that. The failed try that is the last allowed
  makes the job `dead`. A handler's own `RetryJobIn` wait replaces the usual one.
- **Lost claims.** A claim lasts the kind's limit, in whole seconds rounded up, plus 15
  seconds. At the start of every pass, each claim that has run out is put back. The
  first time, the job is due again after 5 minutes; the second time, or when it has no
  tries left, it is `dead`. A claim counts as a try. On a slow database a lost claim can
  be counted although its server lived: the result could not be recorded before the
  claim ran out, and the pass that puts claims back reached the row first.
- **A handler that does not answer** is ended by its own limit and recorded as a failed
  try: "The handler passed its time limit of N ms." Its signal is aborted and the worker
  goes on; anything the handler does later is caught and logged.
- **A server that is stopping** takes nothing new and waits up to 18 seconds
  (`JOB_WORKER_STOP_GRACE_MS` in `index.ts`) for the job it is running. No limit is
  over 15 seconds, so a handler that never answers is ended by its limit inside that
  wait and recorded as a failed try, not put back untouched. The worker hands a job
  back without counting the try only for a job it claimed just as the stop began, or
  when the grace is shorter than the handler's limit (the server's 18 seconds is not).
  On a database slower than the worker's own call limit (10 seconds), the shutdown's
  hard stop (25 seconds, `SHUTDOWN_GRACE_MS`) can come first; the job then comes back
  as a lost claim.

## Change a kind's data in two deploys

A deploy runs the old and the new server side by side for a while. A server takes only
the (kind, version) pairs its code lists in `reads`, so a job of a version no running
server reads waits, and a dead one cannot be tried again. So the code that reads a new
shape goes out before the code that writes it:

1. **Deploy 1 reads both.** Set `reads: [N, N+1]` and make the one payload schema
   accept both shapes (a new optional field, or a union): the handler is not told which
   version it holds. Leave `version` at N, so the code still writes N.
2. **Deploy 2 writes the new shape.** Raise `version` to N+1. Deploy 1's code reads
   both shapes, so a server still running it takes the new jobs, and rolling deploy 2
   back is safe.
3. **Later, a clean-up removes N from `reads`**, and tightens the schema, once no job
   of version N is left in `queued`, `running` or `dead`:

   ```sql
   SELECT state, count(*) FROM jobs
   WHERE kind = 'holds.reminder' AND version = 1 AND state IN ('queued', 'running', 'dead')
   GROUP BY state;
   ```

   Try again or close each dead one first. Once no server reads its version, Try again
   answers 409 `JOB_KIND_UNREADABLE` and the job can only be closed with a note.

Raising `version` in the deploy that first reads N+1 leaves the old servers, during the
deploy or after a roll-back, with jobs they cannot take; removing N while jobs of N are
left does the same to those. The daily check counts such queued jobs as
`unreadableJobs` and raises `job.list-stuck` (see The invariant).

## Work that repeats

A repeating kind is a `RepeatingJob` (`services/jobs/repeating.ts`): its kind and a
`next(after)` function. Its next run is itself a job, keyed by the ISO instant of that
run. At the end of every pass the worker calls `ensureNextRuns` (through
`nextRunsKeeper`) with the database's now, so the next run is written as soon as the
current one is taken, and a run that ends `dead` does not end the series. Every server
asks for the same run; the (kind, key) rule lets one write succeed. To add one, build it
as `jobs.daily` is built (`dailyJob` returns a `RepeatingJob`) and add it to the
`repeating` list in `buildJobKinds`.

`next` must return an instant after the one it is given. A kind whose `next` throws, or
returns an instant that is not after it (an invalid date included), is skipped: it gets
no run, it is logged at error level on every pass, and it raises `job.list-stuck` once
for each kind in a server's life. The other kinds still get their runs, and the pass
completes. A failure to write a run is still a database fault.

Repeating kinds belong to the platform, not to a venue, in this stage: a run carries no
venue id, so `enqueueJob` refuses a venue kind. `jobs.daily` runs at 03:00 UTC
(`kinds/daily.ts`). It deletes up to 1,000 `done` or `abandoned` jobs whose age, from
the later of finishing and closing, is over 90 days (`dead` jobs stay). A run that
deleted a full 1,000 asks for one more run at once. It then reads the invariant below,
and checks in to the Sentry monitor `job-list-daily`.

## The invariant

`services/jobs/invariant.ts` counts four things; each must be 0. The daily job reads
them and, when one is not, logs the four counts and raises `job.list-stuck` with them
(an alert of its own, not a fault of the worker's: the worker's status stays as it is).
Run the same read by hand against a database after a release that changes a kind:

```
pnpm --filter @omnitwin/api exec tsx src/scripts/check-job-list-invariant.ts
```

It reads `DATABASE_URL`, opens one read-only transaction and writes nothing. It runs
from the checkout you are in, so run it from the commit that is deployed. It prints one
line of JSON and exits 0 (healthy), 1 (not healthy) or 2 (could not run).

| Count | Meaning |
| --- | --- |
| `overdueJobs` | queued, due more than 2 hours ago, of a kind and version this code reads |
| `expiredClaims` | running, whose claim ran out more than 1 hour ago |
| `staleQueuedSends` | `email_sends` with status `queued` written more than a day ago |
| `unreadableJobs` | queued, of a kind or version this code does not read |

## How the worker runs

A worker starts only when `JOBS_WORKER=on`. Each API process then starts one, after its
database client is built (it connects on first use; `startJobs` in `runtime.ts`). A pass
puts back expired claims, takes and runs one due job at a time until none is due, writes
the next run of each repeating kind, and sets one timer for the earlier of the next due
job (or claim about to run out) and the next boundary. The boundary is the next whole
multiple of `JOBS_MAX_SLEEP_MINUTES` since the epoch: with 60, the top of the hour. The
worker does not poll. It asks the database when its timer fires, when it starts, and
when this process pokes it; pokes that arrive during a pass fold into one more pass.
Every pass begins in the async context the worker was built in, so a poke made inside a
request lends that request's context to nothing the pass does: not its handlers, its
alerts or its next timer.

Every wait on the database is bounded (10 seconds by default; the worker refuses a limit
that is not under the claim's 15-second margin). A pass that fails sets a fault
(`database` or `loop`), raises one alert for the outage, and tries again after 60
seconds; the first pass that completes clears the fault and raises the recovery alert.
A pass whose own handling of a failure throws (a logger that throws, say) is a `loop`
fault, with its alert.

## Read Stuck work

Stuck work is for platform administrators: Dashboard, "Stuck work"
(`packages/web/src/components/dashboard/StuckWork.tsx`, view `stuckWork`). It reads the
list when it opens and after each action, never on a timer. It shows one summary line,
for example "2 jobs gave up. 1 is waiting. The worker last ran 3 minutes ago.", and a
table of the newest 200 dead jobs (`STUCK_JOBS_LIMIT` in `@omnitwin/types`): What
kind, Venue ("The platform" for a platform job), Gave up, Tries and Reason, which is
the error text the server stored. The count of jobs that gave up covers the whole
table, not the 200. "N are waiting" (left out when N is 0) counts the queued jobs that
are due now, of any kind; a job waiting for a later time, such as the daily job's next
run or a try waiting out its retry, is not counted.

A queued job of a kind or version no server reads is not on the page, which lists dead
jobs only, and cannot be closed from it (Close answers 409 `JOB_NOT_STUCK`). Restore a
reader for it: a release whose kind lists that version in `reads`. The daily check
counts it as `unreadableJobs`.

The worker sentence is one of "The worker is switched off.", "The worker cannot reach
the database.", "The worker has stopped after an error.", "The worker has not run yet."
or "The worker last ran … ago.". A line "N old sends were never recorded as sent or
failed." counts `email_sends` still `pending` after a day.

- **Try again** puts a dead job back on the list, due now, with its tries and lost
  claims reset, and records who did it. It runs the kind's `onManualRetry` in the same
  transaction; if that throws, the job stays dead. Use it once the cause is fixed: a job
  that fails again walks the whole retry ladder again.
- **Close with a note** puts the job down as `abandoned` with a note of 1 to 500
  characters. It works for any kind. Use it when the work is no longer wanted, or when
  the kind cannot be read. Abandoned jobs are deleted by the daily job 90 days after
  they were closed.
- **Run the self-test** writes one `jobs.selftest` job and says what became of it.
  When a worker runs in the server that took the request, the route waits for the job,
  at most 5 seconds of waiting: it reads the job's state after each of six gaps (100,
  200, 400, 800, 1,500 and 2,000 ms) and stops at the first `done`, `dead` or
  `abandoned`, or when the caller has gone. With no worker in that server it does not
  wait: it reads the state once (another server's worker may already have taken the
  job). The answer is `{ data: { id, state } }`, the job's state when the server
  stopped waiting. Pressed while every worker is off, the job stays `queued` until a
  worker runs, and after two hours the hand-run check counts it in `overdueJobs`.
  The page reads the list again, then says one of:
  - `done`: "The self-test ran."
  - `dead` or `abandoned`: "The self-test did not finish. It is on the list above."
  - `queued` or `running`, when the newest reading says the worker is off: "The
    self-test is waiting. The worker is switched off."
  - `queued` or `running` otherwise: "The self-test has not run yet. It is still
    waiting."

  If the request fails, the page shows the server's words, or "The self-test could not
  be started."

The routes behind it are in `routes/admin-jobs.ts`, mounted at `/admin/jobs`. All four
are for platform administrators only, and none returns a job's payload.

| Route | Does |
| --- | --- |
| `GET /admin/jobs/stuck` | the dead jobs, the counts and the worker's status |
| `POST /admin/jobs/:id/retry` | Try again |
| `POST /admin/jobs/:id/close` | Close; body `{ "note": "…" }` |
| `POST /admin/jobs/selftest` | one `jobs.selftest` job; answers `{ data: { id, state } }` |

| Refusal | When | Words |
| --- | --- | --- |
| 400 `VALIDATION_ERROR` | a malformed id or note | "Invalid job id" or "Invalid body" |
| 404 `JOB_NOT_FOUND` | no such job | "There is no such job." |
| 409 `JOB_NOT_STUCK` | the job is not dead, so someone got there first | "This job is already back on the list." |
| 409 `JOB_KIND_UNREADABLE` | Try again, and no server of this release reads the job's kind and version | "This server can no longer run this kind of job. Close it with a note." |
| 500 `JOB_RETRY_PREPARATION_FAILED` | the kind's `onManualRetry` threw | "This job could not be made ready for another try. It is still stuck." |

## Read `/health/worker`

`GET /health/worker` answers from the worker's memory and never touches the database,
so a probe does not wake a scale-to-zero database. With no worker installed it answers
200 `{ "worker": "off" }`. Otherwise the body is the worker's status: `started`,
`lastPassAt`, `nextWakeAt` (epoch ms), `currentJob` (`id`, `kind`, `since`),
`abandonedHandlers` (handlers the worker has stopped waiting for since this server
started), `fault` and `passRunning`. The status is 503 when:

- `fault` is `database` or `loop`;
- the next wake passed more than 2 minutes ago and no pass is running, which means the
  timer never fired; or
- the current job began more than 60 seconds ago, which no handler may do.

## Alerts

The worker raises an alert when a job goes `dead` (`job.dead`), when a claim runs out
(`job.claim-lost`; a second lost claim is `job.dead`), and when it faults or recovers
(`job.worker-fault`, `job.worker-recovered`). A job that goes dead raises `job.dead`
once, even when the answer that recorded it came after the worker had stopped waiting
for it. Work stuck unseen raises `job.list-stuck`, an error in a Sentry group of its own,
apart from the worker's faults: the daily check raises it each day it finds some, and a
repeating kind with no next run raises it once for each kind in a server's life.

A job's alert carries the kind, the job's id and, for a venue's job, the venue's id; a
fault or recovery alert names which part failed (`database` or `loop`); `job.list-stuck`
carries no tags, and its text says what is stuck. Any text passes through `jobErrorText`.
With `SENTRY_DSN` set they go to Sentry; without it they go to the log. The daily job
checks in each day, and Sentry alerts if a day passes without one.

With `SENTRY_DSN` set, each job's run, and each pass's own work (putting claims back,
the claims, `afterPass`, the plan, a fault), runs in a Sentry isolation scope of its own
on a new trace: `buildOwnScope` in `alerts.ts` builds it, and `startJobs` passes it to
the worker as `withOwnScope`. The scope is forked and then cleared, so a job's alert
carries the breadcrumbs its own run left and none from another job, another pass or
start-up, and each job's alert is on a trace of its own. Without the DSN nothing is
built and the worker calls each run as it is. Running every pass in the worker's own
async context keeps a request's scope out; alone, it would leave every pass and job on
start-up's one scope and trace, as `jobs-sentry-scope-postgres.test.ts` measured with
the real SDK (the same fault was measured on the escalation scheduler's change, T-764).

## The two switches

| Variable | Values | Effect |
| --- | --- | --- |
| `JOBS_WORKER` | `on`, `off`, or unset | Only `on` starts a worker. Unset means off: the registry is still built (the admin routes read it), but no statement is sent, no timer is set and nothing is installed. |
| `JOBS_MAX_SLEEP_MINUTES` | a whole number, 1 to 360, or unset | The longest the worker sleeps, on whole multiples since the epoch. Unset means 60. |

Both are read when the server starts (`env.ts`).

## Tests

A kind's tests run on real PostgreSQL, in `packages/api/src/__tests__/`, in a file
named `<name>-postgres.test.ts`. Use `helpers/jobs-db.ts`: it opens the throwaway
database named by `VENVIEWER_JOBS_TEST_DATABASE_URL` (database `venviewer_jobs_test` on
`127.0.0.1`, never `DATABASE_URL`) and migrates it. Guard the suite with
`describe.skipIf(jobsTestUrl === undefined)`, and give the `beforeAll` that migrates a
180,000 ms timeout. Add each new database suite to `REQUIRED_POSTGRES_TEST_FILES`
(`packages/api/src/scripts/check-required-postgres-suites.ts`), in the
`VENVIEWER_JOBS_TEST_DATABASE_URL` group, so CI fails if it is skipped. A table that
only a test needs is created by the test (`CREATE TABLE IF NOT EXISTS`), never by a
migration.

`routes-inventory.test.ts` pins no `/admin` route. What proves the admin routes are
registered is the whole-server test in `admin-jobs-postgres.test.ts`.

## The migration

The table is `jobs`, in `packages/api/drizzle/0110_job_list.sql` (journal idx 107). Its
number is fixed when it merges, and renumbering it needs a journal `when` later than the
newest entry on master: drizzle's migrator applies a migration only when its `when` is
later than the newest one recorded as applied, and would skip an older one. See
[deploy ordering](deploy-ordering.md).

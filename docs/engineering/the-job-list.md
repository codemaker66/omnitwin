# The job list: work that runs later, at least once

**Read this when:** adding a kind of work that runs later, changing a kind's data,
switching the worker on or back off, or reading Stuck work or `/health/worker`.

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
  returns leaves the job `running` until its claim runs out. From `completeIn` until
  that transaction ends, the job's row is held: a pass that puts claims back passes
  over it, and a later pass puts the job back only if the transaction rolled back and
  the claim has run out.
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
- **Where an abort listener runs.** When the limit passes, the signal is aborted from a
  timer made inside the job's own run, so the listener runs in the job's own Sentry
  scope and trace. On a stop it is aborted by the code that stops the server (its
  `preClose` hook, outside any request), so the listener runs in that caller's scope and
  trace, start-up's: never a request's or another job's, but not the job's own either.
  A breadcrumb or error the listener reports then is filed with start-up, not with the
  job's run.

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
  seconds. At the start of every pass, each claim that has run out is put back, except
  one whose row another transaction holds (a handler's `completeIn` transaction left
  open past its claim, say): that one is passed over without waiting
  (`FOR UPDATE SKIP LOCKED`), and a later pass puts it back if its claim is still out
  then. The first time, the job is due again after 5 minutes; the second time, or when
  it has no tries left, it is `dead`. A claim counts as a try. On a slow database a
  lost claim can be counted although its server lived: the result could not be
  recorded before the claim ran out, and the pass that puts claims back reached the
  row first.
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
puts back expired claims (passing over any whose row another transaction holds), takes
and runs one due job at a time until none is due, writes the next run of each repeating
kind, and sets one timer for the earlier of the next due job (or claim about to run out)
and the next boundary. A claim that has already run out and still stands when the pass
plans is planned 60 seconds ahead (`STANDING_CLAIM_RECHECK_SECONDS` in `store.ts`), not
at once: one the pass's recovery passed over because another transaction held its row,
or one that ran out after that recovery ran. So a held row does not wake every server
four times a second. The boundary is the next whole multiple of
`JOBS_MAX_SLEEP_MINUTES` since the epoch: with 60, the top of the hour. The worker does
not poll. It asks the database when its timer fires, when it starts, and when this
process pokes it; pokes that arrive during a pass fold into one more pass. Every pass
begins in the async context the worker was built in, so a poke made inside a request
lends that request's context to nothing the pass does: not its handlers, its alerts or
its next timer.

Every call the worker makes on the database (putting claims back, a claim, recording a
result or a hand-back, `afterPass`, the plan) runs in a transaction of its own
(`inBoundedTransaction` in `store.ts`). Its `SET LOCAL statement_timeout` lets the server
end a statement at the worker's call limit, 10 seconds by default, and its
`SET LOCAL lock_timeout` ends a wait for a lock at half of that. The worker also stops
waiting at the limit, and refuses a limit that is not under the claim's 15-second margin.
So a call the worker has given up on does not go on waiting on the server, holding a
connection of the pool the API's requests share. `SET LOCAL` lasts only until its
transaction ends, which is what a transaction-mode pooler allows; the worker sets
nothing for a whole session. A handler's own transaction is not bounded this way.

A pass that fails sets a fault (`database` or `loop`), raises one alert for the outage,
and tries again after 60 seconds; the first pass that completes clears the fault and
raises the recovery alert. A pass that fails to put claims back has that fault too, but
still takes due jobs; it is not counted as completed, and the next pass comes within 60
seconds. A pass whose own handling of a failure throws (a logger that throws, say) is a
`loop` fault, with its alert.

## Read Stuck work

Stuck work is for platform administrators: Dashboard, "Stuck work"
(`packages/web/src/components/dashboard/StuckWork.tsx`, view `stuckWork`). It reads the
list when it opens and after each action, never on a timer. It shows one summary line,
for example "2 jobs gave up. 1 is waiting. The worker last ran 3 minutes ago. The list
was read at 14:05.", and a table of the newest 200 dead jobs (`STUCK_JOBS_LIMIT` in
`@omnitwin/types`): What kind (each row's header cell), Venue ("The platform" for a
platform job), Gave up, Tries and Reason, which is the error text the server stored.
The count of jobs that gave up covers the whole table, not the 200. "N are waiting"
(left out when N is 0) counts the queued jobs that are due now, of any kind; a job
waiting for a later time, such as the daily job's next run or a try waiting out its
retry, is not counted. "Last ran … ago" is counted on the answering server's own clock
(`serverNowMs` in the reading, the clock the worker's `lastPassAt` is on), never the
browser's; the time the list was read is the browser's.

While the list is read again after an error, the page says "Reading the list again…".
Focus moves only when it was lost (with a row that went away, or with a button disabled
while it worked: Chromium then moves focus to the page's body) or is still in the row
that acted. After an action it goes back to that row's own control if the job is still
listed, and otherwise to the heading; after a read a person asked for, to the heading.
The self-test's verdict and each action that went through ("Put back on the list:
email.send, Test Hall." or "Closed: email.send, Test Hall.") are said in one polite live
region in the header, there from the first render. A refusal is shown in the server's
own words.

A queued job of a kind or version no server reads is not on the page, which lists dead
jobs only, and cannot be closed from it (Close answers 409 `JOB_NOT_STUCK`). Restore a
reader for it: a release whose kind lists that version in `reads`. The daily check
counts it as `unreadableJobs`.

The worker sentence is one of "The worker is switched off.", "The worker cannot reach
the database.", "The worker has stopped after an error.", "The worker has not run yet."
or "The worker last ran … ago.". A line "N old sends were never recorded as sent or
failed." counts `email_sends` still `pending` after a day.

A line above the table says what each row's two actions do: "Try again runs a job again
now, from its first try." and "Close with a note stops a job for good and keeps your
note." Each row's buttons are described by that line and by the row's kind and venue,
and the note box is named for its job ("Note for email.send, Test Hall").

- **Try again** puts a dead job back on the list, due now, with its tries and lost
  claims reset, and records who did it. It runs the kind's `onManualRetry` in the same
  transaction; if that throws, the job stays dead. Use it once the cause is fixed: a job
  that fails again walks the whole retry ladder again.
- **Close with a note** puts the job down as `abandoned` with a note of 1 to 500
  characters. The form says "Closing stops this job for good. It will not run again.
  Your note is kept with it.", and its button is "Close the job". It works for any
  kind. Use it when the work is no longer wanted, or when the kind cannot be read.
  Abandoned jobs are deleted by the daily job 90 days after they were closed.
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
  - `dead`: "The self-test did not finish. It is in the list below."
  - `abandoned`: "The self-test was closed by hand."
  - `running`: "The self-test is running. It had not finished when the server stopped
    waiting.", or, when the newest reading says this server's worker is off (so another
    server's has it), "The self-test is running on another server."
  - `queued`: "The self-test has not run yet. It is still waiting.", or, when the
    newest reading says the worker is off, "The self-test is waiting. The worker is
    switched off."

  If the request fails, the page shows the server's words, or "The self-test could not
  be started."

The routes behind it are in `routes/admin-jobs.ts`, mounted at `/admin/jobs`. All four
are for platform administrators only, and none returns a job's payload.

| Route | Does |
| --- | --- |
| `GET /admin/jobs/stuck` | the dead jobs, the counts, the worker's status and the server's clock (`serverNowMs`) |
| `POST /admin/jobs/:id/retry` | Try again |
| `POST /admin/jobs/:id/close` | Close; body `{ "note": "…" }` |
| `POST /admin/jobs/selftest` | one `jobs.selftest` job; answers `{ data: { id, state } }` |

| Refusal | When | Words |
| --- | --- | --- |
| 400 `VALIDATION_ERROR` | a malformed id or note | "Invalid job id" or "Invalid body" |
| 404 `JOB_NOT_FOUND` | no such job | "There is no such job." |
| 409 `JOB_NOT_STUCK` | the job is queued or running: someone put it back first | "This job is already back on the list." |
| 409 `JOB_NOT_STUCK` | the job is done: it was put back and has run | "This job has already run." |
| 409 `JOB_NOT_STUCK` | the job is abandoned: someone closed it | "Someone has already closed this job." |
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
the worker as `withOwnScope`. The isolation scope is forked and cleared (`clear()`), so
a job's alert carries the breadcrumbs its own run left and none from another job,
another pass or start-up, and each job's alert is on a trace of its own. Only the
isolation scope is cleared: a tag or context set on the current or the global scope
would reach every alert (nothing in the API sets one today), and so would a request's
data if the helper were entered inside a request. What keeps a request out is the
worker's own start-up context: every pass begins in it. Without the DSN nothing is built
and the worker calls each run as it is. Running every pass in that context alone would
leave every pass and job on start-up's one scope and trace, as
`jobs-sentry-scope-postgres.test.ts` measured with the real SDK (the same fault was
measured on the escalation scheduler's change, T-764). Its last case starts the
server's own worker through `startJobs`, with the worker on and a DSN set, so the
wiring is under test too.

The escalation scheduler's helper (`inOwnScope` in `observability/sentry.ts`) is not
the same: it keeps the fork's tags, user and context and clears only its breadcrumbs.
Folding the two into one is T-765, which has to choose between them.

## The two switches

| Variable | Values | Effect |
| --- | --- | --- |
| `JOBS_WORKER` | `on`, `off`, or unset | Only `on` starts a worker. Unset means off: the registry is still built (the admin routes read it), but no statement is sent, no timer is set and nothing is installed. |
| `JOBS_MAX_SLEEP_MINUTES` | a whole number, 1 to 360, or unset | The longest the worker sleeps, on whole multiples since the epoch. Unset means 60. |

Both are read when the server starts (`env.ts`).

## Switch the worker on

Each step that reads or changes production needs the owner's approval. In this order:

1. With the switch still off, on the deployment that applied the migration:
   `/health/ready` answers, `/health/worker` answers 200 `{ "worker": "off" }`, and one
   read-only run of the invariant check (see The invariant) prints all four counts as 0.
2. Set `JOBS_WORKER=on`. `/health/worker` then shows `started: true` and no `fault`; Run
   the self-test on Stuck work says "The self-test ran."; after the next 03:00 UTC the
   daily job has run once and checked in to the Sentry monitor `job-list-daily`.
3. Rehearse the list behind a transaction-mode pooler, on a throwaway pooled database
   (see Not yet proved).
4. Point one outside uptime check at `/health/worker`, which answers 503 when the worker
   is unwell.

## The way back

The switch is the way back: unset `JOBS_WORKER` (or set it to `off`) and restart, and
no job is taken. Code goes back only by a forward revert that keeps the migration's
journal entry: once 0110 is applied, an image from before it has fewer journal entries
than the database has applied, and the pre-deploy tail gate refuses it
(`verify-migration-tail-readiness.ts` requires the applied count not to exceed the
image's; see [deploy ordering](deploy-ordering.md)). Nothing needs to be dropped: the
table and the new columns can stay. The status rule on `email_sends` stays live (see The
migration).

## Not yet proved

- Nothing here has run in production.
- The list behind a transaction-mode pooler: CI's database has none in front of it. The
  worker's settings are `SET LOCAL` inside its own transactions, which such a pooler
  allows, but that is read from the code, not rehearsed.
- What an alert carries in Sentry: seen only against a stand-in ingest in the tests,
  not in a Sentry project.
- Two servers on one list: `jobs-two-process-postgres.test.ts` runs two processes in CI;
  no two servers have shared the list in production.

## Before the next stage

The next stage moves email onto the list. These hold for this stage, and are to be
settled before email relies on them:

- **A burst of dead jobs.** Each dead job is its own Sentry issue (`job.dead` is grouped
  by the job's id), with no cap, so one cause that kills many jobs raises as many
  issues. Cap them or group them.
- **A handler's own error text** reaches the alert, the log and `last_error`.
  `jobErrorText` removes query parameters and email addresses, not a name or an amount,
  so a handler must not put one in an error's message.
- **Who pressed Try again or Close.** The only record is the job's own `resolved_by`,
  `resolved_at` and `resolution`: the next action overwrites it, and the daily tidy
  deletes it with the row after 90 days. It needs an audit record of its own. The Close
  note is stored as typed: it needs scrubbing, and a place in erasure.
- **`/health/worker` is public**, and its body is the worker's status, the running job's
  id and kind included. Reduce what it shows the public.
- **A repeating kind with no next run** raises its alert once in a server's life, and
  the daily check cannot see a run that was never written. Before a second repeating
  kind lands: clear that once-only mark when the kind gets a run again, or count the
  repeating kinds with no queued run in the future, or both.
- **Suites that build their own tables** (`__tests__/fixtures/public-enquiry-postgres.sql`
  and `onboarding-postgres.sql`) have no `jobs` table. Once a route they cover writes a
  job, they fail, and only in CI.
- **The sends** (see The migration). Erasure removes a person's sends by their
  idempotency key, and the new keys to events and enquiries are `ON DELETE RESTRICT`: a
  send linked by `enquiry_id` or `event_id` must be removed before erasure deletes that
  row, whatever its key, or the erasure fails. `html` holds a message's body, so it
  comes under erasure and retention. A venue with sends cannot be deleted
  (`email_sends.venue_id` has no `ON DELETE`).

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

The pool `openJobsDatabase` opens sets a statement and a lock timeout, so a test that
would hang fails instead; production's pool sets neither. A test of what bounds the
worker's own statements uses `openUnboundedDatabase`, a second pool that sets no
timeout at all.

`routes-inventory.test.ts` pins no `/admin` route. What proves the admin routes are
registered is the whole-server test in `admin-jobs-postgres.test.ts`.

## The migration

The table is `jobs`, in `packages/api/drizzle/0110_job_list.sql` (journal idx 107). Its
number is fixed when it merges, and renumbering it needs a journal `when` later than the
newest entry on master: drizzle's migrator applies a migration only when its `when` is
later than the newest one recorded as applied, and would skip an older one. See
[deploy ordering](deploy-ordering.md).

The same migration changes `email_sends`, for the next stage; nothing writes the new
columns yet. It adds nine nullable columns (`venue_id`, `event_id`, `enquiry_id`,
`from_header`, `reply_to`, `html`, `first_tried_at`, `delivered_at`, `expires_at`) and
`attempt_epoch` (`NOT NULL DEFAULT 0`); a key from `venue_id` to `venues`, and two
composite keys, `(event_id, venue_id)` to `events` and `(enquiry_id, venue_id)` to
`enquiries` (`ON DELETE RESTRICT`), so a send's event or enquiry is its own venue's; one
check that a link needs a venue; the status rule; and three partial indexes, on
`(venue_id, created_at)`, on `event_id` and on `enquiry_id`, each only where it is set,
so removing an event or an enquiry checks its sends by index.

The status rule (`email_sends_status`) is live as soon as the migration applies. It
allows the five statuses today's code writes (`pending`, `sent`, `failed`, `suppressed`,
`dev_mode`) and the four the list adds (`queued`, `not_sent`, `bounced`, `complained`),
so a send written with any other status fails: a new status needs a migration that
changes the rule first. The rule is checked against every existing row in the same
step, so a stray old status fails the migration and the deploy; read production's
distinct statuses before it lands.

It runs in one transaction, and each wait for a lock gives up after 10 seconds and fails
the deploy. It takes the locks its keys need on `venues`, `events` and `enquiries` first,
then `users`' for the new table, and only then touches `email_sends`, which it holds
against reads and writes until the commit while it reads the rows to check the keys and
the rule and builds the indexes. So no wait for another table's lock happens while
email traffic is held. A wait still queues behind it the later statements that need a
conflicting lock on that table (writes to `venues`, `events`, `enquiries` and `users`;
anything on `email_sends`), and nothing bounds a statement once its locks are held: the
time `email_sends` is held grows with its rows.

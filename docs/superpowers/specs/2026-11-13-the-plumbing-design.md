# The plumbing: work that happens later, and once

Design, 13 November 2026. Status: **draft for Blake's approval. No product code is written until he approves.**
Piece 0 of the platform plan (`docs/superpowers/specs/2026-11-13-platform-plan-design.md`, pull request #421;
ledger row T-702). Branch `claude/platform-plumbing-design`. Every code fact below was read on master `85a17749`.
Prices were read on the providers' own pricing pages on 13 November 2026. Section 13 says how the design itself
was tested.

**Blake: section 1 is everything you need to decide. Sections 2 to 13 are for whoever builds and reviews it.**

## 1. On one screen

**What it adds.** Five later pieces need work that runs later, reliably and once: reminders, sends, payments,
deletions, pushes to an accounting system. Nothing of the kind exists, so each piece would invent its own. This
piece builds it once:

1. **A list in the database of work still to do.** A reminder, a send or a deletion is written on the list in the
   same step as the thing that causes it, and is carried out afterwards, even if a server restarts in between.
2. **Each venue sends in its own name**, from an address on its own email domain.
3. **Replies come back onto their event**, with their attachments.
4. **Each venue's keys are kept encrypted** (the key to its accounting system, for example).
5. **When something fails, a person sees it.** A send that could not go says "Not sent". Nothing is ticked that
   nobody checked.

**What you will see.** Venue staff see no new screen from this piece, and nothing about their mail changes yet;
pieces A, E, F and I put it to use. You will see three things: a plain page for us called Stuck work; a one-page
note for the Hall's email administrator saying exactly what to add; and a rehearsal you can watch, in which two
servers run side by side, one reminder arrives once, and a reply sent from your own phone lands on its test event.

**What it costs.**

| Thing | Cost | When |
|---|---|---|
| Email out and in (Resend, which we already use) | $20 a month for the Pro plan: 50,000 emails a month, ten domains, no daily cap. The free plan (3,000 a month, 100 a day, three domains) is enough while we build | From the first real booking's sends |
| The list of work | Nothing new. It asks the database only when something is due, and once an hour, so it adds at most about $2 to $3 a month of database time | From its first merge |
| A second server | About $3 a month at today's use (Railway charges $10 a month for each gigabyte of memory; ours uses about a quarter of one) | Your decision; see below |
| Watching that the list is alive | Nothing, or under $1 a month: Sentry includes one such check on every plan, and a further one is $0.78 a month | From its first merge |
| Storing mail and attachments | Nothing at this size: R2's first 10 GB a month are free, then $0.015 a gigabyte | When mail comes in |
| Encrypted keys | Nothing as recommended. A cloud key service would be about $1 a month and a new supplier | When piece E or the accounting push needs a key |

**What only you decide** (section 10): this design; staying with Resend at $20 a month; when a second server is
added; and what we ask the Hall's email administrator for.

**The honest limit.** "Exactly once" cannot be promised by any system that talks to another one. What can be built
is: every piece of work is tried until it succeeds or a person is told, and doing it twice changes nothing.
Section 5.2 names, for each kind of work, the key that makes a repeat harmless.

**Two things you should know before choosing.**

- *The second server.* The live plan editing and the Diary's live updates keep their rooms in one server's
  memory. A second server would split a room in half without saying so. That is written in the code today and is
  not part of this piece. So this piece is built and proved with two servers in rehearsal, and production stays on
  one until that is dealt with.
- *Replies.* Today a reply to our mail goes to the inbox the Hall already watches. This piece builds and proves
  replies landing on their event, but it does not move production's replies there. That switch belongs to piece F,
  which has the screen staff would read them on. Moving them sooner would take replies out of an inbox people
  read and put them where nobody looks.

## 2. Why

The plan's pieces lean on this: A (reminders and holds that lapse), E (payments), F (sends and replies), I (the
deletion job) and wave 1b (the push to an accounting system). An engineer's reading of the code found that each
would otherwise build its own, or lean on GitHub's scheduler (the plan, section 5.2; the engineer's finding F3).

**Goals.** One list of work in PostgreSQL, safe with two servers. Work written in the same transaction as its
cause. A sender for each venue. Mail in, onto its event. Encrypted keys for each venue. Failures a person sees.

**Not in this piece.** Any screen for venue staff (pieces C and F). The words of any email. Moving production's
replies (piece F). The money ledger and the payment account (piece B, the spine). The hold-reminder dry run and
switching reminders on (piece A). Reading mail with a model (wave 1b). A shared channel for the live rooms, which
a second server needs (piece J).

**It would be a failure, even if it works, if:** a send is marked sent that the provider never took; a failure is
only in a log; one venue's mail or keys can reach another venue; a bad job can keep bringing the server down; or
the list keeps the database awake all night, which is what caused the outage of 18 October.

## 3. What exists today

Paths are under `packages/api/src/` unless they start elsewhere.

**Sending.**
- Every email goes through `services/email.ts`. It writes a row to `email_sends` under a unique key before it
  calls the provider, so a repeat is refused by the database (`services/email.ts:256-299`; the table is
  `db/schema.ts:1300-1315`).
- It retries four times at once, within about four seconds, and then gives up (`services/email.ts:108`). It does
  not give the provider a key of its own, so a retry after a lost answer can send the same email twice.
- Its own notes name the gap this piece closes: if the server stops between writing the row and the provider's
  answer, the row stays "pending" and "No future attempt will retry it; a human has to inspect and requeue"
  (`services/email.ts:44-51`).
- Nine places send: five after the reply has gone to the browser, with nothing to pick them up if the server
  stops (`sendEmailAsync`, `services/email.ts:516-523`); one inside a request; and three inside the reminder and
  escalation passes. None is part of the transaction that caused it.
- There is one sender for the whole deployment, set as a server setting, and one reply address, a watched inbox
  (`services/email.ts:110-142`; `env.ts:52`). What production has them set to cannot be read from the code.
- `email_sends` has no venue, no event and no thread. It keeps the subject but not the body that was sent, and
  nothing in the database limits what its status may say (`db/schema.ts:1300-1315`).
- One screen shows whether a send went: the team invitation
  (`packages/web/src/components/dashboard/TeamView.tsx:323-326`). Nothing else reads `email_sends`.
- There is no code that receives mail, and none that hears from the provider that a message bounced.

**Running things later.**
- Production runs one server (`railway.json:26`), with 30 seconds to finish on each deploy (`railway.json:32`,
  added by #420); the server itself allows 25 (`index.ts:672`). It restarts after a crash up to ten times
  (`railway.json:28-29`). Railway's documentation says this file's format stops being read after 1 December 2026;
  moving it is a separate job, reported to the programme lead.
- The daily clean-up runs from GitHub's scheduler, with the production database's address held as a secret of a
  public repository (`.github/workflows/cleanup.yml:24` and `:52-53`). It is five passes run one after another
  (`scripts/run-cleanup.ts:53-83`); a signed-in platform admin can run four of them from a route
  (`routes/admin.ts:87-96`).
- Two more schedules are written and commented out, each waiting for Blake: hold reminders, until he has checked
  a dry run (`.github/workflows/diary-hold-reminders.yml:14-17` and `:54-55`), and the weekly competitor page
  check (`.github/workflows/competitor-page-check.yml:46-47`). Both stay that way here.
- Two house rules disagree. Hold reminders say "no in-process timers" (`services/hold-reminders.ts:32-35`), and
  so does an operations note (`docs/operations/diary-first-week-operations.md:171`). The escalation of unanswered
  requests runs inside the server all the same, waking only when something is due
  (`services/escalation-scheduler.ts:10-23`). It is safe for two servers in what it writes
  (`services/requests.ts:885-889`) but "One API replica is assumed for the wake"
  (`services/escalation-scheduler.ts:19-20`).
- The lesson already paid for: a sweep every 15 seconds "kept the production database awake around the clock and
  used up Neon's compute hours" (`services/escalation-scheduler.ts:12-13`).
- The live rooms are single-server: "a second API replica would split a room in half silently"
  (`ws/layout-live.ts:30-31`; `ws/diary-live.ts:78`).

**Hearing from other services.** Clerk's notices are checked by signature on the untouched body
(`routes/webhooks.ts:207-229`). Stripe's are too (`routes/stripe-webhook.ts:95-120`), and each is recorded once
under its own id, so a repeat is dropped (`stripe_events`, `db/schema.ts:1423-1439`).

**When something fails in the background.** Only a failed request reaches Sentry
(`observability/sentry.ts:104-125`). A failure in a pass that runs by itself is written to the log and nowhere
else (`services/escalation-scheduler.ts:158` and `:178`). No screen lists failed sends or failed work.

**Keys.** Nothing in the API encrypts anything it stores. The integration tables hold "credential references, not
credential values" and never call out (`db/schema.ts:3028-3052`).

**The database.** It is reached through Neon's pooled address (`.github/workflows/deploy.yml:23`), which does not
carry notifications from one connection to another. An idle connection does not keep the database awake
(`db/client.ts:34-39`). The code already takes rows with "skip the ones another worker holds", in the clean-up
that runs daily through that same address (`services/cleanup.ts:139`). Events and enquiries each have a unique key
on the pair (id, venue) that another table can point at (`db/schema.ts:1693` and `:821`).

**The rest.** Uploads go to R2 with a list of allowed types and a size limit for each
(`routes/uploads.ts:16-28`), under a prefix that names the venue. Each venue has a time zone
(`db/schema.ts:136-139`). Reminder times are exact multiples of 24 hours before the decision
(`services/hold-hygiene.ts:188-193`). Text given to a model travels as data, apart from the rules
(`docs/engineering/ai-drafts.md:48-53`). Staff already talk inside Venviewer in threads of short messages, each
thread with an audience that is never widened (`db/schema.ts:6498-6554`). Database tests run on real PostgreSQL,
each suite with its own throwaway database (`.github/workflows/ci.yml:404-419`), and CI fails if one is skipped
(`.github/workflows/ci.yml:436-441`; `scripts/check-required-postgres-suites.ts`). No test yet starts two
processes.

**Open work nearby, which stays with its owners.** #400 changes `services/hold-reminders.ts` among other fixes.
#300 lets staff record a reply made outside Venviewer and adds the reply-time alarm; mail in will later stamp the
same first-reply clock, and #300's control stays for phone calls and outside email.

## 4. Approaches considered

### 4.1 The list of work

| | A. Our own small table (chosen) | B. pg-boss | C. graphile-worker | D. A hosted queue |
|---|---|---|---|---|
| Licence and upkeep | Ours: a few hundred lines, held by the tests in section 8 | MIT; one maintainer; frequent releases; a new major version does not carry old jobs over | MIT core; one maintainer; still before version 1; faster crash recovery is a paid add-on at $100 a month | Their service, their price: Inngest is free to 50,000 runs a month, then from $99 |
| Fits "one reviewed migration at a time" | Yes: a numbered migration like every other table | It makes and changes its own tables when the server starts. That can be switched off, and then its SQL has to be copied by hand at every upgrade | It makes and changes its own tables as the database's owner | Nothing in our database |
| Lets the database sleep | Yes: it asks only when something is due | No: it asks every 2 seconds, and tidies every 60 | No: it holds a listening connection, which Neon's pooled address does not support, or else asks every 2 seconds | Yes |
| Work written in the same transaction as its cause | Yes, a plain insert | Yes, through an adapter | Yes, through a database function | **No**, which rules it out as the outbox |
| Carries the venue, by a rule in the database | Yes | No: a blob of data only | No | No |
| A server dies mid-job | Picked up when its claim runs out, in under a minute | After 15 minutes by default | After 4 hours, unless the paid add-on | Theirs |
| Times in the venue's own clock | Yes | Yes | No: UTC only | Varies |
| Stuck work | A state on our own table, on our own page | A separate queue for it | None: failed rows stay where they are | Their dashboard |

**Chosen: A.** Four reasons, all from this project. Every database change here is one numbered migration, merged
alone and applied before the deploy; both libraries change the database by themselves at start-up. Both ask the
database every two seconds, which is the 18 October outage again, or about $19 a month to keep the smallest
database awake around the clock. A venue column with a rule behind it is how this project keeps venues apart, and
a library's table cannot have one. And staff must see "Not sent" on the thing itself, which is simplest when the
state is in our own table. What we give up is other people's testing: the claim, the retry and the recovery are
ours to get right. So the tests in section 8 are written first, and if they cannot be made to pass, the fallback
is pg-boss with its tables mirrored in our migrations.

### 4.2 The email provider

| | Resend (chosen: we already use it) | Postmark | Amazon SES | Mailgun |
|---|---|---|---|---|
| Price for a few venues | $20 a month: 50,000 emails, ten domains | $16.50 a month: 10,000 emails, ten domains | About $1 a month, plus AWS storage and notices | $35 a month (the $15 plan allows one domain) |
| Mail in | Included on every plan; counted with mail out | Only on the two dearer plans | Yes, through S3 and SNS, which we would have to build | Yes |
| Notices signed | Yes, the same scheme the code already checks for Clerk | **No signatures** | Yes, by certificate | Yes |
| A key that stops a double send | Yes, honoured for 24 hours | **None** | None found | None found |
| Where the mail is handled | A European region can be chosen for each domain | United States only | London available | A European region |

**Chosen: Resend.** It is already built in and tested; it is the only one with both signed notices and a key that
stops a double send; one supplier covers out and in; and a venue's domain can be set up in its European region.
Postmark is ruled out by the two bold cells. SES is the cheapest and has a London region, but mail in would mean
building on three more AWS services and an approval step, for a saving of about $19 a month; it is worth a second
look only at a volume we do not have. Ten domains is nine venues and ourselves; the next step is $90 a month for a
thousand.

### 4.3 The venue's address

| | A. A sub-name of the venue's domain (chosen) | B. The venue's main domain | C. No venue domain at all |
|---|---|---|---|
| Clients see | `Trades Hall Glasgow <events@events.example.org>` | `Trades Hall Glasgow <events@example.org>` | `Trades Hall Glasgow via Venviewer`, from our own domain |
| The venue's administrator adds | Four records, all under the one sub-name. Nothing that exists changes | Three records on the main domain and one sub-name for replies | Nothing |
| What it lets us do | Send and receive as that sub-name only. We can never send as the Hall's own people | Sign mail as any address at the Hall | Nothing in the Hall's name |
| Mail a client writes afresh to the address | Arrives in Venviewer | Goes to the Hall's ordinary mailbox, outside Venviewer | Arrives in Venviewer |

**Chosen: A, with C for a venue that has verified nothing.** A is the smallest thing to ask of a careful
administrator, and it keeps every reply inside Venviewer. `example.org` stands for the venue's domain throughout;
no real domain is written in this repository.

### 4.4 Where the master key lives

| | A. In the server's sealed settings (chosen) | B. A cloud key service | C. Inside the database |
|---|---|---|---|
| Cost | Nothing | About $1 a key a month, and a new supplier | Nothing |
| A leaked copy of the database shows | Scrambled text only | Scrambled text only | **The key passes through the database's own logs** |
| Someone who gets the server's settings | Can read the keys (they also hold the database's address) | Can ask the service to unscramble, until we revoke; every use is logged | The same |
| If we lose it | Each venue reconnects its accounts | The service keeps it | |

**Chosen: A**, built so that B can replace it later without changing the table. C is ruled out. This one costs
nothing either way, so it is my call and not a button; say if you would rather have B.

### 4.5 Where the work runs

| | A. Inside each API server (chosen) | B. A small server of its own | C. Railway's own scheduler |
|---|---|---|---|
| Cost | Nothing | About $3 a month | Nothing |
| A job that goes badly wrong | Shares the API's fate: it could slow or restart the server that also runs the live rooms | Cannot touch the API | Cannot touch the API |
| Work starts | At once, on the server that wrote it | Within the hour, or by a call between the two | No more often than every five minutes, in UTC only, with no promise of a single run |

**Chosen: A, guarded.** Volume is tiny and every handler only talks to the database and to a provider. The guards
are in 5.1: no handler may do heavy computing, a job that takes its server down twice is stopped, and one setting
turns the worker off. Each server says which kinds of work it takes, so moving the heavier kinds to B later is a
setting and a start command, not a rewrite. The trigger for that move is the first time a job is seen to slow or
restart the API. C is ruled out by its last cell.

## 5. The design

### 5.1 The list of work

One table, `jobs`. Each row is one piece of work.

| Column | What it is for |
|---|---|
| `kind`, `version` | What to do (`email.send`, `mail.ingest`, `cleanup.files`), and which shape its data has. Each kind is declared once in code with its handler, its time limit, how many tries it gets, and whether it belongs to a venue |
| `key` | With `kind`, unique. Asking twice for the same work makes one row |
| `venue_id`, `scope` | The venue it belongs to. `scope` is `venue` or `platform`, and the database refuses a venue's job with no venue |
| `payload` | Ids only, never names, addresses or amounts; checked by Zod when written and again when run, and limited in size by the database |
| `run_at` | When it is due |
| `state` | `queued`, `running`, `done`, `dead` (gave up; a person is told) or `abandoned` (a person closed it, with a note) |
| `attempts`, `max_attempts`, `lost_claims`, `last_error` | The tries so far; how often a server took it and never answered; and the last reason, with personal details scrubbed by the existing `scrubErrorMessage` |
| `claim_token`, `claimed_by`, `claim_expires_at` | A fresh token for each time it is taken, which server took it, and until when |
| `resolved_by`, `resolved_at`, `resolution` | Who closed a dead job, when, and their note |

How it behaves:

- **A job carries ids, not facts.** When it runs, it reads the record again and does what is true then. A
  reminder for a hold released yesterday sends nothing. Nobody has to cancel a job when plans change, and no
  personal data sits in the list. The one exception is an email, whose exact words and sender are fixed on the
  send's own row when it is written (5.3).
- **Taking a job.** A server takes the oldest due job in one statement, using `FOR UPDATE SKIP LOCKED`, so two
  servers never take the same one. It marks it `running` under a new claim token, with a claim that lasts the
  kind's time limit plus a margin. The statement is a single short transaction, so it works through Neon's pooled
  address. It takes only kinds and versions this server's code knows.
- **The handler runs outside any transaction.** It is given ids and opens its own short transactions. Every
  handler keeps the house order for locks (booking, then enquiry, then event) and never holds a row lock on an
  event or a booking while it calls an outside service. The spine's lane asked for this rule, and it is agreed.
- **The database's clock decides** what is due and whose claim has run out, never a server's own clock.
- **Finishing.** The row becomes `done` only if the claim token still matches, so a handler that overran cannot
  finish a job that has since been taken again, even by its own server. Where the work only changes our own
  database, the change and `done` are saved in one transaction, and both are undone if the token no longer
  matches.
- **Failing.** A job that fails is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then
  becomes `dead`. A failure that cannot get better is `dead` at once.
- **Time limits that hold.** Node cannot stop a running function, and neither the provider's library nor the
  database driver times out by itself. So the worker races every handler against its limit, and every database
  call of its own against a shorter one. When the limit wins, the try is recorded as failed, the handler is told
  to stop, and the worker moves on. A handler passes that stop signal to every outside call it makes. One hung
  call can never block the list. Whatever a handler left behind does later is caught and logged: the API has no
  last-resort catch for a stray failure today, so one left loose would bring the server down.
- **One at a time.** Each server works one job at a time. That is enough at this volume, and it keeps a slow kind
  from crowding the API.
- **A server that dies mid-job.** At the start of each pass, any claim that has run out is put back on the list
  and counted as a lost claim. A job is retried after its first lost claim, after a pause; after its second it is
  `dead`. So a job that takes its server down can do so twice at most, never in a loop.
- **A deploy.** Railway keeps the old server running until the new one answers its health check, so two run side
  by side for a while on every deploy, even today; the claim makes that safe. The old server is then asked to stop
  and has 25 seconds. Its worker takes
  nothing new, lets the running job finish, and hands back anything unfinished without counting the try. So every
  kind's time limit is 15 seconds or less, and long work is cut into steps: a large deletion is many small jobs,
  each writing the next. If the hand-back itself cannot be written in time, the claim runs out and it counts as a
  lost claim.
- **Old code and new rows.** During a deploy, or after a roll-back, an older server meets jobs written by newer
  code. It never takes a kind or a version it does not know; those wait for a server that does. A kind's data is
  changed in two deploys: first the code that can read the new shape, then the code that writes it.
- **Waking.** The worker does not poll. After each pass it asks the database how long until the next job is due,
  and sleeps that long. Work written by this server wakes it at once, after the transaction has committed. Every
  server also plans when it starts and on each hour, so a job written by another process, or left by a server
  that has gone, waits an hour at most. Two servers plan at the same minute, so they wake the database together,
  not twice. Between plans, with nothing due, the database sleeps. The hour is a setting.
- **Work that repeats** has its next run written when this run is taken, keyed by the time of that run, so two
  servers make one row. Every plan also makes sure the next run exists, so a run that fails never ends the
  series. A time such as "09:00 at the venue" is worked out in the venue's own time zone.
- **What a handler may do.** Talk to the database and to a provider, nothing heavier. Rendering a PDF or
  converting a large file is not a job for this worker (4.5).
- **Tidying.** `done` rows are deleted after 90 days. The lasting record of anything sent, paid or received is in
  that thing's own table, never only in the list.

### 5.2 "Exactly once", honestly

The list promises this: each job is tried until it succeeds or is `dead`, and may be tried more than once. So
every handler must be safe to repeat. This table is the contract for each piece that uses the list.

| Kind of work | What makes a repeat harmless |
|---|---|
| An email | The send's own key, unique in `email_sends` (as today). The same key goes to Resend as its idempotency key, which it honours for 24 hours: a try repeated after a crash is answered with the first result and nothing is sent twice. The tries normally finish within ten hours. No try is ever made more than 23 hours after the first, whatever held it up: the send then says Not sent, with a note if it may in fact have gone, and a person decides |
| A hold reminder (piece A) | The key it already has: the booking, and how many days before the decision (`services/hold-reminders.ts`) |
| Mail coming in | The provider's own id for the message, unique on the stored row; and the notice's own id, recorded once |
| A payment's follow-up (piece E) | Stripe's own id for each notice, recorded once (`stripe_events`, as today). A call to Stripe carries Stripe's idempotency key, made from the ledger row's id (the spine's design) |
| A reminder that money is due (the spine) | The schedule line and its due date. If the date moves, a new job is written, and the old one wakes, reads the ledger and sends nothing |
| A deletion (piece I) | Deleting what has gone changes nothing. The key is the request's id |
| A push to the accounting system (wave 1b) | The invoice's id and version. It is sent as the accounting system's own idempotency key where it has one; otherwise the job looks for the invoice before making it |
| Anything that only changes our own database | The change and `done` commit together. This is the one case that really is exactly once |

### 5.3 The outbox, and email through it

One function, `enqueueJob(tx, …)`, takes the caller's open transaction and the caller's own key. The job is saved
or undone with the work that causes it: there is never a payment with no receipt queued, or a receipt queued for a
payment that was rolled back.

For email, the caller writes the `email_sends` row and its job together.

- **What the row gains.** The venue. The event and the enquiry it belongs to, each by the (id, venue) key. The
  sender and reply address it goes out as. The exact words. When it was first tried, when it was delivered, and
  the time after which it must not be sent late.
- **Its states.** `queued` (written, or between tries), `sent`, `not_sent` (gave up; a person is told), `bounced`
  and `complained`, beside today's `suppressed` and `dev_mode`. Today's `pending` and `failed` stay for rows the
  old path wrote. The database now refuses any other word.
- **Fixed when written.** The words, the sender and the reply address are decided when the row is written and
  never afterwards. That is what a person approved, and Resend refuses a key that comes back with different
  contents. If the venue's domain stops being verified before a try, the try fails and is retried; the message
  is never quietly re-sent from another address.
- **What the provider's answers mean.** Accepted: `sent`. "Another request with this key is in progress": try
  again later, because the first may still succeed. "This key was used with different contents": our own fault,
  so `dead` at once with that reason. A refused address: `not_sent` at once. Too many requests, a provider fault,
  or no answer: retried on the list's times. A refused key or an unverified domain: retried, with an alert,
  because the fault is ours to fix and not the message's.
- **One thing Resend's page does not say:** what its key does after a first try that failed. Its wording ("has
  already been sent") suggests a failed try does not use the key up. The rehearsal proves this against Resend
  itself before any caller moves: a send refused for too many requests, then tried again with the same key, must
  go. If it does not, a try after a plain refusal carries a fresh key, and only a try whose outcome is unknown
  repeats the same one.
- **Not sent late.** A send that could not even be started within a day of being written is not sent by itself
  when the list comes back. It says Not sent and a person decides. A caller may set a shorter time, as hold
  reminders already do.
- **The old path while callers move.** Three guards make sure the two paths never send the same message. First,
  before anything moves, today's path starts giving Resend the send's key, which also ends today's rare double
  send. Second, the list never writes `failed`, the only state the old path will take over
  (`services/email.ts:456-474`), so a replay through the old path finds a `queued` or `not_sent` row and does
  nothing. Third, one switch decides which path callers use.
- **The one screen that shows a result** keeps doing so. The team invitation waits a few seconds for its job and
  says sent, not sent, or a new third thing: on its way, and still being tried.
- **Afterwards.** The retries inside the request go away, because the list retries. The existing limit on how
  many sends a recipient may get (`SendLimit`) is kept, decided in the same transaction as now. `sendEmailAsync`
  is removed once its callers have moved, and a test fails if new code reaches the provider from inside a
  request.

Resend also tells us when a message is delivered, bounces or is marked as spam. Those notices come to the same
door as mail in (5.5) and mark the send, so "Sent" never hides a proposal that did not arrive. A notice can reach
us before we have recorded the provider's answer; its job waits and tries again rather than losing it.

### 5.4 A sender for each venue

A table, `venue_email_senders`, one row a venue: the sub-name; the name and address mail goes out as; the
provider's id for the domain and its region; whether it is `pending`, `verified` or `failed`; the records to add,
as the provider gave them; and when it was last checked. A domain can belong to one venue only.

**What the venue's email administrator adds.** The exact names and values come from Resend when the domain is
created, and are stored and shown from there. With the sub-name `events.example.org` they are:

| Type | Name | Points at | Why |
|---|---|---|---|
| MX | `send.events.example.org` | Resend's bounce address for the region | A message that cannot be delivered comes back to the provider |
| TXT | `send.events.example.org` | `v=spf1 include:amazonses.com ~all` | SPF: says who may send for this name |
| TXT | The DKIM name Resend shows, under `events.example.org` | The public key Resend shows | DKIM: each message is signed |
| MX | `events.example.org` | Resend's receiving address for the region | Replies come to Venviewer |

If the venue's main domain has no DMARC record, we suggest one at `_dmarc.example.org` with the policy "none" and
reports going to an address of the venue's own. Google and Yahoo ask every sender for SPF or DKIM, and Microsoft
is tightening; a DMARC record costs nothing. It is the administrator's choice, because it covers their whole
domain.

**How it is set up.** For the first venue, by us: a command makes the domain at Resend in its European region and
prints the one-page note. A daily job asks Resend whether the records are in place, and a try that Resend refuses
as unverified asks again at once. A screen where a venue's own administrator does this belongs to the Venue place
(wave 2), and is not built here.

**Nothing gets worse on the day this merges.** The set-up command first reads what production sends as today and
which domains Resend has already verified. If the Hall's mail already goes out from a verified domain of its own,
its row is made from that, and nobody who receives its mail sees a change.

**A venue that has verified nothing** sends as `<Venue name> via Venviewer` from our own domain, with replies
coming back through a receiving address of our own (a sub-name of our domain, or the address Resend provides,
which needs no record). Nothing is ever sent from a venue's domain that Resend has not verified. If a verified
venue's records are later removed, new sends are written with the "via Venviewer" sender, and we are alerted.

Mail that is ours and not a venue's (a sign-in message) keeps today's sender.

### 5.5 Mail coming in

**The door.** One route receives Resend's notices. It checks the signature on the untouched body with the `svix`
library the code already uses, which also refuses a notice more than five minutes old. Then, in one transaction,
it records the notice's id (a second arrival finds it and stops) and writes a job. Then it answers. A bad
signature is refused and nothing is stored. Each environment has its own door and its own signing secret, so a
rehearsal's notices never reach production's list.

**In case a notice never arrives.** Resend retries a notice for about a day and keeps received mail for 30. A
daily job asks Resend for the list of what it has received and takes in anything we do not have.

**Where a message belongs**, in this order:

1. **The venue first.** It is the venue whose verified sub-name the message arrived at. At our own receiving
   address, the venue comes from the token alone.
2. **The address it was sent to.** Every correspondence has a reply address of its own: a long random token, in a
   table `reply_addresses` that ties it to one venue, to one event (or one enquiry, while the enquiry has no
   event yet), and to one party, the client or a named supplier. It goes in the Reply-To of everything sent to
   that party about that event, so a supplier's reply never lands among the client's. A token is honoured only
   for its own venue.
3. **Otherwise**, if it was written to the venue's general address, it goes on the venue's Unsorted list, for a
   person to put on an event. Until piece F has a screen for that, it shows on Stuck work.
4. **Otherwise** it is dropped and counted, and not stored.

The token is what matters, not the domain it arrives at, so a venue that moves from our receiving address to its
own sub-name loses no thread. When two events are merged (the spine's design), both keep their addresses.
Matching a reply by the message it says it answers is left out: it needs a header we do not yet set on what we
send, and the token does the job.

**What is kept.** A row in `inbound_emails`: venue, event, enquiry, the reply address, who from, subject, the
text, when, and two flags: that it is an automatic reply, and that it came from an address we have not written to
on this correspondence. Such a message still lands; it is never trusted to do anything. The text is kept as plain
text up to a stated size; a sender's HTML is never shown. The original message and its attachments go to R2 in a
private bucket of their own, under the venue's prefix, and are read only through links that last a few minutes
and always download, never display. Attachments are limited the way uploads already are, by a list of allowed
types and a size for each: at most 10 MB a file and 25 MB a message; PDFs, common images, Word, Excel and
PowerPoint files, plain text, CSV and calendar invites. Anything else is listed by name and size as "not kept".
Taking a message in is cut into steps, as 5.1 requires: one job for the message, then one for each attachment.

**Mail and the conversations staff already have.** Inbound mail does not become a message in the existing
threads. Those are short messages between people who use Venviewer, each thread with an audience that is never
widened, and an outside sender belongs to no audience. The event's Story (pieces C and F) shows both side by
side.

**Kept apart from model instructions.** Inbound text is marked in the code as untrusted. The only way it may
reach a model is the data channel that exists (`contextTagJson`: the rules in one place, the text as escaped data
in another). A test sends a message that tries to close the data channel and give orders, and proves it stays
data. This piece sends nothing to a model itself.

**Never answering by itself.** Nothing here replies automatically, so two systems cannot get into a loop.

**One risk to name.** Resend counts every message it receives against the month's allowance, including junk sent
to an address that does not exist, which we then drop. On the free plan that also eats the cap of 100 a day. So
the count of dropped mail is watched, with an alert, and it is one more reason for the Pro plan before real use.

**Production's replies do not move in this piece.** Today's Reply-To, the inbox the Hall watches, stays on every
real send until piece F ships the screen that shows replies. Reply addresses are made and proved on test events.

### 5.6 Each venue's keys

A table, `venue_secrets`: venue, purpose (for example `accounting.refresh_token`), the scrambled value, and which
version of the master key scrambled it. One row for each venue and purpose.

- **How.** AES-256-GCM, with the venue's id, the purpose and the key version bound into the encryption. A row
  copied onto another venue will not open, so venues are kept apart by the cryptography as well as by the
  queries.
- **Where the master key lives.** In the server's settings, sealed: Railway gives a sealed value to the running
  server and never shows it again, in its screens or through its API. A copy is kept in Blake's password manager.
  It is never in the repository, in GitHub's secrets or in a log. A sealed value is not copied to other
  environments, so a rehearsal has a key of its own.
- **Changing it.** A second key is added beside the first. New values use the new one; a job on the list rewrites
  the old rows in small steps; when none are left on the old key, it is removed. A venue's own value is replaced
  in one statement. Neither needs the server to stop.
- **What a leak of the database would show.** Which venue has a key for what, and when it was set; not the keys.
  That covers a copied backup, a database address that got out (GitHub's scheduler holds one today), and
  read-only access given to a tool.
- **What it does not cover.** Someone holding the server's own settings holds the master key and the database's
  address together. That is true of every design that keeps the key on the server (4.4).
- **Use.** Code reaches a key only through `withVenueSecret(venueId, purpose, fn)`. No route ever returns one;
  screens say "connected on 3 March by Alex". The integration tables keep their promise to hold a reference, not
  a value: the reference now points here.
- **The first users.** The accounting push (wave 1b). The spine recommends a connected payment account, which
  needs nothing secret for each venue; if Blake chooses a key for each venue instead, it is kept here.

### 5.7 When it goes wrong

- **On the thing itself.** A send that gave up says Not sent, with a way to try again. A bounced one says
  Bounced. Piece F shows these on the event and decides which venue roles see them; the states exist from this
  piece.
- **Stuck work.** One plain page, for platform admins only in this piece: every `dead` job, every unsorted
  message, and a count of old sends whose outcome was never recorded. For each: what kind it is, whose venue,
  when, and the scrubbed reason. Two buttons: Try again, and Close with a note.
- **An alert.** Background failures do not reach Sentry today, so the worker reports to it directly: a job that
  becomes `dead`, a lost claim, a venue that has fallen back to "via Venviewer", and a worker that cannot reach
  the database. Each carries the kind, the job and the venue, never an address. Who is rung, and how, is settled
  with the trust pack (piece J). These alerts need Sentry to be switched on in production; the page and the
  release check below do not.
- **A check from outside**, because a list that has stopped cannot report itself. A daily job tells Sentry each
  time it has run, and Sentry alerts if a day passes without hearing. A route beside the health routes reports
  from the server's memory whether the worker is alive, when it last finished a pass, and whether it is stuck in
  a handler, without waking the database.
- **A check at every release** (section 7, last row).

### 5.8 What it leaves alone

The words and look of every email. `stripe_events` and the Stripe door. The hold-reminder code and its dry run
(#400, piece A). #300's control. The live rooms. The conversations tables. The integration tables' columns. Web
push, which has a send table of its own and can move onto the list later. The retention schedule (piece I): this
piece only makes sure every new store of personal data carries its venue and its event or enquiry, so the
deletion job can find it. The new stores are the words on `email_sends`, `inbound_emails`, the attachments in R2,
and reply addresses. Deleting a stored message writes the job that removes its files in the same transaction, so
no file is left behind.

## 6. Who uses what, and how today's scheduled jobs move

| Piece | Uses |
|---|---|
| A, the Diary | The list, for reminders and for holds that lapse; sends through the outbox |
| B, the spine | `enqueueJob` inside its payment transactions; a job dated for any future instant; keys made from its own rows. Agreed with the spine's lane by message on 13 November: no cancel is needed; every link to an event is the (id, venue) key, refuses a delete and can be re-pointed by an event merge; handlers keep the lock order |
| E, the yes that confirms | The outbox for receipts and "ready to confirm"; Stripe's idempotency keys |
| F, send from here | The venue's sender; the exact words on the send's row; reply addresses; mail in; Not sent and Bounced. When it records a staff reply to an enquiry it calls the spine's `ensureEnquiryEvent` in the same transaction and writes that event on the row. It is also the piece that moves production's replies |
| I, keeping and deleting | The list, for the erasure of one person and the 24-month deletion, in small steps |
| Wave 1b | Encrypted keys and the outbox, for the accounting push; mail in, for "email in and the first answer drafted" |

How what runs today moves onto the list, in this order:

1. **Nothing moves.** The list ships switched off, then on, with one harmless test kind.
2. **Email sends.** Today's path first starts giving Resend the send's key. Then the nine callers move, a few at
   a time, behind one switch (5.3).
3. **The escalation wake**, which assumes one server. Its passes become a kind on the list. This must happen
   before any second server.
4. **The daily clean-up.** Its five passes become five kinds, each working in small batches. For one week they
   run both from the list and from GitHub; whichever runs second finds nothing to do, because it deletes what is
   already gone. Then GitHub's schedule is removed. Its manual button stays, but asks the API to run the passes,
   with a token, as the hold-reminder workflow does; that needs one small route, because today's needs a
   signed-in admin. It is one step towards taking the production database's address out of GitHub; two other
   manual workflows still use it (`apply-migration-0018.yml`, `backfill-layout-urls.yml`), and they are not this
   piece's.
5. **Hold reminders and the competitor check stay off.** After Blake's dry run (piece A), reminders become a
   daily kind on the list at the venue's morning, and GitHub's commented-out schedule is never switched on. The
   competitor check follows the same way when its own approval comes.

Stage 1 also corrects the operations note that says the cron owns timing, and adds a short engineering note
beside the code: from now on the list owns timing, and the code owns being safe to repeat.

## 7. The rules in the database, and the checks that prove them

| Rule | In the database | The check |
|---|---|---|
| The same work is written once | `unique (kind, key)` | Twenty writers at once make one row |
| A venue's job names its venue | `CHECK` tying `scope` to `venue_id`; a foreign key to the venue | An insert without one is refused |
| A running job has a claim; any other has none | `CHECK` on `state`, `claim_token` and `claim_expires_at` | Part of the migration's own test |
| No facts in the list | A size limit on `payload` | A large payload is refused |
| A send's status is one of the named states | A `CHECK` on `email_sends.status`, which has none today | A row with any other word is refused |
| A reply address, and a message in once it is filed, belong to an event or enquiry of their own venue. A send may name one | Foreign keys on the pair (id, venue), which both tables already offer; for the first two, at least one of them set; a delete of the event refused | A row of venue A cannot be pointed at venue B's event |
| A token is one address | `unique (token)` | A second row with the same token is refused |
| One domain, one venue | `unique (domain)` | A second venue claiming it is refused |
| A notice is handled once; a message is stored once | Unique ids, written first | The replay test in section 8 |
| One key for each venue and purpose | `unique (venue_id, purpose)`; scrambled columns `NOT NULL` | A row moved to another venue will not open |
| Nothing is stuck unseen | A read that runs in CI and after each release, as the bind's does. It finds: no job due for more than two hours; no `running` job whose claim ran out an hour ago; no `queued` send more than a day old; no queued job of a kind or version the released code cannot read; no stored key whose master key the server lacks. It looks only at rows the list wrote, so old "pending" sends from before do not trip it | It fails the release check and raises the alert |

## 8. Tests first

All on real PostgreSQL, on a throwaway database named in CI and added to the list of suites that may not be
skipped. These are the first things built.

**The list.**

1. **Two servers, one list.** Two separate processes work 200 jobs. Every job's effect is there once. This is
   the first test in the repository to start two processes.
2. **A server killed mid-job.** One process is killed while its handler waits. The job is put back when its claim
   runs out, and its effect is there once.
3. **A job that takes its server down.** It does so twice and is then `dead`, and never a third time.
4. **A hung handler.** One that never returns is recorded as failed at its limit, the next job runs, and the
   liveness route says so. The same for a database call of the worker's own that never returns.
5. **A claim that ran out.** A slow handler cannot finish a job that has been taken again, by another server or
   by its own, and its database change is undone with it.
6. **A restart, and no polling.** Jobs written before a restart run after it. A job due later wakes the worker
   when it is due, and the test counts the queries in between: none.
7. **A deploy.** A process told to stop mid-job hands it back without counting the try, and exits in time.
8. **Old code, new rows.** A server never takes a kind or version it does not know, and a roll-back leaves such
   jobs waiting, untouched.
9. **A poisoned job.** One that always fails goes through its tries and becomes `dead`, while other jobs keep
   moving. The alert is raised once.
10. **The outbox.** A transaction that rolls back leaves no job. One that commits leaves its job even if the
    process dies before it can wake the worker. Twenty writers of the same key make one row.
11. **A reminder across a clock change.** A daily 09:00 kind in Europe/London runs once on each side of the last
    Sundays of March and October, at 09:00 by the venue's clock. The same test pins what the reminders do today:
    "7 days before" is exactly 168 hours, so across a clock change it arrives an hour early or late by the wall
    clock. Whether that should change is for the reminders' owner.

**Email.**

12. **A send after a crash.** The provider accepted the message and the server died before recording it. The
    next try carries the same key, gets the first answer, and one message exists. This uses a stand-in provider
    that honours keys as Resend documents, then is checked once against Resend itself in rehearsal.
13. **The two paths.** A replay through today's path of a key the list holds, `queued` or `not_sent`, sends
    nothing. Today's path gives the provider the key.
14. **The provider's answers.** "In progress" is retried and never Not sent. "Different contents" is `dead` with
    its reason. A refused address is Not sent at once. A send a day old is not sent late. A notice that arrives
    before the provider's answer is recorded still marks its send. And once, against Resend itself: the same key
    after a refused first try (5.3).

**Mail in.**

15. **A replayed notice.** The same notice twice, and twice at the same moment: one record, one job, one stored
    message. A bad signature and a stale one are refused and store nothing. A message the notice never told us
    about is found by the daily job.
16. **Venues kept apart.** A token of venue A arriving at venue B's sub-name is refused. A reply address cannot
    be pointed at another venue's event. A venue's mail is stored under its own prefix. Stuck work opens for
    platform admins only.
17. **Attachments.** One too large and one of a type not allowed are recorded as not kept. An HTML attachment is
    never served to display.
18. **The model boundary** (5.5).

**Keys.**

19. A value goes in and comes out. The same row under another venue will not open. After the master key is
    changed, every row opens with the new one and none needs the old. No key appears in a captured log.

**Proof from outside.** The plan's "done when", run in rehearsal with two processes and a real mailbox, watched
by Blake. The two-server test run once through Neon's pooled address, on a throwaway Neon project with no real
data in it, because CI's database has no pooler in front of it. And the release lead's review of every pull
request.

## 9. Migrations, in four stages

Each stage that changes the database asks orchestration for its own merge slot. Migration numbers are fixed at
merge, never here. Every change adds; none alters or removes what exists.

| Stage | Adds | Backfill | To undo |
|---|---|---|---|
| 1. The list | `jobs`; nullable columns and the status rule on `email_sends`. One migration, then the callers move in pull requests that change no table | None. Old sends keep an empty venue | Turn the callers' switch off: they use today's path again, and the worker finishes what is already queued. If the worker itself is at fault, a command sends what is queued through today's path with the same keys. Then drop the table and the columns |
| 2. A sender for each venue | `venue_email_senders` | One row for Trades Hall, made by the set-up command from what production sends as today, not by the migration | Remove the row: mail goes out as it did before the stage. Then drop the table |
| 3. Mail in | `reply_addresses`, `inbound_emails`, `inbound_email_attachments`, `webhook_receipts` | None | Switch the door off; Resend keeps what arrives for 30 days, and the daily job takes it in when the door is back. Then drop the tables |
| 4. Keys | `venue_secrets` | None | Drop the table while it is empty. Once it holds a key, undoing means each venue reconnecting |

Stage 4 can land whenever its first user needs it. Stages 2 and 3 need the Hall's records to be proved in the
Hall's name: the first three for sending, the fourth for replies. Both are built and rehearsed on our own domain
first.

## 10. What only Blake decides

1. **This design.**
2. **The provider and its cost.** Recommended: stay with Resend, and move to its Pro plan at $20 a month when
   the first real booking's emails begin. The free plan's cap of 100 a day counts mail in too, junk included,
   which is the wrong risk to carry on a busy day.
3. **When a second server is added.** Recommended: with the trust pack (piece J), once the live rooms can be
   shared between servers, which is a small piece of its own with its own cost. This piece is proved with two
   servers in rehearsal from its first merge. About $3 a month when it comes.
4. **What we ask the Hall's email administrator for.** Recommended: a sub-name of the Hall's domain and four
   records (4.3 A). It is one of the three things the plan asks of the venue by 1 December.

Already decided, and not asked again: the hold-reminder schedule stays off until the dry run; real money moves
only on Blake's explicit yes.

## 11. Done when

Unchanged from the plan: **a reminder goes out once, even with two servers, and a reply to a sent message lands on
its event.**

It is first watched in rehearsal, by Blake. It is watched on real work when piece A's first reminder and piece
F's first reply use it.

## 12. My calls, for Blake to overrule, and what is left to the builder

**My calls.**

- The master key in the server's sealed settings (4.4), and the worker inside the API server, guarded (4.5).
- Production's replies stay where they are until piece F (5.5).
- Inbound mail is kept in a table of its own, not in the existing conversations (5.5).
- Stuck work is for platform admins only in this piece, and is plain; if it should be shown to you before it
  ships, say so. Venue staff get no new screen and no new permission here.
- A reply address belongs to one party on one event, so clients' and suppliers' replies never mix (5.5).
- The retry times, the two-lost-claims rule, the hourly plan and the 90-day tidy (5.1). A job is closed by a
  person as `abandoned`, never deleted.
- A send not started within a day is not sent late by itself (5.3).
- The team invitation's screen gains one phrase, for a send that is still being tried (5.3).
- No virus scan of attachments in this piece: they are only ever downloaded, never displayed, and the types are
  limited. A scan can be added if the venue's own rules ask for one.

**Left to the builder.** The exact SQL and indexes. How the worker is woken after a commit, and the order in
which it and the database connection close at shutdown. Whether Resend's idempotency key and the stop signal are
passed through the installed library or by a plain request, read from the installed types. The name of the new
private bucket for mail (the two private buckets that exist are each kept for one other purpose). The routes'
addresses. The size at which a message's text is cut. How a reply address is made once when two requests ask at
the same moment (the send limit's transaction-scoped lock is the house way). What happens to mail when its
enquiry is deleted: nothing deletes an enquiry today, and #247 (erasing a person) may, so the rule is chosen with
that work, to leave no mail behind and block no lawful erasure. Where the rehearsal's door is reached from
outside (a short-lived Railway environment, or a tunnel). Each of these is settled against the code and the
provider's current documentation, not from memory.

**Left to a later piece.** How a token that changes every time it is used, as an accounting system's does, is
refreshed by one worker at a time: the piece that first stores one settles it, and the table allows either a row
lock or a compare-and-set.

## 13. How this design was tested

- A second reader checked every file and line cited in the first draft against the code, and corrected two. The
  references added since were checked by the author against the same commit.
- A fresh reader read the first draft as the engineer who must build it. It found ten places where the draft
  would not have worked as written, and asked five questions. Each is answered in the text above: the old and new
  sending paths (5.3); the provider's "in progress" answer (5.3); time limits that could not be enforced, and a
  token for each claim (5.1); deploy overlap and roll-back (5.1); a job that takes its server down (4.5, 5.1);
  matching a reply by its headers, which is dropped (5.5); the release check tripping on old rows (section 7);
  the undo for stage 1 (section 9); the clean-up as one long job (section 6); where replies show before piece F
  (5.5); what production sends as today (5.4); when the sender is fixed (5.3); who sees what (5.7); and what the
  hourly plan costs (5.1).
- The spine's lane read the contract for the outbox, the links to events and the keys, and its four requests are
  in sections 5.1, 5.5 and 6.

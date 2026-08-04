# The Diary's first live week — operations pack (owner-run)

**Task:** T-527 · **Written:** 2026-07-18 · **Companions:** `diary-deploy-checklist.md` (the deploy itself), `diary-production-rollout-runbook.md` (migration state report / emergency tool)
**Scope:** the repeatable operations for the seven days after the Diary goes live: the smoke cadence and its triage tree, and the hold-reminder delivery cadence.

Everything here was dress-rehearsed against the seeded local stack on
2026-07-18 before the deploy; the outputs quoted below are real rehearsal
outputs. Nothing in this pack touches production until you run it there.

---

## 1. Smoke cadence

Run the production smoke suite (read-only by default) **after the deploy,
then every morning before the venue opens** for the first week:

```
PROD_SMOKE=1 SMOKE_BASE_URL=https://venviewer.com SMOKE_API_URL=https://api.venviewer.com \
SMOKE_EMAIL=<smoke-account> SMOKE_PASSWORD=<its-password> \
pnpm --filter @omnitwin/web exec playwright test e2e/production-smoke.spec.ts
```

- First run: production will likely challenge with an email code — capture a
  session once (`npx playwright codegen --save-storage=.smoke/auth.json`)
  and use `SMOKE_STORAGE_STATE=.smoke/auth.json` from then on (gitignored).
- The **write probe** (`SMOKE_ALLOW_WRITE=1`) is opt-in. Suggested: run it
  once on deploy day and once mid-week, not every morning. Its titles carry
  a per-run token; a failed probe logs the exact title to clean up by hand.
- Re-running the read-only suite is always safe; re-running the write probe
  is a deliberate act, never an automatic retry (the suite pins retries: 0).

### Results log

Append one line per run here — this table IS the first week's evidence:

| Date (BST) | health | front door | signed-in Diary | write probe | Notes |
| --- | --- | --- | --- | --- | --- |
| _example: 2026-07-21 08:30_ | ✅ | ✅ | ✅ | — | version SHA `abc1234` |

## 2. Smoke triage — which failure means what

Work top-down; the suite is serial, so an early failure skips later tests
(deliberately — never write into a system already looking sick).

**`the API answers on every health surface` fails**
→ The API is down or the deploy broke it. Check the Railway deployment
(build logs, deployed SHA vs the pushed master head), then
`curl https://api.venviewer.com/health/version`. If the SHA is right but
health fails, check Railway service logs for a crash loop (an env-schema
refusal prints exactly which variable is missing — `env.ts` fails fast).
Rollback: redeploy the previous Railway deployment (checklist §8).

**`the front door stands` fails**
→ Web-side: check the Vercel deployment (SHA, build log). The API can be
healthy while the web is broken and vice versa — the suite separates them
deliberately. Rollback: redeploy the previous Vercel deployment.

**`a signed-in coordinator reaches the Diary` fails**
→ Three distinct sub-causes, in the order the test asserts them:
1. **Sign-in itself** (never reaches /diary): Clerk. Check the Clerk
   dashboard status page and the smoke account's state (locked/banned).
   If every real user is also stuck, this is the incident.
2. **Lanes never render** ("Grand Hall" timeout): GET /calendar failing —
   check API logs for 500s (every ≥500 is request-logged); commonest cause
   in rehearsal was a database connectivity blip.
3. **`Live · N` presence missing**: the websocket channel. The board still
   works without it (snapshot doctrine — data loads via REST); this is
   degraded, not down. Check API logs for /ws/diary upgrade errors. A
   single-replica restart clears a wedged hub.

**`write probe` fails**
→ Read the runner output FIRST: on a mid-probe failure it prints
`WRITE PROBE LEFT AN ACTIVE ROW — manual cleanup needed: open the block
titled "<exact title>" …`. Do that cleanup (open the block on the board →
Release) before any re-run. A 409 INK_SLOT_TAKEN during the probe means a
real booking landed in the 03:00 slot — that is the venue working; move on.

**Escalation rule of thumb:** one red morning = investigate before the
venue opens; the same surface red twice = treat as an incident and use the
checklist §8 rollback paths. Log every red in the results table with what
you did.

## 3. Hold-reminder cadence (T-7/3/1 delivery)

The Diary's hold-hygiene reminders now deliver. Two ways to run the pass:

- **Cron (the standing path):** once daily, venue-morning:

  ```
  DATABASE_URL=<production-url> RESEND_API_KEY=<key> FRONTEND_URL=https://venviewer.com \
  pnpm --filter @omnitwin/api exec tsx src/scripts/run-hold-reminders.ts
  ```

  Exit 0 = clean (including "nothing due"); exit 1 = at least one send
  failed (wire this to cron alerting); exit 2 = setup error. Add
  `--dry-run` to see what WOULD send. Wire it wherever the team runs
  scheduled jobs (GitHub Actions schedule with those three secrets, or a
  Railway cron service) — the script is the unit either way.

- **Manual (signed-in admin):** `POST /admin/diary/hold-reminders` with
  body `{"dryRun": true}` first if you want the preview. Same service,
  same summary shape.

**Safety properties (rehearsed 2026-07-18):**
- Idempotent at the database: keys are
  `hold-reminder:{bookingId}:{decision-day}:t-{n}` on `email_sends`'
  UNIQUE constraint — overlapping crons, retries, and re-runs cannot
  double-send. Rehearsal proof: two consecutive real passes produced
  exactly one send row.
- A **moved decision date earns fresh reminders** (the day is in the key);
  reminders for the old date simply stop (the instants no longer match).
- Reminders are skipped rather than sent late (24h freshness window), and
  nothing sends once the decision moment has passed — no misinformation.
- Without `RESEND_API_KEY` the pass records `dev_mode` rows instead of
  sending. **In production that means silence** — seeing `dev_mode` rows
  in `email_sends` after go-live means the key is missing from the cron
  environment.

### Reminder triage

- `failed > 0` in the summary → the runner logged each failure with its
  idempotency key. Look up the row in `email_sends` (status, attempts,
  provider id) and the Resend dashboard. 4xx = bad address (fix the
  owner's email); 5xx/429 = provider trouble (the pass already retried
  with backoff; tomorrow's run re-attempts anything that never recorded).
- An owner reports "no reminder": check `email_sends` for their booking's
  key. No row = the hold missed the scan (was it `active`, with a decision
  date and an owner?). Row with `dev_mode` = the key problem above. Row
  with `sent` = delivery-side (spam folder, Resend logs).

## 4. What this pack deliberately does not do

- No auto-remediation — every rollback and cleanup is a human decision
  with the checklist open.
- No in-process schedulers — the cron owns timing; the code owns
  idempotency (house cleanup convention).
- No compliance or delivery-guarantee claims: reminders are a planning
  nudge; the smoke suite is planning-support verification. Decisions stay
  with people.

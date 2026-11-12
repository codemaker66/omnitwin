# OMNITWIN — Production Runbook

Day-2 operations manual. Read this when something is broken, or when you
need to do a deploy / migration / env change and don't want to re-learn the
plumbing from scratch. Complement to `docs/PRODUCTION.md` (first-time
provisioning).

Last updated: 2026-04-20.

---

## URLs + IDs

| Surface       | URL / ID                                                                    |
| ------------- | --------------------------------------------------------------------------- |
| Web (landing) | `https://omnitwin-web.vercel.app/`                                          |
| Web (editor)  | `https://omnitwin-web.vercel.app/editor`                                    |
| API           | `https://omnitwinapi-production.up.railway.app`                             |
| API health    | `/health/live`, `/health/ready`, `/health/version`                          |
| GitHub        | `https://github.com/codemaker66/omnitwin`                                   |
| Vercel        | Project: `omnitwin-web` · builds on push to `master`                        |
| Railway       | Project `bubbly-solace` (`e82eb03e-10b4-403c-876c-fa4093f3b5ea`)            |
| Railway svc   | `@omnitwin/api` (`38c3240d-3540-4d69-936c-0b3041e48aad`), region `europe-west4` |
| Neon          | Project `OMNITWIN` (`misty-pine-24061977`), region `aws-eu-west-2`, pg 17   |
| Clerk         | Test instance — sterling-goldfish-6.clerk.accounts.dev                     |

---

## SS++ reliability proof pack

Operational hardening records live under `docs/operations/`:

- `production-monitoring-checklist.md` covers Sentry, metrics, uptime checks, alert routing, and the public-safe `/health/observability` probe.
- `backup-restore-drill.md` defines the restore verification procedure. A drill is not complete until its dated evidence section is filled in from a real restore.
- `status-page-entry.md` gives the status-page component names and draft incident/update text.
- `performance-budgets.md` records route, bundle, lazy-loading, planner frame, and large-layout budgets.
- `accessibility-audit-2026-06-12.md` records the current route audit and follow-up checks.

Do not mark T-060, T-061, or T-062 complete from documentation alone. They close only when the external Sentry project/alerts, uptime monitor, and backup restore drill have been performed and recorded.

---

## Deploying a change

### Web (Vercel)

1. Commit, push `master`. Vercel builds automatically (1-2 min).
2. If a build doesn't appear: check Vercel dashboard → `omnitwin-web` →
   Deployments. A stuck build usually means the Git integration was
   disconnected.

### API (Railway)

1. **Railway watches `/packages/api/**` only.** If your change is elsewhere
   (Dockerfile, railway.json, root configs) the watcher ignores it.
   Workaround: bump `packages/api/package.json` version to force a deploy,
   or trigger manually via `railway up` / the dashboard "Redeploy" button.
2. First build is slow (~2-3 min: Docker multi-stage + pnpm install +
   tsc build). Subsequent builds with cached layers: ~45-60s.
3. Deploy status: `railway status`, or via Claude
   `mcp__railway__list-deployments`.

---

## Rollback

### Web

Vercel → Deployments → find the last green build → "Promote to production".
~10 seconds.

### API

Railway → Deployments → find the last green deployment → "..." menu →
"Redeploy". Re-pulls the old image; no new build. ~90 seconds.

---

## Logs

### API runtime

- **Claude:** `mcp__railway__get-logs workspacePath=C:/Users/blake/omnitwin2 logType=deploy lines=100`
- **CLI:** `railway logs`
- Filter: append `filter="@level:error"` or `filter="rate limit"` to either.

### API build

Same tool with `logType=build`. Shows the Dockerfile stage where a build
actually failed — `[deps 4/9] RUN npm install -g pnpm@...`, etc.

### Web

Vercel dashboard → Deployments → click the build → "Build Logs" tab for
build output; "Functions" / "Runtime Logs" tab for request-time logs.

---

## Environment variables (API)

Railway-only; the API refuses to boot if required vars are missing (Zod
validates `env.ts` on startup, exits with a clear error).

### Required in production

| Variable                | Where it comes from                                        |
| ----------------------- | ---------------------------------------------------------- |
| `NODE_ENV`              | Set to `production`                                        |
| `DATABASE_URL`          | Neon console → branch `production` → Pooled connection     |
| `JWT_SECRET`            | `openssl rand -hex 32`                                     |
| `CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys (`pk_live_...`)                 |
| `CLERK_SECRET_KEY`      | Clerk dashboard → API Keys (`sk_live_...`)                 |
| `CLERK_WEBHOOK_SECRET`  | Clerk dashboard → Webhooks → endpoint → Signing Secret (`whsec_...`) |
| `CORS_ORIGINS`          | Comma-separated, no trailing slash. Production value: `https://omnitwin-web.vercel.app` |
| `FRONTEND_URL`          | Production value: `https://omnitwin-web.vercel.app`        |
| `RESEND_API_KEY`        | Resend dashboard → API Keys                                |
| `EMAIL_FROM`            | Verified sender address (use `onboarding@resend.dev` for testing, a verified domain for production) |
| `R2_*`                  | Cloudflare R2 dashboard → bucket `omnitwin-uploads`        |

### Setting a var

```bash
railway variables --set "VARNAME=value" --service @omnitwin/api
```

Or via Claude:
```
mcp__railway__set-variables variables=["VARNAME=value"] service=@omnitwin/api
```

Setting a var triggers a redeploy by default. Pass `skipDeploys: true` to
batch multiple var changes and redeploy once at the end.

### Reading current vars

```bash
railway variables --service @omnitwin/api
```

Or via Claude:
```
mcp__railway__list-variables service=@omnitwin/api
```

---

## Database migrations

Migrations live in `packages/api/drizzle/00NN_*.sql` and are recorded in the
ledger `drizzle.__drizzle_migrations`. **The deploy applies them. Nobody
applies one by hand.**

### How a migration reaches production

Two things apply pending migrations, and both write the ledger:

- Railway's pre-deploy command (`railway.json`:
  `node --conditions=omnitwin-dist dist/scripts/migrate-before-deploy.js`)
  runs inside the new image before traffic switches. A failed gate or a failed
  migration fails the deployment, and the previous container keeps serving.
- The Deploy workflow (`.github/workflows/deploy.yml`) runs after master's CI
  passes and then finds nothing pending.

[Deploy ordering](engineering/deploy-ordering.md) says how this works and how
to check a deploy. [The current deploy flow](operations/deploy-flow-current.md)
lists every moving part.

### What not to do

Do not paste a migration's SQL into Neon, and do not run a one-shot
`apply-migration-00NN.ts` script, to apply a new migration.

- Most migrations cannot be run twice: a plain `CREATE TABLE` or `ADD COLUMN`
  fails the second time (0091, 0092 and 0101 are examples).
- SQL applied outside the ledger leaves its tables in place with no ledger
  row. The next deploy's gate then finds a pending migration whose target
  table already exists (`verify-migration-tail-readiness.ts`) and refuses
  every deployment until the ledger is repaired by hand.

The `apply-migration-0009.ts` to `apply-migration-0018.ts` scripts in
`packages/api/src/scripts` are how those early migrations were applied, before
the ledger was the rule. They are a record, not a path for new migrations.

### Verifying a migration landed

- The Railway deployment log carries the pre-deploy command's line:
  `{"status":"migrated","appliedBefore":…,"appliedAfter":…}`, or its failure
  reason.
- `GET /health/ready` compares the journal the image ships with the ledger,
  so it is not green on a container that is ahead of its schema.
- To look at the schema itself, read-only:

```
mcp__neon__get_database_tables projectId=misty-pine-24061977
```

  or query `information_schema.columns` for a new column:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'configurations' AND column_name = 'review_status';
```

### An old note: the ledger was once behind

On 20 April 2026 the ledger was seven rows behind the journal (0009 to 0016
had been applied by hand and not recorded). The deploy gate has since required
the ledger to reach the journal's count before a deployment is promoted, so
that note describes April, not now. This section was corrected on 11 November
2026 without reading production's ledger.

---

## "API is returning 500s"

1. Check `/health/ready` — if that's 500, the issue is startup/env/DB.
2. Check `mcp__railway__get-logs logType=deploy lines=50` for the actual
   error.
3. Common culprits:
   - **Missing env var** — crashed with `Environment validation failed: XYZ`. Fix: set via `mcp__railway__set-variables`.
   - **Missing table/column** — `relation "..." does not exist` or `column "..." does not exist`. The deploy applies migrations (see above): read the Railway deployment log for the pre-deploy line and why it failed. Do not apply the SQL by hand.
   - **DB connection** — `ECONNREFUSED`, `password authentication failed`. Fix: check Neon dashboard → project suspended? Password rotated? `DATABASE_URL` still valid?
   - **Clerk auth** — `Invalid publishable key`. Fix: confirm `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` match the active Clerk instance.

---

## "Web is returning a blank page"

1. Check Vercel deploy status. Green?
2. Open browser devtools → Network. Is `index.html` 200? Is the JS bundle
   loading?
3. `CORS_ORIGINS` mismatch: API rejects the web origin. Fix: update
   `CORS_ORIGINS` on Railway to include the exact Vercel URL (no trailing
   slash).
4. Clerk publishable key mismatch: web was built with `pk_test_...` but API
   has `pk_live_...` (or vice versa). Both must be from the same Clerk
   instance. Rebuild web with the matching key.

---

## Clerk webhooks

- **Configure:** Clerk dashboard → Webhooks → Add Endpoint → URL
  `https://omnitwinapi-production.up.railway.app/webhooks/clerk` → select
  events (`user.created`, `user.updated` at minimum) → copy Signing Secret
  → set `CLERK_WEBHOOK_SECRET` on Railway.
- **Verify firing:** Clerk dashboard → Webhooks → endpoint → "Attempts" tab
  shows delivery history. Failed deliveries show the HTTP response code
  from our API.
- **Local dev:** Clerk's dev instance posts webhooks to the dev tunnel URL
  (e.g., ngrok). Don't mix dev/production secrets.

---

## Permissions / secrets

- **Never commit secrets.** `.env` is in `.gitignore`. Only `.env.example`
  and `.env.production.example` live in the repo.
- **Rotate compromised keys** via the issuing provider's dashboard, then
  update Railway + Vercel var immediately. Redeploy.
- **Production Clerk keys start with `pk_live_` / `sk_live_`.** The
  current `pk_test_...` / `sk_test_...` in Railway are dev keys — fine for
  testing, but swap to `_live_` before onboarding real customers.

---

## Claude Code permission shortcuts

The `.claude/settings.json` file can pre-authorize repetitive production
actions so Claude doesn't re-prompt every time:

```json
{
  "permissions": {
    "allow": [
      "Bash(git push origin master)",
      "mcp__railway__deploy",
      "mcp__railway__set-variables",
      "mcp__neon__run_sql_transaction"
    ]
  }
}
```

Add more as needed. Do NOT add destructive-by-default actions
(`mcp__neon__delete_project`, `Bash(git push --force)`) — keep those
per-confirmation.

---

## Incident response — 5-minute checklist

1. **What's broken?** Hit `/health/ready` (API) and `/` (web). Note the
   codes.
2. **Check the latest deploy.** `mcp__railway__list-deployments limit=3`.
   Recent FAILED status? That's your first suspect.
3. **Pull runtime logs.** `mcp__railway__get-logs logType=deploy lines=50`.
   Look for panics, stack traces, "relation does not exist", env errors.
4. **Rollback decision.**
   - Last green deploy < 24h old and can't identify the bug in 2 minutes
     → rollback, investigate in a branch.
   - Obvious bug (missing env var, missing migration) → fix forward.
5. **Tell your team.** Don't fix silently. Even a one-line Slack post
   prevents duplicated diagnostic effort.

---

## Who owns what

| System        | Escalation                                         |
| ------------- | -------------------------------------------------- |
| Web (Vercel)  | Frontend lead — any engineer on the team           |
| API (Railway) | Backend lead — any engineer on the team            |
| DB (Neon)     | Backend lead; account owner: Blake (`org-mute-butterfly-58698341`) |
| Auth (Clerk)  | Whoever created the Clerk org                      |
| DNS           | Blake                                              |

---

## Known flakes (logged here so future engineers don't rediscover them)

- **Railway cache-mount BuildKit error** — `Cache mount ID is not prefixed with cache key`. Means the Dockerfile uses `--mount=type=cache,id=xxx` with an unprefixed id. Railway requires `s/<service-id>-...`. Workaround: drop the cache mount.
- **Corepack signature verification** — `Cannot find matching keyid`. Node's bundled corepack in 22.12 has stale keys. Use `npm install -g pnpm@<version>` instead of `corepack prepare`.
- **Railway watchPatterns scoping** — the service only watches `/packages/api/**`. Pure-infra changes (Dockerfile, railway.json, root configs) don't trigger builds. Workaround: bump `packages/api/package.json` version alongside the infra change.
- **railway.json `startCommand` vs Dockerfile `CMD`** — `startCommand` in `railway.json` overrides the Dockerfile's `CMD`. After `pnpm deploy`, the runtime image is flattened to `/app/{package.json, dist/, node_modules/}`, so the correct start command is `node dist/index.js` (not `node packages/api/dist/index.js`).

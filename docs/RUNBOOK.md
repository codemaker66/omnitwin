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

Migrations live in `packages/api/drizzle/00NN_*.sql`. Every migration is
idempotent (`IF NOT EXISTS`, guarded constraint adds via `DO $$` blocks) —
safe to re-run.

### Applying a migration to production

**Preferred path** — one-shot TypeScript script per migration:

```bash
cd packages/api
pnpm tsx src/scripts/apply-migration-0012.ts
```

Requires `DATABASE_URL` to point at production Neon (from `.env` or
exported).

**Fast path via Claude** — run the SQL through Neon MCP:

```
mcp__neon__run_sql_transaction projectId=misty-pine-24061977 sqlStatements=[...]
```

Pass each migration file's contents as separate elements in the array. For
0012 specifically, wrap the unguarded `ADD CONSTRAINT` in a
`DO $$ ... IF NOT EXISTS` block so it's idempotent.

### Verifying a migration landed

```
mcp__neon__get_database_tables projectId=misty-pine-24061977
```

Look for the new tables. Or query `information_schema.columns` for new
columns:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'configurations' AND column_name = 'review_status';
```

### Known drift: `drizzle.__drizzle_migrations`

The tracker table is 7 migrations behind the journal (0009–0016 not
recorded) as of 2026-04-20. Cosmetic — all migrations are applied to the
schema. A future `drizzle-kit migrate` would re-run 0009–0016 as no-ops.
To fix, compute sha256 of each `.sql` file and INSERT the rows.

---

## "API is returning 500s"

1. Check `/health/ready` — if that's 500, the issue is startup/env/DB.
2. Check `mcp__railway__get-logs logType=deploy lines=50` for the actual
   error.
3. Common culprits:
   - **Missing env var** — crashed with `Environment validation failed: XYZ`. Fix: set via `mcp__railway__set-variables`.
   - **Missing table/column** — `relation "..." does not exist` or `column "..." does not exist`. Fix: apply the pending migration (see above).
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

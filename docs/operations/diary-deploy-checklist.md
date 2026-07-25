# Production release checklist — web (Vercel) + API (Railway)

**Rewritten:** 2026-07-25, after driving the first real end-to-end deploy on 2026-07-20 and finding that most of the previous version was wrong. Every claim below was checked against the repo or against production; anything that cannot be checked from the repo is marked **[unverified]**.
**Supersedes:** the T-523 Diary cutover plan. This is now the standing procedure for **any** release, not a one-off.
**Companion:** `docs/operations/diary-production-rollout-runbook.md` (diagnostic / emergency selective-apply only).

**Coupled docs — fix in the same commit or the owner reads the wrong thing one click away:**
- `docs/RUNBOOK.md` § "Deploying a change → API (Railway)" still claims Railway watches `packages/api/**`. **There is no GitHub integration for the API.** Its "Required in production" env table is also wrong: it lists `JWT_SECRET` (never read by `env.ts`) and omits `PUBLIC_API_ORIGIN` plus all four `RUNTIME_PROFILE_R2_*`.
- `docs/operations/deploy-flow-current.md` says "The API deployment is expected to be handled by Railway's GitHub integration". That expectation is **disproven**.
- `docs/operations/diary-first-week-operations.md` repeats this doc's old broken smoke command (missing `E2E_START_SERVER=false`).

## Who does what

Most of this is agent-executable. Steps marked **[OWNER]** need a human: browser access, production credentials, or a go/no-go decision.

| Step | Who |
|---|---|
| Pre-flight checks, gates, Docker build proof | agent |
| Neon backup branch | **[OWNER]** browser |
| Supplying the production DB URL | **[OWNER]** — write it to a file outside the repo (see §3); never paste it into chat |
| Applying migrations | agent, on an explicit go |
| Merge + push (triggers a live web deploy) | agent, on an explicit go |
| `railway up` (the API deploy) | agent, on an explicit go |
| Verification sweep | agent |
| Smoke sign-in | **[OWNER]** signs in once by hand (§7); agent runs the suite thereafter |

## 0. Current state (facts, dated)

- **The Diary is LIVE.** `master` = `cae2e54e`. Production API deployed 2026-07-20 ~20:13 BST from that tree. Verified healthy again 2026-07-25.
- **Production migration ledger: `0061_diary_commands`.** Applied by hand 2026-07-20 (record: `docs/sessions/2026-07-20.md`). The committed journal is contiguous `0001→0061`; the old "gap at 0049" is closed.
- **`T-538` (REST command idempotency, `183c6b96`) is NOT in master and NOT in production.** Production runs T-537 + its reviewer fixes. `feature/diary-p0-slice-3` is 3 ahead / 11 behind master (`3b3916fa`, `183c6b96`, `4221d2d7`).
- **`master`'s CI is RED and has been since ≥2026-07-17** — see §9. It does **not** indicate broken production, but it does mean `deploy.yml` never runs.

## 1. The pipeline, as it actually behaves

- **Web (Vercel): deploys on every push to `master`, and does NOT wait for CI.** Push = a live web release.
- **API (Railway): does NOT deploy on push.** There is no GitHub integration for this service. The API only moves when someone runs `railway up` from a linked directory (project `bubbly-solace`, environment `production`, service `@omnitwin/api`). Between 2026-07-06 and 2026-07-20 dozens of commits reached master and the API never moved — nobody noticed for two weeks. **Deploying the API is a separate, deliberate act: §5.**
- **`.github/workflows/deploy.yml` runs `db:migrate` only after CI succeeds.** CI is currently red, so **this never runs** — do not expect it to, and do not rely on it. Apply migrations yourself (§3).
- `deploy.yml`'s `notify-railway` job only `echo`s text. It performs no deploy.

Consequence: **schema must precede code.** Apply migrations (§3) before pushing (§4).

## 2. Pre-flight

- [ ] **Drift, both directions.** The one-directional ancestor test used previously missed the hazard that actually bit.
  ```powershell
  git fetch origin
  git rev-list --count origin/master..HEAD   # commits you are about to add
  git rev-list --count HEAD..origin/master   # commits you are missing — if >0, merge master FIRST and re-gate
  ```
- [ ] ⚠️ **THE MERGE LANDMINE — check this every single time.** `feature/diary-p0-slice-3` does **not** contain the deploy fix `2e7df2a0`. Its `Dockerfile` has **zero** references to `reconstruction-foundry` / `capture-factory` / `twin-forge` (master's has eight) and it has **no `.railwayignore`**. **Merging that branch into master as-is REVERTS the fixes that make the API deployable at all.** In any such merge, take **master's** side of: `Dockerfile`, `railway.json`, `.railwayignore`, `packages/reconstruction-foundry/package.json`, `tools/reconstruction-foundry/package.json`. Verify after merging:
  ```powershell
  git merge-base --is-ancestor 2e7df2a0 HEAD   # must succeed
  git cat-file -e HEAD:.railwayignore          # must succeed
  ```
- [ ] **Clean tree — non-negotiable for the `railway up` model.** `railway up` uploads the **working directory**, not a git ref. A dirty tree ships uncommitted code with **no git record of what is running in production**. Deploy from a dedicated clean worktree at the exact SHA:
  ```powershell
  git worktree add C:/Users/blake/omnitwin2-ship <SHIP-SHA> --detach
  ```
  (This repo routinely has 4+ concurrent sessions leaving ~200 dirty files in the main tree. Never deploy from it.)
- [ ] **Env-var diff BEFORE deploying.** A missing var is the most likely cause of a failed API deploy: five absent vars crashed the first boot on 2026-07-20. `railway variables --service "@omnitwin/api"` and diff against §2a.
- [ ] **The fresh-checkout gate — and it must include a Docker build.** Previous versions of this doc built only the api package, which structurally **could not** catch the break that stopped the API deploying (a broken image recipe). Run at the ship SHA, in the clean worktree:
  ```powershell
  pnpm install --frozen-lockfile
  pnpm --filter @omnitwin/api build
  pnpm --filter @omnitwin/api test
  pnpm --filter @omnitwin/web typecheck
  pnpm --filter @omnitwin/web test
  docker build -t omnitwin-api-preflight .    # THE step that was missing
  ```
  If Docker Desktop's engine will not start, the Railway build itself is the gate — watch it (§5) rather than skipping it.
- [ ] **[OWNER] Neon backup branch:** console.neon.tech → your project → Branches → Create branch, from production/main, named `pre-deploy-YYYY-MM-DD`. **Use a Neon branch, not `pg_dump`** — Neon runs PG 17 and a local PG-16 `pg_dump` refuses to dump it.
- [ ] **Confirm no other session is mid-push.** Ask the other lanes to hold; three separate mid-deploy pushes forced four re-gates on 2026-07-20.

### 2a. Production-required environment variables

Complete, from `packages/api/src/env.ts`. **A miss crashes boot behind Railway's health gate** (the old image keeps serving — see §5).

**Always required:** `DATABASE_URL`.

**Required when `NODE_ENV=production`:** `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `FRONTEND_URL` (valid URL), `PUBLIC_API_ORIGIN` (must be https, no credentials, path exactly `/`, no query/fragment), `RUNTIME_PROFILE_R2_ACCOUNT_ID`, `RUNTIME_PROFILE_R2_ACCESS_KEY_ID`, `RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY`, `RUNTIME_PROFILE_R2_PRIVATE_BUCKET` (must differ from the other bucket vars).

**Must NOT be set:** `VITEST` (boot fails if present).

**All-or-nothing groups — a *partially* set group crashes boot even though each member is individually optional:** legacy uploads (all 5: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`); runtime profiles (all 4, above); Foundry (all 6: `FOUNDRY_R2_ACCOUNT_ID`, `FOUNDRY_R2_ACCESS_KEY_ID`, `FOUNDRY_R2_SECRET_ACCESS_KEY`, `FOUNDRY_R2_CANDIDATE_BUCKET`, `FOUNDRY_R2_RELEASE_BUCKET`, `FOUNDRY_R2_PUBLIC_URL`); AI assistant (if `AI_ASSISTANT_ENABLED="true"` then provider, model, base URL and API key are all required).

**Boots fine but is broken — not schema-enforced:** `CORS_ORIGINS` (defaults to localhost only; without production origins the browser cannot call the API), `CLERK_PUBLISHABLE_KEY`, `RESEND_API_KEY` (email silently logs to console), `EMAIL_FROM`.

**Read by nothing** (present in examples/RUNBOOK but ignored): `JWT_SECRET`, `STRIPE_*`. `GIT_SHA` / `BUILD_TIMESTAMP` are read only by `/health/version` and are never set — see §9.

## 3. Apply migrations — before any push

The owner writes the production URL to a file **outside the repo** (`C:\Users\blake\deploy-secrets\prod-database-url.txt`; outside the tree means it cannot be committed by construction). Notepad + Ctrl+V + Ctrl+S is enough; it never needs to appear in chat or in a terminal.

Read-only state report first — **and confirm which database you hit**:

```powershell
$env:DATABASE_URL = (Get-Content C:\Users\blake\deploy-secrets\prod-database-url.txt -Raw).Trim()
([uri]$env:DATABASE_URL).Host      # confirm this is the production endpoint
pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts
```

With no `DATABASE_URL` set, this script loads `packages/api/.env` via dotenv and reports on **whatever database that file points at** — which is not production. Always read the `target host:` line it prints before believing anything below it. (`drizzle.config.ts` also imports dotenv, but dotenv does not override an already-set variable, so the explicit assignment wins.)

Expected today: `ledger newest: 0061_diary_commands`, both Diary migrations `already applied`. **Anything else: STOP** — wrong database, or someone applied a migration outside this procedure.

Then, only if migrations are actually pending:

```powershell
pnpm --filter @omnitwin/api db:migrate
Remove-Item Env:DATABASE_URL     # do not leave production credentials in the session
```

- [ ] Re-run the state report; confirm the new tail.
- [ ] Spot-check a constraint you care about, e.g. `SELECT conname FROM pg_constraint WHERE conname='bookings_ink_no_overlap';` → 1 row.

The `--apply` flag on `apply-diary-rollout.ts` is an **emergency** tool (out-of-order application strands earlier migrations below drizzle's cursor **forever**). The standard path is `db:migrate`.

## 4. Merge and push — this is the WEB release

- [ ] Re-check §2's landmine before merging anything into master.
- [ ] Push the exact gated SHA rather than a local branch ref (local `master` is routinely stale):
  ```powershell
  git push origin <SHIP-SHA>:master
  ```
- [ ] Expect non-fast-forward rejections if other lanes are pushing. Do **not** force. Fetch, merge master into the ship line, **re-gate at the new SHA**, push again. On 2026-07-20 this happened three times.
- [ ] Vercel deploys immediately. **CI will go red** (§9) — that is pre-existing and does not block the web deploy. `deploy.yml` will be **skipped**, not run; expect no "Migrations applied." message.

## 5. Deploy the API — the step the old doc omitted entirely

From the **clean** worktree at the pushed SHA:

```powershell
cd C:/Users/blake/omnitwin2-ship
railway up --detach --service "@omnitwin/api"
```

- `.railwayignore` is what makes this finish — without it the committed web splat assets make the upload time out. Do not delete it.
- `railway.json`'s `startCommand` carries **`node --conditions=omnitwin-dist`** and **overrides the Dockerfile `CMD`**. Both foundry workspace packages export raw TypeScript from `src/` on every other condition, and the compiled api imports them at boot. **Drop that flag and the API cannot boot.**
- Watch the right log. `railway logs --build` **without** a deployment id shows the *currently active* deployment's log — which may be weeks old and will mislead you completely. Always pass the id printed by `railway up`:
  ```powershell
  railway logs --build <DEPLOYMENT-ID>      # build phase
  railway logs --deployment <DEPLOYMENT-ID> # runtime/boot phase — where env-validation crashes appear
  ```
- **The health gate is your friend.** Railway retries `/health/ready` for ~60s and, if the new replica never becomes healthy, **keeps the old image serving**. A failed boot is therefore zero-downtime: production stays on the previous release while you fix and redeploy. That is exactly what happened on 2026-07-20.
- After changing any variable, the process must **restart** for it to take effect (the R2 clients are cached at module level on first use).

## 6. Verify — by behaviour, not by SHA

**Do not try to compare SHAs.** `railway up` uploads a directory, `.railwayignore` excludes `.git/`, and `GIT_SHA` is never injected — so `/health/version` always returns `gitSha: "dev"` and `version: "0.0.0"` (the package is actually `0.0.4`). Until §9's stamping lands, verify by endpoint behaviour:

```powershell
curl.exe -s -o NUL -w "live %{http_code}`n"   https://api.venviewer.com/health/live      # 200
curl.exe -s -o NUL -w "ready %{http_code}`n"  https://api.venviewer.com/health/ready     # 200
curl.exe -s -o NUL -w "cal %{http_code}`n"    https://api.venviewer.com/calendar         # 401 = Diary code live
curl.exe -s -o NUL -w "home %{http_code}`n"   https://venviewer.com                      # 200
curl.exe -s -o NUL -w "diary %{http_code}`n"  https://venviewer.com/diary                # 200
```

Pick a route that exists **only** in the new code and watch it flip from `404` to `401`. That flip is the proof the new image is serving. Note `GET /bookings` returns `404` legitimately (there is no root list route — `/calendar` is the list surface); probe `POST /bookings` for the `401` auth wall instead.

## 7. Smoke

```powershell
$env:PROD_SMOKE='1'; $env:E2E_START_SERVER='false'
$env:SMOKE_BASE_URL='https://venviewer.com'; $env:SMOKE_API_URL='https://api.venviewer.com'
$env:SMOKE_STORAGE_STATE='.smoke/auth.json'
pnpm --filter @omnitwin/web exec playwright test e2e/production-smoke.spec.ts
```

- **`E2E_START_SERVER=false` is required.** Without it, `playwright.config.ts` boots a local `pnpm dev` and waits on localhost:5173 before touching production.
- **Prefer a saved session over a password.** `npx playwright codegen --save-storage=.smoke/auth.json https://venviewer.com` → **[OWNER]** signs in by hand once, closes the window. `.smoke/` is gitignored (verified). No credential is ever written into a file or shown to an agent. Production sign-in can demand a new-device email code that no script should try to defeat.
- Use a dedicated smoke account: **hallkeeper** role for the read-only suite; staff only if enabling `SMOKE_ALLOW_WRITE=1` (which lands and immediately releases one labelled house block).
- **Know which release you are smoking.** Production predates T-538, so keyed-idempotency behaviour is not present and cannot be smoked yet.
- Cadence for a first live week: after the deploy, then each morning before the venue opens.

## 8. Rollback

- **Web:** redeploy the previous Vercel deployment, or revert the merge on master and push. **This does not touch the API** — reverting master leaves the old API image serving, because pushes never deployed it.
- **API:** redeploy the previous deployment from the Railway dashboard, or `railway up` from a worktree at the previous SHA.
- **Database:** migrations are additive; old code ignores new tables (that is how production ran for two weeks). True schema rollback only via the Slice-5 runbook §5 (bookings must be empty) or the Neon backup branch.
- **The Diary alone misbehaving:** it is one route — reverting the web merge removes `/diary` while leaving the rest of the release live.

## 9. Known-broken and open (2026-07-25)

**`master` CI has been red since ≥2026-07-17.** Production is verified healthy; this is CI hygiene, but it keeps `deploy.yml` permanently skipped. Per job:

- **Typecheck** — `TS6305` in `tools/reconstruction-foundry`: its tsconfig is `composite: true` with `references` to `packages/reconstruction-foundry`, but its script is a plain `tsc --noEmit` and CI never builds the referenced project's `dist/`. `packages/types` survives only because the root postinstall builds it. Passes locally for anyone holding a stale `dist/`. Flipped green→red between `7cd79052` (15:49Z) and `34e154c9` (16:25Z) on 2026-07-20 — i.e. **before** `2e7df2a0` existed (18:52Z), so the export-condition change is not the cause. Owner: Foundry lane (messaged).
- **Test** — `EventArchitectPage.test.tsx` "loads the signed-in venue context": queries a `Venue` label while the page is still rendering "Loading venue rooms…". An async settling assumption.
- **E2E** — landing/a11y failures: "public landing (fresh): console errors", "landing (fresh) unusably small controls", "reduced-motion offenders" across several dialogs. Entered with the `/tour` + FreshPage series. Owner: walkthrough lane (messaged).
- **`TwinPage.test.tsx` dollhouse flake** (load-sensitive, not in the list above): an uncaught `TypeError: useGLTF.preload is not a function` thrown from a real 2500 ms timer (`preloadDollhouse` → `DollhouseStage.tsx`), because the drei double omits the `preload` static. Vitest blames whichever test is still mounted. Fix: complete the mock and delete a redundant `waitFor`. Owner: walkthrough lane (messaged, with the diff).

**Open work:**

- **Build provenance is dead** — `/health/version` reports `gitSha: "dev"`, `builtAt: "dev"`, `version: "0.0.0"`. `railway up` genuinely cannot supply a SHA (Railway's `RAILWAY_GIT_*` vars exist only for GitHub-triggered deploys **[unverified — vendor docs]**; the CLI contains no git library and `.railwayignore` excludes `.git/`, both verified locally). Fix: declare a service variable as an `ARG` in the Dockerfile and pass it at deploy time; it then also works unchanged for any future git-triggered path. Until then, §6's behaviour check is the only honest verification. **Author this on master — not on `feature/diary-p0-slice-3`, whose Dockerfile predates the deploy fix (§2 landmine).**
- **R2 credentials need rotating.** The `RUNTIME_PROFILE_R2_*` values on the production service were copied from this machine's rclone tile-publishing token — far broader than needed. The API uses that credential for **`GetObject` only, on `venviewer-prod-runtime-profiles-private` only** (two call sites; no Put/Delete/List/Head/multipart/presign, and no bucket- or account-level calls), so a Cloudflare **"Object Read only"** token scoped to that one bucket is sufficient and cannot break a code path. Keep it **separate** from the legacy `R2_*` credential, which is a genuine read+write surface (presigned browser uploads, PDF writes, ranged reads) on `venviewer-prod`. The bucket must live in the **default** jurisdiction — an EU-jurisdiction bucket needs a different endpoint host and would fail with this code. Also **treat the borrowed tile token as exposed and regenerate it for its original rclone use.** Nothing probes R2 at boot, so a bad token boots green and fails on the first byte request as a 502/504.
- **`T-538` is not shipped** (§0). Shipping it means merging the branch — read §2's landmine first.
- Cron wiring for hold reminders; Redis backplane before a second API replica; Clerk production claims copied into the dev instance.

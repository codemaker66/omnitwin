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
- **`T-538` (REST command idempotency) IS in master and IS in production**, corrected 2026-07-26. Its content reached master as the cherry-pick `4e8f03a2`; production `/health/version` reports `gitSha: 154c6894`, `builtAt: 2026-07-25T12:03:54Z`, and `git merge-base --is-ancestor 4e8f03a2 154c6894` → yes. **The earlier claim here came from testing `git merge-base --is-ancestor 183c6b96 origin/master`, which is the WRONG test after a cherry-pick** — the original SHA is not an ancestor even though the patch is upstream. Use `git cherry -v origin/master <branch>` (`+` = genuinely absent, `-` = already upstream), or byte-diff the paths.
- **`feature/diary-p0-slice-3` carries exactly ONE commit that is not upstream: `86ca1c87` (the Time Machine).** By `git cherry`, every other commit on it is already in master by patch-id. The branch was pushed to `origin` on 2026-07-26 — before that it had never been pushed, and the Time Machine existed on a single local ref.
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
  pnpm -r run typecheck   # ALL projects — CI's Typecheck job; per-package misses tools/*
  pnpm lint               # ALL projects — CI's Lint job
  pnpm -r test            # ALL projects — CI's Test job; see the bail warning below
  pnpm --filter @omnitwin/api build
  docker build -t omnitwin-api-preflight .    # THE step that was missing
  ```
  **Run the repo-wide forms, not per-package ones.** Learned the hard way on 2026-07-25: a gate of `--filter api` + `--filter web` typecheck/test passed, the push landed, and CI's **Lint** job then failed on a `no-dynamic-delete` error in a brand-new api test — because lint was never in the gate at all. One commit of avoidable red on master.
  **`pnpm -r test` BAILS at the first failing package.** So a green-looking earlier package can hide later ones: fixing the `packages/web` failure on 2026-07-25 let the runner reach `packages/reconstruction-foundry` for the first time and expose two pre-existing failures there. Treat "Test went from one failure to a different failure" as progress, and expect to peel more than one layer.
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

From the **clean** worktree at the pushed SHA. **Stamp the build first** — Railway passes a service variable in as a build arg only because the Dockerfile declares a matching `ARG`, and `railway up` uploads a tarball with `.git/` excluded, so the image cannot discover its own commit:

```powershell
cd C:/Users/blake/omnitwin2-ship
railway variables --service "@omnitwin/api" `
  --set "BUILD_GIT_SHA=$(git rev-parse HEAD)" `
  --set "BUILD_TIMESTAMP=$(Get-Date -Format o)" `
  --set "BUILD_APP_VERSION=$(node -p ""require('./packages/api/package.json').version"")"
railway up --detach --service "@omnitwin/api"
```

Skip the stamp and the deploy still works — the args default to `dev`/`0.0.0`, exactly as production behaved before 2026-07-25 — but you lose the ability to verify §6 by SHA and are back to inferring from endpoint behaviour.

- `.railwayignore` is what makes this finish — without it the committed web splat assets make the upload time out. Do not delete it.
- `railway.json`'s `startCommand` carries **`node --conditions=omnitwin-dist`** and **overrides the Dockerfile `CMD`**. Both foundry workspace packages export raw TypeScript from `src/` on every other condition, and the compiled api imports them at boot. **Drop that flag and the API cannot boot.**
- Watch the right log. `railway logs --build` **without** a deployment id shows the *currently active* deployment's log — which may be weeks old and will mislead you completely. Always pass the id printed by `railway up`:
  ```powershell
  railway logs --build <DEPLOYMENT-ID>      # build phase
  railway logs --deployment <DEPLOYMENT-ID> # runtime/boot phase — where env-validation crashes appear
  ```
- **The health gate is your friend.** Railway retries `/health/ready` for ~60s and, if the new replica never becomes healthy, **keeps the old image serving**. A failed boot is therefore zero-downtime: production stays on the previous release while you fix and redeploy. That is exactly what happened on 2026-07-20.
- After changing any variable, the process must **restart** for it to take effect (the R2 clients are cached at module level on first use).

## 6. Verify — SHA first, then behaviour

**Since 2026-07-25 the image carries its own provenance**, so the fastest check is the direct one:

```powershell
curl.exe -s https://api.venviewer.com/health/version
# {"version":"0.0.4","gitSha":"<the SHA you pushed>","builtAt":"<ISO timestamp>","nodeEnv":"production"}
```

`gitSha` matching the pushed SHA is conclusive proof the new image is serving. If it reads `dev`, you either skipped §5's stamp or the deploy did not land — check which before concluding anything.

**Always also run the behaviour probes.** They are what caught the truth for months while the SHA lied, and they verify the app rather than its label:

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
- **Know which release you are smoking.** Check `/health/version` first — it now stamps a real `gitSha`. Production has carried T-538 since 2026-07-25, so keyed idempotency IS smokeable: resend one `POST /bookings` twice with the same `Idempotency-Key` and expect `201` both times, the same booking id, and `Idempotency-Replay: false` then `true`.
- Cadence for a first live week: after the deploy, then each morning before the venue opens.

## 8. Rollback

- **Web:** redeploy the previous Vercel deployment, or revert the merge on master and push. **This does not touch the API** — reverting master leaves the old API image serving, because pushes never deployed it.
- **API:** redeploy the previous deployment from the Railway dashboard, or `railway up` from a worktree at the previous SHA.
- **Database:** migrations are additive; old code ignores new tables (that is how production ran for two weeks). True schema rollback only via the Slice-5 runbook §5 (bookings must be empty) or the Neon backup branch.
- **The Diary alone misbehaving:** it is one route — reverting the web merge removes `/diary` while leaving the rest of the release live.

## 9. Known-broken and open (2026-07-25)

**`master` CI has been red since ≥2026-07-17.** Production is verified healthy; this is CI hygiene, but it keeps `deploy.yml` permanently skipped. Per job:

- **Typecheck** — `TS6305` in `tools/reconstruction-foundry`: its tsconfig is `composite: true` with `references` to `packages/reconstruction-foundry`, but its script is a plain `tsc --noEmit` and CI never builds the referenced project's `dist/`. `packages/types` survives only because the root postinstall builds it. Passes locally for anyone holding a stale `dist/`. Flipped green→red between `7cd79052` (15:49Z) and `34e154c9` (16:25Z) on 2026-07-20 — i.e. **before** `2e7df2a0` existed (18:52Z), so the export-condition change is not the cause. **FIXED 2026-07-25 in `69ebbf3d`** by the Foundry lane: the root `postinstall` now builds `@omnitwin/reconstruction-foundry` as well as `@omnitwin/types` (the house pattern — fixes every future dependent at once). Proven by reproduction in a fresh detached worktree: the exact TS6305 set before, `pnpm -r run typecheck` exit 0 across all 7 projects after. **Cherry-picks cleanly to master** — one line in root `package.json`, zero overlap with the deploy files. Safe on both build paths (verified): the Dockerfile installs with `--ignore-scripts` so postinstall is inert there, and Vercel's `pnpm install --frozen-lockfile` already runs the structurally identical `packages/types` command on every successful web deploy.
- **Test** — ~~`EventArchitectPage.test.tsx`~~ **FIXED** (`154c6894`): it awaited `findByRole("main")`, the page shell, which renders immediately while the brief still shows "Loading venue rooms…", then ran sync queries against a fetch that had not settled. Now awaits a control that only exists post-fetch. Proven by injecting a 400 ms mock delay: pre-fix reproduced CI's exact error, post-fix 7/7.

  **THE BAIL IS WHY THIS JOB KEEPS "FAILING FOR A NEW REASON".** `ci.yml:145` runs `pnpm -r test`, which stops at the first failing package — so every fix reveals a layer nobody has ever seen. On 2026-07-25 the wall moved three times in one afternoon: web → `packages/reconstruction-foundry` → `tools/reconstruction-foundry`, and `@omnitwin/api` had **never executed on Linux in its history** until it was finally reached. **With a bailing runner, "will Test be green" is unknowable, not merely uncertain** — do not predict it, and read "Test moved to a different failure" as progress. `--no-bail` is committed on the branch (`36c3619f`) and not yet on master; the per-package split (independent `test-api` / `test-web` / `test-foundry` status checks) is the better fix and is deliberately deferred until master is calm.

  **THE WINDOWS-ONLY-GREEN CLASS — six defects, one species, all test-only, zero product defects.** Every one passed on Windows, failed on Linux, and was invisible until something finally ran there. `packages/reconstruction-foundry` and `@omnitwin/api` are now green on Linux; the two CLI items are diagnosed with fixes waiting on another lane (below).

  | defect | shape | status |
  |---|---|---|
  | tamper fixtures created `0o644`, tripping a POSIX privacy guard ahead of the check under test | **file mode** | fixed `a1a8f827` |
  | 20 s `testTimeout` calibrated on an idle Windows box; killed at ~8 s-idle under `pnpm -r` concurrency 4 | **timing** | fixed `a1a8f827` |
  | `gzipSync` stamps zlib's OS byte (`0x0a` win32 / `0x03` unix) inside bytes whose sha256 a golden records | **generated bytes** | fixed `b5739946` |
  | CLI preflight fixture hardcoded a backslash — a separator on win32, a legal filename character on POSIX | **path literal** | fix in Foundry worktree, blocked |
  | CLI redaction fixture hardcoded a `C:\…` path — one long filename on POSIX, so the guard safely fell back | **path literal** | fix in Foundry worktree, blocked |
  | api script test hardcoded `"C:/checked/…"` — **forward slashes, so it reads as portable**, but `isAbsolute` is true on win32 and FALSE on POSIX (a directory named `C:`) | **drive letter** | fixed `3bf87d24` |

  **THE CLASS IS NOW CLOSED FOR EVERY PACKAGE BUT ONE — empirically, not by exhaustion of ideas.** Stated precisely, because the imprecise version misleads: **`@omnitwin/api` *at `3bf87d24`* is 149/149 files / 2,676 tests green on Linux**, verified in WSL from a fresh clone of the committed tree (frozen install, Linux-native binaries, mock env) — its first end-to-end Linux run in its history. **That is not a property of `master`.** `3bf87d24` is branch-only; master's api still carries the drive-letter fixture, and the two are the same code only until master moves — which it did twice on 2026-07-25 without either lane touching it. ⚠️ **`3bf87d24` (api fix) and `36c3619f` (`--no-bail`) are BOTH branch-only, and the api fix precedes the flag in branch order, so a normal merge lands them together safely. The hazard is cherry-picking the flag ALONE** — that would give master a no-bail runner reaching an api that still has the fixture, reporting a defect already fixed. Take them together or not at all. So the four candidate shapes queued for the api are all answered for that package: the drive-letter fixture was the only defect, and there is nothing else. Per-package state: api ✅ · reconstruction-foundry ✅ · types / web / capture-factory / twin-forge ✅ (CI hardware) · **reconstruction-foundry-cli ⏳ — 2 fixture defects fixed in the Foundry lane's worktree, uncommitted, blocked only on T-508's in-flight work, and outstanding by choice.** Consequence for `--no-bail`: the api is no longer a 2,678-test unknown queued behind whatever breaks first, so the flag's first run should surface only that CLI pair — no three-defect surprise, because someone went and looked.

  **Sweep criteria for the rest of the class:** assertions on a hash of bytes the suite *generates* (not bytes it reads from a fixture); assertions on file metadata (mode, ownership, mtime); and **any hardcoded path literal at all** — the drive-letter case proves a literal can look portable and be win32-only. Case sensitivity was **ruled out with evidence** for the api: all 12 non-`.sql` read paths are case-exact. CRLF exposure remains open — only `packages/api/drizzle/*.sql` is pinned `-text`, so `deploy.yml`, `drizzle/meta/_journal.json`, `emails/*.tsx`, `package.json` and the `src/**/*.ts` source-inspection targets are not; `action-log-schema.test.ts:25` already uses `\r?\n`, which is evidence someone met this before and fixed it locally rather than repo-wide.

  **`tools/reconstruction-foundry` (the CLI) — currently the only Test red.** 2 tests, both **test-fixture only**, both Windows-shaped path literals; the production guards were **proved correct on Linux** (the preflight guard rejects a real traversal; the redaction guard falls back to a generic label, i.e. more conservative, not less). Fixes exist and are verified 105/105 on Windows and in isolation on Linux, but **both files are dirty with the T-508 lane's in-flight work, so they cannot land cleanly yet.** Do not step around that lane to force a green. The cost of a red CI collapses once the red is understood, and this red is understood.
- **E2E** — landing/a11y failures: "public landing (fresh): console errors", "landing (fresh) unusably small controls", "reduced-motion offenders" across several dialogs. **Surface: the fresh-landing audit specs** — `e2e/accessibility-route-audit.spec.ts`, `e2e/button-action-audit.spec.ts`, `e2e/public-acquisition-visual-performance.spec.ts` (verified: those files own the failing test names). The fresh-landing series landed 2026-07-16→18, which matches the red-since date; **not** the `/tour` work, which landed 07-20 (two days after red) and is referenced by **zero** e2e specs (verified by grep). An earlier version of this doc misattributed these — corrected 2026-07-25.

  **STATE 2026-07-25 after four fixes: 7 failing tests → 2, and 200 tests now pass where 56 had not executed since 16 July.** The reduced-motion assertion (`support/accessibility-audit.ts:722`) now passes on every route. Root cause of the 37-of-40 group was a **CSS specificity collision**: scoping the springy-button rules behind `body:not(:has(.fr-root))` raised them to (0,1,2) while every reduced-motion override sits at (0,0,1); both sides `!important`, so specificity decided and the killswitch silently lost. Fixed at source by gating the motion on `prefers-reduced-motion: no-preference` (`index.html`) — do **not** fix a future regression here by adding a more specific override, that is an arms race. Also fixed: the hero's `fetchPriority` (typed by `@types/react` 18.3.18, unknown to `react-dom` 18.3.1, so React warned and dropped it — no LCP hint since `bd86364a`) and a 107×15 px phone-call tap target on the primary enquiry path.

  **The two remaining accessibility failures are CONTRAST on `/fresh`, and they arrived the same afternoon** — `p.fr-walk-chip` ("This is not a photograph.") at ratio **1.92** and `p.fr-walk-size` ("Loads the captured room — about 60 MB") at **2.12**, both needing ~4.5. `fresh.css` was rewritten by `c11a8c4d` ("the beauty pass") hours earlier, +179 lines. These surfaced only because the motion fix let the audit reach contrast at all — this is exactly the tail the triage forecast ("1–1.5 days if the three never-yet-evaluated `/fresh` samples produce contrast or focus-visible findings"). **Route to whoever owns the beauty pass: it is a colour decision on their afternoon's work, not a bug fix.** Note the irony worth not repeating — the least readable label on the page is the line that says the picture is not a photograph, which is the product's core honesty claim.

  33 tests still show "did not run": the five audit specs are `mode: "serial"` at file scope, so the first failure aborts the file's tail. Expect two or three more rounds to walk it out; de-serialising the route audit is a separate ~2 h task and should not be bundled into a green-CI push.
- **`TwinPage.test.tsx` dollhouse flake** (load-sensitive, not in the list above): an uncaught `TypeError: useGLTF.preload is not a function` thrown from a real 2500 ms timer (`preloadDollhouse` → `DollhouseStage.tsx`), because the drei double omits the `preload` static. Vitest blames whichever test is still mounted. Fix: complete the mock (`Object.assign(vi.fn(...), { preload: vi.fn() })`) and delete a redundant `waitFor`. Sibling mesh-manifest tests in that file arm the same timer and are safe only by having no post-mount `await` — adding one re-opens the crash. ⚠️ **`TwinPage.test.tsx` and `DollhouseStage.tsx` are the dollhouse/peel lane's UNCOMMITTED work and that lane runs in VS Code, invisible to this app's session registry** (`docs/handoffs/TWIN-STATUS.md:102`). **Do not edit or stash those files to apply this fix** — you would clobber a lane that cannot see cross-session messages. Bridge via TWIN-STATUS.md, where the root cause is now recorded for its owner. (Ownership of dirty files in this shared tree cannot be inferred from which registry session is running — an earlier version of this doc got it wrong that way.)

**Open work:**

- ~~**Build provenance is dead**~~ — **FIXED 2026-07-25.** `/health/version` had reported `gitSha: "dev"`, `builtAt: "dev"`, `version: "0.0.0"` since the endpoint was written, while its own comment claimed CI injected them — nothing ever did, and nothing asserted it. The image now stamps all three via Dockerfile `ARG`s (`BUILD_GIT_SHA` / `BUILD_TIMESTAMP` / `BUILD_APP_VERSION`) fed by Railway service variables (§5), `version` reads `APP_VERSION` because `npm_package_version` is unset when the start command invokes node directly, and two tests in `packages/api/src/__tests__/health.test.ts` now pin both the stamped and the unstamped fallback paths so it cannot rot silently again. `railway up` genuinely cannot supply a SHA by itself (Railway's `RAILWAY_GIT_*` vars exist only for GitHub-triggered deploys **[unverified — vendor docs]**; the CLI contains no git library and `.railwayignore` excludes `.git/`, both verified locally) — hence the build-arg route, which also works unchanged for any future git-triggered deploy.
- **R2 credentials need rotating.** The `RUNTIME_PROFILE_R2_*` values on the production service were copied from this machine's rclone tile-publishing token — far broader than needed. The API uses that credential for **`GetObject` only, on `venviewer-prod-runtime-profiles-private` only** (two call sites; no Put/Delete/List/Head/multipart/presign, and no bucket- or account-level calls), so a Cloudflare **"Object Read only"** token scoped to that one bucket is sufficient and cannot break a code path. Keep it **separate** from the legacy `R2_*` credential, which is a genuine read+write surface (presigned browser uploads, PDF writes, ranged reads) on `venviewer-prod`. The bucket must live in the **default** jurisdiction — an EU-jurisdiction bucket needs a different endpoint host and would fail with this code. Also **treat the borrowed tile token as exposed and regenerate it for its original rclone use.** Nothing probes R2 at boot, so a bad token boots green and fails on the first byte request as a 502/504.
- ~~**`T-538` is not shipped**~~ — **it is; corrected §0 on 2026-07-26.** What remains unshipped on `feature/diary-p0-slice-3` is `86ca1c87` (the Time Machine), which is dead code on arrival: `TimeMachinePanel` is imported by nothing but its own test, and it has neither a `tasks.md` row nor a session log. Wire it or retire it — do not merge it as-is.
- Cron wiring for hold reminders; Redis backplane before a second API replica; Clerk production claims copied into the dev instance.

# Diary merge-and-deploy checklist (owner-run)

**Task:** T-523 · **Written:** 2026-07-16 · **Companion:** `docs/operations/diary-production-rollout-runbook.md` (now the diagnostic/emergency tool — see §2)
*(Two reconcile commits and this doc briefly carried the label T-522 before the parallel G4 Action-log session claimed it — the commits are immutable; T-523 is this slice's number.)*
**Scope:** take `feature/diary-p0-slice-3` (reconciled with master on 2026-07-16, all gates green) to production: master merge, database migrations 0044→0051, web (Vercel) + API (Railway) deploys, first-week smoke.

## 0. What the reconciliation already fixed (context, no action)

- The branch contains master's deployed homepage series; conflicts resolved; **web 267 files / 3,188 tests, api 143 / 2,622, builds, and the live diary e2e are green on the reconciled branch.**
- **Master's CI is currently RED** (two route-lazy source pins never updated for the Wave-A router refactor — verified via `gh`: CI=failure, Deploy=skipped at `1ecbec23`). The branch fixes the pins, so CI goes green once this merges. Until then the auto-migrate workflow cannot run for anyone.
- The committed migration journal referenced `0049_reconstruction_foundry` whose file was never committed — a fresh checkout (CI, deploy) would crash mid-migrate. The committed journal now lists only tracked files. **Invariant from here: never commit a journal entry without its .sql file.**

## 1. Understand the pipeline you are about to trigger (read once)

On a push to `master` (evidence: `docs/operations/deploy-flow-current.md` + the workflow files):

- **Vercel deploys the web immediately — it does NOT wait for CI** (the homepage shipped while CI was red).
- **Railway builds the API from the same push** (no proof it waits for anything).
- **`.github/workflows/deploy.yml` runs `db:migrate` against production ONLY after CI succeeds** (~15 min later).

That ordering means: **for a window after the push, new Diary code is live while the bookings tables don't exist yet** — staff opening `/diary` would see errors until the migrate lands. Step 3 removes that window by applying migrations FIRST.

## 2. Pre-flight (10 minutes)

- [ ] **Neon backup branch**: console → Branches → create from production head, name `pre-diary-deploy-2026-07-DD`.
- [ ] **State report** (read-only): `pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts` — expect `ledger newest: 0043_platform_admin_scope` (production never received 0044+ because deploy.yml never ran — see §0). The script will list 0044–0048 in its cursor warning; that is expected and step 3 handles them **in order** — do NOT `--apply` this script in the standard path (it would apply 0050/0051 out of order and strand 0044–0048 below the cursor).
- [ ] Confirm no other session is mid-commit on the branch; `git log --oneline -5` matches what you expect to ship.
- [ ] **Check master drift**: `git fetch origin && git log --oneline 1d360e3b..origin/master`. Master keeps moving through Vercel's no-CI-wait path (3 homepage commits landed within hours of the reconciliation — walk-the-room, room dossiers, image ladder). If it has moved, merge `origin/master` into the branch again FIRST and re-run the gates; §4's "should be clean" only holds when the branch contains master's head.
- [ ] The Slice-5 runbook (`diary-production-rollout-runbook.md`) is hereby the **diagnostic + emergency selective-apply tool**; this checklist owns the standard path.

## 3. Apply ALL pending migrations, in journal order, before any push

From the reconciled branch (its committed journal is coherent: 0001→0048, 0050, 0051):

```
DATABASE_URL=<production-url> pnpm --filter @omnitwin/api db:migrate
```

This is exactly what deploy.yml will do later — done deliberately first, so schema precedes code. It applies `0044→0048` (event architect / mission control — their code is in this deploy too) then `0050→0051` (the Diary). All are additive; the Diary migrations were rehearsed end-to-end (Slice 4/5).

- [ ] Re-run the state report: `0050/0051: already applied`, ledger newest = `0051_diary_enquiry_link`.
- [ ] Spot-check: `SELECT conname FROM pg_constraint WHERE conname='bookings_ink_no_overlap';` → 1 row.

## 4. Merge and push

- [ ] Merge `feature/diary-p0-slice-3` into `master` locally (`git checkout master && git merge feature/diary-p0-slice-3` — it should be clean; the branch already contains master) and push. (If you prefer a PR, note PR #1 from the critique session is also open against master — sequence them deliberately; whichever merges second must re-run CI.)
- [ ] Watch CI go **green** on the master head (first green in a while — the pin fix, plus T-524's lockfile repair: the committed api manifest carried `pg@^8.22.0` without lockfile entries, so `pnpm install --frozen-lockfile` failed on any fresh checkout until commit 0bf09f48).
- [ ] `deploy.yml` then runs its migrate: expect **"Migrations applied."** with nothing to do (step 3 already applied them).

## 5. Verify the deploys (per deploy-flow-current.md)

- [ ] Vercel deployment SHA == pushed master head; Railway deployment SHA == same.
- [ ] `curl https://api.venviewer.com/health/live` · `/health/ready` · `/health/version` (version should show the new SHA).
- [ ] Homepage loads; sign-in works.

## 6. First-week smoke (repeatable)

Run the production smoke suite — read-only by default (see its header for the dedicated smoke-account recommendation):

```
PROD_SMOKE=1 SMOKE_BASE_URL=https://venviewer.com SMOKE_API_URL=https://api.venviewer.com \
SMOKE_EMAIL=<smoke-account> SMOKE_PASSWORD=<its-password> \
pnpm --filter @omnitwin/web exec playwright test e2e/production-smoke.spec.ts
```

Suggested cadence for the first live week: after the deploy, then each morning before the venue opens. The optional write probe (`SMOKE_ALLOW_WRITE=1`) creates and immediately cancels one clearly-labelled house block — leave it off unless you want write-path confirmation.

## 7. Owner actions that ride along (from Slice 5, unchanged)

- [ ] Clerk dashboard: copy production's session-token Claims JSON into the dev instance → `node infra/dev-db/verify-clerk-claims.mjs` → PASS.
- [ ] Tell the Foundry owner: 0049+ must be hand-applied when their chain ships (journal `when` ordering — technique in the Slice-5 runbook §3), and journal entries must only be committed together with their files.

## 8. Rollback

- **Web/API code:** redeploy the previous Vercel/Railway deployment (provider dashboards), or revert the merge commit on master and push.
- **Database:** the migrations are additive and stay — old code ignores the new tables entirely (that is how production ran all of today). True schema rollback only via the Slice-5 runbook §5 (bookings must be empty) or the Neon backup branch.
- **The Diary alone misbehaving:** it is one route — reverting the merge removes `/diary` while the rest of the release (homepage etc.) was already live pre-merge.

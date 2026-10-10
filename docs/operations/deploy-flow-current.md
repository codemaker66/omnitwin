# Current Deploy Flow

**Delivery policy, 7 September 2026:** apply the
[build, ship and verify contract](../../.claude/conventions/shipping-changes.md).
The agent owns a requested product change through its appropriate release and
live check. Coordinate existing release owners without turning their ownership
into another user approval or a local-only stopping point. The provider details
below are dated evidence to verify, not fresh permission requirements. Deploy
only affected services; a web-only or docs-only change does not require an
unchanged API to be rebuilt just to match a commit identifier.

Last reviewed: 2026-06-07.

This document records the deploy flow that can be inferred from the repository
and existing operator notes. It is a current-state map, not the target release
system. T-093 owns the gated v1 deploy orchestration.

## Source Evidence

| Area | Evidence |
|---|---|
| Web build config | `packages/web/vercel.json` builds `@omnitwin/types` then `@omnitwin/web`, outputs `dist`, rewrites SPA routes to `index.html`, and redirects `omnitwin-web.vercel.app` to `venviewer.com`. |
| API deploy config | `railway.json` builds the root `Dockerfile`, starts `node dist/index.js`, runs one replica, and probes `/health/ready`. |
| API container | `Dockerfile` builds `@omnitwin/types` then `@omnitwin/api`, deploys a production-only API bundle, runs as a non-root user, and defines a `/health/live` Docker healthcheck. |
| CI | `.github/workflows/ci.yml` runs audit, lint, typecheck, unit tests, and web E2E on pushes to `master` and PRs targeting `master`. |
| Migration workflow | `.github/workflows/deploy.yml` runs only after the `CI` workflow succeeds on `master`, checks out the CI head SHA, and runs `pnpm --filter @omnitwin/api db:migrate` with the production `DATABASE_URL` secret. |
| Manual ops workflows | `.github/workflows/apply-migration-0018.yml`, `.github/workflows/backfill-layout-urls.yml`, and `.github/workflows/cleanup.yml` are manual or scheduled database operations, not general deploy orchestration. |
| Health probes | The API exposes `/health`, `/health/live`, `/health/db`, `/health/ready`, and `/health/version`. |

## Current Flow

1. A commit reaches `master`.
2. GitHub Actions starts `CI` for that commit.
3. The web deployment is expected to be handled by the Vercel project connected
   to this repository, using `packages/web/vercel.json`.
4. The API deployment is handled by Railway's GitHub integration, using
   `railway.json` and the root `Dockerfile`. Railway builds on the push, runs
   the pre-deploy command that migrates inside the image
   ([Deploy ordering](../engineering/deploy-ordering.md), PR #63), and keeps the
   previous container live until the new one answers `/health/ready` with a
   2xx, which since T-653 also requires the bundled journal to be fully applied
   (see [Readiness waits for migrations](#readiness-waits-for-migrations-t-653)).
5. If GitHub Actions `CI` succeeds, `.github/workflows/deploy.yml` runs Drizzle
   migrations against production Neon with `DATABASE_URL`.
6. Operators verify the live web route and API health endpoints manually.

The repository does not contain a Vercel CLI deploy step, a Railway API deploy
step, or a promotion step. Vercel and Railway deployment timing therefore
depends on external project settings that must be verified in the provider
dashboards before a release.

## Current Gaps

- There is no single release controller for web, API, and database migrations.
- The repo does not prove that Vercel waits for GitHub Actions `CI`.
- Railway builds the API container before the migration workflow runs; the
  pre-deploy command migrates before promotion (PR #63) and `/health/ready`
  refuses while the image's journal is ahead of the database (T-653), so the
  container never serves ahead of its schema. The web deployment is not gated
  the same way: for a release that carries a
  migration, the new web build can talk to the previous API for the CI plus
  Deploy duration (about 15 to 20 minutes), where before it was the new API
  that ran ahead of its migration.
- `deploy.yml` applies migrations after CI, but it does not poll Railway,
  Vercel, or live health checks before declaring the release usable.
- There is no repo-level release ID shared across web, API, database migration,
  and post-deploy smoke checks.
- Railway is configured for `numReplicas: 1`, so API deploys should be treated
  as a single-instance replacement unless the Railway dashboard says otherwise.
- Rollback is manual: redeploy the previous provider deployment or revert and
  push a new commit. Database rollback is not automatic and must follow
  expand-contract discipline.
- Manual database workflows exist for specific historical repairs; they are not
  a substitute for a general release process.

## Readiness waits for migrations (T-653)

Observed on 9 October 2026: Railway rebuilt the API on the master push and
had it live within three minutes, while `deploy.yml` applied migration 0087
only after master CI, fourteen minutes later. The new API selected columns
that did not exist yet for about eleven minutes. Two layers now keep a
container from serving ahead of its schema:

1. **The pre-deploy migrate** ([Deploy ordering](../engineering/deploy-ordering.md),
   PR #63): `railway.json`'s `preDeployCommand` runs the tail gate and applies
   pending migrations inside the built image, with the service's own
   `DATABASE_URL`, before Railway promotes the container. This is what does
   the work on an ordinary release.
2. **The readiness probe** (T-653): `GET /health/ready` still runs the
   `SELECT 1` reachability probe (503 `DB_UNREACHABLE` on failure, as before),
   then compares the journal the image ships
   (`packages/api/drizzle/meta/_journal.json`, read once at start) with
   `drizzle.__drizzle_migrations`. While any journal timestamp is not recorded
   it answers 503 `MIGRATIONS_PENDING` with `pendingTags`,
   `migrations.applied` and `migrations.local`; otherwise 200 with the
   counts. A database without the migrations table counts as entirely
   unmigrated. `/health/db` is unchanged: reachability only.

On an ordinary release the pre-deploy has already migrated when the first
probe arrives, so the probe passes at once and nothing waits. The probe
matters when the first layer did not run: a removed or skipped pre-deploy
command, a dashboard setting that drifted from `railway.json`, or a ledger
the pre-deploy failed to write. Then Railway retries the probe until a 2xx
and only then makes the new deployment active (its documented behaviour),
so the previous container keeps serving while the Deploy workflow's own
migration lands; `railway.json` raises `healthcheckTimeout` from 60 s to
2700 s to cover CI plus Deploy. If the probe never passes within 45 minutes
the deployment is marked failed and the old one stays, so a cancelled or
red master CI never puts a migration-bearing build live. A release without
a new migration passes the probe at once.

How to watch one: the Railway deploy log shows the pre-deploy's
`"status":"migrated"` line, or, when the probe is doing the waiting, the 503
answers with the pending tags until `gh run watch` reports the Deploy run's
"Migrations applied for commit <sha>"; the next probe then answers 200, the
deployment goes active and `/health/version` reports the new `gitSha`. If
the Deploy workflow was cancelled by a later master push, the later commit's
own Railway deployment supersedes the waiting one; if CI failed, fix master
and push, or re-run the Deploy workflow for a green commit and redeploy from
the Railway dashboard.

What neither layer covers: Vercel still publishes the web build on the push,
so for a migration-bearing release the new web can talk to the previous API
until promotion. Additive, backward-compatible API changes keep that window
harmless; a breaking API change still needs the expand-contract discipline
below.

## Required Operator Check Before Pushing

Run the relevant local release gate for the change. For a broad release, use:

```bash
pnpm audit --audit-level=moderate
pnpm lint
pnpm typecheck
pnpm test
VITE_CLERK_PUBLISHABLE_KEY=pk_test_dummy pnpm build
```

For web-visible changes, also run the affected Playwright slices. For the
Trades Hall visual route, include:

```bash
pnpm --filter @omnitwin/web e2e -- e2e/trades-hall-visual.spec.ts --workers=1
```

Before pushing `master`, confirm:

- `git status --short --branch` shows the intended branch and no unrelated dirty
  files.
- `git log --oneline origin/master..HEAD` contains only the commits intended for
  release.
- T-091 and T-091A are not marked done unless a real captured runtime asset has
  been registered, loaded, and evidenced.
- The public claim guard still passes.
- No real asset is represented by a fixture, demo, manual arbitrary URL, or
  Spark fixture path.

## Manual Post-Deploy Verification

After a push, verify the exact commit that providers deployed:

1. Check the Vercel deployment for the web project and confirm the deployed git
   SHA matches the pushed release commit.
2. If API source or its deployment inputs changed, verify that Railway deployed
   the intended API revision. Otherwise verify the retained API is healthy and
   compatible; do not rebuild unchanged services solely to align SHA labels.
3. Check relevant CI and any required migration workflow against the intended
   release. Do not invent a migration requirement for a change with no schema delta.
4. Hit API health:

```bash
curl https://api.venviewer.com/health/live
curl https://api.venviewer.com/health/ready
curl https://api.venviewer.com/health/version
```

5. Open the live web routes that changed. For the current Trades Hall visual
   route, use:

```text
https://venviewer.com/dev/trades-hall-visual
```

If an affected provider is on an unintended revision, or required migrations failed,
stop treating the release as verified and investigate before making customer
claims or registering new runtime assets.

## Target V1 Owned By T-093

T-093 should replace the current loose flow with a single gated release path:

- Create one release ID for the commit.
- Run CI once for that release ID.
- Apply database migrations under an explicit lock.
- Enforce expand-contract migrations for all live data changes.
- Build or promote web and API artifacts from the same release ID.
- Poll Vercel, Railway, `/health/ready`, and `/health/version`.
- Run a small live smoke suite against the deployed SHA.
- Record the release result and rollback instructions.
- Require at least two API replicas where the platform and cost envelope support
  it.

Until T-093 lands, releases remain operator-verified rather than fully
orchestrated.

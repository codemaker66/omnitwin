# Current Deploy Flow

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
4. The API deployment is expected to be handled by Railway's GitHub integration,
   using `railway.json` and the root `Dockerfile`.
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
- The repo does not prove that Railway waits for the migration workflow before
  building or replacing the API container.
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
2. Check the Railway deployment for the API project and confirm the deployed git
   SHA matches the pushed release commit.
3. Check the GitHub `Deploy` workflow completed for the same SHA.
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

If any provider is on a different SHA, or if migrations did not finish cleanly,
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

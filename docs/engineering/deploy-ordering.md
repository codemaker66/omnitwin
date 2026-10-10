# Deploy ordering: the API never runs ahead of its schema

**Since 10 October 2026.** Two things happen when master moves:

1. Railway's GitHub integration rebuilds the API image (watch patterns in
   `railway.json`) and promotes the new container once `/health/ready` is green,
   about two and a half minutes after the push.
2. The Deploy workflow (`.github/workflows/deploy.yml`) waits for master's CI to
   pass (about fourteen minutes), runs the read-only migration tail gate, then
   `drizzle-kit migrate` against the production database.

Until this change the API therefore served new code against the old schema in
the gap. On 9 October 2026 the requests routes selected migration 0087's columns
for eleven minutes before the columns existed (02:37 to 02:48 UTC; no staff screen
was on).

## What runs now

`railway.json` carries a pre-deploy command:

```
node --conditions=omnitwin-dist dist/scripts/migrate-before-deploy.js
```

Railway runs it inside the built image, with the service's own `DATABASE_URL`,
before traffic switches. The script (`packages/api/src/scripts/migrate-before-deploy.ts`):

- runs the same compiled tail gate the workflow runs
  (`verify-migration-tail-readiness.js --deploy-gate`) as a child process with the
  same Node flags, so a deployment is refused on exactly what CI refuses;
- applies what is pending through drizzle-orm's migrator with the driver the API
  itself uses for the URL (Neon serverless in production, `pg` for a local URL),
  reading `packages/api/drizzle`, which `pnpm deploy --prod` copies into the image;
- writes the same `drizzle.__drizzle_migrations` ledger drizzle-kit writes (tag
  hash and `when`), so the workflow's second pass finds nothing pending and the
  gate's comparison of applied `created_at` values still holds;
- refuses the deployment if the ledger does not reach the journal's count.

A failed gate or migration fails the deployment and Railway keeps the previous
container serving. `preDeployTimeoutSeconds` (900) turns a hung pre-deploy into a
failed deployment rather than a blocked pipeline; drizzle-orm applies the pending
files inside one transaction, so a kill at the cap leaves the ledger consistent.
The workflow remains the audited second pass and keeps the explicit 0044
approval gate.

## Evidence

`packages/api/src/__tests__/migrate-before-deploy-postgres.test.ts` on the
disposable cluster: a database that has never been migrated reaches the whole
journal in one run, the living timetable's tables exist afterwards, the ledger
holds one row per journal entry, and a second run applies nothing and reports the
same counts.

The compiled script, run from `dist/scripts` against the disposable database,
spawns the gate with the same Node flags and exits 1 with the redacted reason when
the gate refuses. The gate itself speaks only Neon's serverless transport, so a
plain local PostgreSQL cannot pass its preflight; the success path is proven by
the first Railway deployment log after the change, which carries the
`"status":"migrated"` line before promotion.

## Checking a deploy

- `gh api repos/codemaker66/omnitwin/deployments?sha=<sha>` lists Railway's and
  Vercel's records; `.../deployments/<id>/statuses` gives their outcome.
- The Railway deployment log shows the pre-deploy command's JSON line
  (`{"status":"migrated","appliedBefore":…,"appliedAfter":…,"local":…}`) or its
  redacted failure reason.
- `https://api.venviewer.com/health/version` reports the running commit.

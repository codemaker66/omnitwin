# @omnitwin/api

Fastify API service for Venviewer. This package owns server-side routes,
database access, migrations, auth verification, email delivery, R2 object access,
and operational health probes.

## Owns

- Fastify application bootstrap in `src/index.ts`.
- Zod-validated environment loading in `src/env.ts`.
- Drizzle schema and SQL migrations under `src/db` and `drizzle`.
- Authenticated and public API routes under `src/routes`.
- Server-only integrations: Clerk backend keys, Resend, R2/S3 signing, Sentry,
  Stripe server keys when billing is active.
- Operational endpoints: `/health`, `/health/live`, `/health/db`,
  `/health/ready`, and `/health/version`.

## Does Not Own

- Browser UI, React route behavior, or Three/Spark rendering.
- Shared contract definitions that belong in `@omnitwin/types`.
- Training, RunPod, XGRIDS processing, or capture pipeline execution.
- Public marketing claims or evidence status beyond the data returned by the
  runtime asset APIs.

## Commands

Run from the repository root:

```bash
pnpm --filter @omnitwin/api lint
pnpm --filter @omnitwin/api typecheck
pnpm --filter @omnitwin/api test
pnpm --filter @omnitwin/api build
```

Local development:

```bash
cp packages/api/.env.example packages/api/.env
pnpm --filter @omnitwin/api dev
```

Database work:

```bash
pnpm --filter @omnitwin/api db:generate
pnpm --filter @omnitwin/api db:migrate
```

Only run migrations against a real environment after confirming the target
`DATABASE_URL` and the intended branch. Production migration application is
documented in `docs/operations/deploy-flow-current.md`.

Loopback PostgreSQL URLs use TCP at the URL's port; remote URLs use the Neon
driver. The API owns its pool through `createDbConnection` and closes it during
Fastify shutdown. A local API no longer needs a Neon WebSocket proxy.

The required platform database gate is separate from ordinary unit tests:

```bash
pnpm --filter @omnitwin/api test:platform-db
```

Provision the disposable `venviewer_platform_test` database on loopback port
55477 and explicitly set `VENVIEWER_PLATFORM_TEST_DATABASE_URL` for this command.
It does not use an ambient `DATABASE_URL`. The runner checks the full migration
journal and replay, then requires all specified database test files to pass with
zero skips. Receipts are written under `packages/api/.test-results/platform-db/`
and uploaded by CI. See [platform evidence](../../docs/engineering/intelligent-platform.md)
for current scope and remaining goal gates.

## Contract Rules

- Import shared request/response vocabulary from `@omnitwin/types`.
- Validate external inputs at the route boundary.
- Validate environment variables at startup; never fall back to dummy secrets.
- Keep migrations additive and replay-safe where possible.
- Pair schema or route behavior changes with focused API tests.
- Do not accept fixture/demo object keys as real runtime assets.
- Do not mark a room asset as usable unless storage references, format, status,
  and evidence fields pass the shared validators.

## Environment

Use `packages/api/.env.example` for local development and
`packages/api/.env.production.example` for provider configuration. Do not commit
real secrets.

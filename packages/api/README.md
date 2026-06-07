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

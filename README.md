# OMNITWIN

[![CI](https://github.com/codemaker66/omnitwin2/actions/workflows/ci.yml/badge.svg)](https://github.com/codemaker66/omnitwin2/actions/workflows/ci.yml)

Browser-based photorealistic venue planning platform for Trades Hall Glasgow —
a "Sims build mode" for real-world event spaces. Plan a wedding or banquet by
dragging tables, chairs, and staging into a photoreal 3D model of the room,
then export a hallkeeper sheet for the venue ops team.

This is a single-tenant production app, not a library.

## Tech stack

- **Frontend** — React 18, React Three Fiber, Zustand, Vite, Three.js
- **Backend** — Fastify 5, Drizzle ORM, Neon serverless PostgreSQL
- **Auth** — Clerk (web SDK + Fastify plugin + signed webhooks)
- **Shared** — Zod schemas in `@omnitwin/types`, consumed by both ends
- **Tooling** — TypeScript strict mode, ESLint v9 flat config, Vitest, pnpm workspaces

All packages run TypeScript in strict mode with `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, and zero `any` types as a hard rule.

## Repo layout

```
packages/
  types/   @omnitwin/types   shared Zod schemas + interfaces      (935 tests)
  api/     @omnitwin/api     Fastify backend, Drizzle ORM         (389 tests)
  web/     @omnitwin/web     React + R3F frontend                 (1,112 tests)
```

**2,436 tests** across the workspace, all passing on every commit.

## Requirements

- Node.js **≥ 22** (current LTS)
- pnpm **9.15.4** (`npm i -g pnpm@9.15.4` — Corepack also works on most platforms)
- Postgres connection string for the API (Neon recommended) — see
  [`packages/api/.env.example`](packages/api/.env.example) for the full env contract
- Clerk account for auth — publishable + secret + webhook signing keys

## Getting started

```bash
git clone https://github.com/codemaker66/omnitwin2.git
cd omnitwin2
pnpm install --frozen-lockfile

# Frontend dev server  → http://localhost:5173
pnpm --filter @omnitwin/web dev

# API dev server       → http://localhost:3001
cp packages/api/.env.example packages/api/.env  # then fill in real values
pnpm --filter @omnitwin/api dev
```

In a fresh checkout the API will refuse to boot until `DATABASE_URL` is set.
In `NODE_ENV=production` it additionally requires `CLERK_SECRET_KEY` and
`CLERK_WEBHOOK_SECRET` — startup-time Zod validation rejects any other state.

## Quality gates

Every check below runs in CI on every PR. They must all pass before merge.

```bash
pnpm -r lint        # ESLint v9, zero errors required
pnpm -r typecheck   # tsc --noEmit, zero errors required
pnpm -r test        # Vitest, all 2,436 tests must pass
```

The CI workflow lives at [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
and runs the three jobs in parallel against Node 22 on Ubuntu.

## Production environment contract

The API server uses Zod-validated environment variables and refuses to boot
if anything is missing. In `NODE_ENV=production` the following are
**hard-required**:

| Variable                | Why                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | Postgres connection — no default                                                     |
| `CLERK_SECRET_KEY`      | Auth tokens cannot be verified without it                                            |
| `CLERK_WEBHOOK_SECRET`  | Webhook signature verification — refusing to boot avoids silently accepting unsigned events |

See [`packages/api/.env.example`](packages/api/.env.example) for the full
contract including optional Resend, R2/S3, and CORS configuration.

## License

Proprietary — all rights reserved. Not for redistribution.

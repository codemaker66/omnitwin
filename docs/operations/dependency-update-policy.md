# Dependency Update Policy

Venviewer uses exact direct dependency pins in every workspace package. Internal
workspace dependencies may use `workspace:*`; external direct dependencies must
use an exact `x.y.z` version. Transitive emergency overrides live in the root
`pnpm.overrides` block with a short reason in the commit or session log.

## Why

Renderer, auth, database, and build-tool drift can change production behavior
without a code diff. That is below the bar for a venue-planning product that
depends on Spark, Three.js, Clerk, Fastify, Drizzle, Vite, and Vitest behaving
the same way locally, in CI, and in production.

## Rules

- Do not add `^`, `~`, `x`, `*`, `latest`, or tag-based direct dependency
  specifiers.
- Keep `packageManager` pinned in the root `package.json`.
- Commit `pnpm-lock.yaml` with every dependency change.
- Run `pnpm install --lockfile-only` after editing dependency specifiers.
- Run `pnpm audit --audit-level=moderate` before merging dependency changes.
- Run package-specific lint, typecheck, tests, and build gates for the package
  whose dependencies changed.
- For renderer changes, run the Trades Hall visual/Spark regression tests and a
  production web build.
- For auth/API/database changes, run API lint, typecheck, and the default API
  test suite.
- Do not upgrade a critical dependency only because a newer version exists.
  Upgrade for a security patch, compatibility requirement, verified bug fix, or
  explicitly scheduled maintenance window.

## Critical Sets

Renderer/runtime:

- `three`
- `@types/three`
- `@sparkjsdev/spark`
- `@react-three/fiber`
- `@react-three/drei`
- `vite`

Auth/API/database:

- `@clerk/react`
- `@clerk/backend`
- `@clerk/fastify`
- `fastify`
- `drizzle-orm`
- `zod`
- `@neondatabase/serverless`

Build/test:

- `typescript`
- `vitest`
- `@playwright/test`
- `eslint`
- `typescript-eslint`

## Upgrade Flow

1. Pick the package and reason.
2. Read the release notes and breaking-change notes for every version crossed.
3. Update the exact version in the relevant `package.json`.
4. Run `pnpm install --lockfile-only`.
5. Run the package-specific gates listed above.
6. Run `pnpm audit --audit-level=moderate`.
7. Record the package, old version, new version, reason, and verification in
   `docs/sessions/YYYY-MM-DD.md`.

## Emergency CVE Flow

1. Prefer a direct package upgrade when available.
2. If the vulnerable package is transitive, add or update a root
   `pnpm.overrides` entry.
3. Run `pnpm audit --audit-level=moderate`.
4. Add a follow-up task if the override should be removed after an upstream
   package releases a clean dependency tree.

# @omnitwin/web

React, Vite, and React Three Fiber web application for Venviewer. This package
owns the customer-facing routes, planner/editor UI, dashboard and hallkeeper
surfaces, client-side API adapters, and lazy native Three.js runtime entry points.

## Owns

- Route registration in `src/router.tsx`.
- Public and authenticated page components under `src/pages`.
- Planner/editor components, Zustand stores, local draft behavior, and
  browser-side validation.
- Client API adapters under `src/api`.
- R3F/native Three.js route chunks and visual fallback states.
- Public-claim guard tests for deployable and customer-facing copy.

## Does Not Own

- Database schema, server-side auth verification, or migrations.
- Shared contract vocabulary that belongs in `@omnitwin/types`.
- Runtime asset registration or storage signing; the browser consumes approved
  API responses.
- Training, XGRIDS/RunPod processing, or raw capture storage.

## Commands

Run from the repository root:

```bash
pnpm --filter @omnitwin/web lint
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web test
VITE_CLERK_PUBLISHABLE_KEY=pk_live_local_validation_only pnpm --filter @omnitwin/web build
```

Local development:

```bash
pnpm --filter @omnitwin/web dev
```

Playwright:

```bash
pnpm --filter @omnitwin/web e2e
```

For the internal Trades Hall visual route:

```bash
pnpm --filter @omnitwin/web test -- TradesHallVisualPage runtime-visual-asset native-splat-stack bundle-splitting
pnpm --filter @omnitwin/web e2e -- e2e/trades-hall-visual.spec.ts --workers=1
```

## Runtime Asset Rules

- Use `NativeCanvas`, `NativeSplatLayer` and the shared scene host for Gaussian
  splats. The host supplies one globally sorted draw through Three's
  `WebGPURenderer`, including its WebGL2 fallback. See
  [the native runtime note](../../docs/engineering/native-splats.md) for supported
  formats, lifecycle, source fidelity limits and qualification status.
- Prefer the registered RuntimePackage selected by the shared source resolver.
  Where staged captures are enabled, retain their explicit staged evidence label;
  staging does not imply a registered or reviewed runtime package.
- Manual runtime URLs are local-dev tools only; deployed builds use the approved
  source-resolution path.
- Fixture/demo URLs, including historical Spark fixture paths, must stay blocked
  from the real runtime asset path.
- If neither a runtime package nor an allowed staged capture is available, show
  the procedural/fallback scene with evidence-backed wording.

## Copy And UX Rules

- Customer-facing copy must stay evidence-backed and pass
  `public-claim-guard.test.ts`.
- Prefer explicit loading, empty, and error states over blank routes.
- Keep mobile planner surfaces touch-native; do not compress desktop chrome into
  phone layouts.
- Keep Three/native Gaussian imports lazy and route-scoped unless a measured
  need says otherwise.

## Environment

Use `packages/web/.env.example` for local development and
`packages/web/.env.production.example` for provider configuration. Only
`VITE_*` variables reach the browser; never put server secrets in this package's
client environment. Production web builds deliberately reject Clerk `pk_test_`
publishable keys so venviewer.com cannot ship Clerk's Development mode banner.

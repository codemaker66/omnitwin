# Performance Budgets

Date: 2026-06-12 (bundle and static asset budgets revised 2026-09-24)
Status: hardening budget
Owner: Venviewer engineering

These budgets are guardrails for planner and operations quality. They are not guarantees of production performance until measured on deployed infrastructure and representative devices.

## Route Load Budgets

| Route | Budget | Check |
|---|---:|---|
| Landing `/` | First usable content under 3 s on desktop broadband. | Playwright visual smoke and no-overflow tests. |
| Planner `/plan/:id` | Canvas visible under 10 s in local E2E. | `packages/web/e2e/performance.spec.ts`. |
| Trades Hall visual `/dev/trades-hall-visual` | Shell and canvas visible under 15 s with no real asset required. | Trades Hall visual E2E and hardening screenshot smoke. |
| Client proposal `/proposal/:shareCode` | Proposal content visible under 5 s with mocked API. | Hardening screenshot smoke. |
| Dashboard analytics `/dashboard` | Analytics view visible under 5 s with mocked API. | Hardening screenshot smoke. |
| Public room route `/venues/:venueSlug/rooms/:roomSlug` | Client-safe room preview visible under 5 s with mocked runtime visual state. | Hardening screenshot smoke. |
| Pricing `/pricing` | Offer and billing controls visible under 5 s. | Hardening screenshot smoke. |
| Hallkeeper `/hallkeeper/:configId` | Authenticated sheet header and first checklist row visible under 8 s with mocked API. | Hardening screenshot smoke. |

## Bundle Budgets

- Main route must lazy-load page components through `React.lazy`.
- `@omnitwin/types` stays side-effect free (`"sideEffects": false`, top-level
  declarations only), so a route ships only the contract modules it uses.
- Deferred observability imports the Sentry SDK by name, never as a namespace.
- The `three` vendor chunk holds core three, R3F, drei and three-stdlib;
  `three-webgpu` holds the WebGPU renderer, TSL and the splat addon stack. WebGL
  surfaces such as the panorama tour must not statically reach `three-webgpu`.
  Both are lazy and share the 5,500 KB warning limit. Spark has been removed;
  `bundle-splitting` fails if a Spark chunk or import returns.
- File-import readers (zip.js for GDTF/MVR) load when a file is chosen.
- Stylesheets never `@import` remote CSS; a failed import fails the lazy route.
- Fonts are served from this origin (`packages/web/src/styles/fonts/`, Google
  Fonts' own files with provenance and licences); no third-party font host or
  preconnect stands before first paint, and fonts are not preloaded (Chrome
  treats a font preload in `<head>` as render-blocking).
- Clerk remains isolated to the auth chunk.
- Source and built-output tests (`bundle-splitting`, `twin-chunk-budget`,
  `startup-guardrails`, types `module-side-effects`) fail if these regress.
  Measured route weights: `docs/reports/performance-review-2026-09-24.md`.

## Static Asset Budgets

- Pages request display-sized images: responsive WebP ladders with `sizes` that
  match the rendered width, not multi-megabyte originals as thumbnails.
- `vercel.json` caches versioned or hash-named files immutably and other public
  files briefly with background revalidation; the app document is never cached.
- Display copies come from `packages/web/scripts/build-image-ladders.mjs` with a
  `provenance.json` beside them, never above source resolution. Images that
  carry provenance metadata (the C2PA-marked room plans) are not re-encoded.

## Planner Frame Budget

- Normal drag/place/selection interactions should stay responsive at a 16 ms frame target on target desktop hardware.
- Large layouts should keep interaction under 33 ms per frame before release.
- Work repeated on every drag move stays near-linear in layout size: the
  placement-rule sweep is grid-indexed, and a drag resolves groups and landing
  surfaces once per move. `placement-violation-sweep.equivalence` and the
  `placement-store` linearity test guard both.
- Draw-call and per-frame work reductions must be invisible: dinner covers
  share geometries and materials but stay separate meshes (instancing them
  changed the transparent sort); editable furniture draws from pooled instance
  buffers updated only for moved items; opaque Grand Hall ornaments draw as
  merged batches (translucent pieces such as window glass keep their own
  objects) while the per-mesh tree handles faded surfaces; room shells stay
  mounted across camera gestures, and a hidden wall's click animation keeps
  time with its ornaments. Their equivalence tests
  (`TableSettingMesh.equivalence`, `InstancedFurnitureLayer.editable`,
  `GrandHallOrnaments.merge`, `RoomMesh.shell`, `BrickWall.gesture`) compare
  against the previous implementation or a never-hidden reference.
- Heavy runtime assets and simulation work must remain lazy or job-backed, not in the first planner request path.

## Large Layout Object Count

- Local planner history and save paths must be tested with hundreds of placed objects before raising public capacity language.
- E2E route fixtures should remain deterministic and lightweight; large-object stress belongs in focused unit/performance tests or manual profiling.
- Missing measurements become a performance risk note, not a green release claim.

## Splat Lazy Loading

- Spark runtime code belongs only in splat/runtime routes.
- `/plan` must not import Spark.
- Missing runtime assets must show honest empty/error states instead of blocking planner use.

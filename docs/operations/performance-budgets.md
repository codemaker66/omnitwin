# Performance Budgets

Date: 2026-06-12
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

## Bundle Budgets

- Main route must lazy-load page components through `React.lazy`.
- Spark must stay out of normal app and editor route sources.
- Three/Spark vendor chunks are intentionally lazy and have a warning limit of 5,500 KB.
- Clerk remains isolated to the auth chunk.
- CI source tests must fail if Spark is imported into normal editor sources.

## Planner Frame Budget

- Normal drag/place/selection interactions should stay responsive at a 16 ms frame target on target desktop hardware.
- Large layouts should keep interaction under 33 ms per frame before release.
- Heavy runtime assets and simulation work must remain lazy or job-backed, not in the first planner request path.

## Large Layout Object Count

- Local planner history and save paths must be tested with hundreds of placed objects before raising public capacity language.
- E2E route fixtures should remain deterministic and lightweight; large-object stress belongs in focused unit/performance tests or manual profiling.
- Missing measurements become a performance risk note, not a green release claim.

## Splat Lazy Loading

- Spark runtime code belongs only in splat/runtime routes.
- `/plan` must not import Spark.
- Missing runtime assets must show honest empty/error states instead of blocking planner use.

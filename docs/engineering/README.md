# Engineering map

Use [AGENTS.md](../../AGENTS.md) for operating policy. This page routes investigation
to current code and useful checks; it is not another layer of instructions.

## Find the implementation

| Area | Start here | Important boundaries |
| --- | --- | --- |
| Intelligent event platform | [Implementation and evidence](intelligent-platform.md), [Goal 12](../../goals/12-intelligent-venue-platform.md) | Shared decisions/releases, transactional commands, evaluation and explicit completion gates |
| Web application | [web README](../../packages/web/README.md), [router](../../packages/web/src/router.tsx), `packages/web/src/components/` and `stores/` | Selected-record identity, request ownership, accessible interaction and renderer lifecycle |
| API | [API README](../../packages/api/README.md), `packages/api/src/routes/`, `services/`, `middleware/` | Venue authorization, runtime schemas, transactions, idempotency and useful error responses |
| Shared contracts | [types README](../../packages/types/README.md), `packages/types/src/` | Validate at runtime; trace affected consumers before changing a contract |
| Database | `packages/api/src/db/`, `packages/api/drizzle/` | Constraints, locking, migrations and explicit disposable test targets |
| Diary bookings and their events | [The bind](the-bind.md), `services/event-binding.ts`, `services/booking-mutations.ts` | Every hold and ink has its event, written in the same transaction; status follows the bookings; never join by guesswork |
| Deploy ordering and readiness | [Deploy ordering](deploy-ordering.md), [Current deploy flow](../operations/deploy-flow-current.md), `packages/api/src/db/migration-readiness.ts` | The pre-deploy command migrates before Railway promotes (PR #63); `/health/ready` refuses while the image's migration journal is ahead of the database (T-653), the second layer |
| Reconstruction | `packages/reconstruction-foundry/`, `tools/reconstruction-foundry/`, `tools/capture-factory/` | Source provenance, calibration, evaluation separation and current spend gates |
| Splat training environment | [D-016a](../architecture/adr/D-016a.md) (accepted for the environment), [RunPod runbook](../../infra/runpod/RUNBOOK.md), `infra/runpod/Dockerfile` | RunPod only (D-016). Since 16 October 2026 (T-655, validated): PyTorch 2.14.1+cu132, torchvision 0.29.1+cu132, gsplat `main` @ `512d366b` (built with `BUILD_3DGUT=0`; 3DGUT needs a separate build) and PPISP v1.3.0 as an opt-in flag (its trial was inconclusive at one seed), every CUDA extension compiled by nvcc 13.2.86 (CUDA 13.2 Update 2), because nvcc 12.8 to 13.2 Update 1 can miscompile nested divergence. No trainer image exists for it yet: use the runbook's plain-image path, while the image pins wait in draft [#94](https://github.com/codemaker66/omnitwin/pull/94) until the image is built and smoke-tested. `infra/runpod/Dockerfile` still builds `omnitwin/trainer:1.5.3-cu124` (gsplat 1.5.3, PyTorch 2.4.1, CUDA 12.4) for old recipes |
| Runtime assets | `tools/xgrids-lcc2/`, `tools/xgrids-xbag/`, `packages/web/src/components/scene/` | Frames/units, manifests, resource disposal, streaming and measured delivery |
| Grand Hall model | [Note](grand-hall-model.md), `packages/web/src/components/grand-hall/`, [survey build](../../tools/grand-hall-survey/README.md) | Survey files are rebuilt from the scan, not hand-edited; one frame for relief and photographs; public splat hold |
| Live co-editing | [Note](live-coediting.md), `packages/web/src/lib/layout-live/`, `packages/api/src/ws/layout-live.ts` | The batch save's revision compare-and-swap is the only writer; live ops are never stored; owner and venue floor only; one API replica |
| Planner rendering | [Note](planner-rendering.md), `PlannerRenderPipeline`, `lib/render-quality.ts`, `scripts/planner-tour.mjs` | One profile per device, resolution independent of motion; no shader compiled during a gesture; measure on the declared scene and device |
| Planner figures (capacity, rigging, power, egress, costs) | [Note](planner-honest-numbers.md), `lib/planner-truth.ts`, `lib/unrecorded-ask.ts`, `hooks/use-planner-truth.ts` | A figure shows who stated it and when; computed counts and example rates are staff-only; facts nobody recorded read "Not recorded" with a person to ask; no within/fits/pass verdict on a safety question (guarded in `public-claim-guard.test.ts` and `banned-verdicts.test.tsx`) |
| Hallkeeper sheet on paper | [Note](paper-version-check.md), `services/hallkeeper-pdf-v2.ts`, `services/sheet-paper-check.ts`, `pages/SheetCheckPage.tsx` | The version line in words; the public check returns version state only, the same `unknown` for every wrong link, and is rate-limited |
| Crafted furniture | [Note](crafted-furniture.md), `packages/web/src/components/meshes/crafted/`, `/dev/furniture` | Catalogue footprints and chair clearance; batchable geometry and named materials; catalogue mesh and preview URLs stay as seeded |
| Build and tests | [root scripts](../../package.json), [CI](../../.github/workflows/ci.yml), package scripts/configs | Same commands locally and in CI; resource contention; no production fixtures |
| Product requirements | [current goals](../../GOAL.md), [domain authority map](../strategy/authority-map.md), [ADR index](../architecture/adr/README.md) | Current user direction and evidence supersede dated summaries |

Inspect the actual entry points and callers. Filenames, comments and old audit
grades are leads, not guarantees about current behavior.

## Run the relevant checks

Use the Node/pnpm versions declared in [package.json](../../package.json) and the
lockfile. Install with `pnpm install --frozen-lockfile` only in a checkout whose
dependencies you own. Do not install through junctions into another task's modules.

| Purpose | Command |
| --- | --- |
| Dependency advisories | `pnpm audit --audit-level=moderate` |
| Web development | `pnpm --filter @omnitwin/web dev` |
| Focused web regression | `pnpm --filter @omnitwin/web exec vitest run src/path/to/example.test.tsx` (replace with the actual test) |
| Web source and E2E types | `pnpm --filter @omnitwin/web typecheck` |
| Web lint | `pnpm --filter @omnitwin/web lint` |
| API unit/route tests | `pnpm --filter @omnitwin/api test` |
| Workspace tests | `pnpm test` |
| Shared-contract impact | `pnpm typecheck`, `pnpm lint`, `pnpm build` as affected |
| Browser flow | `pnpm --filter @omnitwin/web e2e -- path/to/actual.spec.ts` |
| Capture bytes for the planner resolve specs (once per machine; the specs never download) | `pnpm --filter @omnitwin/web e2e:stage-captures` |
| Diff hygiene | `git diff --check -- <changed paths>` |

Package scripts are authoritative if these examples drift. Keep test commands
targeted while iterating, then run the broader checks required by the impact.
For dependency changes, check advisories before expensive suites, verify fixed
versions against upstream code when metadata conflicts, and inspect prebundled
copies in shipped artifacts. A lockfile override cannot rewrite an embedded
dependency. Keep version-specific patches reproducible and covered by behavior
tests; prefer a compatible upstream release when it actually contains the fix.
An API integration test must explicitly point to an isolated local database;
inspect its configuration before running it. An environment file is not evidence
that the target is safe for destructive fixtures.

### Database concurrency regressions

`packages/api/src/__tests__/route-atomicity-postgres.test.ts` exercises actual
PostgreSQL row locks, competing requests and rollback through the route handlers.
It intentionally accepts only its loopback test database and never reads
`DATABASE_URL`. The CI Test job provisions the same disposable PostgreSQL 16 target.

For local Docker verification (development-only credentials):

```powershell
docker run --rm --name venviewer-route-tests -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=venviewer_route_atomicity_test -p 127.0.0.1:55476:5432 -d postgres:16
docker exec venviewer-route-tests pg_isready -U postgres -d venviewer_route_atomicity_test
$env:VENVIEWER_ROUTE_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test'
pnpm --filter @omnitwin/api exec vitest run src/__tests__/route-atomicity-postgres.test.ts
Remove-Item Env:VENVIEWER_ROUTE_TEST_DATABASE_URL
docker stop venviewer-route-tests
```

Wait for `pg_isready` to succeed before the test command. Stop only the container
you started. Without Docker, a dedicated portable PostgreSQL instance can serve
the same explicit target. The fixture uses a fresh schema and minimal tables; it
does not replace full migration or Neon transport qualification.

## Questions that catch consequential defects

- Does authorization hold on the actual write, after another request may have
  changed the record? A precheck outside a transaction is not a concurrency guard.
- Are dependent writes committed together? Is an aggregate recomputed from data
  protected by the same lock/transaction as the mutation?
- Can a late response or error for record A overwrite record B, clear its loading
  state or enable an action with mismatched data? Bind results and actions to the
  selected identity, including selection changes during in-flight mutations.
- Does a test detect the failure it claims to cover? Prefer executed behavior over
  source-text assertions for ownership, money, locking and state transitions.
- Does an optimization preserve fidelity, accessibility and correctness under the
  intended workload? Measure costs before adding a framework or custom machinery.
- Can a fresh checkout run the same checks? Verify generated prerequisites,
  working directory, port selection, environment and dependency ownership.

Use these questions where applicable; no specialist role or mandatory checklist
report is needed.

## Technical notes — load when relevant

These notes preserve learned failures. Recheck version-specific explanations and
assumptions against today's source; a historical failure is not a permanent limit
on future experiments.

| When working on… | Reference |
| --- | --- |
| Loading, saving or other visible work | [Activity convention](../../.claude/conventions/loading-and-working-motion.md) |
| Visible composition or interaction | [Product experience](../../.claude/conventions/product-experience.md) |
| What AI assistants and search engines may read (`/mcp`, schema.org) | [Public venue discovery](public-venue-discovery.md) |
| Claude provider, typed event briefs or their eval | [AI event briefs](ai-event-briefs.md) |
| What AI calls cost, the usage ledger, a venue's AI allowance, who may spend it | [AI usage and billing](ai-usage-and-billing.md) |
| Martyn's Law or other legal prompts | [No-claims rule and sources](martyns-law-readiness.md) |
| Splat renderer choice/lifecycle | [Native Three.js splats](native-splats.md) |
| Venue weather (sky) feed, Met Office sources | [Venue sky](venue-sky.md) |
| Updating the native splat addon patch | [Maintained dependency patch](../../patches/README.md) |
| Loader callbacks and rerenders | [Callback ownership](../../.claude/gotchas/spark-splat-layer-callback-identity.md) |
| Camera bounds, poses or capture stills | [Camera and capture evidence](../../.claude/gotchas/splat-camera-and-capture.md) |
| Camera resetting after updates | [Pose identity](../../.claude/gotchas/interior-camera-pose-identity.md) |
| Staging hidden splat layers | [Visibility and sorting](../../.claude/gotchas/spark-invisible-splat-load.md) |
| Shadows, probes or postprocessing | [Render-target interactions](../../.claude/gotchas/spark-render-target-effects.md) |
| Blank splats in a browser tool | [Browser instrumentation](../../.claude/gotchas/browser-pane-splat-streaming.md) |
| XGRIDS level counts/budgets | [LOD level copies](../../.claude/gotchas/xgrids-lcc2-lod-levels-are-copies.md) |
| V8 memory or test contention | [Windows/V8 notes](../../.claude/gotchas/windows-v8-heap.md) |
| Zod input/output inference | [Passthrough inference](../../.claude/gotchas/zod-passthrough-inference.md) |
| Docker build arguments | [ARG scope](../../.claude/gotchas/dockerfile-arg-scope.md) |
| Deploying the API or adding a migration | [Deploy ordering](deploy-ordering.md) |
| Supplier passes, the supplier's page or their acknowledgements | [Supplier passes](supplier-passes.md) |
| Windows pycolmap/database work | [pycolmap traps](../../.claude/gotchas/pycolmap-windows-traps.md) |

The existing directories are retained for stable references. Vendored design
skills are listed in [the skills README](../../.claude/skills/README.md); use only
relevant skills supported by the current host.

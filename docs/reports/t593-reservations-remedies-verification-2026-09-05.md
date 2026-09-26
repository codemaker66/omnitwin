# T-593: event reservations and admin-approved remedy requests

> Brought into master on 2026-09-26 from `codex/inventory-reservations-and-remedies` (T-635 branch recovery).
> The code it verifies reached master as `5376a4bc`. Its migration 0065 is `0066_inventory_reservations` in master.

Local functional scope complete at implementation commit `e6bc73e63ee5549c2c1f4a7b9a564ca20ac24652` (47 files, 3,456 insertions and 26 deletions). This report records the local implementation and its evidence; it does not certify production, aesthetic acceptance or physical-device performance.

## Scope and source

Blake requested connected event reservations, shortages and admin-approved remedies, explicitly leaving the wider sublime redesign and physical-device targets open. Work is isolated on `codex/inventory-reservations-and-remedies` in `D:/claude/venviewer-inventory-admin-20260905`, starting at `5234d685` (T-591 implementation `bdc15bc3`). No deployment or production stock changes are part of this slice.

Approved demand is an explicit venue-admin decision over verified frozen layout objects containing catalogue UUIDs. Freezing a layout is not itself inventory approval. Each room allocates its peak quantity for each item across the full recorded booking/phase footprint. Consecutive layouts reuse that allocation; simultaneous rooms add together. The admin must explicitly confirm that the displayed footprint covers equipment setup through return. Observation windows never clip the approved allocation.

Known room-flip transitions carry the allocation, as does explicit terminal breakdown. Missing or unscoped timings, invalid winning snapshots, unmapped implied accessories, unlinked ink bookings and contradictory lifecycle states stay visible as incomplete evidence. The projection does not match furniture by display name, infer chair counts from guest counts, fall back to an older invalidated source, or interpret missing stock as zero.

Cancellation of the authoritative booking removes its active demand. A cancelled event with a still-active ink booking is a contradiction requiring review; it does not silently free a previously approved allocation. Changed timings or source facts leave the old immutable release in history and require a new approval. Revocation and replacement append records.

## Delivered behavior

- Dated assessment reports usable stock, signed remaining quantities, shortage intervals and affected events. Proposal review includes the full occupied window, including competing allocations outside the narrower observation window.
- Own-venue administrators approve and revoke exact reservations. Other roles, other venues and platform-only authority cannot use these endpoints.
- Hire and inspection remedies preserve their quantities, windows, affected releases, stock revision, shortage evidence and missing facts. Preparation and approval are separate actions. Another authorised administrator at the same venue may approve the packet, retaining both identities.
- Approval creates an internal request. Supplier price, availability and delivery feasibility or recoverable stock remain to be established. A request does not count as confirmed hired supply or change physical stock.
- Commands bind actor, operation and normalised input. An exact retry returns the original result; a changed identity cannot execute another action. Stale evidence requires fresh review. Uncertain browser actions retain their exact commands across close/reopen/reload.
- Reservation and command history have database mutation guards. Stock writes and decision writes coordinate through the venue row and a real row-version write that leaves visible venue metadata unchanged.
- The inventory list truthfully states that a dated assessment is required, replacing the old `RESERVATIONS_NOT_CONNECTED` response.

## Verification

Evidence directory: `D:/claude/venviewer-reservations-evidence-20260905/`.

| Check | Current evidence |
|---|---|
| Existing local database migration | Migration 0065 applied successfully; `migration.log` |
| Clean database migration | Full journal applied to a new isolated browser database; `browser-database-migration.log` |
| Shared types | 98 files, 2,201 tests passed; `types-final.log` |
| Real PostgreSQL | 18 new reservation cases plus 9 stock cases passed; `postgres-verified.log` |
| Focused API | 45 tests passed; API agent additionally verified build, typecheck and changed-file lint |
| Full API suite | 160 files passed, 3 skipped; 2,807 tests passed, 49 skipped; `api-final.log` |
| Full web suite | 394 files; 5,201 tests passed, 18 skipped; `web-final.log` |
| Focused web | 67 inventory and shared-activity tests passed; final shared indicator update also passed 4 tests |
| Production web build | Passed in 39.89 seconds with production auth guard active; `production-build.log` |
| Typecheck and lint | API/types build and typecheck, web and E2E typecheck, changed-file lint passed; final harness checks in `root-e2e-lint-paced.log` and `e2e-typecheck-paced.log` |
| Browser journey | All 9 tests passed together in 2.1 minutes; `browser-paced-final.log` |
| Independent review | Backend, frontend integration and final rendered legibility GO; aesthetic acceptance explicitly excluded |

The browser run covers six functional workflows and three viewports (1600×1000, 1024×1366 and 390×844). It verifies lost-response recovery after server execution, another admin's intervening approval, stale rejection, honest stock correction, signed shortages, no horizontal overflow, keyboard opening, focus inside review after Tab, and Escape restoring opener focus. Reduced motion was emulated; physical hardware and frame timing were not measured. No uncaught browser errors occurred. Root and the independent UI reviewer inspected all six demand/review captures. This is functional legibility evidence, not acceptance of the design.

All 46 changed application/test source files have identical before/after SHA-256 values in `browser-source-before.json` and `browser-source-after.json`. The production build used the same application source; only the browser test harness changed afterwards. The build retains a pre-existing CSS brace warning requiring shared-style cleanup.

The PostgreSQL tests use the real Neon WebSocket driver through the repository's local bridge and the real Fastify routes. Authentication uses the repository's test-mode identity fixture; this is not production Clerk qualification. Browser data lives in a separate freshly migrated database so generated test catalogue entries do not pollute the visible fixture.

The fixture has two overlapping events: 120 chairs in one room and 70 in another, against 200 owned and 20 damaged. The first room has two consecutive layouts of 120 chairs, so its allocation stays 120. The expected combined shortage is 10. Fixtures and users are clearly labelled local; this is not a Trades Hall stock census.

### Failures found and corrected

The strongest new regression caught a real mixed-isolation race. A stock request held the venue lock while its stock update was deliberately paused in PostgreSQL. A reservation approval was confirmed waiting on that lock. After the correction committed, the approval originally succeeded using the old count and stock revision. `stock-race-red.log` preserves that failure. Both mutation paths now create a venue row version while leaving its timestamp value unchanged. The same controlled probe passes in `stock-race-green.log`: the decision retries against current facts and returns a stale-assessment conflict without inserting a reservation.

Other corrections include full-footprint historical rejection, phase/snapshot identity binding, stable source digests, selecting relevant history before applying density limits, competing demand outside an observation window, another-admin remedy approval, approved-request participation in subsequent decision digests, and readable immutable request evidence when current assessment exceeds safe limits.

The first comprehensive database run had two assertion mismatches: the old inventory metadata expectation and an expected 409 for the deliberate 400 historical-unsupported response. Both expectations now match the documented API, and all 27 cases pass. An initial seed attempt omitted an explicit validation-run UUID; the corrected seeder supplies it and uses an atomic transaction.

Browser setup initially used the incorrect singular `CORS_ORIGIN` environment variable; the API expects `CORS_ORIGINS`. Correcting the local server configuration restored browser access without application changes. The next run passed five workflows, then exposed a test synchronization error: the recovery test observed a still-disabled close button before the deliberately interrupted request had finished. The test now waits for the explicit uncertain-result state. That attempt's database and manifest were preserved; a fresh migrated database was seeded for the final run.

All six functional workflows subsequently passed, as did the desktop check, before the rapid serial run reached the existing 100-request/minute API quota on the tablet test. The three viewport checks then passed together after the window reset (`browser-viewports-final.log`). The harness now observes actual rate-limit response headers before each workflow and waits for the server's reset when fewer than 50 requests remain. It never retries mutations automatically, changes the limit, or fabricates a successful API response. The final paced run uses another fresh fixture; earlier databases retain their immutable history.

## Local reproduction

Use the checked-in opt-in PostgreSQL tests with `VENVIEWER_INVENTORY_TEST_DATABASE_URL` pointing to the disposable loopback `venviewer_inventory_` database on port 54329. The guard rejects other hosts/ports. The repository bridge is `infra/dev-db/neon-ws-bridge.mjs`, WebSocket 54331 → PostgreSQL 54329.

`packages/api/src/scripts/seed-inventory-reservations-local.ts` permits only the two named local databases for this run and writes a manifest. It inserts fresh UUIDs, never deletes data or bypasses immutable-history triggers. The checked-in browser test consumes that manifest through `INVENTORY_RESERVATIONS_FIXTURE`, with `INVENTORY_LIVE_API_URL` on loopback and `INVENTORY_RESERVATIONS_EVIDENCE` for captures.

For the real browser run, start the API in test mode against the dedicated database on port 4385 with `CORS_ORIGINS=http://127.0.0.1:4384`; start Vite on port 4384 with `VITE_API_URL=http://127.0.0.1:4385`. Set `E2E_BASE_URL=http://127.0.0.1:4384`, `E2E_START_SERVER=false` and the fixture/evidence variables above, then run `pnpm --filter @omnitwin/web exec playwright test e2e/venue-inventory-reservations-live.spec.ts --workers=1 --reporter=line`. Use fresh fixture data for the six stateful workflows; do not rerun them over already-approved records.

Root-owned API, Vite, Neon bridge and PostgreSQL services were stopped after verification. Databases and evidence remain on disk. No merge, push, deployment or production data write occurred.

## Presentation and remaining qualification

T-591's inventory design remains rejected by Blake. This functional integration does not accept that design or close the all-surface sublime rebuild. The supplied T-594 shared Activity component, CSS, tests and loading convention were carried from the parallel main-workspace task; it provides lifecycle-bound particle motion with reduced-motion support. It does not make the larger interface aesthetically approved.

Historical stock/source reconstruction, accessory identity mapping, confirmed procurement workflows, production migration/auth qualification, broader sublime design and physical iPhone/iPad/office-computer loading/frame-rate/PSNR evidence remain open. Viewport emulation and local test results must not be described as physical-device 60 fps or captured-room PSNR 50+ evidence.

Assessments are limited to 31 days and enforce source-density limits; oversized or incomplete evidence is not presented as an all-clear. Reservation history currently reads the latest 100 records while older immutable records remain stored. Approving an internal request does not procure equipment, revise released instructions or complete goal 05/S7 as a whole.

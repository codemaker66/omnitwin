# T-591 — venue-admin inventory, local integration evidence

> Brought into master on 2026-09-26 from `codex/venue-inventory-admin` (T-635 branch recovery). The code it
> verifies reached master as `a39df9a7` and `ff754a8d`. Its migration `0064_venue_inventory` is
> `0065_venue_inventory` in master, and "all 63 journal entries through 0064" describes the branch's journal.

Date: 2026-09-05. Product: Venviewer. Implementation commit: `bdc15bc3` on `codex/venue-inventory-admin`, worktree `D:/claude/venviewer-inventory-admin-20260905`. Base: `150e9d3d`; inventory domain foundation cherry-picked as `63e3b45b`. This report documents the tested source in that implementation commit.

## Delivered behavior

A venue administrator can open `/dashboard?view=inventory`, search the existing furniture/equipment catalogue, record previously unknown stock, and correct owned, damaged and other-unavailable quantities, storage location and active/retired status. Each correction requires a reason and returns a server-authored before/after receipt. The latest 20 changes are available in the adjustment sheet. Stored hire windows are preserved by count edits; a hire-management interface is a later slice.

Unknown stock is represented by `null`, visibly “Not recorded”; zero is an explicitly recorded count. A correction is never clamped to booked demand. Booking availability is explicitly unavailable because reservations are not yet connected. This slice therefore does not claim to identify affected events, resolve shortages, or release revised hallkeeper instructions.

The new surface uses the supplied sublime references and the generated Presence composition as engineering inputs: warm charcoal, ivory type, muted sage actions, a spacious ledger, and a focused adjustment sheet. The founder has not selected a new aesthetic direction. Existing surrounding dashboard chrome is still present; this is the first implemented inventory surface, not completion of the all-surface rebuild or a claim that the aesthetic of the sublime has been achieved.

## Persistence and authority

- Migration `0064_venue_inventory` adds venue stock and adjustment receipts. A venue/item identifies stock; a venue/command identifies an idempotent write; a venue/item/revision uniquely identifies a historical adjustment.
- `GET /venues/:venueId/inventory`, `POST /venues/:venueId/inventory/:assetDefinitionId/adjustments`, and `GET /venues/:venueId/inventory/:assetDefinitionId/history` require the venue's own administrator. Platform authority alone does not grant stock-management permission.
- The write service locks the venue row, checks command identity and stock revision, and writes stock plus receipt in one PostgreSQL transaction. This serializes infrequent corrections within a venue, including first-record and cross-item command collisions. It is not a measured high-volume throughput claim.
- Actor and recording time come from the server. Zod validates inputs and outputs; PostgreSQL constrains count bounds, status, storage, stock identity and receipt identity. UUIDs are canonicalized to lowercase so PostgreSQL normalization cannot break a retry.
- A stale revision returns the latest stock and requires explicit review. The form preserves intentional edits and adopts concurrent changes to untouched fields only when the administrator chooses to review against the latest record.
- A response lost after commit retains the original command in actor/venue/item-scoped session storage, with an in-memory fallback. The administrator can close the sheet and retry that same command after reopening. A replay returns the original receipt and current stock; it cannot create a second correction or roll back a newer one. The UI adapter times out an unresponsive request after 30 seconds without pretending it was cancelled on the server.

## Actual local integration

A new PostgreSQL 16 cluster was initialized under `D:/claude/venviewer-inventory-db-20260905/data`, bound to loopback port 54329. Its database is `venviewer_inventory_20260905`. The existing repository Neon websocket bridge on port 54331 connects the real production database driver to this local cluster. All 63 journal entries through 0064 migrated successfully. No production connection string or production inventory was used.

The browser exercised the real Fastify server on port 4385 and Vite on port 4384. Identity used the repository's explicit development/E2E identity mechanism with `NODE_ENV=test`; this proves route authority behavior, not live Clerk token issuance or production deployment configuration. Inventory responses were not mocked. One test deliberately forwards a write to the real server and aborts its response afterward to reproduce an ambiguous network outcome.

Browser data is an explicitly named local fixture, not a representation of verified Trades Hall stock: two venues, two administrators, a chair, a table and a projector. The checked-in `packages/web/e2e/venue-inventory-live-fixture.sql` refuses any database except the named isolated fixture database and resets only its two fixture venues' stock/receipts. The opt-in PostgreSQL suite uses fresh UUIDs and cleans its own rows; its injected receipt-failure trigger was removed after the test.

## Verification and review

| Evidence | Result |
|---|---|
| Shared types full suite | 97 files, 2,193 tests passed; 64.19 seconds |
| Real PostgreSQL inventory suite | 9/9 passed: persistence, concurrent create/update, canonical retries, collision/stale cases, database constraints and rollback when receipt insertion fails |
| Focused UI, adapter, roles and focus hook | 89 tests across 5 files passed before presentation-only AV capitalization; final broad results below |
| Initial complete browser path | 8/8 passed, 28.9 seconds |
| Strengthened browser path | 8/8 passed, 17.0 seconds; includes saved-state history focus, nested disclosure keyboard behavior, forward/backward wrapping and explicit role-denied rendering |
| Migration readiness and lineage regressions | 20/20 passed after the two broad-suite failures and independent-review correction |
| Final viewport captures | 3/3 passed, 9.5 seconds; settled opaque sheets, nested keyboard checks, reduced-motion phone viewport |
| Final full web suite | 388 files passed; 5,158 tests passed, 18 skipped; 219.18 seconds |
| Web type checking and changed-file ESLint | Passed, including E2E TypeScript |
| Production web build | Passed, 33.93 seconds, 3,394 modules; genuine production mode, verified public live Clerk key, E2E bypass false, Sentry upload disabled |
| Final full API suite | 158 files passed, 2 skipped; 2,793 tests passed, 31 skipped; 418.73 seconds |
| Final API type checking, build and changed-file ESLint | Passed, exit 0 each |

Browser scenarios prove explicit zero versus unknown, stock persistence across a fresh page load, readable audit changes, concurrent-update review, a committed write with a lost response retried without another revision, venue isolation, platform-only denial, and the usable ledger/editor at desktop 1600×1000, tablet 1024×1366 and phone 390×844. The phone case enables reduced motion. Viewport emulation is not a physical iPhone/iPad or Safari performance measurement. The three viewport cases collect page errors and check horizontal overflow.

Independent review identified and closed three substantive defects before acceptance: canonical UUID handling on retries; omitted native disclosure summaries in the shared focus trap; and inaccurate migration-object discovery for unquoted SQL. For the last, broad tests also exposed two historical tests that incorrectly assumed 0063 would remain the newest migration. Readiness discovery now recognizes the new DDL while excluding comment text and constraint-trigger syntax. The reviewer reran actual extractor probes against migrations 0014, 0053, 0063 and 0064. Applied migration SQL and hashes were not rewritten to satisfy a test.

The first broad API run finished with 2 failures, 2,787 passed and 31 skipped in 477.36 seconds. Both failures were migration expectations described above; the focused corrected tests passed. That failed run is retained, not represented as a pass. The final complete run passed 2,793 tests with 31 skipped. Those skips include the opt-in real PostgreSQL tests, which passed separately against the isolated database.

## Visual evidence

Concept: `D:/claude/venviewer-inventory-study-20260905/inventory-desktop-concept.png`, SHA-256 `14A775E7073A670B89738F371B8D100EDAD9EA5B66ABD13243C0137452E14C6E`. This generated image is a design input with fictional sample data, not an application capture or a room-fidelity reference.

Actual browser artifacts and logs are under `D:/claude/venviewer-inventory-evidence-20260905/`. Earlier full-page modal screenshots were unsuitable for judging the fixed sheet: keyboard navigation scrolled the sheet, and the page could be captured during its 200 ms entrance. Final captures wait for the animation to finish, assert opacity 1 and the solid background color, reset the sheet scroll, and capture the viewport. Ledger captures retain the full page. Root and the UI agent inspect the final screenshots before closure.

## Reproduce the browser fixture

Use a disposable local PostgreSQL database with the exact name `venviewer_inventory_20260905`, listening on loopback port 54329. Apply migrations using the API's existing `db:migrate` command with `DATABASE_URL` explicitly set to that local database. Run `node infra/dev-db/neon-ws-bridge.mjs`; the existing helper fixes its websocket port at 54331 and PostgreSQL destination at 127.0.0.1:54329. Seed with the checked-in fixture SQL through `psql -v ON_ERROR_STOP=1`.

Start the API with `NODE_ENV=test`, the local `DATABASE_URL`, `PORT=4385`, `CORS_ORIGINS=http://127.0.0.1:4384` and a non-production test Clerk configuration. Start Vite with `VITE_API_URL=http://127.0.0.1:4385` on loopback port 4384. No source changes are allowed while a browser run is active on this checkout.

```powershell
$env:INVENTORY_LIVE_API_URL = 'http://127.0.0.1:4385'
$env:E2E_BASE_URL = 'http://127.0.0.1:4384'
$env:E2E_START_SERVER = 'false'
pnpm --filter @omnitwin/web exec playwright test e2e/venue-inventory-live.spec.ts --workers=1 --reporter=line
```

The test skips unless `INVENTORY_LIVE_API_URL` is an explicit loopback HTTP URL. Reset the named fixture before repeating the complete serial suite, because its first scenario deliberately requires an unrecorded table. The separate transaction suite opts in with `VENVIEWER_INVENTORY_TEST_DATABASE_URL` and rejects a non-local or incorrectly named database.

## Remaining and next slice

Production rollout and live identity qualification remain. Next inventory work is to connect released event demand and its setup/movement/live/breakdown windows to the existing domain calculations, show the four distinct quantities for a selected period, and present affected events plus feasible remedies for venue-admin approval. An inventory correction must preserve previously released instructions. Hire-window editing, large-catalogue performance, named audit actors for other admins, and physical-device validation remain separate acceptance items. The editor scrolls normally at short heights; its Save control partly falls below the initial 1,000-pixel-high desktop viewport. A persistent action footer is a recorded usability improvement for the next visual pass, not represented as already implemented.

T-590/V2 court remains Claude-owned. T-581 planner delivery remains on its isolated branch. No Saturday planner push, production migration, production inventory mutation or deployment was performed for this inventory slice. The broader room-quality, PSNR 50+, 60 fps, all-surface design rebuild and full operations goals remain open.

## Closure

Root and the UI agent inspected the final rendered desktop/tablet/phone captures; the sheet is opaque, content does not collide, labels and counts are readable, and no horizontal overflow was found. The screenshot manifest records file hashes at `D:/claude/venviewer-inventory-evidence-20260905/visual-manifest.json`.

The production build retains the previously observed unmatched `@media (max-width: 640px)` CSS warning outside the inventory stylesheet and an expected outside-root output-directory notice. Neither is described as fixed by this work. The browser integration uses development identity; building production assets is not a production sign-in test.

The owned API, Vite and Neon bridge processes were stopped after browser acceptance. PostgreSQL shut down cleanly with `pg_ctl -m fast -w stop`. Ports 4384, 4385, 54329 and 54331 no longer have listeners. The failed Docker Desktop startup attempted earlier in this turn and its error dialog were also closed, using their verified process ancestry. The isolated database files, build and screenshot evidence remain on disk. No test browser was left running.

The local inventory slice is complete at implementation commit `bdc15bc3`: all listed acceptance checks passed and independent review found no remaining material issue within this scope. The 33-file implementation commit contains 1,817 insertions and 16 deletions, including tests and the reproducible SQL fixture. This report is committed separately so its source identifier stays exact. The shared goals board and task/session ledger record closure and the next dependency. The branch has not been merged or pushed, and no production deployment is implied.

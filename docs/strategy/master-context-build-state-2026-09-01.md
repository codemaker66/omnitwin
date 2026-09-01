# Master context brief — build-state sections rewritten from repo reality

**Date:** 2026-09-01 · **Status:** replaces §3 (room list), §33, §34 and annotates §35 of the ChatGPT-authored "Venviewer / OmniTwin — Master Project Context, Scope and Ambition" brief · **Authority:** evidence-only; every claim carries a path:line or URL from the 2026-09-01 seven-domain audit and the reconciliation drafts (see the evidence index at the foot)

The ambition sections of the brief (§1–§2, §4–§32, §36–§41) are not touched
here and remain the north star. This document exists because the brief's
build-state sections were stale in both directions: it described as missing a
commercial and operational spine that is largely built and partly in
production, and described as real several things that exist only as vocabulary
(a rights ledger, eight roles, an AI layout generator, a layered runtime,
Grand Assembly as a mode). The July gap audit (`docs/plan/06-GAP-AUDIT.md:9`)
had already made the same finding; the brief did not absorb it.

Rule for future editors: regenerate these sections from the repo and the
ledger, never from memory, and keep the five tiers the brief's own §0 demands.

## §3 — the captured spaces (corrected)

The captured spaces relevant to Venviewer are the eight rooms staged and served at venviewer.com/room/:slug (packages/web/src/router.tsx:531; generated manifest packages/web/src/data/generated/trades-hall-splat-bundles.ts roomSlug entries at :75, :294, :408, :627, :804, :925, :1067, :1202):

Grand Hall (published 21 x 10 x 7 m + 7 m dome, packages/web/src/lib/trades-hall-venue-truth.ts:63; capture GH_2, alignment "review", derived 13.8 x 22.3 x 12.9 m, manifest :290-291); Saloon ("review", 97% retention but disagrees with published 12 x 7 m, docs/handoffs/SPLAT-ALIGNMENT-STATUS.md:43); Robert Adam Room ("review", 49% retention, whole-floor scan, :49); Reception Room ("confident", 96%, :44; the only room with a DB-registered runtime package, docs/operations/reception-room-runtime-qa-record-2026-06-15.md:19-21); Lady Convenor's Room ("review", 70%, :47; slug keeps the "-or" spelling deliberately, packages/types/src/asset-version.ts:318-321); North Gallery ("review", 87%, :45); South Gallery ("review", 68%, :48); Deacon Convener's Room ("confident", 99%, clean single-room scan, :42; slug deacon-conveners-room, asset-version.ts:322-335) — omitted from the previous list; it is captured, staged and public.

Entrances, corridors, stairs and the foyer have no room representation anywhere in the type layer: no room enum entry in packages/types/src/asset-version.ts:235-352 (eight entries), no manifest entry, and the only mention of stairs in @omnitwin/types is the review-gate reason "historic_stair_or_protected_door" (packages/types/src/review-gate.ts:7). Flow, egress and arrival through those spaces therefore cannot be modelled from data today; the handheld captures do include corridor/stairwell bleed, which is exactly why six rooms sit at alignment "review" (SPLAT-ALIGNMENT-STATUS.md:33-38).

## §33

## 33. Current Known Build State (rewritten from repo reality, 2026-09-01)

Repository: C:\Users\blake\omnitwin2, branch master = origin/master at 4822414d (git branch -vv, 2026-09-01). 37 local branches are unmerged into master, 35 with no upstream (git branch --no-merged master / -vv, 2026-09-01); codex/grand-hall-exact-runtime is 81 ahead / 113 behind master (git rev-list --left-right --count), tip 4f5b62c9 "feat(foundry): recover XGRIDS camera calibration" (T-566, 2026-09-01), no upstream, checked out in worktree C:/Users/blake/omnitwin2-grand-hall-exact-runtime. The main tree carries 10 untracked paths including tools/foundry-room-shape/ and docs/reports/repo-consolidation-2026-08-08.md (git status).

### Tier 1 — Current verified capability (live in production, with probe)
- All eight rooms are public walkthroughs at venviewer.com/room/:slug (router.tsx:531; manifest roomSlug entries trades-hall-splat-bundles.ts:75-1202). Web deploys on every push to master via Vercel without waiting for CI (docs/operations/diary-deploy-checklist.md:37; packages/web/vercel.json).
- Homepage "/" is RoomsHomePage: room cards, "Walk the room" and a summed splat headline (router.tsx:602-603; packages/web/src/pages/RoomsHomePage.tsx:134-135, :165, :176). "/" has no enquiry control; the enquiry form is on /fresh (router.tsx:266) posting to POST /public/enquiries.
- The Diary is live: /ws/diary upgrade returns 101 on Railway, /calendar and /bookings answer 401 (auth wall), /diary and /hallkeeper/today return 200 (curl probes 2026-09-01 recorded in the audit digest, diary domain). Production migration ledger: 0001-0061 applied 2026-07-20 (diary-deploy-checklist.md:30).
- Production API /health/version reports gitSha 154c6894, builtAt 2026-07-25 (curl https://api.venviewer.com/health/version, 2026-09-01), yet POST /public/quiz-runs (migration 0062, 18 Aug) answers 400 — an API deploy happened after 18 Aug without re-stamping BUILD_GIT_SHA (docs/sessions/2026-08-18.md:25-26 records "Not yet deployed: Blake runs pnpm db:migrate then railway up"). The checklist's "gitSha match is conclusive" (diary-deploy-checklist.md:31) is currently false.
- 3D planner core on /plan: catalogue placement, snapping, AABB collision, table+chair grouping, 100-entry invertible undo (T-447, docs/state/tasks.md:208), Room Resolves (T-498, :96), Stage S1 staged capture mounted in the planner (T-559, :224), Stage S2 tool pill / clearance rings / spring settle (T-562, :227). Web suite 4,706 passing (docs/sessions/2026-09-01.md:42). Live behaviour on production hardware is by inspection only; T-560 GL teleport wedge is open on dev-class GPUs (tasks.md:225).
- Claim guard on public copy (T-083, tasks.md:215; packages/web/src/__tests__/public-claim-guard.test.ts).

### Tier 2 — Designed or partially implemented (exists, depth unverified or not in production)
Real asset context:
- 8 of 8 rooms processed (XGRIDS LCC2), staged and rendering (docs/handoffs/SPLAT-ALIGNMENT-STATUS.md:13). Tile bytes (~1 GB) live on D: and R2, not in git (:26-27).
- Alignment confidence: confident 2 of 8 (deacon-conveners-room 99%, reception-room 96%); review 6 of 8 (saloon 97% but disagrees with published dims, north-gallery 87%, grand-hall 73%, lady-convenors-room 70%, south-gallery 68%, robert-adam-room 49% whole-floor scan) (:40-49). Grand Hall derived extent 13.8 x 22.3 x 12.9 m vs published 21 x 10 x 7 m (manifest :290-291). Fix path is a per-room roomCropM owned by Codex (:66-70); the walk-derived frame is 5% off for the Grand Hall vs 85% from the mesh (:211).
- All-LOD-levels render defect: RoomSplatScene.tsx:152 mounts every tile URL as its own SparkSplatLayer in one commit, so all five LCC2 levels render at once — 11,487,038 Grand Hall splats where the finest level is 6,019,684 == pointCloudQuantity in D:/GRAND_HALL_BIG_MODEL_VARIATIONS/scans_BIG_MODEL_TH_GH_2/lcc2-result/info/report.json. SparkSplatLayer.tsx:90-95 passes no lod option; room-splat-bundles.ts:48 documents a "coarsest first" load order that the one-commit mount ignores; the homepage headline sums totalSplats across all levels (RoomsHomePage.tsx:134-135). Cutaway is a RoomClipBox at keepHeightFraction 1 (RoomSplatScene.tsx:150); collision is an AABB clamp with 0.5 m inset and fixed eye height (packages/web/src/components/rooms/interior-camera.ts:102).
- Runtime-package registry: exactly one DB-registered package — reception-room 71687e9e, status internal_ready, evidence unverified, 2026-06-15 (docs/operations/reception-room-runtime-qa-record-2026-06-15.md:19-21). The public /room route streams from the generated manifest with no registry row or exposure tier; the client-safe showcase endpoint is retired and always returns unavailable (packages/api/src/routes/assets.ts:1884-1893). TRADES_HALL_RUNTIME_ROOMS still says captured_needs_processing / not_registered for every room (packages/types/src/asset-version.ts:235-352); state/capture_log.json still says "raw capture only" for Grand Hall, Saloon, Robert Adam and Deacon (:11, :21, :30, :58); state/asset_versions.json is {"version":1,"assets":[]}.
- Zero training runs ever: state/training_runs.jsonl is 0 bytes (ls -la state/). The trainer is present but non-runnable, exit 78 (docs/reports/omnitwin-foundry-root-investigation.md:118-119). T-001 blocked since April behind the $0.20 smoke test (tasks.md:58), T-003 not-started (:60), T-091 not-started (:255), T-091A has no ledger row (grep "^| T-091A " = 0).
- Codex exact-runtime lane, unmerged and unpushed: T-563 pose lineage, T-564 E57 cubeface extrinsics, T-565 panorama orientation, T-566 XBAG camera calibration all "done" only on that branch's ledger (codex branch docs/state/tasks.md:627-630); T-554-T-558 blocked there (:618-622). The branch never leaves the local disk.
- Run of Show (T-561, tasks.md:226): migration packages/api/drizzle/0063_phase_layout_snapshot_immutability.sql is LOCAL ONLY; GET /calendar/layout-timeline exists in code (packages/api/src/routes/room-layout-timeline.ts:161) and 404s in production. Phase snapshots are proof-chained under advisory lock (routes/phase-layout-snapshots.ts:126-128) but not deployed.
- Production pipeline: API ships only by a manual railway up from a clean worktree (diary-deploy-checklist.md:38, :57-61); deploy.yml's migrate step only runs after CI passes (.github/workflows/deploy.yml:4, :70) and its notify-railway job only echoes (:81-90); docs/RUNBOOK.md:54 still claims Railway watches packages/api (disproven, checklist:8-9). Migration ledger: 0061 in production, 0062 state unrecorded, 0063 local (drizzle dir listing; 2026-08-18.md:25-26).
- Commercial spine: 8 opportunity stages (packages/types/src/commercial-spine.ts:29); 3 conflict kinds (packages/types/src/booking.ts:303-307); quotes v0 with no VAT/discount/deposit (packages/api/src/routes/quotes.ts:129); client approve writes status only, no booking/opportunity side-effect (packages/api/src/routes/proposals.ts:1290); one layoutSnapshot per proposal version, no packages field (packages/types/src/proposal.ts:397); STRIPE_* read by nothing (grep -rl STRIPE_ packages/api/src = 0 files).
- Ops/evidence: ops compiler 1,200 lines (packages/api/src/services/ops-compiler.ts); hallkeeper offline queue with reconnect reconciliation (packages/web/src/pages/HallkeeperPage.tsx:242-244); Evidence Pack hard-codes route clearance "not_checked" (packages/api/src/services/evidence-runtime.ts:246-248); stale_evidence_events has zero writers (schema.ts:1480; only SELECT at evidence-runtime.ts:738); Truth rail renders only when a lens has no panel (packages/web/src/components/editor/cockpit/CockpitRightDock.tsx:77); AI BEO button needs AI_ASSISTANT_* env that no env example sets (OpsHandoffPage.tsx:300; services/ai-assistant.ts:104-109).
- Guest flow: deterministic grid navmesh + A* + seeded agents in a Web Worker off the live layout (packages/web/src/workers/guest-flow-replay.worker.ts; algorithm literal "grid_navmesh_fallback_v0", packages/types/src/guest-flow-replay.ts:637); never persisted as an artifact.
- Platform: Clerk still in development mode (T-470 blocked, tasks.md:75); Sentry blocked on DSN (T-060 :63, T-092 :256); uptime T-061 and backup verification T-062 not-started (:64-65); exposure-tier enforcement T-211/T-212 not-started (:445-446); outbound webhooks stub_only (packages/api/src/services/integration-layer.ts:81-82); five user roles only (packages/types/src/user.ts:19).

Ledger drift facts (docs/state/tasks.md vs everything else):
- T-500 not-started (:219) while docs/strategy/splat-quality-independence.md:3 says it was amended with "T-500 field results" on 2026-07-16.
- T-458 not-started (:195) while the navmesh Web Worker it describes exists (workers/guest-flow-replay.worker.ts).
- T-505 and T-507-T-514 have no rows (grep = 0); T-506 appears once (grep = 1) while docs/plan/omnitwin-foundry-roadmap.md:5 calls T-506 "foundation complete".
- T-555-T-562 are claimed by different tasks on master (:220-227: ingest, Day Board, When ribbon, Command Centre C1, Stage S1, GL wedge, Run of Show, Stage S2) and on codex/grand-hall-exact-runtime (:619-626: Creator Data, bake-off, registration mask, admission gate, E57 lineage, crosswalk, panorama audit, fixed-camera bake-off). Any merge collides.
- T-504 (:587) still says ArtiFixer is Apache-2.0; the model card is NVIDIA non-commercial.
- packages/types/src/asset-version.ts:235-352 and state/capture_log.json describe rooms that are live as unprocessed; admin copy derives from them.
- docs/plan/09-PERSONA-JOURNEY-AUDIT.md (539 lines) exists only in WIP commit 9c98b293 on feature/diary-p0-slice-3, not on master.
- The 2026-08-08 consolidation report counted 12 unmerged branches and prescribed "push every local branch" (docs/reports/repo-consolidation-2026-08-08.md:58); it is itself untracked and the count is now 37.

### Tier 3 — Planned product functionality (docs/cards only)
- Build cards: 2 of 26 delivered (A1 T-494 tasks.md:89, A2 T-498 :96); waves C-F and M unbuilt as cards (docs/plan/cards/wave-C.md … wave-M.md, README).
- Layers tree and Overview/Transform/Style inspector, layout comparison, templates (docs/plan/01-PLANNER-UX-SPEC.md sections 3, 6, 7); Grand Assembly is listed as a future internal system that must not be marketed (docs/architecture/claim-aware-copy-guard.md:28).
- Integrations (contract/e-sign/payment/invoice) T-459 not-started (tasks.md:196); post-event actuals and learning loop T-437 not-started (:184); multi-venue analytics T-462 not-started (:199); feature flags T-066 not-started (:249); Revenue Optimizer T-110 deferred (:333).
- Hold-reminder delivery has a cron recipe only, no scheduler in the repo (docs/operations/diary-first-week-operations.md:87).
- Backup restore drill and uptime monitoring exist as procedures (T-061/T-062, tasks.md:64-65).

### Tier 4 — Long-term research / moonshot
- OmniTwin Foundry (T-486 in-progress, tasks.md:92; docs/plan/omnitwin-foundry-roadmap.md); D-014 and D-024 accepted, D-009 and D-012 still proposed (docs/architecture/adr/D-009.md:3, D-012.md:3, D-014.md:3, D-024.md:3).
- Own-training independence lane: T-501 bridge, T-502 retrain baseline, T-503 DSLR fusion all not-started (tasks.md:296-298); bake-off harness T-022 not-started (:267).
- Grand Hall exact-runtime authority-none programme on the Codex branch (branch tasks.md:618-630).
- Frontier moonshots (Concierge, Total Recall, Event Cinema, Neural Staging …) in docs/plan/08-FRONTIER-MOONSHOTS.md:7-45.

### Tier 5 — Ideas still requiring testing
- Render experiments from the perf audit: finest-level-only tiles (12 tiles, ~107 MB, 6.02M splats), serial level-1-first fetch, minSortIntervalMs 100-200, settledDpr 1, maxSh 0/1, direct R2 with CORS (packages/api/src/scripts/configure-splat-cors.ts), remove RoomClipBox, ?perf=1 baseline, Spark lod:true — all untested (audit perf domain E1-E10).
- Alignment: roomCropM per room then re-measure/re-stage (SPLAT-ALIGNMENT-STATUS.md:66-82); splat-transform decimation T-386 and SuperSplat crop T-388 not-started (tasks.md:273, :275).
- T-504 ArtiFixer spike (tasks.md:587) — licence contradicted; NVIDIA Fixer v2 only as a badged server-side cinematic derivative.
- E57 room-shape proposer returned integrity-verified "unmeasurable" for the Grand Hall (docs/reports/grand-hall-room-shape-proposer-v1-2026-08-04.md:6, untracked).
- Local training on the RTX 4090 (24,564 MiB, nvidia-smi 2026-09-01) with D: as working disk (5,171 GB free; C: 14.3 GB free, Get-PSDrive 2026-09-01) — feasible on paper, never attempted.

## §34

## 34. Critical Near-Term Priorities (re-ordered from evidence, 2026-09-01)

1. Push the backup — NOT STARTED. 37 local branches unmerged, 35 with no upstream (git branch --no-merged master / -vv, 2026-09-01), including codex/grand-hall-exact-runtime at 4f5b62c9 (81 commits, T-563-T-566) which exists only on this disk. The 2026-08-08 plan's zero-risk "push every local branch" step (docs/reports/repo-consolidation-2026-08-08.md:58) was never executed and the report is itself untracked. Zero production risk; do it before anything else.
2. Fix the Grand Hall render — NOT STARTED. RoomSplatScene.tsx:152 mounts all 24 tiles across five complete LOD copies (11,487,038 rendered; finest level 6,019,684 == GH_2 report.json pointCloudQuantity); SparkSplatLayer.tsx:90-95 sets no lod option. First experiment: filter to the finest level plus env, then Spark lod:true; correct the summed headline at RoomsHomePage.tsx:134-135. Human-scale behaviour stays an AABB clamp (interior-camera.ts:102) until a structural proxy exists.
3. Re-stamp and redeploy the API — BLOCKED ON OWNER (Blake runs pnpm db:migrate then railway up: tasks.md:226; docs/sessions/2026-08-18.md:25-26). /health/version reports 154c6894 / 2026-07-25 while POST /public/quiz-runs answers 400 and /calendar/layout-timeline 404s; 0062's production state is unrecorded and 0063 is local. Follow diary-deploy-checklist.md:35-42 (schema before code, clean worktree, stamp BUILD_GIT_SHA).
4. Decide the six "review" rooms — BLOCKED ON OWNER. Saloon needs a human decision, not a knob (SPLAT-ALIGNMENT-STATUS.md:56-60); the low-retention four need a roomCropM that Codex owns (:66-70). router.tsx:502-505 says these captures "must not reach clients" while router.tsx:531 serves them publicly — either crop/re-stage or gate /room until "confident". Registration (registry row, transform artifact, exposure tier) follows this decision; today only reception-room is registered (reception-room-runtime-qa-record-2026-06-15.md:19-21).
5. Reconcile the ledger — NOT STARTED. T-500 (tasks.md:219) vs splat-quality-independence.md:3; T-458 (:195) vs the shipped worker; missing T-505/T-507-T-514 rows vs omnitwin-foundry-roadmap.md:5; T-555-T-562 double-claimed on master (:220-227) and the Codex branch (:619-626); T-504 licence (:587); stale asset-version.ts:235-352 and state/capture_log.json; 09-PERSONA-JOURNEY-AUDIT.md stranded on 9c98b293.
6. Run the T-500 diagnosis — NOT STARTED (tasks.md:219). Four-view loss-stage verdict per docs/strategy/splat-quality-independence.md §4; also pins the Spark sort/SH knobs the render fix will touch. Nothing in the fixer/trainer lane is decidable before it.
7. XBIN frame extraction (T-566 lane) — IN PROGRESS on codex/grand-hall-exact-runtime only (branch tasks.md:630 T-566 done; :627 T-563 pose lineage). This is the gate to any trainer or fixer: every fixer/SR/densifier needs posed RGB frames the PortalCam .xbin withholds, and Matterport data is not a lawful substitute (audit research domain). Merge or push the lane first; it collides with master's T-555-T-562 numbers.
8. First independent training proof — BLOCKED on 7 and on T-001's $0.20 smoke test (tasks.md:58); trainer exits 78 (omnitwin-foundry-root-investigation.md:118-119); state/training_runs.jsonl 0 bytes. Now feasible locally: RTX 4090 24,564 MiB, D: 5,171 GB free as working disk, C: 14.3 GB free (nvidia-smi / Get-PSDrive 2026-09-01). Bound it to one confident room (deacon-conveners-room or reception-room, SPLAT-ALIGNMENT-STATUS.md:42-44) and log the run to training_runs.jsonl (docs/plan/cards/README.md decisions).
9. Commercial spine — IN PROGRESS, partial. Diary live (0061 in production); CRM 8 stages (commercial-spine.ts:29); proposal approve inert (proposals.ts:1290); quotes v0 no VAT (quotes.ts:129); packages/e-sign/payment absent (STRIPE_* read by nothing; T-459 not-started tasks.md:196); hold-reminder cron unwired (diary-first-week-operations.md:87). Ship the approve → hold/opportunity side-effect and the VAT line before any client sees a price.
10. Planning-to-operations, evidence runtime and simulation — IN PROGRESS, partial, none live-verified. Ops compiler and hallkeeper sheet exist (ops-compiler.ts 1,200 lines; HallkeeperPage.tsx:242-244); Evidence Pack route clearance hard-coded not_checked (evidence-runtime.ts:246-248) and stale events never written (schema.ts:1480; :738); Truth rail only where no lens panel is registered (CockpitRightDock.tsx:77); guest-flow worker runs but is never persisted and the ledger still says T-458 not-started (:195). Simulation/intelligence work waits on registered geometry (item 4) and deployed event data (item 3).

## §35 — roadmap status annotations

## 35. Roadmap — status per phase (annotations only, 2026-09-01)

- Phase 0 Reliability and Truth Foundations — PARTIAL. Claim guard shipped (T-083 tasks.md:215; public-claim-guard.test.ts); per-tile sha256 manifest and derived transforms exist (trades-hall-splat-bundles.ts) but the TransformArtifact/registry path is bypassed; observability blocked on Sentry DSN (T-060 :63, T-092 :256); backups unverified (T-062 :65) and uptime unmonitored (T-061 :64); migration ledger 0061 prod / 0062 unrecorded / 0063 local (diary-deploy-checklist.md:30; 2026-08-18.md:25-26); current-state audit done this session; rights ledger absent as data.
- Phase 1 Real Room Runtime — PARTIAL. Eight rooms render publicly (router.tsx:531) but no room package is registered except reception-room internal_ready/unverified (QA record :19-21); safe navigation = AABB clamp, fixed eye height, no collision mesh or doorway logic (interior-camera.ts:102); cutaway = clip box at full height (RoomSplatScene.tsx:150); render defect open (RoomSplatScene.tsx:152).
- Phase 2 Multi-Room Venue — PARTIAL. Per-room routes and per-room derived transforms exist (manifest roomSlug entries :75-1202; RoomsHomePage.tsx:165); no room graph — the twin manifest carries roomSlug: null for all 149 nodes (packages/web/public/twin/trades-hall/manifest.json, grep = 149) and the E57 twin and XGRIDS splats share no registration; venue-slug routing fixed (T-095 :292); multi-venue analytics not-started (T-462 :199).
- Phase 3 Commercial Spine — PARTIAL. Diary in production (0061; /ws/diary 101); CRM 8 stages (commercial-spine.ts:29); proposals + client portal shipped with inert approve (proposals.ts:1290) and single layoutSnapshot (proposal.ts:397); quotes v0 (quotes.ts:129); holds/bookings real (booking.ts:303-307 three conflict kinds); no packages, e-sign or payment (STRIPE_* unread; T-459 :196).
- Phase 4 Planning to Operations — PARTIAL, not live-verified. Ops compiler (ops-compiler.ts, 1,200 lines), hallkeeper PDF + offline queue (HallkeeperPage.tsx:242-244), supplier portal, event-day board and mission control exist; per-phase frozen layouts landed (phase-layout-snapshots.ts:126-128) but 0063 is local; AI BEO draft disabled without AI_ASSISTANT_* env (OpsHandoffPage.tsx:300; ai-assistant.ts:104-109).
- Phase 5 Evidence — PARTIAL. Evidence packs and review gates are tables and routes; route clearance hard-coded not_checked (evidence-runtime.ts:246-248); stale_evidence_events never written (schema.ts:1480; evidence-runtime.ts:738); Truth rail only as fallback (CockpitRightDock.tsx:77); no web caller records review-gate decisions.
- Phase 6 Guest Flow — PARTIAL. Deterministic grid navmesh + A* + seeded agents + queue/conflict detection run in a Web Worker off the live layout (workers/guest-flow-replay.worker.ts; guest-flow-replay.ts:637 "grid_navmesh_fallback_v0"); replay is never persisted; door positions are assumptions; ledger still says T-458 not-started (:195).
- Phase 7 Revenue and AI — PARTIAL. Revenue v0 shipped (T-463 :186), optimizer deferred (T-110 :333); AI assistant is a provider-agnostic adapter disabled by default (ai-assistant.ts:104-109) with read-only drafts (components/ai/AIDraftPanel.tsx:112) and no LLM SDK; Event Architect is deterministic and only digests the prose brief (event-architect-engine.ts:578).
- Phase 8 Integrations and Multi-Venue Deployment — NOT STARTED beyond stubs. Webhooks stub_only (integration-layer.ts:81-82); T-459 not-started (:196); five roles only (user.ts:19); Clerk dev mode (T-470 :75); feature flags absent (T-066 :249).
- Phase 9 Post-Event Learning — NOT STARTED (T-437 :184).
- Phase 10 OmniTwin Foundry and Neural Digital Sets — RESEARCH. T-486 in-progress (:92); roadmap claims T-506 foundation complete (omnitwin-foundry-roadmap.md:5) with no ledger rows for T-505/T-507-T-514; zero training runs (state/training_runs.jsonl 0 bytes); trainer exit 78 (root-investigation.md:118-119); Codex exact-runtime lane T-563-T-566 done only on the unpushed branch (branch tasks.md:627-630); D-009/D-012 still proposed (D-009.md:3, D-012.md:3).

## Evidence index

- C:/Users/blake/omnitwin2/packages/web/src/router.tsx:266
- C:/Users/blake/omnitwin2/packages/web/src/router.tsx:502-505
- C:/Users/blake/omnitwin2/packages/web/src/router.tsx:531
- C:/Users/blake/omnitwin2/packages/web/src/router.tsx:602-603
- C:/Users/blake/omnitwin2/packages/web/src/data/generated/trades-hall-splat-bundles.ts:75,294,408,627,804,925,1067,1202 (roomSlug entries)
- C:/Users/blake/omnitwin2/packages/web/src/data/generated/trades-hall-splat-bundles.ts:78 (totalSplats 11487038)
- C:/Users/blake/omnitwin2/packages/web/src/data/generated/trades-hall-splat-bundles.ts:290-291 (grand-hall alignment review, 13.8x22.3x12.9 vs 21x10x7)
- C:/Users/blake/omnitwin2/packages/web/src/data/generated/trades-hall-splat-bundles.ts:404-405,623-624,800,921,1063,1198,1368 (alignmentConfidence per room)
- C:/Users/blake/omnitwin2/packages/web/src/data/room-splat-bundles.ts:48
- C:/Users/blake/omnitwin2/packages/web/src/components/rooms/RoomSplatScene.tsx:150
- C:/Users/blake/omnitwin2/packages/web/src/components/rooms/RoomSplatScene.tsx:152
- C:/Users/blake/omnitwin2/packages/web/src/components/scene/SparkSplatLayer.tsx:90-95
- C:/Users/blake/omnitwin2/packages/web/src/components/rooms/interior-camera.ts:102
- C:/Users/blake/omnitwin2/packages/web/src/pages/RoomsHomePage.tsx:134-135,165,176
- C:/Users/blake/omnitwin2/packages/web/src/lib/trades-hall-venue-truth.ts:63
- C:/Users/blake/omnitwin2/packages/web/src/__tests__/public-claim-guard.test.ts
- C:/Users/blake/omnitwin2/packages/web/src/workers/guest-flow-replay.worker.ts
- C:/Users/blake/omnitwin2/packages/web/src/lib/guest-flow-replay-worker.ts
- C:/Users/blake/omnitwin2/packages/web/src/pages/HallkeeperPage.tsx:242-244
- C:/Users/blake/omnitwin2/packages/web/src/pages/OpsHandoffPage.tsx:300
- C:/Users/blake/omnitwin2/packages/web/src/components/ai/AIDraftPanel.tsx:112
- C:/Users/blake/omnitwin2/packages/web/src/components/editor/cockpit/CockpitRightDock.tsx:77
- C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall/manifest.json (149 x roomSlug: null)
- C:/Users/blake/omnitwin2/packages/web/vercel.json
- C:/Users/blake/omnitwin2/packages/types/src/asset-version.ts:235-352
- C:/Users/blake/omnitwin2/packages/types/src/asset-version.ts:318-335 (lady-convenors / deacon-conveners entries)
- C:/Users/blake/omnitwin2/packages/types/src/review-gate.ts:7
- C:/Users/blake/omnitwin2/packages/types/src/commercial-spine.ts:29
- C:/Users/blake/omnitwin2/packages/types/src/booking.ts:303-307
- C:/Users/blake/omnitwin2/packages/types/src/proposal.ts:385-397
- C:/Users/blake/omnitwin2/packages/types/src/user.ts:19
- C:/Users/blake/omnitwin2/packages/types/src/event-architect-engine.ts:578
- C:/Users/blake/omnitwin2/packages/types/src/guest-flow-replay.ts:637
- C:/Users/blake/omnitwin2/packages/api/src/routes/assets.ts:1884-1893
- C:/Users/blake/omnitwin2/packages/api/src/routes/room-layout-timeline.ts:161
- C:/Users/blake/omnitwin2/packages/api/src/routes/phase-layout-snapshots.ts:126-128
- C:/Users/blake/omnitwin2/packages/api/src/routes/proposals.ts:1290
- C:/Users/blake/omnitwin2/packages/api/src/routes/quotes.ts:129
- C:/Users/blake/omnitwin2/packages/api/src/services/evidence-runtime.ts:246-248
- C:/Users/blake/omnitwin2/packages/api/src/services/evidence-runtime.ts:738
- C:/Users/blake/omnitwin2/packages/api/src/services/ops-compiler.ts (wc -l = 1200)
- C:/Users/blake/omnitwin2/packages/api/src/services/ai-assistant.ts:104-109
- C:/Users/blake/omnitwin2/packages/api/src/services/integration-layer.ts:81-82
- C:/Users/blake/omnitwin2/packages/api/src/db/schema.ts:1480
- C:/Users/blake/omnitwin2/packages/api/src (grep -rl STRIPE_ = 0 files)
- C:/Users/blake/omnitwin2/packages/api/src/scripts/configure-splat-cors.ts
- C:/Users/blake/omnitwin2/packages/api/drizzle/0062_quiz_runs.sql
- C:/Users/blake/omnitwin2/packages/api/drizzle/0063_phase_layout_snapshot_immutability.sql
- C:/Users/blake/omnitwin2/.github/workflows/deploy.yml:4,70,81-90
- C:/Users/blake/omnitwin2/docs/handoffs/SPLAT-ALIGNMENT-STATUS.md:13,26-27,33-38,40-49,56-60,66-82,211
- C:/Users/blake/omnitwin2/docs/operations/diary-deploy-checklist.md:8-9,30,31,35-42,57-61
- C:/Users/blake/omnitwin2/docs/operations/reception-room-runtime-qa-record-2026-06-15.md:19-21
- C:/Users/blake/omnitwin2/docs/operations/diary-first-week-operations.md:87
- C:/Users/blake/omnitwin2/docs/RUNBOOK.md:54
- C:/Users/blake/omnitwin2/docs/sessions/2026-08-18.md:25-26
- C:/Users/blake/omnitwin2/docs/sessions/2026-08-27.md:48
- C:/Users/blake/omnitwin2/docs/sessions/2026-09-01.md:42
- C:/Users/blake/omnitwin2/docs/reports/omnitwin-foundry-root-investigation.md:118-119
- C:/Users/blake/omnitwin2/docs/reports/repo-consolidation-2026-08-08.md:58 (untracked)
- C:/Users/blake/omnitwin2/docs/reports/grand-hall-room-shape-proposer-v1-2026-08-04.md:6 (untracked)
- C:/Users/blake/omnitwin2/docs/strategy/splat-quality-independence.md:3
- C:/Users/blake/omnitwin2/docs/plan/06-GAP-AUDIT.md:9
- C:/Users/blake/omnitwin2/docs/plan/08-FRONTIER-MOONSHOTS.md:7-45
- C:/Users/blake/omnitwin2/docs/plan/omnitwin-foundry-roadmap.md:5
- C:/Users/blake/omnitwin2/docs/plan/cards/README.md (decisions of 10 Jul 2026; wave-A..wave-M.md)
- C:/Users/blake/omnitwin2/docs/architecture/claim-aware-copy-guard.md:28
- C:/Users/blake/omnitwin2/docs/architecture/adr/D-009.md:3
- C:/Users/blake/omnitwin2/docs/architecture/adr/D-012.md:3
- C:/Users/blake/omnitwin2/docs/architecture/adr/D-014.md:3
- C:/Users/blake/omnitwin2/docs/architecture/adr/D-024.md:3
- C:/Users/blake/omnitwin2/docs/state/tasks.md:58 (T-001 blocked)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:60 (T-003)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:63-65 (T-060/T-061/T-062)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:75 (T-470)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:89,96 (T-494/T-498)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:92 (T-486)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:184 (T-437)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:186 (T-463)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:195-196 (T-458/T-459)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:199 (T-462)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:208 (T-447)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:215 (T-083)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:219 (T-500)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:220-227 (T-555..T-562 on master)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:249 (T-066)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:255-256 (T-091/T-092)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:267 (T-022)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:273,275 (T-386/T-388)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:292 (T-095)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:296-298 (T-501..T-503)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:333 (T-110)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:445-446 (T-211/T-212)
- C:/Users/blake/omnitwin2/docs/state/tasks.md:587 (T-504)
- C:/Users/blake/omnitwin2/docs/state/tasks.md (grep '^| T-091A ' = 0; grep T-505/T-507..T-514 = 0; grep T-506 = 1)
- codex/grand-hall-exact-runtime:docs/state/tasks.md:618-630 (T-554..T-566 on the branch)
- feature/diary-p0-slice-3 commit 9c98b293 (docs/plan/09-PERSONA-JOURNEY-AUDIT.md, 539 lines)
- C:/Users/blake/omnitwin2/state/training_runs.jsonl (0 bytes)
- C:/Users/blake/omnitwin2/state/asset_versions.json ({"version": 1, "assets": []})
- C:/Users/blake/omnitwin2/state/capture_log.json:11,21,30,58
- D:/GRAND_HALL_BIG_MODEL_VARIATIONS/scans_BIG_MODEL_TH_GH_2/lcc2-result/info/report.json (pointCloudQuantity 6019684)
- git branch -vv / git branch --no-merged master (2026-09-01): 37 unmerged, 35 no upstream; master == origin/master 4822414d; codex/grand-hall-exact-runtime 4f5b62c9 no upstream, worktree C:/Users/blake/omnitwin2-grand-hall-exact-runtime
- git rev-list --left-right --count master...codex/grand-hall-exact-runtime = 113 / 81
- git status --short (10 untracked paths incl. tools/foundry-room-shape/)
- https://api.venviewer.com/health/version (2026-09-01: gitSha 154c6894, builtAt 2026-07-25T12:03:54Z)
- https://api.venviewer.com/public/quiz-runs (POST, 2026-09-01: 400)
- https://api.venviewer.com/calendar/layout-timeline (2026-09-01: 404)
- https://api.venviewer.com/ws/diary (2026-09-01: upgrade 101)
- https://venviewer.com/room/grand-hall (public)
- nvidia-smi 2026-09-01: NVIDIA GeForce RTX 4090, 24564 MiB
- Get-PSDrive 2026-09-01: C: 14.3 GB free, D: 5171.3 GB free
- C:/Users/blake/AppData/Local/Temp/claude/C--Users-blake-omnitwin2/dbedc34c-b506-4496-9e76-a176257a072b/scratchpad/audit-digest.txt (seven-domain audit digest; perf E1-E10, diary probes, research licences)
- C:/Users/blake/AppData/Local/Temp/claude/C--Users-blake-omnitwin2/dbedc34c-b506-4496-9e76-a176257a072b/scratchpad/brief-build-state-sections.md
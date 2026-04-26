# Venviewer task list

Source of truth for active and proposed work. Each task has a T-NNN ID, title, status, impact (1-5), effort (days), dependencies (T-NNN list), source citation. Statuses: `not-started | in-progress | done | deferred | blocked | rejected`.

Updated: 2026-04-25.

## Tier 0 — this week

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-001 | Migrate to RunPod-only training workflow. Stage `colmap_v2` to R2. Set up A100 80GB pod template with PyTorch 2.4.1+cu124, gsplat 1.5.3, Mip-Splatting, DN-Splatter, 3DGUT. | in-progress | 5 | 2 | — | D-006a, D-014, D-016, Claude-DR §4 | Implementation landed 2026-04-26 (Dockerfile, run scripts, configs, runbook). Smoke test ($0.20 mip-NeRF garden) is step 1 of using it; T-001 closes when smoke gate passes. Blocked on RunPod template + secrets being configured in the RunPod console. |
| T-002 | Document RunPod runbook (launch, rclone in `colmap_v2`, run training, push results to R2, kill pod). | done | 4 | 1 | T-001 | D-006a, D-016 | Runbook landed at `infra/runpod/RUNBOOK.md`; covers smoke + Config B procedures, failure modes, equirect trap, cost reference. |
| T-003 | Run Config B training: Mip-Splatting + DN-Splatter + 3DGUT + bilateral grid + MCMC, cap-max 5M, 30K steps on A100. | not-started | 5 | 1 + 3 hr GPU | T-001 | D-006a, D-016, Claude-DR §4.1.6 | Recipe locked at `configs/training/config_b.yaml`. Blocked on T-001 (smoke gate must pass first). |
| T-004 | Land §316 ADR creation prompt — superseded by Prompts 1+2 of workflow infrastructure prompt set. | rejected | — | — | — | — | superseded |
| T-005 | Eval Config B against held-out views (PSNR / SSIM / LPIPS / FPS on M1 MBP, 4090, iPhone WebGL2). | not-started | 4 | 1 | T-003 | Claude-DR §6 | Blocked on T-003. WebGL FPS via `venviewer_training/webgl_fps.ts` on real client hardware (not headless). |

## Tier 1 — next 2 weeks (architectural foundation)

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-006 | Reframe ADR-003 → typed spatial-layer graph doctrine. | done | 5 | 0.5 | — | Prompt 2 | Landed as D-003a. |
| T-007 | Reframe ADR-005 → view-dependent residual layer. | done | 4 | 0.5 | — | Prompt 2 | Landed as D-005a. |
| T-008 | Soften ADR-004 → projective texturing as base behind interface. | done | 3 | 0.5 | — | Prompt 2 | Landed as D-004a. |
| T-009 | Soften ADR-006 → keep MCMC + bilateral grid, add 3DGUT hedge. | done | 3 | 0.5 | — | Prompt 2 | Landed as D-006a. |
| T-010 | Soften ADR-008 — venue tenancy is application-level, schedule reopen. | not-started | 2 | 0.5 | — | D-008, CGT-DR Part 2 | Reopen on first multi-property customer. |
| T-011 | Draft ADR-009 (typed spatial-layer graph / VSIR-0). | done | 5 | 1 | — | Prompt 2 | Landed as D-009. |
| T-012 | Draft ADR-010 (pose-frame indirection). | done | 4 | 1 | — | Prompt 2 | Landed as D-010. |
| T-013 | Draft ADR-011 (Spatial Confidence Budget). | done | 5 | 1.5 | — | Prompt 2 | Landed as D-011. |
| T-014 | Draft ADR-012 (provenance and truth-mode separation). | done | 4 | 1 | — | Prompt 2 | Landed as D-012. |
| T-015 | Draft ADR-013 (format strategy and standards). | done | 4 | 1 | — | Prompt 2 | Landed as D-013. |
| T-016 | Draft ADR-014 (Venue Artifact Factory). | done | 4 | 1 | — | Prompt 2 | Landed as D-014. |
| T-017 | Draft ADR-015 (capture certification tiers). | done | 4 | 1.5 | — | Prompt 2 | Landed as D-015. |
| T-018 | Implement `AssetVersion` + `CaptureSession` Drizzle schema. First piece of code from D-014. | not-started | 4 | 2 | T-016 | D-014 | |
| T-052 | Upgrade Three.js from 0.170 to 0.180 to satisfy Spark 2.0 compatibility per D-002. Verify `@react-three/fiber`, `@react-three/drei`, existing scene components compile. | not-started | 4 | 1–2 | — | D-002, CLAUDE.md tech stack | Blocking for any production splat rendering work that depends on Spark 2.0 features. |

## Tier 2 — weeks 3–6 (first vertical slice)

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-019 | Implement E57 depth supervision generator. Per-panorama depth maps from E57 cloud, input to gsplat `--depth_loss`. | done | 5 | 2 | T-001 | Claude-DR §F, D-016 | Implementation landed 2026-04-26 at `venviewer_training/project_e57_depth.py` (E57 → sparse UV+depth `.npz` per training image; ICP alignment via open3d; ProcessPoolExecutor parallel projection). End-to-end validation against Trades Hall depth priors happens in T-021. Eliminates floaters, +1–2 dB expected. |
| T-020 | Implement automated tripod masking for COLMAP down-faces. | not-started | 3 | 1 | — | session history | 231/300 → ~270/300 expected. |
| T-021 | Run Config C training: Config B + E57 depth supervision + tripod masking on A100. | not-started | 4 | 1 + 3 hr GPU | T-019, T-020 | multiple | |
| T-022 | Build bake-off harness: candidates B (Genjutsu v1), A (pure full-scene splat), D (classical textured mesh) on Trades Hall. | not-started | 5 | 5 | T-001, T-018 | Claude-DR §6 | Same train/test split, same E57 ground truth, same eval contract. |
| T-023 | Spatial Confidence Budget v0.1 (numbers-only dashboard). ICP residuals, COLMAP reprojection, splat-vs-mesh disagreement voxel grid. No UI yet. | not-started | 5 | 4 | T-013, T-018 | D-011, §687 highest-leverage | |
| T-024 | Implement automated residual extraction (replaces manual SuperSplat cropping). Render projective base, render full splat, compute persistent error mask. | not-started | 4 | 5 | T-022 | D-005a, Claude-DR §3.3 | |
| T-025 | Build pose-frame indirection per D-010. `PoseFrame` interface, COLMAP default, MapAnything fallback. Test on hard-to-reach Trades Hall regions. | not-started | 4 | 3 | T-012 | D-010 | Accept if E57 alignment ≤ 5 mm. |
| T-026 | Implement SPZ output format from training pipeline. | not-started | 3 | 1 | T-001 | D-013 | Hold off on glTF/KHR until Q2 ratification. |
| T-053 | Backend ingestion: pull signed bundle from R2, validate SHA-256 against manifest, write `AssetVersion` row. | deferred | 4 | 3 | T-018 | D-014, D-016, RunPod research synthesis 2026-04-26 | Verifier protocol documented in `docs/specs/runpod-training-contract.md` §5. Cannot be implemented until T-018 schema lands. Reactivation trigger: T-018 status = `done`. Implementation lands at `scripts/admin/register_trained_bundle.ts`. Becomes immediate work the moment T-018 closes. |

## Tier 3 — weeks 7–12 (bake-off decision and production readiness)

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-027 | Bake-off Phase 1 results published. Apply decision rule (Claude-DR §6.8). | not-started | 5 | 2 | T-022 | Claude-DR §6.8 | Keep Genjutsu v1, falsify, or schedule Phase 2. |
| T-028 | Phase 2 (conditional): BakedSDF / mesh-first neural appearance prototype. | not-started | 4 | 30 | T-027 | Claude-DR §1.3.f | Only if Phase 1 inconclusive. |
| T-029 | Truth Heatmap UI in Venviewer. Per-cursor tier chip. Measure tool refuses below `LAYOUT_GRADE_5CM`. | not-started | 4 | 4 | T-023 | D-011 | Behind feature flag initially. |
| T-030 | Second venue capture (anything other than Trades Hall). Tests VSIR-0 portability. | not-started | 5 | 5 | T-018 | D-009, CGT-DR §1.f | If VSIR needs > 30% schema changes, abstraction is wrong. |
| T-031 | Productize RunPod training workflow as documented runbook + webhook trigger. | not-started | 3 | 3 | T-002 | D-006a | Per-venue cost ~$5–10. |
| T-032 | Spark 2.0 LoD `.RAD` streaming integration. Pre-build `.RAD` trees as part of asset emission. | not-started | 4 | 5 | T-026, T-052 | D-001, Claude-DR §4.1.2 | Requires Three.js 0.180. |

## Tier 4 — months 3–6 (strategic build, conditional on customer pull)

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-033 | Implement venue graph v0.5 schema in PostgreSQL. IFC-aligned spatial structure. Initial 10 captures populated. | not-started | 5 | 15 | T-018 | D-009, Claude-DR §7 | |
| T-034 | MVR (My Virtual Rig) round-trip import/export. Test with real lighting designer in GrandMA3. | not-started | 4 | 8 | T-033 | D-013, Claude-DR §7.f | D-013 falsifying experiment. |
| T-035 | Cvent BEO format export from venue graph. | not-started | 4 | 5 | T-033 | All four sources | Aligns with their April 2025 Prismm acquisition. |
| T-036 | Tier-2 learned blending v2 prototype: Deep Blending-style learned source-view selector + blend-weight predictor. | not-started | 3 | 15 | T-027 | D-004a, CGT-DR §D | |
| T-037 | Capture Certification Partner program design. Pilot with 5 BLK360 owners. | not-started | 4 | 20 | T-029 | D-015, Claude-DR §6.3 | |
| T-038 | First non-luxury-hotel customer (stadium hospitality, boutique hotel ballroom, or corporate boardroom). | not-started | 5 | 10 + capture cost | T-031 | All sources | Validates pipeline isn't Trades-Hall-specific. |

## Tier 5 — strategic / conditional on revenue

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-039 | glTF + KHR_gaussian_splatting export when ratification lands. | not-started | 3 | 5 | Khronos Q2 2026 | D-013 | |
| T-040 | OpenUSD `ParticleField` backend for Genjutsu IR. Round-trip test SPZ → glTF → USD → SPZ. Accept if PSNR ≥ 38 dB. | not-started | 3 | 10 | T-039 | D-013, Claude-DR §2.f | |
| T-041 | Cinematic Mode (Pixel Streaming on g6e.xlarge): premium tier. Trial $1,500 to 10 hotel sales directors + 10 F500 corporate planners. | not-started | 3 | 30 | T-038 | Claude-DR §5 | |
| T-042 | Hire first surveyor (RICS / NSPS-credentialed) + buy 1× BLK360 G2. ~$30k. | not-started | 4 | 60 | T-038 | D-015, Claude-DR §6 | |
| T-043 | SOC 2 Type II readiness. ~$80k audit. ISO 27001 in parallel. | not-started | 4 | 90 | T-042 | Claude-DR §8 | |
| T-044 | Khronos contributor membership ($50k/yr). | not-started | 3 | continuous | revenue | D-013 | |
| T-045 | Sigstore-signed asset bundles. AES-256-GCM per-tenant CMKs. GuardSplat-style watermarking. | not-started | 4 | 30 | T-042, T-043 | D-014, Claude-DR §8 | |

## Tier 6 — wildcards / R&D branches

| ID | Title | Status | I | E | Depends | Source | Notes |
|---|---|---|---|---|---|---|---|
| T-046 | "Venue Trailer" auto-generated cinematic 45-sec videos per venue. | deferred | 3 | 4 | T-038 | CGT-1 | Free Instagram / marketing content. |
| T-047 | Luxury Capacity calculator (max / comfortable / luxury / cinematic / CEO-keynote / wedding-with-dancefloor per space). | deferred | 3 | 3 | T-033 | CGT-1 | Differentiator language. |
| T-048 | Ghost Staff Simulation (translucent flow fields for waitstaff / guests / photographers / VIP routes / evacuation). | deferred | 3 | 15 | T-033 | CGT-1 | |
| T-049 | Imagination Mode (diffusion-generated decor / style / mood ideation, firewalled per D-012). | deferred | 3 | 25 | T-014 | D-012, CGT-2 | |
| T-050 | MVR / BEO Bridge productization. Sell to Vectorworks / MA Lighting / depence² ecosystem. | deferred | 4 | 20 | T-034 | CGT-DR §10 wildcard | |
| T-051 | "Dolby Vision of Venues" certification standard publication. Only after 50+ certified venues. | deferred | 5 | 60 | T-037 + 50 venues | CGT-2, Claude-DR §10 | |

## Status legend

- **not-started** — proposed, not yet picked up.
- **in-progress** — actively being worked.
- **done** — completed.
- **deferred** — tracked but not committed; conditions for revisit in Notes.
- **blocked** — depends on something not yet ready.
- **rejected** — considered and rejected; kept for traceability.

## Source citation legend

- **D-NNN** — references a Venviewer ADR at `docs/architecture/adr/`.
- **CGT-1** — first ChatGPT review (whole product).
- **CGT-2** — second ChatGPT review (Genjutsu architecture).
- **CGT-DR** — ChatGPT deep research Parts 1+2.
- **Claude-DR** — Claude deep research Parts 1+2.
- **§NNN** — section number from architecture conversation history.

## Shepherd protocol

This task list is a living document. Every Claude Code session must follow this protocol.

### Before starting work

- Read this file in full.
- Identify the T-NNN that the current request maps to. If no T-NNN matches, propose a new T-NNN in the appropriate tier and add it to the table before starting work.
- Update the matched task's status to `in-progress`.

### During work

If the work becomes blocked:

- Set status to `blocked`.
- Add to Notes: what blocks the task and what would unblock it.
- Surface the block in the session log at `docs/sessions/YYYY-MM-DD.md`.

If the work reveals new tasks (subtasks, prerequisite work, follow-on work):

- Add them to the appropriate tier with explicit `Depends` linkage.
- Do not merge new work into the in-progress task scope without Blake's explicit confirmation.

### After completing work

- Set the task's status to `done`.
- Update the Notes field with the actual delivered artifact paths (e.g. "Implementation at `infra/runpod/run_training.sh`, runbook at `infra/runpod/RUNBOOK.md`").
- Update any tasks that were `Depends`-on-this-task to surface that they're now unblocked.
- Regenerate `docs/diagrams/task-graph.md` to reflect the new state.
- Add a session log entry to `docs/sessions/YYYY-MM-DD.md` noting the completed task and any newly-unblocked tasks.

### Per-session surveillance

Each session also checks:

- Any task that's been `in-progress` for >7 days: probably stuck. Surface to Blake.
- Any task whose `Depends` are now all `done`: should be flagged as ready to start.
- Any task whose `Depends` include a task that's been `rejected`: may need re-thinking; surface to Blake.

The shepherd protocol is non-negotiable. Skipping it produces the exact failure mode this protocol was designed to prevent: tasks that quietly stay open forever because nobody updated them after the work shipped.

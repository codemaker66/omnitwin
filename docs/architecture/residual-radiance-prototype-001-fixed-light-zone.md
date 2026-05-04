# Residual Radiance Layer Prototype 001 — Fixed-Light Venue Zone

Status: research experiment plan
Date: 2026-04-30
Source: RRL-001
Depends on: T-091, T-116, T-118, T-137, D-009, D-011, D-012, D-014, D-019, D-024
Related tasks: T-138, T-139, T-140, T-141, T-142, T-143, T-144, T-145, T-146, T-147, T-148, T-149, T-150, T-151, T-152, T-153, T-154, T-155

## Goal

Build a constrained research prototype proving that a semantic/PBR mesh plus a surface-bound residual radiance layer can outperform mesh-only rendering while preserving editability, operational authority, and Truth Mode explainability.

The prototype tests the Residual Radiance Layer doctrine from `docs/architecture/residual-radiance-layer.md`:

- Mesh remains authoritative for geometry, semantics, collision, layout constraints, editing, measurement, and exports.
- Residual remains subordinate and appearance-only.
- Residual binds to mesh semantics wherever possible.
- Residual can be disabled without destroying the planning scene.
- Truth Mode can explain what the residual contributes, how it was produced, and where it is allowed to appear.

## Production Boundary

RRL-001 does not replace T-091 and does not block T-091A.

The production proof remains: Spark + real Trades Hall splat + structural mesh + Truth Mode + Hero Regions. RRL-001 starts only after the project has enough real venue evidence to avoid inventing a beautiful synthetic benchmark.

Current repository state at plan creation:

| State file | Current state | Planning consequence |
|---|---|---|
| `state/asset_versions.json` | `assets: []` | No signed or candidate runtime bundle exists yet. |
| `state/capture_log.json` | `captures: []` | No tracked capture session is available to select from. |
| `state/training_runs.jsonl` | empty | No training run metrics or holdout views exist yet. |

RRL-001 must therefore treat all cost/time estimates as placeholders and all asset references as future inputs. The plan is executable once T-091 publishes the first real evidence and T-116/T-118 establish transform and room-shell inputs.

Existing Matterport data is acceptable for bootstrap experiments, ingestion checks, and early visual comparisons. Serious fixed-light residual evaluation requires a Photometric Chain-of-Custody record as defined in `docs/architecture/photometric-chain-of-custody.md`.

Residual runtime experiments should be PLY-first and SPZ-second. The first Spark residual test should prefer inspectable PLY or equivalent source output so fixed-camera coordinate alignment can be verified before compression. SPZ packaging is a second step after camera, mesh, residual, and transform agreement are proven.

## Scope

In scope:

- One zone of Trades Hall, or a similarly controlled venue zone if Trades Hall evidence is not yet usable.
- Fixed lighting.
- One mesh-only PBR baseline.
- One mesh plus residual result.
- One full Gaussian splat baseline for comparison.
- One object insertion demo.
- A metrics report and Truth Mode explanation mock.
- Research artifacts only.

The selected zone must include an Authoritative Zone Box defining where residual appearance may contribute and what mesh/semantic regions remain authoritative.

Out of scope:

- Production runtime integration.
- Arbitrary relighting.
- Full venue-wide residual system.
- Legal, fire, or survey certification.
- Replacing T-091.
- New production dependencies.
- Public marketing claims.

## Candidate Zones

Select one zone only. The goal is controlled comparison, not coverage.

| Candidate zone | Why it is useful | Main risk | Best if |
|---|---|---|---|
| Chandelier-adjacent wall/window zone | Tests view-dependent glow, high-frequency window detail, and local radiance near difficult fixtures. | Free-space residual can become tempting and hide semantic leakage. | We have clean camera poses and a stable wall/window mesh. |
| Fireplace/panelling zone | Tests polished wood, carved details, marble/fireplace texture, and mostly planar geometry. | Mesh-only baseline may already be strong enough, making residual improvement marginal. | We need a conservative first zone with clear edit boundaries. |
| Table/stage insertion zone | Tests operational editability: insert a table, stage, sign, or chair group into a residual-enhanced scene. | Visual richness may be lower than hero zones. | Object insertion is the dominant validation milestone. |
| Stained-glass-adjacent zone | Tests glow, transparency, color bleed, and thin decorative surfaces. | Alpha-over/free-space residual policy may be needed earlier than desired. | We have reviewed semantic masks and a clear special-class authority decision. |

Recommended first choice: fireplace/panelling zone if the objective is lowest-risk proof of surface-bound residual behavior. Recommended second choice: table/stage insertion zone if the objective is editability proof. Chandelier or stained-glass zones should wait unless T-146 policy is already written, because they are exactly where free-space residuals can become overpowered.

## Zone Selection Criteria

The chosen zone must satisfy:

- At least 8-12 usable training views and 3-5 held-out views.
- Known camera poses in a shared coordinate frame.
- Structural mesh with stable topology or stable UVs.
- Region boundaries for at least wall/floor/fixture/object classes.
- A clear object insertion location.
- Fixed or controllable lighting across source images.
- No unresolved transform ambiguity between capture frame, mesh frame, and render frame.
- Enough visual complexity that mesh-only PBR has room to lose.

Reject a zone if:

- The mesh is not aligned to capture images.
- The residual target is mostly unobserved or known-unknown.
- The zone requires broad relighting to make the comparison fair.
- The only apparent improvement would come from letting residual carry geometry.

## Required Inputs

| Input | Required shape | Source / dependency |
|---|---|---|
| Structural mesh | GLB or equivalent with metric scale, stable topology where possible, and region/object identifiers. | T-118 / D-024 |
| UVs/material slots | Reviewed UVs or material slots for wall, floor, trim, fixture, and insertion surfaces. | T-140 |
| Camera poses | Extrinsics and intrinsics in a declared coordinate frame. | T-091 / D-014 |
| Images/panoramas/keyframes | Fixed-light capture images with enough overlap for train/holdout split. | T-091 |
| Photometric Chain-of-Custody | Capture session ID, zone ID, lighting state, camera/lens/exposure/white-balance/focus settings, grey card, ColorChecker, flicker test, calibration frames, raw file hashes, train/holdout/challenge split, operator, exclusions, and known issues. | PCC-001 / T-249 |
| Authoritative Zone Box | CVF bounds, semantic region references, allowed binding/composition, exclusions, transform references, and Truth Mode label. | Mandatory for residual acceptance. |
| Optional E57 depth | Depth or point cloud evidence for alignment and occlusion sanity checks. | T-118 |
| Baseline PBR maps/materials | Mesh-only material set: albedo/base color, roughness, metalness/specular, normal where available. | T-140 |
| Residual training data | Residual target computed against mesh-only renders or directly learned from image supervision, depending on track. | T-149/T-150 |
| Test/holdout views | Frozen held-out camera set, never used for training. | T-148 |
| Transform artifacts | ARF -> CVF and/or CVF -> RRF transforms for mesh, splat, residual, and insertion object. | T-116 |
| Scene Authority Map entries | Per-region authority declarations for mesh, residual, splat, PBR material, probes/lightmaps, and proxy objects. | D-024 / T-146 |

## Baselines

RRL-001 compares four surfaces:

| Baseline | Purpose | Required output |
|---|---|---|
| Mesh-only PBR | Operational baseline. Shows what the semantic/PBR mesh can do without residual. | Holdout stills, comparison video, FPS, memory, asset size. |
| Full Gaussian splat | Visual upper-bound-ish comparison. Shows what appearance/radiance field captures without editability guarantees. | Same camera holdout stills, FPS, memory, asset size. |
| Mesh + residual | The experiment target. Must improve visual result while preserving mesh authority. | Same stills/video/metrics plus residual-specific diagnostics. |
| Frosting-only (optional) | Checks whether surface-bound splats alone can beat the more complex stack. | Only run if Track A setup makes it cheap. |

The mesh-only baseline is not a throwaway. It is the fallback scene users still need when the residual is disabled.

## Research Tracks

### Track A: Gaussian Frosting / Surface-Bound Splats

Hypothesis: splat-like learned appearance attached to mesh surfaces can recover high-frequency radiance while staying explainable by region and surface.

Experiment shape:

- Bind samples by mesh triangle ID, barycentric coordinate, UV coordinate, local tangent frame, or region ID.
- Prefer additive composition.
- Allow alpha-over only for a declared special semantic class.
- Compare against full splat and mesh-only PBR on identical holdout views.
- Record residual energy ratio and semantic leakage.

Primary tasks: T-139, T-149.

### Track B: UV / Neural Texture Residual

Hypothesis: a UV-bound residual texture or deferred neural shader can add missing view-dependent detail with lower runtime cost than free-space splats.

Experiment shape:

- Use reviewed UVs or material slots.
- Train residual against mesh-only render error.
- Keep output tied to mesh surfaces.
- Test whether view dependence can be approximated without turning into a hidden full-scene renderer.

Primary tasks: T-144, T-150.

### Track C: PBR-Only Fallback With Lightmaps / Probes

Hypothesis: a simpler PBR baseline with lightmaps, local probes, and better materials may solve enough of the visual gap without learned residual complexity.

Experiment shape:

- Build a high-quality PBR fallback for the same zone.
- Use lightmaps/probes where allowed, following the Lighting Context Package / Probe Leakage Guard doctrine.
- Compare asset size, FPS, editability, and object insertion realism against Tracks A and B.
- Treat this as the fallback if learned residuals fail editability or explainability gates.

Primary tasks: T-140, T-151.

## Object Insertion Demo

The object insertion demo is mandatory.

Insert one object:

- Round table with chairs.
- Small stage.
- Sign/plinth.
- Supplier object with simple rectangular footprint.

The object must:

- Have a clear semantic class.
- Have an ARF -> CVF transform.
- Be editable: move, hide, and delete.
- Use the mesh as shadow/occlusion proxy.
- Use local reflection/light probes if available, selected by zone/influence rather than global scene average.
- Render in each baseline: mesh-only PBR, full splat comparison, mesh + residual, and optional Frosting-only.

Evaluate:

- Does the inserted object look plausibly grounded?
- Does the residual leave ghosts when the object moves or disappears?
- Does the residual leak through or over the inserted object?
- Does mesh-only PBR provide a more honest result even if less photoreal?
- Can Truth Mode explain the inserted object, local lighting/probe source, and residual contribution?

Primary tasks: T-141, T-152.

## Metrics

Standard view metrics:

| Metric | Use | Reporting |
|---|---|---|
| PSNR | Pixel-level fidelity against held-out views. | Mean, median, per-view table. |
| SSIM | Structural similarity. | Mean, median, per-view table. |
| LPIPS | Perceptual similarity. | Mean, median, per-view table. |

Residual-specific metrics:

| Metric | Definition | Fail signal |
|---|---|---|
| Residual energy ratio | Fraction of final radiance/error correction carried by residual instead of mesh/PBR. | Residual carries most of the visible scene. |
| Semantic leakage | Residual samples or energy crossing unauthorized region/object boundaries. | Leakage visible across fixture/wall/floor/object boundaries. |
| Edit consistency | Visual stability after moving/hiding/deleting mesh objects. | Ghosts, halos, or stale highlights remain. |
| Insertion realism | Human review plus image metrics around the inserted object crop. | Inserted object looks less grounded than mesh-only. |
| FPS | Browser runtime frame rate on target device classes or offline proxy if runtime is not integrated. | Below plausible interactive threshold for target class. |
| Memory | Runtime or renderer memory footprint. | Residual makes mobile/tablet impossible. |
| Asset size | Residual chunk size and total bundle delta. | Size too large to stream as optional layer. |
| Truth Mode explainability | Whether L2/L3 mock can state source, authority, binding, confidence, and known issues. | Users cannot tell what the residual owns or why. |

Metrics must be reported with categorical conclusions, not false precision for product-facing interpretation. Raw numbers belong in developer/QA appendices.

## Success Criteria

RRL-001 succeeds only if all are true:

- Mesh + residual visibly improves over mesh-only PBR on held-out views.
- Standard metrics improve over mesh-only on the chosen zone without hiding major local failures.
- Residual remains sparse or localized enough that the mesh/PBR baseline still carries the scene.
- Residual Disable Test passes: mesh-only remains operationally usable after residual disablement, and no critical region/object exists only in the residual.
- Residual Energy Ratio and Semantic Leakage pass their acceptance thresholds for the declared zone.
- Inserted object looks plausibly grounded/lit.
- Disabling residual still leaves a usable venue planning scene.
- Moving, hiding, or deleting the inserted object does not leave major visual ghosts.
- Semantic leakage is absent or small enough to be explicitly bounded by policy.
- Browser runtime remains plausible: performance and asset size are within a credible path for desktop first, with a stated tablet/phone fallback.
- Truth Mode mock can explain mesh authority, residual appearance authority, binding strategy, provenance, confidence, and known issues.

## Failure Criteria

RRL-001 fails if any are true:

- Residual carries most of the image.
- Residual carries essential geometry or hides missing mesh authority.
- Residual Energy Ratio or Semantic Leakage fails the declared threshold.
- Residual leaks across semantic regions without authorization.
- Residual breaks editability or leaves obvious ghosts after edits.
- Residual Disable Test fails.
- Object insertion looks worse than mesh-only PBR.
- Runtime size/performance is unacceptable for an optional layer.
- The result requires arbitrary relighting to appear valid.
- The method cannot be disabled without losing planning value.
- Truth Mode cannot explain what the residual is doing.
- The experiment depends on untracked Blender/manual positioning instead of persisted transform artifacts.

## Compute Plan

Compute estimates are placeholders and must be verified before spend:

| Compute path | Use | Placeholder estimate |
|---|---|---|
| Local RTX 4090, if available | Baseline renders, small Track C/PBR work, small Track B experiments, metrics scripts. | 0.5-2 local days. Cost: sunk local hardware. |
| RunPod A100 | Track A/Track B training when local iteration is too slow. | 2-8 GPU hours per track. Cost placeholder: verify current RunPod pricing before launch. |
| RunPod H100 | Only if A100 is too slow or a candidate method requires it. | 1-4 GPU hours for narrowed experiments. Cost placeholder: verify current RunPod pricing before launch. |

Budget guardrail: no broad parameter sweep until the zone, input pack, baselines, and holdout cameras are frozen. Spend should buy specific answers, not research drift.

Holdouts must never be trained on. If a holdout image enters training, previous metrics using that image are invalidated or must be explicitly superseded.

## Output Artifacts

RRL-001 produces a research artifact bundle, not a production runtime bundle:

- Input manifest: zone, source captures, camera poses, mesh, transforms, and semantic labels.
- Photometric Chain-of-Custody record.
- Train/holdout/challenge split report.
- Training logs.
- Mesh-only renders.
- Full splat baseline renders.
- Residual renders.
- Optional Frosting-only renders.
- Object insertion renders/video.
- Comparison video with identical camera paths.
- Metrics report.
- Residual energy and semantic leakage diagnostics.
- Runtime FPS/memory/asset-size report.
- Truth Mode explanation mock.
- Failure notes and known issues.
- Follow-up recommendation: promote, revise, defer, or reject.

## Truth Mode Explanation Mock

The mock should answer, for the selected zone:

- What owns geometry?
- What owns appearance?
- What owns lighting/radiance?
- Which residual binding strategy is used?
- Is the residual additive or alpha-over?
- Which evidence/source state applies?
- Which verification state applies?
- Which confidence tier applies?
- What is stale, contested, suppressed, or known-unknown?
- What happens if the residual is disabled?
- What known failures should a planner/hallkeeper see?

This can be a static markdown/image mock for RRL-001. It is not a runtime UI implementation.

## Experiment Phases and Task IDs

| Phase | Task | Output |
|---|---|---|
| Plan | T-138 | This document: prototype scope, criteria, baselines, metrics, and phases. |
| Phase 0: data readiness and zone selection | T-147 | Frozen zone/input manifest with selected cameras, mesh, transforms, Photometric Chain-of-Custody, and holdout split. |
| Phase 1: baselines | T-148 | Mesh-only PBR and full Gaussian splat baseline render pack. |
| Phase 2A: surface-bound residual | T-149 | Track A Gaussian Frosting / surface-bound splat prototype results. |
| Phase 2B: UV/neural residual | T-150 | Track B UV/neural texture residual prototype results. |
| Phase 2C: PBR fallback | T-151 | Track C PBR lightmap/probe fallback results. |
| Phase 3: object insertion | T-152 | Insertion demo and edit-consistency evaluation. |
| Phase 4: metrics and Truth Mode mock | T-153 | Metrics report, Truth Mode explanation mock, asset-size/performance report. |
| Phase 5: decision | T-154 | Recommendation: promote, revise, defer, or reject the RRL direction. |

Supporting broad research tasks:

- T-139: MILo / Gaussian Frosting / Spark feasibility spike.
- T-140: Semantic PBR mesh / NVDIFFRECMC experiment.
- T-141: Object insertion probe-grid residual demo.
- T-142: Residual metrics suite.
- T-143: Spark custom residual shader feasibility.
- T-144: Neural texture / deferred shader research branch.
- T-145: Limited lighting-state residual experiment.
- T-146: Stained-glass/chandelier special-class residual policy.
- T-155: Residual Radiance metadata vocabulary in shared types.
- T-249: Photometric Chain-of-Custody doctrine.
- T-250: Residual capture session manifest.
- T-265: Residual Disable Test doctrine.
- T-266: Residual disable fixture.
- T-267: Mesh-only vs residual render comparison.
- T-268: Residual authority QA checklist.

## Decision Rules

Promote RRL research only if:

- Track A or Track B beats mesh-only visually without failing editability.
- Track C does not solve the same problem more cheaply.
- Asset size and FPS suggest a credible browser path.
- Truth Mode can explain the result without exposing raw research internals to normal users.

Defer RRL if:

- The production T-091 path still lacks a real splat/mesh/Truth Mode substrate.
- The residual depends on unverified custom Spark shader behavior.
- The best zone is a chandelier/stained-glass class before T-146 policy is complete.

Reject or reframe RRL if:

- Residual repeatedly becomes an opaque full-scene renderer.
- Edit operations consistently produce ghosts.
- Residual ownership cannot be represented in Scene Authority Map.
- The PBR/probe fallback gives comparable product value with much less complexity.

# Codex Continuation Directive — Grand Hall Visual Super-Pipeline (amended)

Status: canonical project direction. Owner: Blake. Prepared for the Codex
session on `codex/universal-foundry`.

This is Blake's directive, amended by a Claude review pass with five load-bearing
corrections and two rights-mechanics notes. Every amendment is marked
**[AMENDMENT]** with the verified fact that motivates it. Where this document and
an earlier copy of the directive disagree, this copy wins.

Do not throw away, reset, duplicate or casually rewrite the work already
completed. Do not create a new branch or worktree. Do not push, merge or deploy
until Blake explicitly instructs you after review.

---

## 0. Read before acting

Inspect: current branch and working tree; all uncommitted work; the
implementation already produced; the viewer architecture; the Spark / Three.js
scene layers; `The Room Resolves`; Mesh / Splat / Hybrid handling;
camera/navigation code; room geometry and collision; runtime-asset manifests;
relevant tasks, architecture documents and session logs.

Then state briefly how the current work maps into this directive and continue
from the strongest compatible point.

### [AMENDMENT 0 — verified branch state, read this first]

As of 2026-08-24, verified directly:

- `codex/universal-foundry` forked from master at `8b9dd430` on **2026-07-20**
  and is **112 commits behind master**.
- The branch still has **`RENDER_SCALE = 2.0`** (`packages/web/src/constants/scale.ts:16`).
  Master moved the scene to true metres (`RENDER_SCALE = 1.0`, commit
  `43be45c0`) and landed generated furniture proxies for the whole placeable
  catalogue (`a82ef463`). **Neither reached this branch.**
- Consequence: any "human scale" / collision / boundary-clamp work done on this
  branch as-is is built on a world where X and Z are doubled and Y is not. Eye
  height, capsule radius and room-boundary clamps computed at scale 2.0 are
  wrong the moment the branch reaches master. **Step D cannot be trusted until
  the branch carries true metres** — see Amendment 2.

### [AMENDMENT 1 — commit before anything else; DONE]

The directive said "preserve" but never "commit". Before this document existed,
the branch held 104 uncommitted files (~25k lines) as working-tree state only,
never pushed, on a disk at 96%. That is one power cut from total loss.

This has now been done for you:

- All 104 files committed to `codex/universal-foundry` as
  `2ba77de2 wip(foundry): commit the universal-foundry working state`.
- Uncommitted snapshot tarred to
  `F:/omnitwin2-backups/universal-foundry-uncommitted-2026-08-24.tgz`.
- Full branch bundled and verified to
  `F:/omnitwin2-backups/universal-foundry-branch-2026-08-24.bundle`.

A local commit is not a push. Pushing remains Blake's call. Continue to commit
in small, honest increments; do not sit on large uncommitted deltas again.

---

## 1. Authoritative Rights Context

Blake confirms that Venviewer / OmniTwin has full permission, authority and
rights to use the relevant **Matterport and XGRIDS** data and software materials
in any way required for this project, including: reconstruction; training and
fine-tuning; commercial derivative assets; inspecting and parsing all formats;
reverse-engineering LCC Studio and relevant XGRIDS formats and workflows;
decoding, and bypassing encryption or access controls where necessary; copying,
modifying and redistributing proprietary SDK components where useful; and using
Matterport/XGRIDS-derived geometry, images, panoramas, poses, meshes, point
clouds and splats as active pipeline inputs.

Do not reintroduce generic Matterport/XGRIDS data-rights uncertainty as a
blocker.

Record in the rights/provenance ledger, following repo conventions:

```text
Authority status: confirmed by project owner
Scope: data use, reconstruction, training, enhancement, derivatives,
commercial Venviewer development, reverse engineering and software integration
Applies to: Matterport data + software materials; XGRIDS data + software materials
Evidence location: <reserve this slot; do not block technical work waiting for it>
```

Permission removes **legal** blockers only. It does not remove maintainability,
security, provenance or quality considerations. It does **not** override licences
of unrelated third-party research code or model weights — ArtiFixer / Fixer
checkpoints, Difix3D+, GSFixer, Inria GS derivatives, Wan-family weights, and any
other external model must still be audited separately. Prefer clean-room or
independently maintainable implementations where they give a better long-term
architecture, even when direct reuse is authorised.

### [AMENDMENT R1 — the gates are code, not prose]

Recording rights as a paragraph will not unblock anything, because the Foundry's
gates are machine-readable fields, not sentences:

- `docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json` stamps 309
  assets `modelTrainingUse: "requires_review"`.
- `source-readiness*.ts` routes XGRIDS/opaque packages down a
  `vendor_or_opaque_package` lane; several receipts carry
  `releaseEligibility: "blocked"` and blocker codes.

The rights record must therefore include a concrete, code-level reconciliation
task: introduce an owner-authority record that the readiness/eligibility logic
reads, so `requires_review` / `blocked` can transition to an owner-cleared state
**through the existing evidence chain**, not by editing prose. Until that code
path exists, the pipeline will keep printing "blocked" no matter what the doc
says.

### [AMENDMENT R2 — data rights and software rights are different instruments]

Keep two evidence slots in the ledger, not one: (a) rights over the captured
**data**, and (b) rights over the **software / SDK / format** (LCC Studio, XGRIDS
SDKs, `.xbin`). They are typically separate agreements and a downstream reviewer
will need to point at the specific one. Reverse-engineering authority belongs to
slot (b).

---

## 2. Correct North Star

We are not building "a prettier splat viewer". We are building **the world's best
venue visual compositor** — a neural digital *set*, not one monolithic Gaussian
file, combining: measured structural truth + captured neural appearance + local
ultra-high-detail Hero Volumes + material/lighting understanding + semantic scene
intelligence + dynamic planner objects + optional, explicitly-labelled generated
cinematic beauty + browser-ready runtime derivatives.

The room must be: extraordinarily beautiful; visually stable in motion; sharp
where visual importance warrants; navigable at human scale; impossible to
accidentally escape; correctly collidable; capable of Matterport-like
cutaway/dollhouse behaviour, top-down planning, close cinematic inspection, and
lighting/event-state transitions; honest about captured vs reconstructed vs
generated content; and performant in a real browser.

Central architectural rule: **the master representation and the browser-delivery
representation are not required to be the same format.** Preserve an expensive
research-grade master, then distil/package it into browser tiers. Do not cap the
visual ceiling at whatever SPZ/SOG or today's renderer can carry.

---

## 3. Canonical Grand Hall Scene Architecture

Design present viewer work so it can evolve into this structure. Only activate
layers that actually exist; do not build empty spectacle.

```text
GrandHallScene
├── StructuralAuthority   (measured frame, E57/LiDAR refs, shell, floor, walls,
│                          ceiling, doors, windows, collision, navigation,
│                          cutaway groups, portals, planning boundaries)
├── CapturedAppearanceMaster (XGRIDS highest-quality source; independent photo
│                          reconstruction candidates; standard Gaussian master;
│                          3DGUT master candidate; Neural Harmonic Texture candidate)
├── HeroVolumes           (chandeliers, paintings/frames, carved timber, ceiling
│                          ornament, gilding, fireplaces, other critical features)
├── MaterialAndLighting   (normals, albedo, roughness, metallic/glass masks,
│                          environment lighting, physical-light metadata, neural materials)
├── SemanticSceneGraph    (room, bays, doors, windows, heritage features, planner
│                          zones, light sources, furniture, interaction volumes)
├── GeneratedDerivatives  (Fixer, ArtiFixer3D+, Gaussian SR, GR3EN relighting, Director's Cut)
├── PlannerLayers         (tables, chairs, stages, bars, décor, routes, evidence, Grand Assembly)
└── RuntimeDerivatives    (Ultra, High, Standard, Mobile, Client-safe, Cinematic)
```

The web viewer becomes a **RoomScene compositor**: "compose several spatially
registered layers according to mode, authority, quality tier and user intent" —
not "load one splat and place UI over it".

### [AMENDMENT 5 — extend the existing ADRs, do not re-invent them]

This architecture largely re-derives decisions already recorded. Reconcile with,
do not reinvent:

- `SpatialLayerDescriptor` ≈ **ADR-009 (typed spatial-layer graph, VSIR-0)**.
- Pose/frame indirection between layers ≈ **ADR-010 (pose-frame indirection)**.
- The Truth Classes in §4 ≈ **ADR-012 (provenance / truth-mode separation)**.
- "Master ≠ delivery format" ≈ **ADR-013 (format strategy)**.
- Confidence per layer ≈ **ADR-011 (Spatial Confidence Budget)**.

Read `docs/architecture/adr/` first. The compositor contract must extend these
files; a sixth parallel spatial-layer schema is a defect, not progress.

---

## 4. Permanent Truth Classes

Every visual/spatial layer carries exactly one class: `MEASURED`, `CAPTURED`,
`RECONSTRUCTED`, `ENHANCED_CAPTURED`, `GENERATED_CINEMATIC`, `PROCEDURAL_PLANNER`.

Rules: `MEASURED` may drive planning where reviewed. `CAPTURED` is visual
authority. `RECONSTRUCTED` carries confidence and provenance.
`ENHANCED_CAPTURED` must identify its real source imagery. `GENERATED_CINEMATIC`
cannot silently enter measurement, collision or planning authority.
`PROCEDURAL_PLANNER` remains editable application state. Truth Mode must expose
these distinctions. A generated derivative must never overwrite the immutable
captured master.

---

## 5. Current Technical Conclusions to Treat as Canonical

### 5.1 Diagnose the lineage before blaming reconstruction

Compare the same fixed camera views across: A native LCC reconstruction; B
highest-quality Gaussian PLY; C SOG; D SPZ; E independent viewer; F Venviewer.
Hero viewpoints: chandelier; painting/frame; carved timber; ceiling ornament;
fireplace; plain wall; room-wide; difficult oblique.

Interpretation: A/B sharp, C/D soft → compression/encoding loss. A–D sharp,
Venviewer soft → renderer/runtime loss. A/B already soft → capture/reconstruction
ceiling. Only a hero feature soft → Hero Volume / local recapture.

**No generative system before this experiment locates where quality is lost.**

### 5.2 Splat-only navigation is the wrong architecture

A Gaussian appearance layer is not responsible for collision, room volume, floor
following, wall impermeability, ceiling shell, portals, cutaway, navigation
bounds or planner coordinates. Use: **visible neural appearance + invisible
structural proxy.** The Reception Room failure was primarily structural/runtime.

### 5.3 New photographs are the strongest truthful quality source

Capture the Grand Hall like a VFX set: full-res RAW, multiple camera heights,
heavy overlap, close hero passes, bracketed HDR, colour references, grey/chrome
lighting refs, cross-polarised material captures where useful, empty and dressed
states, longer-lens/macro hero coverage. Density follows visual importance.

### 5.4 Neural Harmonic Textures — leading hypothesis, not proven

Bake-off: same images / same cameras / similar primitive budget — 3DGUT + standard
SH **versus** 3DGUT + NHT. NHT targets high-frequency, view-dependent appearance
(timber, gilding, paintings, ornament, varnish, metal, glass, reflections). It
must win a controlled bake-off before it becomes the master.

### 5.5 Hero Volumes are part of the end state

A spatially-bounded, separately-captured, high-quality local representation
(bounds / source images / camera data / local reconstruction / local material /
quality evidence / runtime LODs / provenance). Room master at distance; cross-fade
to Hero Volume up close; detailed mesh/material/neural at extreme proximity. Do
not make every square metre equally expensive.

### 5.6 Generative systems are the final polish lane

Candidates: NVIDIA Fixer; ArtiFixer / ArtiFixer3D+; Difix3D+ (R&D benchmark);
GSFixer; SplatSuRe; Gaussian SR; GaussianZoom (Director's Cut); GR3EN (lighting
transitions). Purpose: repair under-observed views, improve awkward paths, remove
artifacts, cinematic lighting, extreme hero presentation. They do not replace
professional photography or structural truth. (Reviewer note: several of these
systems postdate the reviewing model's knowledge; §5.6's own rule — nothing
becomes master without winning a controlled bake-off — is the correct guard.)

---

## 6. Correct XGRIDS Strategy

Neither "XGRIDS forever" nor "throw away all XGRIDS work". XGRIDS is one
authorised capture/import/reconstruction provider; **Venviewer owns the canonical
scene and everything downstream** (source inventory, rights record, transform
graph, quality evidence, canonical room scene, reconstruction alternatives, photo
fusion, Hero Volumes, materials, semantic graph, enhancement providers, runtime
derivation, streaming, browser composition, publishing, provenance, Truth Mode).

Support provider interfaces:

```text
ReconstructionProvider: XgridsImportProvider | GsplatProvider | ThreeDGUTProvider
                        | NHTProvider | BrushProvider | future
EnhancementProvider:    None | Fixer | ArtiFixer | GaussianSuperResolution
                        | RelightingProvider | MaterialProvider | future
```

`.xbin` reverse engineering is now technically permitted, but treat it as one
provider/ingest track, not the architecture. Do not put it on the critical path
unless evidence shows it beats: using existing exports, processing the project
normally once, or capturing an independent professional photo corpus.

---

## 7. What this session should do now

Make the viewer structurally compatible with the final architecture. Do not begin
GPU training, NHT implementation, or model reverse-engineering inside a frontend
task.

**A. Audit and preserve — done (see Amendment 1). Now report the mapping.**
Report files already changed, features implemented, current screenshots, tests,
uncommitted state (now committed), and where the implementation aligns or
conflicts with this directive.

### [AMENDMENT 2 — rebase onto master before Step D]

Insert a new step between A and B: **rebase `codex/universal-foundry` onto
current master** (or land true metres + furniture proxies another controlled way).
Do not begin structural-runtime work at `RENDER_SCALE 2.0`. Known conflicts to
resolve deliberately, not by luck:

- Migration numbering: the branch's `0062`/`0063` collide with master's
  `0062_quiz_runs`; renumber and reorder the drizzle journal.
- `RoomLayoutTimelineDock` replaces the whole `CockpitBottom` footer; master
  changed that region — reconcile, expect ~17 textual conflicts.
- `TimelinePreviewFurniture` imports `FurnitureProxy` / `InstancedFurnitureLayer`,
  both rewritten on master by `a82ef463`.

If a full rebase is too large to do safely in one pass, cherry-pick `43be45c0`
(true metres) and `a82ef463` (furniture) first so Step D runs against a correct
world, and schedule the full reconciliation as its own task.

**B. Introduce a typed room-scene composition contract.** Smallest
production-quality equivalent of `VisualAssetManifest`, `RoomSceneManifest`,
`SpatialLayerDescriptor`, `QualityEvidence`, `SourceRights`, `TransformArtifact`,
distinguishing structuralAuthority / capturedAppearance / heroLayers /
materialLayers / semanticLayers / generatedDerivatives / runtimeDerivatives /
plannerLayers / sourceRights / transforms / qualityEvidence. **Extend ADR-009/010/012/013
(Amendment 5).** Do not invent fake real assets; fixtures stay labelled as fixtures.

**C. Refactor the viewer toward a RoomScene compositor** capable of composing
AppearanceLayer / StructuralProxyLayer / CollisionLayer / HeroVolumeLayer /
SemanticLayer / PlannerLayer / CinematicDerivativeLayer. Activate only real layers.

**D. Build the structural runtime prototype on one completed room.** Use Reception
Room (or the strongest processed room). Harden: human eye height; calibrated FOV;
sensible near plane; floor following; collision capsule; room-boundary clamping;
safe spawn; escape prevention; doorway/portal handling where data exists;
orbit/dollhouse mode; cutaway/proxy fading. A splat-transform collision mesh is an
acceptable *rapid prototype* — **do not label it measured geometry** unless tied
to measured geometry. Architect so the prototype can later be swapped for an
E57/LiDAR-derived proxy without rewriting the camera/controller. (Depends on
Amendment 2 — true metres first.)

**E. Build the fixed-camera visual lineage harness.** A deterministic internal
route/tool rendering the same stored cameras across representations, recording:
source label; asset format; master/runtime lineage; exact camera transform;
resolution; DPR; Spark settings; splat budget; blur/filter settings; screenshot;
timing; asset size; GPU/frame info where accessible. Initial targets:
full-quality source, SPZ, SOG, current Venviewer runtime. If native LCC cannot
render in-app, reserve it as an external reference image tied to the same camera.

### [AMENDMENT 3 — point the harness at the right data]

- The cockpit runtime is pinned to **`Grand_Hall_Small.lcc2`** (182 MB, 52 files,
  7 SOG members, desktop 2,482,968 splats). Its on-disk path is recorded nowhere
  in the repo — **find and record it first.** The gateway will *refuse*
  `C:/GRAND_HALL_BIG_MODEL_VARIATIONS` at its manifest-name check
  (`local-sog-candidate-gateway.ts` ~1000-1006), so do not point the harness there
  expecting the current corridor to serve it.
- `C:/GRAND_HALL_BIG_MODEL_VARIATIONS` holds **9 variants**
  (`scans_BIG_MODEL_TH_GH_1..9`, 4.8 GB) — nine reconstructions of the same room.
  These are exactly the "lineage A" / Phase-4 baseline candidates. Diff them
  against each other and against SOG/SPZ at the fixed cameras. Do not treat them
  as opaque.

**F. Create integration points, not fake implementations.** Typed
placeholders/interfaces for Hero Volumes, material layers, enhancement providers,
lighting variants, generated derivatives. Do **not** implement NHT, ArtiFixer,
GR3EN or inverse rendering in this session. Create dependency-ordered tasks.

**G. Preserve `The Room Resolves`.** Extend the real-data-driven resolve
choreography so structural proxy → captured appearance chunks → hero layers →
semantic/planner layers each resolve honestly from actual load state. Do not
replace it with a fake loading animation.

---

## 8. Immediate Acceptance Criteria — GREEN only when

**Architecture:** viewer represents multiple registered layers; planner state is
separate from visual derivatives; source/provenance/truth class is explicit; no
format becomes universal internal truth by accident.

**Runtime:** the test room feels human scale (**at true metres — Amendment 2**);
the user cannot casually leave the room volume; camera motion is stable;
orbit/dollhouse works or has a concrete plan; cutaway is driven by structural
understanding, not random splat hiding.

**Visual diagnosis:** ≥1 deterministic fixed-camera comparison functional; current
runtime settings recorded; asset lineage visible; the session states whether the
viewer is throwing away source quality.

**Honesty:** no fake captured asset; no fake geometry authority; no fake
enhancement; fixtures visibly internal; no unsafe measurement/certification claim.

**Quality:** tests, typecheck, lint, production build, relevant E2E all pass;
screenshots supplied; performance measured, not guessed.

---

## 9. What not to do

Do not: restart the viewer; create a new worktree or branch; discard current
work; build a generic rewrite; implement all research tracks at once; make NHT the
runtime before testing; make ArtiFixer the captured master; treat splat-derived
collision as final measured authority; repeatedly transcode lossy assets;
hard-code the Grand Hall into architecture that should support every room; create
fake Hero Volumes; present generated imagery as captured; make a proprietary
vendor format the canonical schema; block progress on raw `.xbin` reverse
engineering; push or deploy without Blake's explicit instruction.

---

## 10. Dependency-ordered programme

- **Phase 1 — Master-lineage diagnosis** (LCC / PLY / SPZ / SOG / Venviewer,
  fixed cameras). **First task: read the LCC2 `info/poses.json` — see Amendment 4.**
- **Phase 2 — Structural authority** (E57/LiDAR room crop; clean architectural
  proxy; collision; navigation; portals; cutaway groups).
- **Phase 3 — Professional Grand Hall capture** (RAW photography; HDR; material
  references; hero features; empty and dressed states).
- **Phase 4 — Captured-master bake-off** (XGRIDS baseline; 3DGUT + SH; 3DGUT +
  NHT; gsplat + strongest clean densification; Brush portability). The 9 BIG
  variants are the XGRIDS-baseline inputs (Amendment 3).
- **Phase 5 — Hero Volume pilot** (one chandelier / carving / painting / ornament).
- **Phase 6 — Materials and lighting** (normals; albedo; roughness; masks;
  environment light; inserted-object coherence).
- **Phase 7 — Generative repair** (Fixer; ArtiFixer3D+; Gaussian SR; blind
  identity-preservation testing).
- **Phase 8 — Runtime distillery** (Ultra / High / Standard / Mobile / Client-safe
  / Cinematic direct from master).
- **Phase 9 — Foundry** (provider-neutral ingest; reverse-engineered XGRIDS adapter
  where valuable; active recapture; automated quality diagnosis; signed room packages).

### [AMENDMENT 4 — the one file that unlocks registration]

Every LCC2 variant carries `info/poses.json`: a full ~5 Hz PortalCam trajectory
(`T` translations + `R` quaternions). It is **the only on-disk candidate for
registering the splat to the E57 metric frame.** Nothing reads it today: a single
line is ~2.56 MB and exceeds `FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES`
(1 MiB), a cap sized for the Reception Room. Phase 2's first concrete task is:
**raise or stream past that cap and parse `poses.json`.** Without it, "measured
venue frame" stays a diagram. This is days of work, not months, and it gates
everything downstream in Phase 2.

---

## 11. Required documentation

Create/update per repo conventions, reconciling rather than duplicating:
`docs/strategy/grand-hall-visual-canonical-strategy.md`;
`docs/architecture/room-scene-compositor.md`;
`docs/specs/visual-asset-manifest.md`;
`docs/reports/current-viewer-super-pipeline-alignment.md`;
`docs/reports/visual-lineage-benchmark.md`. Update `docs/state/tasks.md`,
`docs/diagrams/task-graph.md`, current session log. The strategy doc must record
that project-specific Matterport and XGRIDS rights are confirmed and not an active
blocker — **and reference the code-level reconciliation task from Amendment R1,
not just the prose.**

---

## 12. Required return

Return, in this order, without private chain-of-thought and not as a plan-only:

- **DIRECT VERDICT** — what was already built; what was preserved; what changed;
  whether the viewer now aligns with the super-pipeline; what remains conceptual.
- **CURRENT WORK MAPPING** — every changed file → keep / refactor / extend / remove / defer.
- **FILES CHANGED** — exact paths.
- **TESTS** — exact commands and results.
- **VISUAL OUTPUTS** — exact screenshot and route paths.
- **RUNTIME FINDINGS** — camera scale; collision; escape prevention; cutaway;
  source/runtime quality; performance.
- **MANIFEST / ARCHITECTURE** — the implemented layer contract.
- **RIGHTS RECORD** — where the confirmed authority was recorded, including the
  code-level reconciliation (Amendment R1).
- **TASKS** — newly created/reconciled IDs and dependencies.
- **STATUS** — GREEN / YELLOW / RED.
- **HANDOFF** — exactly: COMPLETED THIS DIRECTIVE / PRESERVED FROM CURRENT SESSION
  / VERIFIED / UNVERIFIED — PLEASE CHECK / BLOCKED / REMAINING WORK / NEXT PROMPT.

---

## Amendment summary (what the review changed)

1. **Commit before all else** — done; branch committed + backed up to `F:`.
2. **Rebase onto master before Step D** — branch is 112 behind and still
   `RENDER_SCALE 2.0`; human-scale work is invalid until true metres land.
3. **Point the lineage harness at the right data** — runtime is pinned to
   `Grand_Hall_Small.lcc2` (path unrecorded) and refuses the BIG variants; the 9
   BIG variants are the Phase-4 baseline, not opaque.
4. **Read `poses.json`** — the only splat→E57 registration key; blocked by a
   1 MiB line cap; first Phase-2 task.
5. **Extend ADR-009/010/012/013** — the compositor contract re-derives existing
   decisions; reconcile, don't fork a sixth schema.
- **R1** — rights gates are machine-readable fields; add a code-level owner-authority
  reconciliation, not just prose.
- **R2** — keep separate ledger slots for data rights vs software/SDK/format rights.

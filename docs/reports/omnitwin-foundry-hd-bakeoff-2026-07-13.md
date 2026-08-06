# OmniTwin Foundry HD reconstruction bake-off

**Cutoff:** 2026-07-13  
**Status:** executable experiment design; no training or paid compute launched

## Verdict

The highest-quality independent Foundry is feasible with bounded engineering
for open future captures. Historical PortalCam projects are only partially
independent until XGRIDS supplies an official raw sensor/calibration export and
written rights. Current Grand Hall assets can support an E57-anchored owned
reconstruction experiment after rights and control gates close, but the
checked-in Config B path has never run and is presently non-runnable.

The winning system should not be one monolithic splat. It should be a
versioned, provenance-preserving stack:

1. immutable raw capture and a sensor/camera graph;
2. independently controlled E57-derived metric scaffold;
3. LiDAR-constrained captured-radiance splat for visual fidelity;
4. explicit structural, collision and hero meshes;
5. captured hero micro-splats or residual sidecars for genuine close-up detail;
6. reversible temporal deltas for later sessions;
7. generated repair/cinematic layers that cannot enter metric or captured-only
   exports.

This directly implements D-024: mesh/scaffold is structural authority; splat is
appearance authority. Generated pixels are never measurement authority.

## Contrary findings that change the plan

- Grand Hall's reported 5.76 mm frozen holdout is same-lineage consistency, not
  surveyed accuracy. Candidate cubeface centres have 11.06 mm mean and 21.19 mm
  P95 within-sweep dispersion, with a 95.68 mm maximum. Panorama faces must be
  reprocessed as rigid rigs.
- The existing 149-node release is already E57-native. The T-507 COLMAP→E57
  diagnostic is not its load-bearing release transform.
- `state/training_runs.jsonl` is empty. Config B imports a missing
  `_upstream_simple_trainer.py`, contains an unresolved vendoring placeholder,
  does not prove its CLI/config contract, does not pass an actual resume input,
  and does not emit the full D-014 artifact shape. It is a proposal, not a
  baseline.
- ReAct-GS is a detail/densification method, not a temporal update engine.
- WorldMesh is text-to-scene generation, not captured evidence recovery.
- SimFoundry is video-to-robotics simulation, not survey validation.
- `gsplat` v1.5.3 is the latest tagged release; current LiDAR/nonlinear-camera
  and newer 3DGUT changes on `main` require an audited commit pin.
- NVIDIA 3DGRUT has an official v1.1.0 release. Its README's v2-era statement
  is not backed by a v2.0.0 tag/release.
- A vendor Gaussian PLY cannot be assumed warm-startable: parameter convention,
  SH degree, coordinate frame, camera history, optimizer state and rights all
  need proof.

## Recommended representation and truth layers

```text
immutable sources
  -> CaptureGraph (sensors, rigs, intrinsics, timestamps, frames, rights)
  -> E57/independent-control registration
      -> metric_scaffold (point cloud + structural/planning/collision mesh)
      -> captured_radiance_base (LiDAR-constrained GS)
          -> captured_hero_patch sidecars
          -> temporal_delta sidecars
      -> editable_hero_meshes
      -> semantic_review_graph
      -> uncertainty/recapture graph
      -> generated_repair and cinematic derivatives (separate ACL/export mode)
  -> canonical venue package
  -> SPZ/SOG/GLB runtime derivatives
```

Every layer declares source hashes, frame/units, transform chain, uncertainty,
rights purposes, algorithm/container/commit, random seed, generated mask,
review status and allowed consumers.

## Camera and sensor graph

### Panorama rigs

Treat each six-face panorama as one physical camera rig. The face rotations and
shared centre are fixed or tightly constrained. Compare:

1. existing independent-face COLMAP poses;
2. a rigid cubeface rig;
3. native fisheye/equirectangular or nonlinear projection where calibration is
   credible.

[COLMAP rigs](https://colmap.github.io/rigs.html) and
[camera models](https://colmap.github.io/cameras.html) provide the deterministic
baseline. [3DGUT](https://research.nvidia.com/labs/toronto-ai/3DGUT/) supports
nonlinear distortion and rolling shutter but must be pinned to a tested
implementation.

### Supplemental photography and video

- Localize DSLR/phone hero photos into the frozen graph with
  [hloc](https://github.com/cvg/Hierarchical-Localization), using a commercially
  reviewed SIFT/DISK/ALIKED + LightGlue chain rather than uncleared SuperPoint.
- Group images by physical camera/lens/focus/crop state; retain RAW colour and
  lens metadata where possible.
- Calibrate rolling shutter and native distortion when evidence supports it;
  otherwise compare a pre-undistorted branch.
- Sample video by information gain, not adjacent frames. Preserve timestamps,
  stabilization/crop metadata and exposure intervals.

### Metric anchor

E57 remains the project world reference until an accepted CVF transform exists.
Project visibility-filtered LiDAR depth/normals into registered images. Never
let bundle adjustment silently move metric scale or axes; any pose refinement
must be followed by re-alignment and independent control validation.

## Approach registry

| ID | Approach | Status | Concrete test | Falsifier / blocker |
|---|---|---|---|---|
| HD-01 | LiDAR-initialized, depth/normal-constrained GS | Active after rights/control | RGB-only vs E57 init vs depth vs depth+normal on one hall sector | no held-control gain or worse P95 surface error; needs visibility-filtered E57 projections |
| HD-02 | Rigid panorama rig and native distorted cameras | Active | independent faces vs rigid rig vs native projection; inspect seams, poles, reprojection and geometry | no consistency gain or unstable calibration; current face-centre dispersion is a blocker |
| HD-03 | MCMC densification | Active | fixed-count/seed comparison against default clone-split | no held-out gain at equal compute/count |
| HD-04 | PPISP physical camera appearance | Promising | cross-device/exposure holdouts with geometry frozen | appearance improves while geometry/camera error worsens; colour metadata required |
| HD-05 | WildGaussians uncertainty/appearance | Conditional | transient masks and held-out lighting/device bins | uncertainty suppresses real architecture; dependency/weight review required |
| HD-06 | Bilateral-grid appearance baseline | Active control | same cameras/geometry against PPISP and WildGaussians | more complex method does not beat this control |
| HD-07 | DN-Splatter-style depth/normal regularization | R&D | sensor depth vs sensor depth+normals vs learned priors | worse independent surface error; optional weights/datasets not cleared |
| HD-08 | ReAct-GS / ResGS detail densification | R&D | equal-count ornament/text/thin-edge held-out crops | texture memorization, needles/floaters or licence incompatibility |
| HD-09 | Structural mesh + loose captured splats | Active | free GS vs bound GS vs scaffold+loose splats | seams, z-fighting, thin-detail loss or no runtime/editing gain |
| HD-10 | Captured hero micro-splat sidecars | Promising, novel integration | fireplace, moulding, frame, text and chandelier close-up holdouts | boundary seams or geometry exceeds metric shell |
| HD-11 | Explicit hero mesh overlays | Active | mesh vs micro-splat vs base on silhouette, parallax, residual and editability | worse geometry or visible transition at target distance |
| HD-12 | CL-Splats-like local updates | Promising/R&D | controlled add/remove/move/lighting session against full retrain | unchanged-region drift or missed changes; public implementation maturity/licence |
| HD-13 | Cross-Temporal 3DGS | Blocked | two independently processed sessions and past-state recovery | no mature official implementation established |
| HD-14 | Semantic/instance layer | Promising | human-reviewed stable IDs across views/sessions | low cross-view consistency or unstable IDs |
| HD-15 | Active recapture | Promising | ranked vs uniform vs experienced-human additions at 4/8/16/32 images | no gain per image/minute or miscalibrated uncertainty |
| HD-16 | ArtiFixer/world-model generated repair | R&D generated lane only | unsupported masks with observed/enhanced/generated comparison | heritage/text invention, inconsistency or leakage into captured/metric exports |
| HD-17 | Runtime format/LOD optimisation | Active | source PLY vs SPZ v4 vs SOG vs GLB extension at equal views/devices | source-quality loss, memory/latency failure or repeated lossy conversion |
| HD-18 | Vendor LCC/LCC2 bridge | Blocked pending written clearance | official export produces an approved open asset bundle | current XGRIDS custom terms and source rights not cleared |

Primary method evidence includes
[LI-GS](https://changjianjiang01.github.io/LI-GS/),
[LiGSM](https://arxiv.org/abs/2503.05425),
[DN-Splatter](https://github.com/maturk/dn-splatter),
[PPISP](https://github.com/nv-tlabs/ppisp),
[WildGaussians](https://github.com/jkulhanek/wild-gaussians),
[gsplat](https://github.com/nerfstudio-project/gsplat),
[ReAct-GS](https://github.com/react-gs/ReAct-GS),
[CL-Splats](https://github.com/jan-ackermann/cl-splats),
[Semantic Gaussians](https://semantic-gaussians.github.io/),
[ActiveSplat](https://arxiv.org/abs/2410.21955) and
[POp-GS](https://openaccess.thecvf.com/content/CVPR2025/papers/Wilson_POp-GS_Next_Best_View_in_3D-Gaussian_Splatting_with_P-Optimality_CVPR_2025_paper.pdf).
Research status does not imply commercial clearance; the exact decisions live
in the technology/licence matrix.

## First quantitative bake-off

### Dataset split

Do not use random adjacent frames. Freeze before tuning:

- spatially contiguous held-out arcs, corners, elevations and room sectors;
- E57 surface blocks withheld from optimisation;
- independent surveyed blind controls;
- separate panorama, DSLR, phone and video holdouts;
- hero close-up holdouts;
- one controlled second session with moved, added, removed and unchanged items;
- at least three random seeds for stochastic branches.

### Variant matrix

1. Existing vendor LCC/LCC2 visual baseline, only if rights permit internal use.
2. Clean tagged `gsplat` v1.5.3 baseline with owned entry point.
3. Audited `gsplat` commit with MCMC + 3DGUT.
4. E57 initialization only.
5. E57 initialization + projected depth.
6. E57 depth + normal/surface constraints.
7. Independent cubefaces vs rigid rig vs native projection.
8. No appearance model vs bilateral grid vs PPISP vs conditional WildGaussians.
9. Default/MCMC/detail densification at equal counts and compute.
10. Free GS vs structural-mesh hybrid.
11. Base vs captured hero patch vs explicit hero mesh.
12. Full retrain vs local change-restricted update.
13. Source master vs SPZ/SOG/GLB/KHR runtime derivatives.
14. Generated direct/3D/postprocessed outputs only in a separate generated lane.

### Decision rule

No method wins on PSNR alone. An appearance winner needs a positive paired
bootstrap lower confidence bound, no material regression across at least 80%
of spatial blocks, and no geometry/control regression. Hero layers should
improve held-out ROI perceptual/detail quality by at least 10% without exceeding
the accepted geometry envelope or causing visible boundaries. These are
starting engineering gates, not published method claims.

## Quality contract

### Registration and geometry

- reprojection error P50/P95, inlier rate and track length;
- rig-centre/rotation consistency and panorama seam/pole error;
- independent control vector, XY, Z, mean, median, RMSE, P95 and maximum;
- bidirectional point-to-surface accuracy/completeness;
- F-score at 5/10/20 mm where control uncertainty permits;
- surface residual P50/P95/P99 and normal angular error;
- walls/floors/openings/edges/chamfers by spatial stratum;
- topology, manifoldness, watertightness only where the artifact purpose needs it;
- planning/collision/navmesh purpose tests, never inferred from visual quality.

### Appearance and hero detail

- PSNR, SSIM, LPIPS and DISTS in managed/linearized colour;
- results by device, exposure, spatial block, transient mask and hero ROI;
- cross-view depth-warp photometric/feature consistency;
- edge-spread/MTF or equivalent high-frequency preservation;
- ornament/text/keypoint repeatability and silhouette error;
- patch boundaries, z-fighting and LOD transitions;
- blinded fixed-view human review against source evidence.

### Updates, semantics and active capture

- changed-region IoU and add/remove completeness;
- unchanged-region geometry/appearance drift and prior-state recovery;
- delta storage and update time;
- human-reviewed semantic mIoU/instance AP and stable-ID consistency;
- quality gain per added image, capture minute and walking distance;
- predicted versus realised gain and uncertainty calibration.

### Runtime and operations

- first useful frame, frame-time P50/P95, GPU/RAM/VRAM and model bytes;
- source-to-runtime quality loss by representation;
- desktop/mobile/headset tiers, streaming gaps and cache behaviour;
- wall time, GPU hours, peak resources, checkpoint/resume and cancellation;
- exact code/container/dependency/seed/input/output hashes and rights decision.

### Generated lane

- observed-support percentage and generated-region masks;
- multi-view cycle consistency and temporal flicker;
- protected text/signage/artwork/heritage review;
- model/checkpoint/version, prompts/conditions, seed and source IDs;
- enforced exclusion from metric, planning, collision and captured-only exports.

## “Just works” processing graph

1. **Create project:** choose venue/room, purpose and exposure; no technical
   parameters required.
2. **Drop or grant folders:** E57/LAS/PLY, photos/panoramas/video/RGB-D,
   OBJ/GLB/USD, CAD/BIM and approved vendor exports are signature-detected.
3. **Inspect:** immutable hashes, metadata, camera/sensor groups, calibration,
   coordinate frames and rights purposes are shown before processing.
4. **Resolve blockers:** plain-language cards request only missing human facts:
   rights, room identity, control, calibration, ambiguous scale or unsafe paths.
5. **Plan:** the quality router proposes metric, visual, semantic, hero,
   generated and runtime branches with expected resources/cost.
6. **Run:** resumable content-addressed stages execute locally when they fit or
   submit the same recipe to an approved provider after explicit confirmation.
7. **Compare:** fixed views, geometry heatmaps, uncertainty, costs and runtime
   profiles compare variants without hiding failures.
8. **Recapture:** exact pose/height/yaw/pitch/lens/lighting actions show expected
   gain and safety/access constraints.
9. **Review:** metric, captured, enhanced and generated truth layers are
   independently approved or rejected.
10. **Package:** immutable canonical assets and runtime derivatives are created.
11. **Hand off:** only existing T-486 can register evidence, review, sign,
    publish and promote.

Beginner mode follows those stages. Expert mode exposes the captured graph,
calibration, parameters, logs, manifests and failure evidence without changing
the same underlying JobSpec.

## Local and cloud execution

The canonical JobSpec and stage artifacts remain provider-independent. Every
worker is an exact OCI image/commit with declared CPU/RAM/GPU/VRAM/disk/network,
input/output contracts, checkpoint interval, wall-time estimate and cost cap.

Local dispatch requires a deterministic fit estimate and enough free resources.
Remote dispatch requires a validated provider plan, trusted rights approval,
short-lived execution confirmation, explicit budget and kill switch. Long
training should use durable external object storage and resumable GPU pods;
RunPod Serverless request/result retention is not a substitute for durable
training checkpoints. Provider code must not enter reconstruction algorithms.

No current job is approved for training or paid compute.

## Grand Hall first pilot

Grand Hall remains the strongest flagship pilot only after three preconditions:

1. independent control is captured;
2. Matterport processing/training purposes are legally resolved;
3. panorama rigs are rebuilt and the release scope is chosen.

Then run a bounded representative sector first, not the entire 20.5 GB capture:

- immutable E57 and registered-camera subset;
- one wall/floor/door region, one reflective/difficult region and one hero
  ornament/fireplace/chandelier region;
- clean MCMC/3DGUT baseline;
- E57 depth and normal variants;
- rigid-rig comparison;
- bilateral/PPISP appearance comparison;
- one captured hero patch and one explicit hero mesh;
- SPZ/SOG/GLB runtime exports;
- fixed-view, independent-control, surface, hero and runtime reports.

Go only if the owned/hybrid branch beats the approved vendor baseline on held
views without geometry regression, the hero layer survives novel grazing views,
and runtime derivatives meet target device budgets. Otherwise recapture or keep
the vendor/hybrid bridge; do not manufacture a win with generated pixels.

## Programme

### Next 24 hours

- freeze the T-507/T-486 offline dossier and blockers;
- replace the false Config B capability statement with a repair checklist;
- add the rig-aware camera diagnostic to future alignment reports;
- request Matterport/XGRIDS/reference-image decisions and independent control;
- select a Grand-Hall-only or whole-release evidence scope.

### Next 7 days

- vendor a complete, pinned and checksummed trainer dependency set;
- implement an owned trainer entry point and prove config import without GPU
  training;
- create rigid panorama rigs and compare registration diagnostics;
- implement E57 visibility/depth/normal projection fixtures;
- freeze bake-off splits, metrics, fixed views and rights policy.

### Next 30 days

- capture independent control and cleared hero photos;
- run a rights-approved bounded GPU smoke only after explicit owner approval;
- complete the sector bake-off and hero mesh/micro-splat comparison;
- package the winning captured layers privately through the existing Foundry.

### Next 90 days

- capture one complete venue room with a fully open sensor protocol;
- prove two-provider JobSpec parity and preemption/resume;
- calibrate active recapture against uniform and expert capture;
- ship a cross-platform operator vertical slice after one of three grounded
  visual directions is selected and tested.

## Explicitly planning-only

No reconstruction algorithm, UI, cloud integration, model checkpoint or paid
training run is implemented by this report. The safe implementation in this
slice is the strict offline review-package contract and its boundary tests.

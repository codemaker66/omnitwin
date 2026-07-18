# OmniTwin Foundry one-room pilot: Grand Hall

**Recommendation:** Continue with Grand Hall under the bounded T-507 scope.
Decision `B` confirms only sweeps 000/010/020/040 as Grand Hall and excludes
049 as adjacent space; it does not classify every candidate sweep 0–48.

**Fallback:** Reception Room only if later full-scope classification contradicts
the bounded Grand Hall selection, or if near-term runtime parity is the only
objective.

**Execution status:** T-507 identity-gated ingest and alignment diagnostic are
complete; the reconstruction/training/runtime pilot has not run. T-508 is the
exact next task.

## Why Grand Hall

Grand Hall uniquely combines:

- metric Matterport E57 geometry with posed embedded imagery;
- 300 derived 1024x1024 JPEG cubefaces from the first 50 sweeps, distinct from the embedded 4096x4096 E57 images;
- an existing COLMAP solution with 231 registered image poses sharing one PINHOLE camera model;
- saved deterministic COLMAP-to-E57 reproduction evidence and a proposed,
  unreviewed authority-none transform; no independent control or reviewed
  TransformArtifact exists;
- two PortalCam raw projects for sidecar comparison;
- an XGRIDS Gaussian PLY, mesh, timestamped poses and LCC2 SOG benchmark.

Reception has stronger immediate web exports and a full-SH source master, but it cannot test independent reconstruction from authorized original imagery as directly.

## Phase 0 gates

### GH-IDENTITY

T-507 rendered all six cubefaces for scan indices 0, 10, 20, 40 and 49:

    COLMAP_PILOT_ROOT/images/scan_000_{front,back,left,right,up,down}.jpg
    COLMAP_PILOT_ROOT/images/scan_010_{front,back,left,right,up,down}.jpg
    COLMAP_PILOT_ROOT/images/scan_020_{front,back,left,right,up,down}.jpg
    COLMAP_PILOT_ROOT/images/scan_040_{front,back,left,right,up,down}.jpg
    COLMAP_PILOT_ROOT/images/scan_049_{front,back,left,right,up,down}.jpg

The user's decision `B` confirms the Grand Hall identity of anchor sweeps 000,
010, 020 and 040 and identifies 049 as adjacent space. Sweep 049 is excluded
from the 0–48 candidate. The exact internal review digest is
`sha256:11a58296a03d907578c09c37f15dc97ac529e8c785d88e5dc1409d7bfba47ca2`.
This is not a claim that every sweep 0–48 has been classified, and it is not an
externally authenticated venue-authority attestation. Those remain T-508 gates.

### RIGHTS

Before any image-based training:

- determine whether the embedded/exported cubefaces are Matterport Data under the 2026 AI-training restriction;
- confirm customer/client rights for E57 and derived outputs;
- approve or exclude XGRIDS PLY/SOG/LCC2/poses under the custom format/source terms;
- retain XGRIDS outputs as a benchmark only if training/refinement is not authorized.

Geometry-only inspection/alignment can proceed only within the approved use scope.

### REPO

Reconcile/snapshot T-486 so this pilot extends the existing Reconstruction Foundry rather than creating a second publisher. The v0 shared schemas may be used immediately; worker/CLI additions wait for the ownership boundary.

## Frozen inputs

### Metric and image source

| Asset | Public-safe locator | Evidence |
|---|---|---|
| Matterport E57 | E57_ASSET_ROOT/cloud_0.e57 | 20,518,437,888 bytes; 149 scans; 965,520,000 raw point records; valid total not computed; 894 posed images |
| first-50 cubefaces | COLMAP_PILOT_ROOT/images/scan_000_*.jpg through scan_049_*.jpg | 300 derived 1024x1024 JPEGs, six per sweep; source compression/lineage must remain explicit |
| COLMAP database | COLMAP_PILOT_ROOT/database.db | full SHA-256 recorded in the private evidence inventory |
| sparse camera model | COLMAP_PILOT_ROOT/sparse/0/cameras.bin | one PINHOLE camera ID; full SHA-256 recorded privately |
| sparse registered images | COLMAP_PILOT_ROOT/sparse/0/images.bin | 231 registered image poses; full SHA-256 recorded privately |
| sparse points | COLMAP_PILOT_ROOT/sparse/0/points3D.bin | 124,617 points; full SHA-256 recorded privately |

T-507 froze exactly 308 read-only assets: one E57, 300 cubefaces, one
COLMAP database and six sparse/configuration files. The manifest semantic digest
is
`sha256:583b4fd025bb00e28a14683c8fcbeee2cb1e0091bdbd968acd1176b9090187c0`.
The historical derivation/compression lineage of the cubefaces and COLMAP bytes
remains unverified; the manifest does not invent provenance edges.

Use `COLMAP_PILOT_ROOT` as canonical for the pilot. `COLMAP_DUPLICATE_CANDIDATE_ROOT` must not be mixed into the inventory until full-tree hash equivalence is recorded.

The E57 count above is a record count, not a valid-point count. A read-only scan-0 spot check found 5,205,250 valid and 1,274,750 invalid records out of 6,480,000. Compute and persist the full valid total before using density/completeness claims.

### Vendor benchmark, conditional

Root:

    LCCSTUDIO_GRAND_HALL_OUTPUT_ROOT

Inputs:

- ply-result\point_cloud\iteration_100\point_cloud.ply — 4,985,059 Gaussians, DC-only; full SHA-256 recorded privately;
- mesh\mesh.ply — simplified vendor mesh;
- mesh\mesh_raw.ply — denser vendor mesh;
- render\assets\poses.json — timestamped vendor poses;
- render2\data\3dgs\*.sog — 19 scene chunks plus `env.sog` (20 files total);
- render2\data\mesh\*.ply — vendor LCC2 mesh chunks.

Do not use the private `GRAND_HALL_VENDOR_PROJECT` LCC/LCC2 containers directly unless the legal/format gate authorizes them. Prefer the already exported payloads. The vendor mesh/splat is not metric authority.

### Historical raw sidecars, diagnostic only

Root:

    XGRIDS_GRAND_HALL_RAW_ROOT

Allowed inventory evidence:

- project_data\poses.csv;
- project_data\log\data.ulg;
- project_data\model\metadata.json and preview point cloud;
- redacted project metadata.

The xbin and encrypted calibration entries are preserved but excluded from processing.

## Held-out policy

T-507 froze sweep 049 as reproduction-only and excluded it from the candidate.
The 0–48 diagnostic uses held-out sweeps `[5,15,25,35,44]`. The proposed fit is
reported at scale `1.7362021512269856` and candidate RMSE
`0.010604176377772601` m; the five-sweep holdout RMSE is
`0.005756579517772495` m. These values demonstrate shared-lineage internal
self-consistency only. They are not independent surveyed accuracy or an image
train/evaluation result, and the transform remains proposed/unreviewed with no
runtime or public authority. The distinct historic all-50 reproduction used
scale `1.7362602880766593` and RMSE `0.010670586778897446` m; those values do
not describe the proposed 0–48 candidate.

Retain for subsequent tuning:

- all down faces excluded from the existing sparse solution remain diagnostic and cannot be silently converted into training views;
- reserve at least one registered face per ten sweeps, stratified by direction and room location;
- retain the exact complete-sweep holdout `[5,15,25,35,44]` for the frozen
  diagnostic and define any later image-evaluation holdout separately;
- do not optimize camera poses against held-out image pixels;
- keep at least three independent control distances/landmarks out of alignment;
- record exclusions, duplicates and failed registrations.

No LCC/vendor camera view is a held-out source view unless the underlying image and camera are independently available.

## Operator workflow

1. T-507 completed the bounded read-only project/input setup.
2. T-507 completed signature/bounded metadata inventory; rights remain open.
3. T-507 completed the internal anchor decision described in GH-IDENTITY;
   external attestation and full-scope classification remain open.
4. T-507 emitted the frozen 308-asset `FoundryIngestManifestV0`.
5. T-507 froze the E57 frame and COLMAP camera convention used by the diagnostic.
6. T-507 reproduced the similarity fit and residuals. T-508 must obtain
   independent control and human review before any typed TransformArtifact,
   residual report or reviewer attestation is approved.
7. Create room boundary and room-local frame.
8. Run deterministic geometry lanes.
9. Run appearance lanes only after RIGHTS and TRAINER gates.
10. Capture one owned hero feature if allowed/available.
11. Propose/review semantics and recapture instructions.
12. Compare fixed views, metric residuals and runtime traces.
13. Assemble canonical venue package and private release candidate.
14. Human review; no public promotion in this pilot.

## Planned job graph

| Stage | Image/tool candidate | Resources | Checkpoint | Output |
|---|---|---:|---|---|
| inspect | owned inspector + libE57Format/PDAL | 4 CPU, 16 GiB RAM, 100 GiB scratch | stage | inventory, hashes, rights/frame unknowns |
| extract-authorized-images | owned E57 adapter | 8 CPU, 32 GiB, 100 GiB | per scan | lossless authorized cubeface artifacts + metadata |
| reproduce-alignment | owned NumPy/Open3D/COLMAP adapter | 8 CPU, 32 GiB, 50 GiB | stage | matrix, median/RMSE/p95/max, overlap |
| control-review | owned QA | 4 CPU, 16 GiB | stage | proposed/reviewed transform plus typed residual and reviewer-attestation assets |
| lidar-mesh | Open3D TSDF + PoissonRecon | 32 CPU, 128 GiB, 500 GiB | tiles/stage | measured/planning/collision candidates |
| photo-mesh | COLMAP MVS or AliceVision | 16 CPU, optional 1x24 GiB GPU, 128 GiB, 1 TiB | dense/mesh | detailed textured candidate |
| independent-splat | gsplat or 3DGRUT under accepted D-016 | approved RunPod 1x24–80 GiB GPU plan; exact fit measured before approval | periodic | unquantized visual master + D-014 bundle |
| hero-layer | gsplat or photogrammetry | 1x16–24 GiB GPU, 32 GiB, 100 GiB | periodic | hero splat/mesh and local transform |
| semantics | SAM 2 proposal + owned projection | 1x16–24 GiB GPU, 32 GiB | batch | proposed graph/masks/confidence |
| runtime | SplatTransform/SPZ/SOG + meshoptimizer | 8 CPU, 32 GiB | artifact | GLB, SPZ/SOG candidates |
| qa-package | owned QA/packager | 8 CPU, 32 GiB | stage | reports, authority map, canonical package |

Exact image digests and native versions must be populated before execution. Table values are planning envelopes, not measured consumption.

## Planned commands

These are target CLI contracts after T-486 reconciliation; they are not claimed to exist yet:

    pnpm reconstruction:foundry -- inspect --project grand-hall-pilot --root E57_ASSET_ROOT --read-only
    pnpm reconstruction:foundry -- validate-manifest --manifest <derived-project>\ingest-manifest.json
    pnpm reconstruction:foundry -- plan-job --manifest <derived-project>\ingest-manifest.json --pipeline grand-hall-v0 --provider local_cpu
    pnpm reconstruction:foundry -- plan-job --manifest <derived-project>\ingest-manifest.json --pipeline grand-hall-v0 --provider runpod --plan-only

Execution must be a second explicit command/action and is out of scope until approval. Native worker commands live inside digest-pinned JobSpec argv arrays, not shell snippets in operator documentation. **No executable pilot JobSpec exists:** T-507 supplies the bounded ingest-manifest digest, but full-scope classification, external identity attestation, stage `rightsPurposes` and passing `validateFoundryJobRights`, worker image digests, validated provider plan, trusted `FoundryRightsApproval`, fresh subject-bound `FoundryExecutionConfirmation`, a durable atomic confirmation-consume store, `computeApprovalId` and trusted compute approval are unresolved. The displayed commands are interface sketches only.

Existing safe verification commands:

    pnpm --filter @omnitwin/types exec vitest run src/__tests__/omnitwin-foundry.test.ts
    pnpm --filter @omnitwin/types typecheck

## Geometry comparison

Produce:

- E57 reference cloud tiles;
- TSDF surface;
- screened-Poisson surface at two resolutions;
- COLMAP/AliceVision photo mesh;
- hybrid detail projected/registered to the measured frame;
- bounded manual correction record for any critical defect.

Measure control error, symmetric residual median/RMSE/p95, overlap, room dimensions, thin structures, ceilings/ornament, topology, collision suitability and runtime LOD behavior. Do not require the visual mesh to be collision authority.

## Appearance comparison

Use identical reviewed cameras and fixed views:

1. vendor DC-only Gaussian PLY source;
2. vendor SOG runtime;
3. independent gsplat;
4. independent 3DGRUT if selected;
5. measured mesh + photo/PBR;
6. mesh + independent splat;
7. base + one hero micro-splat/mesh;
8. optional licensed generated cinematic derivative, never in the captured comparison.

Report PSNR/SSIM/LPIPS on true held-outs, colour/detail, temporal stability, geometry consistency, source/runtime loss and blinded human preference. A visual winner still needs the metric authority layer.

Freeze the evaluation camera set and connected camera paths as versioned artifacts: image/pose IDs, camera model, source resolution, crop, exposure policy, keyframes, path segments and loop/room-graph connectivity. Report gaps, path discontinuities and collision/nav authority separately from frame quality.

## Semantic and recapture slice

Propose at minimum:

- room boundary;
- doors/windows;
- walls/floor/ceiling;
- stairs/lifts if present;
- fireplace, chandelier and artwork;
- furniture and stage/bar if present;
- power/AV/service/restricted/heritage features where observable.

Human reviewers correct labels and time the task. The uncertainty map then issues five exact recapture prescriptions. If site access is possible, collect them and measure actual held-out gain; otherwise mark the intervention unverified.

## Outputs

| Output | Required |
|---|---|
| canonical ingest inventory | yes |
| venue and room frames | yes |
| reviewed TransformArtifact + residual report + reviewer-attestation asset | yes |
| measured/planning/collision meshes | yes |
| visual master | yes after rights/trainer gates |
| one hero micro-splat or hero mesh | yes if owned recapture available; otherwise blocked |
| semantic room graph | yes, human-reviewed |
| uncertainty and recapture map | yes |
| `camera_spawn_points` and `room_connectivity` JSON representations | yes |
| `guided_camera_paths` JSON representation | yes for the pilot comparison, although optional in the generic package schema |
| fixed-view source/method/runtime sheet | yes |
| GLB plus splat runtime package | yes |
| Scene Authority Map and provenance | yes |
| repeatable JobSpecs and environment digests | yes |
| Venviewer private load | yes |
| public promotion | no |

## Acceptance gates

1. Decision B remains bound to the exact internal identity digest, 049 remains
   excluded, every node/sweep in the intended 0–48 scope is classified, and an
   external venue-authority attestation is obtained; stage-specific rights
   validation passes and a trusted `FoundryRightsApproval` covers the exact
   JobSpec and canonical ingest-manifest digest.
2. Every asset entering `FoundryIngestManifestV0` has a full SHA-256; sample-fingerprint-only discoveries remain outside the manifest.
3. The T-507 alignment reproduction, matrix, correspondences, per-pair
   residuals and method remain immutable inputs. RMSE <= 0.020 m and p95 <=
   0.035 m are provisional self-consistency gates only; independent controls
   and a reviewed transform with typed TransformArtifact, residual-report and
   reviewer-attestation assets are required for any metric-purpose claim.
4. The purpose-specific profile definition digest resolves through a trusted immutable registry; its geometry profile passes with no critical collision/topology defect.
5. Held-out policy is frozen and no pose/image leakage occurs.
6. Visual claim uses metrics plus blinded fixed-view review.
7. Hero layer is seamless at fixed path and does not change metric authority.
8. Semantic proposals have confidence/provenance and human decisions.
9. Generated content, if any, has complete masks/licence/disclosure and stays separate.
10. Runtime meets declared desktop budget and attributes source-versus-codec loss.
11. Canonical package validates and resolves assets, frames, transforms, authority, quality, lineage, semantic graph, camera spawn points and room connectivity; guided paths resolve through that graph.
12. Private release handoff succeeds without using the legacy ungated publication path.

## Cost and time envelope

| Phase | Expected effort | External compute |
|---|---:|---:|
| T-507 identity/inventory/alignment reproduction | complete | £0 |
| T-508 external attestation, rights, full-scope classification and independent control | review/acquisition dependent | no spend approved by this document |
| deterministic geometry | 3–7 engineer-days | £0 local |
| trainer repair/non-training contract and import smoke | 2–5 engineer-days | £0 local |
| approved D-016 minimal RunPod smoke | bounded plan after local proof | no approval or cost granted by this document |
| visual/hero/semantic bake-off | 1–3 engineer-weeks | deterministic/semantic work local first; splat training only through approved D-016 lane |
| optional approved remote experiments | hours to days | estimate at plan time; likely tens to low hundreds USD per bounded run |

No remote cost is approved by this document. Provider pricing is volatile and must be fetched at plan time with a cap and kill switch.

## Rollback and stop rules

- Raw sources are never changed or deleted.
- Failed attempts remain in quarantined derived prefixes and are removable only after path verification.
- A rejected transform/quality report remains evidence and cannot be overwritten.
- If full-scope classification contradicts the bounded anchor decision, stop
  Grand Hall work and select Reception without repurposing Grand Hall labels.
- If rights fail, exclude the affected imagery/vendor asset and continue geometry/open-capture work.
- If trainer gate fails, stop before any remote job.
- If an owned method does not beat the vendor, keep the vendor bridge while recapture/architecture hypotheses continue.
- A bad runtime candidate never reaches the production pointer; downstream release rollback remains available.

## Pilot decision

The pilot succeeds when it proves the controlled, repeatable path—not when it produces the prettiest screenshot. A successful result may legitimately be “measured geometry and package work, but historical visual training is legally blocked.” That still de-risks prospective independence.

The exact next task is T-508. Preserve the immutable T-507 manifest, identity
digest, diagnostic and holdout; do not rerun T-507 or upgrade its shared-lineage
self-consistency to independent accuracy.

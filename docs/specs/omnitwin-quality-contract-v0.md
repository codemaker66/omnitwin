# OmniTwin quality contract v0

**Schema IDs:** omnitwin.foundry.quality-contract.v0 and omnitwin.foundry.quality-report.v0

**Runtime validator:** packages/types/src/omnitwin-foundry.ts

## Principle

Quality is a vector of purpose-specific, evidenced requirements. A weighted average cannot hide failed metric control, runtime collapse, semantic error or missing provenance.

Profiles:

- research: exploratory and non-authoritative;
- internal_visual: controlled staff use;
- planning: dimensional/operational use;
- public_release: reviewed public visual use;
- premium_headset: high-end visual/runtime use;
- custom: client/use-case-specific.

Every contract declares `profileDefinitionId` and `profileDefinitionSha256`; a release system must resolve that digest against a trusted immutable profile registry so a friendly label cannot silently change thresholds. The fields alone do not prove registry approval. Every requirement declares dimension, metric, comparison, threshold, unit, scope, required flag and one or more typed evidence kinds from the ingest evidence vocabulary. Every report records raw value, status, evidence and caveat. A pass requires every mandatory metric and every contract-required human review.

Profile baselines are structural minimums, not sufficient release criteria:

| Profile | Required dimensions | Human-review baseline |
|---|---|---|
| research | contract-defined | optional unless the contract requires it |
| internal_visual | appearance, runtime, provenance | at least one required review |
| planning | geometry, provenance | at least one required review |
| public_release | geometry, appearance, runtime, semantics, provenance | at least one required review |
| premium_headset | geometry, appearance, runtime, semantics, provenance | at least one required review |
| custom | contract-defined | at least one required review |

All non-research profiles therefore require a non-empty `requiredHumanReviews` list. Profile parsing verifies these baselines but does not decide whether the underlying evidence exists or is authoritative.

## Source-accuracy evidence tiers

These tiers classify evidence, not brands or device classes:

| Tier | Required evidence | Allowed claim posture |
|---|---|---|
| U0 unknown | missing units, frame, calibration or lineage | inventory/research only |
| U1 internally registered | self-consistency/loop residuals, no independent control | visual/internal experiment only |
| U2 measured reference | metric source plus reviewed transform and stratified residuals | bounded dimensional comparison for a declared purpose |
| U3 independent control | held-out surveyed/control observations and uncertainty | planning/operational use only if its profile passes |
| U4 certified procedure | calibrated instruments, named method/reviewer and current certificate | only the certified scope |

An E57, LiDAR, CAD or vendor label never assigns a tier by itself. Tiers can differ by room/region and degrade when a transform, crop or derivative loses evidence.

Every source class starts at U0 until its row's evidence is present. “Evidence-backed starting tier” below is the first tier normally attainable after that evidence is reviewed, not a brand entitlement or a permanent ceiling.

| Source class | Evidence-backed starting tier | Required evidence | Forbidden claim at that tier | Decisive escalation |
|---|---|---|---|---|
| surveyed control | U3; U4 only for the certified scope | raw observations, instrument/calibration record, named datum/CRS/epoch, adjustment and held-out checkpoints | “certified” outside the named current procedure/scope | current certificate, calibrated instrument, documented procedure and reviewer → U4 |
| Matterport Pro3 / registered E57 | U1 | explicit units/frame, complete scan poses, registration/self-consistency residuals and export lineage | survey-grade, certified or independent-control accuracy from brand/export alone | reviewed transform plus measured reference → U2; held-out independent surveyed controls → U3 |
| handheld LiDAR | U1 | device/calibration profile, timestamps/trajectory, units/frame, loop/internal residuals and motion caveats | planning accuracy or drift-free geometry from device class alone | measured reference with stratified residuals → U2; held-out surveyed controls → U3 |
| phone LiDAR | U0–U1 | device/depth-scale record, frame/units, trajectory/loop evidence and drift/coverage report | survey, clearance or room-dimension authority from AR output alone | independent measured dimensions/control and reviewed transform → U2 |
| calibrated photogrammetry | U1 | source lineage, intrinsics/distortion, registered poses, reprojection/loop evidence, held-outs and explicit scale/frame | metric accuracy from low reprojection error or image count alone | measured scale/reference with stratified geometry residuals → U2; held-out surveyed controls → U3 |
| ordinary video | U0–U1 | codec/keyframe lineage, intrinsics, rolling-shutter/clock policy, VIO/SfM registration and explicit scale/frame | stable metric geometry or temporal completeness from frame count alone | calibrated capture plus measured anchor/residual report → U2 |
| unscaled image collection | U0 | byte/source lineage and an explicit declaration that scale/frame/calibration are unknown | any dimensional, planning or coordinate-authority claim | calibrate/register and add a reviewed metric scale/control anchor; then reassess for U1/U2 |

Derived meshes, splats and runtime encodings inherit no higher tier than their source/transform evidence and may drop lower when conversion loses units, frame, calibration or lineage.

## Geometry measures

| Metric | Method |
|---|---|
| control-point error | independent surveyed checkpoints excluded from alignment; report per-point, mean, median, RMSE, p95 and max |
| cloud alignment | symmetric point-to-plane/point residual with stratified floor/wall/ornament samples; median/RMSE/p95 |
| overlap | percentage of evaluated surface within distance and normal thresholds |
| room dimensions | independent distances/clearances; absolute and percentage error |
| local surface deviation | stratified planar, curved, thin and hero regions |
| topology | non-manifold edges, self-intersections, holes and connected components |
| watertightness | binary/percentage only where consumer requires volume |
| scale/loop closure | ATE/RPE or closure error, plus abrupt correction checks |

Do not let large planar walls dominate the sample. Glass, mirrors, chandeliers, railings, ceilings and hidden surfaces are named strata and caveats.

## Appearance measures

| Metric | Method |
|---|---|
| PSNR / SSIM / LPIPS | true held-out source views with no pose/image leakage |
| colour consistency | chart/neutral surfaces and cross-view delta |
| edge/detail | controlled high-frequency regions and perceptual crops |
| novel-view stability | camera path temporal shimmer/floaters/popping |
| hero review | blinded fixed-view comparison at explicit focal distance |
| geometry consistency | held-out depth/mesh reprojection, epipolar/depth consistency |

Exposure and tone assumptions must match across methods. Training views are never presented as held-out evidence. Freeze camera artifacts with image/pose ID, model, intrinsics/distortion, source resolution, crop, exposure/colour policy and held-out role. Freeze path artifacts with ordered keyframes, segment IDs, loop/room-graph connectivity and intended speed. Report disconnected coverage, path discontinuities and temporal artifacts separately from fixed-frame scores.

## Runtime measures

- source and runtime byte size;
- first useful frame and full-load time;
- p50/p95 frame time and sustained FPS;
- peak browser RAM and GPU memory;
- HTTP request count, range efficiency and streaming gaps;
- cache cold/warm behavior;
- desktop, mobile and headset profiles;
- LOD transition artifacts;
- mesh/splat composition correctness;
- repeated-lossy-transcode detection.

Record renderer/library/version, browser, OS, GPU/driver, viewport, device pixel ratio, antialiasing, blur/preblur and camera path. A runtime result without these conditions is not comparable.

## Semantic measures

- per-class precision, recall, F1 and boundary IoU;
- cross-view and cross-session identity stability;
- confidence calibration/ECE by class;
- false positives on reflective/transparent/repeated objects;
- operator corrections, correction time and rejected proposals;
- route/restricted-zone graph validity.

Machine-generated semantics remain proposed until a human review record approves them.

## Provenance measures

A report verifies:

- complete source hashes and source-rights decisions;
- transform chain and residual artifact;
- worker image/tool/model/checkpoint versions;
- configuration, deterministic seed and environment digest;
- generated-region masks, prompts/conditions digest and restrictions;
- fixed-view definitions and held-out split;
- reviewer identity, role, decision and time;
- runtime derivation from the unquantized master.

Each `FoundryQualityHumanReview` records `reviewKind`, `reviewerId`, `reviewerAttestationAssetId`, `decision`, `reviewedAt`, one or more `evidenceAssetIds` and a substantive note. The attestation is an asset reference, not an unaudited name or checkbox.

After schema parsing, `validateFoundryQualityEvidence(report, catalog)` must first match the contract's profile, definition ID and definition SHA-256 against a trusted profile registry entry. It then resolves every subject, measurement-evidence, review-evidence and reviewer-attestation asset against the trusted catalogue. Each declared measurement evidence kind must occur on at least one referenced evidence asset; reviewer attestations must be typed `reviewer_attestation`, and a `fixed_view` review requires typed fixed-view evidence. The validator also enforces the contract's generated-content policy: generated subjects are forbidden, reported separately from captured subjects, or backed by generated-region mask provenance, according to `generatedContentPolicy`. Schema parsing alone is not a release gate, and a production control plane still needs an immutable approved profile registry.

## Suggested Grand Hall pilot gates

These are provisional experiment thresholds, not universal product promises or surveyed certification.

| Requirement | Proposed threshold | Evidence |
|---|---:|---|
| COLMAP/E57 alignment RMSE | <= 0.020 m | reproduced residual report |
| alignment p95 | <= 0.035 m | reproduced residual report |
| evaluated overlap | >= 90% | stratified cloud report |
| independent room dimensions | <= 0.030 m or 0.5%, whichever is larger | controls excluded from solve |
| required planning topology | 0 critical non-manifold/collision defects | mesh QA |
| held-out camera registration | >= 90% of frozen eligible set | split and COLMAP report |
| novel-view appearance | no method wins on PSNR alone | PSNR/SSIM/LPIPS + blinded review |
| hero fixed views | all priority views approved; no unresolved structural artifact | human review |
| runtime desktop | target FPS/VRAM declared before test | trace |
| provenance | 100% mandatory artifact references resolved | manifest validator |

T-507 made the diagnostic reproducible: it froze the exact 308-asset input set,
the all-50 reproduction, proposed 0–48 fit, per-sweep residuals and shared-lineage
holdout `[5,15,25,35,44]`. The proposed candidate's
`0.010604176377772601` m fit and `0.005756579517772495` m holdout therefore
prove only deterministic internal self-consistency. They cannot satisfy these
pilot gates until every intended 0–48 node has externally authenticated room
identity, independent controls and stratified overlap/residual evidence exist,
and a typed TransformArtifact, residual report and reviewer attestation are
approved. Neither value is surveyed accuracy or an accuracy certificate.

## Quality report states

- passed: all required metrics passed and all required human reviews approved;
- failed: measured evidence violates at least one required gate;
- requires_review: machine gates may pass but human/rights/authority review is incomplete;
- blocked: mandatory evidence cannot currently be obtained.

not_measured and not_applicable require a caveat. A mandatory not_measured result cannot coexist with passed.

## Adversarial evaluation protocol

1. Freeze source hashes, allowed rights and camera/geometry split.
2. Reserve held-outs before any tuning.
3. Use identical cameras, exposure policy and crops.
4. Keep generated content either disabled or identically masked/labeled.
5. Evaluate room-wide and hero strata.
6. Blind human reviewers to method where possible.
7. Compare source-master and each runtime encoding separately.
8. Record failures, not only aggregate winners.
9. Publish no superiority claim until another operator reproduces the report.

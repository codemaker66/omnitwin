# Proposed evidence corrections to splat-quality-independence.md

**Target:** docs/strategy/splat-quality-independence.md

**Method:** explicit amendment proposal; the original strategy was not silently overwritten.

**Evidence cutoff:** 2026-07-12

The original strategy contains useful staging, fixed-view evaluation, hero-layer and Truth Mode ideas. The corrections below are material because they change what is runnable, lawful and on the critical path.

## 1. Executive feasibility and trainer status

**Target passages:** §1 paragraphs beginning “Yes — contingent…” and “What is
missing…”, plus the trainer/runway passages identified below; section anchors
are authoritative because line numbers have shifted.

**Current claim:** most machinery exists; the gsplat trainer is complete and merely unexecuted; T-001/RunPod setup is the practical gate; Config B already turns on MCMC, bilateral grid, 3DGUT and depth capabilities.

**Correction:** the current trainer is not runnable as checked in.

Verified failures:

- required vendored upstream trainer/COLMAP files and checksums are absent;
- the wrapper imports pinned gsplat and calls main with zero arguments, while the upstream entry point requires rank/world/config arguments and only constructs the CLI in its own main block;
- upstream example-local dependencies are not vendored;
- run_training.sh passes unsupported --config and --external_depth_dir flags;
- the script selects the default strategy, not MCMC;
- config_b.yaml is not parsed into the pinned upstream configuration;
- external depth is not passed by the upstream Runner;
- evaluation expects a nonexistent training_metrics.jsonl/per-image layout;
- checkpoint copies are not used as resume state;
- D-014 mandatory artifacts are not enforced.

**Proposed replacement:**

> The repo contains a substantial trainer design and deployment scaffold, but no successful run and no runnable Config B integration. The immediate technical gate is a local **non-training** repair/import/config/contract smoke. Actual splat training remains RunPod-only under accepted D-016 and requires a repaired digest-pinned worker, explicit plan/cost, a trusted `FoundryRightsApproval`, a short-lived `FoundryExecutionConfirmation` bound to the exact job subject, and exact trusted compute approval. RunPod console setup is downstream of local contract proof, but the first actual training smoke still runs there.

Status vocabulary should be:

- container/dependencies: declared, unverified;
- SH3/antialias/UT: intended and upstream-supported, never run here;
- MCMC: intended but miswired;
- bilateral grid: intended but miswired/output absent;
- E57 depth: code present, not integrated/tested;
- held-out evaluation: canonical collation broken;
- RunPod: unsmoked and blocked;
- provenance/bundle: partial and unenforced.

## 2. LCC/LCC2 are not clean “open-sourced” formats

**Target lines:** 21, 30, 32, 70, 74, 78, 86, 129, 135, 141–146, 176.

**Current claim:** XGRIDS open-sourced LCC/LCC2; public specifications and MIT SplatTransform create an open door; no restriction was found on external processing of owned exports; layered compositions are legal.

**Correction:** the whitepapers publicly document the formats but impose a custom non-OSI licence. It includes attribution/redistribution/derivative conditions and restricts using the data organization format to train/fine-tune AI competing with XGRIDS without written consent. XGRIDS terms also raise competing-service/commercial exploitation and reverse-engineering issues. SplatTransform's MIT licence does not neutralize the input format or captured-asset terms.

**Proposed replacement:**

> LCC/LCC2 are publicly specified but commercially encumbered adapter formats, not Foundry masters. Use already exported PLY/mesh/SPZ/SOG/poses only under verified customer/source rights. Do not train/refine from LCC/LCC2 or automate/bundle vendor SDKs without written XGRIDS permission and counsel. Historical salvage remains viable through approved open exports aligned to independent E57; prospective independence uses ordinary open capture.

Any phrase asserting that a vendor-base/residual composition is “legal” should become “technically composable and legally conditional.”

## 3. Historical PortalCam raw recovery boundary

**Target lines:** 34, 64, 74, 150–156.

**New verified evidence:**

- ten raw projects exist;
- poses.csv exposes timestamp, position and a four-value rotation whose order/frame are undocumented;
- ULog exposes IMU samples and synchronized camera/LiDAR event metadata, not the image/LiDAR payloads;
- raw xbin begins with proprietary XBAG signature;
- a standard ZIP names camera/IMU/LiDAR/extrinsic calibration files, but those entries are encrypted;
- preview geometry is decimated Potree data, not raw LiDAR;
- a bounded official-source search found no public PortalCam raw decoder, sensor export or SDK; that negative result does not prove a private/partner route is absent.

**Proposed replacement:**

> Historical raw independence is partial. Timestamps, trajectory, IMU and sensor-event clocks are openly inspectable. Original RGB, LiDAR/depth and calibration are not available in an approved open form. Payload placement inside `.xbin` is a supported inference, not a decoded fact. Stop at signatures and ordinary sidecars; request an official sensor bundle, unencrypted calibration, SDK/export and written independent-processing rights. Do not make raw parsing an implementation task without that authority.

T-500 should record this lawful boundary and the vendor request rather than attempt deeper proprietary parsing.

## 4. Matterport E57 is richer—and legally more conditional—than described

**Target lines:** 34, 88–98, 146, 176–178.

**New verified evidence:**

- `E57_ASSET_ROOT/cloud_0.e57` is 20,518,437,888 bytes, not the previously cited directory total;
- it contains 149 posed scans, 965,520,000 raw point records and 894 embedded 4096x4096 pinhole cubefaces; the valid-point total was not computed, and a scan-0 spot check found 5,205,250 valid plus 1,274,750 invalid records;
- image and scan centres match, and six stable relative rotations repeat;
- acquisition timestamps are absent;
- the first 50 sweeps have an existing 300-image 1024x1024 JPEG COLMAP dataset with 231 registered image poses sharing one PINHOLE camera model;
- a one-off similarity diagnostic reported 10.7 mm RMSE, but no matrix/correspondence/residual artifact was saved and it is not reviewed, reproducible or certified;
- Matterport's March 2026 Terms of Use prohibit commercial AI/ML training using Matterport Data.

**Proposed replacement:**

> The local E57 is a strong metric and image-registration pilot source, not merely a geometric spine. It includes posed cubefaces sufficient for a bounded independent pipeline experiment. Before any model training, resolve whether these exported images fall under Matterport's current AI-training restriction and the customer's contract. E57 has no acquisition timestamps and is not automatic evidence of synchronized source capture.

## 5. First room should change from Reception to Grand Hall

**Target lines:** 82–84, 141–169.

**Current plan:** Reception Room preferred for first alignment/retrain.

**Correction:** Grand Hall has the strongest full-Foundry evidence-to-effort ratio: metric E57, posed source imagery, existing COLMAP, two PortalCam raw projects, vendor Gaussian/mesh/poses/SOG, and an encouraging diagnostic alignment.

**Proposed replacement:**

> Choose Grand Hall for the independent vertical slice, conditional on a human confirming that E57 sweeps 0–49 are Grand Hall. Use Reception only if identity fails or the near-term goal is solely existing runtime parity.

This does not automatically replace T-505's narrower Reception alignment work; it proposes the T-506 vertical-slice choice.

## 6. ArtiFixer licence claim is false

**Target lines:** 112, 125, 169, 178.

**Current claim:** ArtiFixer code and weights are Apache-2.0.

**Correction:** the code repository is Apache-2.0, but the official released ArtiFixer checkpoint is governed by NVIDIA noncommercial/R&D terms. Wan's base licence does not override the fine-tuned checkpoint licence.

**Proposed replacement:**

> ArtiFixer v1 code is Apache-2.0; the released checkpoint is research/noncommercial and cannot ship. T-504 may evaluate it internally only if permitted, with no commercial/export path. A future licensed alternative such as NVIDIA Fixer v2 is separately conditional under its model licence/AUP and remains generated-cinematic only.

## 7. “Every component has an open commercially licensed equivalent” is too broad

**Target lines:** 70, 86, 129–135, 176–178.

**Correction:** code, weights, datasets, formats, captured imagery and patents are independent gates. Examples:

- graphdeco Gaussian Splatting and several 2DGS/GOF/SuGaR derivatives are noncommercial;
- OpenMVS is AGPL;
- ORB-SLAM3/OpenVINS/VINS-Fusion/FAST-LIO are GPL-family;
- SuperPoint provenance is restrictive; DISK/ALIKED + LightGlue are cleaner candidates;
- common ScanNet-trained 3D semantic checkpoints are not commercial;
- OpenUSD 26.05 uses the Tomorrow Open Source Technology License 1.0 plus bundled notices;
- 3DGS/3DGRUT still need patent/FTO review.

**Proposed replacement:**

> A commercially plausible stack exists, but only through an exact component registry: libE57/PDAL/Open3D/Poisson, COLMAP, approved LightGlue features, gsplat/3DGRUT, SAM 2, SPZ/SOG/Spark/glTF and provider-neutral orchestration. Every exact build/checkpoint/source asset remains gated by dependency, model, dataset, patent and vendor/client rights review.

## 8. Splat Analyzer and semantic tooling need checkpoint/data review

**Target line:** 36 and technology table.

The correction from “not found” to a real MIT repository was good epistemic practice. Add:

> Repository licence does not automatically approve OWLv2 or any downloaded checkpoint/dataset chain. Record exact model/checkpoint terms and keep results as human-reviewed semantic proposals.

Also update SPZ support/version language: current official SPZ tooling supports format v4 and library release 3.0.0 (2026-05-05). Pin the actual format used by each artifact.

## 9. Runtime claims require source-versus-transform-versus-codec attribution

**Target lines:** 28, 34, 55, 82, 141, 156.

**New repo evidence:**

- Spark 2.0.0/Three 0.180.0 are pinned in the repo; Spark 2.1.0 is available but not adopted;
- Reception SPZ is the current internal primary visual check and SOG is retained as backup/provenance, but the transform/source attribution remains unresolved;
- the runtime transform is approximate and hard-coded;
- the current package route can expose published+usable while unverified, unlike the newer public route;
- no fixed-view source-master versus SOG/SPZ/render-settings attribution exists.

**Proposed replacement:**

> Current Reception evidence proves an internal renderer smoke only. It does not validate alignment, source quality, codec quality or public readiness. First fix/review the transform and run identical fixed views from source PLY through SPZ/SOG and renderer settings. Reconcile the legacy latest-package path with the new signed review boundary before public use.

## 10. Cost and schedule estimates must be re-baselined

**Target line:** 84 and task table.

The $5–15 run and 8–13-session programme assume a runnable trainer, lawful source imagery and a working bridge. Those preconditions failed or remain unknown. Provider pricing is also time-variable.

**Proposed replacement:**

> Re-estimate after local non-training trainer-contract/import proof, rights decisions, room identity and a measured resource trace. Generate provider cost at JobSpec plan time, add storage/egress/retry margin and cap it. The first actual training smoke remains RunPod-only under D-016 and cannot dispatch without trusted subject-bound rights approval, short-lived execution confirmation and compute approval.

## 11. Revised critical path

Replace “T-001 is the single highest-leverage hour” with:

1. reconcile/snapshot T-486;
2. Grand Hall room-identity check;
3. XGRIDS and Matterport rights requests;
4. deterministic ingest and alignment reproduction;
5. trainer repair + local non-training contract/import smoke;
6. explicitly approved minimal RunPod training smoke under D-016;
7. deterministic geometry;
8. fair visual/hybrid bake-off;
9. further approved remote execution only if useful.

RunPod setup remains valuable, but it is not the current root blocker.

## 12. Claims that remain sound

Retain and strengthen:

- diagnose source/reconstruction/runtime separately;
- fixed-view, held-out PSNR/SSIM/LPIPS plus human review;
- metric mesh for geometry/physics and splats for appearance;
- hero specialists/residual layers as bounded experiments;
- TransformArtifact and Scene Authority Map;
- captured versus generated Truth Mode;
- progressive independence rather than an immediate proprietary-parser project;
- no vendor-quality superiority claim before bake-off.

## Proposed amendment header

If the target strategy is retained as a historical decision document, add a visible header rather than rewriting its history:

> **Evidence amendment (2026-07-12):** Subsequent OmniTwin Foundry forensics found that the checked-in trainer is not runnable, LCC/LCC2 are custom-licensed rather than commercially clean open formats, ArtiFixer's released checkpoint is noncommercial, and historical PortalCam payload/calibration access is blocked pending an official route. Grand Hall is now the preferred independent pilot subject to room-identity and Matterport/XGRIDS rights gates. See docs/reports/omnitwin-foundry-root-investigation.md and this corrections report.

## Decision

Do not use the original strategy alone to authorize training, LCC/LCC2 processing, ArtiFixer product work, RunPod spend or public claims. Use the Foundry root investigation, v0 contracts and explicit gates as the current evidence layer until an ADR/task amendment is accepted.

# Proposed patch list: splat-quality-independence.md

**Target:** docs/strategy/splat-quality-independence.md

**Status:** proposal only; the canonical strategy was not silently rewritten

**Evidence basis:** reception-room-hd-root-investigation.md, reception-room-hd-evidence.json, reception-room-fixed-view-manifest.json, and reception-room-quality-decision-matrix.md

**Original evidence cutoff:** 2026-07-12. Reconciled through 2026-07-22; the canonical strategy's existing supersession warning remains necessary because these proposed body corrections are not fully merged.

**Handling:** INTERNAL / public-redaction-required. The canonical strategy must use private aliases or an approved redacted evidence annex before external distribution.

The strategy has useful authority separation, capture, evaluation and staged-independence ideas, but its central execution premise is now falsified: Config B is not a complete trainer gated mainly by RunPod. The proposed changes below retain its long-term ambition while replacing unsupported implementation, runtime, legal and cost claims.

## 2026-07-16 local fixed-view addendum

Two Stage-0 implementation items are now complete:

- **Explicit renderer profile — complete.** `reception-fixed-fine-review-v1` applies the same contract to every candidate leaf: canvas DPR range 1–2, antialias off, sRGB output, ACES Filmic tone mapping at exposure 1, Spark `maxSh=3`, renderer LoD off, preblur 0, blur 0.3, radial sorting on with a 0 ms minimum interval, depth test on and depth write off. The controlled capture observed effective DPR 1. This is a reproducible baseline, not proof that the settings are optimal.
- **Fixed local real-component CV slice — complete.** The development-only, database-free route loaded Quality as four SOG sources / exactly 2,002,009 Gaussians and Mobile as four SPZ sources / exactly 1,978,258 Gaussians. It produced 24 lossless 1200×900 PNGs: six matched views × two candidates × two captures. All 12 static repeat pairs were byte-identical 500 ms apart.

Computer vision was run in both directions. Each direction returned five `review` views and one low-edge `not_assessable` ceiling-moulding view. Pairwise similarity ranged from 26.912251 to 29.773793 dB PSNR, 0.941555 to 0.961395 SSIM and 0.025317 to 0.040604 RGB MAE. These are difference measurements between two non-authoritative candidates. They do not establish a quality winner, physical truth, product improvement or the bytes served by the protected route. The six views came from one camera position with different framings; spatially distinct moving/orbit, performance, GPU-memory, supported-device, registered held-out and protected authenticated-route gates remain open.

## 2026-07-22 controlling quality reconciliation

- The 16 July matched-camera method slightly favoured Quality; the locked 17 July holdout slightly favoured Mobile. The holdout effects were only 0.07%–1.38% and have no calibrated human-visible threshold.
- The 18 July artifact diagnosis found 34.3%, 28.7% and 42.0% more near-white pixels in Quality across scans 126, 129 and 141, but its fine-detail-energy ranking changed by view.
- The 22 July blind replay is deliberately non-authoritative and strongly contradictory: OpenCV BRISQUE preferred Mobile in 14/15 conditions, PIQ BRISQUE in 13/15, while CLIP-IQA preferred Quality in 14/15; the model families disagreed in 13/15 conditions.
- The controlling candidate decision is now `no_stable_physical_or_commercial_winner`. Preserve older directional results as dated receipts, but do not use any one of them as the strategy's current winner.
- The machine-readable evidence has a `currentQualityReconciliation` object. The preserved `latestMatchedCameraComputerVision` object is historical and must not be cited alone.

## Required factual corrections

| Patch | Target text/section | Proposed change | Evidence/reason |
|---|---|---|---|
| P-01 | Header/status and executive summary | Change status from “analysis (promotable after T-500)” to “superseded in part by Reception root investigation; correction required before ADR promotion.” Link all four Reception artifacts. | T-500-class evidence now exists and contradicts core claims. |
| P-02 | §1, “complete gsplat trainer” and “practical gate … T-001” | Replace with: “T-514 provides a dependency-light Config B checker and synthetic non-training preflight only. Its successful result is `contract_valid_runtime_blocked`. In the trainer production path, the real pinned worker, accepted argument translation, distorted-camera/depth/bilateral behavior, optimizer-produced held-out metrics, resume, candidate generation and runtime packaging remain missing. The separate downstream D-014 verifier is implemented and tested, but the trainer does not produce its inputs. Any splat-training smoke follows the accepted D-016 rights/activation/approval route; local Windows training is not the execution path.” | Current entrypoint and legacy RunPod launcher fail closed; 74 checker tests pass; `state/training_runs.jsonl` remains empty. |
| P-03 | §1, “What is missing is small in code volume” | Remove the estimate. Enumerate missing runner/config translation, pinned upstream, dependency closure, camera/resolution batching, depth projection/occlusion, held-out evaluation, deterministic bundle, resume and encoder/release integration. | The missing work is not only an ingestion bridge. |
| P-04 | §2, “open-sourced LCC/LCC2” / “open door” | Replace “open-sourced” with “publicly documented/custom-licensed format and SDK ecosystem.” State that the inspected XGRIDS terms/licence are not an OSI commercial-rights clearance and output/distribution/refinement rights require writing. | Public whitepapers/SDKs do not equal a clean open-source licence. |
| P-05 | §2 hardware/ecosystem | Separate official general PortalCam specifications from verified Reception metadata. Do not assign 200° frames, 4000×3000 images or exact optical models to the Reception dataset until an official calibration/frame export proves them. | Reception open files expose event identities and rs_airy, not image headers/intrinsics/distortion. |
| P-06 | §2 HD pricing | Retain the USD $2,500/year public Premium price, add the official feed’s USD $1,000 current-period PortalCam upgrade variant, and label both entitlement/availability/tax/device/output-rights dependent. State no public per-room HD price was established. | Official store/feed checked 2026-07-12; human availability copy conflicted. |
| P-07 | §2 current LCC release | Update to LCC Studio v2.1.0 dated 2026-07-02. Record installed local v2.0.0 and “HD Enhancement — Not Activated.” Describe v2.1 claims as vendor release evidence, not Reception improvement evidence. | Primary release/download pages and local UI. |
| P-08 | §2 “our ground truth” runtime description | Replace the single approximate runtime description with two exact lineages: earlier Quality SH3 PLY/SOG and later Mobile SH0 PLY/SPZ. Include master hashes, valid frontier counts and current pointer date/prefix. | Evidence register contains exact bytes/hashes/counts. |
| P-09 | §2/§4 LCC2 tiles | Explicitly state LCC2 is a replacement LoD tree. Never sum or mount coarse+medium+fine as one fixed visual. Record the Quality valid fine frontier (four SOG files, 2,002,009 Gaussians), Mobile SOG fine frontier (1,979,204) and Mobile SPZ fine frontier (1,978,258). Treat environment exclusion as diagnostic only and require an A/B before release. | Official hierarchy semantics plus parsed node ranges. Internal all-seven is 1.7468× the SPZ fine set and visibly doubles edges. |
| P-09a | §2 export inventory | Verify the SPZ-with-attached-mesh package separately: its SPZ/LCC2 visual files are byte-identical to the Mobile visual package; the master mesh is 379,462 bytes, 10,209 vertices / 19,747 faces, XYZ-only; poses.json has 4,529 poses with RGB null; report.json records hdImageCount 0. | Direct package/hash/header/JSON inspection. The mesh is a coarse structural comparator, not an HD source. |
| P-10 | §4 Phase 0 diagnosis | Mark both fixed local phases complete but keep them separate: (A) the historical Spark fixture, six same-centre framings × seven variants, and (B) the fresh real-component run, six matched same-centre feature views × two candidates × two lossless captures. Record the exact loaded totals, 24 PNGs and 12/12 byte-identical static repeat pairs. State that neither phase tests SH view dependence, spatially distinct movement, supported devices or the protected route. Preserve RR-LCC-HERO-CAPTURE-SET, RR-INDEPENDENT-VIEWER-CAPTURE-SET and RR-ACTUAL-ROUTE-CAPTURE-SET, then add near/mid/far/orbit cameras. | The fresh run is independently sealed from the historical 42-screen fixture and exercises the real scene component, but remains local and database-free. |
| P-11 | §4 compression language | Remove the implication that SPZ/SOG quantisation is a likely dominant cause before same-master evidence. State that the current SPZ source PLY was already SH0 and valid PLY→SPZ loss was small at tested cameras. | Current source has 17 properties/DC only; Quality source has SH3. |
| P-12 | §4 Spark knobs | Keep fixture DPR 1, planner DPR 0.75 and internal adaptive 0.75/1 only as historical context. Record the implemented `reception-fixed-fine-review-v1` contract exactly: canvas DPR 1–2; antialias false; sRGB; ACES Filmic exposure 1; Spark `maxSh=3`; renderer LoD false; preblur 0; blur 0.3; radial sort true; minimum sort interval 0 ms; depth test true; depth write false. The fixed capture observed effective DPR 1. State that this is the controlled baseline, not a proved optimum, and that actual-route A/B remains required. | Real-component source, capture telemetry and focused tests through 2026-07-16. |
| P-13 | §5 T-501 bridge | Split into (A) authorized, rights-cleared vendor-export bridge, currently blocked by RR-XGRIDS-OPEN-EXPORT; and (B) new owned DSLR lane with optional separately cleared E57 bridge. Do not make PortalCam frame extraction the assumed bridge input. | .xbin is XBAG, calibration ZIP encrypted, open images/intrinsics/depth absent. |
| P-14 | §5 registration | Prefer a confirmed E57 room scaffold with fixed E57 face poses, COLMAP SIFT baseline, mapper continuation/constrained BA, and only then ALIKED+LightGlue. State that image_registrator is a first localization test, not automatically the final joint model. | Camera/registration audit. |
| P-15 | §5 camera models | Remove OPENCV_FISHEYE as a selected PortalCam model. Require vendor intrinsics/ray mapping and a calibrated fixture. Use rectilinear PINHOLE new photos first; if extreme-fisheye data is supplied, crop/resample to verified virtual pinholes or bucket the exact model. | Behind-plane rays and scalar gsplat camera-model API make 200° assumptions unsafe. |
| P-16 | §5 “Training (already built — Config B)” | Replace the entire subsection with a capability audit table: MCMC named/not selected; 3DGUT flag partial; bilateral grid dependency/output absent; antialias setting disconnected; depth path defective; same-model mixed intrinsics/varying-resolution batch-1 limited and unverified; mixed projection/varying batches unsupported; evaluation/bundle/package broken. Add RR-TRAINER-RUNNABLE-BUNDLE acceptance tests. | Direct code/config/import/CLI audit plus upstream gsplat v1.5.3 signature. |
| P-17 | §5 bilateral grid | State that it is an optional experiment after the baseline. It cannot be described as the mechanism that already makes mixed-session fusion tractable. Freeze/neutralize per-view appearance for held-outs. | No running implementation; appearance fitting can flatter evaluation. |
| P-18 | §5 initialization | Re-rank: valid-frontier Mobile-versus-Quality Stage-0 A/B plus separate captured hero layers first; cold owned photo baseline second; warm start research third. Require lossless parameter round-trip and uncovered-region regression tests before warm start. | Lowest blast radius and cleanest lineage without assuming the source winner; no verified warm importer exists. |
| P-19 | §5 outputs | Retain single-generation master→runtime doctrine, but add LCC2 frontier/tree metadata, SH degree, antialias flag, valid point counts, Spark compatibility (SPZ ≤v3 in inspected version), transform residual artifact, authority class and rollback asset. | Current package contract caused the dominant fault. |
| P-20 | §5 evaluation | Add strict train/BA/held-out separation. Permit held-out pose-only PnP localization only after the training model/candidate freeze, with no triangulation/BA/intrinsic/model update; otherwise the image is human-review-only. Record the completed six-view pairwise CV slice and its symmetric interpretation boundary: five `review` plus one low-edge `not_assessable` result in each direction; no candidate is an authority. Still require spatially distinct near/mid/far/orbit review, feature-masked PSNR/SSIM/LPIPS against registered held-outs, alignment controls, blinded human review and actual-route FPS/GPU-memory/load-time evidence. | Candidate-to-candidate PSNR/SSIM/MAE and edge signals detect differences, not physical accuracy; gradient energy can reward false or doubled structure. |
| P-21 | §5 cost | Remove the assumption of 6–10 routine runs before a runnable smoke. Complete local non-training import/profile evidence first. Propose $30/run/$100 total cloud caps only after rights, manifest, clean activation and explicit D-016 approval. Cite then-current RunPod rates and storage/tax caveats. | Local Windows splat training is deprecated; T-514 is non-training only and the current trainer cannot run. |
| P-22 | §5b E57 | Describe the 20,518,437,888-byte, 149-scan file as venue-wide, with Reception only a candidate subset. Distinguish the registered `F:\E57\cloud_0.e57` path from the later staged copy unless byte identity is reverified. Strengthen RR-E57-CROP-CONFIRMATION from a scan-ID screenshot to a reviewed room-only 3D crop or floor-boundary polygon. Keep RR-E57-METRIC-CONTROL with ≥8 fit + ≥6 blind controls. | Direct inventory plus the 2026-07-15 structural refusal; metric units and station IDs do not establish one physical room envelope or independent accuracy. |
| P-23 | §5b E57 roles | Treat E57 as an external Matterport Digital Asset and provisional reference, not owned metric truth. Commercial model training using E57 points/images/poses/derived camera poses/depth is no-go absent express permission; separately clear crop/conversion/derived mesh/GLB distribution and no-resale treatment. | Current Matterport PSA and Terms. |
| P-24 | §6 approach table | Replace statuses with the twelve-family decision matrix. Add current proved runtime correction as rank 1, vendor HD as a benchmark/fallback, hero recapture/micro-splats as priority, and full PortalCam retrain as blocked. | Required decision matrix now exists. |
| P-25 | §6/§7 ArtiFixer | Correct “Apache-2.0 code+weights.” Code is Apache-2.0, but the released checkpoint/model card is research/development only under NVIDIA One-Way Noncommercial. Mark production use rejected. | Official repo, model card and governing checkpoint licence. |
| P-26 | §7 MCMC licensing | Distinguish permissive gsplat MCMC implementation from the restricted UBC/reference path. Do not vendor non-commercial research code. Pin exact dependency provenance. | Commercial dependency audit. |
| P-27 | §7 hloc | Distinguish Apache-2.0 hloc code from model weights/configurations. Avoid common SuperPoint/SuperGlue research routes unless exact terms are accepted; use SIFT first and verify ALIKED/LightGlue artifacts. | Weight licence is not inherited from orchestration code. |
| P-28 | §7 XGRIDS terms/licences | Delete “processing our exported data externally — supported” and “no restriction found.” Pin LCC commit b38c2eb… and LCC2 commit 039367d…; implement the counsel-approved attribution, modification, recipient-link, redistribution, downstream competing-AI and derivative/open-terms obligations; separately obtain written existing-base/output/refinement/CDN rights. | Whitepaper licences are custom and obligation-bearing; store ToS does not settle particular output rights. |
| P-29 | §8 independence ladder | Insert Stage 0a: correct frontier/DPR/transform and A/B valid Mobile against the higher-capacity Quality candidate without assuming the winner. Stage 1: one v2.1 reprocess. Stage 2: same-photo vendor-HD vs owned hero bake-off, with E57 optional and separately gated. Stage 3: full owned capture/retrain. PortalCam raw independence remains conditional on official export. | Evidence-based lowest-cost ordering without a directional source-quality overclaim. |
| P-30 | §9 knowns/unknowns | Move Reception raw frame/intrinsic/depth/calibration availability to “blocked/absent from open artifacts”; move current runtime LoD fault to “verified”; move E57 crop to supported inference; add LCC exact hero ceiling as missing operator evidence. | Local audit resolved several former unknowns. |
| P-31 | §9 “unknown knowns” | Remove claims that 3DGUT/bilateral grid already unlock or make fusion tractable. Replace with explicit fixtures and falsifiers. | Capabilities are not wired/runnable and extreme FOV remains unverified. |
| P-32 | §10 task ordering | Reframe T-500 as evidence produced with manual hero blocker. Add a Stage-0 runtime-contract task before T-501/T-502. Make T-501 primarily the owned E57/photo bridge unless official PortalCam export arrives. Prevent T-502 training until trainer, rights, registration and transform gates pass. | Current dependency order would spend before the proved runtime fix. |
| P-33 | §10 T-503 | Make `docs/reports/reception-room-30-photo-capture-checklist.md` the authoritative pilot shot list. Allocate 18 disjoint A/B mapping photos (9 each) plus 12 mapping-excluded A/B observations at six named repeat stations covering the real empty-room features; localize repeats pose-only after subset freeze. Keep the stated registration/control gates. | The older fireplace/chandelier/artwork/table allocation contradicts the captured room. The bounded checklist is asset-backed and E57 remains optional. |
| P-34 | §10 T-504 | Mark ArtiFixer checkpoint production lane rejected. Any generated experiment requires a separately approved commercially licensed model, generated authority class, visible badge, reversible layer and export block. | Non-commercial checkpoint and truth policy. |
| P-35 | Sources | Replace reseller/secondary citations for current facts with official XGRIDS release/manual/store/feed/terms URLs, official RunPod pricing/docs, official RealityScan licence/EULA, and official ArtiFixer repo/model/licence. Record access date; for mutable controlling terms also require effective/version date and a counsel-approved immutable snapshot/content hash or archive identifier. | Primary-source policy, temporal stability and `LEGAL-SOURCE-SNAPSHOT-SET`. |
| P-36 | Release/handling | Mark exact-path/hash/station/image evidence INTERNAL and public-redaction-required. Extend LEGAL-RIGHTS-MEMO to vendor-photo processing location/egress, input licence, confidentiality, retention/deletion, telemetry, secondary use/model training, security and export. | Private venue data and mutable vendor terms are not a publication-ready evidence set. |
| P-37 | Rollout | Add RR-ROLLOUT-REPLICATION-GATE: Grand Hall plus one contrasting smaller/darker room must reuse the package/frontier invariant, renderer profile, evidence schema, metric rubric, rights checklist and supported-device gates unchanged. Only asset IDs, reviewed transforms, cameras and documented room thresholds may vary. Budget 1–2 engineering/QA days per room before new capture/survey costs. | Reception proves a room-specific diagnosis, not repeatable programme economics. |
| P-38 | §4/runtime current state | Mark the all-seven and one-URL/coarse behaviors as historical/legacy controls. Record separately that (1) the administrator-only exact private-preview gate validates the two audited four-leaf byte profiles and rejects mixed replacement levels, (2) the explicit renderer profile plus fixed local real-component CV slice are complete, and (3) neither reviewed byte profile is an anonymous presentation candidate. Quality SOG and Mobile SPZ lack an exact reviewed immutable presentation contract binding group transform, camera policy/route and renderer-profile digest, with exact browser application; therefore the public Living Hall receives neither profile. Detailed metadata/direct-ID streams remain platform-admin-only and the raw external-URL endpoint is retired. Reviewed objects require dedicated private runtime-profile R2 credentials/bucket with no public URL or legacy fallback. `approved_public` requires every required QA check to be present and passed; QA binds the exact transform SHA-256, and transform/QA IDs are immutable except for exact retries. Every future anonymous request must re-apply showcase/presentation-contract/identity/QA/transform/package/member gates immediately before send. Full size/SHA-256-verified bytes may use a per-process 64 MiB / 16-entry / five-minute LRU and identical-content single-flight, while authorization remains per request. Per-process admission is two active responses plus 16 FIFO waiters, a five-minute queue wait, 16 MiB/member and a 30-second upstream deadline. A separate absolute 180-second response/transfer deadline aborts upstream work and destroys a stalled response; slots release only after both work and response settlement. The private-preview byte route registers disconnect handling before lookup so a lookup-time disconnect cannot strand a slot. The anonymous member route also has a 24/minute/client-IP limit. Reception public showcase remains disabled. Remove “explicit Spark profile,” “fixed local capture,” and “client receipt allowlist” from the blocker list. Keep migration/deployment, registration, reviewed transform, protected-route capture, spatially distinct moving/orbit stability, performance/GPU memory, supported devices and registered held-outs as blockers. Add external activation blockers for the immutable presentation contract and exact browser application, dedicated private-bucket provisioning, reviewed-object copy/byte verification, proof of denied direct anonymous access, and edge rate-limit/WAF controls. | Exact-package implementation, focused safety tests and the re-sealed local capture; no presentation contract, storage provisioning, deployment, protected-route capture, public release, quality winner or product-quality result. |
| P-39 | §5b structural alignment | Add the 2026-07-15 3D-CV result: nine walls and two independent directions in both real inputs, but both failed `HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND`. No room height, transform or overlay was produced. | `reception-room-e57-xgrids-structural-cv-diagnostic-2026-07-15.md`. |
| P-40 | §4/§5/§10 feature lists | Replace Reception-specific fireplace/chandelier/painting/table targets with timber doors/glazing, curtains/windows, column/cornice/skirting, floorboards and small fixed wall/room-depth features. Preserve generic hero categories for other rooms only. | Hash-bound contact sheet, Quality overview and the asset-backed 30-photo checklist. |
| P-41 | §4 result interpretation | Add an explicit interpretation boundary for the 2026-07-16 local run: exact decoded counts and static repeatability prove that the intended candidates reached the real component under one controlled profile. Pairwise edge/pixel differences do not prove which candidate is better, physically correct or improved in the product. Do not infer served asset-byte identity, moving stability or GPU/device fitness from this slice. | Development-only route, same optical centre, no registered held-out reference, no protected authenticated stream and no GPU-memory capture. |
| P-42 | §4 candidate ranking and all executive summaries | Replace any undated “Quality review leader” or “Mobile leader” wording with `no_stable_physical_or_commercial_winner`. Preserve the 16 July Quality lead and 17 July Mobile holdout lead as method-specific receipts; add the 18 July brightness/fine-detail findings and the 22 July BRISQUE-versus-CLIP conflict. | Rankings reverse across camera sets and scoring families; no calibrated human-visible or physical-truth threshold exists. |
| P-43 | §6/§7 generated lane | Split ArtiFixer v1 from NVIDIA Fixer v2. ArtiFixer remains research-and-development only and rejected as a production dependency. Fixer v2's official card says commercial/non-commercial use under the NVIDIA Open Model License, so it may enter an exact-build and licence-reviewed generated experiment. It remains generated authority only and cannot become captured, metric, collision, route, planning or legal truth. | Official NVIDIA model cards rechecked 2026-07-22. Licence eligibility is not product-quality or physical-truth evidence. |
| P-44 | §4/§10 immediate action | Add the explicit pause boundary: do not touch LCC unless Blake types exactly `Resume LCC capture`. After that phrase, first confirm that an original lossless physical/source photograph and its calibrated camera pose can be exported; if they can, render three fresh Quality/Mobile repeats at that pose while preserving untouched source/render files and a documented colour-normalized comparison. Run the 21-frame one-centimetre Quality/Mobile movement test separately, and call it physical-reference motion only if a matched real sequence exists. Require computer-vision and human review before a candidate decision. | This is the cheapest honest route to a static physical-reference test plus separate view-change evidence. It does not pretend the virtual movement sweep has a real moving reference when none exists. |

## New strategy sections to add

### 1. Reception proved-current-state box

Add one concise box containing:

- current source pointer: later Mobile/Portable SH0 SPZ;
- highest-capacity recovered source candidate: earlier Quality SH3 PLY/SOG; directional superiority remains unproved;
- historical internal/dev-fixture control: invalid all-seven parent+child composition;
- historical one-URL public-schema risk: coarse-root-only resolution; the raw external-URL public endpoint is now retired for every room, detailed legacy package metadata/direct asset-ID streams are platform-admin-only, and legacy browser consumers stay on fallback while the public pointer remains unchanged;
- local reviewed-byte-profile route: exact Quality and Mobile four-leaf memberships are server-validated, but both are structurally blocked from anonymous presentation because neither has the immutable presentation contract binding exact group transform, camera policy/route and renderer-profile digest with exact browser application. Any future public path additionally requires showcase opt-in, every required QA check passed, signed-transform/digest gates and fully verified bytes. Reception showcase remains off, and the presentation contract, migration/deployment, registration and actual-route evidence remain blocked;
- valid Quality fine frontier: exactly four SOG files / 2,002,009 Gaussians;
- explicit `reception-fixed-fine-review-v1` profile: implemented and used for both candidates;
- fixed local real-component CV: complete at four SOG / 2,002,009 loaded Gaussians versus four SPZ / 1,978,258, with 24 lossless 1200×900 PNGs and 12/12 byte-identical static repeats;
- fixed local interpretation: the two candidates differ, but no winner or physical-truth conclusion is available;
- direct codec loss bounded as small at six fixed cameras;
- ultimate source fixed-detail quality still blocked by RR-LCC-HERO-CAPTURE-SET using the asset-backed Reception features.

### 2. Frontier contract invariant

Add the invariant:

> A runtime package MUST select a valid LCC2 tree frontier. It MUST NOT mount a node with any selected ancestor or descendant. A fine-quality release MUST NOT silently degrade to the root URL when the reviewed frontier spans multiple files.

Required manifest fields:

- hierarchy/container hash and version;
- selected node/chunk IDs, hashes and point ranges;
- LoD level/frontier proof;
- source PLY hash, SH degree, antialias flag and direct encoder settings;
- total selected Gaussian count;
- renderer/version/profile;
- reviewed transform and residual artifact;
- authority class and rollback asset.

### 3. Same-photo evidence ladder

Add the comparison order:

1. corrected-frontier Stage-0 A/B: the explicit-profile fixed local real-component slice is complete, but candidate selection remains open until spatially distinct movement, performance/devices, registered held-outs and the protected route are tested;
2. one v2.1 same-source reprocess;
3. vendor HD with the 30-photo/full owned set;
4. independent E57-registered cold/photo candidate;
5. independent hero micro-splat;
6. selective measured mesh;
7. warm-start only after lossless import proof;
8. generated derivative outside captured/metric authority.

Every candidate uses the same strict held-outs, feature masks, fixed views and performance profile.

### 4. Exact operator blockers

Completed local Stage-0 items:

- RR-EXPLICIT-RENDERER-PROFILE — **complete**;
- RR-LOCAL-REAL-COMPONENT-FIXED-CV — **complete**.

Track these remaining IDs in strategy/task state:

- RR-LCC-HERO-CAPTURE-SET;
- RR-INDEPENDENT-VIEWER-CAPTURE-SET;
- RR-ACTUAL-ROUTE-CAPTURE-SET;
- RR-E57-CROP-CONFIRMATION;
- RR-E57-METRIC-CONTROL;
- RR-PHOTO-METRIC-CONTROL;
- RR-XGRIDS-OPEN-EXPORT;
- LEGAL-RIGHTS-MEMO;
- LEGAL-SOURCE-SNAPSHOT-SET;
- CAPTURE-RIGHTS-PACK;
- RR-PILOT-CLI-BUNDLE;
- RR-TRAINER-RUNNABLE-BUNDLE;
- RR-RUNTIME-DEVICE-MATRIX;
- RR-ROLLOUT-REPLICATION-GATE.

## Claims to retain, with narrower wording

- Keep strict separation of captured visual, metric geometry, generated enhancement and runtime derivatives.
- Keep master PLY → single-generation runtime encoding and immutable provenance.
- Keep fixed-view plus post-freeze pose-localized held-out PSNR/SSIM/LPIPS, but add human, alignment and performance gates.
- Keep independently validated geometry as the metric spine and splats as appearance; E57 is only an optional licensed/control-validated source.
- Keep vendor versus independent evidence gates; do not assume independence wins.
- Keep hero residual/micro-splat architecture, but make captured hero layers the first enhancement prototype.
- Keep the staged-independence ladder, with PortalCam raw independence explicitly vendor-export-dependent.
- Keep the warning that full programme economics are about custody/repeatability, not merely beating a subscription price.

## Merge gate for the canonical strategy patch

Do not merge the canonical strategy correction until:

1. both JSON artifacts parse and every referenced evidence file hash has been verified;
2. the Stage-0 runtime contract invariant has an engineering owner/test plan;
3. Blake approves an internal-only handling path or a redacted/public-alias annex; exact local paths must not silently publish;
4. current task IDs T-500–T-505 are reconciled with the repo task ledger;
5. rights statements are labelled as screening, not legal advice, and mutable controlling terms have immutable snapshot records.

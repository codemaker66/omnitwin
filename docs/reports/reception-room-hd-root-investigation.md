# Reception Room HD root investigation

**Status:** decision-ready zero-cost diagnosis; bounded execution continues; no enhanced candidate, paid compute, production asset switch, or product-quality win is claimed

**Original evidence cutoff:** 2026-07-12. Dated addenda below reconcile read-only evidence and local implementation through 2026-07-16 without rewriting the original 2026-07-12 capture receipts. The 2026-07-16 local real-component capture is a separate, hash-bound run.

**Handling:** INTERNAL / public-redaction-required. Exact local paths, project identifiers, hashes, provisional E57 station bounds, and venue imagery must be removed or approved before external sharing.

**Repository baseline:** `C:\Users\blake\omnitwin2`, branch `feature/diary-p0-slice-3`, audited HEAD `e5c2f0a87e3e2da5a7eab87e375865fd62eadb5d`; the pre-existing worktree was dirty and was preserved

**Evidence classes:** **Verified** = directly inspected, measured, or stated by a primary source. **Supported inference** = multiple verified facts support the conclusion, but a decisive comparison remains. **Hypothesis** = a candidate mechanism awaiting a discriminating test. **Blocked** = a named input, right, operator action, or implementation is missing.

This is a technical and commercial-risk investigation, not legal advice. It does not certify source ownership, spatial accuracy, or product release readiness. Machine-readable evidence is in `docs/reports/reception-room-hd-evidence.json`; replay-oriented camera definitions and their provenance limits are in `docs/reports/reception-room-fixed-view-manifest.json`; the option comparison is in `docs/reports/reception-room-quality-decision-matrix.md`.

## Dated addendum — direct computer-vision source-viewer check (2026-07-14)

The earlier evidence cutoff is preserved above. A later read-only visual check
removed the former active-editor blocker without accepting LCC Studio's
file-corruption warning or changing any source asset.

### What was directly observed

- The installed Lixel CyberColor Scene Editor reports version `v2.0.0 (INT)`.
- Windows reports an NVIDIA GeForce RTX 4090 with driver version
  `32.0.15.9649` and device status `OK`. The legacy WMI AdapterRAM value was
  ignored because it is not reliable for modern high-memory GPUs.
- In the same camera pose, its Point Cloud mode showed the Reception Room's
  walls, ceiling line, floor, columns, curtains and doors as coherent structural
  geometry.
- Switching only Point Cloud off changed that view into room-sized, smeared
  Gaussian colour blobs. Environment Data was off, so the environment layer
  was not responsible.
- The comparison was repeated after an orbit to a materially different angle.
  The point cloud again retained room structure and the Gaussian view again
  became oversized blobs.
- Moving the camera farther away did not resolve the blobs.
- The editor's Render Quality control was tested at its highest position at
  the same camera. It made no visible correction and was restored to its
  original position afterward.
- The lightweight preview and the editor's normal scene view both showed the
  same Gaussian failure.

These are direct on-screen observations, but they are not a cryptographically
bound screenshot set. They should be repeated in the current XGRIDS release
with saved stills, GPU/driver details and an unchanged-camera checklist before
filing a vendor defect.

### What the control renders establish

The independent fixed-camera renderer displays both the Quality master PLY and
the authoritative four-member Quality SOG leaf frontier as a clear room. Their
six tested views are close and the computer-vision triage raises no configured
warning for that PLY-to-SOG step. By contrast, the invalid all-level web
composition raises warnings in every tested view.

The combined evidence therefore separates two faults:

1. the deployed web composition loads replacement hierarchy levels together;
   and
2. this installed LCCEditor v2.0 rendering path mis-displays the unchanged
   Quality Gaussian data.

The second item is a supported inference about the viewer path, not proof of a
specific DirectX, driver, decoder or LoD bug. The clear independent PLY/SOG
renders make "the room data only contains giant blobs" an unlikely explanation.

### Vendor-documented checks and exact next test

XGRIDS documents a global Render Quality setting and DirectX 11/12 graphics
choices, recommends changing graphics API when rendering is unstable, and has
an FAQ specifically for blurry reconstructed models. Its current download page
lists LCC Studio v2.1.0 after the installed v2.0.0 and mentions improved GPU
driver detection plus known-issue fixes. Primary sources:

- <https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.0.0/17-faq.html>
- <https://docs.xgrids.com/en-us/06-lixel-cybercolor/02-lcc-scene-editor/v2.0.0/07-settings.html>
- <https://docs.xgrids.com/en-us/06-lixel-cybercolor/02-lcc-scene-editor/v2.0.0/20-preview-mode.html>
- <https://docs.xgrids.com/en-us/06-lixel-cybercolor/02-lcc-scene-editor/v2.0.0/22-faq.html>
- <https://xgrids.com/intl/support/download?page=LCCStudio>

The next discriminating test is to preserve the current installation and
project, record the GPU and driver, then reopen the unchanged model under
DirectX 11 and LCC Studio v2.1.0 at the same two cameras. If only v2.0/DirectX
12 produces the blobs, treat this as a viewer defect. If every XGRIDS rendering
path fails while the independent PLY/SOG path remains clear, send XGRIDS the
model hashes, exact camera views and logs rather than reprocessing the source
blindly.

## 1. DIRECT ANSWER

### Dominant current bottleneck

The strongest proved presentational loss is **not SPZ/SOG codec loss**. It is **an invalid interpretation of the LCC2 hierarchy**: internal Reception views mount all seven coarse, medium, and fine chunks simultaneously. LCC2 defines a replacement level-of-detail tree; parents and children are alternatives, not additive layers. The invalid set renders 3,455,732 Gaussians / 52,838,644 bytes where the valid leaf frontier contains 1,978,258 / 30,010,681 bytes, producing visibly doubled/smeared edges. The conditional public one-URL path has the opposite failure mode: if this package is published through that schema, it resolves only the 491,784-Gaussian coarse root.

A separate verified fact is an **unvalidated source substitution**: the runtime pointer changed from the earlier approximately 2.0M-Gaussian Quality/degree-3-SH SOG reconstruction to a later approximately 1.98M-Gaussian Portable/DC-only-SH0 SPZ reconstruction. The sources render materially differently, and Quality has greater recorded appearance capacity, but no LCC-aligned physical reference, independent-viewer hero set, or actual-route A/B proves that Quality is directionally better. Treat Quality SH3 as the highest-capacity recovered candidate, not a proved winner.

Planner rendering still adds a secondary loss by hard-pinning device pixel ratio to `0.75`; at a DPR-2 display that is only 14.06% of native pixel count. The static room transform and test expectations are also stale. A separate local Reception review path now deliberately pins DPR, colour, tone, blur/preblur, sorting, SH, LoD and depth settings; that controlled review profile does not by itself change the planner or prove the best production settings.

The claimed **SPZ-with-attached-mesh** export is present, but its SPZ/LCC2 visual payload is byte-identical to the ordinary Mobile SPZ package. Its separate master mesh is only 10,209 vertices / 19,747 faces, 379,462 bytes, XYZ-only. It is useful as a collision/structural comparator, not evidence of an HD visual layer.

Same-framing, same-renderer comparisons show that PLY-to-valid-export-package deltas are small relative to the proved LoD faults in the tested views:

- Quality SH3 PLY versus valid Quality SOG fine frontier: PSNR 41.88–42.73 dB, SSIM 0.966711–0.971788.
- Mobile SH0 PLY versus valid Mobile SOG fine frontier: PSNR 41.44–43.75 dB, SSIM 0.958019–0.970598.
- Mobile SH0 PLY versus valid Mobile SPZ fine frontier: PSNR 41.79–43.65 dB, SSIM 0.959630–0.970183.
- same-Mobile-source valid SOG versus valid SPZ fine frontiers: PSNR 42.03–44.02 dB, SSIM 0.958270–0.969874.

A separate computer-vision warning pass reaches the same practical conclusion
without using a single, easily fooled “sharpness score.” It checks missing
edges, new edges, nearby parallel edges, local pixel changes and detail energy
at several blur scales. The invalid parent-plus-child render triggered review
in all six views; the Quality PLY-versus-valid-leaf-SOG comparison triggered no
configured warning in all six. In plain language: loading replacement LoDs on
top of one another visibly damages the room, while this test found no comparable
damage from the valid Quality PLY-to-SOG package step. This is triage evidence,
not proof that either file contains enough original detail.
- valid Mobile SPZ fine frontier versus invalid all-level mounting: PSNR 27.74–30.21 dB, SSIM 0.911731–0.930638, with plainly visible edge doubling.
- valid Mobile SPZ fine frontier versus coarse-only root: PSNR 34.03–36.32 dB, SSIM 0.914215–0.935022.

Those metrics prove **pixel agreement at six tested Spark framings**, not original encoder provenance or that either reconstruction meets Venviewer’s product bar. A PLY and its export package can both be under-detailed. All six automated framings share one optical centre, so they do not test SH view dependence; spatially distinct near/mid/far and orbit cameras remain mandatory. The Quality-versus-Mobile difference is also confounded by separate four-hour reconstructions and settings; it cannot be attributed to SH order alone.

The 2026-07-16 database-free real-component run closes one narrower gap. The
actual Living Hall scene component loaded four named Quality SOG sources and
reported 2,002,009 decoded splats, then loaded four named Mobile SPZ sources
and reported 1,978,258 decoded splats, under the same explicit
`reception-fixed-fine-review-v1` profile and six fixed cameras. Twenty-four
lossless PNGs and twelve sidecars were retained; all twelve 500 ms static
repeat pairs were byte-identical. Bidirectional computer-vision comparison
found reviewable differences in five views and refused to assess the
ceiling-moulding view in each direction. This proves repeatable local loading
and detects where the two renders differ. It does **not** prove which source is
physically truer, because no aligned held-out room photograph is present. The
capture also did not re-hash the served asset bytes, so the exact claim is
limited to the four named sources and matching decoded totals.

A later local code hardening separates reviewed byte-profile identity from
anonymous presentation permission. The exact Reception IDs, filenames, hashes,
storage receipts, hierarchy and decision metadata now stay in server-only byte
receipts and are absent from the public response and production bundle; those
receipts do not themselves grant presentation eligibility;
authenticated administrator preview metadata remains a separate private path.
Both reviewed byte profiles are currently blocked from anonymous presentation.
Their four-member byte identities are reviewed, but neither Quality SOG nor
Mobile SPZ has an exact reviewed immutable presentation contract. The missing
contract must bind the exact group transform, camera policy and route, and
renderer-profile digest; the browser must receive and apply those exact
reviewed values instead of local presentation defaults. Therefore the public
Living Hall currently receives no profile or anonymous member URL. The detailed
legacy package endpoint and direct asset-ID streams are platform-admin-only,
and the browser legacy resolver stays on fallback. The older raw external-URL
single-visual endpoint is retired for every room. Any future public metadata
and byte request must re-check the room showcase switch, exact reviewed byte
identity and presentation contract, published state, human-reviewed public QA
and linked signed transform, with QA/transform scope tied to the exact
package/venue/room. `approved_public` is valid only when every required QA
check is present and has status `passed`; any other required-check status fails
closed. QA
binds the exact transform-content SHA-256, and transform and QA identifiers are
immutable except for exact idempotent retries. Reviewed objects use dedicated
private runtime-profile R2 credentials and a dedicated bucket with no public
URL and no legacy-storage fallback.

On a cache miss, the full object is size/SHA-256 verified before it can enter a
per-process 64 MiB / 16-entry / five-minute LRU. Identical concurrent reads use
single-flight, but authorization is never shared or cached: every request
re-runs all gates and exact immutable-member identity immediately before send.
Each API process has two active verified-response slots, a FIFO queue of 16, a
five-minute admission wait, a 16 MiB/member limit and a 30-second upstream
deadline. A separate absolute 180-second response/transfer deadline aborts
upstream work and destroys a stalled response. A slot is released only after
both handler work and the Node response finish/close lifecycle—or forced
deadline settlement—complete. The
member route is limited to 24 requests/minute/client IP. These process-local
controls do not replace edge/WAF protection.

The Reception showcase switch is still off, and both byte profiles are also
presentation-ineligible. No immutable presentation contract or private bucket
was provisioned, no reviewed objects were copied, and no direct-public-access denial was tested.
This remains fail-closed and undeployed. It is not a protected-route capture,
registration, public release, or quality result. External activation also
requires a reviewed exact group transform, camera policy/route and
renderer-profile digest that the browser applies exactly; least-privilege
private storage; object copy plus byte verification; proof that direct
anonymous access is denied; and edge rate-limit/WAF controls.

The earlier “approximately 2,002,122 splats / seven tiles plus environment / approximately 63.5 MB” claim conflated reported and packaged values. Direct inspection found 2,002,028 vertices in the Quality master PLY, 2,002,009 across its valid four-file fine SOG frontier, and 62,834,381 bytes for all seven SOG LoD chunks plus environment. The later current Mobile package has 1,978,258 in its valid four-file SPZ fine frontier and 52,911,630 bytes across all seven SPZ LoD chunks plus environment. Exact lineage values, not the old approximation, should drive packaging.

### Strongest practical route

Use a staged mixed strategy:

1. **Preserve and extend the completed local valid-frontier A/B**: the database-free fixed run now compares current Mobile fine with Quality-SH3 fine using only the two four-file frontiers and one explicit Spark profile. The server/client delivery boundary fails closed: reviewed byte membership alone is insufficient, neither profile has the immutable presentation contract, the room showcase switch remains off, and nothing is deployed. Next add spatially distinct/moving and performance/device evidence. Do not register, stream or test through the protected route until the exact group transform, camera policy/route and renderer-profile digest are reviewed and bound for exact browser application, and the remaining transform, migration and deployment gates pass. The frontier fix is mandatory, while the source winner remains empirical.
2. **Reprocess once in current LCC Studio v2.1** using its PortalCam alignment optimisation and Quality output, then compare it at the frozen cameras. Do not overwrite either existing reconstruction.
3. **Run a same-photo bake-off** between XGRIDS HD Enhancement and an owned-photography/trainer path using an external E57 scaffold only under separately cleared Matterport rights. Buy or upgrade only after written confirmation of entitlement, output rights, UK price/tax, and device/seat terms.
4. Where a full-room candidate still misses the Reception Room's actual fixed features—dark timber doors and glazing, curtains/windows, column and cornice/skirting detail, polished floorboards, or small wall fixtures—test **captured hero micro-splats** or independently controlled high-detail mesh overlays as separately registered layers. They are high-priority hypotheses, not measured Reception winners. The earlier generic fireplace/chandelier/painting/table list does not describe this empty captured room.

### Viability verdicts

- **Independent HD Enhancement:** viable enough for a bounded owned-photography/control pilot, provided the repo trainer is repaired. E57 can join only as a licensed, independently validated external scaffold. The lane is not presently runnable from the current Config B scaffold.
- **Raw PortalCam frame extraction:** **no authorized/open path is established from the reviewed artifacts**. Poses and sensor-event metadata are exposed, but RGB/LiDAR payloads, intrinsics, distortion, and calibration are not. The `.xbin` is proprietary `XBAG`; `lixel.zip` is encrypted. Proceed only through an official XGRIDS export/SDK and written rights.
- **Full retrain:** not first. It has no accessible PortalCam images and the trainer is broken.
- **Warm-start:** research bake-off only; no verified clean implementation currently exists and a warm start does not add missing observations.
- **Hero micro-splats:** high-priority prototype after a corrected base is measured; they can add real captured detail efficiently, but seams/orbit/performance are untested.
- **Hybrid mesh:** recommended for selected stable architectural edges and metric/collision authority, not as a blanket substitute for appearance.
- **Vendor HD:** benchmark and possible production lane; it may be the best time/quality trade, but local HD is not activated and entitlement/output rights plus existing-base distribution and LCC/LCC2 obligations need confirmation.
- **Generated enhancement:** optional visual-only derivative, labelled and segregated. The released ArtiFixer checkpoint is non-commercial and is rejected for production.

## 2. SUCCESS-CRITERIA AUDIT

| Criterion | State | Evidence / named blocker |
|---|---|---|
| A. Dominant-loss diagnosis | **Partially satisfied; cross-context hero comparison blocked** | Forty-two historical Spark-fixture captures prove invalid-hierarchy/coarse deltas and bound PLY-to-package deltas. A separate 2026-07-16 real-component run proves matched fixed-camera loading and material Quality-versus-Mobile pixel/edge differences, but not the direction of physical quality. LCC source, independent-viewer, spatially distinct/moving, and protected-product-route contexts remain blocked by `RR-LCC-HERO-CAPTURE-SET`, `RR-INDEPENDENT-VIEWER-CAPTURE-SET`, and `RR-ACTUAL-ROUTE-CAPTURE-SET`. |
| B. Raw-project go/no-go | **Satisfied to the non-circumvention inspection boundary** | Exact raw root, hashes, sidecars, pose rates/extents, ULog catalog, empty controls, encrypted calibration, and proprietary payload boundary are recorded. No authorized/open retraining path is established until an official export/SDK plus rights arrives. |
| C. Existing pipeline audit | **Satisfied** | Code, config, imports, shell runner, empty run ledger, evaluation, and packaging paths were inspected. Config B is not runnable and feature claims are separated from implementations. |
| D. Approach comparison | **Satisfied as a decision screen** | Twelve families are compared in the decision matrix with mechanism, information gain, generation, effort, cost, licence, risk, falsifier, blocker, and recommendation. Empirical vendor/training outcomes remain unverified. |
| E. Recommended quality stack | **Satisfied as a staged specification; implementation blocked** | Section 7 specifies sources, registration, provisional E57 alignment, capture, trainer repair/config, evaluation, lineage, runtime, hero layers, generated policy, and manifest fields. The missing CLIs and rights gates are explicit. |
| F. Bounded Reception pilot | **Partially satisfied; blocked pseudocode and missing fixtures** | Section 8 gives target paths, interfaces, outputs, GPU/storage/cost/actions/thresholds/stops, but the proposed pipeline modules/config do not exist yet and are not copy-paste commands. Execution is blocked by `RR-PILOT-CLI-BUNDLE`, `RR-TRAINER-RUNNABLE-BUNDLE`, `RR-PHOTO-METRIC-CONTROL`, training/data rights, and the 30-photo capture. `RR-E57-METRIC-CONTROL` is conditional only if the optional E57 lane is used. |
| G. Measurable quality gate | **Partially satisfied** | Historical codec/LoD metrics and the new lossless same-camera real-component CV/PSNR/SSIM/MAE evidence are measured. Static repeats are deterministic, but true held-out PSNR/SSIM/LPIPS, alignment residuals, moving-view stability, actual-route runtime performance, supported-device results, GPU memory and blinded human scoring remain. No single metric is accepted. |
| H. Licensing/commercial cleanliness | **Partially satisfied as a primary-source screen; exact-build and legal approvals remain** | Section 11 distinguishes candidate, restricted, unknown, vendor, and rejected components and links primary sources. `LEGAL-RIGHTS-MEMO`, `LEGAL-SOURCE-SNAPSHOT-SET`, and `CAPTURE-RIGHTS-PACK` name the unresolved XGRIDS/Matterport/photo/output/processing gates; dependency closure, patents and exact model weights also remain release gates. |
| I. Exact next actions | **Satisfied** | Sections 13–15 and the 2026-07-16 reconciliation separate the completed fixed local preflight from the next spatially distinct/moving/performance test and the independently authorized protected-route test. |

The objective is decision-ready and its empirical blockers are named. It is **not** a claim that an HD candidate has already passed product acceptance.

## 3. EVIDENCE CHAIN

### Local source and master evidence

| Evidence | Verified fact | Supports / does not support |
|---|---|---|
| `F:\gaussian splat -- xgrids\model\Reception_Room_2026-06-01-150618\2026-06-01-150618.xbin` | 8,696,471,552 bytes; SHA-256 `625D942745DB807E26841C9E86F10FA9F93B9F276C56E7FD312B094D3F16B565`; `XBAG` signature | Proves proprietary capture container exists; does not prove payload decodability or rights. |
| same raw project `poses.csv` | 9,080 poses, eight columns, ~9.998 Hz, 908.085-second span; quaternion norms approximately one; local extents x 10.475, y 13.252, z 1.254 | Proves a trajectory sidecar; coordinate convention, units, body/camera frame, and absolute alignment remain unverified. |
| same raw project `data.ulg` | four camera-event streams ~10 Hz, four RGB-event streams ~1.112 Hz, LiDAR ~10 Hz, IMU ~200 Hz | Proves timestamped event metadata, not embedded payload access. |
| same raw project `lixel.zip` | names camera/LiDAR/IMU/extrinsic YAMLs but entries use ZipCrypto | Proves calibration names are present behind encryption; this is the stop boundary. |
| `C:\Users\blake\AppData\Local\LccStudio\DATA\1900549066649638\output\ply-result\point_cloud\iteration_100\point_cloud.ply` | 496,504,970 bytes; 2,002,028 vertices; 62 float properties including `f_rest_0..44`; degree-3 SH; SHA-256 `DA8EFA94895EF7AA2C6024336278D855FDB13026BF10028901C3AC46D1E91A3D` | Earlier Quality reconstruction master. |
| same project `output\render2\Reception Room.lcc2` | SHA-256 `F0A4C782CC0F031830404D409F5C0ACCDC30ED501FA562169206962CEEE64F3E`; valid LCC2 levels independently enumerated; fine frontier totals 2,002,009 Gaussians | Defines the earlier hierarchical encoding. |
| `C:\Users\blake\AppData\Local\LccStudio\DATA\19005490661556650\output\ply-result\point_cloud\iteration_100\point_cloud.ply` | 134,589,707 bytes; 1,979,247 vertices; 17 properties; DC-only/SH0; SHA-256 `8F6894AAB409BBD413F379BB64B527D170E066D918CC6099C07FAE175F0B94B8` | Later Portable/Mobile reconstruction master. |
| `C:\Users\blake\Downloads\reception-room_xgrids_lcc2_sog_visual\lcc2-result\Reception Room Mobile.lcc2` | SHA-256 `C224ECDE1EC06260A1DC89778A1599C0511A479E6209D5E059AE32A5B3DCFD65`; coarse 491,784; valid medium 985,912; valid fine 1,979,204; all non-environment levels 3,456,900 | Same Mobile SH0 reconstruction encoded as SOG; supplies the same-source SOG/SPZ comparator. Original exporter version/settings remain unrecorded. |
| Mobile LCC2 SPZ tree | coarse 491,784; valid medium 985,690; valid fine 1,978,258; all seven summed 3,455,732 | Proves that mounting all levels is not a valid frontier. |
| `C:\Users\blake\Downloads\reception-room_xgrids_lcc2_spz_with_mesh\mesh-files\Reception Room Mobile.ply` | 379,462 bytes; SHA-256 `1C44FAFFBFD8011AFA69DC4150C9AF148070181227EA1B6A5861F884EF7BFEED`; 10,209 vertices / 19,747 faces; XYZ only | Verifies the attached mesh exists and is coarse geometry rather than an HD textured appearance source. |
| same package `lcc2-result\info\poses.json` | 542,400 bytes; SHA-256 `9D2D40F18A6B53AF63043F1849D83575ABE7D8B8563F85723F465DFA01D62C9A`; 4,529 poses; `RGB:null` for every record | Verifies an LCC-local trajectory export but not frames, intrinsics, distortion or pose convention. |
| same package `lcc2-result\info\report.json` | build duration `04:03:58`, scan duration 908.085 s, `quality:3`, `hdImageCount:0`, task `19005490661556650` | Proves the Mobile build did not use HD images; vendor field meanings beyond the literal values are not inferred. |
| `F:\E57\cloud_0.e57` | 20,518,437,888 bytes; SHA-256 `975039D11FC04CA681F038E499F358124BBCAB178AD5CE6324FA912212729CDD`; Matterport Pro3; 149 scans; 965,520,000 XYZRGB records; 894 4096² pinhole faces | Metric/registration bridge candidate. |
| E57 scan inventory | Reception is strongly indicated as scans 122–144: 23 stations, 149,040,000 records; scan 121 appears to be its doorway | Supported room crop, not a human-certified room identity. `RR-E57-CROP-CONFIRMATION` remains. |
| `F:\E57\colmap_v2` | Existing E57/COLMAP material covers scans 0–49 only | It is not a Reception model. A new Reception-only scaffold is required after scan 122–144 confirmation. |

### Repository/code evidence

- At the original cutoff, `venviewer_training/simple_trainer_depth.py` imported a missing `_upstream_simple_trainer.py` and the legacy RunPod path passed incompatible flags. T-514 later replaced this failure with a dependency-light contract checker and synthetic non-training preflight. Its successful result is `contract_valid_runtime_blocked`: help and validation now work, but optimization, GPU use, the real gsplat/Tyro worker, E57 depth, bilateral-grid serialization, optimizer-produced held-out output, resume, candidate generation and runtime packaging remain unproved or disconnected. The separate downstream D-014 verifier is implemented and tested.
- `infra/runpod/run_training.sh` now exits 78 before the legacy launch block. No RunPod image, live pod, trainer runtime, or optimization has been proved, and `state/training_runs.jsonl` remains empty.
- `configs/training/config_b.yaml` names desired features but is not wired end to end.
- the pinned gsplat sample path has additional absent imports (`datasets.traj`, utilities, viewer packages, bilagrid); 3DGUT configuration does not pass an appropriate per-camera model.
- strict depth indexing/input fixtures and the downstream D-014 verifier now exist, but production depth-loss wiring, distortion/UV mapping, ICP provenance, mixed camera/resolution support, optimizer metrics, resume, candidate generation and packaging remain incomplete or disconnected.
- `state/training_runs.jsonl` is empty. This proves no recorded run; it does not prove that no unrecorded experiment ever occurred.
- `infra/runpod/` contains a Dockerfile, bootstrap, runner, template and runbook, but no built-image/live-pod smoke was executed or evidenced here. Its runner now exits 78 before the dormant obsolete launch block, and its price text is stale. Account/template/secret state was deliberately not exposed or inferred.
- `packages/web/src/components/scene/SparkSplatLayer.tsx` now accepts one typed render profile and applies the same Spark renderer and mesh settings to every leaf in a reviewed composition. `LivingHallScene.tsx` supplies the explicit `reception-fixed-fine-review-v1` profile to all Reception sources.
- `packages/web/src/pages/TradesHallVisualPage.tsx` and its internal manifest mount every tiled URL for certain room fixtures.
- The public route still resolves published package data, but the later platform-admin-only private route can now express and validate the two exact audited four-leaf profiles. It has not been deployed, registered against the configured database, streamed through protected storage, or captured in the actual product route.
- planner code still pins DPR to `0.75`, while the separate Reception review profile pins Canvas DPR `[1,2]`, antialias off, sRGB output, ACES Filmic tone mapping at exposure 1, Spark `maxSh: 3`, `enableLod: false`, preblur 0, blur 0.3, radial sorting and explicit depth/transparency settings. The profile is a controlled baseline, not proof that blur 0.3 is optimal. The current room transform remains approximate. The runtime-package resolver and exact private-preview gate reject replacement-LoD mixtures; diagnostic fixtures intentionally retain arbitrary combinations so the older all-level failure remains a historical control.

### Screenshot and command evidence

- Local Vite and read-only local HTTP servers were used; no asset was uploaded or modified.
- `packages/web` route `/dev/splat-fixture` provided a pure Spark fixture with fixed `cam`, `look`, `fov`, and `zUp` parameters.
- Forty-two 1200×900 PNG captures are under `output/playwright/reception-hd-investigation/`; paths and cameras are in the fixed-view manifest.
- The six automated framings are overview, timber-left, timber-right, floor, ceiling-moulding, and column-skirting. Each covers seven variants: Quality PLY, valid Quality SOG fine, Mobile PLY, valid Mobile SOG fine, valid Mobile SPZ fine, invalid Mobile all-level, and Mobile coarse.
- A deterministic computer-vision triage pass and 12 three-panel human-review boards are documented in `docs/reports/reception-room-cv-triage-independent-audit-2026-07-13.md`. The two overview boards are preserved in `docs/reports/evidence/`; every input and output is SHA-256 bound, and the checker refuses stale or altered evidence.
- The two actual capture scripts and their hashes are recorded in the manifest; `tools/reception-hd/capture-fixed-views.playwright.js` is a canonicalized hashed replay driver created afterward. `tools/reception-hd/compare_fixed_views.py` produced a hashed per-view metrics artifact with a declared 7×7 SSIM implementation. Metrics are full-frame sRGB-sample diagnostics and include the identical background.
- Pixel metrics were measured on equal dimensions. A Laplacian-variance probe incorrectly called the doubled all-level image “sharper,” demonstrating why a single sharpness statistic is unsafe.
- The 2026-07-16 local run used `/dev/reception-quality-preflight`, a compile-time development-only route with two hard-coded candidates and no registry, database, authentication, upload or public-pointer change. It exercised the real Living Hall scene component, not the older pure-Spark fixture and not the protected authenticated package route.
- Its capture root is `output/playwright/reception-hd-real-component-2026-07-16/`. `capture-manifest.json` is 12,398 bytes with SHA-256 `E414EE58D64266C59BEBFA23485F897C8C3472929853EC3B398E093AE43FAF5B`. The seal-time audit reported 15/15 matching environment entries; a fresh 2026-07-16 current-worktree check finds 13/15 because `pnpm-lock.yaml` and `packages/web/src/router.tsx` changed later. The selected manifest is not a complete transitive-module inventory. The immutable evidence still binds 24 true 1200×900 lossless PNGs, 12 sidecars, exact camera matrices and the observed effective DPR of approximately 1.
- `cv-triage.json` is 47,379 bytes with file SHA-256 `9CC0AF09BDC25FC004E34F1D0E741611F699145C81BF7E9E6BE8BEFD7C58F15B`; its canonical report receipt is `55BF71044439E9CE15CB6D069F296A155BA5AA8B33F46B4ED34A87648A9143DC`. In both comparison directions five views require review and ceiling-moulding is not assessable. `pixel-metrics.json` is 3,423 bytes with SHA-256 `D79443A4594D97FAB25724ACC97772159D41F09F6B0A1CC63E89A0863490CAF3`; full-frame ranges are PSNR 26.912251–29.773793 dB, SSIM 0.941555–0.961395 and MAE 0.025317–0.040604.
- An initial browser screenshot attempt was reported to have written JPEG data behind `.png` names, but those discarded bytes and their rejection log/hash were not retained, so the incident is not independently reproducible. Those inputs were excluded. The final 24 files independently pass PNG-signature, 1200×900, eight-bit-RGB and hash checks; the strict renderer also refuses decoded input whose actual format is not PNG.
- Installed GPU: NVIDIA RTX 4090, 24 GB. Installed LCC Studio: v2.0.0. Its UI reported **HD Enhancement — Not Activated**.
- Attempting to open the Reception project showed: “An editor is currently running and may corrupt the open file. Confirm that your changes are saved?” The action was cancelled; safety takes precedence over an automatic LCC screenshot.

### Primary-source evidence

All links were accessed 2026-07-12.

- XGRIDS current downloads and release history: <https://www.xgrids.com/support/download?page=LCCStudio>.
- LCC Studio v2.1 overview/capabilities: <https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.1.0/01-getting-started.html>.
- current Single Model/HD input requirements: <https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.1.0/07-single-model.html>.
- current HD capture FAQ: <https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.1.0/17-faq.html>.
- public Premium product page: <https://store.xgrids.com/products/lixel-cybercolor-1-year-premium>; public PortalCam upgrade page: <https://store.xgrids.com/products/portalcam>.
- XGRIDS Terms of Use: <https://store.xgrids.com/policies/terms-of-service>. No clear public clause was found by this review allocating downstream commercial rights in locally generated models; request written terms.
- LCC format Whitepaper/licence, reviewed at commit `b38c2eb31be24e4220f23c69c4a0f3306356920e`: <https://github.com/xgrids/LCCWhitepaper/tree/b38c2eb31be24e4220f23c69c4a0f3306356920e>.
- LCC2 format Whitepaper/licence, reviewed at commit `039367dbe53ccbfa07b44a8e6280ceb4ebf8aa0b`: <https://github.com/xgrids/LCC2Whitepaper/tree/039367dbe53ccbfa07b44a8e6280ceb4ebf8aa0b>.
- Matterport Platform Subscription Agreement and Terms: <https://matterport.com/legal/platform-subscription-agreement>, <https://matterport.com/terms-of-use>. The PSA treats E57 as a Matterport Digital Asset, owned by Matterport and licensed to the customer with use/distribution but no-resale conditions; the Terms prohibit commercial AI/ML training using Matterport Data. Counsel must determine how those provisions apply to this exact E57 and proposed derivatives.
- Core candidate code sources: gsplat v1.5.3 <https://github.com/nerfstudio-project/gsplat/tree/v1.5.3>; UBC 3DGS-MCMC <https://github.com/ubc-vision/3dgs-mcmc>; COLMAP <https://github.com/colmap/colmap>; hloc <https://github.com/cvg/Hierarchical-Localization>; LightGlue <https://github.com/cvg/LightGlue>; ALIKED <https://github.com/Shiaoming/ALIKED>; Open3D <https://github.com/isl-org/Open3D>; PDAL <https://github.com/PDAL/PDAL>.
- Runtime/tool sources: Spark <https://github.com/sparkjsdev/spark>; Three.js r180 <https://github.com/mrdoob/three.js/tree/r180>; SuperSplat <https://github.com/playcanvas/supersplat>; splat-transform <https://github.com/playcanvas/splat-transform>. Exact build/dependency closure remains a release gate.
- Standalone GLOMAP was archived on 2026-03-09 and migrated into COLMAP as the global mapper: <https://github.com/colmap/glomap>.
- RunPod public pricing and billing semantics: <https://www.runpod.io/pricing>, <https://docs.runpod.io/pods/pricing>.
- RealityScan licence/pricing: <https://www.realityscan.com/license?lang=en-US>, <https://www.realityscan.com/en-US/eula>.
- ArtiFixer code/model sources: <https://github.com/nv-tlabs/ArtiFixer>, <https://huggingface.co/nvidia/ArtiFixer>, and the governing <https://developer.download.nvidia.com/licenses/NVIDIA-OneWay-Noncommercial-License-22Mar2022.pdf>.

Mutable-terms caveat: the Matterport PSA and Terms pages displayed “Last Updated: March 1, 2026.” The reviewed XGRIDS store Terms and RealityScan EULA did not supply a retained immutable content/version snapshot in this investigation. Access dates and URLs are not enough for a release audit; `LEGAL-SOURCE-SNAPSHOT-SET` requires counsel-approved internal snapshots or archive identifiers, content hashes, effective/version dates where shown, and the exact customer/order terms that controlled on the relevant acquisition/use date.

## 4. FOUR-VIEW DIAGNOSIS

### What the automated fixed views prove

| Comparison | Result | Diagnosis |
|---|---|---|
| Quality PLY → valid fine SOG | visually near-identical at six framings; PSNR ~42 dB, SSIM ~0.967–0.972 | The PLY-to-SOG-package delta is not the dominant tested loss. Original encoder settings/generation count and other camera centres remain unproved. |
| Mobile PLY → valid fine SOG | PSNR 41.44–43.75 dB, SSIM 0.958–0.971 | The same Mobile PLY also has a high-agreement SOG package. |
| Mobile PLY → valid fine SPZ | PSNR 41.79–43.65 dB, SSIM 0.960–0.970 | The PLY-to-SPZ-package delta is not the dominant tested loss. |
| Mobile valid SOG → valid SPZ | PSNR 42.03–44.02 dB, SSIM 0.958–0.970 | Same-Mobile-source SOG and SPZ render similarly at the six tested same-centre framings; this does not rank them for SH or motion. |
| valid fine SPZ → all seven SPZ chunks | visible smeared/doubled floor and edges; much lower pairwise scores | Internal runtime incorrectly overlays replacement LoDs. This is a renderer/package-contract loss, not new reconstruction information. |
| valid fine SPZ → coarse root | visibly softer, only 24.86% of fine-frontier Gaussian count | A one-URL public path cannot represent the highest-detail inspected LCC2 frontier. |
| Quality source PLY → Mobile source PLY | substantial difference (PSNR 25.42–29.16, SSIM 0.906682–0.932757) | The runtime pointer selected a materially different reconstruction. Cause is confounded across reconstruction mode/settings/SH; do not assign it to compression or SH alone. |
| DPR 0.75 inspection | deterministic under-resolution in planner | Canvas undersampling is a real secondary loss, especially on high-DPR screens. |

The proved softness/ghosting is therefore **global where the runtime uses an invalid LoD/coarse fallback/DPR**, while the directional effect of substituting Mobile SH0 for Quality SH3 remains unmeasured and local source undercapture may still dominate hero features. Ghosting from pose/alignment remains plausible at source level, especially where edges split in both the PLY and valid package, but has not been isolated from exact LCC/reference imagery. Because all six automated views share one optical centre, they cannot measure degree-3 SH/view-dependent behaviour; add spatially distinct camera centres and an orbit before ranking Quality SH3 against Mobile SH0.

### Named missing artifact and exact LCC screenshot checklist

Artifact `RR-LCC-HERO-CAPTURE-SET` is required to distinguish reconstruction loss from subject-specific undercapture. Asset-backed review found that the original generic fireplace, chandelier, painting and table targets are absent from this empty captured room, so the five views below use visible fixed Reception features instead.

Blake should perform this only after confirming that the project is saved and no other LCC editor owns it:

1. Record `LCC Studio version`, Windows display scaling, project name/ID, reconstruction mode, quality level, SH/antialias information if shown, exposure/brightness controls, and whether HD is activated.
2. Open the **earlier Quality Reception Room** project. If the editor-running warning remains, stop and identify/close the owning editor; do not click through.
3. Use perspective projection and disable any beautification not available in Spark. Fit the whole room once, then frame each feature at a distance that keeps context around all four edges. Do not change exposure between source/export/runtime for a feature.
4. Save PNG screenshots at the viewer’s native resolution with these exact names:
   - `RR-TIMBER-DOORS-A-LCC-QUALITY.png`
   - `RR-CURTAINS-WINDOWS-A-LCC-QUALITY.png`
   - `RR-COLUMN-MOULDING-A-LCC-QUALITY.png`
   - `RR-FLOORBOARDS-A-LCC-QUALITY.png`
   - `RR-ROOM-DEPTH-DETAIL-A-LCC-QUALITY.png`
5. Record camera position, target, up vector, FOV/focal length and viewport dimensions if LCC exposes them. If it does not, save `RR-<FEATURE>-A-LCC-QUALITY-camera-unavailable.txt` containing “camera transform not exposed by LCC Studio <version>”.
6. Reproduce each framing in the full Quality PLY, valid Quality SOG fine frontier, valid Mobile SOG fine frontier, valid Mobile SPZ fine frontier, and Venviewer private candidate. Save suffixes `-PLY-SH3`, `-SOG-SH3-FINE`, `-SOG-SH0-FINE`, `-SPZ-SH0-FINE`, and `-VENVIEWER-CANDIDATE`.
7. Capture a matching high-resolution reference photograph where safe. Keep it held out from any training candidate used in that comparison.
8. Review at 100% pixels for carvings/edges, pose ghosts, missing surfaces, view-dependent colour, floaters, transparency, exposure and novel-view stability. A result cannot pass from a single hero screenshot.

Automated screenshot filenames and exact camera values are in `reception-room-fixed-view-manifest.json`.

Two additional artifacts are required before Criterion A is complete:

- `RR-INDEPENDENT-VIEWER-CAPTURE-SET`: in a non-Venviewer renderer such as a pinned SuperSplat build, reproduce all five feature framings for the full Quality PLY and the valid Quality SOG, Mobile SOG, and Mobile SPZ fine frontiers. Use `RR-<FEATURE>-A-INDEPENDENT-PLY-SH3.png`, `-INDEPENDENT-SOG-SH3-FINE.png`, `-INDEPENDENT-SOG-SH0-FINE.png`, and `-INDEPENDENT-SPZ-SH0-FINE.png`.
- `RR-ACTUAL-ROUTE-CAPTURE-SET`: after deployment, candidate registration and authenticated streaming are separately authorized, capture only the valid Mobile fine and Quality fine candidates in the actual private product route. Use `RR-<FEATURE>-A-ACTUAL-MOBILE-FINE.png` and `-ACTUAL-QUALITY-FINE.png`. The all-level and conditional coarse-root failures remain historical diagnostic-fixture controls; the protected route must not be weakened to reproduce them.

Save both sets under `output/playwright/reception-hd-investigation/manual-cross-context/`. For every PNG, save a same-stem JSON sidecar with application/build, input asset IDs/hashes, import options, renderer settings, viewport, effective DPR, exposure/tone mapping, camera position/target/up/FOV and actual view/projection matrices where exposed, load result/count, FPS/GPU memory/load time for the actual route, and capture timestamp. If the LCC camera is unavailable, frame by reviewed side-by-side feature context and mark `cameraMatch: visual_only`; do not use that image for pixel metrics. The independent viewer must not be a Venviewer/Spark wrapper, and the actual route must not be `/dev/splat-fixture` or `/dev/reception-quality-preflight`.

## 5. RAW-PROJECT GO / NO-GO

**Decision: NO-GO for independent PortalCam retraining from the current project. GO only for metadata/pose inventory and vendor-export preparation.**

| Item | State | Evidence | Specific next test |
|---|---|---|---|
| Frame availability | **Requires vendor export** | No open images found; event records refer to RGB/camera streams but do not expose payloads | Ask XGRIDS for original per-camera frames with hashes and mapping to timestamps |
| Frame format | **Indeterminate/proprietary** | `.xbin` begins `XBAG`; RGB events have record sizes but no documented extraction route | Official export/SDK documentation only |
| Camera count | **Verified present: four event sources** | ULog IDs label left/right main/secondary cameras; metadata identifies `rs_airy` | Vendor must map IDs to optical centres and images |
| Image dimensions | **Indeterminate** | Not present in open sidecars | Exported image headers or official calibration |
| Timestamps | **Verified present for events/trajectory** | ULog and 9,080-pose CSV; camera and RGB streams have different rates | Export a 30-second sample and prove timestamp join/residual |
| Pose source | **Verified present but semantically incomplete** | raw `poses.csv`; Mobile LCC2 also exposes 4,529 timestamped `T`/`R` poses with every `RGB` field null | Vendor document body/sensor/camera frame, pose direction, interpolation and mapping between the two trajectories |
| Pose coordinate frame | **Indeterminate** | Local extents only; no reviewed frame declaration | Three surveyed correspondences or E57 similarity-transform fit |
| Intrinsics | **Encrypted/proprietary** | calibration YAML names exist only inside encrypted `lixel.zip` | Official unencrypted calibration export |
| Distortion | **Indeterminate; likely wide-angle** | no open coefficients/model; device metadata alone is insufficient | Official per-camera model/coefficient export and calibration images |
| Point cloud | **Only decimated preview/open vendor reconstruction** | raw LiDAR payload is not separately exposed; LCC outputs are available | Official raw registered LAS/LAZ/E57/PLY export |
| Depth | **Indeterminate/embedded** | LiDAR event metadata exists; no per-frame depth maps | Official timestamped LiDAR/depth export |
| LiDAR alignment | **Encrypted/proprietary** | extrinsic YAML names in encrypted archive | Official sensor-to-body extrinsic matrices and conventions |
| Calibration | **Encrypted/proprietary** | `lixel.zip` uses ZipCrypto | Ask vendor; do not decrypt/circumvent |
| Firmware/software version | **Verified present in metadata** | algorithm `v2.1.2.20250828.beta`; software `V3.2.1_20250829.122027`; system `V3.2.1`; LiDAR `A5.07.29.12`, driver SDK `1.5.17`, control library `V1.8@20250722`, type `rs_airy` | Preserve exact JSON hash with any export; device/user identifiers remain private |
| GNSS/control | **Verified unusable for this room** | GNSS rows are zero/status 0; `control_points.csv` empty | Use E57/surveyed controls, not GNSS |

There is no clean basis to claim 200° PortalCam imagery will work in COLMAP/3DGUT. COLMAP/gsplat pinhole-like projection rejects rays behind the image plane; any future vendor frame export must include exact calibration. The safe first route is vendor-provided rectified views or virtual pinholes capped around 80–85° half-angle, followed by a calibrated-camera bake-off. New DSLR photography should remain rectilinear.

## 6. APPROACH REGISTRY

The complete per-factor matrix is in `reception-room-quality-decision-matrix.md`.

| ID | Approach | Status | Evidence | Falsifier | Blocker | Next test |
|---|---|---|---|---|---|---|
| R1 | Spark/runtime tuning | **Confirmed necessary** | invalid all-level and coarse-only paths; DPR 0.75; fixed-view deltas | corrected candidate fails to improve human/runtime gates | reviewed transform/package contract | private valid-Mobile-versus-Quality fine A/B |
| R2 | Better LCC export/compression | **Promising but not codec-led** | valid PLY→export-package pixel agreement is high; Quality SH3 candidate exists; original encoder provenance is missing | a newly controlled direct-from-master encoding still loses heroes | exact exporter settings/rights | retain both valid-frontier candidates, then encode one signed fine cut only if needed |
| R3 | LCC v2.1 alignment reprocess | **Promising** | installed v2.0; v2.1 release notes advertise relevant optimisation/validation | same-source v2.1 shows no held-out/edge gain | safe project copy + operator time | one Quality reprocess |
| R4 | XGRIDS HD Enhancement | **Promising/vendor gate** | official current feature/requirements; local not activated | same-photo independent or base wins blinded gate | entitlement, output rights, price | written quote + 30-photo benchmark |
| R5 | PortalCam full retrain | **Blocked** | images/intrinsics/depth not openly available; trainer broken | official export proves complete clean bundle | `RR-XGRIDS-OPEN-EXPORT`, rights, trainer | request export bundle |
| R6 | Owned-photo retrain with optional licensed E57 scaffold | **Promising** | rectilinear capture plus independent controls; E57 inclusion is rights/control-gated | 30-photo pilot misses registration/metric gates | capture rights + controls + CLI/trainer repair | 30-photo pilot |
| R7 | Warm-start LCC refinement | **Research only** | could preserve base; no verified implementation/lineage | worse held-out stability or entangled provenance | clean importer/optimizer path | one hero crop bake-off after R6 |
| R8 | Captured hero micro-splats | **High-priority hypothesis after base fix** | adds new observations only where needed; no Reception prototype exists | seams/scale drift or no blinded hero gain | hero capture/registration/compositor | timber-door/glazing + column-moulding prototype |
| R9 | High-detail mesh overlays | **Promising for stable edges** | independently controlled photogrammetry or a licensed/validated E57 derivative could carry metric geometry; current attached mesh is only 10,209 vertices/19,747 faces and XYZ-only | view mismatch/occlusion artifacts outweigh edge gain | source rights + controls + material bake | column/skirting/cornice A/B |
| R10 | ArtiFixer/generated derivative | **Rejected for production checkpoint** | released weights non-commercial; generated truth risk | commercially licensed alternative with clear provenance may reopen | licence and governance | none until rights-approved model |
| R11 | Targeted hero recapture | **Recommended** | cheapest source of genuine missing detail | registered images add no held-out improvement | access/lighting/control | 96-photo hero set after 30-photo pilot |
| R12 | Full room recapture | **Fallback/promising** | open rectilinear protocol avoids PortalCam dependency | targeted route already passes all features | site time and capture discipline | run only if coverage audit fails |

## 7. RECOMMENDED PIPELINE

### 7.1 Immutable source and authority split

Create a content-addressed Reception job without moving or rewriting masters:

- higher-capacity vendor visual candidate: earlier Quality SH3 PLY and its LCC2/SOG hierarchy, subject to existing-base distribution and format-licence gates;
- existing portable comparison: later Mobile SH0 PLY and SPZ hierarchy;
- raw provenance: Reception PortalCam project, metadata and hashes, never decoded or overwritten;
- external metric-reference candidate: `F:\E57\cloud_0.e57`, provisionally scans 122–144 after human confirmation, independent controls and Matterport-use clearance;
- new captured visual source: deterministic DSLR RAW/JPEG pairs and developed derivatives;
- metric authority: an independently surveyed photo-control network only after `RR-PHOTO-METRIC-CONTROL`; if E57 is used, it additionally requires `RR-E57-METRIC-CONTROL` and the applicable source/derivative rights. The E57 is not metric truth by declaration;
- generated derivatives: isolated role and explicit watermark/provenance; never collision/route/measurement authority.

### 7.2 Stage 0: correct runtime before reconstruction

This stage is local preparation only while migrations 0050–0058 remain pending.
The hard-coded, database-free development preflight is safe within that local
boundary and its fixed-view slice was completed on 2026-07-16. Do not register,
stream or run either candidate through the protected private route until the
complete migration/deployment tail is reviewed, safely deployed, verified and
explicitly approved.

1. Retain the two exact private candidate definitions already implemented: the four valid Mobile SPZ fine leaves and the four Quality SOG fine leaves. The 2026-07-16 local run observed all four named sources and the expected decoded total for each candidate; it did not independently hash the served bytes. Retain the historical Mobile all-level and conditional coarse-root captures as read-only diagnostic-fixture baselines; do not admit those invalid compositions to the protected route, and do not assume the Quality source wins.
2. Preserve the LCC2 tree/index as provenance; declare `lodSelectionPolicy: fixed_fine_frontier_v1` until adaptive selection exists.
3. For a visual-only transform, record that no metric claim is made. For a metric alignment, use at least eight well-distributed, non-coplanar fit controls plus six separate blind controls; declare rigid versus similarity model, scale, uncertainty, 4×4 matrix, source/destination frames, residuals, reviewer, date and hash.
4. Keep the implemented `reception-fixed-fine-review-v1` profile as the controlled comparison baseline: Canvas DPR `[1,2]`, antialias off, sRGB, ACES Filmic/exposure 1, and explicit Spark SH/LoD/blur/preblur/sort/depth settings. The observed fixed capture ran at DPR approximately 1. A separate blur/preblur optimisation and bounded adaptive product profile still require moving/performance/device evidence.
5. In the diagnostic fixture, compare all four historical branches (Mobile all-level baseline, Mobile coarse baseline, Mobile valid fine, Quality valid fine). The real Living Hall component has now compared the two audited valid fine profiles at six same-centre cameras. Add spatially distinct near/mid/far/orbit and moving tests next; later repeat through the protected route. Do not weaken the resolver to recreate invalid controls, and do not let planner mesh, tone mapping, postprocessing, or a different camera confound the source diagnosis.
6. A/B the environment chunk; its diagnostic exclusion is not a release assumption. An actual-route environment control also requires a separately audited exact profile first.
7. Release only through the Reconstruction Foundry review/signing boundary after fixed/moving/performance gates, confirmed existing-base distribution rights, and all LCC/LCC2 attribution/notice/downstream/derivative obligations.

### 7.3 Stage 1: current vendor reprocess and benchmark

1. Duplicate the project at the filesystem level using vendor-supported workflow; keep the v2.0 outputs immutable.
2. Upgrade LCC Studio to v2.1 only after the active-editor warning is resolved and backups/hashes are verified.
3. Run one Quality/alignment-optimised reconstruction from the same PortalCam project. Record every visible setting, version, duration and hardware statistic.
4. Use the exact fixed-view manifest and post-freeze localized or independently posed reference photos. If it does not beat the Quality SH3 candidate at local edge stability and blinded preference, stop vendor reprocessing.
5. Obtain a written HD entitlement/output-rights response, then use the same 30 rectilinear photos for the vendor/independent bake-off. Before any venue photo enters LCC/vendor processing, record whether processing is fully local or uses network/cloud egress and obtain terms for input-photo licence, confidentiality, processing location/subprocessors, retention/deletion, telemetry, secondary use/model training, incident handling and export.

### 7.4 Stage 2: owned-photo lane with an optional licensed external E57 scaffold

1. Build the first Reception-only COLMAP model from owned rectilinear photographs and an independently captured control network. Use COLMAP SIFT as the baseline; ALIKED+LightGlue may be compared only after exact code/weight review. Avoid the common SuperPoint/SuperGlue route unless its exact artifacts are accepted.
2. Human-confirm E57 scans 122–144, but keep E57 inspection/cropping internal and provisional. The Matterport E57 is a Matterport Digital Asset, not owned training data. Do not use E57 points, images, poses, derivatives or E57-derived camera poses/depth for commercial model training without express written permission.
3. If Matterport grants the required use, conversion and derivative rights, build a separate Reception E57 scaffold, hold its source poses fixed initially, and compare it to the independently controlled photo model. If permission is absent, use surveyed controls and a post-training visual transform instead.
4. For E57 alignment use at least eight non-coplanar fit controls and six blind controls, reject repeated-structure matches, declare rigid versus similarity model and scale, and save RMSE, median, p95, inlier count, floor/wall residuals, blind-control errors, uncertainty and matrix.
5. Keep the first training set to one rectilinear `PINHOLE` projection family/resolution bucket. Same-model mixed intrinsics and batch-size-one varying resolutions are **unverified rather than categorically unsupported**; mixed projection models and varying-size batches require explicit fixtures.
6. Repair the trainer before any long job: vendor/pin an upstream gsplat commit, make entry points/CLI/config coherent, implement MCMC strategy selection, correct `camera_model` propagation, wire antialiasing/3DGUT/bilateral-grid/depth paths, implement held-out metrics, seed/resume, import smoke, deterministic run bundle and packaging.
7. Train the baseline gsplat/MCMC candidate first. Add 3DGUT only for a verified distorted-camera dataset. Add any E57-derived depth only after rights, projection/occlusion and transform fixtures pass. Add bilateral grids only if evaluation freezes or neutralizes per-view appearance parameters.
8. Compare a cold owned-photo candidate, a vendor base plus separately captured hero micro-splats, and selected measured mesh overlays. Micro-splats are a high-priority forecast, not a proven winner; whichever candidate passes global, hero, performance and rights gates wins.

### 7.5 Output lineage and runtime contract

For every candidate record:

- source file paths/aliases, byte sizes, SHA-256, acquisition device/date and rights decision;
- raw-to-developed image recipe and checksums;
- camera model/intrinsics/distortion/image dimensions/timestamp/pose convention;
- source and room coordinate frames, handedness, units, quaternion ordering, transform and residual artifact;
- registration tool/version/config/seed and inlier/reprojection metrics;
- trainer commit/container digest/config/seed/GPU/duration and exact train/eval split;
- PLY master hash, direct encoder/version/settings and resulting chunk/tree hashes;
- SH degree, antialiasing flag, Gaussian counts per valid frontier, source-generation count and no-re-encode assertion;
- Spark/Three versions, rendering profile, DPR/viewport/tone/exposure/blur/point budget;
- authority class (`captured_visual`, `metric`, `generated_visual`, `runtime_derivative`), reviewer, approval and rollback asset.
- source/data/format licence URL, reviewed commit/version/date, exact distribution/refinement/training decision, required attribution UI text, modification notice, recipient Whitepaper/link, redistribution notice, downstream restriction flowdown, derivative/open-terms decision and counsel reviewer.

Runtime formats: keep a loss-minimized PLY as the private source master, package a newly controlled direct-from-master SOG/SPZ only where the deployed Spark version supports it, retain LCC2 hierarchy metadata, and ship a separately licensed and validated metric GLB only when its derivative/distribution rights are cleared. Spark2’s current SPZ reader supports up to v3; an SPZ v4 vendor output requires a compatibility fixture before release.

### 7.6 Hero and generated-content policy

- Hero micro-splats must be captured, registered, clipped to reviewed masks/bounds and tested for seams at near/mid/far views. They inherit captured-visual authority only, never metric authority.
- High-detail meshes may carry metric authority only when built/reviewed against the control network; photographic textures remain visual evidence.
- Generated assets require model/weights/licence/prompt/source hashes, a separate runtime layer/flag, visual-only authority and a reversible toggle. They cannot fill an unseen feature and then be described as captured truth.

## 8. RECEPTION ROOM PILOT

### 8.1 Exact inputs and layout

Do not duplicate the 20 GB E57 or 8.7 GB `.xbin` into git. Build an external workspace such as `F:\venviewer-hd\reception-room-pilot-v1`:

```text
reception-room-pilot-v1/
  00-manifests/          source-manifest.json, rights.json, split.json
  01-vendor-quality/     immutable aliases to SH3 PLY + LCC2/SOG
  02-vendor-mobile/      immutable aliases to SH0 PLY + LCC2/SPZ
  03-e57/                rights decision, scan inventory, provisional crop, controls, transforms
  04-photos/
    raw/                 immutable CR3/NEF/ARW + camera JPEG
    masters-tiff16/      deterministic developed masters
    train-png8/          geometry-identical sRGB derivatives
    heldout/             excluded from mapping/BA/training; post-freeze pose localization only
    calibration/         ChArUco and slates
  05-colmap/             owned-photo-model/, optional-e57-scaffold/, heldout-localization/, reports/
  06-depth/              optional only after transform fixture passes
  07-runs/<run-id>/       config, environment, logs, checkpoints, metrics
  08-packages/<id>/       PLY master, SOG/SPZ, GLB, manifest, signatures
  09-evidence/            fixed PNGs, human scores, performance traces
```

Pilot source set:

- exact Quality/Mobile assets named in the evidence JSON;
- E57 external reference candidate plus provisional scans 122–144, usable beyond internal inspection only under the recorded rights decision;
- **30-photo registration pilot first**: use `docs/reports/reception-room-30-photo-capture-checklist.md` as the authoritative shot list. Its 18 mapping photos are split into disjoint sets A and B; each set has five general 24 mm views, two 50 mm timber-door/glazing/curtain/window views, and two 50 mm floorboard/skirting/cornice/column-detail views. Twelve paired validation photos come from six repeated camera stations;
- name mapping photos `RR-PILOT-MAP-A-01..09` and `RR-PILOT-MAP-B-01..09`; name repeat pairs `RR-PILOT-S01-A/B` through `RR-PILOT-S06-A/B`. Repeat stations must span the whole-room overview, timber doors/glass, curtains/windows, a column with cornice or skirting, polished floorboards, and doorway/room depth with one fixed small wall feature;
- exclude all 12 repeat images from both subset mapping, triangulation and BA. Freeze the A and B models built from their respective nine mapping images plus the same independent controls, then localize each station’s A image pose-only against frozen model A and B image pose-only against frozen model B. Compare the two room-frame poses; do not let either validation image update either model;
- 36 held-out views for the full capture phase. They never enter mapping, triangulation, BA, training or appearance fitting. After the training model and candidate are frozen, they may be localized pose-only against the frozen training-only sparse model with PnP/RANSAC and no model/intrinsic refinement. Any photo lacking a defensible post-freeze pose is human-review-only, not a PSNR/SSIM/LPIPS sample.

### 8.2 Commands and scripts

Only the capture and pixel-comparison diagnostics below exist today. The capture is replay-oriented, not bit-reproducible: the two scripts actually evaluated are retained under `tools/reception-hd/`, the canonical seven-variant replay expression and server mappings are explicit, and renderer/lock files are hashed in the manifest at report finalization. The worktree was dirty and no exact capture-time lock/diff/browser-binary snapshot was retained, so a future replay must be treated as a new run and compared by hashes.

Run the first three commands in separate PowerShell terminals, then run the browser commands from the repository root:

```powershell
# Terminal 1: Venviewer fixture.
pnpm --filter @omnitwin/web dev --host 127.0.0.1 --port 5182

# Terminal 2: read-only Quality project assets.
Set-Location 'C:\Users\blake\AppData\Local\LccStudio\DATA\1900549066649638\output'
python -m http.server 5190 --bind 127.0.0.1

# Terminal 3: read-only Mobile project assets.
Set-Location 'C:\Users\blake\AppData\Local\LccStudio\DATA\19005490661556650\output'
python -m http.server 5191 --bind 127.0.0.1

# Repository-root terminal: one canonical 7 x 6 replay.
npx --yes --package @playwright/cli playwright-cli -s=reception-hd open http://127.0.0.1:5182/dev/splat-fixture
$CaptureCode = Get-Content -Raw -LiteralPath 'tools/reception-hd/capture-fixed-views.playwright.js'
npx --yes --package @playwright/cli playwright-cli -s=reception-hd run-code $CaptureCode
npx --yes --package @playwright/cli playwright-cli -s=reception-hd close
```

The historical 36+6 split is preserved exactly in `capture-variant-matrix.actual.js` and `capture-mobile-sog.actual.js`; the canonical script combines them without claiming it was the script originally evaluated.

The later command block is an **interface contract/pseudocode**, not an executable runbook: every named pipeline module/config except the diagnostic scripts is missing. `RR-PILOT-CLI-BUNDLE` is complete only when each future command has a smoke-tested `--help`, a fixture, exact dependency lock and saved output schema.

```powershell
# Existing read-only metric command.
python tools/reception-hd/compare_fixed_views.py `
  --root output/playwright/reception-hd-investigation `
  --output output/playwright/reception-hd-investigation/fixed-view-metrics.json
```

Proposed CLI contract for implementation; **do not run this block yet**:

```powershell
$Pilot = 'F:\venviewer-hd\reception-room-pilot-v1'
$RunId = 'rr-owned-photo-baseline-001'
$CandidateId = 'rr-candidate-001'

# Every --help must return 0 before real data is accepted.
pnpm exec tsx tools/reception-hd/inventory.ts --help
python -m venviewer_training.build_reception_scaffold --help
python -m venviewer_training.register_reception --help
python -m venviewer_training.localize_holdout --help
python -m venviewer_training.train --help
pnpm exec tsx tools/reception-hd/package.ts --help
pnpm exec tsx tools/reception-hd/evaluate.ts --help

# Owned-photo model: calibration/groups and controls are mandatory inputs.
python -m venviewer_training.register_reception `
  --images "$Pilot\04-photos\train-png8" `
  --camera-groups "$Pilot\00-manifests\camera-groups.json" `
  --controls "$Pilot\00-manifests\controls.json" `
  --output "$Pilot\05-colmap\owned-photo-model"

# Optional E57 scaffold only after identity, metric-control and rights gates.
python -m venviewer_training.build_reception_scaffold `
  --e57 F:\E57\cloud_0.e57 --scans 122:144 `
  --rights "$Pilot\00-manifests\rights.json" `
  --fit-controls "$Pilot\00-manifests\e57-fit-controls.json" `
  --blind-controls "$Pilot\00-manifests\e57-blind-controls.json" `
  --output "$Pilot\05-colmap\optional-e57-scaffold"

# Only after RR-TRAINER-RUNNABLE-BUNDLE passes a synthetic smoke.
python -B -m venviewer_training.train `
  --config configs/training/reception_config_b.yaml `
  --dataset "$Pilot\05-colmap\owned-photo-model" `
  --run-dir "$Pilot\07-runs\$RunId"

# Held-outs are localized after the model/candidate freeze; never triangulated or BA-refined.
python -m venviewer_training.localize_holdout `
  --frozen-model "$Pilot\05-colmap\owned-photo-model" `
  --images "$Pilot\04-photos\heldout" `
  --camera-groups "$Pilot\00-manifests\camera-groups.json" `
  --mode absolute-pose-only --no-triangulation --no-ba --no-intrinsic-refine `
  --output "$Pilot\05-colmap\heldout-localization"

pnpm exec tsx tools/reception-hd/package.ts `
  --run "$Pilot\07-runs\$RunId" --out "$Pilot\08-packages\$CandidateId"
pnpm exec tsx tools/reception-hd/evaluate.ts `
  --candidate "$Pilot\08-packages\$CandidateId" `
  --heldout "$Pilot\05-colmap\heldout-localization" `
  --views docs/reports/reception-room-fixed-view-manifest.json `
  --out "$Pilot\09-evidence\$CandidateId"
```

Until those interfaces exist and pass fixtures, do not substitute `infra/runpod/run_training.sh`; it now fails closed with exit 78 before its dormant obsolete launch block.

### 8.3 Hardware, storage, cost and operator actions

- Registration/inventory: local CPU/RAM and fast scratch storage; keep 250–400 GB free for 460 RAW+JPEG pairs / 920 source files, developed derivatives, COLMAP, checkpoints and multiple masters.
- Local machine: non-training import/config, verifier and real-component visual proofs only. Local Windows splat training is not the accepted execution route.
- First optimization smoke and any full candidate: use only the accepted D-016 RunPod activation path after the worker bundle, signed input manifest, rights gate, clean import proof and explicit Blake approval pass.
- Cloud guardrail proposal: maximum $30/run and $100 total pilot compute; no automatic retry. The 2026-07-12 displayed rates are dated planning references only and must be rechecked before approval.
- Human effort: one half-day safe asset/runtime correction; one half-day LCC screenshots/reprocess setup; one day 30-photo capture/registration; two to four engineering days for trainer repair and fixtures; one day candidate/evaluation; the full 460-release / 920-file protocol is roughly one to two site days plus one to two processing days, before retakes.

### 8.4 Acceptance thresholds

Registration gate for 30-photo pilot:

- at least 24/30 images obtain a defensible room-frame pose, including at least 8/9 mapping images in each A/B subset; all six repeat pairs must localize on both sides or the station-repeat gate fails;
- at least 100 final 2D–3D PnP inliers per accepted image; define inlier ratio as final RANSAC inliers divided by all 2D–3D correspondences supplied to that final PnP solve, and require ≥0.25;
- global inlier reprojection median ≤1.0 px, p95 ≤2.0 px, and no accepted image with median >1.5 px;
- at least eight well-distributed, non-coplanar fit controls and six separate blind controls spanning floor, walls, high detail and room depth; blind-control median ≤20 mm, p95 ≤50 mm and max ≤75 mm;
- use the six named `RR-PILOT-S01..S06` repeat pairs exactly as allocated above. They are excluded from mapping/triangulation/BA, localized pose-only after subset-model freeze, and require A-versus-B room-frame agreement ≤20 mm translation and ≤0.2° rotation at every station;
- no camera model is accepted from a visually plausible fit alone.

Candidate quality gate:

- freeze the mapping/model/candidate before held-out pose-only localization. Held-outs may use PnP/RANSAC against the frozen training-only sparse model, but never triangulation, mapping, BA, intrinsic refinement, training or appearance fitting; save localization residuals and reject ambiguous poses;
- report feature-masked PSNR, SSIM and LPIPS together, by all five hero and at least five non-hero zones. Relative to the Quality SH3 candidate, no non-hero zone may lose >0.5 dB PSNR, >0.01 SSIM, or increase LPIPS by >0.02 without an explicit reject/waiver decision;
- if E57 is used, require the control distribution above, fit RMSE ≤20 mm and fit p95 ≤40 mm, plus blind-control median ≤20 mm, p95 ≤50 mm and max ≤75 mm; report rigid/similarity choice, scale, uncertainty and local floor/wall residuals;
- use at least three reviewers, randomised/blinded A/B order and 100%-pixel plus three novel-view paths. A candidate passes preference only when at least two of three reviewers prefer it in at least four of five hero features, with no unanimous critical doubled-edge/floater/seam rejection;
- runtime desktop target ≥45 FPS at 1440p on the local RTX 4090 in pure-splat mode, GPU memory ≤8 GB for the room, first meaningful render ≤3 s on the agreed test network/cache, and asset-size budget recorded rather than silently enforced;
- the 4090 result is a development gate, not product compatibility. Public release remains blocked by `RR-RUNTIME-DEVICE-MATRIX`, which must name supported desktop/laptop/mobile hardware, browsers, DPR, network/cache state and per-device ≥45/≥30 FPS targets before execution;
- direct single-generation encoding from the approved master; counts and SH degree match the package manifest;
- metric and generated authority checks pass independently.

Stop immediately when:

- the source/derived training right is absent or disputed;
- the 30-photo gate fails after one documented calibration/matching correction;
- coordinate scale/handedness cannot be resolved from controls;
- loss/NaN/VRAM behaviour fails the bounded smoke;
- a candidate improves screenshots but degrades held-out/novel views or introduces hero seams;
- projected spend exceeds the approved cap;
- the valid-frontier Stage-0 evidence winner already passes the product bar, in which case only targeted evidence-gaining work continues.

## 9. HIGH-RES PHOTO CAPTURE PLAN

Preferred professional lane:

- complete `CAPTURE-RIGHTS-PACK` before the pilot: photographer assignment, venue/client permission for commercial ML training and derivatives, subject-property/embedded-artwork and signage review, privacy/model releases, retention and publication rules;
- do not upload or allow network egress of venue photos to a vendor/cloud feature until `LEGAL-RIGHTS-MEMO` records processing location/subprocessors, input-photo licence, confidentiality, retention/deletion, telemetry, secondary use/model training, security/incident terms and export/deletion evidence;
- 36–60 MP full-frame camera, 14-bit RAW plus in-camera JPEG;
- rectilinear 24 mm for coverage and 50 mm for hero/mid/detail; tripod; fixed focus buckets `C24`, `C50M`, `C50C`;
- manual f/8, ISO 100, shutter selected in 50 Hz-compatible multiples after flicker test; locked custom white balance; no auto HDR, digital zoom, crop, perspective correction or changing lens profile;
- static room/lighting, no people, chairs/doors/curtains unchanged; capture a colour chart/grey card at start/end and after any lighting change;
- sequence overlap ≥75%, cross-loop ≥60%, hero coverage ≥80%; include high/low/oblique rays, not only frontal texture shots;
- deterministic RAW development to 16-bit TIFF masters and geometry-identical 8-bit sRGB PNG training derivatives; retain recipe/version/hashes.

Full planned release count:

- 192 base 24 mm: 64 positions around the room at 0.75 m, 1.35 m and 2.05 m heights;
- 32 ceiling/corner coverage;
- 96 room-detail frames: timber doors/glazing 24, curtains/windows 18, column/cornice/skirting 18, floorboards/reflections 18, fixed wall lights/vents/extinguisher or similar details 12, and doorway/room-junction context 6;
- 12 colour/control frames;
- at least 14 independently measured, well-distributed non-coplanar control targets visible across the capture: eight fit controls and six blind controls; these targets do not change the shutter-release count;
- 36 strict held-outs, captured from independently selected viewpoints and excluded from mapping, triangulation, BA, training and appearance fitting; after freeze, pose-only PnP localization against the training-only model is allowed and must not update it;
- 90 ChArUco calibration frames and two slate frames.

Total: 460 shutter releases / 920 RAW+JPEG source files. Run the 30-photo registration pilot before authorising the full set.

Naming:

```text
TH-RR_<YYYYMMDD>_<BASE|HERO|HOLD|CAL>_<C24|C50M|C50C>_H<cm>_<seq4>.<ext>
```

Phone fallback: only a device with RAW/manual exposure/fixed lens selection, disabled computational relighting/HDR where possible, locked focus/WB/exposure, and a calibration/held-out gate. It is not the preferred benchmark because undocumented computational processing and lens switching complicate geometry and colour.

## 10. COST AND TIME

| Lane | Public reference amount / cash guardrail | Staff/elapsed time | Decision |
|---|---:|---|---|
| Correct Quality SH3 runtime candidate | £0 external | 0.5–1 engineering day + review | Do first |
| LCC v2.1 same-source reprocess | £0 if current entitlement covers it | 0.5 day setup + vendor processing time | Do once |
| XGRIDS Premium public licence | official feed variant `43558032998493` displayed USD $2,500/year and `available:true` at 2026-07-12T13:35:25+01:00; human page availability conflicted | vendor confirmation + benchmark day | Reference amount only; quote/rights/UK checkout first |
| PortalCam Basic→Premium current-period upgrade | official feed variant `44177759502429` displayed USD $1,000 and `available:true` at the same timestamp; entitlement/remaining period ambiguous | vendor confirmation | Reference amount only; do not purchase yet |
| LCC Cloud | official feed variant `44461078904925` displayed USD $800/year and `available:true`; public material does not establish HD scope | unknown | Reference amount only; do not substitute for HD quote |
| Local non-training proofs | electricity only | import/config, verifier and visual preflight | Do before requesting training compute |
| RunPod optimization smoke/full candidate | price must be rechecked; explicit per-run/total cap plus storage/tax | on demand | Accepted D-016 path only, with Blake approval |
| 30-photo capture/registration | existing camera: near-zero cash; otherwise rental/staff | ~1 site day + 1 processing day | Gate full capture |
| Full professional capture | equipment/travel/staff dependent; obtain quote | 1–2 site days + 1–2 processing days | After pilot |
| RealityScan optional mesh bake-off | USD $1,250/seat/year unless an EULA exception applies; the revenue exception uses previous-12-month corporate-group gross revenue and includes advances/funds raised, with separate educational/non-commercial rules | 0.5–1 day | Optional; verify exact eligibility and EULA |

Expected cash range before photography labour: **£0/USD 0 for Stage 0**, roughly **USD $0–100 compute** for an approved owned pilot, or **USD $1,000–2,500 vendor reference amount** if an applicable offer can actually be purchased. Store pages/feed, UK checkout, taxes, entitlement, devices and output rights must be reconciled in a written quote. There is no public per-room HD price established by this review.

## 11. LICENCE MATRIX

| Component | Category | Commercial screen | Decision |
|---|---|---|---|
| [gsplat v1.5.3](https://github.com/nerfstudio-project/gsplat/tree/v1.5.3) | Apache-2.0 code candidate | repo Docker target is v1.5.3, but exact repaired build/dependency/patent closure is not approved | Preferred trainer base after gate |
| [UBC 3DGS-MCMC reference](https://github.com/ubc-vision/3dgs-mcmc) | custom/non-commercial graphdeco-derived route | do not vendor it; use the separately implemented gsplat MCMC strategy and prove provenance | Restricted route rejected |
| [COLMAP](https://github.com/colmap/colmap) | BSD-3-Clause core candidate | preserve notices; verify exact version and bundled dependencies | Preferred baseline registration |
| [GLOMAP](https://github.com/colmap/glomap) | BSD-3-Clause but archived 2026-03-09 | migrated into COLMAP | Use COLMAP global mapper, not standalone GLOMAP |
| [hloc](https://github.com/cvg/Hierarchical-Localization) | Apache-2.0 core candidate | individual extractors, matchers, submodules and checkpoints differ | Use only a locked clean artifact chain |
| Common SuperPoint/SuperGlue research artifacts | non-commercial/research risk | exact code/weight terms must be reviewed | Avoid for commercial lane |
| [ALIKED](https://github.com/Shiaoming/ALIKED) + [LightGlue](https://github.com/cvg/LightGlue) | BSD-3/Apache-2.0 code candidates | verify exact releases, official weights and dependency closure | Candidate after SIFT baseline |
| [Open3D](https://github.com/isl-org/Open3D) | MIT core candidate | optional models/dependencies vary | Registration/QA candidate |
| [PDAL](https://github.com/PDAL/PDAL) | BSD-style core candidate | plugins/codecs/build dependencies vary | Bulk geometry candidate |
| [Spark](https://github.com/sparkjsdev/spark) 2.0.0 / [Three.js](https://github.com/mrdoob/three.js/tree/r180) r180 / [SuperSplat](https://github.com/playcanvas/supersplat) / [splat-transform](https://github.com/playcanvas/splat-transform) | MIT code candidates | exact runtime pins/builds and codec/XGRIDS asset terms remain separate | Runtime/diagnostic use |
| [LCC](https://github.com/xgrids/LCCWhitepaper/tree/b38c2eb31be24e4220f23c69c4a0f3306356920e) / [LCC2](https://github.com/xgrids/LCC2Whitepaper/tree/039367dbe53ccbfa07b44a8e6280ceb4ebf8aa0b) | custom limited, non-OSI format licences | attribution, modification notice, recipient Whitepaper/link, redistribution notice, competing-AI restriction flowdown, derivative/open-terms clause and termination provisions; output rights also require written confirmation | Counsel-approved vendor adapter only |
| XGRIDS Web SDK | unknown/no licence located in inspected distribution | written licence required before vendoring | Do not vendor yet |
| [Matterport E57/PSA](https://matterport.com/legal/platform-subscription-agreement) and [Terms](https://matterport.com/terms-of-use) | external vendor Digital Asset, owned by Matterport and licensed to customer | commercial AI/ML training is no-go absent express permission; separately clear cropping, conversion, derived mesh/GLB distribution/embedding and no-resale boundary | Internal inspection only until written decisions |
| RealityScan | vendor EULA/service | current free threshold <USD $1m group revenue; otherwise USD $1,250/seat/year; input rights still required | Optional mesh bake-off |
| ArtiFixer code | Apache-2.0 | code licence does not license weights | Research code only |
| ArtiFixer released checkpoint | NVIDIA One-Way Noncommercial | research/development only; derivatives constrained | Rejected for production |
| RunPod | external compute service | DPA/security/residency/input rights and billing guardrails required | Approved-job-only |
| New venue photography | potentially clearable captured source | require photographer assignment, venue/client training/derivative rights, subject-property/embedded-artwork permission, signage/privacy review and model releases | Preferred real-detail source after `CAPTURE-RIGHTS-PACK` |

Patent status is not cleared by an open-source licence. Before public/commercial shipment, counsel should review Gaussian-splat/codec patent exposure, XGRIDS output/format terms, source-data rights and all model weights.

The reviewed LCC/LCC2 Whitepaper licences purport to require visible XGRIDS format attribution, notices for modifications/derivatives and redistribution, a Whitepaper/link for recipients, written flowdown of the competing-AI restriction, and public/no-less-open terms for modifications or derivative content; breach purports to terminate the grant. The release manifest and product UI must implement the counsel-approved interpretation of every applicable obligation. This format licence does not itself prove Venviewer has commercial distribution/refinement rights in the particular Reception outputs. **No XGRIDS-derived base may be released to a customer or public CDN until both questions pass in writing.**

The Matterport PSA reviewed here treats E57 as a Matterport Digital Asset owned by Matterport and grants a broad customer licence subject to Terms and a no-resale restriction. That is not a blanket derivative/training clearance. **No E57 points, images, poses or E57-derived training inputs enter a commercial model without express written permission; no cropped/converted/derived GLB is distributed or embedded until its use/distribution/no-resale treatment is approved.**

The legal pages above are mutable. `LEGAL-SOURCE-SNAPSHOT-SET` remains a release blocker until the controlling page/order versions are retained internally with effective/version date, retrieval timestamp, final URL and content hash or an approved archive identifier.

## 12. ADVERSARIAL FINDINGS

1. PLY↔codec PSNR near 42 dB can mean both are equally soft; it does not establish captured detail.
2. The full-frame PSNR/SSIM/MAE values include an identical background and can overstate asset-region agreement. Candidate gates must add feature-masked metrics.
3. Six fixed Spark views omit exact LCC source views for the room's visible fixed-detail targets. The original generic fireplace/chandelier/painting/table list was contradicted by the asset-backed empty-room imagery and has been replaced by timber doors/glazing, curtains/windows, column/moulding, floorboards and room-depth/fixed-detail views.
4. Quality-versus-Mobile is confounded by separate reconstructions, file modes, settings and counts. SH3→SH0 is real metadata loss, but not a quantified causal share of visible loss.
5. All-level ghosting can score higher on naïve Laplacian “sharpness” because duplicate edges raise high-frequency energy.
6. The LCC2 fine frontier is inferred from the parsed tree/point ranges and official replacement-LoD semantics; the candidate still needs runtime memory, seam and traversal tests.
7. Static transforms and camera framings are not yet a reviewed E57-to-room TransformArtifact. A visually fitting transform is not a metric alignment.
8. E57 scans 122–144 are a supported room identity, not operator-confirmed. Repeated rooms/corridors could produce a plausible wrong crop.
9. E57 cubefaces may be technically useful but are not cleared for model training by this report.
10. PortalCam poses may be body poses, use unknown units/conventions, and lack camera extrinsics. Normalized quaternions do not solve semantics.
11. The trainer audit invalidates any claim that “Config B supports” a feature merely because YAML/docs name it.
12. A bilateral appearance grid can leak per-view corrections into evaluation. Held-outs must never receive fitted appearance parameters.
13. 3DGUT does not automatically make 200° fisheye valid. Behind-plane rays and multi-camera batching need explicit fixtures.
14. Warm-start can entangle proprietary and independent lineage and can preserve bad geometry. It must beat a captured hero residual lane.
15. Micro-splats can win a frontal hero image while drifting/seaming at distance. Near/mid/far and traversal views are mandatory.
16. Mesh overlays can sharpen silhouettes while looking synthetic, z-fighting, or occluding splats. Test each overlay independently.
17. A current LCC v2.1 reprocess may improve alignment, but release notes are not Reception evidence.
18. Storefront prices do not prove entitlement, availability, taxes, output rights or per-room HD scope.
19. Generated enhancements can be visually persuasive and physically false. The runtime/provenance boundary must be inspectable and reversible.
20. A larger file or Gaussian count is not automatically higher quality. The invalid all-seven case is the concrete counterexample.
21. One-room success does not prove rollout repeatability; the next two rooms should intentionally test different lighting/detail/capture failure modes.
22. The new computer-vision warnings occur in both comparison directions. “Missing” or “extra” edges therefore describe difference from the chosen baseline, not proof that either candidate is defective or better.
23. Twelve byte-identical static repeats establish a zero observed pixel-drift floor at those loaded cameras and 500 ms intervals. They do not test view-dependent appearance, camera motion, traversal popping or longer-term stability.
24. The six new feature views still share one optical centre. Exact matrices remove camera mismatch within each pair but do not replace spatially distinct near/mid/far/orbit evidence.
25. The explicit blur 0.3/preblur 0 setting is controlled rather than optimised. A reproducible setting is not automatically the best-looking or fastest supported-device setting.
26. The capture proves the four named sources reached the scene and their decoded totals matched the declared profiles. Because the capture receipt did not re-hash the served asset bodies, it is not fresh byte-identity proof for the underlying SOG/SPZ files.

## 13. UNRESOLVED GAPS

| Gap / named artifact | Cheapest decisive test | Owner | Time / cash |
|---|---|---|---|
| `RR-LCC-HERO-CAPTURE-SET` | safely close active editor; capture five exact LCC hero views plus settings/cameras where exposed | Blake | 30–60 min / £0 |
| `RR-INDEPENDENT-VIEWER-CAPTURE-SET` | pin a non-Venviewer viewer; capture Quality PLY plus Quality/Mobile valid packages at the five named hero views with sidecars | Blake + Codex | 0.5 day / £0 |
| Local real-component moving/performance evidence | extend the completed six-view fixed run with spatially distinct near/mid/far/orbit cameras and a moving trace; record load time, FPS/long frames, GPU memory, holes, seams and device/DPR profile | Codex/QA | 0.5 day / £0 |
| `RR-ACTUAL-ROUTE-CAPTURE-SET` | after separate deployment/registration/auth authorization, capture valid Mobile and Quality candidates in the protected private route with matrices/performance; keep invalid all-level/coarse controls in the historical diagnostic fixture only | Codex/QA | 0.5–1 day / £0 |
| `RR-E57-CROP-CONFIRMATION` | review scans 122–144, using scan 121 only as doorway context if useful; create a room-only 3D crop or Reception floor-boundary polygon, preserve scan/top/side evidence, and obtain a second-person check | Blake + second reviewer | 30–60 min / £0 |
| `RR-E57-METRIC-CONTROL` | measure ≥8 non-coplanar fit controls + ≥6 blind controls; choose rigid/similarity; report scale/uncertainty/residual gates | survey/capture lead + engineer | site/survey time and fees unknown |
| `RR-PHOTO-METRIC-CONTROL` | independently survey ≥8 fit + ≥6 blind room controls usable by the owned-photo lane without E57 | survey/capture lead | site/survey time and fees unknown |
| `RR-XGRIDS-OPEN-EXPORT` | request 30-second sample: images, dimensions, timestamps, intrinsics/distortion, camera/body extrinsics, poses, LiDAR/depth and frame conventions | Blake/XGRIDS | one email; vendor lead time |
| `LEGAL-RIGHTS-MEMO` | written XGRIDS existing-base/output/refinement/distribution terms and LCC/LCC2 obligations; Matterport E57 use/conversion/derivative/distribution/training decision; vendor-photo processing location/egress, input licence, confidentiality, retention/deletion, telemetry and secondary-use terms | Blake/counsel/vendors | 1–3 h initial internal triage; external elapsed time/fees unknown |
| `LEGAL-SOURCE-SNAPSHOT-SET` | retain counsel-approved immutable snapshots/archive IDs, dates and hashes for controlling mutable vendor terms/orders | Blake/counsel | 1–2 h / £0 unless archive service used |
| `CAPTURE-RIGHTS-PACK` | photographer assignment, venue/client training and derivative permission, subject-property/embedded-artwork clearance, privacy/model releases | Blake/counsel/venue | scope and fees unknown |
| `RR-PILOT-CLI-BUNDLE` | implement every Section 8 proposed interface with `--help`, fixtures, schemas and dependency lock | Codex/engineer | included in engineering estimate; not yet runnable |
| `RR-TRAINER-RUNNABLE-BUNDLE` | implement/import/config smoke on synthetic mixed-camera/depth fixture; deterministic bundle and eval | Codex/engineer | 2–4 days / £0 external |
| True source hero ceiling | LCC + PLY + codec + corrected runtime + held-out photo at identical cameras | Blake + Codex | 0.5–1 day |
| v2.1 alignment gain | one cloned same-source Quality reprocess and frozen comparison | Blake | operator + processing time |
| HD vendor value | same 30 registered photos through vendor and independent lane | Blake/vendor/engineer | quote + 1–2 days |
| Registration feasibility | 30-photo gate against `RR-PHOTO-METRIC-CONTROL`; E57 is an optional separately gated scaffold | photographer/engineer | ~1 site + 1 processing day |
| Runtime acceptance | trace the private Quality SH3 fine candidate at agreed desktop/mobile/network profiles | Codex/QA | 0.5–1 day |
| `RR-RUNTIME-DEVICE-MATRIX` | name supported devices/browsers/DPR/network states and execute FPS/memory/load gates | Blake + QA | device availability-dependent |
| Hero residual value | timber-door/glazing and column-moulding micro-splat prototype, near/mid/far A/B | photographer/engineer | 1–2 days after base |
| `RR-ROLLOUT-REPLICATION-GATE` | repeat the winning invariant in Grand Hall plus one contrasting smaller/darker room; package resolver/frontier rule, renderer profile, evidence schema, metric rubric, rights checklist and device gates must transfer unchanged; only asset IDs, reviewed transforms, cameras and documented room thresholds may vary | Codex/QA + Blake | 1–2 engineering/QA days per room plus operator capture; £0 external before new capture/survey costs |

## 14. RECOMMENDED NEXT ACTION

### One exact action for Blake

Do not run either candidate command with `--apply`, and do not apply a database
migration yet. The local Mobile dry run is green, but the configured database
still has nine ordered migrations pending (`0050`–`0058`), including the
required immutable-package migration 0052. The read-only migration preflight
returned `safeToApplyProduction: false`. The next authorization decision is a
separate engineering review of that complete migration/deployment plan; do not
cherry-pick 0052.

The earlier active-editor blocker is no longer current: a later read-only
computer-vision check opened the source viewer safely and is recorded in the
dated addendum. The five exact LCC hero captures in Section 4 are still needed
before the final source-versus-export-versus-runtime quality conclusion, but
they no longer block local Stage-0 delivery code.

The explicit Reception profile and fixed database-free real-component capture
are also complete. Do not spend time repeating the same static proof unless a
capture-bound file changes. The next local engineering evidence should move
the camera through spatially distinct near/mid/far/orbit views and record load
time, FPS/long frames and GPU memory. That local test remains separate from the
later authenticated product-route acceptance test.

Then locate/retain, without copying into git:

- the two LCC project roots named in the evidence JSON;
- the Reception raw project root;
- `F:\E57\cloud_0.e57`;
- any original reference photos or true full-quality mesh/attached-mesh export not in those roots.

Additional photography **is required** for owned real detail unless the valid-frontier Stage-0 evidence winner plus the one v2.1 reprocess passes every hero view. Shoot only the 30-photo registration pilot first; do not shoot all 460 releases before that gate.

No cloud setup is needed now. Complete local non-training proofs first. Create a RunPod Secure Cloud volume only after the worker bundle, signed job, data-rights checklist, explicit D-016 activation and Blake-approved per-run/total cap all pass.

### Exact next implementation prompt

> Preserve the hash-bound 2026-07-16 fixed local run, then extend the same two
> hard-coded candidates and `reception-fixed-fine-review-v1` profile to
> spatially distinct near/mid/far/orbit cameras and one moving trace. Record
> effective DPR, load time, FPS, long frames, GPU memory, holes, seams and
> ghosting; do not use pairwise CV to select a physical winner without an
> aligned held-out reference. Separately audit the complete pending 0050–0058
> migration/deployment tail without applying it. Resolve the existing
> `safeToApplyProduction: false` result and require explicit operator approval
> before deployment or database change. Only after the matching API and
> immutable-revision schema are safely deployed may the two candidates be
> created as separate `internal_ready` revisions and captured through the
> authenticated route. Keep all-level, coarse-root and environment controls in
> the existing fixture until each actual-route profile is separately audited.
> Do not upload, publish, train, spend, change the public pointer or use the
> retired mutable SPZ command.

What should **not** be done yet: decode `.xbin`, decrypt `lixel.zip`, run the current trainer, use Matterport points/images/poses/derivatives for commercial training without express permission, upload private venue photos to any vendor/cloud path before processing/egress terms pass, purchase Premium without a written scope/rights response, ship any XGRIDS-derived base without confirmed distribution rights and LCC/LCC2 compliance, ship all seven chunks, ship only the root chunk, use ArtiFixer weights commercially, treat generated/visual geometry as measurement truth, or share this unredacted internal evidence bundle externally.

## 15. HANDOFF SUMMARY

### INVESTIGATION MILESTONE COMPLETED; PRODUCT GOAL REMAINS OPEN

- audited repo/config/trainer/runtime/test contracts and current machine capabilities;
- inventoried the Reception raw project, two LCC reconstructions, PLY/SOG/SPZ hierarchies and E57 source;
- produced 42 same-framing pure-Spark-fixture captures, including same-Mobile-source SOG/SPZ, and replayable per-view pixel/LoD comparisons with explicit capture-snapshot limits;
- implemented one explicit Reception review profile and produced a separate 24-PNG, 12-sidecar, six-view local real-component Quality-versus-Mobile capture with byte-identical static repeats and hash-bound CV evidence;
- proved the historical diagnostic-fixture invalid-hierarchy and conditional coarse-root deltas, documented DPR risk, bounded PLY-to-export-package deltas, and measured a confounded source difference at tested views;
- defined a non-circumvention raw-project no-go, twelve-route decision matrix, primary/fallback stack, pilot, capture protocol, gates, costs, licence screen and strategy corrections.

### VERIFIED

- Quality SH3 master/fine hierarchy exists and is materially different from the current Mobile SH0 source;
- the legacy/pre-addendum internal route mounted all seven replacement levels; the old one-URL public schema would have resolved only the coarse root if that package were published, so both old contract shapes were unsuitable for a reviewed fine frontier. The new exact private page instead admits only the two audited four-leaf profiles;
- Quality-PLY→SOG, Mobile-PLY→SOG and Mobile-PLY→SPZ pixel deltas are small at six same-centre framings relative to the LoD faults; original encoder provenance and SH view dependence remain unproved;
- the local Living Hall component loaded four named Quality sources to the declared 2,002,009 total and four named Mobile sources to 1,978,258 under one explicit profile; fixed captures were deterministic, and bidirectional CV found reviewable differences without selecting a physical winner;
- raw open images/intrinsics/depth/calibration are unavailable; trajectory/event metadata exists; calibration archive is encrypted;
- Config B is not runnable and has never produced a recorded run;
- local LCC v2.0 reports HD not activated; local RTX 4090 has 24 GB.

### UNVERIFIED — PLEASE CHECK

- exact hero detail in LCC Studio versus full PLY/runtime;
- E57 scan 122–144 room identity, independent metric accuracy and derivative rights;
- XGRIDS existing-base/output/refinement/distribution rights, LCC/LCC2 compliance, HD entitlement and Matterport commercial training/use decisions;
- exact causes of Quality-versus-Mobile reconstruction difference;
- physical Quality-versus-Mobile ranking, spatially distinct/moving stability, blur/preblur optimum, load/FPS/GPU cost and supported-device behavior;
- v2.1 alignment and vendor HD gains;
- true held-out quality/performance of any trained or residual candidate.

### BLOCKED

- `RR-LCC-HERO-CAPTURE-SET` by safe operator action;
- `RR-INDEPENDENT-VIEWER-CAPTURE-SET` by pinned independent-viewer capture;
- local moving/performance evidence by spatially distinct cameras, traversal and performance telemetry;
- `RR-ACTUAL-ROUTE-CAPTURE-SET` by approved migration/deployment, two
  `internal_ready` registrations, signed-in exact-route capture and performance
  evidence;
- `RR-E57-CROP-CONFIRMATION` by operator scan review;
- `RR-E57-METRIC-CONTROL` by independent control capture and residual review;
- `RR-PHOTO-METRIC-CONTROL` by an independently surveyed photo-control network;
- `RR-XGRIDS-OPEN-EXPORT` by vendor export/SDK;
- `LEGAL-RIGHTS-MEMO` by written rights decisions;
- `LEGAL-SOURCE-SNAPSHOT-SET` by immutable controlling-term records;
- `CAPTURE-RIGHTS-PACK` by venue/photographer/content/privacy permissions;
- `RR-PILOT-CLI-BUNDLE` by implementation and fixtures;
- `RR-TRAINER-RUNNABLE-BUNDLE` by implementation and fixtures;
- `RR-RUNTIME-DEVICE-MATRIX` by supported-device selection and execution;
- `RR-ROLLOUT-REPLICATION-GATE` by Grand Hall plus one contrasting smaller-room replication;
- independent pilot by 30-photo capture and registration gate.

### REMAINING WORK

1. Capture the LCC, independent-viewer and actual-route hero/source sets; confirm the E57 crop only for the optional E57 lane.
2. The exact Quality and Mobile private profiles, the explicit fixed-review
   profile and the database-free fixed capture now exist locally. Add
   spatially distinct/moving/performance/device evidence, then—only after
   authorization—safely deploy the immutable-revision schema/API, register the
   candidates and repeat the benchmark through the protected route.
3. Ask XGRIDS for export/rights/entitlement and run one v2.1 reprocess.
4. Repair the trainer and pass a synthetic smoke before any real data or cloud run.
5. Shoot/register 30 photos; then authorize the same-photo vendor/independent/hero bake-off.
6. Replicate the selected invariant in Grand Hall and one contrasting smaller/darker room before rollout claims.

### NEXT PROMPT

Use the current migration/deployment and exact-A/B prompt in Section 14. The
older broad Stage-0 fixed-view implementation request has been completed
locally. Moving/performance/device measurement, live deployment, registration,
authenticated capture and physical-reference ranking remain.

## 16. 2026-07-14 NATIVE E57 COMPUTER-VISION ADDENDUM

The E57 photo-orientation uncertainty has materially narrowed since the main
investigation above was written, but it is not closed. Two different
computer-vision checks now disagree on whether the evidence is sufficient for
approval.

The first, hash-bound audit read coloured LiDAR points and all 138 embedded
4096×4096 JPEGs from scans 122–144. It learned one six-face mapping from 14
stations, froze it, and applied it unchanged to 9 colour-held-back stations.
All 138 images passed; no colour-held-back image preferred a different
direction. The lowest colour-correlation score was 0.959714 against a 0.85
gate, and the smallest lead over the best adequately covered alternative was
0.104339 against a 0.10 gate. Every station produced six distinct proper
rotations.

The saved E57 rotations are therefore not simply rejected. For this file, the
unchanged raw JPEGs match the stored Image2D rotations after the camera-axis
conversion `diag(1,-1,-1)` and `cy_raw = imageHeight - cy_e57`. The
converted-pose angular difference from the snapped colour-CV direction is at
most 0.000007344°. This is stored-pose/internal-colour agreement, not real-world
pose accuracy.

The second audit deliberately ignored LiDAR point colour. It read XYZ plus
organized row/column numbers, projected 3D shape edges into each JPEG, tested
48 rotations/mirrorings, and gave every candidate the same ±4-pixel local
shifts. Seven development stations were used to build and freeze the method;
the other 16 stations were then opened once for a 96-image geometry-held-back
run. “Held back” applies only to this new metric: earlier colour/visual work had
already seen those stations.

The first geometry development design failed and remains preserved. Review
found that its 240 translations tested exact pixel placement rather than cube
direction and that long room edges could slide along one another. Version 2
openly records a post-development change: exact-pixel uniqueness became a
separate diagnostic, while blocking coverage became a distributed
cells/rows/columns/quadrants rule. The revised method passed 42/42 development
photos, was tested and independently reviewed, and was frozen before held-out
access.

The one-shot v2 geometry-held-out result was
`REJECT_GEOMETRY_MISMATCH`:

- 82/96 photos passed every frozen rule;
- 6/96 ranked another direction above the fixed mapping;
- 4/96 ranked the fixed direction first but missed a frozen lead margin;
- 4/96 ranked the fixed direction first but did not carry edge evidence into
  all four image quarters;
- 90/96 ranked the fixed direction first both before and after every candidate
  received its own local shift;
- only 5/16 stations passed on all six faces;
- the exact-location diagnostic reported 70 `UNIQUE`, 13 `NONUNIQUE` and 13
  `UNASSESSABLE`, and correctly did not change the direction decision.

Post-hoc failure-versus-pass comparison classifies the 14 non-passes into four
missing-quadrant or low-structure coverage cases, seven downward-face cases
weakened by repeating flooring plus a large soft central region, and three
curtain-dominated repeated-edge or cross-modality cases. No case demonstrates a
global mapping error or a coherent camera-calibration offset. The frozen gate
remains failed.

An independent read-only audit recomputed both report digests, all 96 face
decisions, station/overall aggregation, ranks, margins, candidate uniqueness,
coverage summaries, source receipts and frozen implementation hashes. It found
no inconsistency. Its decision is to retain the report as a valid negative
result and not approve mapping materialization or training.

The combined finding is therefore precise: colour gives excellent internal
support for the six-name mapping, and XYZ-only shape evidence supports 82 of 96
held-back images, but the frozen all-image geometry gate failed. This does not
establish independent physical calibration, continuous intrinsics, metric
geometry or training-ready poses.

Current privacy boundary:

- quarantine scan 123 for a large blurred person;
- quarantine scan 140 for a partial person;
- reserve scan 122 as a doorway/corridor boundary challenge;
- require a nadir/tripod mask and full-resolution review for every admitted
  native station.

The technical recommendation is now more specific:

- retain native embedded E57 JPEGs, transformed stored rotations and the
  private pair sheets only as diagnostic evidence; they do not approve
  calibration or poses;
- preserve the failed held-out result and do not tune/reuse the 16 stations as
  if they were still untouched;
- record the completed 14-case diagnosis as post-hoc explanation only, without
  changing any frozen face decision;
- require fresh independently controlled geometry before any replacement
  validation;
- continue to reject pose claims based on the loose 1536×1536 cube-image labels
  and their incomplete legacy derivation reports.

The sealed evidence chain is:

- colour report `docs/reports/reception-room-e57-lidar-reprojection-2026-07-14-v2.json`,
  whole-file SHA-256
  `7e1a881c3fdf613a9fa8ddcb1f6c11db582318b0b61ec26452b564a8dee3b4ad`;
- preserved failed v1 geometry development report
  `docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json`,
  whole-file SHA-256
  `d8307d8547ba2bce44f87a3173497a83762f98c994e13af272d95c21a24f941a`;
- v2 geometry development report
  `docs/reports/reception-room-e57-geometry-edge-development-v2-2026-07-14.json`,
  whole-file SHA-256
  `96a9fd87a9a78a68b4ebe3f699f313e1f56d985ce40856532198b40a29435389`;
- frozen v2 protocol
  `docs/reports/reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json`,
  whole-file SHA-256
  `7212244f38a4678cd3e3b60a491c6b2154390d253d9eaa22e0255e16e8cd78d9`;
- one-shot v2 geometry-held-out report
  `docs/reports/reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json`,
  whole-file SHA-256
  `ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0`.

All four authorization flags remain false: continuous calibration, metric
geometry, known-pose materialization and training. Room identity, native-image
privacy review, masks, E57 processing/derivative/training rights and other-room
generalisation also remain open.

The combined plain-language decision, failure table and exact next gates are
recorded in
`docs/reports/reception-room-e57-native-image-readiness-2026-07-14.md`.

## 17. 2026-07-14 FAILURE/PASS VISUAL-DIAGNOSIS ADDENDUM

The 14 geometry non-passes have now been examined with computer vision and
side-by-side human review. A create-only exporter reconstructed only the
primary and challenger masks already selected by the frozen held-back report.
It did not rerun the 48-way audit, recalculate ranks, alter thresholds or change
face decisions.

The private bundle contains 14 failure-versus-pass case sheets and one contact
sheet. It used 13 scans, 22 selected photos and 44 selected masks; no point
colour or intensity was read. Its manifest payload SHA-256 is
`26b6e44992a79fd484410156fa4b2158ca37c06ba81b48c044769d9c259b44e1`.
Because it contains venue pixels and is not privacy-cleared, it remains local
under `artifacts/t500-reception-e57-geometry-edge-diagnostics-2026-07-14` and
must not be published.

The plain-language diagnosis is:

- four cases fail only because geometry edges do not reach one image quarter;
  the fixed direction ranks first in all four;
- seven downward cases combine repeating floorboards with a large low-detail
  centre, leaving several rotations weakly distinguishable;
- three curtain cases are dominated by repeated vertical folds and likely
  camera-versus-laser layer differences.

The soft central area is visible in both failed and passing downward controls,
so it is not a sufficient cause and these boards cannot identify its origin.
Likewise, some passing controls contain strong curtains. The supported
conclusion is weak or non-distinctive evidence, not proof of a different global
mapping.

No coherent multi-face, multi-station translation pattern supports a global
camera-calibration correction. The sealed 82/96 result remains a valid negative;
all 16 stations are consumed for this method and cannot be made untouched by
another rerun. Continuous calibration, metric geometry, known-pose
materialization and training remain unauthorized.

The detailed 14-row table, exploratory measurements, safety boundary and tool
hashes are in
`docs/reports/reception-room-e57-geometry-edge-visual-diagnosis-2026-07-14.md`.
The next HD-quality engineering priority is the private actual-route Stage-0
Quality-SH3-versus-Mobile-SPZ frontier A/B, while full-resolution privacy masks,
Reception crop confirmation, fresh independent geometry controls and written
E57 rights remain open.

## 18. 2026-07-14 PRIVATE EXACT-PACKAGE PREVIEW ADDENDUM

The local product now has a platform-admin-only route for opening one exact
immutable Reception runtime-package UUID:

```text
/admin/runtime-package-previews/<PACKAGE_UUID>/view
```

This is local delivery plumbing for the Stage-0 A/B, not a quality result or a
publication action. In production, `/living-hall` and every public runtime API
still use only published package data. Local development keeps its existing
checked-in direct preview.

The private API returns no R2 key, storage URL, signed URL or credential. Every
visual member is frozen into the package digest by an ordered receipt containing
its asset ID, filename, extension, size, SHA-256 and hashed storage identity.
The API recalculates the package digest, compares every live asset row with its
receipt, rechecks platform-admin authorization and exact manifest membership on
every byte request, and verifies the whole object SHA-256 before returning any
bytes to Spark. The browser also rejects a response for any package ID other
than the ID in the requested URL. Failed exact lookups never fall back to a
different private, public or development package.

Resource use is bounded for the known Reception candidates: 16 MiB maximum per
member, four retained verified transfers, one preallocated buffer per transfer,
and a 60-second upstream deadline. The shared response lifecycle also has an
absolute 180-second deadline that aborts upstream work and destroys a stalled
response. Transfer slots remain held until both handler work and the browser
response finish/close lifecycle settle. The byte route registers disconnect
handling before its database/package lookup, so a client that leaves during
lookup cannot later acquire or strand a verified-transfer slot. Browser and
upstream requests are aborted on route change, unmount, parse failure or
disconnection. This remains an administrator-only byte preview and does not
make either reviewed byte profile anonymously presentable.

Focused verification passed 53 shared-type tests, 127 API tests and 62 web
tests, plus all three type-checks and targeted lint. The final full shared-types
run passed 2,078 tests across 90 files and the final full web run passed 3,121
across 260 files. The final full API run passed 2,508 individual tests across
127 files; six tests failed across six other files. Those six are the
already-known Foundry migration-tail assertions whose fixed end-of-journal
positions do not yet account for the shared worktree's existing
`0058_foundry_derivative_activation_disabled`, not preview or preflight
failures. The API build passed. The web production build stopped at its
intentional missing-live-Clerk-key gate; no credential was invented or bypassed.
Independent reviews found three low-priority Mobile provenance/readiness/help
issues, all corrected. The final re-audit found no remaining P0–P3 issue; its
verification is recorded in the
plain-language preview report.

The private selector now accepts two separate exact profiles: the four Quality
SOG leaves and the four Mobile SPZ leaves. It checks ordered asset IDs,
filenames, extensions, sizes, byte hashes, hashed storage identities and the
complete hierarchy basis. The new Mobile create-only preflight also rereads the
actual LCC2 hierarchy, validates every declared SPZ, requires receipt
`sha256:c897dd55fd8efc5397a76d96572a654058defd232f10767b1827fe684e7b6357`
and checks all seven existing asset records in the configured database. Its
read-only dry run against that database and local LCC2/SPZ files passed the
payload checks with candidate digest
`9d35c8cf339e618e68349d637199f9200019dd4fcabee6ffb6be72172f88dc93`.
It made no write and downloaded no R2 bytes. The separate database-contract
result is `databaseReady: false` because migration 0052 is absent.

No candidate was registered, no file was uploaded, no signed-in package was
streamed from the configured database and protected object storage, no deployment was
made, and no public pointer was changed. The configured database has nine
pending migrations and its read-only tail preflight returned
`safeToApplyProduction: false`, so `--apply` remains prohibited. After a
separately approved safe deployment, register Quality and Mobile as distinct
`internal_ready` candidates, retain both receipts, and compare their exact
private URLs using the same devices, native DPR, Spark settings and saved
cameras. The current private exact-preview route accepts only the two fine byte
profiles; neither is currently an anonymous presentation candidate. Keep
historical all-level, coarse-root and environment-on/off controls in the fixture
until a separately audited exact profile and tests exist for each actual-route
control.
Do not change the public pointer unless visual, performance, transform,
provenance, rights and human-review gates all pass.

The full plain-language operator instructions and safety boundary are in
`docs/reports/reception-room-private-exact-package-preview-2026-07-14.md`.

## 19. 2026-07-14 E57 ↔ XGRIDS COMPUTER-VISION ALIGNMENT ADDENDUM

The exact staged 20.5 GB, 149-scan Reception E57 and the exact Quality SH3
XGRIDS geometry can be compared automatically. T-515 delivered the read-only,
fail-closed preflight and alignment checker. Its first unrestricted real-data
fit failed the provisional accuracy and overlap bar and let a mirror control
score slightly better, so no transform was approved.

T-516 then fitted an explicitly upright, fixed-scale candidate and produced a
private eight-view package: full context, cropped top, two sides, angled view,
both distance directions and a four-candidate control comparison. The pictures
show a clear shared upper-room outline. They also show missing or mismatched
lower-room coverage and material floor, height and ceiling disagreement.

In the post-hoc diagnostic crop, median distance is 117.8 mm from XGRIDS to the
laser and 96.6 mm in the reverse direction. RMSE is 319.6 mm and 334.5 mm; p95
is 668.0 mm and 826.0 mm; only 14.47% and 18.36% of samples are within 50 mm.
The proposed bar requires at most 20 mm RMSE, at most 35 mm p95 and at least
90% within 50 mm in both directions. A mirror remains better in the reverse
direction, so independent physical controls are still required.

The upright result is useful computer-vision diagnosis, not a survey or a
`TransformArtifactV0`. Its crop is unreviewed; gravity and metre scale are
assumptions; XGRIDS Gaussian centres are appearance primitives rather than
surveyed surfaces; room identity, rights, privacy, independent controls and
human acceptance remain open. T-505, T-502, runtime use and publication stay
blocked. The complete plain-language result, scan leakage guard, receipts and
next steps are recorded in
`docs/reports/reception-room-e57-xgrids-gravity-overlay-diagnostic-2026-07-14.md`.

## 20. 2026-07-15 STRUCTURAL 3D COMPUTER-VISION ADDENDUM

### Plain-language answer

Yes, computer vision can do the geometric search. The new method reads the
three-dimensional surfaces directly, finds separate walls, floors and ceilings,
and attempts an upright fixed-scale room match. It does not depend on a person
manually lining up two screenshots.

On the real data it found strong structure in both captures:

- XGRIDS: 17,559 classified structural surfaces and nine wall planes;
- fit-only E57: 40,981 classified structural surfaces and nine wall planes;
- both inputs contained two independent wall directions;
- the E57 main floor-height band contained 13,065 points, or 99.29% of its
  floor candidates;
- XGRIDS had two nearly equal floor-height bands around -1.5205 m and -1.4312 m.

The program then refused both inputs with
`HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND`. A large number of points at one height is
not sufficient proof of the Reception floor. The surface must also form one
continuous interior area and physically meet independent room walls. Neither
capture passed that test. Therefore no room height, transform, registration,
overlay, `TransformArtifactV0`, training permission or runtime authority was
created.

The real probe read only fit stations
`124,125,127,128,130,132,133,135,136,137,139,142,143,144`. It read no validation
station geometry, no frozen test station geometry (`126,129,141`) and no
excluded station geometry (`122,123,140`). It wrote no files and did not hash
the entire venue-wide E57, because doing so would read sealed bytes. The final
tool hash, verification totals, failure reason and deliberately absent output
package are recorded in
`docs/reports/reception-room-e57-xgrids-structural-cv-diagnostic-2026-07-15.md`.

The next useful input is not another blind alignment run. It is one of:

1. a human-reviewed room-only 3D crop;
2. a floor-boundary polygon for the Reception Room;
3. stronger floor-to-wall and ceiling-to-wall junction coverage; or
4. independently surveyed corresponding controls.

After a crop or polygon exists, rerun fit-only CV, keep validation held back,
and continue to leave the frozen test stations untouched. Independent controls
are still required before the result can become metric or runtime authority.

## 21. CURRENT ROOT AUDIT AND CONFIDENCE — 2026-07-16

### What is proved now

The cheapest likely visual win remains a two-stage comparison between the exact
Quality SH3 four-leaf profile and the exact Mobile SH0 four-leaf profile. The
first, database-free fixed-view stage through the real Living Hall component
was completed on 2026-07-16. The runtime-package resolver and exact
private-preview gate reject mixed replacement levels; diagnostic fixtures
intentionally remain able to reproduce arbitrary combinations. The new
`reception-fixed-fine-review-v1` profile explicitly controls the Canvas and
Spark settings for both candidates.

The new run is separate from the 42 historical fixture PNGs. It retained 24
true lossless PNGs and 12 sidecars at six matched same-centre cameras, with two
captures per candidate/view. All twelve static repeat pairs were byte-identical
after 500 ms. At seal time all 15 recorded environment entries matched. A fresh
current-worktree check now matches 13/15: the later `pnpm-lock.yaml` and
`packages/web/src/router.tsx` differ, while the immutable screenshots,
sidecars and repeat receipts still match. The selected environment list is not
a complete transitive dependency closure. Both comparison directions produced
five review verdicts and
one not-assessable ceiling-moulding verdict. The computer vision therefore
locates meaningful differences, but no candidate has proved a Venviewer
quality gain or physical superiority.

There is still no deployed/registered protected-route capture, reviewed room
transform, spatially distinct or moving-view test, load/FPS/GPU evidence,
supported-device matrix or aligned physical hero reference. The old 2026-07-12
environment drift remains an explicit historical limitation; it does not
invalidate either immutable screenshot set, and the new run was not appended
to the old metrics as if the environments were bit-identical.

T-514 also changes the trainer wording without changing the decision. The
dependency-light Config B checker and synthetic non-training preflight pass,
but their result is `contract_valid_runtime_blocked`. No optimization has run.
In the trainer's production path, the real gsplat/Tyro worker, distorted-camera
and E57-depth behavior, bilateral-grid serialization, optimizer-produced
held-out metrics, resume, candidate generation and runtime packaging remain
incomplete. The separate downstream D-014 candidate verifier is implemented
and tested; the blocked trainer does not yet produce its required inputs.

### Current A-I outcome

| Criterion | Current outcome |
|---|---|
| A. Dominant-loss diagnosis | **Partial.** Legacy LoD/coarse and DPR losses are measured, and a separate real-component fixed comparison now detects Quality-versus-Mobile differences. LCC, independent-viewer, spatially distinct/moving and protected-route comparisons remain missing. |
| B. Raw-project go/no-go | **Satisfied to the lawful inspection boundary.** No open PortalCam image/calibration/depth route is established. |
| C. Existing pipeline audit | **Satisfied as a dated audit plus T-514 reconciliation.** The checker works; the trainer does not. |
| D. Approach comparison | **Satisfied as a decision screen.** Empirical winners remain unknown. |
| E. Recommended stack | **Specified, not built end to end.** The larger Foundry has substantial authority-none ingest/planning foundations, but no production enhancement worker or complete drag-and-drop local/cloud application. |
| F. Reception pilot | **Specified, not executed.** The corrected 30-photo checklist is authoritative; photos, controls, rights and the runtime worker are missing. |
| G. Quality gate | **Partial.** Historical codec/LoD metrics plus hash-bound static real-component CV/PSNR/SSIM/MAE and repeat evidence exist. No candidate has held-out, moving-view, human, performance, GPU-memory or device acceptance evidence. |
| H. Commercial cleanliness | **Partial.** This is a dated screen, not legal clearance. Rights, immutable terms snapshots, exact dependency/weight closure and patent review remain open. |
| I. Exact next actions | **Satisfied for the current lawful boundary.** The completed fixed local proof, next moving/performance test, and later protected-route proof are separated below. |

### Confidence

| Claim | Confidence | Basis |
|---|---:|---|
| The historical all-level/coarse route damaged presentation | High | Exact hierarchy inspection, 42 hash-bound fixture captures and code/tests. |
| The explicit profile and declared fine-frontier candidates produce repeatable fixed frames in the local real component | High | Four observed named sources per candidate, matching decoded totals, matrices, 24 lossless PNGs, 12 byte-identical repeat pairs and hash-bound screenshot/code receipts; served asset bodies were not re-hashed by this capture. |
| The same correction will improve the protected product view | Medium | Strong fixture and local-component evidence, but the authenticated route, moving views, performance and supported devices have not been captured. |
| Quality SH3 will beat Mobile SH0 | Low | More recorded appearance capacity, but separate reconstructions and no physical/cross-context reference. |
| Structural CV can align these exact inputs without a reviewed room boundary | Low | Three independent alignment families reached useful structure but failed accuracy, handedness or room-envelope gates. |
| The owned-photo/hero lane is commercially and visually superior | Low to medium | Technically plausible and information-adding; no candidate, rights decision or fair bake-off exists. |
| The full drag-and-drop local/cloud Foundry is production-ready | Low | Contracts and safe local foundations exist, but production workers, trusted activation, cross-platform proof and live bake-offs remain incomplete. |

### Decisive next tests

1. **Engineering:** preserve the completed fixed local run, then extend the
   same profile and candidates to spatially distinct near/mid/far/orbit cameras
   and a moving trace. Save matrices, effective DPR, load time, frame rate,
   long frames and GPU-memory evidence. Do not call this the protected product
   route, and do not change the public pointer or database. After migrations,
   exact candidate registration and authenticated streaming are independently
   authorized, repeat the A/B through the protected route; only that later run
   can support product-route acceptance.
2. **Blake:** use the corrected five-feature checklist—timber doors/glazing,
   curtains/windows, column/moulding, floorboards, and room-depth/fixed detail—
   for LCC captures. Do not look for the absent fireplace, chandelier, painting
   or table.
3. **Geometry:** create and review a Reception-only 3D crop or floor-boundary
   polygon before another E57-to-XGRIDS fit. A scan-ID screenshot alone is no
   longer sufficient.

The exact unresolved root gap is simple: there is still no enhanced Reception
candidate that has passed the real Venviewer route, held-out photographs,
moving views, performance/GPU gates, supported devices, rights review and
repeatability in two other rooms. There is also no physically grounded winner
between the two recovered existing candidates. Until those tests exist, this
investigation is decision-ready but the product goal remains open.

## 22. 2026-07-17 LOCKED METHOD-SPECIFIC CV HOLDOUT ADDENDUM

### Plain-language result

The locked three-camera computer-vision replication gives **Mobile a small
directional lead**, not a product or release win. Mobile won 2 of 3 reserved
camera views on edge placement and 2 of 3 on line direction. Quality won 1 of
3 on each check. No independently calibrated threshold says these small
differences are visibly or commercially important.

This reverses the earlier three-view directional result, which slightly
favoured Quality. The ranking is therefore unstable across the available
views. Neither candidate should be promoted as physically or visibly superior
on this evidence. Mobile is only the provisional leader for this specific
locked replication.

The geometry check completed before image scoring also favoured the fixed,
non-mirrored alignment: combined RMSE was 0.284 m versus 0.349 m for the
mirrored alternative, an 18.5% improvement. That supports using the fixed
alignment for this comparison, but transform approval and physical-handedness
approval both remain false.

One extra Quality screenshot was triggered before the eight declared scoring
captures because a JavaScript assignment error surfaced after the screenshot
had completed. Its temporary file was overwritten; it was never displayed,
manifested or scored, and the reserved references had not yet been extracted.
The scored inputs did not change, but the process must not claim that exactly
eight screenshot operations were triggered.

The result has `authority: none`. It grants no transform, physical, runtime,
publication, training or release authority. The full safeguards, per-view
numbers, limitations and private evidence paths are recorded in
[`reception-room-e57-method-holdout-cv-2026-07-17.md`](reception-room-e57-method-holdout-cv-2026-07-17.md).

# OmniTwin Foundry external evidence refresh — 2026-07-28

**Status:** authority-none evidence note. No rights, activation, custody, training, execution, signing or publication state changed. No raw file touched. No paid compute.
**Relationship to prior evidence:** refreshes `omnitwin-foundry-root-investigation.md` (evidence cutoff 2026-07-14) and cross-checks `omnitwin-foundry-technology-license-matrix.md` (maintained through ≥2026-07-18). This note supersedes neither; it adds dated external evidence and flags where prior positions strengthen, weaken or stand.
**Full annex with per-claim sources:** `docs/reports/evidence/foundry-external-dossiers-2026-07-28.md` (five dossiers: XGRIDS, geometry licences, Matterport/capture, splat runtime, generative/semantics).
**Machine-readable register:** `omnitwin-foundry-evidence-refresh-2026-07-28.json`.
**Method:** five parallel research agents against primary sources during this session; each annex claim classed [FACT]/[INF]/[HYP]/[CNV]. Novelty below was checked by grep against the current licence matrix so that already-recorded items are not misclaimed as new.

## 1. Delta table vs the 2026-07-14 investigation

| # | Item | Novelty | Prior position | 2026-07-28 evidence | Impact |
|---|---|---|---|---|---|
| 1 | PortalCam raw access | CONFIRMS | Blocked; XBAG/.xbin undocumented; calibration ZIP-encrypted; no public decoder/SDK | Re-verified across store/docs/GitHub/resellers: still no raw-frame, intrinsics, LiDAR or IMU route; firmware 3.0.2 (2025-06) unified capture into `.xbin` | Recovery verdict **unchanged: partial**. Official-request lane remains the only raw path |
| 2 | LCC/LCC2 exports | CONFIRMS+ | Whitepapers known; SplatTransform 3.1.3 recorded | Export tier matrix pinned (PLY needs Basic+; SOG/SPZ via LCC2; 3D Tiles/USD Basic+); LCC Cloud $800/yr terms; whitepaper licence conditions re-quoted (attribution, share-alike, **no competing-AI-training without consent**, litigation auto-termination, PRC/SCIA) | Vendor-export bootstrap (approach A) stays the historical-capture bridge; the whitepaper AI clause is a **lock-in audit item** for any training that consumes LCC-derived data |
| 3 | Lixel K2 + LixelStudio 4.0 (≈2026-06) | **NEW** | Not recorded | K2 outputs point cloud + mesh + 3DGS; LixelStudio exports LAS/E57/RCP + panoramas + pano poses for Lixel devices (still not PortalCam) | If future XGRIDS hardware is ever reconsidered, K-series (open deliverables) dominates PortalCam; strengthens prospective-independence framing |
| 4 | Matterport API pano ceiling | **NEW (quantified)** | 134 MP capture known qualitatively | API skybox faces cap at 2048px, corresponding nominally to ~8192×4096 / ~33.6 MP equirectangular angular sampling; our E57's embedded 4096px cube faces correspond nominally to ~16384×8192 / ~134.2 MP and do **not** share that API ceiling | **The ~1/4-resolution ceiling applies to the API-delivered appearance lane, not every Matterport-derived lane.** The 4096px-face E57 imagery and owned DSLR/360 photography are both routes past the API cap; owned photography remains a separately controlled quality/provenance option |
| 5 | Matterport AI-training ToS (2026-03-01) | CONFIRMS | Known; encoded as `modelTrainingUse: requires_review`; Brush-splat discovery notes lineage | External corroboration of exports-usable-commercially *outside* training; training prohibition remains the controlling constraint | Counsel gate unchanged and still decisive for the Grand Hall Brush artefact and any cubeface-trained model |
| 6 | Spark 2.0 `.RAD/.RADC` LOD streaming (2026-04-14) | **NEW** | Not in matrix | JSON header + 64K-splat RADC chunks, HTTP Range streaming, chunk-0 coarse-first; Spark budgets published (Quest ≤1M, mobile 1–3M, desktop 1–5M; 16 B/splat packed) | Repo is already on `@sparkjsdev/spark` 2.0.0 + three 0.180 (verified in `packages/web/package.json`): the venue-scale LOD/streaming path we planned to build exists natively in our renderer — evaluate `.RAD` before building bespoke chunking |
| 7 | Cesium 3D Tiles splats (2026-04-27) + Streamed SOG v1 | **NEW** | Not in matrix | Production hierarchical splat LOD streaming shipped in two independent stacks; OGC positions splats for 3D Tiles 2.0 | Interchange strategy: SPZ assets + RAD/Streamed-SOG runtime + KHR-on-ratification remains correct and is now triply corroborated |
| 8 | KHR_gaussian_splatting | CONFIRMS+ | Extension known | Release Candidate 2026-02-03; ratification targeted Q2 2026 but spec still "Release Candidate" at fetch; SPZ + L-GSC compression extensions in flight (glTF PRs #2531/#2551) | Keep exporter "ready", don't ship as primary until ratified |
| 9 | OpenUSD 26.03 3DGS schema | CONFIRMS | In matrix | UsdVolParticleField3DGaussianSplat + hdParticleField + PLY→USD converter | USD lane viable for enterprise interchange; low urgency |
| 10 | Mesh-from-splat licences | CONFIRMS+ | Inria contamination known in principle | Per-repo verdicts pinned: 2DGS/GOF/RaDe-GS/SuGaR/MILo (Inria NC), PGSR (ZJU NC), GauStudio ("MIT except rasterizer" trap), MeshSplatting (Apache label, GS-licensed components), CityGaussian (CC-BY-NC) | **The clean meshing path is gsplat's Apache `rasterization_2dgs` + depth/normal modes + Open3D TSDF/Poisson** — algorithm inherited, reference code not; this is the H10 build route |
| 11 | gsplat main-branch 2026 features | **NEW (detail)** | 1.5.3 pinned (source-lock verified in `venviewer_training/`) | PPISP appearance model (Jan 2026) as bilateral-grid alternative; MCMC CUDA inject_noise (May 2026); 3DGUT distortion extensions (Mar 2026); HiGS fp16 inference; AccuTile; LiDAR rasterization; SOG-style compression module | Config-B stack sits on the healthiest line; plan a deliberate version-bump task with regression gates rather than tracking main ad hoc |
| 12 | NVIDIA Fixer (2025-11) | CONFIRMS | Already in matrix (3 hits) | HF card: NVIDIA Open Model License, "ready for commercial use"; Cosmos-Predict-0.6B base; 26.5 ms/frame; AV-domain training → heritage domain-shift risk | The T-504 "ArtiFixer" derivative lane has a licence-clean engine candidate; still gated by generated-region provenance + human review |
| 13 | SeedVR2 / FLUX.2-klein-4B / Wan2.1-VACE / LaMa / TRELLIS.2 | **NEW** | Not in matrix (FLUX partially) | Apache/MIT restoration (SeedVR2), generation (klein-4B), video inpainting for people/mirror masking (SAM 2.1 + VACE), object-level 3D (TRELLIS.2-4B MIT) | Fills the commercially-clean enhancement toolbox for the *enhanced-captured* truth class; SUPIR/ProPainter/DiffuEraser/MiniMax confirmed blocked |
| 14 | World Labs Marble + World API (2026-01-21) | **NEW** | Not in matrix | Exports splats (.ply/.spz) + collider/visual mesh; commercial rights from Pro $35/mo (Standard-tier ambiguity unresolved); paid users own outputs | Candidate *concept/imagination-mode* service only; never metric/evidence authority; Hunyuan family confirmed EU-excluded (disqualifying) |
| 15 | SpatialLM poisoned | **NEW** | Not recorded | All SpatialLM variants embed Meta SceneScript's CC-BY-NC encoder → non-commercial in practice; SceneScript itself CC-BY-NC | Do not adopt for room/door/window extraction; use geometric layout + Grounded-SAM-2 (Apache) + OpenMask3D (MIT) + VLM tagging with human review |
| 16 | Open capture-rig SLAM licences | **NEW** | Not in matrix | **GLIM (MIT)**, **OKVIS2-X (BSD-3, LiDAR+GNSS)**, LIO-SAM (BSD), Basalt/Kimera (BSD), KISS-Matcher (MIT) permissive; FAST-LIO2/LIVO2, ORB-SLAM3, VINS-Fusion, OpenVINS copyleft (internal-rig-only) | Approach G (open multi-sensor rig) has a fully permissive SLAM core available — H5/H16 de-risked at the licence layer |
| 17 | Feed-forward geometry | **NEW** | Not in matrix | MapAnything (Apache ckpt, rel. 2026-01), VGGT-1B-Commercial (gated), Depth Anything 3 (Apache sizes); DUSt3R/MASt3R family confirmed NC | Optional priors/init for sparse-view rooms in the owned photo lane; ship only the Apache/commercial checkpoints |
| 18 | Capture hardware lanes | **NEW (consolidated)** | Scattered | BLK360 G2: officially documented offline E57 **with embedded panoramas** (cleanest lock-in-free lane); Theta Z1 open SDK/DNG; Insta360 X5 72 MP but gated SDK; phone apps with open poses (Stray/Record3D/NeRFCapture/Polycam dev-mode); AprilTag/ChArUco Apache/BSD; DISTO BLE; RS3 RTK; ColorChecker DCP workflow | Feeds the D-capture-protocol lanes with named, licence-checked hardware; MIN ~$1–3k / PRO ~$25–35k / SUPREME ~$60k+ |
| 19 | C2PA / ISO 22144 | **NEW** | Not recorded | C2PA v2 fast-tracked as ISO/DIS 22144; production tooling for 2D; **no 3D provenance standard exists** | Our per-splat/per-region truth classes + hash-linked C2PA-signed 2D evidence would exceed industry practice; keep the internal channel canonical |
| 20 | Renderer field | CONFIRMS | Spark chosen | mkkellogg unmaintained (recommends Spark); PlayCanvas strongest offline tooling; Babylon adds SPZ+SH | Spark bet re-validated; use SuperSplat/SplatTransform offline |

## 2. Verdict impacts

- **A. Feasibility:** unchanged from the root investigation — full prospective independence feasible with bounded engineering; historical PortalCam recovery partial (metadata + processed exports; raw locked). Nothing found this session weakens the verdict; items 6/7/10/13/16 strengthen the build-side evidence.
- **C. XGRIDS recovery:** unchanged; the official-request letter remains the single decisive raw-access test. New: the whitepaper licence's competing-AI-training clause must be assessed by counsel **before** any training run consumes LCC-derived splats/meshes as input (affects approach L, warm-start-from-vendor-splat).
- **F/J. Appearance + enhancement:** the enhanced-captured toolbox is now licence-resolved (Fixer, SeedVR2, VACE, LaMa, klein-4B); the ~33.6 MP ceiling applies to 2048px-face API delivery, while 4096px-face E57 imagery provides nominal ~134.2 MP angular sampling. Owned photography remains a separately controlled quality/provenance option, not the only route past the API ceiling, reinforcing the Reception-HD lane and the D-capture protocol without downgrading the E57 appearance lane.
- **K/S. Runtime:** evaluate Spark `.RAD` LoD trees against Streamed SOG for venue-scale streaming before building bespoke chunking; keep SPZ as the portable asset format; KHR exporter on ratification watch.
- **H/R. Semantics:** commercial-safe stack = geometric layout extraction + Grounded-SAM-2 + SAM 2.1 (SAM 3 after licence review) + OpenMask3D + VLM room-labelling with human review; SpatialLM/SceneScript excluded.
- **G. Open rig:** permissive SLAM core exists (GLIM/OKVIS2-X); copyleft SLAM confined to internal rig use only.

## 3. Approach-registry refresh (statuses after this session)

| ID | Approach | Status | Change | Next test |
|---|---|---|---|---|
| A | Vendor-export bootstrap | **Active** | strengthened (tier matrix + SplatTransform LCC/LCC2) | inventory + convert one rights-cleared LCC2 export offline; record digests |
| B | Official XGRIDS raw access | **Blocked → request pending** | unchanged | send the official SDK/export/rights letter (root-investigation gap row) |
| C | Independent PortalCam reconstruction | **Blocked** | unchanged (no frames/calibration) | reopens only on B success or lawful frame source |
| D | E57 + panorama reconstruction | **Active (rights-gated)** | sampling quantified (API 2048px faces: ~33.6 MP-equiv; E57 4096px faces: ~134.2 MP-equiv) | counsel decision on Matterport training clause; geometry-only use unaffected |
| E | E57 + DSLR reconstruction | **Promising** | strengthened (independent quality/provenance option; feed-forward priors available) | Reception-HD 30-photo capture + registration against E57 |
| F | Video-to-world | Active (background) | permissive VIO options named | bounded phone/360 capture against E57 ground truth |
| G | Open multi-sensor rig | **Promising** | licence layer de-risked (GLIM/OKVIS2-X) | paper rig design + component quote; no purchase |
| H | LiDAR-first mesh | Active | unchanged | existing Grand Hall mesh-baseline lane |
| I | Photogrammetry mesh | Active | RealityScan 2.2 terms pinned (training opt-out!) | Metashape/RealityScan comparison lane when photos exist |
| J | Neural surface | Active (narrowed) | Neuralangelo/NeuS2 NC confirmed | gsplat-2DGS clean path (see K/H10) |
| K | Full independent 3DGS retrain | **Active** | trainer contract proven, runtime still blocked (T-514) | repair pinned worker; then rights-valid D-016 smoke |
| L | Warm start from vendor splat | Active (legal-gated) | whitepaper AI clause flagged | counsel read of "competing AI model" clause |
| M | Hero micro-splats | Active | unchanged | after K baseline |
| N | Hybrid mesh+splat | Active | runtime patterns documented (depth-write, SDF carving) | Spark hybrid prototype on existing assets |
| O | Hero meshes | Active | TRELLIS.2 (MIT) candidate for object assets | single fireplace/chandelier asset trial |
| P | Generative repair | **Promising (provenance-gated)** | Fixer commercial licence confirmed; domain-shift risk noted | licence-clean Fixer eval on held-out artifact views, generated-region masks on |
| Q | Active recapture | Active | unchanged | uncertainty-map → shot-list prototype on Reception-HD |
| R | Semantic world model | Active | SpatialLM excluded; clean stack named | Grounded-SAM-2 + OpenMask3D on one room; human review UI |
| S | Runtime quality optimisation | **Active** | .RAD/Streamed-SOG evidence new | A/B: SPZ vs SOG vs RAD on one existing splat; SH-loss fixed-view review |
| T | Provider-agnostic orchestration | Active | unchanged | per root investigation (Temporal/SkyPilot candidates) |
| U | Cross-platform operator app | Active | unchanged (Tauri preferred, Electron fallback) | three-OS renderer spike |
| V | Provenance/truth system | **Active** | C2PA/ISO 22144 context; no 3D standard | hash-link one enhanced 2D derivative to a C2PA manifest as a pilot |

## 4. Impact on active tasks

- **T-508 remains the exact next task** (activation/custody contract gaps); nothing here changes its scope or its NO-GO posture on 0058/0059.
- The Matterport counsel gate (root-investigation §18) now also controls the discovered Grand Hall Brush checkpoint series (`grand-hall-existing-brush-splat-discovery-2026-07-25.md`); the convergence study across its 20 checkpoints is rights-safe *analysis* but any reuse in training/publishing is not, pending counsel.
- New bounded follow-on candidates (proposed, not scheduled): (i) SPZ/SOG/RAD runtime A/B on an existing rights-cleared splat; (ii) gsplat-2DGS clean meshing spike; (iii) Fixer licence-clean eval behind generated-region provenance; (iv) official XGRIDS request letter (already a standing gap); (v) counsel bundle covering Matterport training clause + XGRIDS whitepaper AI clause together.

## 5. Gap-table deltas (vs root investigation §18)

| Gap | Change |
|---|---|
| PortalCam raw/calibration access | unchanged — official letter still cheapest decisive test |
| Matterport exported-image training rights | broadened: same counsel review should cover the Brush checkpoints and the XGRIDS whitepaper competing-AI clause |
| Visual superiority bake-off | new comparator available if rights clear (Brush 20-checkpoint series); otherwise owned-photo retrain path unchanged |
| Cross-platform renderer spike | unchanged; Spark .RAD evaluation added to its acceptance list |
| Trusted quality-profile registry / trainer runtime / identity attestation / independent control | unchanged |
| NEW: SH/compression loss quantification | fixed-view SPZ vs SOG vs RAD vs PLY comparison on one existing asset; 0.5–1 d; £0 |
| NEW: whitepaper AI-clause counsel read | 1–2 h counsel; blocks approach L and any LCC-derived training input |

— End of refresh. No success criterion is re-graded by this note alone; grading occurs in the root investigation when its next revision consumes this register.

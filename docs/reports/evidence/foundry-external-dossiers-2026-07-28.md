# Foundry external research dossiers — 2026-07-28

**Status:** authority-none external evidence annex. No rights, activation, training, execution or publication state changed.
**Method:** five parallel research agents, each restricted to WebSearch + primary-source fetches (GitHub LICENSE files, official specs, vendor pages). All fetches occurred live during the 2026-07-28 session; some agents printed an erroneous internal compile stamp of 2026-07-12 — ignore those stamps, the access date for every source below is 2026-07-28.
**Claim classes:** [FACT] primary-source verified · [INF] supported inference · [HYP] hypothesis · [CNV] could not verify.
**Companion synthesis:** `docs/reports/omnitwin-foundry-evidence-refresh-2026-07-28.md` (which items are NEW vs already recorded in `omnitwin-foundry-technology-license-matrix.md`).

---

## Dossier A — XGRIDS / PortalCam independence

Executive: XGRIDS is **partially open downstream, fully closed upstream**. LCC/LCC2 processed formats are publicly specified (whitepapers on github.com/xgrids, open-sourced 2025-11-11) with free SDKs and third-party readers (PlayCanvas splat-transform, SuperSplat). **No official route exposes raw camera frames, per-frame intrinsics/extrinsics, timestamped LiDAR or IMU from a PortalCam project**; `.xbin` remains undocumented and processing requires Windows-only LCC Studio or LCC Cloud.

### Products and export tiers [FACT]

PortalCam ($4,999 basic / $6,499 premium pkg; LiDAR 180°×180°, 856k pts/s; 4-camera array: 2× fisheye 200°×200° + 2× front 100°×85°, 4000×3000 rolling shutter; GPS; 512 GB). Lixel L2 Pro (survey, RTK/PPK). Lixel K2 launched with LixelStudio 4.0, sales ~June 2026 (~£6,499, built-in RTK, outputs point cloud + mesh + 3DGS simultaneously).

| Output | LCC Cloud | Studio Free | Basic | Premium |
|---|---|---|---|---|
| .lcc / .lcc2 (3DGS) | Yes | Yes | Yes | Yes |
| .ply (3DGS) | Yes | **No** | Yes | Yes |
| 3D Tiles / .usd | No | No | Yes | Yes |
| Mesh (.obj, geometry-only) | No | Yes | Yes | Yes |
| Map Fusion / HD Enhancement / Aerial | No | No | No | Premium only |

LCC2 export offers SOG (default, 8–26×) or SPZ (~10×, Niantic-compatible); "Include Mesh" adds collision mesh; 3D Tiles export has SPZ-v2 option (Cesium 1.35+, LCC Studio 1.11.1); USD export targets Omniverse/3DGRUT. LixelStudio (L2/K-series only, **not PortalCam**) exports LAS/E57/RCP + panoramic JPGs + panoramicPoses.csv + trajectory poses.csv. PortalCam has **no official point-cloud/panorama deliverable** — LCC Studio only. Pricing: LCC Premium $2,500/yr or $10,000 perpetual (dongle, offline); Basic bundled with PortalCam (1 yr); LCC Cloud $800/yr (500 GB, 250 min scan-processing/month, single-scene only, exports .lcc/.ply only, "identical output to LCC Studio 1.9.0", overseas A10 GPU + AWS S3).

### SDKs and GitHub [FACT]

github.com/xgrids: LCCWhitepaper (full LCC binary spec), LCC2Whitepaper (spec v0.0.3 Beta), LCC-Unity-SDK / LCC-Unreal-SDK / LCC-Web-SDK (render/raycast/clip/convert on processed models; **no license file declared → treat as proprietary source-available** [INF]), supersplat fork (MIT upstream), xgrids_games (Apache-2.0). Developer portal developer.xgrids.com; research contact xgrids-research@xgrids.com. **No SDK/API exposes raw frames, poses, intrinsics, LiDAR or IMU** [FACT for absence across all reviewed material].

### Raw project format

- `.xbin` [FACT]: introduced fleet-wide with firmware 3.0.2 (June 2025): raw captures written as a single fused container ~1/5 the previous size; older apps refuse the new files; the legacy LCC-vs-point-cloud capture split was removed. Encryption status [CNV]. No official spec, no export-raw function, no public parser found.
- `poses.csv` [INF]: on-device real-time SLAM trajectory (plain CSV; matches XGRIDS's documented downstream trajectory format).
- `data.ulg` [INF/CNV]: `.ulg` is the PX4 ULog extension — an open, self-describing telemetry format with open readers (PX4/pyulog, foxglove). Not officially confirmed for XGRIDS; trivially testable locally with pyulog.
- `gnss.csv` [HYP]: raw GNSS log. `lixel.zip` [HYP]: device/calibration bundle (repo evidence: ZIP-encrypted). `hierarchy.bin`/`octree.bin` [HYP]: filenames match the Potree streaming-octree format (consistent with LCC Scan live preview).
- LCC Studio 1.12.1 added a raw point-cloud *preview* tool, still no raw export.

### LCC/LCC2 format openness [FACT]

Both formats fully publicly specified. LCC: meta.lcc JSON + Index.bin + Data.bin (packed splats with published decode pseudocode) + optional Shcoef.bin (3rd-order SH) + optional Collision.lci (mesh + BVH, byte-level layout published). LCC2: JSON LOD tree + data/3dgs payload in **.ply, .spz or .sog** + optional PLY meshes + BVH. No camera poses/images in either format. Third-party readers: PlayCanvas **splat-transform** reads LCC and LCC2 (streaming); SuperSplat imports .lcc; Deep-In-Sight/ply2lcc open-source. LCC/LCC2 → PLY is a solved, offline, license-clean conversion.

### Legal boundary [FACT quotes; INF reading — not legal advice]

TOU (store.xgrids.com, "Last updated XX/XX/2025"): bars copying/disassembly/"reverse engineer the XGRIDS Products and Services"; bars using products "to develop services that are identical to or compete with our offerings"; no ownership claim over captures, but publicly posting content grants XGRIDS a free irrevocable worldwide license; PRC governing law, Nanshan District courts. Whitepaper license (LCC & LCC2): royalty-free use/modify/distribute of the *format* with attribution, modification notices, downstream pass-through, derivatives "no less open", **no training/fine-tuning of AI models that compete with XGRIDS without written consent**, auto-termination on litigation; PRC law, SCIA arbitration (Shenzhen, Chinese). Practical reading [INF]: reading LCC/LCC2 exports is expressly licensed; reading own CSV/ULog sidecars uses open formats; the gray-to-red zone is (a) reverse-engineering LCC Studio binaries or the undocumented .xbin container, (b) the "competing services" clause if Foundry is offered as a service resembling LCC.

### Posture and peers [FACT]

LCC open-sourced 2025-11-11 explicitly against a "walled garden"; GTC 2026 Real2Sim with Omniverse NuRec/OpenUSD; Autodesk App Store "LCC for BIM"; reported Khronos KHR_gaussian_splatting contributor [INF, secondary]. Windows-only LCC Studio confirmed as of 2026-05-21 reseller documentation; no Mac/Linux version found. Peers (NavVis, FARO/GeoSLAM, Emesent, Leica BLK2GO, Stonex) are more open at the point-cloud layer but equally closed at the raw-sensor layer; XGRIDS is ahead on open splat formats, behind on PortalCam point-cloud/pano deliverables.

### Recovery verdict inputs

| Data item | Official route | Confidence |
|---|---|---|
| 3DGS splats (PLY/SPZ/SOG/LCC/LCC2) | LCC Studio export (PLY needs Basic+); formats openly specified; splat-transform/SuperSplat read LCC/LCC2 | High |
| Mesh (OBJ; collision) | All tiers (.obj geometry-only); LCC2 Include-Mesh (PLY + BVH) | High |
| Colorized point cloud LAS/E57 | **LixelStudio only — not PortalCam** | High |
| Trajectory/poses | Raw-folder poses.csv readable now | High (readable) / Med (semantics) |
| Panoramas + pano poses | Lixel devices only via LixelStudio; **no PortalCam route** | High |
| Raw camera frames | **None** — locked in .xbin | High (absence) |
| Intrinsics/extrinsics | **None** exposed (LCC2 hints `cameraModel: pinhole` only) | High (absence) |
| Raw LiDAR w/ timestamps | **None** for PortalCam | High (absence) |
| IMU | data.ulg likely PX4 ULog (open readers) | Medium |
| Depth maps | None | High (absence) |

Could not verify: .xbin internals/encryption; ULog confirmation; gnss.csv/lixel.zip/project.json contents; SDK license texts; Mac/Linux Studio (high confidence none); LCC Cloud DPA; Khronos membership (secondary only); OEM raw-access program; in-box hardware EULA.

Sources: github.com/xgrids (+LCCWhitepaper, LCC2Whitepaper) · store.xgrids.com (TOS, PortalCam, contact, LCC Cloud SKU) · radiancefields.com (2025-11-11 LCC open-sourcing; 2025-06-25 firmware 3.0.2 .xbin; 1.11/1.12 notes) · doc.prevu3d.com/docs/xgrids · alpinerealitycapture.com LCC Studio guides · heliguy.com software comparison (upd. 2026-05-21) + K2 launch · splatlabs.ai pricing · laserscanning-europe.com · truepointprecision.ca LCC Cloud · github.com/playcanvas/splat-transform · github.com/Deep-In-Sight/ply2lcc · docs.px4.io ULog · apps.autodesk.com LCC for BIM · prnewswire GTC 2026 · geoweeknews.com SLAM roundup.

---

## Dossier B — open geometry stack licence matrix

Verdicts: **OK** permissive · **OK\*** commercial with conditions · **COPYLEFT** isolation-dependent · **NC** blocked. Framing: distributed, commercial, closed-source product.

| Tool | Category | Code license | Weights | Verdict |
|---|---|---|---|---|
| COLMAP (4.1.0.dev0, 2026-03) | SfM/MVS | BSD-3 | — | OK (PatchMatch MVS also BSD) |
| GLOMAP | global SfM | BSD-3 [sec] | — | OK |
| hloc | toolbox | Apache-2.0 | per-model | OK\* (default SuperPoint/SuperGlue NC — swap) |
| VGGT (Meta) | feed-fwd SfM | Meta VGGT license | VGGT-1B **NC**; **VGGT-1B-Commercial OK\*** (gated, AUP) | OK\* commercial ckpt only |
| VGGSfM / DUSt3R / MASt3R / MUSt3R / Fast3R / Pi3 weights | feed-fwd | CC-BY-NC family | NC | **NC** |
| MapAnything (Meta, rel. 2026-01) | universal feed-fwd | Apache-2.0 | **dual: Apache ckpt / CC-BY-NC ckpt** | OK\* (Apache ckpt only) |
| LightGlue / ALIKED / XFeat / DISK | matching | Apache/BSD | same | OK |
| SuperPoint/SuperGlue | matching | Magic Leap NC | NC | **NC — never ship** |
| RoMa v2 | dense matcher | MIT | DINOv3 backbone (gated Meta license) | OK\* |
| OpenMVS | dense MVS | **AGPL-3.0** | — | COPYLEFT high-risk — replace with COLMAP MVS |
| AliceVision/Meshroom | photogrammetry | MPL-2.0 | — | OK\* (file-level) |
| Open3D / VDBFusion / OpenVDB / PoissonRecon / Instant Meshes / Draco / trimesh / Assimp | geometry | MIT/BSD/Apache | — | OK |
| CGAL | comp-geometry | GPL-3 (high-level) / LGPL-3 (core) | — | COPYLEFT — LGPL packages or GeometryFactory license |
| MeshLab/PyMeshLab | mesh proc | GPL-3 | — | COPYLEFT — CLI subprocess only, never `import pymeshlab` |
| RealityScan 2.2 (Epic, 2026-06) | commercial | proprietary | — | OK\* — free <$1M rev, $1,250/seat/yr; user owns output; **Epic may train on scans by default (opt-out)**; Windows GUI + Linux CLI via Wine; no macOS |
| Metashape Pro 2.x | commercial | proprietary | — | OK — $3,499 node-locked, Win/mac/Linux, Python API, E57 import, no data-training clause |
| KISS-ICP / small_gicp / TEASER++ / KISS-Matcher / Fast-GICP | registration | MIT/BSD | — | OK |
| CloudCompare | QA | GPL-2 (CCLib LGPL) | — | COPYLEFT — CLI subprocess OK |
| FAST-LIO2 / FAST-LIVO2 | LIV odometry | **GPL-2** | — | COPYLEFT — internal capture rig only |
| **GLIM** (koide3) | LiDAR-inertial SLAM | **MIT** | — | **OK** (avoid glim_ext GPL modules) |
| LIO-SAM | LI SLAM | BSD-3 | — | OK |
| ORB-SLAM3 / VINS-Fusion / OpenVINS | VI SLAM | GPL-3 | — | COPYLEFT |
| Basalt / Kimera-VIO | VIO | BSD | — | OK |
| **OKVIS2-X** (ETH, 2025-10) | VI(+LiDAR/GNSS) SLAM | **BSD-3** | — | **OK** — strongest permissive VI-LiDAR option |
| MOLA | modular SLAM | core GPL-3 / mp2p_icp BSD | — | split |
| Depth Anything V2 | mono depth | Apache | **Small Apache; Base/Large CC-BY-NC** | OK Small only |
| **Depth Anything 3** (ByteDance, 2026-03) | multi-view depth | Apache repo | most sizes Apache; Giant+some L NC | OK\* (pick Apache size) |
| Metric3D v2 | metric depth | BSD-2 | weights unclear [CNV] | OK\* verify |
| MoGe-2 (MSFT) | mono geometry | MIT | MIT (HF tag; repo issue #98 ambiguity) | OK\* confirm |
| Apple Depth Pro | mono metric | permissive Apple | HF "apple-amlr" tag [CNV] | OK\* verify |
| UniDepth v2 | metric depth | CC-BY-NC | NC | NC |
| Marigold / StableNormal | depth/normal diffusion | Apache | Apache (SD-2 OpenRAIL heritage) | OK\* |
| libE57Format (BSL-1.0) / pye57 (MIT) / PDAL (BSD) / laspy (BSD-2) / LASzip (LGPL or Apache build) | formats | permissive | — | OK |
| Neuralangelo / NeuS2 | neural surface | NVIDIA source-code license NC | NC | **NC** |
| SDFStudio | framework | Apache | per-method | OK\* (permissive methods only) |
| Nerfstudio + gsplat | 3DGS | Apache-2.0 | Apache | OK |
| Brush (Rust/WGPU) | 3DGS trainer | Apache-2.0 | — | OK — cross-platform incl. WebGPU |

Direct answers: (a) A fully permissive COLMAP+OpenMVS replacement exists by assembly: COLMAP (BSD, incl. PatchMatch MVS) → PoissonRecon/Open3D → Draco; splat surface via Nerfstudio/gsplat or Brush (both Apache). OpenMVS is not needed. (b) 2026 consensus indoor stack vs terrestrial LiDAR: PDAL/libE57Format/pye57 read E57 → COLMAP/GLOMAP + hloc(ALIKED/LightGlue or XFeat) → optional feed-forward priors (MapAnything-Apache / VGGT-Commercial / DA3-Apache) → COLMAP PatchMatch → TEASER++ or KISS-Matcher global + small_gicp fine registration to the E57 (LiDAR = metric scale + drift control) → screened Poisson / OpenVDB mesh → gsplat/Brush splat runtime; monocular priors MoGe-2/Metric3D/DepthPro/StableNormal; commercial shortcut Metashape Pro; RealityScan faster but Windows-centric with a training-data opt-out to manage.

Could not verify: CUT3R license; MonoSDF license + Omnidata cue terms; Metric3D v2 / Depth Pro / MoGe-2 weights confirmations; DINOv3 gating details; Marigold/StableNormal OpenRAIL heritage counsel check.

Sources: primary LICENSE files and official pages for every row (colmap.github.io; github: colmap, cvg, facebookresearch/{vggt,vggsfm,map-anything,fast3r}, naver/{dust3r,mast3r}, magicleap, verlab, Parskatt, cdcseacave/openMVS, alicevision, isl-org/Open3D, PRBonn, openvdb.org, mkazhdan, cgal.org, cnr-isti-vclab, wjakob, google/draco, realityscan.com/license, agisoft.com, MIT-SPARK, koide3/glim, hku-mars, TixiaoShan, UZ-SLAMLab, HKUST-Aerial-Robotics, rpng, ethz-mrl/okvis2, DepthAnything, ByteDance-Seed/Depth-Anything-3, YvanYin, microsoft/MoGe, apple/ml-depth-pro, lpiccinelli-eth, prs-eth, Stable-X, asmaloney, davidcaron, pdal.io, laszip.org, NVlabs, autonomousvision, nerfstudio-project, ArthurBrussee/brush).

---

## Dossier C — Matterport / E57 / open capture hardware

### Matterport (2026)

- E57 add-on ≈ **$150/Space**: registered colorized point cloud (ASTM E2807) **plus per-scan-location panoramic images and metadata** (resellers quoting Matterport's own "Overview of Matterport E57 File") [FACT corroborated]. Pro3: ~1.5M range points/scan, 100 m range. Projection type (spherical vs cube) and embedded resolution not documented [CNV] — **local repo evidence supersedes: our cloud_0.e57 contains per-sweep cube faces (4096px) that prior sessions extracted**.
- MatterPak ≈ $100/Space: OBJ mesh + JPG textures, ASCII XYZ colorized point cloud, floor-plan + reflected-ceiling images; licensed for use **outside the platform**, marketed for commercial downstream packages [FACT].
- Model API (GraphQL): `PanoramicImage` position/rotation/skybox per pano; **skybox faces cap at 2048px → ~33.5 MP equirect, versus 134.2 MP captured** — native-resolution panoramas are not retrievable through documented channels [FACT]. Developer Tools License required (any paid plan; price custom).
- IP: customers warrant they own their Customer Data; exports licensed for external use — but customers also grant Matterport a broad perpetual license over hosted content; Showcase/SDK carries separate runtime terms — build on exports, not the hosted viewer [FACT]. **Repo-known and controlling: ToS effective 2026-03-01 prohibit commercial AI/ML training on Matterport Data — the 2026-03-04 Brush run predates nothing; it ran after the change (see `grand-hall-existing-brush-splat-discovery-2026-07-25.md`).**
- Community scrapers (matterport-dl etc.) exist; ToS-gray even on owned models — prefer licensed exports [INF].
- Pano/LiDAR alignment: color panos and depth captured at the same sweep head; per-sweep optical center ≈ LiDAR origin within a small calibrated lever-arm; minor per-sweep extrinsic refinement recommended [FACT/INF].

### E57 standard + tooling [FACT]

ASTM E2807: `Image2D` carries pose (quaternion+translation), `associatedData3DGuid`, and one representation: visualReference / **pinhole** / **spherical** (equirect; pixel sizes in radians) / cylindrical. Library reality: **libE57Format (BSL-1.0) reads embedded images fully** (Simple API: GetImage2DCount / ReadImage2D / ReadImage2DData); pye57 (MIT) requires low-level BlobNode navigation (no first-class image API); PDAL reads points only; CloudCompare views/exports images; `e57unpack --no-points` dumps embedded images. Recommended route: libE57Format Simple API (C++), pye57 BlobNode fallback (Python) — branch on spherical vs pinhole representation; bind panos to scans via GUID.

### Capture hardware lanes

- 360 cameras: **Insta360 X5** flagship (72 MP stills, 8K30, RAW DNG, .insv; SDKs application-gated proprietary [CNV terms]); **Ricoh Theta Z1** lowest SDK friction (23 MP, RAW DNG dual-fisheye, open OSC Web API, MIT theta-client, free stitcher); Theta X ~60 MP; RICOH360 A1 (2025) cloud-tied; **GoPro Max 2** (8K30, 29 MP, .360/.gpr) weakest for open pipelines — no official stitching SDK, not in Open GoPro.
- Phone apps with open per-frame poses/depth: Stray Scanner (MIT; rgb.mp4 + 16-bit depth PNG + odometry.csv), Record3D (LGPL libs; USB RGBD + intrinsics), NeRFCapture (MIT; transforms.json), Polycam Developer Mode (proprietary; per-frame intrinsics/extrinsics/depth/confidence), RTAB-Map (BSD*), Scaniverse (processed only; **SPZ export**; commercial resale needs Pro). ARKit sceneDepth + ARCore Raw Depth remain fully available [FACT].
- Scale/control: AprilTag (BSD-2), ArUco/ChArUco in OpenCV objdetect (Apache-2.0); Leica DISTO official C# partner API + standard BLE-GATT (community libs exist); Emlid Reach RS3 RTK $2,999 (IMU tilt); scale-bar best practice ≥3 calibrated bars spread wide, one held out as check (CHI/Agisoft); Calibrite ColorChecker Passport 2 ($119) → custom DCP profile + neutral-patch WB per lighting state.
- Terrestrial LiDAR with embedded-pano E57 and no cloud lock-in: **Leica BLK360 G2 — officially documented structured E57 "with scan grid and panoramas" via desktop Cyclone REGISTER 360** (cleanest); Trimble X7 close (per-station bubble views); FARO Focus offline colorized E57, embedded-pano-in-E57 unconfirmed for desktop; NavVis requires IVION (effective lock-in).

Lane table (hardware): MIN ≈ phone LiDAR (Stray/Record3D/Polycam) + X5/Theta Z1 + ChArUco + DISTO + ColorChecker (~$1–3k); PRO ≈ BLK360 G2 + Theta Z1 DNG + full-frame DSLR + calibrated scale bars (~$25–35k); SUPREME ≈ Trimble X7/FARO + DSLR array + RTK exterior GCPs + per-lighting color profiles (~$60k+).

Could not verify: Matterport pano projection/resolution in the generic export (locally answered for our file); exact MatterPak/DevTools pricing; Insta360 SDK terms; FARO desktop embedded panos; DISTO full GATT spec; Polycam/Scaniverse exact 2026 commercial clauses; iOS 26 ARKit changes.

Sources: matterport.com (add-ons e57/matterpak, legal: platform-subscription-agreement, terms-of-use, submission-terms) · support.matterport.com (E57/Pro3/DevTools articles; JS-gated, corroborated via resellers) · matterport.github.io + static.matterport.com API docs (PanoramicImage) · asmaloney.github.io/libE57Format-docs · libe57.org · github.com/davidcaron/pye57 (PR #13) · pdal.io readers.e57 · astm.org/e2807-11r19e01 · insta360.com · us.ricoh-imaging.com · github.com/ricohapi/theta-client · gopro.com + gopro.github.io/OpenGoPro · github.com/{strayrobots/scanner, marek-simonik/record3d, jc211/NeRFCapture, introlab/rtabmap, nianticlabs/spz, AprilRobotics/apriltag} · learn.poly.cam · nianticspatial.com · docs.opencv.org aruco · leica-geosystems.com partners + shop (DISTO) · emlid.com · culturalheritageimaging.org · calibrite.com · Leica rcdocs Cyclone E57 export · knowledge.faro.com · help.fieldsystems.trimble.com · knowledge.navvis.com.

---

## Dossier D — splat training, compression, runtime

### gsplat / 3DGRUT [FACT]

gsplat: Apache-2.0, clean-room (ships a "migrate from diff-gaussian-rasterization" guide). Latest PyPI **1.5.3 (2025-07-04)** — the repo's pinned version; main branch substantially ahead: 3DGUT integrated Apr 2025, extended Mar 2026 (external distortion PR #886, per-ray gradients, ray-normal outputs); MCMC native CUDA `inject_noise` (May 2026); **NVIDIA PPISP integrated Jan 2026 as bilateral-grid alternative**; 2DGS mode `rasterization_2dgs` with full depth/normal/hit-distance render modes; multi-GPU distributed rasterization; HiGS fp16 inference path (May 2026, experimental); AccuTile (Apr 2026); LiDAR rasterization (Mar 2026); SOG-style compression module. NVIDIA 3DGRUT: Apache-2.0.

### Large-scene/LOD + formats

- Research trainers (Hierarchical 3DGS, Scaffold-GS, Octree-GS: Inria NC; CityGaussian: CC-BY-NC) all commercially unusable; production LOD moved to delivery stacks: **Cesium 3D Tiles splats (shipped 2026-04-27; glTF+KHR payload, hierarchical LOD streaming)**, **PlayCanvas Streamed SOG v1 (open spec, Morton-ordered LOD chunk runs)**, **Spark 2.0 `.RAD` LoD trees (World Labs, 2026-04-14: JSON header + 64K-splat `.RADC` chunks, HTTP Range streaming, chunk 0 = 64K largest splats for instant coarse render; claims >100M splats in-browser)** [FACT per specs/blogs; the >100M figure is a vendor claim].
- **SPZ v4** (MIT): NGSP magic, per-attribute ZSTD, 24-bit fixed positions, smallest-three rotations, **SH degree 0–4** (8-bit, configurable), ~10× under PLY, vendor-extension mechanism. **SOG v2**: open spec, lossy, 15–24× (1 GB PLY/4M → 42–55 MB), WebP + codebooks, SH1–3 vector-quantized palette (heaviest SH loss). .ksplat: SH ≤2, unmaintained. glTF **KHR_gaussian_splatting: Release Candidate (announced 2026-02-03; ratification targeted Q2 2026; spec still "Release Candidate" with TODO implementations at fetch)**; float SH 0–3; SPZ (glTF PR #2531) and Qualcomm L-GSC (PR #2551) compression extensions in flight; contributors incl. Cesium, Niantic, Esri, NVIDIA, Autodesk. OGC: splats stated as key component of 3D Tiles 2.0. **OpenUSD v26.03 (Mar 2026): UsdVolParticleField3DGaussianSplat schema + hdParticleField renderer + PLY→USD converter; Omniverse RTX renders natively.**
- SH-fidelity ranking: PLY (float) > glTF/KHR (float) > SPZ (8-bit q, ≤deg4) > SOG (palette) > ksplat (≤2) > .splat (none).

### Web renderers

**Spark (sparkjsdev; World Labs; MIT)** — broadest formats (PLY/compressed PLY/SPZ/SPLAT/KSPLAT/SOG + .RAD streaming), only three.js-native LOD streaming, dyno shader graph, SDF splat editing, multi-splat correct sorting; v2.1.0 active; published budgets: Quest 3 ≤1M splats, Android 1–2M, iPhone 1–3M, desktop 1–5M (10–20M+ high-end); PackedSplats 16 B/splat (+SH/sort scratch); tune maxStdDev (√5 VR), disable MSAA, cap devicePixelRatio. mkkellogg/GaussianSplats3D: MIT, SH≤2, **no longer actively developed — README recommends Spark**. PlayCanvas engine/SuperSplat: MIT, best compression tooling (SplatTransform CLI), Streamed-SOG LOD. Babylon 8.0: SPZ + SH (2025-03-31). CesiumJS: geospatial 3D Tiles splat leader. Verdict for a React+three.js product already on Spark 2.0.0: **Spark is the correct 2026 choice; adopt .RAD or Streamed SOG for large venues; keep SplatTransform/SuperSplat as offline tooling; prepare a KHR exporter for ratification.**

### Mesh-from-splat contamination table [FACT licenses; INF reputations]

2DGS, GOF, RaDe-GS, SuGaR, MILo: Inria/MPII NC license (rasterizer-derived). PGSR: ZJU non-commercial. GauStudio: "MIT except the rasterizer" — **MIT badge but Inria-derived CUDA core (trap)**. MeshSplatting (Dec 2025): Apache top-level **but ships LICENSE_GS.md research-licensed GS components — treat as contaminated until audited**. CityGaussian V2: CC-BY-NC. **Clean commercial path: gsplat's Apache `rasterization_2dgs` + its depth/normal modes + Open3D TSDF/Poisson fusion — reimplements the 2DGS/RaDe-GS recipes with zero Inria code (inherit the algorithm, budget the engineering).**

### Hybrid mesh+splat runtime + eval

State of practice in three.js: opaque meshes write depth; sorted splats depth-test against mesh depth. Babylon evidence: splat `depthWrite:true` drastically improves occlusion (trade against blend softness). Spark's SDF splat-editing can carve/attenuate splats inside a mesh SDF at runtime. No standardized z-fighting mitigation published; use depth bias/polygonOffset + near-surface splat carving. Research: MeshSplatting, UniMGS (single-pass unified rasterization, 2026-01). Eval: lpips BSD-2, torchmetrics Apache, **nerfbaselines (MIT)** as the standard harness; gsplat's benchmark scripts as regression baseline.

Could not verify: KHR ratification beyond RC; Spark max SH degree and .RAD SH encoding; .ksplat/.splat size ratios; World Labs >100M independent benchmark; gsplat 2026 features in a numbered release; Babylon LICENSE re-check.

Sources: raw LICENSE/README fetches for gsplat, 3dgrut, hierarchical-3d-gaussians, Scaffold-GS, Octree-GS, 2d-gaussian-splatting, gaussian-opacity-fields, RaDe-GS, SuGaR, PGSR, GauStudio, CityGaussian, MILo, mesh-splatting, spz, supersplat, spark, GaussianSplats3D, nerfbaselines, PerceptualSimilarity, torchmetrics · docs.gsplat.studio · pypi.org/project/gsplat · developer.playcanvas.com SOG/Streamed-SOG · blog.playcanvas.com · khronos.org KHR press release + KhronosGroup/glTF KHR_gaussian_splatting README + PRs #2531/#2551 · cesium.com blog 2026-04-27 · aousd.org v26.03 (+cgchannel/80.lv/radiancefields corroboration) · sparkjs.dev docs (performance, packed-splats, lod) · worldlabs.ai Spark 2.0 blog · doc.babylonjs.com · arxiv 2512.06818, 2601.19233.

---

## Dossier E — generative enhancement + semantics + provenance

### Repair / world models

- **Difix3D+ (NVIDIA, CVPR 2025): weights NVIDIA-NC (SD-Turbo base) — blocked.** **Successor "Fixer" (nv-tlabs/Fixer + nvidia/Fixer, Nov 2025): Difix method rebuilt on Cosmos-Predict-0.6B, NVIDIA Open Model License — commercial use expressly allowed; 26.5 ms/frame @576×1024 on H100; offline distill-back + online enhancer modes. Caveat: trained on AV imagery — expect domain shift on ornate heritage interiors; validate/fine-tune.** Academic 2025–26 repair (GSFixer, GSFix3D, FixingGS): licenses unverified.
- Multi-view scene diffusion: CAT3D/ReconFusion never released; Stable Virtual Camera NC; GenFusion MIT (research-grade; DL3DV data terms); ViewCrafter Apache but requires DUSt3R NC ckpt — blocked as shipped. **No CAT3D-class model with commercial weights exists.** Commercially clean generative prior: Wan 2.1/2.2 video family (Apache).
- **World Labs Marble: GA 2025-11-12; World API 2026-01-21; exports Gaussian splats (.ply/.spz, 2M or 500k), collider + visual mesh, video. Free tier personal/NC; commercial rights from Pro $35/mo (Standard $20 ambiguity — confirm); paid users own outputs.** Google Genie 3/Project Genie: Ultra-subscriber preview, no API/export — not a pipeline component. NVIDIA Cosmos: NVIDIA Open Model License (commercial OK; attribution; guardrail clause). **Hunyuan family (HunyuanWorld/3D 2.x): territory excludes EU/UK/South Korea + 100M-MAU cap — disqualifying for an EU-facing product.** Microsoft TRELLIS / **TRELLIS.2-4B (Nov–Dec 2025): MIT code AND weights** — cleanest generative-3D license; object-level.
- Restoration/SR: Real-ESRGAN BSD-3; SUPIR strictly NC; **FLUX.1 schnell Apache / dev NC; FLUX.2 dev NC; FLUX.2 klein-4B Apache (Jan 2026), klein-9B NC**; SDXL OpenRAIL++ commercial-OK-with-restrictions; **SeedVR2 (ByteDance, ICLR 2026, 3B/7B one-step image+video restoration): Apache code+weights — the clean 2026 leader.** SR output is "enhanced", never measurement.
- Inpainting (people/mirror masking): LaMa Apache (deterministic default); SDXL-inpainting OpenRAIL++; FLUX Fill dev NC; ProPainter NC; DiffuEraser Apache-code-but-ProPainter-prior — tainted; MiniMax-Remover NC; **clean video stack: SAM 2.1 mask propagation + Wan2.1-VACE (Apache)**.
- Mesh texturing: Paint3D Apache (2K lighting-less UV); MVPaint **no LICENSE → all rights reserved**; TEXTure license unverified; Hunyuan3D-Paint EU-excluded; Meshy API: paid subscribers own outputs (free tier CC-BY-4.0).

### Semantics

SAM 2/2.1 Apache. **SAM 3 + SAM 3D (2025-11-19): custom "SAM License" — research AND commercial permitted with restricted uses; review before shipping.** Grounding DINO / MM-Grounding-DINO / Grounded-SAM-2: Apache. OpenCLIP MIT (per-ckpt data provenance). YOLO-World GPL-3 — avoid. **SpatialLM (walls/doors/windows/boxes from point clouds): poisoned for commercial use — all variants embed Meta SceneScript's CC-BY-NC encoder.** SceneScript CC-BY-NC. OpenMask3D MIT (verified). Mask3D/RoomFormer/HorizonNet/ConceptGraphs/OpenScene: reported-permissive, LICENSE re-verification pending. 2026 best practice for door/window/element detection: hybrid 2D→3D lifting (render ortho/perspective views → Grounded-SAM-2/SAM 3 → back-project + cluster), plus geometric opening detection (ray/occupancy + LiDAR reflectivity for glass), plus VLM tagging with human review (Claude/GPT/Gemini API terms commercially compatible; outputs owned by customer; no training on business API data by default; now standard practice). Floor plans: integrate PointCab/EdgeWise-class tools rather than rebuild.

### Provenance

C2PA spec v2.4/2.5; **C2PA v2 fast-tracked as ISO/DIS 22144**; production-ready for images/video/audio/documents (c2pa-rs/c2patool OSS). **No ratified C2PA binding or industry standard for 3D assets (glTF/USD/PLY/splats) exists** — recommended architecture: C2PA-sign source photos and all AI-enhanced 2D derivatives; carry a per-region measured/enhanced/generated provenance channel inside the scene format hash-linked to C2PA-signed evidence; emit sidecar manifests with 3D exports. This matches and extends the repo's existing captured/enhanced/generated/concept truth classes.

Could not verify: exact NVIDIA license text in nv-tlabs repos (verdicts rest on explicit HF model cards); TEXTure/Mask3D/RoomFormer/HorizonNet/ConceptGraphs/OpenScene LICENSE files; Marble Standard-tier commercial ambiguity; HunyuanWorld-Mirror MAU threshold; GSFixer-class licenses; SAM 3 full text (gated; consistent secondaries); Marble/Meshy training-data indemnification.

Sources: github/HF for Difix3D, nvidia/difix, nv-tlabs/Fixer, nvidia/Fixer, GenFusion, ViewCrafter, stabilityai/stable-virtual-camera, Wan-AI, tencent/HunyuanWorld-1 + Hunyuan3D-2(+2.1 issue #94), microsoft/TRELLIS(.2), Fanghua-Yu/SUPIR, black-forest-labs (schnell/dev/klein + bfl.ai licenses), ByteDance-Seed/SeedVR, sczhou/ProPainter, lixiaowen-xw/DiffuEraser, zibojia/minimax-remover, OpenTexture/Paint3D (raw Apache LICENSE), 3DTopia/MVPaint, TEXTurePaper, IDEA-Research/Grounded-SAM-2, AILab-CVC/YOLO-World, manycore-research/SpatialLM (+HF), facebookresearch/scenescript, OpenMask3D (raw MIT LICENSE) · worldlabs.ai (marble, world-api, ToS, docs) + TechCrunch/The Batch · blog.google Project Genie · nvidia.com Open Model License + Cosmos blog · meshy.ai help (commercial use, ownership) · roboflow SAM3 explainer · anthropic.com API legal protections · spec.c2pa.org 2.4 + ISO/DIS 22144 reporting · khronos.org Asset Creation Guidelines 2.0 · pointcab-software.com · mdpi.com/2075-5309/13/2/507 · dl.acm.org/10.1145/3649442.

# T-500 PortalCam raw-project audit — evidence report

**Date:** 2026-07-16 · **Session:** ARCHITECT/MR_GENJUTSU (Cowork, F: mounted read-only intent) · **Task:** T-500 (audit half) + T-505 prep
**Mounts inspected:** `F:\gaussian splat -- xgrids`, `F:\VENVIEWER -- TH PROJECT SPLAT OUTPUTS`, `F:\VenviewerCaptureStaging`, `F:\VenviewerReconstructionWork`
**Boundary note:** this audit is consistent with the T-506 lawful-raw-boundary ruling (no decryption, no xbin decoding — 64 header bytes read for the magic only). Disclosure: one *standard* unzip attempt on the calibration entries was made before this session had read the T-506 note (concurrent-session ordering); it failed on password and no circumvention was attempted.

## 1. Raw project anatomy — `Reception_Room_2026-06-01-150618` (8.77 GB, 12 files)

- **`2026-06-01-150618.xbin` — 8.70 GB, magic `XBAG`.** All four camera streams (`left_main`, `left_seco`, `right_main`, `right_seco`) and LiDAR payloads are, by supported inference (T-506 wording), inside this proprietary container. No image/video files exist elsewhere in the project. **Frames go/no-go: NO at the raw file layer.**
- **`project_data/poses.csv`** — 775 KB, 10 Hz SLAM trajectory (`ts,tx,ty,tz,qx,qy,qz,qw`), ~908 s. Open format.
- **`project_data/model/`** — a **Potree v2 preview octree** (`metadata.json` + `octree.bin` + `hierarchy.bin`): **175,237 points, metric, room-local**, spacing 0.125 m, offset `[-6.985, -13.259, -1.942]`, occupied extent ≈ **14.96 × 16.05 × 3.90 m**, attributes position/intensity/"lcc prediction". This is a vendor-produced, room-only 3D reference — see §4.
- **`project_data/log/lixel.zip`** — device logs (46 MB slam_core log etc.) plus factory calibration (`camera.yaml`, `extrinsic_camera_lidar.yaml`, `extrinsic_imu_lidar.yaml`, `imu.yaml`, `lidar_param.yaml`) — **all calibration entries are password-encrypted**.
- **`project_data/log/project.json`** — device SN `A25AAA663D`, **firmware `V3.2.1_20250829`** (v3.2.2 has been available since 2025-10-31 → update before the next capture), algorithm `v2.1.2.20250828.beta`, LiDAR `rs_airy` (RoboSense Airy), scan 926 s, 450.6 m walked, TZ Europe/London.
- `control_points.csv` **empty** (none placed during capture); `gnss.csv` all-zero (indoor); `external_data/` empty.
- All nine room projects share this structure (Grand Hall spot-checked); a tenth `default_2026-05-31-092254` test project exists.

## 2. LCC2 runtime export anatomy — `lcc2-result/`

- `Reception Room.lcc2` (80 KB manifest) + `data/3dgs/` (7 SOG tiles + `env.sog`, 63.5 MB) + `data/mesh/` (tiled low-poly PLY/btree proxy) + `info/` (`poses.json` — **4,529 poses @5 Hz**, `report.json`, `thumb.jpg`). Two more export variants exist in `New folder` (adds mesh PLY) and `New folder (2)` (adds OBJ).
- **`report.json`:** quality **3** (scale ceiling unconfirmed — owner checklist §6) · buildDuration 04:12:57 · **`hdImageCount: 0`** (no HD Enhancement pass has ever touched this asset) · `pointCloudQuantity` 2,002,122 · **`modeSize` 336,684,838 bytes** — the built model in the LCC Studio workspace is **336.7 MB vs 63.5 MB shipped: 5.3× further compression after build**.
- Each `.sog` tile is a ZIP: `means_l/u` (16-bit split positions), `quats`, `scales`, `sh0` (codebook), `shN_centroids` + `shN_labels`, `meta.json`; generator **`flash-kmeans-sog`**.
- **Objective compression findings (the quantifiable half of the four-view diagnosis):**
  - **SH3 is present** (`bands: 3`) but each gaussian's entire 45-coefficient SH vector is palettized to a **65,536-entry k-means codebook per tile** (env tile: 2,048). View-dependent detail — gilt, crystal, sheen — is exactly what this flattens relative to the 336.7 MB master.
  - **`antialias: false`** in every tile — Spark's `blurAmount`/`preBlurAmount` compensation must be configured for a non-antialiased source (pin during view D).
  - Tiles sum to **3,494,926 gaussians** across mixed-depth tile addresses vs 2,002,122 built — LOD-overlap duplication suspected; reconcile in the viewer before quoting either number as "the" count.

## 3. What this changes in the program

- **Initialization mode (b) — warm-start from the LCC master PLY + registered DSLR supervision — is the primary HD lane.** Mode (a) scanner-frame retrain requires xbin parsing + encrypted calibration and belongs to Stage 3 with its legal read (matches the T-506 boundary).
- The pose half of the T-501 bridge is confirmed feasible twice over (`poses.csv` 10 Hz, `poses.json` 5 Hz).
- 3DGUT's fisheye role shrinks for now (no scanner frames to train on); DSLR pinhole only.
- **Cheap open probe:** LCC Studio's build workspace on C: may cache extracted/undistorted frames from the 4h13m build. If it does, mode (a) unlocks with no container work. Inventory it before treating mode (a) as closed.
- The E57 side already carries **138 embedded Image2D panoramas** that passed the T-515/T-516 point-colour audit (prior sessions' finding, noted here for Lane M supervision context).

## 4. T-505 readiness and an unblock candidate

- Staged and reachable: `VenviewerCaptureStaging/trades-hall-2026-07-10/source/e57/cloud_0.e57` (**20.52 GB**, SHA-verified stage), matterpak OBJ + textures + reference GLB, `VenviewerReconstructionWork/.../staged-e57-poses/poses.json` (**149 poses**, rotation+translation, z ≈ 1.5 m).
- Sweep footprint 24.8 × 24.6 m forms **one connected cluster** — manual per-room sweep picking is unreliable, consistent with the T-515/T-516 finding that current fits fail the room-envelope test.
- **Unblock candidate for the "human-reviewed room-only 3D crop" requirement:** the raw project's **potree preview cloud** (§1) is a vendor-produced, room-only, metric point set with an explicit bbox. Proposed use: human visually reviews the preview cloud (it is small enough to open anywhere) → global registration (Open3D FPFH + RANSAC → point-to-plane ICP) of preview → downsampled E57 → crop E57 to the aligned bbox + margin → residual report (mean/median/RMSE/p95/overlap %/control-point error + fixed views) → TransformArtifactV0. Grand Hall's project (the T-506-selected pilot) carries the same artifact. This is a candidate input to the existing blocked workflow, not a claim that it passes review.
- 155 vendor control files from the original `F:/E57` delivery (T-480 classification) remain the source for the control-point-error column.

## 5. Unreal sweep

No `.uproject` on any of the four mounted F: trees. Strategy doc §5d stands.

## 6. Remaining T-500 items (owner/GUI)

1. LCC Studio: confirm license tier; reconcile the "$800/yr" quote against the verified $2,500/yr Premium public price.
2. LCC Studio: confirm the quality scale — is 3 the ceiling? What would a max-quality rebuild change?
3. LCC Studio: **export the master PLY** (view B) — feeds the four-view comparison and the warm-start lane.
4. Four-view screenshots at the five fixed viewpoints (fireplace, chandelier, painting, carved timber, table): A = LCC Studio, B = master PLY in SuperSplat, C = SOG/SPZ chunks in SuperSplat, D = Venviewer.
5. Venviewer/Spark knob pin: device pixel ratio, `lodSplatCount`, `sortRadial`, blur compensation for `antialias:false` source.
6. Locate the LCC Studio workspace on C: and check for a frames cache (§3).

## 7. Evidence paths

| Item | Path |
|---|---|
| Raw project audited | `F:\gaussian splat -- xgrids\model\Reception_Room_2026-06-01-150618\` |
| Trajectory (10 Hz) | `…\project_data\poses.csv` |
| Preview cloud (room-local) | `…\project_data\model\{metadata.json, octree.bin}` |
| Device/firmware record | `…\project_data\log\project.json` |
| Encrypted calibration | `…\project_data\log\lixel.zip` (config/*.yaml entries) |
| LCC2 runtime | `F:\VENVIEWER -- TH PROJECT SPLAT OUTPUTS\lcc2-result\` |
| Output poses (5 Hz) | `…\lcc2-result\info\poses.json` |
| Build report | `…\lcc2-result\info\report.json` |
| SOG tile internals | `…\lcc2-result\data\3dgs\*.sog` (ZIP: meta.json + webp planes) |
| E57 stage | `F:\VenviewerCaptureStaging\trades-hall-2026-07-10\source\e57\cloud_0.e57` |
| E57 sweep poses | `F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses\poses.json` |
| State enrichment | `state/capture_log.json` (reception-room entry: deviceSN/firmware/algorithm/rawProjectAudit) |

## 8. Autonomous follow-up — 2026-08-05 (Spark knob pin, frame-cache hunt, T-505 review pack)

**Spark knob pin (read-only code audit; no code edited — the runtime-resolver files belong to the parallel workstream).** Findings against the live tree:

- **`DESKTOP_PLANNER_DPR = 0.75`** (`PlannerScene.tsx` — phone and tablet also 0.75). The production planner renders at three-quarter resolution and upscales, on every device tier. This is a first-order softness source for view D that exists *before* any splat/compression question — almost certainly a deliberate perf choice (the 2026-07-12 CARD A2 log records "GPU stall due to ReadPixels — High" with 2M splats resident), but it means view-D screenshots measure the 0.75× pipeline, not the asset ceiling. For the four-view comparison, capture D twice: stock, and with DPR forced to `[1,2]`.
- **The production splat path passes no Spark render profile.** `SparkSplatLayer` only applies `maxSh`/renderer settings when a `renderProfile` prop is provided (line ~305), and the sole profile in the codebase is `reception-fixed-fine-review-v1` (living-hall review page). So `/plan` runs on Spark 2.0 defaults for maxSh, blur compensation, LOD and sorting — unpinned. (What those defaults resolve to at runtime is UNVERIFIED here — flagged, not guessed.)
- **The review profile is the right template for our data:** `blurAmount: 0.3, preBlurAmount: 0` is the documented pairing for a source trained *without* antialiasing — and §2 established our SOG tiles carry `antialias: false`. Also pins `maxSh: 3`, `sortRadial: true`, canvas `antialias: false`, DPR `[1,2]`, ACES tone mapping. Recommendation for the runtime workstream (not implemented here): derive the production profile from this one, re-enable LOD per device tier, and keep the blur pairing.
- Planner canvas MSAA is ON for viewports >1099px (`antialias: viewportWidth > LEAN_…`) — Spark guidance says MSAA doesn't help splats and costs performance; it may still serve the mesh/ink layers. Decision for the runtime workstream.

**Frame-cache hunt (reachable disks).** `F:\gaussian splat -- xgrids\Trades_Hall` turned out to be an **LCC Editor project shell** (app 1.13.1, created 2026-06-04): USDA scene/annotation stubs, empty `cache/`/`history/`/`temp/`, no model payloads, no frame cache, no build outputs. Conclusion stands: the real LCC Studio reconstruction workspace (336.7 MB built model, any frame cache) lives on C: — needs an owner-approved mount or the §6.6 manual check.

**T-505 review pack staged** at `F:\VenviewerReconstructionWork\reception-preview-cloud-2026-08-05\`: `reception-preview.ply` (175,237 pts, binary PLY decoded from the open potree v2 layout — decode verified byte-exact against `metadata.json` bounds), four projection images for the human room-crop review (`top-down-XY`, `wall-band-slice-XY`, `elevation-XZ`, `elevation-YZ`), and `provenance.json` (SHA-256 of sources, method, `authority: none`). This is the candidate input for T-505's "human-reviewed room-only crop" blocker: one human look at the top-down/wall-band images to confirm "that is the Reception Room outline" is the review the blocker asks for.

**Update (2026-08-05, later same day):** the review happened and is recorded — Blake confirmed the Reception outline from his phone (relayed verdict; scope = room identity only, no scale/alignment/authority; `review-record-2026-08-05.json` carries the provenance and the SHA-256 of both reviewed PNGs). A floor-boundary polygon was then derived and **visually verified**: `floor-boundary-polygon.json` v2 (floor-coverage footprint method, 108 vertices, 107.7 m², `floor-boundary-overlay.png`); a first wall-band-contour attempt produced an interior-clutter trace, was rejected on visual check, and is superseded — the rejection is documented in the polygon file's `method` field. T-505 moved `blocked → not-started` for the Foundry lane, which now holds both accepted unblock artifact forms; the E57-side crop/ICP was deliberately left to the workstation lane (no pye57/open3d in this sandbox, and the frozen-scan/rights discipline is theirs to apply).

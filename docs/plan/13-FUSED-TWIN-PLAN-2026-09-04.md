# The fused twin: the plan (2026-09-04)

**For:** Blake, and the next model · **Written:** Friday 2026-09-04, 11:15 BST, by the Fable session · **Basis:** the morning's fan-out (five readers over the live site, the code, every asset on the drives and the 2025-26 literature; three designers from three angles; the critics failed on the account's spend limit, so the critique below is mine) · **Supersedes:** docs/plan/11 Track B where they differ · **Instruction:** "a new kind of technology that combines the best of everthing in one viewer ... psnr 50 is a goal and 60fps with a fast load"

## 1. The verdict

The hall does not need a new splat first; it needs a compositor. The vendor's Grand Hall build is already fast (176 fps at all 6 million Gaussians on the 4090, 165 live) and its walls, boards, frieze and portrait are already sharp. What Blake sees are three delivery defects and one bad region: the view stood a metre above the boards (fixed this morning), every input snapped back (fixed this morning), nothing appears for 14 to 17 seconds and the room takes 31 to 46 seconds although the vendor's coarse levels are already on R2 and never requested, and the floor is 794,351 translucent two-centimetre discs that no renderer setting can sharpen. So the order is: deliver the vendor splat well (days), replace the floor and the plain plaster with photographed planes under the splat (a week), and only then train the fused hall on the H100 as the thing that beats the composite at four fixed viewpoints (weeks two and three). Every step is judged by the same court, and nothing generated ever reaches the measured layer.

PSNR 50 is not a novel-view number; no radiance field of a real room has reached 30 held-out, and the best published indoor result is about 25. The bar that replaces it is in section 6.

## 2. What the fan-out settled (measured)

| question | answer | evidence |
|---|---|---|
| Is rendering the bottleneck? | No. One host renders 6.02 M at 176 fps on the 4090; 165-181 live. | docs/reports/splat-drag-budget-2026-09-03.md; D:\claude\fused-twin-2026-09-04\records |
| Why the snap-back? | A re-render re-seated the camera 2.5 times a second. Fixed (b10dc065, f16d4398). | .claude/gotchas/interior-camera-pose-identity.md |
| Why a metre-high view? | The staging tool took the mesh's lowest edge as the floor; five rooms were 0.5-0.6 m too low. Fixed (ab244e1c, T-578). | tools/xgrids-lcc2/scripts/sog-floor-census.py |
| Why the blur? | The floor is content: 794,351 discs, median 1.9 cm, opacity 0.30, 3,560 per m²; walls carry 15,800 per m² of 0.75 cm opaque ones. maxStdDev, DPR and SH change nothing on the floor. | records/sog-floor-census-auto.json, montage-floor-*.png |
| Why 31-46 s? | 101.9 MB of finest tiles only; Spark's four-worker pool gates the first decode to 13.7 s (17.3 at 20 Mbps); Vercel proxies R2 with an always-MISS cache; the 355 k / 716 k / 1.45 M / 2.95 M levels are on R2 unused. | records/prod-20mbps-dpr1.json, gh-load.mjs |
| What do we own? | The 41 GB raw XGRIDS capture and its 15,044 registered frames; nine vendor builds (GH_2 served); Bright Walls as the vendor build Grand_Hall_Small (4.98 M) in its own unregistered frame; the Matterport E57 (hall = sweeps 0-48) with 4096² skybox faces; 148 native 8K panoramas (sweep index unverified); the Matterport OBJ with 144 textures; three earlier panorama splats (the one Blake liked is gone). | grand-hall-asset-inventory.json |
| What is registered to what? | Only the XGRIDS frames and GH_2 share a frame. E57, the 8K panoramas, the OBJ and Bright Walls have no transform to it. | inventory; project_xbag_colmap_bridge memory |
| Does own training work? | The package trains (a 1,023-frame zone reaches 20.4 dB in 7k steps); the first run starved. | docs/reports/foundry-first-run-diagnosis-2026-09-04.md |

## 3. The three designs, judged

**Pragmatic ("coarse-first, right height, real floor").** Right about the week: the ladder from the vendor's own levels, the datum, supersampled settled frames on 1x displays, a delta-scaled wheel, a mid-laptop measurement. Wrong in one place the day proved: it derives the floor from the mesh's densest slab, which over-corrects the Reception Room by 0.4 m and misplaces the Robert Adam Room by 0.5 m; the served Gaussians' slab is the datum (done). Its floor source, the Matterport OBJ, needs a registration that does not exist (February capture, different frame, furniture moved); keep it as the A/B, not the first floor.

**Viewer-first ("composite the hall").** The strongest architecture: a compositor with per-region source selection; the vendor floor erased at runtime with Spark's SDF edit (the mechanism RoomClipBox already uses, no re-encode needed); an opaque floor plane baked at 4 mm per texel from the 7,522 XGRIDS pinhole frames that are already in the splat's frame (no registration); an own fetch ladder that beats the four-worker gate. Its risks are real and bounded: exposure drift and the operator's shadow in the bake (robust median per texel, holes labelled inferred), a seam at the skirting (a feathered band, tuned at the four viewpoints). This leads.

**Moonshot ("the Surface Ledger").** The right destination: one training in the SLAM frame that ingests the XGRIDS frames with native fisheyes, Bright Walls as more keyframes once registered, the panoramas as pinhole crops once registered, LiDAR and mesh depth as initialisation and a dense edge-aware depth term, per-source appearance (PPISP in gsplat main), and a floor atlas the trainer treats as fixed-depth. Wrong about the week (nothing of it can be shown on Monday) and optimistic about numbers (27-30 dB held-out is above anything published for a hall like this; 22-27 is the honest band). Its court protocol and its ledger of measured versus generated layers are grafted here.

## 4. The plan

**Week 0, done today (Friday 4 Sep).** Rubberband and poller (b10dc065, f16d4398). Datum in all eight rooms (ab244e1c), verified live: the Grand Hall is seen from 1.6 m at last.

**Week 1 (Sat 5 to Thu 11 Sep). Deliver the vendor splat well; the floor behind a flag.**
1. Saturday, the last deploy before the freeze: the coarse-first ladder. Mount the vendor's level-1 tile (355,593 splats, 7.2 MB, already on R2) at once, fetch the eleven finest tiles with our own fetch six in flight in spawn-distance order and hand Spark the bytes, cross-fade the coarse mesh out as the finest tiles land, and move the one renderer host to a standalone element so no tile owns it. Pill copy: "Streaming the room" until the coarse hall is on screen, then "Sharpening the room". Harness before and after at 20 Mbps: first view under 5 s, full sharpness unchanged at about 41 s (20 Mbps) and 14 s (60 Mbps).
2. Saturday: settled supersampling for the high tier on 1x displays (cap 8.3 megapixels, guard on a 20 ms frame), and the wheel step scaled by delta with a per-gesture cap (25 trackpad events currently fling the viewer 11 m). Test-first, harness-verified.
3. Sunday, offline, nothing pushed: the floor bake v1 behind `?splat=floor:bake`: plane at y = 0 (true since the datum fix), quad from the walk bounds plus 0.3 m, 4 mm per texel, sources the stride-selected pinhole frames with OPENCV distortion from the COLMAP model, occlusion against the LCC2 mesh, per-frame gain, robust median, holes filled from the splat and labelled inferred; the runtime composite is an opaque MeshBasicMaterial quad plus a SplatEditSdf slab of alpha 0 within 8 cm of the plane, feathered 4 cm, keyed on the bundle (never per render).
4. Monday: the demo (docs/plan/12), nothing deployed; time the pill on the venue Wi-Fi.
5. Tuesday: a real integrated-GPU laptop measured with the harness at every tier (nobody has ever measured one); the medium and low tiers serve the vendor's coarser level (4 or 3) as their sharp layer instead of a browser-built tree.
6. Wednesday and Thursday: the court (section 6) stood up; the floor flag judged at the four viewpoints; if it passes, default on. Owner action in the same week: an R2 custom domain with a bucket CORS rule so tiles stop passing through Vercel's always-MISS proxy.

**Week 2 (14-18 Sep). The composite finished; the registrations.**
The same bake for the plain plaster and wainscot bands of the long walls and the end wall, planes 1.5 cm behind the surface, erasing only plain-plaster Gaussians so the boards, portrait and frieze keep blending in front (target 3.4-4.2 M splats served, 65-75 MB plus 6-10 MB of textures). Register Bright Walls to GH_2 (mesh-to-mesh, KISS-Matcher then ICP, accepted under 5 cm) and render it at the four viewpoints: if its walls or gilding measure crisper, it becomes evidence, never a second splat. Register the E57 hall cloud to the LCC2 frame the same way (this unlocks the 8K panoramas and the Matterport OBJ), and run the Matterport floor as an A/B against the pinhole bake. Optional re-encode of the served tiles without the floor band (about 92 MB) gated by pixel diff at the four viewpoints.

**Week 3 (21-25 Sep). The fused training, judged.**
On the H100 (pod trmciz4jo6yf6m, volume kept): gsplat main pinned, one Config: LiDAR/mesh initialisation over the union of COLMAP and LCC2 points, pinholes with distortion and fisheyes native under 3DGUT (or virtual views if the depth term and 3DGUT still cannot coexist), the depth term from the sparse observations plus rasterised mesh depth, PPISP per-source appearance groups (pinholes, fisheyes, Bright Walls, panorama crops), a normalised world with Parser.transform saved and inverted on export, at least 300k steps or a stride subset with batches, `--disable-video`, a held-out set of a few hundred, evaluations that take minutes. Export SOG per tier. Judged at the court against the week-2 composite; ships only where it wins. Then the same treatment for the other seven rooms, one per day, with their own censuses.

## 5. The numbers, honestly

| measure | today | after week 1 | after week 2 | after week 3 |
|---|---|---|---|---|
| fps, 4090 laptop, in motion | 165-181 live | 160-176 (the quad is one draw) | 180+ (fewer splats) | at the tier budget |
| fps, mid laptop | never measured | measured Tuesday; expect 45-60 at level 4, 60+ at level 1 | | |
| first view, 20 Mbps | 14-17 s to any pixel; 46 s to the pill's end | under 5 s (7.6 MB); full sharpness about 41 s | under 5 s; sharpness about 35 s | |
| first view, 60 Mbps | about 6 s; 15-29 s | about 2 s; about 14 s | | |
| the floor | 23 (Laplacian variance at DPR 1), a smear | flag: a photographed floor, target over 100 | default; walls and boards unchanged | judged at the court |
| held-out PSNR, XGRIDS pinholes | none measured for the vendor build; own zone test 20.4 | vendor build measured (expect low-to-mid 20s colour-fitted) | composite measured | fused model: expect 22-27, the honest band |

"60 fps on every device at the full set" is not on offer: WebGL2 sorts on the CPU on integrated graphics, so the medium tier walks on a coarser vendor level, and only the 4090 class sees six million in motion.

## 6. The court (what replaces "PSNR 50")

Four fixed viewpoints (T-500's), 200 held-out XGRIDS pinhole poses reached through a DEV pose hook beside `window.__roomCamera`, screenshots at 1600×1200 DPR 1, PSNR/SSIM/LPIPS against the undistorted frames downscaled 2.5×, reported raw and per-image colour-fitted, per region (floor, walls, boards, frieze, ceiling) and whole-frame, with the protocol file beside the numbers (NerfBaselines shows protocol alone moves 3DGS by 0.3 dB). Pass conditions: at the four viewpoints the composite or the fused model beats the vendor build in every region and the floor by a lot; whole-frame colour-fitted PSNR in the mid-20s; the owner's eye on the same four frames. "Fifty" survives only as a fixed-viewpoint re-photograph fidelity claim, and even there 48 dB is where 8-bit differences vanish.

## 7. What the owner decides or provides

1. A mid laptop with integrated graphics for Tuesday's measurement (or Elaine's model).
2. An R2 custom domain with a bucket CORS rule (dashboard, minutes; no charge on the R2 side that anyone verified).
3. The Matterport-derived rights: the July ingest validator refuses model_training on Matterport-derived assets under Matterport's terms, while the 3 September record and the 4 September message grant everything; the agent records, it does not verify vendor terms. Say which wins before week 2's OBJ and panorama A/Bs.
4. About $150 of H100 time for week 3, plus the volume.
5. The 8K panorama to sweep index (N or N−1), or permission to settle it by feature matching.
6. Whether a generated repair layer (badged, imagination mode only, D-012) is ever wanted.

## 8. Traps carried forward

One SparkRenderer host per scene, always (the twelve-host bug cost 14 fps); keep everything keyed on the bundle, never per render (the rubberband); never add a render-target effect near a splat (sort corruption); the harness sums yaw travel and cannot see a snap-back, sample the pose instead; never edit web source during a harness run; a script outside packages/web cannot resolve Playwright, import it by absolute file URL; the mesh's lowest edge is not the floor; `lcc2 stage` wants an absolute manifest path under pnpm; compute the new text before opening a file for writing.

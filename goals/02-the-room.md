# 02 · The room, spectacular and fast

## The /goal block

Make the captured rooms spectacular and fast: the Grand Hall walk beautiful and sharp at one quality bar, 60 fps in motion with the same accepted appearance on the RTX 4090 laptop, on ordinary office computers, and on current iPhones and iPads including the entry models (plan 16 §4), first view in seconds; then the other seven rooms on the same recipe. Run the ladder's cards exactly as docs/plan/14 writes them: W1 the court (the fixed-viewpoint measurement that judges every beauty claim), W3 and W4 the registrations, W5 the floor from photographs behind a flag, W6 the delivery levers, W8 the seven rooms. Add the device matrix with fixtures chosen by engineering and measured on physical devices, the R2 custom domain, and plan 16's runtime experiment order with a same-source comparison of Spark, equivalent-work optimisations and a WebGPU prototype as the first runtime deliverable. A visibly reduced mobile mode cannot close this goal. PSNR 50+ is tracked under the court's protocol and every report says which number it reports.

## Outcome, in Blake's words

"we aim for psnr 50+ and 60fps with fast loads across ipads and computers and phones. whatever way we have to do it, we will achieve this"; "beautiful and functional without any lag"; the per-source verdict in GOAL.md §1: the Matterport mesh "had much clearer view of the floor", XGRIDS did "the windows and chandelier" better and "the gilded gold writing of names on the walls much nicer", the panorama-only splat "gave us clearer walls".

## Where we are (GOAL.md §2, measured 2026-09-04)

- The Grand Hall walk renders GH_2 (6,019,684 splats, 12 tiles, 101.9 MB) with one Spark host: 176 fps on the 4090 laptop at 6.02 M.
- First view 8 s at 20 Mbps since the coarse-first ladder (09a74df0); full sharpness 65–75 s at 20 Mbps. That tail is bandwidth: 102 MB at 20 Mbps is 41 s at best, so the sharp tail on weak lines is a serving-level problem, not a renderer one.
- Tiles go through Vercel's proxy (always cache MISS, no HTTP/3); Spark fetches four at a time; the finest level's eleven 8–11 MB tiles arrive in three waves.
- The floor blur is content: 794,351 translucent 2 cm discs. No renderer setting fixes it (measured).
- Medium and low profiles in packages/web/src/lib/splat-runtime-profile.ts are labelled extrapolated. No physical iPad or phone has ever been measured.
- The court does not exist yet. The R2 upload of the sources (about 157 GB) is in flight.
- The datum is fixed (T-578); every room is on y = 0.

## Decided (docs/plan/14 §1, not to be re-derived)

The floor needs another source. Every XGRIDS level is the whole room at one density; serve one level plus the sky, never a stack; the coarsest level is the first view. A Spark mesh cannot load hidden. One SparkRenderer host per scene. PSNR 50 is a fixed-viewpoint re-photograph target; the court is the judge. Bright Walls is training evidence once registered, not a blend. Panoramas enter as pinhole crops. The floor is the served Gaussians' densest slab.

Added by plan 16 §4 (decided by Blake): one quality bar across every supported device. The coarse-first ladder, the per-tier profiles and any coarser served level are diagnostic baselines and interim delivery, judged and labelled as reduced; none of them is completion. No silent low-resolution canvas, missing ornament, reduced furniture quality, blurred motion or 30 fps substitution counts. Source masters are preserved; "different representation" never means "equivalent" until measured; a perceptual claim is never relabelled lossless. A lower threshold requires a new founder decision.

## The work

The ladder first, as written, by its own cards: W1 (docs/plan/14, the court: `?pose=` on the walk, tools/court/, packages/web/scripts/court-render.mjs, the gh2-vendor baseline with six viewpoints and three regions), W3 (Bright Walls registered, Open3D, fitness ≥ 0.6 and RMSE ≤ 3 cm), W4 (the E57 and its 49 sweep poses), W5 (the floor orthomosaic at 5 mm/px behind `?splat=floor:bake`, judged at the court), W6 (tiles re-chunked to 4 MB, a coarser sharp layer for weak tiers, CI's e2e job made to finish), W8 (the seven rooms once Blake prefers a Grand Hall at the court). W2 and W7 belong to goal 08.

Then, in this goal's own slices:

D1 The device matrix. The fixtures are chosen by engineering, not by Blake (plan 16 §4): iPhone 17e and iPhone 17; iPad (A16) and iPad mini (A17 Pro) as the entry models, iPad Air (M4) and iPad Pro (M5); a Windows 11 office machine with an Intel Core i5-1135G7 and Iris Xe, 8 GB, 1920×1080; a comparable AMD integrated-graphics machine; an 8 GB M1 MacBook Air; a 16 GB office configuration; the venue's actual computers; and the RTX 4090 laptop as the ceiling. Recheck Apple's shipping lineup when devices are procured. For each: OS, browser, resolution, zoom, thermal and power settings; first view and complete at 20 Mbps, cold and warm; frame-interval p50/p95/p99 and input latency over twenty minutes of walking, rapid turns, placing furniture, phase changes and messages with a furnished 180-seat layout; dropped frames, long stalls, memory, thermal throttling. The harness is packages/web/scripts/splat-drag-budget.mjs; on a physical device it runs through remote Playwright over the venue's Wi-Fi, or Blake runs the one-command harness and returns the JSON (HUMAN.md 3 is physical access, not the choice). Report: docs/reports/device-matrix-2026-09-NN.md. Until a device is physical, the row says "emulated (CPU 4x, GPU unknown)".

D2 The per-tier served level, as an interim lever and a diagnostic only. Serve the vendor's coarser level as the sharp layer for weaker fixtures while D7 runs, judge the sharpness cost at the court so the trade is a number, and label every such build "reduced" in the matrix. It cannot be the final answer for any fixture.

D7 The runtime experiment order (plan 16 §4), one decisive experiment at a time, each with a pinned baseline and a stop condition: (1) remove redundant work with the accepted assets intact: one host, instanced furniture, cached static work, no avoidable transfers or interface re-renders; (2) render and deliver only what can contribute to the view: conservative culling, exact spatial partitioning, residency and predictive prefetch, tested on large footprints, glass, fast turns and disocclusion, never erasing a visible contribution because a centre is off-screen; (3) benchmark a WebGPU splat renderer against Spark on the same full-detail source (Safari 26 ships WebGPU on iOS and iPadOS; PlayCanvas documents GPU culling, projection and radix sorting), knowing a candidate may need a new renderer boundary and an ADR and is never a drop-in; (4) hybrid surfaces and regional appearance where photographs or meshes preserve detail, judged on seams, contact, thin structures and motion; (5) encoding and precomputation with separate error accounting, lossless alternatives first, SOG's quantisation counted as loss; (6) remote GPU assistance as a secondary experiment with its own latency, image, occlusion and failure tests. Transfer arithmetic is part of the design: 101.9 MB at 20 Mbps is 40.8 s of payload, so a fast full-quality first view cannot depend on downloading the whole room; prove view-local delivery, reuse or a better representation. The first runtime deliverable is the same-source comparison of Spark, equivalent-work optimisations and the WebGPU prototype on the real Grand Hall with furniture and live interface, on the physical fixtures, twenty-minute sessions, recording image and temporal differences, frame percentiles, input latency, memory and thermal behaviour. If no candidate meets both gates, record the bottleneck and run the next experiment; that is unfinished engineering, not permission to lower the bar.

D3 The R2 custom domain (HUMAN.md 7): tiles bypass Vercel's proxy, HTTP/3, cache HIT; measure the three waves before and after.

D4 The planner's delivery reaches parity with the walk (goal 00's T-581 first, then the same levers).

D5 60 fps in motion, defined and gated: active frame-interval p95 ≤ 16.7 ms in the harness drag, per tier, furnished (180 seats), not empty. The sublime test line 6 in every rebuilt surface reads from this.

D6 The PSNR protocol, pinned before any candidate is judged: reference-image membership, intrinsics and distortion, crop, size, colour space and range, resampling, masks; raw scores recorded, colour-fitted scores labelled separately; never train, texture-project or tune on a held-out view; split by location and session; whole-frame and regional scores, worst views, temporal paths, lineage, human comparison. Three numbers, never confused: fixed-pose reproduction (the court), held-out reconstruction (goal 08), delivery loss against a master (D2).

## Done when

On every fixture in the matrix, physically measured: the same accepted appearance (no reduced canvas, ornament, furniture quality or frame rate), first view ≤ 5 s at 20 Mbps (3 s the stretch), visually complete ≤ 8 s at 50 Mbps, frame-interval p95 ≤ 16.7 ms furnished. Interim reduced builds are labelled as such and are not counted. The court's floor band improves on every viewpoint with no whole-frame regression and no flicker. Every accepted derivative has lineage and a rollback. All eight rooms are on the same ladder with their own court baseline. PSNR 50+ remains a tracked stretch under D6 until achieved.

## Verify

```
node packages/web/scripts/splat-drag-budget.mjs --room grand-hall --layout 180
node D:/claude/fused-twin-2026-09-04/ladder-load.mjs
node packages/web/scripts/court-render.mjs --candidate gh2-vendor --base http://localhost:5173
python tools/court/judge.py --candidate gh2-vendor
gh run list --branch master --limit 1
```

## Forbidden

A second renderer host in the shipped scene. drei's Splat. An invisible Spark load. Screenshots during a load. A mobile number from emulation stated as physical. A reduced build presented as completion. Migrating production to a WebGPU candidate without an ADR and the matrix. Spend beyond GOAL.md §3 caps. Training on a held-out view.

## Human inputs

HUMAN.md 3 (devices), 7 (DNS), 12 (recapture only if the court shows a gap).

## Unlocks

Goal 01's sublime test line 6 (the device gate); goal 03's furnished budget; goal 08's court-judged runs.

# The coarse-first ladder: a whole room in seconds

**For:** Blake · **Written:** Friday 2026-09-04, 12:30 BST · **Task:** T-579, docs/plan/13 week 1 item 1 (GOAL.md section 3 item 2) · **Shipped:** 09a74df0, live on venviewer.com

## 1. What changed

The walk fetched one thing: the finest level, 101.9 MB over eleven tiles, behind Spark's four-worker pool. Nothing was on screen until the first of those tiles had arrived and decoded.

Every XGRIDS level is the whole room at a different density, not a piece of it, so the coarsest level is a complete room in a single request of 5.7 to 7.6 MB depending on the room. The walk now delivers in two stages plus the sky:

1. the coarse room alone on the wire, so it gets the whole pipe;
2. the finest level's eleven tiles once that is up, each shown as it lands, over the coarse room;
3. the coarse room dropped when the last of them is in.

The renderer host moved off the first tile to a mount of its own. It had to: the ladder drops that tile, and the host would have gone with it, which is the twelve-host bug of T-574 in reverse.

## 2. What it bought, measured

Production, throttled to 20 Mbps with 40 ms latency, timed from the page's own ledger rather than from pixels. Two runs before, six after (medians, with the spread, because a home line's own variance is wide).

| | before (2 runs) | after (6 runs) | change |
|---|---|---|---|
| First view (something of the room on screen) | 20.9 s (20.7–21.1) | 8.0 s (7.0–8.7) | **2.6x faster, about 13 s saved** |
| Full sharpness | 67.3 s (62.8–71.8) | 72.9 s (62.8–78.5) | within the line's noise |
| Bytes | 101.9 MB | 109.5 MB | +7.5 % |
| Requests | 12 | 13 | +1 |
| Frame rate under drag, RTX 4090 | 168.3 fps | 171.6 fps | unchanged |

The first-view figure is unambiguous: six runs after span 7.0 to 8.7 s, two before span 20.7 to 21.1, and the ranges do not come close to touching.

Full sharpness is not: the ranges overlap almost entirely, so this line cannot resolve the difference. What is certain is arithmetic — the ladder adds 7.6 MB, which is about 3 s of wire at 20 Mbps, plus however long the coarse tile takes to decode before the eleven start. An earlier three-run sample put that at 9 s; six runs do not support it, and the honest reading is "a few seconds at most, hidden in the noise". A quieter line would be needed to say more.

A second A/B on one dev server, the same instrument both sides (`git stash` for the before arm), agrees on the shape: first view 26.5 s to 13.3 s, full sharpness 69.4 s to 78.5 s. Absolute numbers there are inflated by the dev server's unminified bundle, which both arms carry equally.

**How much softer the first view is** (Laplacian variance at the spawn pose, first view against the settled room):

| region | first view | settled | ratio |
|---|---|---|---|
| Name boards | 732 | 1595 | 2.2x |
| Panelling | 78 | 109 | 1.4x |
| Frieze | 30 | 95 | 3.2x |
| Floor | 7.5 | 34 | 4.6x |

The gilt lettering is already legible at the first view (`D:\claude\fused-twin-2026-09-04\ladder\prod-firstview-first-view.png`). The floor is the softest region, which is the floor's own problem, not the ladder's — see plan 13 week 1 item 3.

## 3. What it cost to find out

**A Spark mesh cannot load invisible and be revealed later.** The first design fetched the finest level out of sight and swapped it in whole, so that two levels of the same room were never composited at once. It rendered as unsorted colour blobs, and a camera nudge repaired it tile by tile, leaving a hard seam across the room. Spark collects what it draws with `scene.traverseVisible` and drives each mesh's level-of-detail tree only over that set, so a mesh that loads hidden has a tree that was never driven. `opacity={0}` is the same trap, because Spark derives a generator's visibility from its opacity. Recorded in `.claude/gotchas/spark-invisible-splat-load.md`; the tests carry the rule so the design cannot come back.

**Screenshots during a splat load are not evidence.** A readback stalls the GPU: a burst of four screenshots pushed one run's completion from 25 s to 63 s and produced frames that looked like corruption but were the sort mid-flight. Timing runs now take no pictures, and pictures are taken in their own run after a settle.

**Playwright's response event fires on headers, not on the body.** Four 10 MB tiles all "completed" at 8.4 s on a 20 Mbps line, which is impossible. Only the page's `window.__roomWalk` ledger is trustworthy for these timings, which is why the ledger now carries the first view as well as completion.

**The deadline is a guard, not a knob.** The finest level starts when the coarse tile settles or after fifteen seconds. Shortening that to eight changed nothing at 20 Mbps (78.5 s either way) because the tile settles first, and would hurt a 5 Mbps line by starting eleven competing fetches while the coarse tile is still coming. It stays at fifteen.

## 4. What the visitor sees

"Streaming the room" until the first view, then "Sharpening the room — N%" over a room that is already there, then nothing. The percentage counts the finest level's tiles, so it means what it says. A coarse tile that fails is not reported as a failed part of the room, and does not stop the finest level: the room simply arrives the old way.

## 4a. What a review of the shipped ladder found

Four independent checks were run over the shipped code — the ladder on all eight rooms, every other splat mount in the web package, the planner and captures console, and an adversarial read of the implementation — and every serious claim was then handed to a separate skeptic to refute. Seven survived, four did not.

**Fixed the same afternoon (dbc9ec62), both real, both mine from this morning:**

- **A failed tile took the cover away.** `complete` counted a *failed* finest-level tile as settled, and `complete` was what dropped the coarse room. On a flaky connection the room arrived in seconds, the pill climbed, and then at the moment a tile's fetch died the coarse room covering that geometry was discarded, leaving a black void over the forward view. Every tile failing emptied the canvas completely, pill removed, nothing said. The two ideas are now separate: `complete` still means nothing more is coming, but the coarse room is dropped only when every tile actually *loaded*.
- **`firstView` counted a failure as a first view**, so the pill could read "Sharpening the room — 9%" over a blank canvas.

**Real, recorded, not fixed today** (task rows carry the detail):

- `/living-hall` and `/fresh` mount **three complete levels of the Reception Room at once** — 3,494,926 splats and 62.8 MB where the finest level plus sky is 2,005,613 and 35.9 MB, so 43 % of what they fetch is lower-density copies of surfaces already delivered. Both paths serve in production (verified, HTTP 206). `/fresh` is reachable from the front door's Enquire links. The remedy is to keep only the four deepest tiles plus `env.sog` in `RECEPTION_TILE_MANIFEST`; it is not shipped today because those pages cannot render locally (their `/splats/reception` tiles are not in the staging root), so the visual result could not be looked at before deploying.
- The **planner and the captures console never got the ladder**, and pass no runtime profile, so they still fetch the finest level only and draw it with no level-of-detail budget.
- The **poller never stops if a tile's fetch hangs**: `complete` never arrives, so the page keeps re-rendering every 400 ms for the rest of the visit. Pre-existing, and milder since the coarse room now stays.
- The **served level is chosen per capture, not per room**, so a small room pays a large room's bandwidth.

**Refuted by the skeptics** (worth recording so they are not re-raised): a south-gallery run that missed the coarse deadline (the visitor still got the coarse room first); the renderer host riding on layer index 0 in the planner and visual console (that path needs platform-admin authorization, verified live, so no visitor reaches it); the planner's chunks mounting hidden (a chunk has no splat data while it downloads, so hiding it costs nothing); and multi-second main-thread stalls through sharpening (on production with a real GPU, not one block over 300 ms).

**One claim I could neither confirm nor refute.** The review reported the room going black or blobby for three to eight seconds after the pill disappears. Six readbacks of that same state gave Laplacian variances of 304, 33, 472, 403, 276 and 7 — a spread that is the signature of an unreliable instrument, not of a page. The walk enables `preserveDrawingBuffer` only under `?bare=1`, so an ordinary `page.screenshot` of it returns whatever happens to be in the buffer. The repo's own harness, which reads back the way the page supports and has produced consistent sharp images all day, shows 171.6 fps and a correct settled room after the ladder against 168.3 before. Settling it properly needs a real browser watched by a person, or a video capture (no ffmpeg on this machine).

## 5. Still open

- **Medium and low tiers.** Nobody has measured an integrated-GPU laptop. Plan 13 week 1 item 5 stands: those tiers should serve a coarser vendor level as their sharp layer, which the ladder now makes a one-line change.
- **The transient first sort.** A mesh entering the scene draws unsorted until Spark's first sort lands. Unchanged by this work and present before it, but not measured on a real visitor's first view, only through screenshots that stall the GPU.
- **The Vercel proxy.** Every tile is still a cache MISS through the rewrite. An R2 custom domain is the owner's action and worth more than any further work on the ladder.
- **Tile chunking.** Tiles are 8 to 11 MB, so the four-worker pool still delivers the finest level in three waves. Re-chunking to 4 MB would smooth the sharpening, at the cost of a re-encode and a republish.

## 6. Files

Instrument `D:\claude\fused-twin-2026-09-04\ladder-load.mjs`; records and pictures under `D:\claude\fused-twin-2026-09-04\ladder\`; the drag budget's own record at `D:\claude\splat-perf\ladder-live.json` and `ladder-live.png`. Code: `packages/web/src/data/room-splat-bundles.ts` (the ladder), `packages/web/src/components/rooms/RoomSplatScene.tsx` (the stages), `packages/web/src/components/scene/SparkSplatLayer.tsx` (`SparkRendererMount`), `packages/web/src/pages/RoomWalkPage.tsx` (the copy and the ledger).

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

Production, throttled to 20 Mbps with 40 ms latency, timed from the page's own ledger rather than from pixels. Two runs before, three after.

| | before | after | change |
|---|---|---|---|
| First view (something of the room on screen) | 20.9 s | 7.6 s | **2.7x faster, 13.3 s saved** |
| Full sharpness | 67.3 s | 76.5 s | 9.2 s slower |
| Bytes | 101.9 MB | 109.5 MB | +7.5 % |
| Requests | 12 | 13 | +1 |
| Frame rate under drag, RTX 4090 | 168.3 fps | 171.6 fps | unchanged |

A second A/B on one dev server, the same instrument both sides (`git stash` for the before arm), agrees on the shape: first view 26.5 s to 13.3 s, full sharpness 69.4 s to 78.5 s. Absolute numbers there are inflated by the dev server's unminified bundle, which both arms carry equally.

The nine seconds on full sharpness are the price of the ladder: 7.6 MB of extra bytes (about 3 s) plus the wait for the coarse tile to decode before the eleven start. It buys a room a visitor can look at, and move in, thirteen seconds sooner.

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

## 5. Still open

- **Medium and low tiers.** Nobody has measured an integrated-GPU laptop. Plan 13 week 1 item 5 stands: those tiers should serve a coarser vendor level as their sharp layer, which the ladder now makes a one-line change.
- **The transient first sort.** A mesh entering the scene draws unsorted until Spark's first sort lands. Unchanged by this work and present before it, but not measured on a real visitor's first view, only through screenshots that stall the GPU.
- **The Vercel proxy.** Every tile is still a cache MISS through the rewrite. An R2 custom domain is the owner's action and worth more than any further work on the ladder.
- **Tile chunking.** Tiles are 8 to 11 MB, so the four-worker pool still delivers the finest level in three waves. Re-chunking to 4 MB would smooth the sharpening, at the cost of a re-encode and a republish.

## 6. Files

Instrument `D:\claude\fused-twin-2026-09-04\ladder-load.mjs`; records and pictures under `D:\claude\fused-twin-2026-09-04\ladder\`; the drag budget's own record at `D:\claude\splat-perf\ladder-live.json` and `ladder-live.png`. Code: `packages/web/src/data/room-splat-bundles.ts` (the ladder), `packages/web/src/components/rooms/RoomSplatScene.tsx` (the stages), `packages/web/src/components/scene/SparkSplatLayer.tsx` (`SparkRendererMount`), `packages/web/src/pages/RoomWalkPage.tsx` (the copy and the ledger).

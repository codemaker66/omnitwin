# Grand Hall walk: serving one LOD level instead of five

**Date:** 2026-09-01 · **Task:** T-567 · **Status:** measured, shipped to master

## What was wrong

An XGRIDS LCC2 export's "LOD levels" are complete copies of the room at
decreasing density, not progressive refinement. The room scene mounted every
tile of every level as its own Spark `SplatMesh`, so the Grand Hall drew
11,487,038 splats where its finest level, 6,019,684, is the whole
reconstruction (it equals the XGRIDS build report's `pointCloudQuantity`).
The homepage's "58,991,948 splats" was that same sum across the eight rooms;
the finest-level total is 30,920,348.

Root cause located in `packages/web/src/components/rooms/RoomSplatScene.tsx`
(one layer per URL, no level selection) and
`packages/web/src/data/room-splat-bundles.ts` (returned every tile).

## What changed

- `tools/xgrids-lcc2` maps the manifest's finest-first `lodSplats` onto tile
  levels (`splatsByLevel`, `finestLevel`, `finestLevelSplats`), refuses a
  manifest whose `lodSplats` length disagrees with `totalLevels`, and emits the
  fields into the generated manifest. Regenerated output is byte-identical to
  the committed manifest apart from the new fields (sha-checked).
- `roomSplatTileUrls()` serves the finest level plus the sky shell only.
  `roomSplatServedSplats()` / `roomSplatServedBytes()` carry the honest
  numbers; `totalSplats` / `totalBytes` remain the staged sums.
- The homepage, the walk page and the captures page print the served count.
  The captures page also states how many tiles sit staged.
- Every level stays staged and published on R2; nothing was re-uploaded.

Tests: tool 52/52 (4 new), web 116/116 across the six affected files (RoomWalkPage
gained its first page test). Typecheck and lint clean.

## Measurement

Same instrument for both rows: headed Playwright Chromium on this machine
(RTX 4090, ANGLE D3D11, 1600×900, DPR 1), synthetic 4 s pointer drag,
`PerformanceObserver('longtask')`. Script and frames at `D:\claude\perf\`.
"Before" is production (all levels, tiles over the network from R2 via
Vercel); "after" is the local dev server (finest level, tiles from disk), so
the completion time favours "after" by the network; heap and drag do not.

| | Before: production, all 5 levels | After: finest level only |
|---|---:|---:|
| Splats on screen | 11,487,038 | 6,019,684 |
| Tiles fetched | 24 (200 MB) | 12 (102 MB) |
| Time to "complete" | 66.6 s | 7.2 s |
| JS heap at complete | 2,991 MB | 1,201 MB |
| Drag frame rate (rAF) | 4 fps | 13 fps |
| Main-thread stalls during the drag | 5 tasks, 2,864 ms, worst 858 ms | 9 tasks, 1,012 ms, worst 126 ms |

Earlier the same day, in the owner's real Chrome (same GPU, DPR 1.63), the
all-levels page took about seven minutes to report complete, held a 2,966 MB
heap, and froze the renderer for more than 45 s on every camera nudge.

## What this does not fix

- 13 fps under drag is still not a demo. The next levers, in order of cost:
  `minSortIntervalMs` on the `SparkRenderer` (currently 0, so every camera
  nudge re-sorts 6 M splats), a per-device tier (level 4 is 2,945,194 splats
  for the Grand Hall; Codex's unmerged `codex/grand-hall-exact-runtime`
  branch already selects 2.48 M for desktop and 1.24 M for mobile), and a
  DPR cap on the walk.
- The Grand Hall's spawn puts the visitor into oversized near-field splats
  on both before and after frames (`D:\claude\perf\*-loaded.png`). That is the
  room's `review` alignment (eye height derived at 3.0 m), not the level
  change; it is handled under the alignment decision, not here.

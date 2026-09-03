# The splat drag budget: why the Grand Hall walk lagged, measured

**Date:** 2026-09-03, evening · **Instrument:** `packages/web/scripts/splat-drag-budget.mjs` (headed Chromium on the real GPU, the real `/room/grand-hall` route on the Vite dev server, a four-second continuous drag sampled by `requestAnimationFrame`, long tasks observed, one JSON record per configuration under `D:\claude\splat-perf\`) · **Machine:** RTX 4090 laptop, ANGLE Direct3D11, 1600×900 at device pixel ratio 1, 240 Hz display · **Scene:** the Grand Hall leaf set as served, eleven tiles plus the sky shell, 6,019,684 Gaussians, 106.9 MB of SOG · **Task:** T-574

## 1. The finding

The walk lagged because `RoomSplatScene` mounted a Spark renderer host on every tile. Twelve `SparkRenderer` instances shared one scene, and each one sorted, read back and re-uploaded the whole room every frame. The CPU profile of a drag put `texSubImage2D` at 1,940 ms of the 4,000 ms and `getBufferSubData` at 230 ms: the main thread waiting on the GPU twelve times per sort. Every other mount in the codebase already passes `includeRendererHost={index === 0}`; this one, and the captures page, did not.

With one host the same six million Gaussians drag at 176 fps with a p95 frame of 12.4 ms and 434 MB of heap. Nothing else that the afternoon's design document proposed for the frame rate measured as anything: the sort interval, the motion pixel ratio and the tail radius each left the twelve-host scene at 13 to 15 fps.

## 2. The numbers

Median of three four-second drags per row unless stated. "fps" is from the mean frame interval; p95 is the 95th-percentile frame interval; "task" is the longest main-thread long task; heap is the JS heap after the last drag. Records: `D:\claude\splat-perf\<label>.json`.

| label | change from the row above | fps | p95 ms | task ms | heap MB | load ms |
|---|---|---|---|---|---|---|
| baseline-spark200 | as shipped: Spark 2.0.0, twelve hosts, no tree | 13.9 | 191.7 | 190 | 1521 | 5109 |
| spark210-asis | Spark 2.1.0 | 13.4 | 192.0 | 183 | 1521 | 7522 |
| wired-noop | profile plumbing in, every value at Spark's default | 14.1 | 191.7 | 189 | 756 | 5483 |
| sort33 / sort50 / sort100 | `minSortIntervalMs` 33, 50, 100 | 13.0 / 14.3 / 14.9 | 196 / 175 / 146 | 193 / 244 / 189 | | |
| dpr05 | motion pixel ratio 0.5 | 14.1 | 195.8 | 188 | 849 | |
| std2236 | `maxStdDev` √5 | 14.2 | 167.0 | 224 | 1553 | |
| lod2500k | tree on, budget 2.5 M (twelve hosts) | 35.6 | 62.5 | 74 | 1013 | 17535 |
| lod1500k | budget 1.5 M | 56.8 | 29.2 | 0 | 900 | 17639 |
| lod1000k | budget 1.0 M | 75.7 | 16.8 | 0 | 818 | 18728 |
| lod500k | budget 0.5 M | 125.3 | 12.5 | 0 | 726 | 17897 |
| rad-lod1000k | prebuilt `.rad` served in place of the tile, `lod` flag still set | 76.9 | 16.7 | 0 | 820 | 15605 |
| rad-default | prebuilt `.rad`, no `lod` flag, Spark's default budget | 36.2 | 58.3 | 82 | 965 | 6148 |
| **lodoff-singlehost** | **one renderer host, tree off, full 6.0 M** | **176.2** | **12.4** | **0** | **434** | **4402** |
| defaults-v1 | one host, tree on, rest 8 M, motion 1.0 M | 239.0 | 4.3 | 0 | 637 | 12624 |
| motion2500k | motion budget 2.5 M | 238.7 | 4.3 | 0 | 659 | 11186 |
| sh1-defaults / sh0-defaults | spherical harmonics capped at degree 1 / 0 | 239.7 / 239.8 | 4.3 | 0 | 619 / 651 | |

Two readings of the tree rows. With twelve hosts, frame cost was linear in the on-screen count, about 8.5 ms per million plus 4 ms; that slope was the twelve-fold work, not the renderer's. With one host the drag sits at the display's refresh ceiling at every budget tried, so the tree's cost on this GPU is invisible and its benefit is on GPUs that are not this one.

The prebuilt tree loaded with the `lod` flag set took as long as building one in the browser; Spark rebuilt what the file already carried. Without the flag it loaded in 6.1 s. Prebuilt trees therefore carry no `lod` flag. Their size is the next problem: 399 MB of `.rad` for 107 MB of SOG in the default 32-byte encoding, which is what `--rad-chunked` with `paged: true` exists to stream a page at a time.

## 3. The pictures

Readback screenshots at rest (`D:\claude\splat-perf\shot-*.png`, `defaults-v1.png`), all at the spawn view. At the full set the Deacon Conveners' name boards read as lines of gilt lettering; at a 1.0 M budget the lettering is a mottled texture and every edge softens; at 1.5 M it sits between. With the shipped profile the resting view is the full set (the boards legible) and the budget applies only while the camera moves, which is the same trade the camera already makes with pixel ratio.

## 4. What shipped

- `RoomSplatScene` and `RoomCapturesPage` mount one renderer host on their first tile.
- Spark 2.1.0 (three 0.180 already satisfies its peer range; 2.1 fixes a texture leak and the Chrome 149 `packed` keyword).
- `src/lib/splat-runtime-profile.ts`: per-tier settings (sort interval, tail radius, tree on/off, resting and motion budgets, harmonic cap, motion and settled pixel ratios), a query-string override grammar honoured only where the caller allows (DEV), and the invariants that the settled ratio never falls below the motion ratio and the motion budget never exceeds the resting one. High: tree on, rest 8 M (complete), motion 2.5 M. Medium 3 M / 500 K, low 1.5 M / 300 K, poster 600 K / 150 K, all three extrapolated and marked so.
- `src/hooks/use-splat-runtime-profile.ts`: probes the GPU during the first render (nothing on the walk route had ever called the device store's `detect`, so every visitor was "low"), classifies, records in the store, publishes the profile on `window` in DEV.
- `SparkSplatLayer`: a `runtime` prop for the host's sort interval, tail radius and budget and the mesh's tree flag and harmonic cap; a `lodScaleFn` polled each frame and written to the renderer only on change.
- `InteriorCamera`: `onMotionChange`, told once each time the view starts or stops resolving; `RoomSplatScene` turns it into the motion scale.
- The dev middleware serves `.rad` and `.radc`.
- The harness, with `SPLAT_BUDGET_LABEL`, `SPLAT_BUDGET_QUERY`, `SPLAT_BUDGET_CPU_PROFILE`, `SPLAT_BUDGET_SHOT` (bare-mode canvas readback) and `SPLAT_BUDGET_RAD` (serve the prebuilt tree in place of the tile).

Tests: 91 across the touched files; typecheck and lint clean.

## 4a. The same evening: prebuilt, paged trees (T-575)

The seven seconds the tree cost at load are gone. `lcc2 lod` (tools/xgrids-lcc2) builds a chunked Spark tree for every served tile already in the staging root with `build-lod --quality --rad-chunked`, keeps the header and its chunks together under `lod/`, and writes the manifest back with a descriptor per tree (`lod: { file, bytes, sha256, splats, chunks[] }`). It needs no capture drive: it reads the generated module the stage command wrote. The scene serves a tile's tree when the profile wants the tree and the bundle has one, loaded `paged: true` and without the `lod` flag; a tile without one is served as itself. The publish script walks `lod/` and serves `.rad` and `.radc`; so does the dev middleware.

| label | what loads | fps | p95 ms | load ms | heap MB |
|---|---|---|---|---|---|
| lodoff-singlehost | the twelve tiles, no tree | 176.2 | 12.4 | 4402 | 434 |
| defaults-v1 | the tiles, tree built in the browser | 239.0 | 4.3 | 12624 | 637 |
| **defaults-trees-paged** | **twelve prebuilt chunked trees, paged** | **238.0** | **4.3** | **1901** | **971** |

The Grand Hall's trees are 143 files and 381 MB against 107 MB of tiles, and the resting screenshot (`defaults-trees-paged.png`) is complete with the name boards legible. Then the byte meter (added to the harness the same hour) measured what the room costs on the wire, and the answer decided the default:

| label | what loads | wire at load | wire by end of drags | requests |
|---|---|---|---|---|
| wire-tiles | the twelve tiles | 101.9 MB | 101.9 MB | 12 |
| wire-trees | twelve prebuilt trees, paged | 298.7 MB | 347.8 MB | 130 |

A complete resting view needs every leaf, so paging fetches nearly the whole tree, and the tree format is 3.5 times the tile's bytes; the compact `--csplat` encoding produced 378 MB against 381, so the encoding is not the lever. At 100 Mbps that is roughly 28 s of download against 8 s of tiles with the browser building the tree underneath; prebuilt trees win only above about 250 Mbps. The decision, from these numbers: the high tier runs the tiles as they are, no tree (176 fps at full detail, 4.4 s load, 434 MB heap, all measured); the three weaker tiers keep the tree on and build it in the browser from the tiles, which keeps the wire at 102 MB; the prebuilt trees stay in the manifest and on disk as an opt-in (`?splat=trees:on`) for fast connections and for the harness, and are not published to R2 tonight. The cheaper protection for weak devices, not yet built, is the vendor's own coarser levels that the staged bundle already holds: serve level four of the Grand Hall's five to a medium device and no tree is needed at all.

## 5. What this changes in the plan

docs/plan/11 §2 is corrected in place. The ladder written that afternoon assumed the renderer was the cost; the renderer was being run twelve times. The tree stays as protection and as the path to streaming; the measurements for the other three tiers have to be made on their own devices; the prebuilt, chunked tree is the next slice.

## 6. Traps recorded

- A `SparkSplatLayer` mounted without `includeRendererHost={false}` on every tile after the first is a full extra renderer per tile. Grep for it whenever a scene maps tiles.
- Passing `lod: true` for a `.rad` file rebuilds the tree in a worker; the file already has one.
- A compositor screenshot of a loaded splat canvas hangs; read the canvas back in the route's bare mode instead.
- Nothing called the device store's `detect` on the walk route; a tier read there was always the default.
- Testing Library does not unmount between tests without vitest globals; a hook left mounted re-detects the GPU the moment the store is reset.

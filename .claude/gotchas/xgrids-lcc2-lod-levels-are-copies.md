**Read this when:** loading, staging, counting, or budgeting XGRIDS LCC2 splat
tiles (`*.lcc2` manifests, `data/3dgs/*.sog|spz|ply` tiles, the generated
`trades-hall-splat-bundles.ts`), adding a room to the walk/planner, or
explaining why a room's splat count on screen disagrees with the XGRIDS build
report.

# XGRIDS LCC2 "LOD levels" are complete copies, not progressive detail

An `.lcc2` manifest describes an octree whose tile ids are also their depth:
`0_0` is level 1, `0_7_0_0_1` is level 5. It is tempting to read that as a
progressive structure where deeper tiles *refine* shallower ones, and the first
ingest of Trades Hall did exactly that: it staged every tile and the room scene
mounted every one of them as its own Spark `SplatMesh`.

It is not progressive. **Every level is the whole room at a different
density.** The manifest says so in `lodSplats`, listed finest-first:

| Grand Hall (GH_2) | splats | tiles | bytes |
|---|---:|---:|---:|
| level 5 (finest) | 6,019,684 | 11 | 101.5 MB |
| level 4 | 2,945,194 | 6 | 51.6 MB |
| level 3 | 1,451,051 | 3 | 25.8 MB |
| level 2 | 715,516 | 2 | 13.8 MB |
| level 1 (coarsest) | 355,593 | 1 | 6.9 MB |
| **sum** | **11,487,038** | 23 (+env) | 200 MB |

The finest level equals the XGRIDS build report's `pointCloudQuantity`
(6,019,684): it *is* the reconstruction. Mounting all five levels drew the
room five times over, put 11.5 M splats through Spark's sort on every camera
move, and froze the renderer for minutes even on an RTX 4090 (measured
2026-09-01). The homepage's "58,991,948 splats" was this sum across rooms; the
true finest-level total is 30,920,348.

Rules that follow:

- **Serve one level, never a stack.** `roomSplatTileUrls()` in
  `packages/web/src/data/room-splat-bundles.ts` returns the finest level plus
  the environment shell. If a lower tier is wanted for a phone, choose ONE
  coarser level, do not add it to the finest one.
- **Count what is served.** Use `roomSplatServedSplats()` / `finestLevelSplats`
  for any number a person sees; `totalSplats` is the all-levels sum and is only
  honest as "staged".
- **Map `lodSplats` onto tile levels by reversing it**: `splatsByLevel[level-1]`
  is tile level `level`. The tool refuses a manifest whose `lodSplats` length
  disagrees with `totalLevels`, because a silently mis-mapped level reports the
  wrong count for a room.
- **Spark's `enableLod` does not rescue this.** LOD culling only applies to
  meshes constructed with `lod: true` / paged data; plain `SplatMesh({ url })`
  renders every splat it holds.
- The `.lcc2` may declare `sortingMethod: "depth"` while Spark defaults to
  radial sorting; that knob is still unpinned (T-500 diagnosis).

Codex's `codex/grand-hall-exact-runtime` branch reached the same conclusion
independently on 2026-08-19 ("loading them all together would duplicate the
room") and selects a per-device frontier; that work is unmerged.

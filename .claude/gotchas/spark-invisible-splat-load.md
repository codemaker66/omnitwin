**Read this when:** staging hidden splat sources, changing level swaps, or comparing
current behavior with the historical Spark visibility failure.

# Hidden splat staging: native lifecycle and historical Spark failure

The native migration on 18 September 2026 supersedes the Spark staging strategy
below. Current implementation guidance is in
[the native runtime note](../../docs/engineering/native-splats.md). The historical
filename remains for existing links.

`NativeSplatLayer` decodes a registered source independently of its visibility.
The shared native scene host selects visible sources with positive opacity,
prepares their merged sort and shaders, and retains the previous draw while a
replacement compiles. Complete named residency groups can be prewarmed at zero
opacity within the bounded snapshot cache. Do not carry Spark's mandatory-visible
loading workaround into this lifecycle or add independent per-tile draws.

Decode completion is not rendered readiness. Reveal may start after `onLoad`;
`onRendered` requires a GPU-completed main-camera draw at the submitted opacity
threshold. Neither callback proves compositor presentation. Verify initial sort,
reveal, camera motion, partial failure, cancellation and disposal when changing
staging.

## Historical Spark integration, 4 September 2026

The following mechanism and workaround describe that installed Spark version,
not the native implementation.

**What happened (2026-09-04, the coarse-first ladder).** The Grand Hall walk was to fetch its finest level out of sight and reveal it in one clean swap, so that two levels of the same room were never composited at once. The finest level rendered as unsorted colour blobs instead: bright smears with no geometry. A camera nudge repaired it *tile by tile*, leaving a hard vertical seam between a correct half of the room and a broken half.

**Why.** Spark collects what it draws with `scene.traverseVisible` (`spark.module.js`, `compileScene` and `prepareGenerate`), and it drives each mesh's level-of-detail tree only over that visible set (`driveLod({ visibleGenerators, ... })`). A mesh that loads while invisible is never in the set, so its tree is never driven; revealing it hands the accumulator a mesh whose nodes were never selected. Camera motion drives the tree again, which is why the repair follows the view.

`opacity={0}` is not a way round it: Spark sets a generator's `visible` from its opacity (`visible = dynoOpacity.value > 0`), so a fully transparent mesh leaves the visible set exactly as a hidden one does.

**The workaround used then.** Mount a splat layer visible, or do not mount it yet. To stage detail, the Spark-era `RoomSplatScene` ladder put the new layer *over* the old one and let each tile appear as it landed, then dropped the old layer once the new one was complete: coarse room first, the finest level's tiles shown as they arrived, the coarse room unmounted on the last of them. The overlap drew some surfaces twice for a few seconds to avoid the broken reveal.

**A separate, milder effect, easy to confuse with this one.** A mesh that has just entered the scene draws unsorted until Spark's first sort lands, and under `frameloop="demand"` a screenshot can catch that frame. Do not diagnose from a single still: take a burst, and remember that screenshotting during a splat load stalls the GPU on ReadPixels and inflates every timing in the run (see `.claude/gotchas/browser-pane-splat-streaming.md` and the e2e readback rules). Time the load with the page's own `window.__roomWalk` ledger, and take pictures in a separate run.

**Read this when:** mounting a Spark `SplatMesh` you intend to hide and reveal later (a cross-fade, a level swap, a preloaded layer), setting `visible={false}` or `opacity={0}` on a `SparkSplatLayer`, or looking at a splat scene that renders as unsorted colour blobs which a camera move repairs a piece at a time.

# A Spark mesh must be visible while it loads

**What happened (2026-09-04, the coarse-first ladder).** The Grand Hall walk was to fetch its finest level out of sight and reveal it in one clean swap, so that two levels of the same room were never composited at once. The finest level rendered as unsorted colour blobs instead: bright smears with no geometry. A camera nudge repaired it *tile by tile*, leaving a hard vertical seam between a correct half of the room and a broken half.

**Why.** Spark collects what it draws with `scene.traverseVisible` (`spark.module.js`, `compileScene` and `prepareGenerate`), and it drives each mesh's level-of-detail tree only over that visible set (`driveLod({ visibleGenerators, ... })`). A mesh that loads while invisible is never in the set, so its tree is never driven; revealing it hands the accumulator a mesh whose nodes were never selected. Camera motion drives the tree again, which is why the repair follows the view.

`opacity={0}` is not a way round it: Spark sets a generator's `visible` from its opacity (`visible = dynoOpacity.value > 0`), so a fully transparent mesh leaves the visible set exactly as a hidden one does.

**The rule.** Mount a splat layer visible, or do not mount it yet. If you need to stage detail, put the new layer *over* the old one and let each tile appear as it lands, then drop the old layer once the new one is complete — which is what `RoomSplatScene`'s ladder does: coarse room first, the finest level's tiles shown as they arrive, the coarse room unmounted on the last of them. The overlap draws some surfaces twice for a few seconds; that is the price of never showing a broken frame.

**A separate, milder effect, easy to confuse with this one.** A mesh that has just entered the scene draws unsorted until Spark's first sort lands, and under `frameloop="demand"` a screenshot can catch that frame. Do not diagnose from a single still: take a burst, and remember that screenshotting during a splat load stalls the GPU on ReadPixels and inflates every timing in the run (see `.claude/gotchas/browser-pane-splat-streaming.md` and the e2e readback rules). Time the load with the page's own `window.__roomWalk` ledger, and take pictures in a separate run.

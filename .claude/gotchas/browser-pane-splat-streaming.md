**Read this when:** verifying a Gaussian-splat route (the room walk, the captures console, the planner's splat layer) in the embedded Browser pane, or reading a black splat canvas or a "Streaming the room — 0%" pill that never moves in that pane as evidence about the site.

# The embedded Browser pane does not stream splat tiles

Observed 2026-09-03 (T-574/T-575 evening): the Browser pane (`mcp__Claude_Browser__*`)
opened `/room/grand-hall` on BOTH the live site (venviewer.com) and the local dev server
(localhost:5192). In both, the page mounted, `window.__roomCamera` was live, a WebGL2
context reported the real RTX 4090, the console was clean, and `window.__roomWalk` went to
`{ settled: 12, total: 12, complete: true }` on the live site; yet the canvas stayed black
and the page's resource timing and the pane's own network log showed NO tile requests at
all. The same minute, Playwright's own Chromium (`scripts/splat-drag-budget.mjs`) streamed
the same local route, rendered it and dragged it at 176 fps; the live site answered a
same-origin HEAD for a tile with 200.

Spark fetches tiles inside WebWorkers (the `blob:` worker scripts are the only
splat-related requests the pane logs). Whatever the pane does to worker networking, the
result is a splat scene that reaches its "loaded" state (a failed tile also counts as
settled) with nothing drawn.

**Rule:** the pane is not an instrument for splat routes. Verify them with
`packages/web/scripts/splat-drag-budget.mjs` (real GPU, real fetches, readback shots) or
the visual-check harness. A black canvas in the pane is evidence about the pane, not the
site; a black canvas in the harness is a finding.

Related: `spark-splat-layer-callback-identity.md` (the other "loaded but blank" trap, which
IS a site defect) and `project_visual_check_harness` in memory.

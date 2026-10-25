# Graphics reset recovery: planner, walk and tour (L3c, 25 October 2026)

**Outcome.** A view whose graphics the browser takes away now comes back by
itself. Before this, every such loss left a dead canvas: the native views (the
planner and the room walk) went to "The 3D view stopped" with a manual retry
that reset the camera, a WebGPU device destroyed with reason `"destroyed"` froze
silently, and the tour stayed black. Design and the r186 facts it rests on:
[the renderer note](../engineering/native-splats.md#losing-and-restoring-the-graphics-device-l3c-25-october-2026).

## How it was measured

`packages/web/scripts/graphics-reset.mjs` against a development build of this
branch, headless Chromium (Playwright's build) with `--enable-unsafe-webgpu` on
the RTX 4090, 1600 × 900 at DPR 2. The planner opened a furnished Grand Hall
layout (12 rounds, 120 chairs, API answered from fixtures as the planner e2e
specs do) at `/plan/<id>?space=grand-hall` with the real captured room
(6,030,980 splats, served from the published R2 origin), past the arrival, with
a table selected. The tour used the real imagery from `twin.venviewer.com`.
Losses were made the ways a browser makes them: `GPUDevice.destroy()`,
`WEBGL_lose_context.loseContext()` with and without `restoreContext()` after
1 s, and CDP `Browser.crashGpuProcess` (a real GPU-process crash). WebGL2 runs
hide `navigator.gpu`, as a browser without WebGPU does. Each run records:

- the recovery phases and their time;
- the scene graph (object identities, excluding splat draws, which are
  rebuilt by design), the camera (object and pose to 1e-4), and the cockpit's
  text (layout, selection, inspector);
- the canvas region before and after at the same pose (mean absolute
  difference, 0–255, and the share of pixels differing by more than 8 levels);
- rAF intervals across the same orbit or look, before and after;
- console errors and warnings, before and after the loss.

Runs, frames and JSON: `D:/claude/l3c-graphics-reset/run6`–`run12`.

## Results

| Surface | Loss | Back in | Way back | Kept | Before/after pixels | Frames before → after (median/p95 ms) | Page errors |
|---|---|---|---|---|---|---|---|
| Planner, walk, capture (WebGPU) | device destroyed | 1.40 s | same canvas | scene, camera, layout, selection, 6.03 M splats | 0.51; 0.74 % | 4.2/12.5 → 4.2/8.4 | 0 |
| Planner, walk, capture (WebGL2) | lost, handed back | 1.09 s | same canvas | as above | 0.42; 0.36 % | 8.3/16.8 → 8.3/16.7 | 0 |
| Planner, walk, capture (WebGL2) | lost, never handed back | 4.16 s | new canvas | layout, selection, pose; the capture re-streams | 49.3 (1.09 M of 6.03 M splats 10 s later) | 12.4/16.7 → 4.2/12.5 | 0 |
| Planner, walk, capture (WebGPU) | GPU process crash | 1.64 s | same canvas, still WebGPU | as the first row | 0.80; 1.42 % | 4.2/8.4 → 4.2/8.4 | 0 |
| Planner walk, eye level (WebGPU) | device destroyed | 1.32 s | same canvas | as the first row | 1.65; 4.66 % | 4.2/8.4 → 4.2/8.4 | 0 |
| Planner overview (WebGPU) | device destroyed | 0.22 s | same canvas | as the first row | 0.12; 0.15 % | 4.3/20.9 → 4.2/8.6 | 0 |
| Room walk, `/room/grand-hall` (WebGPU) | device destroyed | 1.01 s | same canvas | the view (pixels) | 0.04; 0.006 % | 4.2/4.3 → 4.2/4.3 | 0 |
| Tour, `/tour` | lost, handed back | 1.09 s | in place | viewpoint, look (pixels) | 0.72; 0.40 % | 4.2/4.3 → 4.2/4.3 | 0 |
| Tour | lost, never handed back | 4.35 s | new canvas | viewpoint; the look resets | 49.3 | 4.2/4.3 → 4.2/4.3 | 0 |
| Tour | GPU process crash | 1.39 s | in place | viewpoint, look (pixels) | 0.73; 0.43 % | 4.2/4.3 → 4.2/4.3 | 0 |

The room walk and the tour have no development scene bridge, so for them the
same-pose pixels are the evidence that the camera and room survived; inspected
frames are identical by eye. The first row's residue (and the eye-level walk's
4.7 %) is in candle flicker and splat floaters, not structure; the frames were
compared side by side. "Back in" for a loss handed back includes the 1 s before
`restoreContext()` was called.

**Console.** No run logged an error. After a loss the only lines of a kind the
page had not logged before were the browser's or R3F's own: "A valid external
Instance reference no longer exists." (Chrome, when its GPU process dies),
"CONTEXT_LOST_WEBGL: loseContext: context lost" (Chrome, the same moment for
WebGL), and "WEBGL_lose_context extension not supported" (R3F's unmount calling
`forceContextLoss()` on a canvas whose context is already gone, remount only).
The first WebGL run logged 128 "INVALID_OPERATION: delete: object does not
belong to this context" warnings from the lost renderer's leftover dispose
listeners; disposing it at the loss (commit `2cfac6dd`) removed them.

## Found and fixed by the real browser

1. The splat host refused the replacement renderer ("A native splat scene must
   have one active renderer"), taking a restored planner straight to the
   stopped card. `NativeSplatScene.attach()` now hands its sources to it.
2. The WebGL warnings above.

## Limits

- Desktop Chromium on one GPU. iOS Safari and Android Chrome, where most real
  losses happen (backgrounding under memory pressure), are the device day's
  ([script](../plan/device-day-2026-10-28-graphics-reset.md)).
- A context never handed back costs a remount: the planner keeps its layout,
  selection and pose but re-streams the capture; the tour keeps its viewpoint
  but not its look direction.
- The Grand Hall's 2 mm wall detail (`hall-detail.ts`) is empty after a swap
  until its tiles re-stream; the fix is named to the planner lane.
- Unit and component tests simulate the browser APIs; only this harness and the
  device day exercise them for real. Production holds splats on product hosts,
  so the room walk can only be checked on a preview build.

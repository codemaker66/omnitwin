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

Final runs (code at `19d94f00`), frames and JSON: `D:/claude/l3c-graphics-reset/final`;
earlier runs `run6`–`run19`. Times are the page's own clock (a MutationObserver
and long-task observer installed before the loss), not the harness's polls,
which a busy main thread delays.

## Results

"Drawn again" is when the cover lifts, which is when the new device has drawn
its first frame.

| Surface | Loss | Cover up | Drawn again | Way back | Kept | Before/after pixels (mean; share > 8) | Frames before → after (median/p95 ms) | Page errors |
|---|---|---|---|---|---|---|---|---|
| Planner overview, capture (WebGPU) | device destroyed | 18 ms | 1.73 s | same canvas | scene, camera, layout, selection, 6.03 M splats | 0.31; 0.30 % | 5.9/11.1 → 5.8/11.3 | 0 |
| Planner overview, capture (WebGL2) | lost, handed back after 1 s | 25 ms | 5.07 s | same canvas | as above (camera the same object, 0.1 mm of damping still settling) | 0.39; 0.38 % | 11.1/22.9 → 6.6/23.0 | 0 |
| Planner overview, capture (WebGL2) | lost, never handed back | 21 ms | 7.77 s | new canvas | layout, selection; the capture re-streams | 49.7 (1.09 M of 6.03 M splats 10 s later) | 11.5/23.0 → 6.0/12.0 | 0 |
| Planner overview, capture (WebGPU) | GPU process crash | 501 ms | 2.37 s | same canvas, still WebGPU | as the first row | 0.17; 0.07 % | 5.9/11.7 → 5.9/11.2 | 0 |
| Planner walk, eye level (WebGPU) | device destroyed | 14 ms | 1.23 s | same canvas | as the first row | 0.15; 0.05 % | 5.9/11.3 → 5.9/6.5 | 0 |
| Planner walk, eye level, DPR 1 | device destroyed | 17 ms | 1.67 s | same canvas | as the first row | 2.38; 7.2 % | 6.0/6.6 → 5.8/6.6 | 0 |
| Room walk, `/room/grand-hall` (WebGPU) | device destroyed | 14 ms | 0.93 s | same canvas | the view (pixels) | 0.11; 0.02 % | 5.9/6.6 → 5.7/6.4 | 0 |
| Room walk, DPR 1 | device destroyed | 13 ms | 0.89 s | same canvas | the view (pixels) | 0.04; 0.002 % | 5.7/6.5 → 5.7/6.4 | 0 |
| Tour, `/tour` | lost, handed back after 1 s | 13 ms | 1.09 s | in place | viewpoint, look (pixels) | 0.71; 0.39 % | 5.7/6.4 → 5.7/6.5 | 0 |
| Tour | lost, never handed back | 12 ms | 4.26 s | new canvas | viewpoint; the look resets | 47.3 | 5.8/6.5 → 5.9/6.5 | 0 |
| Tour | GPU process crash | 242 ms | 1.35 s | in place | viewpoint, look (pixels) | 0.73; 0.42 % | 5.8/6.5 → 5.6/6.4 | 0 |

Where the time goes (planner, WebGPU): the swap itself takes about 150 ms (the
lost renderer released in 2–3 ms, the new device ready about 120 ms after the
loss). The first frame then compiles the scene's pipelines in one long task of
0.8–1.5 s (4.0 s on WebGL2). After the room reappears, a second task of
2.4–2.9 s rebuilds the splat draw. (Corrected 26 October: this said it
compiled the rest of the pipelines, which was inferred. A CPU profile shows
the capture's snapshot being rebuilt for the new device, mostly merging and
bounding 6 M splats on the CPU; until then the room showed without its
capture. The cover now waits for it:
[follow-up report](graphics-reset-followup-2026-10-26.md).) Before the review fixes the
cover lifted before the first frame, so a person saw the canvas blank for
those seconds.

The room walk and the tour have no development scene bridge, so the same-pose
pixels are the evidence that their camera and room survived. Inspected frames
are identical by eye. The residues of more than 1 level (the eye-level walk at
DPR 1, and 1.65 in an earlier run) are candle flicker and splat floaters near
the camera, not structure; those frames were compared side by side.

**Console.** No run logged an error. After a loss the only lines of a kind the
page had not logged before were the browser's or R3F's own: "A valid external
Instance reference no longer exists." (Chrome, when its GPU process dies),
"CONTEXT_LOST_WEBGL: loseContext: context lost" (Chrome, the same moment for
WebGL), and "WEBGL_lose_context extension not supported" (R3F's unmount calling
`forceContextLoss()` on a canvas whose context is already gone, remount only).
The first WebGL run logged 128 "INVALID_OPERATION: delete: object does not
belong to this context" warnings from the lost renderer's leftover dispose
listeners; disposing it at the loss (commit `2cfac6dd`) removed them.

## Found and fixed by the real browser and the review

1. The splat host refused the replacement renderer ("A native splat scene must
   have one active renderer"), taking a restored planner straight to the
   stopped card. `NativeSplatScene.attach()` now hands its sources to it.
2. The WebGL warnings above.
3. The room walk on a 1x display came back, then stopped on "depth attachment
   3200x1800 does not match 1600x900". The walk camera's effect cleanup had
   restored its mount ratio on the lost renderer, and r186 resizes the canvas
   element itself. This was reproduced before the fix (run13), and is now fixed:
   a renderer that is no longer current cannot resize.
4. A replacement lost, or failing, while it started took a planner holding work
   to "couldn't start". It is now one failed attempt.
5. The cover lifted before the first new frame (see above).

An independent review (TypeScript reviewer, Opus at xhigh) found items 3 and 4
and a hidden-page remount, which is also fixed. It also corrected one claim of
mine: PMREM is cached per renderer in r186, so no rebuild marking is needed.

## Limits

- Desktop Chromium on one GPU. iOS Safari and Android Chrome, where most real
  losses happen (backgrounding under memory pressure), are the device day's
  ([script](../plan/device-day-2026-10-28-graphics-reset.md)).
- A context never handed back costs a remount: the planner keeps its layout and
  selection but re-streams the capture; the tour keeps its viewpoint but not its
  look direction.
- After the room reappears, the page is busy for another 2.4–2.9 s on this
  machine while the new device compiles the rest of its pipelines; on a phone,
  longer. This is a first load's cost, not a new one.
- The Grand Hall's 2 mm wall detail (`hall-detail.ts`) is empty after a swap
  until its tiles re-stream; the fix is named to the planner lane.
- Unit and component tests simulate the browser APIs; only this harness and the
  device day exercise them for real. Production holds splats on product hosts,
  so the room walk can only be checked on a preview build.

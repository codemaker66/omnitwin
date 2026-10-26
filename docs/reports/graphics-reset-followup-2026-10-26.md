# Graphics reset, follow-up: GPU errors, the 2D way on, and an honest cover (26 October 2026)

Lane L3c, stacked on PR #171. It answers planner-qol's change request
(`D:/claude/planner-qol-20261026/backlog/CR-L3c-full.md`): F-X1, F-05 and F-03.
Everything here was measured in Chromium (Playwright, `--enable-unsafe-webgpu`)
on the RTX 4090 machine against the development server, with
`packages/web/scripts/graphics-reset.mjs`. The furnished Grand Hall planner has
12 tables, 120 chairs and the 6.03 M-splat capture. Raw reports, frames and CPU
profiles are in `D:/claude/l3c-graphics-reset/followup/`.

## What changed

- **F-X1, uncaptured GPU errors.** A WebGPU validation, out-of-memory or
  internal error no longer stops the 3D view: the view reports it once and
  keeps drawing. It counts as broken only when 3 s pass with no frame getting
  through. It then gets one fresh device, and if the same errors follow it
  there, the stopped card. The app's own failures (a dead resident sort, a
  thrown readiness callback) still stop at once (`lib/native-gpu-error-watch.ts`).
- **F-05, the way on in 2D.** The stopped and couldn't-start cards offer
  "Continue in 2D". It switches the editor's own view mode, at the same address
  and without a reload. The `/blueprint` link that opened a demonstration plan
  is gone. Outside the editor the view promises no layout. The planner's
  arrival steps aside when the view cannot draw.
- **F-03, the cover.** The cover is the stage the person was looking at: the
  dark stage (#120e0b) over a captured room, otherwise the scene's own ground.
  After a swap it now stays until the new device draws the capture again, or
  until the capture can no longer come.

## Measured

| Case | Outcome |
|---|---|
| No WebGPU, no WebGL (`--backend none`) | "The 3D view couldn't start. Try again, or continue in 2D." Continue in 2D: same address, no reload, the 2D plan shows the same 12 rounds and 120 seats. Before `onUnavailable`, the arrival's "Opening…" sat over the card indefinitely. |
| Device destroyed, eye-level walk in the capture (desktop) | Cover dark (rgb 18, 14, 11) from 0.08 s to 5.77 s; it lifted 21 ms after the new renderer drew the capture (5.75 s). Scene, camera, cockpit and walk kept; same pose within 0.83 levels; orbit median 4.2 ms after. Every profiled long task is under the cover. |
| Same, before the cover waited for the capture | Cover gone at 2.67 s, then long tasks of 4.2 s and 0.4 s with the room drawn but its capture missing. |
| Device destroyed, planner as it opens (phone profile) | Cover dark from 0.03 s to 6.46 s, capture back at 6.44 s; long tasks 2.0 s, 0.1 s, 3.6 s and 0.26 s, all before the cover lifted. No long task over 200 ms after it. Frames before and after are the same view (no cream frame). |
| An uncaptured error inside every frame (planner, capture; measured on `5f0e9408`, before the cover waited for the capture) | One warning, drawing on; the cover at 3.08 s (the grace), the room back on a fresh device at 4.43 s; the same errors there, so the stopped card at 11.0 s; Continue in 2D: same address, no reload, the same 12 rounds. No page errors. |
| One uncaptured error inside a frame | Not yet run in the browser: the machine's commit charge stayed above the 85 % limit after this report was written. Covered by the unit tests (one warning, status ready, a frame asked for). |

## Where the restore time goes (CPU profile, walk, desktop)

1. **The first frame, 0.6–2.3 s:** Three creates bindings and uploads textures
   for the new device, inside TRAA's beauty pass.
2. **The capture's snapshot, 1.4–2.1 s:** `NativeSplatScene.createSnapshot`,
   of which `mergeNativeSplatSources` is 1.2–1.8 s. That is
   `setFromBufferAttribute` 0.8–1.0 s, `computeBoundingSphere` 0.55–0.73 s and
   `computeBoundingBox` 0.4–0.5 s over 6 M points.
3. **The sort and SH, 1.3–2.2 s:** `GaussianSplat.updateSort` bounds the same
   points again (1.0–1.2 s), and `updateSphericalHarmonics` takes 0.35 s.

Items 2 and 3 do not depend on the device. A swap throws away the merged
geometry and its bounds, and the rebuild redoes them. Keeping them across a
swap would save about 2.5 s here and more on a phone. That belongs to lane P's
precompile and rebuild work (F-01); the evidence went to P on 26 October. This
corrects the 25 October report, which inferred the second task was pipeline
compilation.

## How WebGPU errors reach a page (probes in `D:/claude/l3c-graphics-reset/probe/`)

- An idle device delivers no `uncapturederror` at all: 0 events in 4 s from an
  invalid buffer every 16 ms. Errors are delivered when the device is ticked,
  for example by a submit: 188 of 188 with a submit per tick.
- An empty `queue.submit([])` after the error delivers it within 0–1 ms (three
  repeats). Without the submit, it never arrived in 2 s.
- Chrome keeps dispatching past its console cap ("too many warnings"): 313 of 313.

So a broken scene's errors arrive with its own frames, which is what the watch
assumes. The device-day drill (`?graphicsReset=<s>:error`) submits after its
invalid buffer. The harness makes its errors inside `render()`, because
`setInterval` errors on an idle planner were not delivered and looked healthy.

## Independent review (TypeScript reviewer, Opus at xhigh)

It found no HIGH issues; four MEDIUM and three LOW, all now fixed with a test
for each:

- **A hidden page could break a healthy view.** No frames draw while the page
  is hidden, but the grace ran on the clock. The grace now waits while the
  page is hidden.
- **A healthy frame was timed from the CPU submit.** A busy GPU returning a
  frame's error late could have made a broken frame look healthy. A frame now
  counts once its own GPU work has completed (a ticket asked for only while
  errors are being judged).
- **A replacement stayed marked for life, whatever the error.** The stopped
  card now needs the same error on the replacement within a minute; anything
  else gets the usual recovery.
- **The arrival could open over the stopped card.** A first save made a new
  arrival key. PlannerScene now holds `canvasUnavailable` (set by
  `onUnavailable`, cleared when a renderer starts) and keeps the arrival off
  while it is set.
- **A second loss during the capture wait** lost the capture and the dark
  stage. Both are kept now.
- **A capture whose rebuild failed** held the cover for 15 s. The wait ends
  once the capture can no longer come (`capturePending`).
- **The capture timer** is now cleared on unmount.

## Tests

- The watch (13): hidden page, late errors, aborted work.
- NativeCanvas (46): persistent-error swap and stop, a different error's recovery, app failures, the cover tones, the capture wait, its bound and a second loss during it, Continue in 2D, no promise without a layout, `onUnavailable`.
- PlannerCanvasBoundary (4).
- PlannerScene: the arrival kept off while the view cannot draw, under a new key too.
- EditorPage: Continue in 2D at the same pathname, with the same objects array.
- The drill: `:error` with its submit.
- `NativeSplatScene.capturePending`: rebuilt, failed, nothing selected.

The affected suites: 64 files, 1,154 passed; typecheck (src and e2e) and lint clean, run through `heavy-hold.sh`.

## Limits

- Desktop Chromium, with the phone profile emulated on the RTX 4090 machine. A
  real phone's CPU is slower, so its cover lasts longer; after 15 s the cover
  lifts even if the capture is still coming back. The device day measures it.
- The out-of-memory case (a governor rung, releasing hall-detail tiles) is not
  done; it is lane P's or the planner's.
- F-07's Sentry warning is lane P's. The hook point is the one deduplicated
  `console.warn` in `NativeCanvas`.
- The "Loading captured room · 0 of 12 chunks" pill stays up when the view
  cannot start. It belongs to the planner lane and has been passed to it.

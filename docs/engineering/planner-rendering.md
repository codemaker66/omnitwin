# The planner's rendering

How the planner draws a frame, what each class of device gets, and how it keeps
shader compilation out of clicks, drags and orbits. The room itself is described
in [the Grand Hall model](grand-hall-model.md); the furniture in
[crafted furniture](crafted-furniture.md).

## A frame

`PlannerScene` mounts `PlannerRenderPipeline` (`components/scene/`), which builds a
three.js node pipeline and registers it with the canvas as its frame composer
(`lib/native-frame-composer.ts`). `NativeCanvas` then calls the composer in place of
its plain draw, inside the same pacing, profiling and failure handling; releasing
it restores the plain draw. The pipeline:

    scene pass (output, normal + occlusion weight, velocity)
      -> ambient occlusion (GTAO) -> temporal anti-aliasing (TRAA)
      -> bloom -> white balance and saturation -> vignette -> tone mapping

The mood sets the grade (`lib/scene-grade.ts`: per-channel gains relative to the
scan's daylight, which stays neutral) and the candles' level (`lib/event-light.ts`).
Under the planner's on-demand loop, temporal anti-aliasing draws a few more frames
after the last change, so a still view converges to a supersampled image and the
loop then goes idle. The pipeline stands aside only while a captured room is
actually drawn (a chunk has arrived): captures carry their own camera response.
A capture still loading, or held and then failing as production's does, keeps it.

## Devices

`lib/render-quality.ts` picks one profile per page, from the pointer and the
screen's shorter side (`?render=phone|tablet|desktop|off` in development):

| Profile | Density | Anti-aliasing | Occlusion | Bloom | Converges |
| --- | --- | --- | --- | --- | --- |
| phone | at most 2x within 2.2 MP | 4x MSAA in the scene pass | furniture's own contact shadows | yes | no |
| tablet | at most 2x within 3.2 MP | FXAA after tone mapping | GTAO at half resolution, 8 samples | yes | no |
| desktop | at most 2x | TRAA | GTAO at half resolution, 12 samples | yes | 16 frames |

Density never changes with camera motion. A pass whose depth another pass reads
is never multisampled (the tests pin this). On the RTX 4090, through the lab:
0.18-0.24 ms of GPU time per frame on the phone profile and 0.75-1.04 ms on the
desktop profile at 3200x1800, with 88-180 guests. No phone or tablet has been
measured yet.

## Holding the frame rate

A profile is a starting point; `RenderGovernor` (`components/scene/`) gives up
quality, a rung at a time, on a device that cannot hold its frame rate. It follows
the governor in Ryan Sael's "Set the Mood" (sael.net/interior), adapted with his
permission: frames are judged in windows of about 1.6 s, the first three warm up,
two slow windows in a row give up one rung, and nothing is given back during a
visit, so the view never pumps between two looks (`lib/render-governor.ts`).

The planner draws on demand, which changes what a frame is:

- **Draws, not updates.** `NativeCanvas`'s pacer holds a draw back while the GPU's
  backlog is full, so frame updates can outnumber the frames a viewer sees. The
  governor times the main view's draws (`lib/main-draw-clock.ts`).
- **Only frames the device paced.** A draw counts when the camera is being moved,
  when the loop ran straight on (springs, damping, transitions) or when the GPU
  held a frame back. A frame drawn for a single change, a chunk arriving, waited
  on that change. Intervals over 250 ms are gaps, and a window is judged on its
  fastest 80% of frames, so a pause in a drag cannot decide it.
- **Slow against the display.** Under 90% of the display's own rate (at most 60),
  read from idle animation frames: a phone held at 30 Hz in Low Power Mode keeps
  its quality.
- **What held the frames up.** The main thread's frame work between draws (every
  update, drawn or held back) over the frame time. Half or more means the CPU:
  0.66-0.84 on the phone profile with its CPU slowed 6x, 0.07-0.1 with the GPU
  holding frames up.

A device held up by its GPU gives up ambient occlusion, then resolution in quarter
steps to 1.5x, bloom, then resolution to 1x; one held up by its CPU gives up bloom
and ambient occlusion, each a chain of passes to encode, and keeps its pixels,
which cost the CPU nothing (`nextQualityRung`, `lib/render-quality.ts`). Each step
is judged on the two windows after one left to settle, and two steps in a row
gaining under 8% end the stepping. `?governor=off` measures without giving
anything up (development builds); the profiler's Copy report carries what was
given up and measured.

**When a step lands.** A resolution step only resizes the canvas (12-33 ms on
this PC) and applies at once. An effect rebuilds the pipeline, whose passes
compile again: 0.2-0.6 s for bloom on the RTX 4090, longer on a phone. So an
effect waits until no hand is on the view (no pointer down on the canvas, no
camera gesture, no wheel turned in the last 0.3 s), then applies once the view
has been still for 0.4 s or 1.2 s after the hand left, while the camera settles
by itself; after 20 s it applies regardless (`rebuildDue`). Frames are not judged
while it waits. The scene pass keeps writing normals once ambient occlusion goes
(`sceneNormals`): the scene's every material compiles per set of pass targets,
and changing them took 2.9 s, keeping them 0.5 s. Multisampling is never given
up: another sample count recompiles every material, and edges without it shimmer.

`packages/web/scripts/planner-governor.mjs` orbits the phone profile with one
finger against a development server (12 tables of 10, this PC), in 6 s strokes
with 1.5 s rests by default; its last column names an effect waiting for the
hand to leave:

| Emulated phone | Before | Governor | After |
| --- | --- | --- | --- |
| Full speed | about 240 frames a second (the headless display) | nothing given up | same |
| CPU slowed 6x | 18-41 a second, frame work 0.77-0.84 | bloom, then stops | 33-62 a second at 2x with multisampling |
| GPU held by another page's compute | about 29 a second, frame work 0.08 | resolution to 1.5x, then stops | about 29: the other page sets the pace, so neither step gained |

Bloom's mip chain was nearly half a slowed phone's render: the frame work fell
from about 27 to 15 ms a draw without it. In strokes, the slowed phone chose
bloom mid-stroke, kept drawing it until the rest, and then held 54-70 frames a
second. The GPU case shows the stop working; on a phone filling its own pixels
a resolution step gains and the governor continues while frames are slow. A
desktop at 2560x1440 and 2x under the same compute drew 23.5 frames a second at
2x and about 73 at 1x; there it chose ambient occlusion mid-stroke and applied
it in the next rest, then a resolution step at once (neither gained: under
contention the frame time moves in the other page's steps, not smoothly).

## Compiling once

A shader compiled mid-gesture is the planner's worst stall: grabbing a table took
698 ms in the production build before this work. Three causes, each fixed:

- **Clipping per material.** `lib/native-material-clipping.ts` gives the section
  plane to the native renderer through clipping groups. Three keys compiled
  pipelines on the clipping context, so a group per material made every clipped
  material (outlines, name plates, constraint marks) compile its own. One group
  now serves every material sharing a plane array and policy.
- **Pipelines forgotten.** Three drops a compiled pipeline once nothing drawn
  uses it, so an overlay that unmounts and returns (the circulation line after
  every orbit, an outline after every deselect) compiled again.
  `lib/pipeline-retention.ts` keeps every pipeline and shader program for the
  renderer's life, through three's internal release hooks (r186); its test runs
  three's own `Pipelines` cache, so an upgrade that changes the contract fails.
- **First use.** `PlannerWarmup` draws a vanishingly small copy of each on-demand
  overlay (outline, ring and fill, name plate and dot, marquee, dashed guide, end
  dot) through the pass that will draw the real one, again whenever that pass is
  rebuilt, and keeps them mounted but hidden. Hidden chandeliers and unlit candles
  warm the same way. Shaders compile per render target, so the canvas precompile
  stands aside while a composer draws, and the composer registers in a layout
  effect, before any frame could draw plainly.

What still compiles: each new kind of furniture on its first placement, and the
room's materials once on load (the longest load task was 0.6 s on the 4090: the
reflection capture, the pass and post-processing). In a development trace the
furniture drawn before the room's own reflections arrive also rebuilt once
when they replaced the stand-in.

## Grounding and candlelight

`FurnitureContactShadows` draws one instanced soft shadow under every piece, a
rounded-rectangle distance field sized by category, beneath the screen-space
occlusion (phones rely on it alone). `TableCandles` sets three candles on each
dining table, with light pools on the linen and the floor, lit only in the
Evening and Candlelight moods. It is presentation: nothing is saved, and Blake
has not yet accepted it as a design addition.

## Measuring

Both scripts drive headless Chromium with WebGPU on this machine's GPU and write
outside the repository.

- `packages/web/scripts/planner-lab.mjs`: the lab (`/dev/planner-lab`, development
  builds) at named poses and moods, with frame and GPU timings per profile.
- `packages/web/scripts/planner-tour.mjs`: the real `/plan` route with a furnished
  layout and fixture API answers; it orbits, zooms, sweeps a marquee and drags a
  table, records frame intervals and long tasks, and lists every pipeline compiled
  after the planner settles, naming the scene objects drawing it in a development
  build. Run it against a `vite preview` of a build for production numbers
  (`--drag-at` with the point a development run prints). `--cpu-throttle 4`
  slows the main thread as on a mid-range phone; the GPU is not slowed.
- `packages/web/scripts/planner-governor.mjs`: the frame-rate governor on the phone
  profile during a one-finger orbit (above), with `--cpu-throttle` and
  `--gpu-load` to emulate a phone held up by either side.

Production build, desktop profile, this tour: table drag worst frame 17 ms with
none over 20 ms (698 ms before), marquee 23 ms (33 ms), no long task while
interacting (five before), 61 pipelines compiled while loading (84).

On a real device, add `?profiler=1` to the page (production included). A narrow
screen opens it as a strip below the top bar (frames a second, the p95 frame
time, and whether the CPU or the GPU sets the pace) so the planner stays usable
while it measures; a tap shows all twelve figures and Copy report. Frames a
second counts idle time, as the planner renders on demand: read the p95 while
orbiting or dragging, where under 16.7 ms holds 60 frames a second.

## Pressing

A press picks what lies under it through `intersectSelectable`
(`lib/raycast-gate.ts`): three's own recursive raycast, except that it never
enters a subtree flagged `SELECTION_PICK_IGNORED`. Three tests a mesh's
triangles one by one, and the pick only answers to furniture and keyed walls, so
the drawn hall's root carries the flag; the measuring tools still raycast its
real surfaces. On the phone profile a press cost 15.2 ms of raycasting, 13 of
them on the hall's walls, dome, ceiling and floor, and now costs 2.1 ms.

Phone profile, production build, CPU slowed 4x, three interleaved runs each
(this PC, other sessions running): the worst frame of a table drag fell from a
median 44.6 ms to 22.1 ms and of a marquee from 43.5 ms to 22.7 ms. What is left
is the steady cost of a rendered frame, about 22 ms at 4x (5.5 ms at full speed),
mostly three's per-pass render work and submission; orbit and zoom stay under
7 ms. The demo layout draws 22 objects: 17 for the hall (74k triangles) and 5
instanced furniture meshes (504 instances, 1.06 million triangles, the chairs
7.6k each). A phone's GPU time has not been measured; if it proves the limit,
the crafted builders' segment counts (`crafted-geometry.ts`) are the lever for a
lighter phone tier.

A finger on the canvas, with the selection tools idle, belongs to the camera: a
tap selects what it lands on, and past the drag threshold the drag is the
camera's until the next first finger, and a second finger makes it a pinch
(`SelectionSystem`'s touch gesture). Until 11 October the drag fell through to
the mouse path at its second move and drew a selection box behind every orbit,
selecting the furniture it swept and re-rendering the furniture, the dock and
the panels each frame: 30% of a 6x-slowed main thread went to React while
orbiting. An orbit now changes no store, and the same slowed orbit draws 17-39
frames a second where it updated 9-24 times a second.

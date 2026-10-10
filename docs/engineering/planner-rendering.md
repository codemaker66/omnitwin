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
  (`--drag-at` with the point a development run prints).

Production build, desktop profile, this tour: table drag worst frame 17 ms with
none over 20 ms (698 ms before), marquee 23 ms (33 ms), no long task while
interacting (five before), 61 pipelines compiled while loading (84).

# The Grand Hall planner, rebuilt for looks and speed (T-652, 10 October 2026)

Blake, 10 October 2026, on the planner (screenshot of the live planner attached): "it is laggy and
looks terrible, the assets look terrible, animation is terrible, lighting is terrible … make it even
more impressive … 60fps on the average phone someone in a major western city would have, AAA+ game
quality". References: sael.net/interior as the minimum bar, two concept renders of a dark, candlelit
hall as the floor of the quality wanted, the 2010 second-floor plan, the 11 July 2026 panoramas, and
the planner's own arrival photograph of the hall dressed for a wedding at night.

## What the cloud session left, judged on a real GPU

Branch `claude/grand-hall-planner-redesign-ax7kgh` (PR #60) was only ever rendered in a software
rasteriser. On WebGPU on the RTX 4090:

- **Kept.** The measured hall (`hall-spec.ts`), the walls' scanned relief, and the wall, ceiling and
  dome atlases projected from the panoramas: real data, recognisably the room.
- **Broken.** The planner did not start on WebGPU: the photographs' 1×1 placeholders were nearest
  filtered, so the node builder bound them without a sampler while the wall material sampled them
  with a mip bias (WGSL compile error). Fixed (`hall-photos.ts`).
- **Replaced or rebuilt.** The floor photograph (washed out, glare blotches), the per-vertex light
  model, the cut caps (plain brown slabs), the chandeliers (thin stick candelabra; the real ones are
  crystal), the furniture's materials (flat, unshadowed, white linen reading orange), and the absence
  of any post-processing.
- **Measured.** 88 pieces (8 rounds, 80 chairs): about 18 draw calls and 780k triangles a frame, 4 ms
  on the 4090 at 2560×1600. Instancing works; triangle density (7.6k per chair) is the phone risk.

## How the reference does it

sael.net/interior is one 151 KB inline module on stock three.js r183 (WebGL): every mesh and texture
is generated in code (rounded boxes, canvas textures), lit by a hemisphere light and one sun whose
2048 shadow map renders only when something changes, ten cheap lamp lights injected into the
materials, and a pipeline of MSAA, GTAO, half-resolution bloom, a depth-of-field tilt-shift and SMAA
under ACES, with a pixel budget of 2.5 megapixels and an automatic quality step-down. Nothing of it
is copied; the techniques are common practice.

## Decisions

1. **One post-processing pipeline, tiered by device** (`components/scene/PlannerRenderPipeline.tsx`,
   `lib/render-quality.ts`). Desktop: scene pass with normals and motion, half-resolution GTAO, temporal
   anti-aliasing that keeps refining for 16 frames after the last change (a still view converges to a
   supersampled image, then the on-demand loop idles), bloom, vignette. Tablet: GTAO with FXAA. Phone:
   4× MSAA scene pass (resolved on chip by tiled GPUs), bloom and vignette only. The canvas calls the
   pipeline through `lib/native-frame-composer.ts`, inside its existing frame pacing and failure path.
2. **The floor is crafted, not photographed**: oak strips at the measured board width and direction,
   per-board tone and grain, satin varnish reflecting the hall, contact shadows under every piece.
3. **One light for room and furniture.** Moods are mixes of the hall's real sources (windows, the five
   chandeliers, the frieze cove, the dome lamps) and the event's own (candles, uplighters). The room's
   photographs are relit from a path-traced bake of those sources on the hall's own geometry; the
   furniture takes the same light from an environment captured from the hall per mood, one cached
   shadow-casting key light and its contact shadows.
4. **A camera's eye.** White balance per mood (white linen stays white under warm light), a filmic
   curve that keeps lamp highlights from clipping orange, restrained grading.
5. **Phones are a design input, not a fallback.** Budgets for the phone profile with a 160-guest
   layout: at most 150 draw calls, 1.0M triangles in view (furniture detail levels by distance),
   compressed textures, and a measured frame time.

## Order of work

Pipeline (done, first pass) → white balance and curve → floor → contact shadows → furniture
materials → cut sections, base and background → crystal chandeliers → light bake and moods → event
light (candles, uplighters) → camera and placement motion → detail levels, texture compression and
measured phone budgets → review, merge, deploy, live check.

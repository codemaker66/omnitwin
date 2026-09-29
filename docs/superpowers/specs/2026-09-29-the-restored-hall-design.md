# The Restored Hall — design (T-639, 29 September direction)

Status: design approved by Blake on 29 September 2026, section by section through the question form. It builds
on [The Real Hall](2026-09-28-the-real-hall-design.md), whose first slice (I1a) is merged and live behind the hold
(`25921cf6`, PR #36). Proof page: https://claude.ai/artifact/VE4yN7MJiLPsofvvnP3Cxx. Proof files on the build PC:
`D:/claude/real-hall/renovation/{floor,clarity,relight}/`.

## 1. Problem and evidence

After I1a Blake judged the Grand Hall "way too poor" and "ugly". He wants a spectacular showcase with no raw damage:
the same room, renovated, and lit the way the real hall is lit at the real hour. His decisions on 29 September:

- The architecture stays; the hall is restored rather than recaptured.
- The light follows the real weather and time: live Glasgow by default; in the planner, each event's date and time,
  with the forecast up to 14 days ahead and typical weather beyond.
- The approach is the restored hall relit by the real sky: flat surfaces as restored textures, ornament as relit
  splats, one light model for both.

Three proofs, each checked against the hall's own photographs, show the approach works:

- **Floor.** The Arm C floor mosaic was restored as a lighting-neutral albedo on the same 2 mm grid (10,600 by 5,300
  texels). The baked sun patch, window pools and evening-warm south third are removed, 4.9% of the floor is healed from
  matching boards in the same course, and all 1,317 boards and 10 floor sockets are kept. Drawn unlit, the honey oak
  reads flat and yellow against the mahogany, so the floor must be drawn lit.
- **Walls.** A new panorama splat would not beat the XGRIDS scans for someone walking the room: panorama splats look
  sharp only at Matterport stations, and at 40 XGRIDS walking cameras T-631 is 2.7 dB worse than the big model and
  turns the gilded names to glare. Best source per surface: the big model for the gilded names, frieze and
  chandeliers; Bright Walls for the panelling and cream walls; neither for the window glass or the floor.
- **Light.** Relighting the real capture works. Each splat's colour is multiplied by (scenario light ÷ captured light),
  from a light model found in the capture itself. Against Matterport's night photographs the relit night beats the
  capture as served: correlation 0.62 → 0.82 facing the windows (station 45) and 0.78 → 0.88 at the end wall
  (station 43). The capture day had no direct sun. Lamps measure about 2,700 to 2,800 K. Open faults: the night glass
  shows mottled patches, the arch tops draw too dark by day, and sun behind the curtains does not yet make them glow.

## 2. Principles

- The capture stays the truth for geometry and ornament. Only light and damage change.
- One light setting lights everything: splats, the floor, and later the furniture.
- Every change is checked against the hall's own photographs before Blake sees it.
- Visitors never see an error. Anything missing falls back to the hall as captured.
- The public hold stays until Blake lifts it; judging happens on private previews.

## 3. Slices

Approved order. Each slice ships to a preview for Blake to judge and has its own implementation plan. This spec
details R1 and fixes the interfaces R2 to R4 build on.

1. **R1, relit by the hour.** The Grand Hall in the walk view relights live (night with the lamps lit, sunny,
   overcast, any hour) from a preview-only light control. The restored floor is drawn lit by the same light. At night
   the window glass becomes a dark sky panel. Desktop previews first.
2. **R2, the real sky.** Live Glasgow weather and time by default; the planner follows each event's date and time; the
   sky panel becomes a real sky.
3. **R3, every surface at its best.** The two-scan composite (Bright Walls for walls and panelling, the big model for
   names, frieze, dome and chandeliers), the floor's tone and finish chosen with Blake, and an optional desktop gloss
   with reflections.
4. **R4, on every phone.** The light data is compressed per device tier so phones get the same look within their
   splat budget (Blake's 0.5 to 1M figure; the 0.72M level meets it).

## 4. R1 architecture

### 4.1 The light model, built offline

The light model comes from the capture, its LiDAR and the Matterport photographs, as in the proof:

- **Sources.** Nine baked sources: sky light through each of the five windows (`W1`–`W5`), the cove lamp line
  (`cove`), the four end chandeliers (`ch_end`), the centre chandelier (`ch_centre`) and the 14 dome lamps
  (`dome`). Direct sun is not baked; it is computed live (4.3). Light that bounces between the room's surfaces is
  carried separately for each source by a small probe volume (4.2).
- **Window stencils.** For each window, a mask in the window plane of what light can pass: glass, glazing bars,
  curtains and reveals, from the LiDAR and the splats.
- **Captured light.** The mix of the sources, with their fitted weights and colours, that best explains the capture.
  The runtime divides it out.
- **Lamp colour** is measured from unclipped lamp splats against daylight through the glass, not inferred.

### 4.2 The relight package

One package per served splat model, published immutable to R2 beside it
(`splats/trades-hall/grand-hall/relight/v1/`), like the floor skin. It holds:

- For every splat, in served order and for every served level: the nine sources' direct light, a surface normal for
  the sun term, and flags (glass or outside the hall, reachable by the sun, lamp bulb). Values are stored so that the
  round trip is within 1/20 of a stop of the bake; the exact encoding is chosen in the plan and verified by test.
- For every source, a probe volume of the light it contributes after bouncing between the room's surfaces (colour and
  direction), on a coarse grid; bounce light varies slowly.
- The captured light is not stored. The browser rebuilds it from the same values with the fitted capture weights, so
  the captured setting is exactly neutral whatever the quantisation.
- A manifest naming the splat model version it belongs to, the splat count per level, the source list, the encoding,
  the captured-light weights and colours, the lamp colours, the window stencils and their planes, the floor light
  maps, and a checksum for every file. The browser validates it at runtime and refuses a package whose model version
  or counts do not match the splats it has loaded.

### 4.3 In the browser

- **The light setting** holds the date, time and place (for the sun's direction), sun strength and colour, sky
  strength and colour, each lamp group's level and colour (2,700 K by default) and exposure. In R1 it is set by a
  preview-only control with three presets (night with the lamps lit; sunny morning; overcast noon), an hour slider and
  a date.
- **Per-splat multiplier.** When the light setting changes (not every frame), a GPU compute pass writes one RGB
  multiplier per splat: the weighted sources' direct light, the bounce light from the probe volumes and the sun term,
  divided by the captured light rebuilt the same way, clamped to between 1/16 and 8. The splat shader multiplies each
  splat's colour by it, one extra buffer read per splat.
- **Sun term.** Sunlight reaches a splat only through glass. The pass follows the ray from the splat toward the sun to
  each window plane, samples that window's stencil, and weights by the angle to the splat's normal. So sun patches move
  with the hour.
- **The floor** is drawn as the restored albedo (floor skin v2, arm R) times its light: the nine sources baked per
  floor texel at 5 cm, plus the sun term computed per pixel by projecting the window stencils onto the floor plane,
  which gives sun patches sharp edges.
- **Windows.** Splats with the glass flag are hidden, and a sky panel is drawn behind each window plane: a flat
  gradient in R1, dark at night and bright by day.
- **Tone.** Relighting happens in linear light: the capture's colours are linearised, multiplied, and returned to
  display space. A neutral tone map then compresses only the highlights that relighting pushes past the capture's own
  white, with exposure and a 60% white balance toward the light as in the proofs. I1a's rule holds: no film curve is
  added to the capture, so at the captured light the hall looks as it does in I1a.

### 4.4 Units

Each unit has one job and can be tested alone:

- `tools/relight/` (Python): extract, geometry, stencils, sources, fit, bake, verify, publish. It is built from the
  proof's scripts, deterministic for the same inputs, with tests for its pure functions. Outputs go to D:.
- `packages/web/src/lib/relight-package.ts`: manifest schema, fetch and decode (in a worker) to GPU buffers. An absent
  or invalid package returns nothing.
- `packages/web/src/lib/sun.ts`: the sun's direction for a date, time and place (NOAA algorithm).
- `packages/web/src/lib/light-setting.ts` and its store: presets, weights, and the change signal for the compute pass.
- `patches/three@0.186.0.patch`: `GaussianSplat` gains an optional per-splat colour multiplier buffer. Absent means
  identical output to today. The T-640 performance work edits the same patch, so the hook stays small and isolated and
  the two changes are sequenced.
- Floor lighting in the floor-skin path (`lib/floor-skin.ts`, `StageFloor`): arm R albedo, light maps and the projected
  sun term.
- The light control: a preview-only panel in the walk view, never built into venviewer.com.

## 5. Failure behaviour

- A missing, invalid or mismatched relight package: the hall is drawn as captured, with one console warning and no
  visitor-facing error.
- A missing floor skin v2: floor skin v1 as today; a missing v1: no floor, as today.
- Devices below the desktop class, and browsers without WebGPU compute (the WebGL fallback), keep the hall as captured
  until R4.
- Multipliers are clamped, so dim corners of the capture cannot blow out or turn black.
- The light control exists only in preview builds. venviewer.com keeps its hold.

## 6. Verification

- **Unit tests:** manifest schema and decoder, including refusal of mismatched packages; the sun's direction against
  NOAA's published values for Glasgow within 0.1°; weights and clamps; the compute pass against a CPU reference for a
  sample of splats.
- **Photo check**, run by `tools/relight` verify and recorded with the package: the relit hall rendered at the
  Matterport stations and compared with the real photographs must reach, at night, a correlation of at least 0.80 at
  station 45 and 0.85 at station 43, and at every checked station must be no worse than the hall as captured.
- **No change when off:** with no relight package, the renderer's output matches I1a pixel for pixel. With the
  package and the light setting equal to the captured light, it matches I1a within 1/20 of a stop.
- **Speed and loading:** the walk view stays inside the Twin budgets on the build PC, and the required GPU benchmark
  passes. Decoding runs in a worker, and loading adds no main-thread task over 50 ms.
- **The look:** Blake judges the presets and the hour slider on the Vercel preview.

## 7. Interfaces for later slices

- **R2** adds a live source to the light setting: Glasgow's weather (cloud cover and sun) through the API with caching,
  and each event's date and time in the planner (forecast up to 14 days, monthly typical weather beyond). The sky
  panel becomes a real sky. Sun behind the curtains gains transmission through the curtain stencil.
- **R3** runs the same bake on the two-scan composite and adds the floor's chosen tone and finish; gloss reflections
  are a desktop option.
- **R4** compresses the package per device tier without changing the manifest's meaning.

## 8. Risks

- **The shared patch.** T-640 changes the same `GaussianSplat` code. Mitigation: a small, isolated hook, and landing
  the two changes in sequence rather than in parallel.
- **Package size.** 12 bytes per splat before compression (about 72 MB for the 6M splats of the finest level, about
  138 MB across all 24 served tiles, of which a device loads only the levels it draws), plus a few megabytes of probe
  volumes: acceptable on desktop in R1; R4 exists for phones.
- **Sun on splats.** Splats have no exact normals; normals come from the LiDAR geometry, and sun patches on splats stay
  soft. On the floor they are sharp.
- **The proof's open faults.** The glass flag and sky panel address the night glass. The dark arch tops by day are
  investigated in the bake (likely missing light from the arch embrasures). Sun through the curtains waits for R2.
- **The build PC.** C: ran out of space twice on 29 September. Bakes, packages and evidence stay on D:, and GPU work
  takes `gpu.lock`, one job at a time.

## 9. Not in R1

Live weather, the planner's event dates, the two-scan composite, the floor's final tone and finish, reflections,
phones, and furniture lighting. Furniture (I3) will read the same light setting when it lands.

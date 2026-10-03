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
- **Window volumes** (amended 3 October; this was "Window stencils", a mask in the window plane). For each window,
  the occupancy of its embrasure in 3 cm cells (glass, glazing bars, curtains, blinds, sash boxes, shutters and
  reveals, from the LiDAR and the splats), with its outline, glass depth and the opposite facade's horizon, so the
  sun's ray can be marched through it as the proof does.
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
  the captured-light weights and colours, the lamp colours, the window volumes and their frames with each window's
  horizon, the glass transmission table and a table of each window's sunlit glass area over the sun's possible
  directions (amended 3 October; this was "the window stencils and their planes"), the floor light maps, and a
  checksum for every file. The browser validates it at runtime and refuses a package whose model version
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
- **Sun term.** Sunlight reaches a splat only through glass. The pass follows the ray from the splat toward the sun
  into the first window whose opening it enters, marches it through that window's occupancy volume as the proof does
  (1.5 cm steps to just beyond the glass, counting only while the sun stands above that window's horizon), and
  weights by the angle to the splat's normal. Only splats the bake flags as reachable by some real sun are marched,
  and only rays that enter a window's outline (amended 3 October; this was a sample of each window's stencil). So sun
  patches move with the hour.
- **The floor** is drawn as the restored albedo (floor skin v2, arm R) times its light: the nine sources baked per
  floor texel at 5 cm, plus the sun term: on each light change a compute pass marches the same window volumes for
  every 2 cm texel of the floor grid, and the floor reads that sun visibility per pixel, which gives sun patches sharp
  edges (amended 3 October; this was a per-pixel projection of the window stencils onto the floor plane).
- **Windows.** Splats with the glass flag are hidden, and a sky panel is drawn behind each window plane: a flat
  gradient in R1, dark at night and bright by day.
- **Tone.** Relighting happens in linear light: the capture's colours are linearised, multiplied, and returned to
  display space. A neutral tone map then compresses only the highlights that relighting pushes past the capture's own
  white, with exposure and a 60% white balance toward the light as in the proofs. I1a's rule holds: no film curve is
  added to the capture, so at the captured light the hall looks as it does in I1a.

### 4.4 Units

Each unit has one job and can be tested alone:

- `tools/relight/` (Python): extract, geometry, window volumes (amended 3 October; was "stencils"), sources, fit,
  bake, verify, publish. It is built from the
  proof's scripts, deterministic for the same inputs, with tests for its pure functions. Outputs go to D:.
- `packages/web/src/lib/relight-package.ts`: manifest schema, fetch and decode (in a worker) to GPU buffers. An absent
  or invalid package returns nothing.
- `packages/web/src/lib/sun.ts`: the sun's direction for a date, time and place (NOAA algorithm).
- `packages/web/src/lib/light-setting.ts` and its store: presets, weights, and the change signal for the compute pass.
- `patches/three@0.186.0.patch`: `GaussianSplat` gains an optional per-splat colour multiplier buffer. Absent means
  identical output to today. The T-640 performance work edits the same patch, so the hook stays small and isolated and
  the two changes are sequenced.
- Floor lighting in the floor-skin path (`lib/floor-skin.ts`, `StageFloor`): arm R albedo, light maps and the sun
  visibility of the floor's compute pass (amended 3 October; was "the projected sun term").
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
  sample of splats. (Amended 3 October.) The CPU reference marches the window volumes with the bake's own float32
  arithmetic and matches the bake's test vectors. The GPU cannot repeat that rounding exactly (WGSL divides within
  2.5 ULP and may fuse and reassociate), so a splat whose sun ray passes within rounding of a cell boundary or an
  outline may differ; every other splat matches, and so does the floor's sun visibility, read back from the GPU.
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
  panel becomes a real sky. Sun behind the curtains gains transmission through the curtains' occupancy in the window
  volumes (amended 3 October; was "the curtain stencil").
- **R3** runs the same bake on the two-scan composite and adds the floor's chosen tone and finish; gloss reflections
  are a desktop option.
- **R4** compresses the package per device tier without changing the manifest's meaning.

## 8. Risks

- **The shared patch.** T-640 changes the same `GaussianSplat` code. Mitigation: a small, isolated hook, and landing
  the two changes in sequence rather than in parallel.
- **Package size.** 12 bytes per splat before compression (about 72 MB for the 6M splats of the finest level, about
  138 MB across all 24 served tiles, of which a device loads only the levels it draws), plus a few megabytes of probe
  volumes and, amended 3 October, about 0.3 MB of window volumes and sunlit-area tables (the volumes hold 5.47
  million cells, 5.5 MB as bytes and 0.2 MB gzipped): acceptable on desktop in R1; R4 exists for phones.
- **Sun on splats.** Splats have no exact normals; normals come from the LiDAR geometry, and sun patches on splats stay
  soft. On the floor they are sharp. (Amended 3 October.) The window march costs, on each light change, a claim
  test per window for every splat the reach flag marks and up to 147 steps for every ray that enters a window; it
  never runs per frame. The flagged share and the step counts are measured by the bake's sun check
  (`D:/claude/relight/grand-hall/evidence/sun-check.json`) and the pass time in the browser checks. The GPU's
  float32 rounding can differ from the bake's at cell boundaries (see §6).
- **The proof's open faults.** The glass flag and sky panel address the night glass. The dark arch tops by day are
  investigated in the bake (likely missing light from the arch embrasures). Sun through the curtains waits for R2.
- **The build PC.** C: ran out of space twice on 29 September. Bakes, packages and evidence stay on D:, and GPU work
  takes `gpu.lock`, one job at a time.

## 9. Not in R1

Live weather, the planner's event dates, the two-scan composite, the floor's final tone and finish, reflections,
phones, and furniture lighting. Furniture (I3) will read the same light setting when it lands.

## Amendment (3 October): window volumes

Decided by the controller on 30 September and confirmed on 3 October. The approved outcome is unchanged: sun patches
move with the hour and are sharp on the floor.

**The change.** The window stencils (a room-side plane and a glass plane per window, each with a transmittance mask)
are dropped. The bake keeps, for each window, the part of the embrasure's 3 cm occupancy that a sun ray through it
can sample, and the runtime marches the sun's ray through it exactly as the proof's light model does
(`lt.trace_to_windows`, `lt.march`, `lt.horizon_deg` and `lt.sun_direct`): a ray belongs to the first window whose
opening it enters, is marched in 1.5 cm steps to just beyond the glass, is dark beyond 2.2 m of embrasure or unless
it leaves through the glass, and counts while the sun stands above that window's horizon, now interpolated between
whole degrees as the proof does (it was rounded). The splats' "reachable by the sun" flag becomes an analytic,
conservative test over every real sun position instead of a sampled one. The floor's sun is marched by a compute
pass on each light change into a 2 cm grid that the floor reads per pixel, and the sun's bounce reads a baked table
of each window's sunlit glass area over the sun's possible directions, so nothing is marched on the main thread.

**The evidence** (R1a Task 3's debugging, 30 September; `D:/claude/relight/grand-hall/verify/task3-debug/`). Two
planes cannot represent these embrasures, because their occluders sit through the whole depth: curtains about 0.3 m
in (W1 at 0.60 opacity per 3 cm layer at 0.315 m, W5 at 0.50 to 0.55), W3's curtains across the wall face, W5's
lower-sash blind 9 to 11 cm in front of its glass, and sash boxes, linings and shutters 0.1 to 0.7 m in. A shadow
cast from the wrong depth lands tens of centimetres away on the floor. After three real bugs were fixed (the check's
missing horizon gate, the stencils' missing outline, a half-texel sampling offset), every arrangement of planes still
missed the check against the proof's 3D sun march (IoU at least 0.85 and mean |ΔT| at most 0.1). IoU / mean |ΔT| at
the three lit check suns, 31 May 08:00, 21 June 09:00 and 20 March 09:00 UTC:

| Option | 31 May | 21 June 09:00 | 20 March |
|---|---|---|---|
| Two planes, as fixed | 0.56 / 0.40 | 0.49 / 0.45 | 0.45 / 0.51 |
| Two planes, each cell to the nearer plane | 0.67 / 0.31 | 0.61 / 0.34 | 0.65 / 0.33 |
| Two planes, the room-side plane at the occluders' measured depth | 0.68 / 0.31 | 0.60 / 0.37 | 0.60 / 0.36 |
| Two planes, the best placement per window (searched on 44 other suns) | 0.70 / 0.29 | 0.64 / 0.34 | 0.65 / 0.32 |
| Two planes, stencils fitted to the 3D march (87 other suns) | 0.72 / 0.28 | 0.73 / 0.26 | 0.72 / 0.29 |
| Three planes, best placement | 0.74 / 0.25 | 0.68 / 0.29 | 0.73 / 0.25 |
| Eight planes at 8-means depths | 0.80 / 0.18 | 0.73 / 0.24 | 0.81 / 0.18 |
| One plane per 3 cm layer (19 to 31 per window) | 0.91 / 0.08 | 0.87 / 0.12 | 0.89 / 0.10 |
| The proof's march over each window's volume | passes by construction | | |

Even eight planes reach only 0.73 IoU, and one plane per layer still fails 21 June 09:00 on mean |ΔT|. The march
itself is the reference: the proof's march at half its step agrees with itself at IoU 0.95 to 0.96, mean |ΔT| 0.03 to
0.04. Over the whole year (96 suns, 77 with a lit floor) the fixed two-plane model's mean IoU is 0.29. The five
volumes hold 5,472,496 cells: 5.5 MB as bytes, 196,028 bytes gzipped (measured on 3 October from the bake's
occupancy through `windows.volumes_from_occupancy`).

**Sections amended,** each marked "(amended 3 October)": 4.1 (window stencils become window volumes), 4.2 (the
package holds the volumes, their frames, the horizons, the glass table and the sunlit-area table), 4.3 (the sun term
and the floor), 6 (the compute pass against its CPU reference) and 8 (package size and the cost of the sun). The
wording of 4.4 and 7 follows them.

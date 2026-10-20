# The Grand Hall model

The planner draws the Grand Hall as the room surveyed on 11 July 2026, not as a generic shell:
the walls are the scan's measured relief, and every surface wears the scan's own photographs,
relit for the chosen light. Code: `packages/web/src/components/grand-hall/`. Data:
`packages/web/public/rooms/grand-hall/survey-2026-07-11/`, rebuilt from the public scan by
[`tools/grand-hall-survey`](../../tools/grand-hall-survey/README.md), which also lists every
place the photographs were edited rather than measured.

## Where it runs

`PlannerScene` mounts `GrandHallModel` and `HallLightRig` when `useModelledGrandHall()`: the space
is named "Grand Hall" (the same test as the planner's room variant) and its venue is Trades Hall,
read once per venue; another venue's room of that name gets the generic room. The furniture, its
placement and its saved layouts are the planner's own; furniture nameplates now show only over the
items in hand, in every room (`PlacedFurniture.tsx`). `/dev/grand-hall` (`GrandHallLabPage`,
development builds only) shows the room alone, posed through a window bridge for headless review.

## What it draws

- **Walls** (`hall-walls.ts`, `hall-relief.ts`): `walls-relief.bin`, four height-field meshes
  (35,185 triangles) simplified to within 5 mm of the scan, coloured by the wall atlas projected
  along each wall's normal, as the orthophotos were made. Faces the orthophotos see edge-on (the
  sides of doorcases and boards) take a coarser mip, so a single row of texels never streaks. The
  varnished dado and attic panelling are glossy; plaster and frieze are matte. The main door stood
  open in the scan: its closed mahogany leaves are modelled in the relief's 0.3 m recess. Until
  the relief arrives each wall is a flat photograph; the parser rejects a malformed file.
- **Coffered ceiling and dome** (`hall-geometry.ts`, `hall-ceiling.ts`): the measured lattice
  and dome profile, each with its own photograph.
- **Floor** (`hall-floor.ts`): drawn oak strips 73 mm wide, the width measured from the survey's
  floor photograph, in staggered lengths with a tiling grain, lit by the same baked channels.
  Board detail fades with distance so it never shimmers; the photograph is no longer fetched.
  Each row's stagger and length and each board's tones come from three's `hash()`, which reads its
  seed as an unsigned integer (WGSL `u32()`: a negative seed is 0, a fraction is dropped), so every
  row and column index is raised by `FLOOR_SEED_OFFSET` first. Without it the window half (z < 0)
  drew one stagger and one length for nearly every row: rendered on 19 October, 98% of its end
  joints lined up with the next row's against 2% on the door side.
- **Cut walls** (`hall-section.ts`): where the cutaway lowers a wall, its body stands as a solid
  section with a dark cap and a gilt edge on the room side. The hall stands in a plinth that is a
  ring round the floor, never a slab under it: its top lies at the floor's level only outside the
  floor, from the room's planes to the walls' outer faces (it is also the floor of the door
  recesses and the firebox), its outer faces drop 0.42 m, and under the floor's edge only a strip
  2 cm down reaches 5 cm in, so a crack would show slab, not the void. Its inner edge repeats the
  floor's own edge vertices. A slab 1 mm under the oak, as before, lost the depth test at scattered
  pixels (depth24, near 0.1, far 900: a few depth steps per millimetre at 20-30 m), the black specks
  Blake saw while the camera moved. No two surfaces of the hall may share a plane: keep any new one
  centimetres clear of the floor and of the city's caps at y = 0 beyond the cut-out (|x| > 11.2,
  |z| > 5.95).
- **Chandeliers** (`hall-chandeliers.ts`): the five fittings as scanned, gilt scrollwork and
  acanthus on dark bronze stems with white flame bulbs, drawn to the lowest points, reaches and
  bulb heights measured in the panoramas (`HALL_CHANDELIERS`; method in the 10 October session log).
  The four rose fittings are one template copied into place, so all five draw in three calls
  (gilt, bronze, bulbs). The bulbs are bright enough for the pipeline's bloom to halo them. The
  metal takes the room's reflections and a self-light from its bulbs, not the point light that
  stands in for each whole fitting (a few centimetres away, inverse-square falloff burned it
  white). Shown on a walk and in the room view once the camera comes down, never in plan; hidden
  fittings draw tiny for their first frames so their shaders compile on load. Without the
  reflection map the metal's own light is raised, so a software rasteriser does not draw it
  black. In the stand-in reflection environment each fitting's lamps are a bright sphere of
  `glowRadius`. The scan's acanthus is denser and its bulbs rounder than drawn; matching them
  is open.

## Light

The photographs already hold the scan's light: daylight through the windows with the chandeliers
and the frieze uplights on. Each vertex carries four baked channels (`hall-lighting-model.ts`:
occlusion, chandelier, daylight, uplight); a mood (`hall-mood.ts`: Daylight, Evening,
Candlelight) relights a texel by the ratio of the mood's light to the scan's light from the same
channels, so Daylight shows the room exactly as photographed. Glass, marked in the atlas's alpha,
follows the daylight alone, falling to dusk blue and then dark. `HallLightRig` adds what a bake
cannot: real lights for the furniture and highlights in varnish and gilt. The drawn room's
reflections are its own (`hall-capture.ts`): it is captured whole, uncut and with its fittings
lit, whenever a surface or a mood settles, with the bulbs at half brightness so they glint
without filling the reflections' sky beneath the dome fitting. `HallEnvironment` stands in only
while the room is not drawn. The canvas uses Khronos PBR Neutral tone mapping for the
photographed room (`lib/capture-display.ts`), which keeps the photographs' mid-tones, after the
planner's pipeline grades each mood ([planner rendering](planner-rendering.md)).

## The real sky (`?sky=1`)

Behind a device switch while Blake reviews it: `?sky=1` turns it on and is remembered on the
device (`lib/hall-sky-access.ts`); `?sky=0` turns it off. The drawn hall then stands under the true
sky over Glassford Street at the moment the planner shows (`stores/hall-time-store.ts`). A plan
opened for an event (`?eventId`) opens at the event's start, read by the venue's team from the
event and by a client from their shared schedule (`HallOpeningHour.tsx`); any other plan follows
the clock. Presentation only: nothing is saved, and nothing is kept between visits.

- **Sun and moon** (`lib/sky/ephemeris.ts`): Meeus: the sun (ch. 25), the moon (ch. 47,
  truncated), its phase (ch. 48), sidereal time, refraction tapered below the horizon and the
  moon's parallax. The tests hold it to Meeus' worked examples, NREL's SPA and Glasgow's 2026 sun
  and moon tables (sun times within 75 s).
- **Sky** (`lib/sky/sky-palette.ts`, `hall-sky.ts`, `hall-sky-dome.ts`): an art-directed palette
  keyed to the sun's true altitude, with sunlight's colour from its air mass (Rayleigh and aerosol
  extinction); a dome round the camera with the sun's disc and glow, stars, the moon lit from the
  sun's direction and the city's glow. The hall's mood follows the same sun from the scan's
  daylight through golden hour and dusk to night (`hallMoodForSun`, `mixMoodSpec`). `HallSky`
  carries the shown time on a spring, so a chosen hour arrives as the sun sweeping across the
  sky; a jump of more than 36 hours arrives at once.
- **Light and shadow** (`hall-sun.ts`, `HallSunLight.tsx`): one shadow-casting directional light,
  the sun by day and the moon by night. Its map covers the room and 90 m of street toward the sun,
  so the blocks across Glassford Street shade the windows, and is refitted only when the light
  has turned or the furniture has changed (coarsely while the time is dragged). On WebGPU a
  material that samples the shadow map cannot also cast into it, so the hall casts through plain
  stand-ins on layer 9 (`createHallCasterMaterials`); the glass, marked at alpha 128/255 in the
  wall atlas, is left out so the sun falls through it. The photographed surfaces add the sun in
  their own baked units (`sunIrradiance`).
- **Windows** (`hall-site.ts`, `hall-skyline.ts`, `hall-sun-times.ts`): the window wall faces
  101.1° true (from the 2020 LiDAR). Each window's skyline, the elevation of what stands across
  the street from 11° to 191°, was measured from the LiDAR; with the reveals' limits (77° for the
  arches, 66° for the sashes) it decides when sun reaches the floor, the gold bars on the dial.
- **The city** (`hall-context.ts`, `HallContext.tsx`): the Merchant City as an architect's white
  contour model in 3 m bands (69,451 triangles, 1.25 MB,
  `public/rooms/grand-hall/context-2020-lidar/merchant-city-v2.bin`), lit by the same sky with its
  own coarse shadow, aerial haze and a few lit windows at night; it also stands in the hall's sun
  shadow. Built from the Scottish LiDAR Phase 5 DSM (OGL v3, attributed in the model's JSON) by
  `tools/grand-hall-survey/context`, which rebuilds it byte for byte. `?setting=none` leaves the
  hall under the sky alone, for measuring.
- **The dial** (`editor/cockpit/HallSunDial.tsx`): in the hall's Light controls, a popover on a
  desktop and inline in a phone's View sheet. The day is a band of its own sky with the sun's
  real path, ticks at sunrise, noon and sunset (a dragged sun settles on them), the gold floor
  bars, six named moments, a date and Now. To assistive technology it is a slider: arrows move
  five minutes, Shift an hour, the Page keys an hour, Home and End go to sunrise and sunset.
- **Furniture motion** (`lib/furniture-motion.ts`): a carried piece leans back from its travel
  (about 4° at most) and, let go, swings upright and sets its weight down with a small squash; a
  newly placed piece drops in from a hand's width. It pivots on the base and keeps its volume, and
  stays still under reduced motion.

Measured on the RTX 4090 on 16 October: an orbit drew 159 frames a second with the sky and city
against 167 without, and 35 against 38 with the CPU slowed 4x as a phone stand-in (within noise
over three interleaved pairs); dragging the time held 123, and 68-112 slowed. A real phone's GPU
is unmeasured, and one 1 s stall was seen once in a profiled run.

## Views and loading

`HallViewControls` offers Plan, Room and Walk, the three moods and, where the captured room may be
shown, Capture. `hall-view-store` carries the request; `HallViewDirector` glides the camera through
the planner's existing transition (reduced motion respected; the views wait while a saved viewpoint
holds the camera) and Walk uses `InteriorCamera` with the hall's own arrival point. A phone's stage
docks no layer controls, so the dock's View sheet leads with the same choices
(`HallViewSheetControls`): views over lights as two rows of tiles that fit a 320 px screen, a view
closing the sheet as a saved view does and a light leaving it open. On a touch screen one finger
turns the head in Walk and two fingers walk: spreading them steps forward along the heading and
closing them steps back (`pinchStepMetres`: 6 m for a spread across the whole screen, at most 1 m
an event). The cutaway
(`wallCutHeight`) lowers the walls between the camera and the room to the dado rail and, in plan,
cuts every wall at 3.12 m, above the doors. A wall the camera stands behind also stays 0.6 m below
the camera's eye (below the dado rail too for a camera lower than it). A phone opens at eye height
inside the hall, about 6.8 m from the orbit's target, so one finger's orbit crosses the long walls
1-2 m out. There the cut eased from the full height was still above the eye, and the cut wall's
dark body filled the screen (fixed 14 October). Gaussian splats stay off the public site
(`lib/splat-access.ts`), so production shows only the model; where a capture fails to load, Capture
is disabled and Walk uses the model.

The three photographs and the relief stream in after the first frame. `hall-view-store` counts them
and `RoomResolveCaption` reports "Loading the Grand Hall's surfaces · N of 4" through the shared
`Activity` indicator; if one fails, the room is drawn more simply there (a plain colour for a
photograph, flat walls for the relief) and the caption says planning is unaffected. The files are
fetched at a revision (`HALL_SURVEY_REVISION`), raised whenever they are rebuilt in place. The
photographs decode off the main thread (`ImageBitmapLoader`, flipped in the decode, each bitmap
closed with its texture), and the window-light bake samples flat buffers without allocating: on the
RTX 4090's production-build load the main thread's decoding fell from 345 ms to 37 ms and the bake
from about 120 ms to 57 ms.

How much of the finish a device carries is `hall-finish.ts`: phones load the half-size photographs
(0.67 MB instead of 2.06 MB); a software rasteriser, read from the canvas's own WebGL context with
no probe context, also leaves out the reflection map and the chandeliers' lights for a soft fill.

## Checks

- `src/components/grand-hall/__tests__/hall-geometry.test.ts` reads the shipped relief and checks
  it against the room: plaster flat beside the main door, glass deep in every window, the firebox
  behind and the mantel proud of the chimney breast, the door recess, the geometry envelope, and
  rejection of malformed files.
- `src/components/grand-hall/__tests__/hall-section.test.ts` keeps the plinth off the floor:
  nothing under it within 1.5 cm, the band out to the walls' outer faces covered at its level, the
  floor's own edge vertices on its inner edge, everything inside the city's cut-out;
  `hall-floor.test.ts` holds every hash seed above zero and the two halves' end joints alike. The
  rendered proof (the plinth painted magenta never shows through the floor in any orbit, pose or
  profile) is browser evidence, recorded in the [19 October session log](../sessions/2026-10-19.md).
- `src/components/grand-hall/__tests__/hall-chandeliers.test.ts` checks each chandelier's lowest
  point and reach against the survey, its bulbs, that every triangle faces along its normals (the
  metal is single-sided) with none degenerate, that every bulb faces outward, and the triangle
  budget; `mesh-builder.test.ts` covers lathe orientation, pole triangles and translated merges.
- `stores/__tests__/hall-view-store.test.ts`, `lib/__tests__/room-resolve-model.test.ts`,
  `cockpit/__tests__/HallViewControls.test.tsx`, `cockpit/__tests__/RoomResolveCaption.test.tsx`,
  `editor/__tests__/PlannerScene*.test.tsx` and `CameraRig.showcase.test.tsx` cover the views,
  loading caption, capture fallback, device tier and camera glides;
  `editor/__tests__/MobilePlannerChrome.test.tsx` the phone's View sheet, and
  `rooms/__tests__/InteriorCamera.test.tsx` and `interior-camera.test.ts` the pinch walk.
- `grand-hall/__tests__/hall-photos.test.ts` covers the off-thread decode and every bitmap's
  release; `hall-lighting-model.test.ts` holds the allocation-free bake to the original to 12
  decimals over 4000 samples.
- The real sky: `lib/sky/__tests__/ephemeris.test.ts` (Meeus, SPA and Glasgow's 2026 tables) and
  `sky-palette.test.ts`; `grand-hall/__tests__/hall-sky.test.ts` (the light and mood for the
  sun), `hall-sun-times.test.ts` (sun on the floor at the solstices and equinox) and
  `hall-context.test.ts` (the city model's parser, and the published model against its own
  counts); `stores/__tests__/hall-time-store.test.ts` (the opening hour) and
  `cockpit/__tests__/HallSunDial.test.tsx` (keys, drag, snapping, named moments, the moon);
  `lib/__tests__/furniture-motion.test.ts` (the lean, squash and drop-in).
- The rendered room needs browser evidence: `/dev/grand-hall`, `/dev/planner-lab` (with
  `scripts/planner-lab.mjs`) or the planner itself (`scripts/planner-tour.mjs`).

Measured on the RTX 4090 only (see [planner rendering](planner-rendering.md)); frame time on the
declared phones and tablets, and Blake's aesthetic acceptance, are open.

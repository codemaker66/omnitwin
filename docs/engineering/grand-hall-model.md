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
- **Cut walls** (`hall-wall-body.ts`, `hall-section.ts`): every wall has a body as thick as the wall
  (`HALL_WALL_THICKNESS`: the window wall 0.95 m from the 2010 plan, the door wall 1.14 m from the
  scan, the end and fireplace walls 1.21 m from the plan only; `HALL_WALL_STRETCHES`: the door wall's
  corridor face 1.28 m out between the end and main doors, joinery the scan measured where the plan
  draws a recess, and 0.46 and 0.78 m either side of the fireplace door's lobby, from the plan), from
  the floor to the relief's own top (6.70 m), with every window and door open through it. In front,
  back to 2 cm behind the deepest relief in an opening, the hole is the relief's own footprint
  (`OPENING_RELIEF`, measured on `walls-relief.bin`), and the scanned reveals, curtains and closed
  leaves line it; behind, a window's hole is its masonry opening, lined by its outer reveal
  (`hall-glazing.ts`; the body carries it on the last 2.6 cm where the reveal stops short), and a
  doorway is lined in mahogany with an oak threshold 8 mm above the floor's level. The four doors
  are `HALL_DOORS` (depth, leaves, what lies beyond); the fire exit in the fireplace wall (D4) is one
  of them. All four bodies and the four corner blocks are one mesh: the cutaway lowers them in the
  shader (`bodyVertexHeight`), so no object moves when a cut eases, and a top clamped to the cut
  becomes the section. A corner block stands no higher than the lower of its two walls. Once a wall
  is cut to `LINTEL_RELEASE` (3.5 m) or lower, the walling over its doors goes, the relief over each
  doorway with it (`DOOR_SLOTS`, `sectionMask`), so every doorway reads from above, in Plan (3.12 m)
  and at the fire exit, whose head is 5 cm under the dado cut; a wall cut higher keeps its lintels.
  Relief standing in a corner against the neighbouring wall (the doorcases' sides and the radiator
  cases, which each wall's depth map also saw) takes the lower of the two walls' cuts
  (`sharedNeighbour`, `aWallB`). The finish is a preset (`SECTION_PRESETS`, `?section=`, nothing
  remembered): Ashlar by default, pale sandstone outside with no joints (art direction: no
  photograph of the facade gives its coursing), the cut a warm stone core with a lime-plaster line at
  the room edge (mahogany through the dado, oak through the attic) and a fine arris at the outer
  edge, the lines never thinner than 0.75 px; Atelier and Nocturne carry their palettes only. The
  faces are unlit, the mood's light baked into their colour (the cut: the room's ambient, a share of
  its chandeliers and the sky over the lifted ceiling; the outer faces: the sky and a little of the
  room's glow). The hall stands in a plinth that is a ring round the floor, never a slab under it:
  its top lies at the floor's level only outside the floor, out to the walls' outer faces (and a
  centimetre short of the city's cut-out where a wall is thinner than that), so it is the slab under
  the bodies and the floor of the firebox; its outer faces drop 0.42 m, and under the floor's edge
  only a strip 2 cm down reaches 5 cm in, so a crack would show slab, not the void. Its inner edge
  repeats the floor's own edge vertices. A slab 1 mm under the oak, as before, lost the depth test at
  scattered pixels (depth24, near 0.1, far 900: a few depth steps per millimetre at 20-30 m), the
  black specks Blake saw while the camera moved. No two surfaces of the hall may share a plane where
  either shows: keep any new one centimetres clear of the floor and of the city's caps at y = 0
  beyond the cut-out (|x| > 11.2, |z| > 5.95); the ring's top lies on those caps only under the
  bodies, where neither is seen.
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
follows the daylight alone, falling to dusk blue and then dark, wherever the real sky is off and in
the room's own captured reflections; under the real sky it opens onto the drawn city (below).
`HallLightRig` adds what a bake
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
  wall atlas, is left out so the sun falls through it. The atlas smoothed the glazing bars into its
  glass, so the bars cast as the measured geometry below, and the sun's patches on the floor carry
  the sash grid, the round heads and the fanlights' pierced rings. The photographed surfaces add the
  sun in their own baked units (`sunIrradiance`).
- **Windows** (`hall-site.ts`, `hall-skyline.ts`, `hall-sun-times.ts`): the window wall faces
  101.1° true (from the 2020 LiDAR). Each window's skyline, the elevation of what stands across
  the street from 11° to 191°, was measured from the LiDAR; with the reveals' limits (77° for the
  arches, 66° for the sashes) it decides when sun reaches the floor, the gold bars on the dial.
- **Glass** (`hall-glazing.ts`, `HallGlazingUniforms` in `hall-materials.ts`): under the real sky
  the walls' photographs are cut where the atlas marks glass (alpha below 0.75; the window boards
  stay; alpha to coverage on a multisampled phone pass), and the drawn city and sky show through
  real glass. Each window has one pane at the relief's glass plane that reflects the room it looks
  into: the room's captured environment, box-projected onto the room so the chandeliers, portraits
  and curtains stay where they hang as the camera moves, at the Fresnel reflectance of single
  glazing (two faces at 4%, 7.7% head-on) over 97% transmission, premultiplied, so at night the lit
  room mirrors over the dark street as the 11 July panoramas show it. The pane writes no depth and
  leaves the normal and velocity targets alone (the pipeline blends those two by their alpha, which
  every other surface writes as 1), so occlusion and the temporal resolve see the street. `?glass=`
  picks `physical` (default), `clear` (half the reflection) or `lustre` (1.6×); nothing is
  remembered. The glazing bars, the sashes' stiles and rails, the arched windows' round heads and
  their fanlights (radials, a ring pierced every 10°, the centre petal) are painted geometry with the
  room's baked light, measured in the public panoramas (`HALL_GLAZING`,
  `tools/grand-hall-survey/measure/glazing-bars.py`: 2 mm rectified views from four stations per
  window, bars triangulated to within 1.5 cm of the relief's glass, projected back into scan_039's
  and scan_040's panoramas 0.8 and 0.9 cm from where they stand). Outer reveals run from the glass to
  the wall's outer face (painted 6 cm, then stone; their finish is art direction until a photograph
  of the facade gives it): a sash window's hugs its sashes, an arched window's is the whole arch,
  its sashes flanked by side lights behind the columns. While the room's reflections are captured
  the glass closes and the panes hide (`withGlazingClosed`). The 1794 engraved pane in the centre
  arch (its lowest centre pane) is not drawn: a crest and an inscription etched in clear glass, which a
  uniform frost would misstate.
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
cuts every wall at 3.12 m, above the doors' heads, the walling over each door going with it so the
doorways read (Cut walls, above). A wall the camera stands behind also stays 0.6 m below
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
  nothing under it within 1.5 cm, the band out to its edge covered at its level, the floor's own
  edge vertices on its inner edge, its outline flush with the bodies' outer faces, and the section
  presets; `hall-wall-body.test.ts` holds the doors and thicknesses to their sources, each wall's
  outer face whole at its own thickness except through its openings (5 cm grid), the tops flush at
  6.70 m, the cut full thickness in Plan and open over every door, the lintels' and corner blocks'
  rules, the jambs of every hole within 5 mm of the shipped relief's footprint (medians), no relief
  in another wall's body, the corners' shared relief, the 6k-triangle budget, and no two surfaces
  (floor, ring, thresholds, bodies, outer reveals, relief) sharing a plane over more than 1 cm² at
  the whole, Plan and opening view's cuts; `hall-glazing.test.ts` holds the panes at the glass inside each
  opening, every measured bar where it was measured (and the panes between them open), the budgets
  (panes 200, bars 2,500, reveals 1,500 triangles), the reveals from the glass to the outer face,
  the glass presets and the capture's closing and reopening, also when it throws;
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

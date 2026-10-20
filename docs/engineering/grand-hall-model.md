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
- **Cut walls** (`hall-section.ts`): where the cutaway lowers a wall, its body stands as a solid
  section with a dark cap and a gilt edge on the room side, over a plinth round the hall.
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
- **The street at night** (`lib/sky/night-looks.ts`, `hall-street-light.ts`, `HallStreetLights.tsx`):
  after dusk the card turns a dark violet with its skyline brighter than its blocks, so every
  building stands as a silhouette and no lit window floats; Glasgow City Council's street lamps
  lay amber pools on the ground each stands on, a warm scallop where each lantern's full cut-off
  cone meets its wall, a halo on each lantern and, on screens larger than a phone, a cone of light
  under it. Positions only from the council's open Lighting Columns layer (OGL v3,
  `tools/grand-hall-survey/context/street-lamps-ogl-2026-10-18.json`, `fetch_street_lamps.py`);
  nothing from its unlicensed `Pub_Lighting_Columns` layer is shipped. `bake_street_light.py`
  derives the rest from our own model: wall bracket or column (in or within 2.5 m of a drawn
  building wall), snapped to the drawn wall and 0.85 m out, 8 m over the pavement (Trades Hall's
  own lamp sits level with its first-floor arches in our façade photograph), columns at the LiDAR
  spike height where the DSM resolves one within an arm's reach (1.5 m) of the council's point;
  Trades Hall's two door lanterns from the façade survey. A fitting the model cannot carry is not
  drawn and keeps its light: the five the hall's section cuts away, and one bracket (8463) whose
  wall the 3 m bands drew too low to hang a lantern 4 m up. It writes `street-lamps-v2.json` and
  two 512² RGBA8 light maps (`street-light-v2.bin`, asinh-warped, about 0.5 m a texel at the
  hall): a pool map read filtered (pool distance, that pool's lamp's switching altitude and foot,
  its strength) and a head map read texel by texel (the nearest visible head and its switching
  altitude), so the city's shader reads one filtered and one exact texel and loops over no lamps;
  pools light only their own lamp's ground, never a roof. `--check` rebuilds it byte for byte and
  checks the bake. Each lamp lights at its own sun altitude between −3.6° and −2.4°, its pool,
  scallop, lens, halo and cone together; the city's night (ambient, windows, haze, the sky's glow)
  follows the hall's Dusk-to-Night span, −3° to −10°, and after sunset the air clears (the golden
  hour's thick haze thins by 4° down). Before the night's light comes, dusk darkens the card
  against the still-bright sky from −1.5° to −4.5° (Evocative: walls to 0.36 of the day's sky
  light, roofs and ground 0.52, the air between the blocks 0.62), so at 18:30 the blocks stand as
  silhouettes and the hall stays brighter than the street. Over a lit city the night sky levels off
  after nautical twilight, so each look's −12° keyframe is about 15% lighter than its −18° night,
  never darker. A street lantern's lens dims seen side-on (its optic is full cut-off), so a far
  lantern is a warm line under its halo, not a one-pixel dash the anti-aliasing cannot hold. Four looks (Subtle, Evocative shown, Noir, True to street at
  3000 K) are uniforms only; a development build takes `?street=` (and `off`, close to the night
  before the lamps; at dusk its glow follows today's span, so compare dusk against the commit
  itself). Credited on the dial and the legal page.
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

The street at night, measured on the same RTX 4090 on 20 October against the commit before it
(`b2d657f0`), at 21:30 on 18 October 2026 with the wedding layout (`perf-ab.mjs`: GPU timestamps
round every render pass over 90 frames, three interleaved rounds, the same three poses; the city
only draws under `?sky=1`). By night the frame's GPU time rose 12-33% on the phone profile (a
phone's viewport and user agent, so no cones: wide orbit 0.276 against 0.228 ms, the view across
Glassford Street 0.149 against 0.112, the street side 0.273 against 0.243) and 13-17% on desktop
(1.17 against 1.03 ms; 1.17 against 1.00; 1.13 against 1.00). `?street=off`, the same shader with
the lamps at zero, costs the same as the lamps on, so the cost is the city's shader, not the
fittings or halos. In separate runs on the phone profile, the shader without the lamps' light cost
2-13% (most at the view across the street, which the city fills), and with the pool map at
anisotropy 1 rather than 8, 7-27%. By day the shader skips the windows and lamps
(a branch on the sun's altitude, uniform for every fragment), and at noon the frame is level with
the commit before it (-2% to +2%). On the 4090 these frames take a tenth to a quarter of a
millisecond, so the shares say more than the times; a real phone's GPU is unmeasured, and on a
slow phone the planner's adaptive resolution is what the night would spend. Earlier (19 October,
`perf-night.mjs`, an orbit against `?street=off`): 155, 173 and 161 draws a second against 184, 163
and 180 on desktop. It adds three draws (about 8,500 fitting and 3,700 cone triangles; no cones on
a phone), two 1 MB light maps and one filtered plus one exact texel read in the city's shader, no
lights and no work at rest.

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
  `cockpit/__tests__/HallSunDial.test.tsx` (keys, drag, snapping, named moments, the moon, the
  credits); `lib/__tests__/furniture-motion.test.ts` (the lean, squash and drop-in).
- The street at night: `python tools/grand-hall-survey/context/bake_street_light.py <out> --work
  <_work.npz> --dsm-dir <dsm> --facade facade.json --check` (byte-for-byte rebuild, a test lamp's
  pool offset and stretch, no light behind a wall, the switching lattice, brackets on the model's
  walls, columns on its ground, every drawn lantern at least 4 m up, the cut set {24094, 24096,
  45116, 45117, 45127} and the low-wall set {8463}, 8-bit pool edges within 0.1 m of the float
  bake, every pool and head texel carrying its own lamp's switch and foot; with `--pub <local Pub
  layer copy>`, bracket or column against the council's own types, at least 95 %, and a printed
  note of how near the column heights come to the council's); `grand-hall/__tests__/hall-street-light.test.ts`
  (both parsers' refusals, the warp and the shader's texel-centre estimate, per-lamp switching, the
  published pair against itself as the shader reads it, the fittings the model cannot carry, the
  fittings' faces, budget and lens frames, the cones' fold point, the halos' own instanced quad),
  `lib/sky/__tests__/night-looks.test.ts` (lens above and halo below the bloom's threshold), the
  night span and violet horizon in `sky-palette.test.ts`, and the lamps arriving (or not, and no
  cones on a phone) in `hall-sun-redraw.test.tsx`.
- The rendered room needs browser evidence: `/dev/grand-hall`, `/dev/planner-lab` (with
  `scripts/planner-lab.mjs`) or the planner itself (`scripts/planner-tour.mjs`).

Measured on the RTX 4090 only (see [planner rendering](planner-rendering.md)); frame time on the
declared phones and tablets, and Blake's aesthetic acceptance, are open.

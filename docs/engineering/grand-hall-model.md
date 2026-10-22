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
  along each wall's normal, as the orthophotos were made. Since survey revision 5 the atlas takes
  each 40 mm block from the one panorama that photographed it most sharply, with glare and occluders
  set aside, its seams levelled and feathered (`tools/grand-hall-survey/label-views.py`,
  `project-walls.py --labels`; the survey README's "How a texel gets its colour"). The earlier blend
  of every station doubled the deacon boards' lettering and hazed the portraits; the runtime and the
  atlas's dimensions and glass alpha did not change. Faces the orthophotos see edge-on (the
  sides of doorcases and boards) take a coarser mip, so a single row of texels never streaks. The
  varnished dado and attic panelling are glossy; plaster and frieze are matte. What the modelled
  doors replace is cut out of the relief along the doorway's own lines (`drawnRelief`, clipping
  triangles, never dropping them whole: whole triangles left chinks beside the jambs through which
  a walk saw the night through the wall): inside each doorway's clear outline, up to just over its
  leaves' top and no more than 6 cm in front of them (`leafColumn`), the closed leaves the atlas
  photographed and their hardware; and between the jambs, under the head, whatever lies more than
  5 mm behind the leaves' face (`doorwayBehind`: the joint at a shut leaf's edge, the main door's
  recess, closed where the scan saw it open). The reveal's sides at the jambs, the doorcases' heads
  hanging 8 cm and more in front of the leaves' tops, and the fire exit's sign stay, so a walk sees
  the photograph round each door as before. Until the relief arrives each wall is a flat
  photograph, open at its doors; the parser rejects a malformed file.
- **Wall detail** (`hall-detail.ts`, `hall-detail-decode.ts`, `hall-detail.worker.ts`): where the
  camera comes close, the walls sharpen to 2 mm a texel, the same best-view photograph as the atlas
  (`project-detail.py`, `pack-detail.py`; within 0.3 mm of the atlas's registration). It is published
  as 462 tiles of 512 x 512 texels, 0.992 m of wall each inside an 8-texel gutter that repeats the
  neighbours' texels, so bilinear filtering and mip levels up to 3 never read past a tile (8.8 MB in
  all, `detail/index.json` with each tile's bytes and SHA-256; a tile all of window glass would be
  left out, and at this pitch none is). Each frame the layer picks the tiles worth having: in view,
  on a wall the camera stands in front of, starting below that wall's cut, and drawn at 0.19 screen
  pixels a millimetre or more at their nearest point (where a pixel holds less than one of the 4096
  atlas's texels), most magnified first, at most the device's slots. While the camera is still or
  slow (under 1.5 m/s and 45 degrees/s) it fetches the missing ones, four at a time; a worker decodes
  each WebP and builds its four mip levels in linear light, and the main thread copies at most two a
  frame (one once 4 ms of the frame has gone on copies) into one array texture through a staging
  tile; the buffers go back to the worker for its next tiles. The array is made when the first tile
  arrives (until then the shader reads a one-texel stand-in), with a slot a tile: 64 on a computer
  (90.5 MB on the GPU with the staging tile and index), 32 on a tablet (46 MB), 16 on a phone
  (23.7 MB), none on a software rasteriser (`hall-finish.ts`); the least recently wanted tile gives up
  its slot, fading out first if it is in view. The walls' shader (`wallTexel`) finds a fragment's tile
  from its atlas coordinate, reads an index texture (slot and fade per wall, column and row) and
  samples the slot with gradients from the wall's continuous coordinates, so a tile's edge keeps its
  level: two texture reads a fragment, no draw calls. A new tile cross-fades over the atlas in about
  200 ms (a thirteenth a frame at most, at once under reduced motion), mixed in a square-root space so
  each step of the fade shows as much change as the next; where a fragment's detail is drawn no
  larger than the device's atlas draws it (the detail's mip level 1.37 on a computer, 2.37 on a
  phone), it gives way to the atlas over three quarters of a level. Never on glass. A tile that fails
  stays on the atlas and is retried after 2, 8 and 32 s; a fetch whose tile has not been wanted for 8
  drawn frames and 300 ms is abandoned, not counted as a failure; a decoder that cannot run (no module
  workers or OffscreenCanvas, iOS Safari before 16.4) leaves the layer off, and one that stops (its
  worker died, or it cannot decode at all) stops the layer rather than fetching every tile again. The
  shader reads the slots' array only where a tile shows (a branch round an explicitly graded sample,
  the gradients taken outside it): everywhere else a wall fragment pays one index texel. The layer
  outlives a change of sky (`useHallDetail`: its worker, tiles and array stay while the materials are
  rebuilt over them, as do the photographs and the beyond's photographs), its one wake timer keeps
  the earliest deadline asked for (`DetailWake`), and it asks whether motion is reduced only when a
  tile arrives or fades. Nothing is shown while tiles arrive: the
  walls simply sharpen, frames being requested only while a tile fades or waits to be copied. At
  Blake's deacon-board pose the boards read 95.7% of their 256 names, trades and years (S4a's atlas
  20%), and from a phone 1.9 m away 91.8% (0% on its half-size atlas); method and the other
  measurements in the [22 October session log](../sessions/2026-10-22.md).
- **The relief's arrival** (`hall-arrival.ts`, `hall-slices.ts`): what the relief makes is built as
  it arrives in slices of about 8 ms, each handing the thread back: the relief as drawn, the walls'
  geometry (a material's typed arrays a step), the section's cap and the slicer's index, each cached
  as it finishes, so the render and its effects find them built. At once that was one task of
  150-250 ms on a desktop CPU and 220-300 ms (with this pass's leaner loops; twice that before) at 4x
  CPU on the phone profile; sliced, no slice over 41 ms there (22 October, long-task trace and the
  slices' own timings, which development builds keep in `window.__venHallArrivalSlices`).
- **Doors** (`hall-doors.ts`): the four doorways' leaves, modelled so they can open: a pair of
  45 mm leaves hung at the hall face in each (their face where the relief has the shut leaves, 1.3
  to 2.9 cm back; the main door's at -0.03 like its twins, no longer -0.27), and the end door's
  single leaf at the Saloon face, hinged on the end wall's side. Rails, stiles and raised and
  fielded panels, the closers and the fire exit's panic bar are measured on the wall atlas at 1 cm
  (the fire exit's leaves have two panels, not three); the Saloon leaf's two-by-two panels and
  lock rail are read from panorama 048. The doors the atlas photographed shut (end, fireplace, fire
  exit) wear that photograph on their hall faces at their closed texels, so a walk sees them as
  photographed (glossy below the dado's top and matte above it, as the relief they replace); the
  main door (open in the scan) and every edge and back are mahogany, its panels' sunk margins
  shaded by a baked occlusion falling 40% at the bottom of the sink (`PANEL_GROOVE_OCCLUSION`; the
  photographs hold their own). Each face plate laps 3 mm behind its jamb and the first leaf of a
  pair over the second, so a shut door shows no slit. When a wall is cut (`cut < DOOR_OPEN_CUT`,
  6.69 m: the near walls in the overview, every wall in Plan) its doors swing 90 degrees outward on
  `SPRING_PRESETS.doorSwing`, into the opening's sides as the plan's swing arcs and panoramas 018
  and 048 show, 6 mm clear of the lining; on a walk they shut. The lapping leaf trails its door by
  12 degrees and catches up at 90 (`leafAngle`), as a pair with an astragal must open, so neither
  leaf passes through the other. The swing is in the vertex shader about each leaf's hinge
  (`aHinge`, `doorLeafPosition`), normals with it, with the last drawn frame's angle as the motion
  vectors' previous position; nothing moves on the CPU, frames are requested only while a door
  moves, and under reduced motion a door is at its target in the frame its target changes. A raycast
  (a tape measure, a pick) meets the leaves where they are drawn (`raycastDoorLeaves`: each triangle
  turned as the shader turns it, what stands above the cut left out). A cut
  below a leaf's top discards what stands above it and lays a section on the leaf at the cut. The
  room's captured reflections and the sun's casters see the doors shut. Four draws (the photograph
  matte and glossy, mahogany, brass; the walls lost the main door's two) and 1.26k triangles.
- **Coffered ceiling and dome** (`hall-geometry.ts`, `hall-ceiling.ts`): the measured lattice
  and dome profile, each with its own photograph.
- **Floor** (`hall-floor.ts`): drawn oak strips 73 mm wide, the width measured from the survey's
  floor photograph, in staggered lengths with a tiling grain, lit by the same baked channels.
  Board detail fades with distance so it never shimmers; the photograph is no longer fetched.
  Each row's stagger and length and each board's tones come from three's `hash()`, which reads its
  seed as an unsigned integer (WGSL `u32()`: a negative seed is 0, a fraction is dropped), so every
  row and column index is raised by `FLOOR_SEED_OFFSET` first. Without it the window half (z < 0)
  drew one stagger and one length for nearly every row: rendered on 19 October, 98% of its end
  joints lined up with the next row's against 2% on the door side. While the chandeliers are put
  away (in Plan, and in the overview from high up) the floor's reflections of them soften
  (roughness to 0.62, eased): sharp, they read as five spotlights on the floor with nothing to cast
  them.
- **Cut walls** (`hall-wall-body.ts`, `hall-section.ts`): every wall has a body as thick as the wall
  (`HALL_WALL_THICKNESS`: the window wall 0.95 m from the 2010 plan, the door wall 1.14 m from the
  scan, the end and fireplace walls 1.21 m from the plan only; `HALL_WALL_STRETCHES`: the door wall's
  corridor face 1.28 m out between the end and main doors, joinery the scan measured where the plan
  draws a recess, and 0.46 and 0.78 m either side of the fireplace door's lobby, from the plan), from
  the floor to the relief's own top (6.70 m), with every window and door open through it. In front,
  the hole is the relief's own footprint (`OPENING_RELIEF`, measured on `walls-relief.bin`), lined
  by the scanned reveals and curtains: in a window back to 2 cm behind its deepest relief; in a
  doorway back to 2 mm behind its leaves' face (`doorRevealDepth` less `DOOR_LINING_SET`; the drawn
  relief stops 5 mm behind it, so the two overlap and an open door shows no slot at its jambs) and
  4 cm wider than the doorway at each jamb and over its head (`DOOR_FRAME`), so a face toward the
  room stands behind every chink the scanned reveal leaves (a walk at each door, straight on and
  1.2 m to either side, meets a surface on every ray: `hall-wall-body.test.ts`; the earlier cut by
  whole triangles let 400 to 2,700 rays a pose through); behind, a window's hole is its masonry
  opening, lined by its outer reveal
  (`hall-glazing.ts`; the body carries it on the last 2.6 cm where the reveal stops short), and a
  doorway is lined in mahogany (the step round its smaller hole too) with an oak threshold 8 mm
  above the floor's level. The four doors
  are `HALL_DOORS` (depth, leaves, what lies beyond); the fire exit in the fireplace wall (D4) is one
  of them. All four bodies and the four corner blocks are one mesh: the cutaway lowers them in the
  shader (`bodyVertexHeight`), so no object moves when a cut eases, and a top clamped to the cut
  becomes the section. A corner block stands no higher than the lower of its two walls. Once a wall
  is cut to `LINTEL_RELEASE` (3.5 m) or lower, the walling over its doors goes, the relief over each
  doorway with it (`DOOR_SLOTS`, `sectionMask`), so every doorway reads from above, in Plan (3.12 m)
  and at the fire exit, whose head is 5 cm under the dado cut; a wall cut higher keeps its lintels.
  Relief standing in a corner against the neighbouring wall (the doorcases' sides and the radiator
  cases, which each wall's depth map also saw) takes the lower of the two walls' cuts
  (`sharedNeighbour`, `aWallB`). In front of the wall's plane the section goes on through the scanned
  relief (`hall-relief-section.ts`): the relief is a height field, so its outline at a cut is a
  profile (how far it stands proud, per centimetre of the wall), cut on the CPU from a bucket index of
  the triangles crossing that height whenever a wall's cut moves a millimetre (0.04-0.16 ms a wall on the desktop CPU),
  kept in one row of a half-float texture, and a strip of quads (the cap) laid in each wall's cut plane
  is clipped to it, so the cut's room edge follows the dado rail, the doorcases, the pilasters, the
  boards and the chimneypiece at any height and from any side; where the relief lies behind the plane
  (the frieze, the attic panelling) the body's top in front of it goes. None in a window's clear outline
  (curtains are cloth) or over a doorway once its lintel has gone. The relief's back faces, the usual
  way to cap a cut, fill it only for a camera beyond the cut wall: from Plan 3-22% of the section's
  pixels (S3b's ray march). Every relief triangle carries `aOpening`, the window or door whose clear
  outline holds its centroid. The finish is a preset (`SECTION_PRESETS`, `?section=`, nothing
  remembered): Ashlar by default, pale sandstone outside with no joints (art direction: no
  photograph of the facade gives its coursing), the cut drawn as the masonry a 1790s sandstone wall
  is built of (`masonrySection`, `MASONRY`; art direction, since nothing surveyed the walls' insides):
  the room's lime plaster (25 mm; mahogany through the dado, oak through the attic; over the relief
  the whole cap is that material) as one band never under 1.5 px and widened whole, a coursed rubble
  core (courses 0.2 m across the wall that wander every 1.3 m, stones 0.24-0.5 m, each its own shade),
  an outer leaf of dressed blocks 0.26 m deep against the outer face, 9 mm mortar joints that fade
  out where a pixel spans more than a joint and a half, and the outer arris catching the light, never
  under 1.5 px. The room line runs straight along the wall's plane (along the relief's surface where
  that lies behind it): S3b's gilt line followed the relief's profile and beaded along every diagonal
  edge (0.29 gaps per 100 px on a phone; beaded in stills on a computer too), and a light arris a
  pixel wide beside the dark plaster band beaded the same way. Atelier keeps a gilt line on the cut's
  room edge, straight, never under 1.5 px. The near walls are cut through the dado rail
  (`HALL_CUTS.near`, 1.92 m, 3 cm under its top, where the door wall's relief stands furthest proud:
  5.0 cm median, every centimetre in section), so the cut's edge is the rail's own face; at 1.96 m its
  top ledge stood a pixel beyond the cut. The room's face under every cut carries a gilt band 8 mm
  deep and a soft shadow below it (35% at most, gone by 4 cm; `hall-cut-lines.ts`), on upright faces
  and not on what stands in a window; every line box-filtered and, once widened past its width,
  dimmed to carry the same light (a band of material, the plaster, is widened whole).
  Ashlar's outer faces other than the street front wear the spaces they look into, as photographed
  (`INTERIOR_FACES`: the F.16 corridor's dado to 1.2 m under a gilt band and its wall above, with its
  skirting and the rail's lit edge and shadow; the Saloon's mahogany panelling; beyond the end and
  fireplace walls, which nobody surveyed, the corridor's wall as art direction, in shade at 55%), and
  the end and main doors' linings are their photographs (read once a fragment: the lining picks its
  texel's place and the atlas is sampled there). Every outer face darkens toward its foot (to 55% at
  the floor, gone by 0.6 m) and takes a faint breadth of tone (`faceShading`).
  Atelier is the city's card model: the city's card colours (`CARD`, copied from `hall-context.ts`),
  lit as the city is (`cardLit`) with the room's glow on the cut, card leaves with their panels
  scored. Nocturne is ebonised (linear 0.012/0.009/0.007) under a moulded top of dark polished stone,
  60 mm high and 30 mm proud of each face, gilt lines along both crests (`hall-coping.ts`, 460
  triangles; a real reflection on desktops, a drawn glint toward the dome fitting on phones); the
  top is a presentation device, not the building. The faces are unlit, the mood's light baked into
  their colour: the cut by 55% of the room's ambient (the inside of a wall, reached by the room's
  light only over its edge; lit fully it read as lit card), its chandeliers falling off from the
  wall's plane (`0.04 + 0.42 exp(-d / 0.4 m)` of their light; a corner block by its distance behind
  the nearer wall), the sky over the lifted ceiling, and under the real sky the sun or moon on its
  level tops with no shadow; the outer faces the sky and a little of the room's glow. The hall stands in a plinth that is a ring round the floor, never a slab under it:
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
  None of the section's materials reads `normalWorld` or the sun's shadow map (whose normal offset
  reads it): in these unlit materials either put the pass's normal target out of step, and the
  ambient occlusion went dark on the cut's tops (0.36 on Ashlar's through `normalWorld`; black
  speckles on Atelier's through the map). The bodies read their geometry's own normal
  (`bodyNormal`); check `?pipeline=ao` after touching their shaders.
- **Beyond the doors** (`hall-beyond.ts`, `hall-neighbours.ts`; data in `tools/grand-hall-survey`,
  "Beyond the doors"): each open door shows a short stub of the space beyond it, its floor at
  +1 cm (`BEYOND_FLOOR_Y`, clear of the city's caps) dissolving from 25% to 96% of its reach from
  the doorway's centre (2.4 m; the fire exit 1.2 m), darkening as it thins, into the city under the
  real sky or the dark without it, and present only as its door opens. The four spaces: D1 the
  Saloon, D2 the landing at the head of Stair 5 with its inlaid TRADES HALL, balustrade (1,276
  triangles with the Saloon's dado; its oak, sRGB 100/68/48 as panorama 076 shows it) and stairwell
  into the dark, both from the scan; D3 the fireplace end of F.16 (its lobby in a square metre of the
  landing's photographed stone, the same corridor) and D4 Stair 7's landing from the 2010 FIRST plan.
  Light falls out of each open door as a lit doorway throws it on a floor at night (`spillLight`,
  `spillShare`: a band as wide as the doorway at its threshold, widening 0.7 m a side for each metre
  out, soft at its sides, dimming as 1 / (1 + (d / 1.1 m)^2), 45% of the chandeliers' light). The
  photographs are relit by their own lamps (5% of the chandeliers' light at night, warm as they are)
  and daylight, the mood's ambient only as a level of light (`relitBeyondPhoto`), and rolled off
  toward 40% of the photograph (`BEYOND_MAX_LIFT`): lifted freely, the spill burned D3's floor to a
  cream oval brighter than the hall's floor (review LOOK-2). The section style draws
  them: Ashlar the photographed floors (`beyond-832.webp`, `beyond-416.webp` on phones: 693 KB on
  the GPU; loaded the first time a door opens, cross-fading in over 200 ms, at once under reduced
  motion; their median colours until then or if they fail), Atelier the first floor's walls in card
  to 1.2 m (its plan fetched when Atelier is chosen, its floor drawn only without the real sky,
  where the city's caps do not give one; the plan is the venue's drawing, so it is built locally into
  the survey's gitignored `local/` folder by `measure/first-floor.py` and not published until the
  venue allows it, review F2: without it Atelier draws no first floor), Nocturne pools of warm light 1.5-2 m across (additive,
  faded out as the sun climbs). Two draws each style: Ashlar 1,358 triangles, Atelier 1,106,
  Nocturne 468 with its top. Not drawn: the Saloon's case 0.4 m proud of its east panelling (its
  floor stops at it), the landing's globe lamps and side balustrades; the balustrade is straight, as
  the scan has it.
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
  the street from 11° to 191°, was measured from the LiDAR; with the reveals' limits it decides when
  sun reaches the floor, the gold bars on the dial. The limits are the reveals as drawn
  (`windowRevealLimit`: the outer opening's width over its depth from the room's plane to the outer
  face, about 71° for the arches and 52° for the sashes), so the dial's times and the sun the render
  draws agree; with the 0.62 m reveal assumed before (77° and 66°) a morning ended 14-20 minutes later
  on the dial than on the floor (NOAA check, 22 October).
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
cuts every wall at 3.12 m, above the doors' heads, the walling over each door going with it so the
doorways read (Cut walls, above) and its doors swing open (Doors, above). A wall the camera stands behind also stays 0.6 m below
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
(0.67 MB instead of 2.06 MB) and keep 16 of the walls' detail tiles (tablets 32, computers 64); a
software rasteriser, read from the canvas's own WebGL context with no probe context, also leaves
out the reflection map, the chandeliers' lights (for a soft fill) and the walls' detail.

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
  (floor, ring, thresholds, bodies, outer reveals, relief, the doors' leaves shut and swung open)
  sharing a plane over more than 1 cm² at the whole, Plan and opening view's cuts;
  `hall-doors.test.ts` holds each leaf's hinge at its jamb and its face where the relief has the
  shut leaves (the main door's at -0.03), the closed photograph's texels, the laps, the modelled
  panels' groove shading, the swing outward and every open leaf inside its doorway 5 mm clear of
  lining, reveal, head and threshold, no leaf of a pair passing through the other at any angle,
  the section a cut lays on a leaf, the spring (settled at 90 degrees within a degree, at once under
  reduced motion), the relief cut only along each doorway's lines with the photograph round it
  whole in front of them (5 mm grid), and the 2k-triangle budget; `hall-wall-body.test.ts` also
  ray-casts a walk at each door (no ray through the wall); `hall-relief-section.test.ts` holds every opening's tag
  to its clear outline on the shipped relief, the relief's section to its surface (within 2 mm where
  smooth, never short of it where it steps), the corners' relief to the lower cut, the slicer's
  re-cutting, the cap's cover of every proud centimetre, and the gilt's and shadow's rules;
  `hall-glazing.test.ts` holds the panes at the glass inside each
  opening, every measured bar where it was measured (and the panes between them open), the budgets
  (panes 200, bars 2,500, reveals 1,500 triangles), the reveals from the glass to the outer face,
  the glass presets and the capture's closing and reopening, also when it throws;
  `hall-floor.test.ts` holds every hash seed above zero and the two halves' end joints alike;
  `hall-neighbours.test.ts` holds the plan's polygons closed, each stub meeting its doorway's outer
  face within 2 cm, every figure to its provenance and the plan's registration residuals;
  `hall-beyond.test.ts` the stubs at +1 cm, their fade and presence, each style's draws and
  triangles, the first floor's card, the pools, the moulded top, the published atlases at their
  stated sizes and hashes, the photographs' load and cross-fade, and that no section material
  samples the sun's shadow map. The
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
- `grand-hall/__tests__/hall-detail.test.ts` holds the detail tiles' grid, the atlas-to-wall round
  trip on all four walls, the index parser's refusals, the selection (Blake's board pose wants the
  boards' tiles first; the opening and far views none; nothing above a wall's cut, behind a wall or
  left out of the index), the slots and their eviction, the per-frame copy budget, the fade (a
  thirteenth a frame at most, at once under reduced motion, held for measuring), the array made only
  with the first tile, the handover levels, the buffers' return to the decoder, retries and disposal,
  the linear-light mip chain, and the published tiles against their index (every file present at its
  bytes and SHA-256, nothing unlisted, 28 MB at most). The rendered proof (legibility, seams, the
  fade, frame times, network) is browser evidence in the 22 October session log.
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

# Surveyed rooms: the room-driven path

The planner draws one room as surveyed, the Grand Hall: measured relief walls wearing the scan's
photographs. That code ([the Grand Hall model](grand-hall-model.md),
`packages/web/src/components/grand-hall/`) is written for one room with four named walls and reads
everything from constants. Other rooms, the Saloon first, are drawn by a second path that takes
everything from a record published with the room's files. The Grand Hall's code and pixels are
untouched; the two paths share only pieces that were already room-neutral.

Code: `packages/web/src/components/surveyed-room/`. Version 1 (13 November 2026) draws a room on a
development page. Since 14 November it is also mounted in the planner's scene, behind a per-device
switch ([In the planner](#in-the-planner)). No room is listed in the registry yet.

## What draws a room

| File | What it does | Imports three |
| --- | --- | --- |
| `survey-record.ts` | The `survey.json` schema (Zod), checked as a whole | no |
| `room-frame.ts` | Wall frames, bounds and area from the outline | no |
| `relief-container.ts` | Reads a GHR1 relief file for any ids | no |
| `room-atlas.ts` | A wall-local point's place in the wall atlas | no |
| `room-registry.ts` | Which rooms are surveyed, and the per-device switch | no |
| `room-visibility.ts` | Which walls, and whether the ceiling, the camera's side lets it see | no |
| `room-status.ts` | How the planner's surveyed room stands, and the caption's words for it | no |
| `room-opening-view.ts` | The planner's opening view of a surveyed room | no |
| `use-planner-surveyed-room.ts` | Which survey the planner's room has, loaded and published | no |
| `load-survey.ts` | Fetches and checks one record, with typed failures | no |
| `room-geometry.ts` | Walls, ceiling and floor as plain typed arrays | no |
| `use-surveyed-room.ts` | Loads record and reliefs, builds the surfaces, one typed state | no |
| `room-lab.ts` | The development page's query and camera poses | no |
| `room-buffers.ts` | The arrays as three geometries, and which walls of them are drawn | yes |
| `room-sight.ts` | Keeps what is drawn in step with the camera's side | yes |
| `room-photos.ts` | The photographs: placeholders, off-thread decode, swap, disposal | yes |
| `room-materials.ts` | Three unlit photograph materials (TSL) and their grade | yes |
| `SurveyedRoomModel.tsx` | The React Three Fiber component | yes |

A room is three draws: its walls (every wall in one geometry), its ceiling and its floor.

- **Walls.** Each wall's relief entry is placed on its outline segment's frame: `(u, v, depth)` goes
  to `origin + tangent·u + up·v + normal·depth`, and takes its colour from the atlas at `(u, v)`
  whatever its depth, since the elevations were photographed along the wall's normal. A wall without
  a relief entry is one flat quad to its height (`buildWallGeometry`); the loader never uses that
  fallback, because it refuses a relief file that does not hold exactly the record's walls.
- **Ceiling.** Its relief (`u` = planner x, `v` = planner z, `y` = reference − depth), or without one
  the outline at `room.ceilingHeight`. Its photograph covers `ceiling.extent`.
- **Floor.** The outline at y = 0, cut into triangles by ear clipping, since an outline need not be
  convex (the Saloon's has four reflex corners). Its photograph covers `floor.extent`.
- **Facing.** Every triangle is counter-clockwise seen from inside the room and only front faces are
  drawn, so a flat wall is seen from inside and vanishes from outside. A relief wound the other way
  would draw as nothing, so it is refused by name. Real reliefs keep a few slivers folded back on
  their steps (1.5% of the Grand Hall's triangles, 0.1% of its area); the test is on the whole
  surface. Front faces alone leave a wall's relief floating when the wall is seen from behind, so
  whole surfaces are also taken away by the camera's side (next section).
- **Photographs.** Shown as taken: they hold the light of the day of the scan. The grade is three
  uniforms (`RoomGradeUniforms`): `exposure` and `tint` over the room, and `glow`, which the walls'
  glass is multiplied by in their place. The atlas's alpha marks glass (255 − 127 × glass), and
  glass lit from behind (the Saloon's stained windows) should not follow a mood that dims the room.
  At the defaults (1, white, 1) every surface is its photograph.
- **Edge-on faces.** A face its photograph saw edge-on (a doorcase's side, a coffer's side) would
  stretch one row of texels into streaks, so it takes a coarser mip instead, as the hall's walls do:
  2.5 levels, or 4 for a wall face turned up or down. A face's direction comes from its position's
  screen derivatives, never from the normal (reading the normal in an unlit material's colour upset
  the pass's normal target in the hall).

## What the camera's side takes away

Seen from outside and above, where the planner's cameras usually are, a wall's flat face is culled
but the tops of its cornice, the sides of its piers and the returns of its bays still face the
camera, and floated as ribbons where the wall should have gone (seen on 14 November). So
(`room-visibility.ts`, plain numbers in the room's own frame):

- **A wall is drawn while the camera is on its plane or in front of it, and not once the camera is
  behind it.** The plane is the wall's outline segment, depth 0 of its relief, whatever stands
  proud of it (the Saloon's relief stands up to 0.9 m proud and 0.8 m back).
- **A short wall goes with its neighbours.** A wall of `RETURN_MAX_LENGTH` (0.6 m) or less, a
  bay's return, is also not drawn while the camera is behind both its neighbours' planes: it faces
  along the side that has gone and would stand alone as a strip. A longer wall between two that
  have gone is a wall of the room (the side of an L's arm) and stays.
- **The ceiling is not drawn while the camera is above its height** (its relief's reference, or a
  flat ceiling's own).

The plain shell decides the same way (`stores/visibility-store.ts`): the camera's signed distance
from each wall's plane, the wall gone at or past it. What does not carry over: its fade (these are
opaque photographs in the scene pass, with its normal and motion outputs and no blending to fade
through), its four walls by compass side (here one plane a wall), and its Cut and Full modes (a
surveyed wall has no body to show from behind, so it is always cut by the camera's side).

Edge cases, on purpose. A camera exactly on a plane sees that wall edge-on: its flat face covers
nothing and its relief's sides are seen truly, so it is drawn; the rule keeps no state, so a still
camera never flickers. A wall pops as the camera crosses its plane, which is where its face covers
least; what is left to pop is its relief's profile. A camera behind a wall's plane but inside the
room (an outline need not be convex) loses only walls turned from it. A camera inside a recess
deeper than the wall's plane (a window's reveal) loses that wall; the planner's cameras do not
stand there.

**How the walls are switched** (`room-buffers.ts`). The walls stay one mesh, one material and one
draw: the indices of the walls to draw are packed to the front of the walls' index and the draw
range covers them; the ceiling's draw range is all or nothing. A draw range is what three both
draws and raycasts, so a surface that is not drawn is not met by a measuring ray either. One mesh
a wall would be a draw, a render object and a set of uniforms a wall in every pass, and three
raycasts a mesh whether or not it is visible; geometry groups need a material array, which no
other mesh of the planner has. The cost here is writing the index again when the set of walls
changes, a few times in an orbit (the Saloon's is 75,651 indices, 0.3 MB). The walls' index is a
32-bit copy of its own from the start: three r186's WebGPU backend replaces a 16-bit index array
with a 32-bit copy at first upload, after which writes to the first array would reach nothing.

**When it is decided** (`room-sight.ts`, `SurveyedRoomModel`). Each frame before it is drawn, and
written to the buffers only when the camera has changed sides. A camera moved later in the same
frame, by an owner whose turn comes after the room's, is drawn once as from where it was; the
model sees that after the frame and asks for one more, so the view never rests on the wrong walls
whatever order the frame's subscribers run in.

## In the planner

`components/editor/PlannerScene.tsx` draws a surveyed room in place of the plain shell when all of
these hold (`use-planner-surveyed-room.ts`):

- this device has asked for surveyed rooms: `?rooms=surveyed`, remembered; `?rooms=plain` turns
  it off again;
- the room is listed in the registry under its space's slug;
- the space's venue has been read and is Trades Hall. Another venue's room of the same slug, or a
  venue not yet read or unreadable, keeps the shell. (The Grand Hall is never asked about: it keeps
  its own model.)

Where the switch is off, or the room has no survey, nothing changes and nothing is asked of
anyone: no venue is read and nothing is fetched.

- **Loading.** The plain shell stays, on its parchment, until the survey's record and reliefs have
  loaded and its surfaces are built; then the surveyed room takes its place in one step, in a plain
  tone, and its photographs follow. The room never blanks.
- **Failing.** If the survey cannot be loaded the shell stays and the planner says so through its
  quiet caption (`editor/cockpit/RoomResolveCaption.tsx`, the one that speaks for a capture and for
  the Grand Hall's surfaces): "The surveyed Saloon could not load, so the room is drawn plainly.
  Planning is unaffected." The file and reason are kept in `stores/surveyed-room-store.ts` for a
  developer. The same caption counts the files and then the photographs in, with the shared
  Activity motion only while something is arriving, and keeps a still note if a photograph failed.
  On a phone, where the caption is otherwise kept off the stage, a failure still shows.
- **Surround, fog, camera response.** A surveyed room stands as the Grand Hall does: the dark
  surround (`#120e0b`), no fog, and the Neutral tone curve that leaves photographs as taken
  (`CaptureToneMapping`'s `photographedRoom`; under the planner's default film curve they would be
  regraded). With its near walls and ceiling taken away the surround shows through every opening,
  and photographs of a lit interior hold against a dark ground, not against paper brighter than
  they are. The blueprint ink is not drawn over it. All of this follows what is drawn: while the
  shell stands (loading, failed) the scene is the plain room's.
- **Light.** The photographs are unlit. The furniture keeps the planner's own rig for a plain room
  (`RoomLighting`'s hemisphere and ambient), now under the Neutral curve.
- **Unchanged.** Where furniture may stand, the room's bounds, snapping, the camera's limits and
  what is saved all come from the room's data (`data/room-geometries.ts` and the space), not from
  how it is drawn. The Saloon's surveyed outline (12.19 m by 7.47 m with two 0.24 m bays) is not
  the planner's Saloon (11.9 m by 6.9 m with four 0.6 m alcoves, a box 13.1 m long); replacing a
  room's outline data is a separate piece of work.
- **Opening view.** On a landscape screen a surveyed room opens on the planner's own view of the
  room (the same target and the same line of sight, from `lib/camera-rig.ts` and the room's data)
  from further back: as far along that line as puts the room as surveyed in frame, its drawn walls
  and floor from the floor to the walls' tops, with 5% of the frame clear around it
  (`room-opening-view.ts`). Never nearer than the planner's own opening, and never past the
  camera's limit for the room, which is as far as a hand can zoom out. The planner's own opening
  stands the camera above the room and inside its outline, in front of every wall, so a surveyed
  room is drawn whole from there with its walls splayed outwards: from the planner's 11.65 m the
  Saloon's walls reached twice the frame's half-height and the corners of its floor were outside
  it (a capture of 15 November 2026). The fitted view stands 19.37 m back. It is handed to
  `CameraRig` as the Grand Hall's own pose is (`defaultPose`), for as long as the survey is the
  room's; a portrait screen keeps the planner's interior angle. The rig opens the camera afresh
  when a room's pose changes, so the camera moves to this view at the step the surveyed room
  replaces the shell, also where a hand had already moved it while the survey loaded. While the
  shell stands (loading, failed) the opening is the planner's own.
- **Not wired to a surveyed room in this version:** the walls' Cut and Full control and a wall's
  click (the plain shell's), the section plane's cut, and the shell's metre grid on the floor.

### A staged survey, in development builds

`?roomsBase=<public folder>&roomsRev=<revision>` (with `?rooms=surveyed`) stands in for the
registry's entry for whichever room is open, so a staged survey can be seen in the planner without
listing it. The folder's record must be that room's own. Production builds ignore both parameters
(`plannerSurveyedRoomAsk` is handed `import.meta.env.DEV`).

`/dev/planner-lab` shows the planner's scene with a made-up space and no API; `?space=saloon` makes
that space Trades Hall's Saloon (`pages/planner-lab-rooms.ts`), so:

    /dev/planner-lab?space=saloon&rooms=surveyed&roomsBase=/rooms/saloon/survey-2026-07-11&roomsRev=1

is the planner's scene with the surveyed Saloon, from the planner's own cameras.
`window.__plannerLab.ready()` is true once the survey is drawn with every photograph in or failed,
or has failed; `surveyedRoom()` returns its status (the failure's file and reason included);
`drawnBy()` says what draws the frames (below); `pose(position, target)` glides the planner's
camera. `scripts/planner-lab.mjs` captures it:

    node scripts/planner-lab.mjs --base http://127.0.0.1:5362 --out <folder> --frames 0 \
      --space saloon --roomsBase /rooms/saloon/survey-2026-07-11

writes the planner's opening view, a plan view and a view in from beyond each of the four sides.

## The `survey.json` contract (schema version 2)

`tools/surveyed-rooms` publishes `survey.json` beside a room's files (the tools arrive with their
own branch; `roombuild/publish.py` writes the record). `parseSurveyRecord` reads version 2 only and
names every fault it finds. Keys the web does not use are dropped.

| Key | Meaning | Checked |
| --- | --- | --- |
| `schemaVersion` | `2` | any other value is refused with one plain reason |
| `slug`, `revision`, `captured` | room slug, integer from 1, ISO date | shape |
| `room.name`, `room.venue`, `room.ceilingHeight` | name, venue slug, metres | shape; where the ceiling has no relief, `ceilingHeight` within 5 mm of the tallest wall's `height` |
| `room.outline` | wall-face corners in planner (x, z), counter-clockwise seen from above | at least 3 vertices, simple, wound the tools' way |
| `atlas.size`, `ppm`, `vRange`, `row` | the wall atlas's pixels, texels per metre, the heights a strip covers, a strip's height | shape; `row` within a texel of `(vRange[1] - vRange[0]) * ppm`, which is what ties `ppm` to the image |
| `atlas.files` | the atlas image at each size, **largest first** | at least one; each listed in `files`; order against byte counts |
| `walls[]` | `id`, `reliefId`, `length`, `height`, `kind`, `atlas` (the strip's top-left texel, width, height) | one per outline segment, in order; length within 2 mm of its segment; `height` no more than 5 mm above `atlas.vRange`'s top; strips inside the atlas, a row high, wide enough, not overlapping |
| `relief.container`, `file`, `order` | `"GHR1"`, the walls' relief file, its entry ids | `order` is exactly the walls' relief ids |
| `ceiling.extent` | `{ x: [x0, x1], z: [z0, z1] }` the ceiling photograph covers | increasing; holds the outline's bounding box, to within 5 mm |
| `ceiling.files` | the ceiling photograph at each size, **largest first** (may be empty) | listed in `files`; order against byte counts |
| `ceiling.relief` | optional: `file`, `id`, `reference` (the height depth is measured down from), `heightRange` | file listed in `files`; the relief's heights (`reference` minus depth) must lie in `heightRange` when it loads |
| `floor.extent` | `{ x: [x0, x1], z: [z0, z1] }` the floor photograph covers | increasing; holds the outline's bounding box, to within 5 mm |
| `floor.files` | the floor photograph at each size, **largest first** (may be empty) | listed in `files`; order against byte counts |
| `ceiling.orientation`, `floor.orientation` | optional statement of how the image lies | if present, must be `"columns planner +x, rows from planner +z"` |
| `files` | every published file's `bytes` and `sha256` | every file the record points at is listed |

Version 2 adds to version 1, which the tools' `publish.py` wrote until its publish step was changed
to write version 2 (that change follows the tools on their own branch): `room`, each wall's
`height` and `kind`, `atlas.files`, the whole `floor` block and the largest-first rule. A version 1
record is refused saying what it is and that the room must be built again by tools that write
version 2; it does not advise republishing, since tools that wrote version 1 would write it again.
No version 2 record has been published yet. Two things are assumptions the tools have yet to
state, and the reader holds them:

- **The floor photograph's orientation.** The ceiling photograph has its columns along planner +x
  and its rows from planner +z (the image's top row is the extent's highest z; the tools' ceiling
  view has its up along planner +z). The floor photograph is assumed to lie the same way, as the
  Grand Hall's does (`floorUv`). Where a record states an `orientation`, it must be that one.
- **Largest first.** The record carries no pixel sizes, so the order of each image list is checked
  against the files' byte counts: a later image larger in bytes than the one before it is refused.

**The extents cover the outline.** The floor, and a ceiling without a relief, are the outline
itself wearing a photograph laid over its extent, so where the outline reached past the extent the
photograph's edge would be smeared over the rest (a floor photograph cropped to a room's main
rectangle, its bays left off). A record whose `ceiling.extent` or `floor.extent` does not hold the
outline's bounding box is refused, naming the extent and the axis. The tolerance is 5 mm
(`OVERHEAD_EXTENT_TOLERANCE`), and it is not slack to tighten: the ceiling's photograph covers the
box exactly, but the tools lay the floor's in whole texels of 1/120 m from the box's lowest x and
highest z, so a published `floor.extent` stops up to half a texel (4.17 mm) short of the other two
sides, or runs that far past them. An extent larger than the box is accepted.

**Heights.** A wall stands from the floor to its `height` and its strip covers `atlas.vRange`, so a
wall more than 5 mm (`HEIGHT_TOLERANCE`) taller than `vRange`'s top is refused. A ceiling without a
relief is drawn flat at `room.ceilingHeight`, so that height must be where the walls end: the
record is refused unless it is within 5 mm of the tallest wall's `height`, and when the walls'
reliefs have loaded the flat ceiling is held to their highest point the same way (a `geometry`
failure naming the walls' relief). Higher, a band of nothing would show above the walls; lower,
they would stand through it. Two things are left alone on purpose. A ceiling with a relief is drawn
from its measured heights (held to `heightRange`), and its room's `ceilingHeight` is only the
relief's reference: the tools' Robert Adam Room has a coffered ceiling whose field is 2.8 m under
walls that rise to 3.216 m into its panels. And a wall's relief is not held to that wall's own
`height`, because the tools mesh every wall's relief over the room's whole range of heights (a
0.594 m screen there gets a relief entry as tall as the tallest wall's); it is held to the strip's
heights, as before.

Frames follow the tools: metres, y up, origin at the centre of the floor; `u` runs left to right as
you face a wall from inside, so `u = 0` is at its segment's end vertex; depth is positive towards
the room. A wall relief's triangles run counter-clockwise seen from the room, a ceiling relief's
seen from below.

## Loading, and failing

An entry names its room (`slug`), its folder (`base`) and its `revision`. `useSurveyedRoom(entry)`
(or `loadSurveyedRoom`) fetches `survey.json` and the relief files at the entry's revision, checks
them and builds the surfaces. Its state is `idle`, `loading` (files read
of files expected, the total unknown until the record says), `ready` or `failed`. There is no
fallback: a room either loads whole or fails with the file and one of these reasons, so a caller
can say that the surveyed room could not be loaded. The hook keeps nothing for an entry that has
left: its room is let go, and the same entry coming back loads afresh. Its second argument,
`attempt`, loads the same entry again when raised, which is how a failure is tried again.

| Reason | Meaning |
| --- | --- |
| `network`, `http` | the request never completed, or the server refused it (status kept) |
| `json`, `schema` | `survey.json` is not JSON, or not a usable record |
| `room` | the record is of another room than the entry names, or of a venue that is not Trades Hall |
| `revision` | the record's revision is not the one asked for |
| `format` | a relief file is not a GHR1 container, or holds other entries than the record names |
| `integrity` | a relief file's size is not the one the record lists |
| `geometry` | a surface cannot be built: a relief wound inside out, with no triangles, or reaching more than 5 mm (`RELIEF_BOUNDS_TOLERANCE`, the error the tools simplify to) outside what its record gives it (a wall's length and its strip's heights; a ceiling's extent and `heightRange`); or a flat ceiling more than 5 mm from the walls' tops |
| `unexpected` | anything else, with its message |

A file's SHA-256 is recorded but not verified in the browser. The photographs are loaded by the
component, not the hook: the room has its shape at once in a plain mid-grey (the record carries no
average colours) and takes each photograph as it arrives. `SurveyedRoomModel` reports photographs
settled of photographs expected, and names the ones that failed; a failed photograph leaves its
surface in the plain tone and is never counted as loaded. Photographs still in flight when the room
or the size changes are stopped, not left to download and decode for nothing. A device takes the first image of each
list at full quality and the second otherwise (`roomPhotoFile`; phones and software rasterisers
take the second, as `hall-finish.ts` decides for the hall).

## Shared with the Grand Hall, and not

Shared, because they were already room-neutral:

- `lib/target-safe-mrt.ts`, the scene pass's outputs and `lib/pipeline-retention.ts` (rules below);
- `lib/raycast-gate.ts` (`SELECTION_PICK_IGNORED`: the room is never selected, while measuring rays
  still meet its walls);
- `lib/native-precompile.ts` and `lib/native-frame-composer.ts` (the room's pipelines are compiled
  before the scene pass first draws them);
- `grand-hall/hall-finish.ts` (`useHallFinish`: which photograph size a device takes);
- `components/shared/Activity.tsx` for every visible loading state.

Not shared: `hall-spec.ts` and everything that reads it (the hall's atlas layout, relief parser,
wall builder, doors, section, light bake, detail tiles, moods, sky). The GHR1 format is the same
file format, read here by a parser that takes any ids.

Rules the room's materials keep for the planner's pipeline:

- **No outputs of their own.** They are opaque surfaces, so the scene pass's own outputs are right
  for them, as for the hall's photographed walls, which set no `mrtNode` either: the view normal
  with an occlusion weight of 1, and their motion. The geometry carries normals for that.
  `targetSafeMrt` is for a material whose outputs must differ from the pass's (a pane, a light).
- **Nothing of a room in the shader.** The materials are built from the same nodes for every room,
  with the room in attributes, uniforms and textures, so every room compiles to the same shader
  text and shares its pipelines, which the planner keeps for the renderer's life.
- **Placeholders are made as the photographs will be** (filtered, sRGB), so swapping a photograph in
  compiles nothing. A nearest-filtered placeholder would be bound without a sampler.

## What version 1 leaves out

On purpose: the walls' 2 mm detail tiles, relighting by baked light channels (so no moods beyond
the grade), wall bodies and section cut lines, light fittings, doors, the sun and sky and walk mode. Also not done: verifying files' SHA-256, average-colour placeholders
(the record would need to carry them), and removing ambient occlusion from glowing glass (the
pass's occlusion weight is 1 on every room surface, as on the hall's photographed glazing).

## Checking a room on the development page

`/dev/surveyed-room` (development builds only) draws one room from a public folder, through the
planner's own pipeline for the device:

    /dev/surveyed-room?base=/rooms/saloon/survey-2026-07-11&r=1

- `base` is the survey's folder under `packages/web/public`, `r` its revision (1 when left out).
  The room the folder should hold is `slug`, or where that is left out the room a folder under
  `/rooms/<room>/` is filed under; a folder holding another room's survey is refused.
- `photos=half` or `photos=full` takes that size of the photographs whatever the device.
- `render=phone|tablet|desktop|office|off` chooses the pipeline's profile (`off` draws plainly);
  `pipeline=ao` shows the occlusion alone.
- Buttons pose the camera: overview, plan, eye, ceiling, floor, and one per wall, which faces that
  wall square on from inside (the way to check a strip's place and orientation). Sliders set the
  exposure and the glass's glow.
- While files load, the shared Activity status counts them. A room that cannot be loaded says so
  with the file and the reason; a photograph that fails is named at the foot of the page.
- `window.__roomLab` is the bridge for captures: `ready()`, `status()`, `setPose(wall id | name | wall index |
  { position, target, fov })` (a wall's exact id wins over a name or digits), `exposure()`, `setExposure(n)`, `setGlow(n)`.
- `status().drawnBy` (and `window.__plannerLab.drawnBy()` on the planner's lab) is what draws the
  frames: `{ backend: "webgpu" | "webgl2", gpu }`, read from the renderer the canvas made
  (`nativeDrawingBackend` in `lib/native-renderer.ts`), null until that renderer's backend can
  draw. A WebGPU backend counts only once it holds its device, since three starts a renderer on
  one and swaps in WebGL2 where no device can be had.

`packages/web/scripts/surveyed-room-lab.mjs` opens the page headless on this machine's GPU, waits
for `ready` (or reports why the room failed), sets each pose and writes a PNG:

    node scripts/surveyed-room-lab.mjs --room /rooms/saloon/survey-2026-07-11 --poses overview,plan,eye,walls

Its summary (and `planner-lab.mjs`'s) records `drawnBy` as the page reports it, the backend again
beside each capture (a renderer that replaced the first after a lost device may draw with another),
the page's uncaught errors and every console error and warning. It asks for no adapter of its own:
an adapter the script could get says only that WebGPU could be had, whatever drew the room.

## Checks

- `__tests__/survey-record.test.ts`: the contract and every refusal.
- `__tests__/room-geometry.test.ts`: winding (every flat wall's triangles face the room, a step
  along their front is inside the outline; the ceiling faces down; the floor up), bounds, the
  non-convex floor's area against the outline's, texture coordinates at known corners, the
  fallbacks, the ear clipping on six shapes, and the refusal of a relief wound inside out. On real
  data: the Grand Hall's shipped `walls-relief.bin` through a record equivalent to the hall stands
  every one of its 17,913 vertices where `wallPoint` does, with `wallAtlasUv`'s coordinates; each
  wall's relief covers its rectangle once seen along its normal; and against the hall's own wall
  builder, every vertex the hall kept from the file has a twin here with the same atlas coordinate,
  and every triangle it kept whole is one of this path's, wound the same way. Not comparable: what
  the hall cuts out of its doorways and the points those cuts add, the hall's ceiling (built from
  its specification, not a relief) and its drawn floor.
- `__tests__/use-surveyed-room.test.ts`: each failure as its typed state, abort, progress, a change
  of entry, with stubbed fetches (and the hall's shipped relief at its real size).
- `__tests__/room-photos.test.ts`, `__tests__/SurveyedRoomModel.test.tsx`: the size a device takes,
  the decode's options, the swap, progress, the selection marker, and that every geometry,
  material, texture and bitmap is freed once when the room changes or the component unmounts.
- `__tests__/room-materials.test.ts`: three r186's own WGSL builder run on each material without a
  device, for the canvas, the planner's scene pass (colour, normal with weight 1, motion), a
  tablet's pass and a snapshot's unnamed target; the same text for two rooms; the same text before
  and after a photograph replaces its placeholder.

Seen rendered, 14 November 2026: the Saloon's first build, staged and not yet published, on the
development page in headless Chrome on an NVIDIA RTX 4090. The room reached ready with 3 of 3
photographs and no uncaught page errors; every wall's strip was on its wall and its lettering read
the right way round; the floor's hearth lay at the fireplace and its bays at the windows; and the
walls were culled from outside. That capture's summary shows that a WebGPU adapter could be had on
the machine, not which backend drew the frames, and it kept no console errors or warnings: the
script recorded neither until 16 November. A capture taken since says both.

- `__tests__/room-visibility.test.ts`: the rule as plain logic, on a box, an L, a stepped side and
  the Saloon's outline: each side from outside, a corner, a camera on a plane and a millimetre
  behind it, a bay's returns with and without their neighbours, inside a bay, the ceiling, and the
  packing of the drawn walls' indices.
- `__tests__/room-sight.test.ts`: writes only on a change of side, says when the camera has moved
  on since, reads the camera in the room's own frame; the buffers' draw ranges, the index's upload,
  and that a wall or ceiling not drawn is not met by a ray.
- `__tests__/SurveyedRoomModel.test.tsx` also drives real frames: the ranges follow the camera, and
  a camera moved after the room's turn gets exactly one more frame.
- `__tests__/use-planner-surveyed-room.test.ts`: the switch, the registry's injectable table, the
  staged folder and that a production build ignores it, the venue, a failure, another room's
  survey, and the caption's words.
- `__tests__/room-opening-view.test.ts`: the opening view against three's own camera: the
  planner's own opening does not hold the Saloon as surveyed; the fitted one keeps the planner's
  target and line of sight and holds every corner of the room's drawn box inside the margin at
  6:5, 3:2, 16:9 and 21:9; it is held at the camera's limit, is never nearer than the planner's
  own, and follows a wall's relief.
- `lib/__tests__/native-drawing-backend.test.ts`: what a capture's summary says drew the frames:
  WebGPU only once the backend holds its device, WebGL2 where the renderer fell back, each named by
  its own device or context, and nothing for a renderer that is not the native one.
- `editor/__tests__/PlannerScene.surveyed-room.test.tsx`: in the manner of `PlannerScene.test.tsx`,
  what the scene draws: the shell exactly as today with the switch off or no survey, the shell
  until ready and the surveyed room after, the shell and the note on failure, another venue's room,
  a production build, the Grand Hall left alone, a history preview; and the opening pose the camera
  rig is handed: none while the shell stands, the fitted one (one object through re-renders) once
  the surveyed room is drawn, the hall's own for the hall.

Seen in the planner's scene: one capture of the staged Saloon through `planner-lab.mjs` on
15 November 2026, taken before the opening view was fitted, which is where the opening's fault was
seen; nothing else of it is recorded here yet, and the fitted opening view has been worked out and
tested against three's camera but not seen. What only a render can prove of the mount: that the
near walls and ceiling go with nothing of them left floating from the planner's opening view, a
plan view and each side; how a wall's pop reads during an orbit; that the index's upload under
WebGPU draws the right walls (three's change detection and `writeBuffer` path were read, not run);
the swap from the shell on parchment to the room in its dark surround; the furniture under the
Neutral curve with the plain rig; and the caption in place.

What only a render can prove, and has not been proven on a device: the placeholder's swap,
disposal after a device loss, the WebGL2 fallback, the normal and motion targets as the passes
read them (`?pipeline=ao`), and the edge-on softening's look near a strip's edge. A face softened by 2.5 to 4 mip levels reads
texels 6 to 16 base texels wide (twice that across a bilinear pair), and a strip's gutter is 8. In
the Saloon's staged atlas each strip's edge is repeated 4 texels into the gutter with its own
alpha (opaque where the edge is wall), so a gutter does not itself read as glass; but such a face
within about 16 texels (8 cm) of its strip's edge blends in the neighbouring strip, its glass
included. At the default grade glass and wall are drawn alike, so only the colour could show.

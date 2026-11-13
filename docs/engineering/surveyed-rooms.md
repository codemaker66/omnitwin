# Surveyed rooms: the room-driven path

The planner draws one room as surveyed, the Grand Hall: measured relief walls wearing the scan's
photographs. That code ([the Grand Hall model](grand-hall-model.md),
`packages/web/src/components/grand-hall/`) is written for one room with four named walls and reads
everything from constants. Other rooms, the Saloon first, are drawn by a second path that takes
everything from a record published with the room's files. The Grand Hall's code and pixels are
untouched; the two paths share only pieces that were already room-neutral.

Code: `packages/web/src/components/surveyed-room/`. Version 1 (13 November 2026) draws a room on a
development page. It is not mounted in the planner yet, and no room is listed in the registry.

## What draws a room

| File | What it does | Imports three |
| --- | --- | --- |
| `survey-record.ts` | The `survey.json` schema (Zod), checked as a whole | no |
| `room-frame.ts` | Wall frames, bounds and area from the outline | no |
| `relief-container.ts` | Reads a GHR1 relief file for any ids | no |
| `room-atlas.ts` | A wall-local point's place in the wall atlas | no |
| `room-registry.ts` | Which rooms are surveyed, and the per-device switch | no |
| `load-survey.ts` | Fetches and checks one record, with typed failures | no |
| `room-geometry.ts` | Walls, ceiling and floor as plain typed arrays | no |
| `use-surveyed-room.ts` | Loads record and reliefs, builds the surfaces, one typed state | no |
| `room-lab.ts` | The development page's query and camera poses | no |
| `room-buffers.ts` | The arrays as three geometries | yes |
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
  drawn, so a wall is seen from inside and vanishes from outside: an orbiting camera looks in
  through the walls nearest it, with no cutaway. A relief wound the other way would draw as nothing,
  so it is refused by name. Real reliefs keep a few slivers folded back on their steps (1.5% of the
  Grand Hall's triangles, 0.1% of its area); the test is on the whole surface.
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

## The `survey.json` contract (schema version 2)

`tools/surveyed-rooms` publishes `survey.json` beside a room's files (the tools arrive with their
own branch; `roombuild/publish.py` writes the record). `parseSurveyRecord` reads version 2 only and
names every fault it finds. Keys the web does not use are dropped.

| Key | Meaning | Checked |
| --- | --- | --- |
| `schemaVersion` | `2` | any other value is refused with one plain reason |
| `slug`, `revision`, `captured` | room slug, integer from 1, ISO date | shape |
| `room.name`, `room.venue`, `room.ceilingHeight` | name, venue slug, metres | shape |
| `room.outline` | wall-face corners in planner (x, z), counter-clockwise seen from above | at least 3 vertices, simple, wound the tools' way |
| `atlas.size`, `ppm`, `vRange`, `row` | the wall atlas's pixels, texels per metre, the heights a strip covers, a strip's height | shape |
| `atlas.files` | the atlas image at each size, **largest first** | at least one; each listed in `files`; order against byte counts |
| `walls[]` | `id`, `reliefId`, `length`, `height`, `kind`, `atlas` (the strip's top-left texel, width, height) | one per outline segment, in order; length within 2 mm of its segment; strips inside the atlas, a row high, wide enough, not overlapping |
| `relief.container`, `file`, `order` | `"GHR1"`, the walls' relief file, its entry ids | `order` is exactly the walls' relief ids |
| `ceiling.extent` | `{ x: [x0, x1], z: [z0, z1] }` the ceiling photograph covers | increasing |
| `ceiling.files` | the ceiling photograph at each size, **largest first** (may be empty) | listed in `files`; order against byte counts |
| `ceiling.relief` | optional: `file`, `id`, `reference` (the height depth is measured down from), `heightRange` | file listed in `files` |
| `floor.extent` | `{ x: [x0, x1], z: [z0, z1] }` the floor photograph covers | increasing |
| `floor.files` | the floor photograph at each size, **largest first** (may be empty) | listed in `files`; order against byte counts |
| `ceiling.orientation`, `floor.orientation` | optional statement of how the image lies | if present, must be `"columns planner +x, rows from planner +z"` |
| `files` | every published file's `bytes` and `sha256` | every file the record points at is listed |

Version 2 adds to the tools' version 1 (which `publish.py` writes today): `room`, each wall's
`height` and `kind`, `atlas.files`, the whole `floor` block and the largest-first rule. No version 2
record has been published yet. Three things are assumptions the tools have yet to state, and the
reader holds them:

- **The floor photograph's orientation.** The ceiling photograph has its columns along planner +x
  and its rows from planner +z (the image's top row is the extent's highest z; the tools' ceiling
  view has its up along planner +z). The floor photograph is assumed to lie the same way, as the
  Grand Hall's does (`floorUv`). Where a record states an `orientation`, it must be that one.
- **Largest first.** The record carries no pixel sizes, so the order of each image list is checked
  against the files' byte counts: a later image larger in bytes than the one before it is refused.
- **`floor.extent`.** Taken as given; in the test fixture it is the outline's bounds, as the
  ceiling's is.

Frames follow the tools: metres, y up, origin at the centre of the floor; `u` runs left to right as
you face a wall from inside, so `u = 0` is at its segment's end vertex; depth is positive towards
the room. A wall relief's triangles run counter-clockwise seen from the room, a ceiling relief's
seen from below.

## Loading, and failing

`useSurveyedRoom(entry)` (or `loadSurveyedRoom`) fetches `survey.json` and the relief files at the
entry's revision, checks them and builds the surfaces. Its state is `idle`, `loading` (files read
of files expected, the total unknown until the record says), `ready` or `failed`. There is no
fallback: a room either loads whole or fails with the file and one of these reasons, so a caller
can say that the surveyed room could not be loaded.

| Reason | Meaning |
| --- | --- |
| `network`, `http` | the request never completed, or the server refused it (status kept) |
| `json`, `schema` | `survey.json` is not JSON, or not a usable record |
| `revision` | the record's revision is not the one asked for |
| `format` | a relief file is not a GHR1 container, or holds other entries than the record names |
| `integrity` | a relief file's size is not the one the record lists |
| `geometry` | a surface cannot be built (a relief wound inside out) |
| `unexpected` | anything else, with its message |

A file's SHA-256 is recorded but not verified in the browser. The photographs are loaded by the
component, not the hook: the room has its shape at once in a plain mid-grey (the record carries no
average colours) and takes each photograph as it arrives. `SurveyedRoomModel` reports photographs
settled of photographs expected, and names the ones that failed; a failed photograph leaves its
surface in the plain tone and is never counted as loaded. A device takes the first image of each
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
the grade), wall bodies and section cut lines, light fittings, doors, the sun and sky, walk mode,
and mounting in the planner. Also not done: verifying files' SHA-256, average-colour placeholders
(the record would need to carry them), and removing ambient occlusion from glowing glass (the
pass's occlusion weight is 1 on every room surface, as on the hall's photographed glazing).

## Checking a room on the development page

`/dev/surveyed-room` (development builds only) draws one room from a public folder, through the
planner's own pipeline for the device:

    /dev/surveyed-room?base=/rooms/saloon/survey-2026-07-11&r=1

- `base` is the survey's folder under `packages/web/public`, `r` its revision (1 when left out).
- `photos=half` or `photos=full` takes that size of the photographs whatever the device.
- `render=phone|tablet|desktop|office|off` chooses the pipeline's profile (`off` draws plainly);
  `pipeline=ao` shows the occlusion alone.
- Buttons pose the camera: overview, plan, eye, ceiling, floor, and one per wall, which faces that
  wall square on from inside (the way to check a strip's place and orientation). Sliders set the
  exposure and the glass's glow.
- While files load, the shared Activity status counts them. A room that cannot be loaded says so
  with the file and the reason; a photograph that fails is named at the foot of the page.
- `window.__roomLab` is the bridge for captures: `ready()`, `status()`, `setPose(name | wall index |
  wall id | { position, target, fov })`, `exposure()`, `setExposure(n)`, `setGlow(n)`.

`packages/web/scripts/surveyed-room-lab.mjs` opens the page headless on this machine's GPU, waits
for `ready` (or reports why the room failed), sets each pose and writes a PNG:

    node scripts/surveyed-room-lab.mjs --room /rooms/saloon/survey-2026-07-11 --poses overview,plan,eye,walls

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

What only a render can prove, and has not been proven: that a device compiles those shaders; the
normal and motion targets as the passes read them (`?pipeline=ao`); each photograph's orientation
on screen (walls, ceiling, floor); culling as seen from an orbit; the placeholder's swap; the
edge-on softening's look; and disposal on a real device. The Saloon's own files had not been
published when this was written, so nothing here has been seen with a room's real photographs.

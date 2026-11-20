# Surveyed rooms

Each room drawn as surveyed has one config, `<slug>.room.json`. It records where the room sits
in the scan, its measured outline, openings, ceiling, floor, columns and fittings, what was
edited out of the scan, and how the survey renders it. `room.schema.json` defines it. The survey
build (`build-room.py`) reads every room fact from the config; the Grand Hall's config,
`grand-hall.room.json`, carries exactly the values the Grand Hall is built from today, and
`prove-grand-hall.py` and `prove-build-identity.py` check that against the files that hold them.

| File | What it is |
| --- | --- |
| `room.schema.json` | JSON Schema (Draft 2020-12) for a room config |
| `grand-hall.room.json` | the Grand Hall, as built in `tools/grand-hall-survey` and `hall-spec.ts` |
| `saloon.room.json` | the Saloon, measured from the twin (T-662) |
| `roomlib.py` | frames, wall geometry and view generation (standard library only) |
| `room-views.py` | writes a room's `views-walls.json` and `views-ceiling.json` for `render.mjs` |
| `check_room.py` | validates a config against the schema, then checks its geometry |
| `prove-grand-hall.py` | the proof that the Grand Hall's config carries today's values |
| `build-room.py`, `build-room.sh` | the survey build for any room, from its config |
| `roombuild/` | the build's steps (one process per step, as `build.sh` runs one script) |
| `render-depth-room.mjs` | depth cubemaps for the config's stations (`render-depth.mjs` with a station list) |
| `relief-mesh-room.mjs` | meshes depth maps into a GHR1 file from a job file (`relief-mesh.mjs` with its constants moved out) |
| `nodemods.mjs` | resolves meshoptimizer as `modules.mjs` does (`SURVEYED_ROOMS_NODE_ROOT` borrows another checkout's: gate B22) |
| `prove-build-identity.py` | the Grand Hall's build identity: a static proof, a tree comparison, digests, a self-test |
| `measure/saloon/` | the scripts that measured the Saloon (`32_glass_split.py`: where its glass changes plane) |
| `measure/walls/` | measures of a finished build's wall photographs, for judging a change to how the walls are coloured on a real room: `compare_builds.py` (two builds, on the texels whose station changed: as rates, and as pairs that turned worse, turned better or stayed, by texel and by connected patch, beside the same count on clean texels), `doubtful_rules.py` (the rules for a doubtful view, each view against its own station's clean wall), `changed_crops.py` (where two builds' walls differ, to be looked at). They take the builds' work folders; no scan data is kept with them |
| `tests/` | T0 static, T1 units, T2 the mini Grand Hall (old scripts against new steps), T3 an analytic room, T4 the gates neither opens |
| `.gitattributes` | keeps the configs, the schema and the shell scripts LF on every checkout |

`roomlib.py`, `room-views.py`, `check_room.py` and `prove-grand-hall.py` run under
`python -X utf8 -I` with the standard library only. The build and its proofs need numpy and
Pillow (with WebP), and Node 22 with the workspace installed for the depth, surface and relief
steps.

## Frames and conventions

- **E57**: the capture's frame, metres, Z up. Stations, the mesh and every `...E57` field use it.
- **Planner**: metres, y up, origin at the centre of the room's floor, floor at y = 0. Outlines,
  fittings and openings' heights use it.
- **`transform`** maps E57 to planner. With `X' = X − centre[0]` and `Y' = Y − centre[1]`:

  | `quarterTurns` | x | z |
  | --- | --- | --- |
  | 0 | X′ | −Y′ |
  | 1 | −Y′ | −X′ |
  | 2 | −X′ | Y′ |
  | 3 | Y′ | X′ |

  and `y = Z − floorZ`. Every row is a proper rotation; each quarter turn is a turn about +y,
  counter-clockwise seen from above. The Grand Hall is 2 (`x = 8.795 − X`, `z = Y + 4.963`);
  the Saloon is 1 (`x = 7.565 − Y`, `z = −2.065 − X`).
- **Outline**: `walls.vertices` are the wall-face corners in planner (x, z), counter-clockwise
  seen from above (from +x towards −z). Segment i runs from vertex i to vertex i + 1, the last
  closing the loop, with the room on its left. Each segment has an id, a height and a kind
  (`solid`, `partition`, `screen`, `open`); a curved wall gives its `sagitta`. Vertex i is the
  right end (u = length) of segment i and the left end (u = 0) of segment i − 1; a vertex where
  the outline steps out of the room (into a bay) is reflex (`roomlib.corner_convex`).
- **Along a wall**: u runs left to right as you face the wall from inside. So u = 0 is at the
  segment's end vertex. v is height above the floor. Openings and edits use (u, v).
- **Openings**: `kind` is what fills the hole (`door`, `window`, `arch` = nothing), `headShape`
  its top (`square`, `semicircular`, `segmental` with `headRise`), and `head` the top of a square
  opening or the springing of an arch. The web's `arched-window` is a window with a semicircular
  head. Give the centre as `centre` (u) or `centreE57` (projected onto the wall). `glazing` is
  one of `clear`, `frosted-lower`, `stained-backlit`, `sheer` or `none`.
- **Glass**: `opening.glass` is the glazing as measured behind the face opening, centred on it:
  `width`, `sill`, `head`, `headShape` (and `headRise`), `planes` from the bottom up (`depth`
  behind the wall face; every plane but the last gives `below`, where the next takes over),
  `bars` (height bands that are frame, a transom) and `frostedBelow`. Clear glazing is found by
  the old colour test, so the build refuses a glass block on a clear window (it would be
  ignored); the other classes are masked from it. A surface within 0.05 m of any of the
  opening's planes counts as glass (so a plane change placed a little off cannot hole the mask),
  and the plane the config gives each row sets the relief's depth. The windows step then checks
  the config against the scan: where the rows change plane (to 0.03 m) and how deep each plane
  is (to 0.03 m). A disagreement is recorded in `build/glass.json` and `survey.json`, and
  publishing refuses it. Sheer glass is not checked (the scan sees the sheer).
- **Edits** that follow an opening name it: `{"opening": "door-end", "offset": -0.54}` is that
  opening's centre less 0.54 m; `{"openingDelta": [a, b]}` is centre(b) − centre(a). A patch
  `shift`s from u + by, `mirror`s about u = about, or `copy`s from another wall
  (`from: {wall, u, mirror}`, as wide as the target). A `recess` changes the relief only; the
  build refuses one that also names `photo`.
- **Stations**: list every one the room uses. `room` stations must lie inside the outline;
  `doorway` stations name the opening they stand in or just beyond (up to 2 m beyond its face);
  `outside` stations need a note.
- **Survey**: `walls.segments[].survey` keeps a wall's name in survey files (the Grand Hall's
  fireplace wall is `fire`), its tile count, an `anchorE57` where the rendered elevation starts
  if that is not the corner, and a `reliefId` when its id is longer than GHR1's 12 bytes.
  Without an anchor, views start at the corner; without a count, tiles are
  `ceil(length / tileMaxLength)`.
- **Stray texels** (`survey.wallViews.strayTexels`): how many covered texels of one elevation
  tile may lie off their own centres and be left out (gate B24). Leave it out until a room's
  renders need it: the labels step then names the tile and the offsets, and the texels should be
  looked at first (a few, metres outside the view's near and far, on a surface seen edge-on). A
  grid in the wrong place moves every texel, so no small number lets it through.
- **Ceiling view**: the camera's up is planner +z, so every room's ceiling image has columns
  along planner +x and rows from planner +z (for the Grand Hall, E57 −X and +Y, as before).
- **Ceiling relief** (`survey.ceilingRelief`): one GHR1 entry with u = planner x, v = planner z
  and depth = `ceiling.height` − y, positive towards the room like the walls' depth. Its
  triangles run counter-clockwise seen from below. The fittings' footprints are removed up to
  their tops; a texel more than 60 texels from anything measured takes `ceiling.height` (counted
  in `relief/ceiling.json` as `unfilledInside`); an odd size is padded rather than cropped, and
  the mesher places vertices at the exact spacing (`ppmU`, `ppmV`), `ppm` being nominal.
- **Outputs** (`survey.outputs`): the published files and their pixel sizes. The Grand Hall
  publishes its nine files and no `survey.json`; a new room also publishes `survey.json`.

## What stays in code

The method stays in the scripts: projection weights and the consensus passes, nadir
thresholds, the window glass test, the filters and fill passes, corner fin thresholds, the floor
flattening scales, the encodings (WebP quality, the glass alpha 255 − 127 g) and the packing
gutter. The config holds what changes from room to room: geometry, edits, occluders,
resolutions, extents, layout, outputs and the per-surface projection arguments.
`survey.methodRevision` (absent = 1, as the Grand Hall was built) selects code-defined changes
of method that would alter the Grand Hall's output; revision 2 adds one, opening-aware corner
statistics.

## Building a room

    python -X utf8 tools/surveyed-rooms/build-room.py <room.json> <work-dir> [--publish DIR]
        [--from STEP] [--to STEP] [--inputs-from DIR [--reuse-depth]] [--twin URL] [--plan]
        [--expect-legacy] [--relief keep|rebuild] [--list] [--only ID] [--resume]
    bash tools/surveyed-rooms/build-room.sh <room.json> <work-dir> [<publish-dir>]

| # | Step | Runs (in the work directory) | The Grand Hall's script |
| --- | --- | --- | --- |
| 0 | check | `check_room` and the build's own checks; writes `room.json`, `views/`, `build/{stations,ledger,plan}.json` | `wall-views.py`, committed views |
| 1 | inputs | `roombuild/step.py inputs`, `dump-mesh.mjs` | `fetch_inputs.py`, `dump-mesh.mjs` |
| 2 | depth | `render-depth-room.mjs build/stations.json 1024 data/depth1024` | `render-depth.mjs` |
| 3 | surfaces | `render.mjs views/views-walls.json out-walls`, and the ceiling's | `render.mjs` |
| 4 | corners | `step.py corners`: the corners' fins moved back onto their walls (`out-walls/*.fixed.f32`) | `fix-corners.py --positions-only` |
| 5 | labels | `step.py labels <wall>` per wall: each block's sharpest station (`proj/labels-<wall>.npz`) | `label-views.py` |
| 6 | walls | `step.py wall-photo <wall>` per wall: the 2.5 mm and 5 mm orthophotos, seams levelled; then `step.py canvases <wall>` for each wall with a `canvas` edit | `project-walls.py --labels`, `canvas-veil.py` |
| 7 | project | `step.py project-ceiling`, `project-dome <id>`, `project-floor` | `project-ceiling.py`, `project-dome.py`, `project-floor.py` |
| 8 | windows | `step.py windows`: the masks, the layers and `build/glass.json` (with the scan check) | `window-relief.py` |
| 9 | atlas | `step.py atlas` | `pack-atlas.py` |
| 10 | relief | `step.py wall-depth`, `relief-mesh-room.mjs build/relief-walls.json`; with a ceiling relief, `step.py ceiling-relief` and its GHR1 | `wall-depth.py`, `relief-mesh.mjs` |
| 11 | overhead | `step.py overhead proj` | `pack-overhead.py` |
| 12 | floor | `step.py flatten-floor`, `step.py pack-floor` | `flatten-floor.py`, `pack-floor.py` |
| 13 | detail | `step.py detail <wall>` per wall, then `step.py pack-detail`: the walls at `survey.detail`'s texel, cut into tiles with `detail/index.json` | `project-detail.py`, `pack-detail.py` |
| 14 | publish | `build/survey.json` (schema version 2, below); with `--publish`, the outputs and the detail folder (DIR must be `survey.publish.folder`) | the tail of `build.sh` |

The order is `build.sh`'s, and `prove-build-identity.py --static` compares the two lists.

### How the walls are coloured

The walls take each part's colour from the one panorama that photographed it most sharply, as the
Grand Hall's do (`tools/grand-hall-survey/README.md`, "The walls: the sharpest photograph"); the
ceiling, domes and floor keep the weighted blend. Nothing of that method is copied into this
folder. `roombuild/walls.py` points the Grand Hall scripts' own globals at the room's values
(`roombuild/legacy.py`) and runs each script's `main()`, one process per wall:

| The script reads | From the config |
| --- | --- |
| `project.VIEWS`, `project.STATION_IDS`, `project.CHANDELIERS` | the work directory's `views/`, `stations`, `occluders` |
| `bestview.WALLS`, `SRC_TOP`, `FLOOR`, `COS_MIN`, `MAX_DIST`, `OCCLUDER_MARGIN` | each wall's survey name, anchor, u axis, normal and length; `wallViews.heightRange[1]`; `transform.floorZ`; `projection.walls.cosMin` and `maxDist`; `projection.walls.occluderMargin` (0.0 without the key: no margin, gate B25) |
| `project-walls.NORMALS` (its wall names) | the walls in order |
| `canvasveil.CANVASES`, `PITCH` | the `canvas` edits; one elevation texel |
| `project-detail` and `pack-detail`: `TEXEL`, `TILE`, `GUTTER`, `PPM`, `V_MIN`, `V_MAX`, `ROW`, `LENGTH`, `PATCHES`, `SRC_COLUMNS`, `NAME`, `ATLAS`, `GLASS_STRIPS` | `survey.detail`, the atlas's layout, the photo patches, the walls with narrow tiles (B23), the wall ids, `outputs.walls[0]`, the strips of the walls with clear glazing |

A global that is no longer in its script stops the build (`legacy.point`). `projection.walls.pCos`
and `qDist` belong to the blend and are no longer read for walls. The method counts in elevation
texels (a block is 8 x 8, seams feather over 8 and blend over 24), so `wallViews.ppm` 200 gives the
Grand Hall's 40 mm blocks. A `canvas` edit names a varnished canvas (`id`, `wall`, `u`, `v`, and
`veil: false` to return it to its photograph's level only); a room without one runs no canvas step.

Two pieces are still ports, because their scripts are flat and built round the Grand Hall's four
walls: `roombuild/corners.py` (`fix-corners.py`, with four gates inside its loop) and
`roombuild/atlas.py` (`pack-atlas.py`'s body; its `fill` and `fill_sparse` are taken from the
script's source and `canvasveil.py` is imported). T2 runs both against their scripts.

Inputs and depth maps already in the work directory are kept. `--inputs-from` hard-links (or
copies) another work directory's manifest, mesh, mesh dump and this room's panoramas; the inputs
step then checks the manifest, mesh and panoramas against the manifest's SHA-256. Its depth maps
are taken only with `--reuse-depth`, because the manifest holds no hashes for them: by default
the depth step renders every map, so an identity run compares the renderers too. Every path
taken from another tree is listed in `build/linked.json` (with the tree it came from, local
provenance) and, by name and how it was linked only, in `survey.json`; `prove-build-identity.py`
reports those files as linked, never as identical.

The config is checked before anything reads it, in every mode. A file that is not there, is not
JSON or is not well-formed is refused in `check_room.py`'s own words, and a config without a survey
block the build needs is refused by that block's name, before the work directory is made.

`--from`/`--to` run a span of steps (the check always runs, and refuses if the views changed
under rendered surfaces). No step rewrites another's files, so any step can be the start.
Editing patches on a built room is `--from atlas` (the detail tiles repeat them, and the run goes
on to `detail`); a `canvas` edit is `--from walls`. Changing a window, its glass block, the walls
or the wall views needs `--from windows`: the windows step records a digest of those facts in
`build/glass.json`, and the atlas and relief steps refuse masks made from other facts. It also
deletes the masks of walls that no longer have glazing. Every step's command, time, exit status
and the digests of the files it wrote are appended to `build/steps.json`.

The walls' steps run on four threads (`SURVEY_THREADS`) at below-normal priority, hold one
panorama at a time, and pause between stations while the file `SURVEY_PAUSE_FILE` names exists.
The labels step holds BLAS to one thread: `roombuild/step.py` sets `OPENBLAS_NUM_THREADS`,
`OMP_NUM_THREADS` and `MKL_NUM_THREADS` to 1 for it before anything loads numpy, as `build.sh` and
`label-views.py` do for the Grand Hall. Its four band threads each call BLAS, and with BLAS running
threads of its own under them the calls deadlocked or crashed on Windows (three runs of four on the
Grand Hall's end wall). Set nothing higher for that step. The thread counts do not change the
result: on a region of that wall round its portrait (u 2.5 to 8.1 m, v 1.5 to 5.0 m; 12,549 blocks),
four BLAS threads under one band thread and one BLAS thread under four band threads gave the same
21 arrays.
A wall's labels are the build's longest sub-command (the Grand Hall's README gives about 40
minutes for its four walls on four cores, most of it the two long ones).

**One sub-command at a time.** A build is a list of sub-commands, each one process: a wall's
labels, a wall's photographs, the ceiling's projection. `--list` prints them with their ids,
`<step>:<n>` counted from 1 within the step (`labels:3` is the third wall's labels; `publish:1`
is the record), and writes nothing. `--only ID` runs exactly one, after the check and whatever its
step needs first (the inputs' links, the relief's job files), and records it in
`build/steps.json` like any other. `--resume` skips a sub-command whose last record ended with
exit 0 for the same command and the same config, when nothing it may depend on has run since
(any earlier step's sub-command, and the earlier ones of its own step unless it is one per wall or
surface) and every file it wrote is still there with the recorded size and SHA-256. A build
stopped anywhere, by a failure or by its caller, so picks up at the first sub-command that is not
done; `--list --resume` shows which those are. A changed config skips nothing, because the build
cannot tell which steps a change reaches: the check and each step's own refusals run as ever, and
`--from` says where to start. So a caller that may not hold a shared machine for a whole build
runs `--only` for each id in turn, or lets a `--resume` run be stopped between sub-commands, and
takes its lock round each call; the driver knows nothing of locks. Two cautions: the depth maps
and the surfaces are each one sub-command for the whole room, and a patch copied from another
wall (B20) rewrites its wall's detail image, so `--resume` projects that wall's detail again.

**Publishing.** `--publish DIR` copies `survey.outputs` and replaces `DIR/detail` whole. A config
with `survey.atlas.alphaFrom: "published"` (the Grand Hall) is published as `build.sh` publishes
it: `step.py atlas --alpha-from DIR` keeps the alpha of the atlas already in DIR (its glazing was
measured against that glass), the relief in DIR stands unless `--relief rebuild`, and
`check-atlas.py` must pass before anything is copied. Without `--publish` the same config builds
its own glass and relief, which is the identity run below. Other rooms' alpha is always their
own glass mask.

**A wall no station sees.** `label-views.py` labels a block from the stations that see it, and a
wall none sees (a nook round a corner, a face behind a screen) comes out with no labelled block.
`project-walls.py` then has nothing to level or colour and ends in its own statistics, with an
`IndexError`; the Grand Hall has no such wall. The room build reads the label step's own report and
stops there by name, after the labels and again before the photographs, saying what a station
needs in order to label a wall. `check_room.py`, given the manifest, warns of it before any work:
it tries lines of sight in plan from every station to five points along each wall (within
`projection.walls.maxDist`, no more edge-on than `cosMin` allows, with no solid wall or partition
of the outline between; a doorway station looks through its own wall). A plan knows nothing of
furniture, door leaves or a screen seen over, so that is a warning and the label step decides. On
the four rooms measured so far it names two walls, the Robert Adam Room's `nook-5` and `nook-6`,
which a build of that room by another lane had found unlabelled (16 November 2026).

### The record: `survey.json`

`roombuild/publish.py` writes `build/survey.json` for every room and publishes it for a room whose
`survey.outputs.manifest` names it (the Grand Hall's is `null`: its folder gets its nine files and
its detail tiles, and no record). It is schema version 2, the version the web's reader takes. The
contract is that reader's code, `packages/web/src/components/surveyed-room/survey-record.ts` (a Zod
schema and its cross-checks, described in `docs/engineering/surveyed-rooms.md`); the record holds
everything a reader needs to place the published files, and more that it drops.

| Key | What it says | From |
| --- | --- | --- |
| `schemaVersion` | `2` | |
| `slug`, `revision`, `captured` | the room, the survey's revision (an integer from 1), the capture's date | `slug`, `survey.publish.revision`, `source.captured` |
| `room` | `name`, `venue`, `ceilingHeight`, `outline` (the wall faces' corners in planner x, z, counter-clockwise seen from above) | `name`, `venue`, `ceiling.height`, `walls.vertices` |
| `walls[]` | one per outline segment, **in outline order**: `id`, `reliefId`, `length`, `height`, `kind`, and `atlas`, its strip's top-left texel, width and height | `walls.segments`, the atlas's layout |
| `atlas` | `size`, `ppm`, `vRange`, `row` (a strip's height), `files` (the atlas at each published size, **largest first**), and for the record `alpha`, `alphaFrom`, `packing`, `writeOrder` (the walls in the order their strips were written) | `survey.atlas`, `survey.outputs.walls` |
| `relief` | `container`, `file`, `order` (the entries' ids), and the meshing's `ppm`, `vRange`, `depthRange`, `simplifyError` | `survey.relief`, `survey.outputs.relief` |
| `ceiling` | `extent` (the outline's bounding box, which the ceiling view covers exactly), `orientation`, `files` largest first, and `relief` (`file`, `id`, `reference`, `heightRange`, `ppm`, `convention`) where there is one | `survey.outputs.ceiling`, `survey.ceilingRelief` |
| `floor` | `extent`, `orientation`, `files` largest first | `survey.outputs.floor`, `survey.floorPhoto` |
| `detail` | `folder`, `texelMetres`, `tileTexels`, `gutterTexels`, `tiles` (a count), `totalBytes`, and `index`: the tiles' index (`file`, inside the folder, with its `bytes` and `sha256`) | `survey.outputs.detail`, `detail/index.json` |
| `files` | every published file in the room's folder: `bytes`, `sha256` | the files in `proj/` |
| `openings[]`, `glassScan` | each window's glazing and glass planes; what the scan said about them | the config, `build/glass.json` |
| `configSha256`, `methodRevision`, `tools`, `linkedInputs` | the config the files were built from, the method's revision, the tools' commit and the meshoptimizer behind each GHR1 file, the inputs taken from another work directory (`linkedInputs`: name relative to the work directory, `how` it was linked, and its `sha256` where `build/linked.json` has one; never the tree it came from) | `build/linked.json` |

- **Orientation.** Both overhead photographs have their columns along planner +x and their rows from
  planner +z (the top row is the extent's highest z): `"columns planner +x, rows from planner +z"`.
- **The floor's extent** is the rectangle its texels cover, not the bounding box: the floor
  projection lays whole texels of 1 / `floorPhoto.ppm` from the box's lowest x and highest z, so the
  photograph ends up to half a texel short of or past the other two sides (the Saloon's reaches
  x 6.095667 for the outline's 6.095 and z -3.736 for -3.734). The web's reader, and
  `record_faults` with it, lets a photograph stop 5 mm short of the outline. That is more than half
  a texel only above 100 texels per metre (4.17 mm at the 120 all four rooms use; at exactly 100 half
  a texel is 5 mm, and float rounding decides), so a coarser floor photograph can be refused though
  it is whole: keep `floorPhoto.ppm` at 101 or more for a room that publishes a record (just above 100
  is not enough: the extent is rounded to a micrometre, and outlines on a micrometre grid were found
  refused at 100.0001 and 100.001, none from 100.01 up). The extent
  depends only on the outline and `floorPhoto.ppm`, so the build's check lays it as publish will and
  refuses such a room's config, before any build, when the reader would refuse its floor.
- **Largest first** is by pixel count, whatever order the config lists the sizes in.
- **`files` holds plain names only.** The detail tiles' index lives in the detail folder, so it is
  in `detail.index` (version 1 listed it in `files` as `detail/index.json`, which the reader's rule
  for file names refuses).
- **The record names nothing on the build machine.** It is published into a public repository, so
  `linkedInputs` is `{"data/manifest.json": {"how": "hard link"}, ...}`: each input by its name
  relative to the work directory, how it was linked, and its `sha256` where `build/linked.json` has
  one. The tree an input came from stays in `build/linked.json` (which `prove-build-identity.py`
  reads). `record_faults()` refuses any string key or value anywhere in the record that is an
  absolute path (a drive letter and `/` or `\`, a UNC `\\`, or a leading `/` and a name; URLs,
  relative names and a lone `/` are not), and `--publish` then copies nothing.
- **An open segment** has no elevation: its wall is recorded in its place with `atlas` and
  `reliefId` null, which no reader can draw yet (the reader wants a strip and a relief for every
  segment).

`publish.record_faults` repeats the reader's refusals. First its shapes, field by field with the
reader's types: a string is a string matched whole as JavaScript matches it (no final newline, ASCII
digits), `captured` is a day on the calendar, a number is finite and never a bool, a strip's texels
are whole numbers from 0 and sizes and counts whole numbers from 1. Then, on a record whose shapes
hold, its cross-checks (one wall per segment and its length, the strips, the relief's order, every
named file listed, largest first by bytes), with the reader's tolerances: a T0 test
(`ReaderTolerances`) reads them out of `survey-record.ts` and compares. It never skips: a reader
that is missing, or that no longer exports one of the four as a plain number on the one line that
declares it (a rename, a dropped rule, an old value parked in a comment above the new one), fails
it. Only those four are tied: the step's other copies of the reader's rules (the schema version,
the patterns for a file's name, a slug and a hash, the twelve bytes of a relief's id) are compared
by no test, and a change to one of them in the reader alone shows only when a record the tools
wrote is read by the web's own parser. It judges the record as the published JSON reads. For a
room that publishes its record, writing it prints any fault and `--publish` refuses it with
nothing copied.
A fault a config can carry is refused before any build: `check_room.py` matches the schema's
patterns whole in the same way and holds every date (`source.captured` among them) to the
calendar, and the schema takes `survey.publish.revision` from 1 only; for a room that publishes its
record, the build's own check also refuses a config with no revision.
The proof that the reader takes a real record is its own parser run over it: see Proofs.

`SURVEYED_ROOMS_TEST_DEPTH_SIZE` (tests only) shrinks the depth maps (gate B21);
`SURVEYED_ROOMS_NODE_ROOT` meshes the relief with another checkout's meshoptimizer (gate B22).
Both are recorded in the ledger, and `--publish` refuses either. `survey.json` records the
meshoptimizer version that simplified each GHR1 file. `--publish` also refuses glass that the
scan disagrees with.

The Grand Hall's scripts in `tools/grand-hall-survey` still build it with `build.sh`. Five of them
carry a seam for this driver, each with its old value as the default: `project.py` (`VIEWS`, the
folder `load_views` reads; `STATION_IDS`, a room's stations in place of scan 0 to 48), `bestview.py`
(`COS_MIN`, `MAX_DIST`, the two limits `visibility` held as literals; `OCCLUDER_MARGIN`, 0.0, with
the functions that apply it), `label-views.py` (its statistics and texel labels read
`bestview.OCCLUDER_MARGIN`: at 0.0 they run as written, B25), `pack-detail.py` (`ATLAS`,
the atlas file's name; `GLASS_STRIPS`, the glazed walls' strips, where it assumed the window wall
at the atlas's origin; its wall loop reads `LENGTH`) and `project-detail.py` (`SRC_COLUMNS`, empty:
the orthophoto columns of a wall whose tiles are narrower than its rounded length, B23). The steps import `project.py`, run the
walls' scripts whole (above), use `window-relief.py`'s and `wall-depth.py`'s helpers and
`fetch_inputs.py`, call `dump-mesh.mjs`, `render.mjs`, `surface-offset.mjs` and `page-server.mjs`,
and port the rest of the scripts' statements with their literals replaced by config values.

### Gates and the ledger

Every code path the Grand Hall never used sits behind a gate. `build/ledger.json` lists the
gates a config opens, computed before any work; `--plan` prints them and writes nothing;
`--expect-legacy` refuses to run unless the ledger is empty.

| Gate | Opens when | What changes |
| --- | --- | --- |
| B4 | a wall is not axis-aligned in E57 | depth by dot product; fins move along the normal |
| B5 | a wall is shorter than 1.1 m | no corner fin search |
| B6 | a wall end is a reflex corner | no fin search at that end |
| B7 | `methodRevision` ≥ 2 | corner statistics ignore window and arch openings and open doors |
| B8 | a wall is shorter than 2.0 m | corner intrusions take reference 0 |
| B9 | a wall end is a reflex corner | no intrusion clearing at that end |
| B10 | glazing other than clear | the glass mask from `opening.glass` (any of its planes), two planes honoured, checked against the scan; the wall keeps every detail tile (a wall with clear glazing leaves out the tiles that are all glass, where the planner shows the city) |
| B11 | a clear window with a segmental head | the colour test with a segmental outline |
| B14 | no `atlas.placement` | strips packed on shelves (next-fit, then first-fit decreasing), 8-texel gutters repeating the edges |
| B16 | `survey.ceilingRelief` | the ceiling's height field, meshed as a GHR1 entry |
| B17 | `floorPhoto` without `refill.shift` | floor refills skipped |
| B18 | the outline is not a rectangle | floor texels outside it leave the floor mask |
| B19 | boards run along z | refills roll along rows |
| B20 | a `copy` patch | the patch is taken from another wall, after every wall's own edits, in the atlas (which then holds every wall's orthophoto at once) and in the detail images (`roombuild/walls.py`) |
| B23 | a wall's tiles are narrower than its rounded length | each tile's width is rounded on its own, so the tiles can add up to fewer columns than `round(length x ppm)` (the Saloon's fireplace wall: 1556 against 1557). The Grand Hall's scripts count the wall's right end, its relief's width and its atlas crop from the rounded length, which lies inside its tiles (4227 of 4228); such a wall ends at its tiles' last column instead, in the corners, the relief, the atlas and the detail's mapping onto the atlas |
| B24 | `survey.wallViews.strayTexels` is set | the corners step leaves out of each elevation tile (uncovered, as where the mesh has a hole) the covered texels whose rendered point lies more than 1 mm from the texel's own centre, up to that many a tile, and lists them in `build/stray-texels.json`; a tile with more stops the build. `render.mjs` draws a surface seen edge-on (the floor under a wall) as a sliver less than a texel high and can extrapolate along it, so the point it writes lies metres off the view's slab and millimetres off the texel. The labels and the photographs place every texel at its centre and refuse a tile with one elsewhere (`bestview.Grid`, as before): that check is unchanged and still runs on what the corners step wrote |
| B25 | `survey.projection.walls.occluderMargin` is set | the walls' labels count a station's view of a texel only where nothing nearer stands within that margin of the ray, measured at the occluder (`bestview.OCCLUDER_MARGIN`, `occluder_cube`, `clear_of_occluders`; `label-views.py`). The scan's mesh outlines a thing standing proud of a wall smaller than the panoramas show it, so along the edge of the zone it hides from a station, the station's photograph still shows the thing on wall the mesh says is in view; one station a block prints that rim sharply, far from the thing. A surface counts as an occluder when it is nearer than the texel by more than the visibility test's tolerance plus what the wall's own slope explains over the margin. That allowance is the wall's alone, so a floor, a ceiling, a side wall or a pilaster's flank that meets the wall counts as an occluder of the texels beside it, though it hides nothing: a known cost, a band along every such junction about as wide as the margin, in which a station that faces the wall loses its view (0.50% of the views in an empty room at 50 mm, all within 5 cm of a junction; measured under "Real data, the ghosts above the Saloon's pediments"). The margin is looked for in a square of up to 16 cubemap texels round the ray, measured with the ray's own texel: along the square's diagonals it reaches up to 1.4 times the margin, and it reaches the margin in full only where the occluder stands far enough from the station (for 50 mm on 1024-texel depth maps, 1.6 m at a cube face's centre, 2.7 m at the middle of an edge and 3.65 m in a corner; nearer than that it is what 16 texels span there, at half a metre 16 mm at a face's centre and 7 mm in a corner). `labels-<wall>.json` counts the views the margin left out and those of them for which it was so capped; that second count is of views left out, and says nothing of the views the cap let through (a view whose occluder lies beyond the 16 texels, though within the margin, counts as clear). A texel none of its block's six ranked stations sees clear takes the first station of the block's whole order that does (`clear_views`); a texel that stations see, but none of them clear, takes a doubtful view, the first station of its block's sequence that saw it (`doubtful_views`; `doubtful_sequence`: the block's ranked stations, then every station by how much of the block it saw at all, in a stable sort where a tie goes to the earlier station, so that a build made again is the same build), so nothing a station saw becomes a hole; `labels-<wall>.json` counts both under `occluder_margin`, with how far the doubtful views given pass from the occluder's outline (`bestview.occluder_clearance`), which is reported and decides nothing |
| B21 | `SURVEYED_ROOMS_TEST_DEPTH_SIZE` is set | test-sized depth maps (never published) |
| B22 | `SURVEYED_ROOMS_NODE_ROOT` is set | another checkout's meshoptimizer meshes the relief (never published) |

The Grand Hall opens none. The Saloon opens B5 (4 returns), B8 (4 returns), B6 and B9 (8 reflex
ends), B7, B10 (3 bays), B14 (a 4096 × 2304 atlas), B16, B17, B18, B23 (the fireplace wall),
B24 (up to 8 texels a tile; its renders hold two, both in `wall-fireplace-0`) and B25 (a margin of
50 mm).

## Proofs

`prove-grand-hall.py` (config against sources, 13 November 2026): the views from the config are
identical to the committed files (`views-walls.json` `11526451…a40a61`, `views-ceiling.json`
`bc496802…3814c9`), and 174 values read from `hall-spec.ts`, the survey scripts and the web
modules match the config exactly, including the canvases against `canvasveil.py`, the detail grid
against `project-detail.py` and `pack-detail.py`, and `survey.outputs` against `build.sh` and the
`pack-*.py` literals. Three values are no longer compared because master's web model no longer
holds them as numbers (each window's `sunLimitDeg`, the main door recess's `leafPlane` and its
opening); the build reads none of them.

`prove-build-identity.py --static grand-hall.room.json --manifest <the twin's manifest.json>` (or
`SURVEYED_ROOMS_MANIFEST`): 137 checks, none different. Every table the steps derive from the
config equals the old scripts' literals, including on the real manifest the 49 stations' positions
and gains bit for bit (and `project.stations()` gives the same list with the room's `STATION_IDS`
as it does as written), the floor's 3.2 million texel positions and the dome's 3.1 million texel
positions and normals bit for bit, the atlas layout and write order, the relief job, the
projection arguments per surface, and every global the driver points at the room in
`bestview.py`, `canvasveil.py`, `project-detail.py` and `pack-detail.py` (each wall's origin, u
axis and normal as float arrays, bit for bit). It also compares `build.sh`'s scripts, in order,
with the driver's sub-commands, in order, the steps each holds to one BLAS thread, and the commands
a pinned publish runs. It notices a
changed occluder, patch, floor scale, atlas order, relief order, projection argument, wall
visibility limit, canvas, detail grid, station or elevation top.

`tests/test_gh_scripts.py` (T2): on synthetic inputs at the real views' sizes, the old scripts
and the driver's steps give identical files throughout: all twelve tiles' corner fixes; the end
wall's labels (four stations label it, 9,212 seams, 11,220 blocks swept), its 2.5 mm and 5 mm
orthophotos (6,922 seam equations, 1.4 million texels in the seams' membrane) and its canvas
report; the ceiling, the dome's texels and the floor at 30 px/m; the window glass and layers; the
atlas PNG and WebPs (the end wall from its 2.5 mm orthophoto, the others from a 5 mm blend), again
with `--alpha-from`, and again with a canvas's field; the four relief maps and the GHR1 file (byte
for byte, both through the same meshoptimizer); the ceiling and dome WebPs; the flattened floor
and its WebPs; the end wall at 2 mm, and the 459 detail tiles with their index (three all-glass
tiles of the window wall left out by both). The whole-tree comparison then finds no file
different. `SURVEYED_ROOMS_OLD_SCRIPTS` points the old side at another commit's export of
`tools/grand-hall-survey`, to set this checkout's steps and seams against that commit's scripts.

Real data, the Grand Hall's end wall (14 November 2026): the twin's manifest, its 49 panoramas, the
1024 depth maps and the rendered positions, through `tools/grand-hall-survey` as it stood on master
before any seam and through the driver's steps with this checkout's scripts, both with BLAS at one
thread. The corners step gives identical corrected positions for all 12 tiles of the four walls
(55,104, 24,790, 37,364 and 22,787 texels moved on the window, door, end and fireplace walls). The
end wall's labels are identical in all 21 arrays, and the two `labels-end.npz` files are the same
bytes (45,419 blocks labelled from 35 stations, 8,763 seams). Its photographs are identical in both
tiles' 2.5 mm and 5 mm orthophotos (2,881,261 of 2,882,987 texels coloured from 39 stations, 4,820
seam equations). That is 43 arrays in 19 files with none different, and the run reports agree
apart from their timings. On the machine that ran it the labels took 6.0 minutes and 976 MB, the
photographs 2.1 minutes and 861 MB. On the morning of 15 November the end wall's canvas (its
report and five arrays) and its 2 mm image (its report and one array) were built both ways as well
and are identical, which makes 23 files and 49 arrays with none different.

Real data, stray texels (15 November 2026). The Saloon's fireplace wall stopped in its labels: of the
868,824 covered texels of `wall-fireplace-0`, two (row 1121, columns 12 and 13, below the floor line
at the wall's left end) hold points 0.74 / 1.64 mm and 1.75 / 3.63 mm off their centres, 2.45 m and
5.82 m behind the camera, where the view's slab runs from 0 to 2 m in front of it: the floor, seen
edge-on. Every other covered texel of the Saloon's 16 tiles lies within 0.19 mm of its centre, and
every one of the Grand Hall's 12 tiles within 0.42 mm (nearly all within 0.16 mm, 1/32 of a texel).
With gate B24 the corners step left the two out and the wall was labelled (27,357 blocks, 5,061
seams); the Saloon's twelve walls were then labelled and coloured, each process under 1 GB. With
this change the driver's corners step was run again on the Grand Hall's 12 real tiles, twice, and
both times wrote the 12 corrected-position files master's script writes. Those two runs computed
the 12 corner files and nothing else. The comparison they print (23 files and 49 arrays, none
different) also holds the end wall's other 11 files, which are that morning's results and were not
computed again: its labels, photographs, canvas and 2 mm image stand because only the corners
step's code changed after them.

Real data, the record (16 November 2026). The Saloon's `build/survey.json`, written by `publish:1`
in the work directory of its best-view build (12 walls, a 4096 x 2304 atlas, 288 detail tiles), was
read by the web's own parser: one test beside `survey-record.test.ts` on the web's branch, calling
`parseSurveyRecord` on the file as written. It took the record (40,999 bytes, SHA-256
`4fca8c2e641d22824bc821b8d944142443f8e5004c6cab53ed21772935fe4518`), and as controls refused the
same build's version 1 record ("schemaVersion is 1; this reader reads version 2") and this record
with `detail/index.json` put back among `files` ("Invalid key in record"). The parser reads the
record only: that the files it names are the ones in the folder, with those sizes, is the
loader's to check in a browser, and that record was built with a borrowed meshoptimizer (gate
B22), so it is a proof of the record's form and not a published room.

Real data, the ghosts above the Saloon's pediments (16 November 2026). The best-view walls of the
Saloon carried, in the plain plaster above every pediment, outlines like a displaced copy of the
pediment's top; the blend's plaster was clean there. Measured on the fireplace wall's 5 mm
orthophoto, in sRGB levels of luminance, over plaster only (relief under 10 mm): round the middle
pediment (u 2.72 to 5.08 m, v 2.92 to 4.12 m; 83,183 texels) the mean step between neighbouring
texels was 0.807 against the blend's 0.177, and 23.4 of every 1,000 neighbouring pairs stepped by
more than 4 levels against 1.3; over the plaster above all three pediments (u 0.3 to 7.5 m, v 3.3
to 4.3 m; 280,344 texels) 0.504 against 0.144, and 12.4 against 1.4.

- Where: the pediment stands 90 to 322 mm proud of the plaster. Three stations 1.4 to 1.65 m off
  the wall and 1.46 m high label 85% of the box; from them the pediment's top hides the plaster
  up to half a metre above it, which is where the outlines are.
- Not the visibility test. Rays from each of eight stations to the box's 113,190 texels against
  the mesh dump (Moeller-Trumbore, the measuring scripts' `cast`; no depth map) agree with
  `bestview.visibility` on 98 to 99% of them. The rest are the test's own allowances: 376 to 2,645
  texels passed though a ray is blocked, by 21 to 124 mm and always under its tolerance, on the
  pediment's own mouldings; 872 to 2,413 hidden by its 3 x 3 minimum. The 1024-texel depth maps say
  what the mesh says.
- Not the seam levelling. Coloured again from the same labels with the global adjustment and the
  local blend off, the box's plaster kept its outlines: 23.3 pairs in 1,000, mean step 0.739.
- The mesh's outline. The scan's mesh (330,200 triangles for the building, about 800 in reach of
  the box) draws the pediment smaller than the panoramas show it. From each of the three near
  stations, 1,186 to 1,424 plaster texels that the station sees by the mesh show in its panorama
  the pediment's dark edge (under 85% of the station's own clean plaster), on both flanks of the
  arch, so it is not a shifted pose; from the two stations 3.5 m off, 54 and 60; from one 5.7 m
  off, none. Every one lies within 9 cubemap texels of the pediment's outline in its station's
  depth map (99% within 7). Another 193 to 920 a near station show the glow of the lamp on the
  pediment (within 13 texels).
- Why one station a block prints it. On the plaster blocks a near station covers that carry its
  rim, its Laplacian energy is 7.7 to 12.8 against 0.29 to 0.38 on its other plaster blocks, so its
  data cost there is the least of any station's (median 0.0), and the labels' occluder test, which
  compares block means, kept it in 72 of 74 such blocks. The blend's consensus pass weighs the same
  texels down in each of some twenty stations, whose rims fall in different places.
- The cure is gate B25, and the Saloon's margin is 50 mm. Measured on the box with the gate's own
  functions: a margin of 20 mm still leaves 6, 0 and 16 of the three near stations' rim texels and
  388, 111 and 3 of their glow texels; 30 mm leaves no rim texel and 178, 19 and 0 of the glow;
  40 mm leaves 33, 0 and 0; 50 mm leaves none. So 30 mm is the least that clears the pediment's
  edge and 50 mm the least that also clears the lamp's glow. At 50 mm the margin takes 10,349 to
  11,952 clean plaster texels out of each near station's 63,000 to 67,239 on the box (5,412 to
  6,257 at 30 mm), which other stations then colour.
- After, the fireplace wall labelled again at 50 mm (27 stations, 1,737,186 valid texels). Of the
  rim texels of the seven stations measured, the labels gave 705 to their own station before and
  none after; of their glow texels, 404 and none. The box coloured straight from the labels (each
  texel from its label's station, one sample, no feather and no levelling, so that only the labels
  differ): the mean step on its plaster fell from 0.876 to 0.316 and the pairs stepping by more
  than 4 levels from 19.6 to 6.7 in 1,000; what is left lies along the unlevelled seams and
  within some 15 cm of the pediment itself. 3,617 texels of the wall (0.21%) took a doubtful view,
  555 of them in the box. The statistics took 109.1 s against 80.5 s (the step 2.9 minutes against
  2.3), at the same peak memory (784 MB against 788).
- Which view, where a block's ranked stations have none clear (19 and 20 November 2026). The
  labels above gave such a texel the first of its block's six ranked stations that saw it at all.
  The near stations lead a block's ranking and are the ones whose panoramas show the thing's edge,
  and a wall here has up to 27 stations, so a clear view from one of the other 21 was passed over
  and the rim could be printed again, right beside the thing. Measured on the labels of the
  Saloon's twelve walls made that way (50 mm; 8,548,148 texels): 41,787 texels took a doubtful
  view, and for 1,367 of them a station outside the six had seen the texel clear (420 of 3,118 on
  window-rear-end, 323 of 8,292 on rear, 226 of 9,068 on front, 180 of 4,467 on fireplace, 156 of
  8,317 on fireplace-rear-end, 51 on window, 11 on window-front-end, none on the other five). The
  reports' own counts were 563 higher over the twelve walls: views given from outside a ranking
  that were in fact clear. Two steps answer it.
  - First, a texel takes the first station of its block's whole order that saw it clear
    (`clear_views`), whichever station that is. A block the margin leaves without a label has no
    ranking, and `whole_order` lists its stations by how much of it they saw clear. That is a guard
    only: while the candidates' rule keeps the station that covers a block best, a block without a
    label has no clear texel at all, and none of the Saloon's 5,825 such blocks has one.
  - Second, only a texel that stations saw, and none clear, takes a doubtful view. Which one was
    settled on real walls, and not as first written. As first written (19 November) it was the
    view that passes farthest from the occluder's outline in its station's depth map, chosen on a
    synthetic wall (a pediment 0.3 m proud and a pilaster 0.15 m proud, the mesh 2 cm short, 7
    stations, 1024 depth maps, 50 mm). There the texels whose label's panorama shows a box were 99
    without the margin, 211 with the first step missing and 51 with both steps; 49 of the 51 have
    no seeing station with a clean photograph at all (45 doubtful views and 4 clear ones), one is at
    a corner where the outline distance misorders two stations, and one is a near station's view
    that the 16-texel cap counts clear. The Saloon was then built twice from the same inputs, with
    the first step missing and with both (20 November), and its walls did not bear the second step
    out.
    - The labels were exactly what the change foretold: the same statistics on every wall, the
      second build's texel labels equal to a forecast made from the first build's arrays on all
      8,548,148 texels, no doubtful texel with a clear view from any station (1,367 before), and no
      texel a station saw left without a label (237 before).
    - The photographs were worse where the second step acted. Every texel whose station changed
      was set, in each build's own photograph, against its clean surroundings
      (`measure/walls/compare_builds.py`; 12,910 such texels are left to be seen, outside the
      config's patches). Where a doubtful view became a clear one (487 texels) the dark texels fell
      from 75 to 53. Where one doubtful view became another (12,340) they rose from 1,021 to 1,495,
      the texels more than 12 levels off from 1,631 to 3,168, and 5,228 texels moved farther from
      their surroundings against 3,429 nearer, on all eight walls the step touched. A new dark
      band 37 cm by 4.5 cm stood on the window wall's plaster where the first build was clean. The
      measure is loose beside mouldings, where it calls 18 in 100 clean texels dark and 24 in 100
      off: these are the same texels against the same surroundings in two builds, not absolute
      counts.
    - The noise. The same texels as pairs (worse / better / as they were, with the exact sign
      test on those that changed), where one doubtful view became another: dark 841 / 367 /
      11,132, off 2,295 / 758 / 9,287, farther from their surroundings by more than 2 levels
      5,228 / 3,429 / 3,683. A patch of texels that changes station changes together, so texels
      are not independent pairs and those counts overstate the evidence. With the connected patch
      as the unit (387 patches; one is worse where more of its texels turned worse than better):
      dark 50 / 33 / 304 (p 0.08), off 139 / 72 / 176 (p 0.000005), farther 198 / 133 / 56
      (p 0.0004). So what is beyond chance is that the step pushed texels off their surroundings,
      patch after patch; the rise in dark texels is within chance by patch, and 495 of its 841
      are the window wall's. Wall by wall the patches are few (9 to 123) and four of the eight
      walls pass 0.05 on a judgement or two: the fireplace wall (off 43 / 18, farther 65 / 37),
      its front end (farther 8 / 0), its rear end (off 10 / 1, farther 11 / 2) and the window
      wall (off 24 / 11); on no wall is the second build the better beyond chance. Where a
      doubtful view became a clear one (the first step; 131 patches): dark 4 / 13 / 114 (p 0.05),
      off 18 / 25 / 88 (p 0.4), farther 40 / 62 / 29 (p 0.04). And what two builds do to a texel
      that neither moved: of 150,919 clean texels beside the changed ones, whose station is the
      same in both, 491 turned dark and 526 stopped being (p 0.3), 469 turned off and 703 stopped
      being, 2,272 moved farther and 3,198 nearer. The second build's untouched wall is, if
      anything, slightly nearer its surroundings, so the changed texels' loss is not a drift of
      the whole photograph.
    - What the study supports. Every doubtful texel was then sampled from every station that saw
      it, and each view judged against its own station's clean wall beside it, which leaves
      exposure out (`measure/walls/doubtful_rules.py`; 28,250 doubtful texels left to be seen,
      15,974 of them judged under every rule). Three things are measured. Whichever rule picks
      the view, it shows the thing's edge about as often: 50 dark in 1,000 for the first ranked
      station that saw the texel, 52 for the farthest view, and 50 to 52 with a floor of 10, 20
      or 30 mm of clearance. A view's clearance says little above 10 mm (dark in 1,000 of all
      the views judged: 309 under 10 mm, which is 427 views; 86 at 10 to 20 mm, 74 at 20 to 30,
      63 at 30 to 40, 71 at 40 to 50), and a station's distance says far more: 604 from under
      1.5 m, 525 at 1.5 to 2.5 m, 278 at 2.5 to 4 m, 105 at 4 to 6 m and 42 beyond 6 m (131,172
      views). And the rules differ in how many texels they take from a station other than their
      block's own: 5,365 for the ranked station, 12,221 for the farthest view. The reading these
      support, which is a reading and not a thing measured: a texel-sized island of another
      station's picture is not levelled with its neighbours as a block is, and that is what
      shows. The band on the window wall fits it: in the first build 529 of its texels came from
      a station almost square to the wall (a ray of 6.1 m, cosine 0.96, 33 mm clear at the
      median), and in the second 539 came from one far along it (8.8 m, cosine 0.79, 36 mm), a
      frontal view given up for three millimetres. Nobody has yet levelled the islands and
      looked again, which is what would prove it. And no rule of this kind comes near the best
      choice a texel could have (31 dark in 1,000 against 50: the view nearest its own station's
      clean wall, which takes 13,856 texels from another station). That would take a rule that
      reads the photographs, a vote across each texel's views with the seams levelled at the
      scale of a texel: a later piece of work (T-740).

    So the second step is the first build's own again. The acceptance set for it (20 November)
    was that among rules within noise of each other on real walls the simplest wins, and by the
    study's count no simple rule is the better on the rim. A texel takes the first station of
    its block's sequence that saw it (`doubtful_sequence`): the block's ranked stations (a block
    without a label borrows the nearest labelled block's), then every station by how much of the
    block it saw at all. That second part is a stable sort in which a tie goes to the earlier
    station of the stations' own order, so a build made again is the same build. Run on the two
    builds' own arrays, the rule gives the first build's view on every one of the 40,520
    doubtful texels that had one, and the second build's clear views everywhere else.
    - The former holes. The first build's sequence stopped at the six stations that saw most of
      a block, and so left 100 texels that a station had seen, none clear, without a label
      (fireplace 10, fireplace-rear-end 6, fireplace-rear-return 1, front 17, rear 64,
      window-front-end 2), which the atlas step filled from their neighbours. (A block's six
      ranked stations do not see 6,169 of the 40,520; the six that saw most gave 6,069 of those
      a view.) The longer sequence gives each of the 100 a view, from a station at place 12 or
      later. View against fill, each set against the texel's clean surroundings: 64 of the 100
      lie under a patch of the config and are never seen, and of the 36 left only 10 have enough
      clean neighbours to be judged. On those the view is dark on 4 and off on 5, and so is the
      fill; the view lies 19.8 levels from its surroundings at the mean and the fill 34.7; the
      view is the nearer by more than 2 levels on 5 and the fill on 1. The fill wins on no wall,
      so the longer sequence stays: on a sample of ten.
    - The synthetic wall says the opposite, and its count is no bar for this step any more. The
      texels whose label's panorama shows a box are 113 with this rule, against 51 with the
      farthest view, 99 with no margin and 211 with the first step missing: by that count this
      rule is worse than no margin at all. Texel by texel against no margin: 69 of the 113 show
      the box there too, from the same station; the other 44 all lie in blocks that the margin
      ranks differently (28 of them in blocks whose own label changed; 43 are doubtful views and
      one a clear one). None was a hole without the margin and none is left unexplained. The
      margin changes what a ranking is made from, since a station's cover of a block is its
      clear cover: 251 of that wall's 475 blocks rank differently and 95 take another label,
      while 418 of the 499 doubtful texels keep the station they had without the margin. Of the
      99 without a margin, 69 are those carried over, 8 no longer show the box (2 by a clear
      view, 6 by another doubtful one) and 22 show it from another station. That wall's
      panoramas are drawn from the true geometry with one exposure and exact poses, so there
      another station's picture costs nothing and a view's clearance is all there is to choose
      by; on the Saloon's photographs the farthest view measured worse (above). The two worlds
      disagree and the real one decides. What the synthetic one can prove is kept, as gates and
      with no bound loosened: no doubtful texel that any station saw clear, no plain texel that
      shows the pier (exactly 0), and a margin of 0 that changes nothing.

    A rule for this step is to be judged with those scripts on a real room's builds before it is
    changed again.
- A known cost: the junctions (found in this gate's review, 19 November 2026). The margin's
  allowance for slope is the wall's own. Where another surface meets the wall in a concave
  junction (the floor, the ceiling, a side wall, a pilaster's flank), that surface stands nearer
  beside the ray by what its own slope explains, which for a station that faces the wall is far
  more than the allowance: it counts as an occluder and the view is left out, though nothing is
  hidden there. In an empty synthetic room (a box of 6 x 4 x 3 m with no occluder, so every view
  left out is wrongly left out; 7 stations, 1024 depth maps, 210,000 views of one wall on a 2 cm
  grid) a margin of 50 mm left out 1,054 views (0.50%), every one within 5 cm of a junction with
  the floor, the ceiling or a side wall (7.8% of the views in that band) and 1,002 of them from
  stations within 37 degrees of head-on; 80 mm left out 3,286 (1.56%), within 10 cm; and 200 mm,
  the most the schema allows, 4,904 (2.34%), within 20 cm. None of the three left out a view
  0.2 m or more from a junction. The band grows with the margin. Such a texel goes to a more
  oblique station, which is softer, or, where every station faces the wall, keeps a doubtful
  view. The margin is not changed for this: the Saloon's 50 mm was measured with the margin as
  it is defined. The method it follows masks a view at depth discontinuities only, which a
  crease is not; seeding the margin there would spare the junctions.
- The lettering is not worse. The margin also takes views beside everything else that stands
  proud (the columns between the boards, the shelf above them, the mantel clock: 7 to 13 cm), so
  17.8% of the wall's texels changed station. The commonweal board coloured from each set of
  labels as `project-walls.py` samples it (2.5 mm, no feather, no levelling): over its lettering
  (u 3.60 to 4.10 m, v 2.33 to 2.75 m) the mean |Laplacian| of luminance is 39.29 before and 39.32
  after, the mean step 13.12 and 13.14, and 0.75% of the samples differ (one block); over the
  whole board (to v 1.75 m) 23.57 and 22.94, the difference lying round the clock at its foot.
- The Grand Hall: its config gives `bestview.OCCLUDER_MARGIN` the script's own 0.0 and its plan
  still prints an empty ledger. On real data, 18 November, with this change's code as it then
  stood: the driver's labels and then its photographs of the hall's END wall were run again on
  the twin's panoramas and distance maps. That computed 7 files and 31 arrays anew (the labels'
  report and their file of 21 arrays; the photographs' report and the two tiles' 2.5 mm and 5 mm
  orthophotos, 10 arrays). They were compared with what master's scripts gave before any seam,
  together with 16 earlier files from steps this change does not touch (the 12 corner files of
  13 November, and the canvas's and the 2 mm image's reports and arrays of 15 November): 23 files,
  49 arrays, none different (every array bit for bit; the run reports less their timings and
  memory). After the review's changes to the margin's labels (19 November), `label-views.py` was
  set against the reviewed one on a synthetic wall with 7 stations, with the margin absent and
  with an explicit 0.0: the same 21 arrays and report, and the same bytes in the file. The real
  END wall has not been run again with them.
  On 18 November on the reference machine, with the twin's manifest and an installed checkout's
  meshoptimizer: T0 52 tests, T1 and T4 54, T3 16, none failing and none skipped. T2 was not run
  again; the real END wall is the stronger form of what its label stage shows.

Not yet proven, because it needs the whole build twice (hours of sub-commands on the shared PC):
identity on the real panoramas and mesh, end to end, including the depth renderer
(`render-depth-room.mjs`, so far only syntax-checked), the other three walls' labels and
photographs, the real atlas and the real detail tiles. Without a publish folder neither build pins its alpha, so the two trees
are compared with each other; the walls' run reports are compared less their timings and memory.
To prove it:

    bash tools/grand-hall-survey/build.sh <work-old>
    python -X utf8 tools/surveyed-rooms/build-room.py tools/surveyed-rooms/grand-hall.room.json <work-new> \
        --inputs-from <work-old> --expect-legacy
    python -X utf8 tools/surveyed-rooms/prove-build-identity.py <work-old> <work-new> \
        --published packages/web/public/rooms/grand-hall/survey-2026-07-11

The new tree takes the old one's manifest, mesh, mesh dump and panoramas (they are inputs, and
must match before anything is compared) and renders its own depth maps, so the 49 depth maps are
compared as outputs. The prover exits 0 only when every file was compared and is identical, 1 on
any difference, and 2 when everything compared is identical but some files were linked rather
than compared (`--reuse-depth`, or a file that is the same in both trees). If the depth maps
differ, check whether SwiftShader renders deterministically: render two stations' maps again
with the old script into a scratch copy and compare them with the old tree's. Then prove the
Python steps on their own with a second new tree built with `--reuse-depth`; its exit status 2
says that the depth maps were linked, not proven.

`build.sh` calls `python3`, which in Git Bash on Windows can be the Microsoft Store stub: put a
real Python 3 first on the PATH as `python3`. If the two trees match each other but not the
published files, the library versions have drifted (Pillow/libwebp, meshoptimizer), which is a
separate finding. The surface renders' run-to-run determinism (SwiftShader) is not established
either. `--digest` keeps a tree's digests, so both trees need not be kept.

## Tests

    cd tools/surveyed-rooms/tests
    python -X utf8 -m unittest test_static                 # T0, under a minute
    python -X utf8 -m unittest test_units test_gates       # T1 and T4, about a minute and a half
    python -X utf8 -m unittest test_small_room             # T3, about four minutes
    python -X utf8 -m unittest test_gh_scripts             # T2, about twenty-five minutes in all

T2 keeps each stage's results in the scratch folder, so its tests can be run a few at a time
(`python -m unittest test_gh_scripts.MiniGrandHall.test_02_labels`); its longest stage is the
atlas (about six minutes for four packings). T0 also covers the sub-commands: the list and its
ids, one run alone and recorded, and `--resume` skipping what is done, running again what
changed or failed, trusting nothing after a config change, and knowing a command again when
Windows spells its interpreter's path another way (`python.EXE` to one shell, `python.exe` to
another: a build begun from the first used to run again from its start when picked up from the
second). And the record
(`test_static.SurveyRecord`, on stand-in files): the Saloon's and the Grand Hall's records pass
`record_faults`, twenty-one spoiled records are each refused for their own reason, an open segment
is named, and publishing copies `survey.json` for the Saloon, none for the Grand Hall, and nothing
at all when the record would be refused.

CI runs T0, T1 and T4 in a job of their own ("Survey tools") whenever a change touches
`tools/surveyed-rooms` or `tools/grand-hall-survey`, because the room build runs the hall's own
scripts through seams and an edit to either folder can break the other, and whenever it touches
the web reader's `survey-record.ts`, whose four tolerances `publish.py` copies and T0 compares
(the step's other copies of the reader's rules are compared by nothing). There the cases that
need the twin's manifest skip themselves, and the run takes about half a minute (a hosted Linux
runner starts a process far faster than the Windows machine the times above were taken on). T2
and T3 are run by hand: they take about twenty-five and four minutes there.

Scratch goes to `SURVEYED_ROOMS_TEST_SCRATCH` (default: the system temp folder). The GHR1
comparisons and T3 need a Node install with meshoptimizer: this checkout's, or another named by
`SURVEYED_ROOMS_NODE_ROOT`. Without one they are skipped and say so. The `--static` proofs and
the manifest checks need the twin's manifest (`SURVEYED_ROOMS_MANIFEST`) and are skipped
without it.

T3 builds a 12-segment analytic room through the driver, from the corners to the record (its walls
by the best-view method at 100 px/m, its detail tiles 256 texels of 4 mm), checks the results
against the scene's own geometry and albedo, and ends with `--resume` on the finished tree. Every
run builds its own room, and one test holds that no sub-command on record is older than the run:
a tree left in the scratch folder was built by the tools as they stood then, and the suite once
judged a two-day-old build that way. `SURVEYED_ROOMS_TEST_KEEP=1` keeps a finished tree, for
working on one assertion without the two minutes' build each time; the `--resume` check is then
skipped, and a result from a kept tree is not one to report. The room is at quarter turn 1. It has two glass planes and a
transom, a box standing in front of the glass, an open door, a mirror patch and a cross-wall
copy patch, one coffer off centre in x and z, and a lamp painted only in the panoramas.

T4 builds a small room for each gate that neither the Grand Hall nor T3 opens:
- a plane change placed 8 cm off in either direction (no hole in the mask, and the disagreement
  is reported);
- the frosted-lower and sheer classes;
- a clear window with a segmental head (B11);
- stale masks and the glass digest;
- a chamfered wall through the corners step, then labelled and coloured (B4);
- walls whose tiles are narrower than their rounded length, through the corners, the relief, the
  atlas, the labels, the photographs and the detail (B23);
- two texels rendered off their own centres: refused by the labels without the allowance, left out
  by the corners step with it (the wall is then labelled and coloured), and refused again when
  there are more than allowed or the whole grid is in the wrong place (B24);
- a box 0.3 m proud of a plain wall, which the mesh draws 6 cm smaller on every side than the
  panoramas show it (a rim one block wide on the test's 1 cm grid, as the Saloon's is on its 5 mm
  grid): without the margin the box's dark edge is printed in the plain wall a third of a metre
  above it (1,280 texels); with `occluderMargin` (80 mm) the plain wall is clean, no texel loses
  its colour (2,182 keep a doubtful view, each one a texel no station sees clear), and the labels'
  files hold the views seen, the views clear and the doubtful ones given; the key is refused on
  any surface but the walls (B25);
- a pier 0.2 m proud over the wall's whole height, which the mesh draws 3 cm narrow, with eight
  stations, two more than a block ranks: six a little over a metre in front of the pier, which
  lead the ranking of the blocks at its flanks, and two 3.4 m off, which alone see the wall beside
  it clear. Without the margin the pier is printed on 1,800 texels of plain wall beside itself;
  with it (30 mm) the 1,208 texels that only a station outside their block's ranking sees clear
  take that station's view, none of the 672 doubtful views is of a texel any station sees clear,
  no plain texel takes a view that shows the pier, and the photographs colour every labelled texel
  (B25; labels that ask only the ranked stations leave the pier on 1,200 of them);
- a wall no station sees: the labels step and the photographs stop at it by name, and a wall that
  is seen is labelled and coloured as ever;
- a wall seen only through a gap of 8 cm in a screen 0.3 m in front of it: without a margin its
  strip is labelled (40 blocks); with a margin of 80 mm every view of it is within the margin of
  the screen's edge, no block is labelled, and the stop at that wall says that the margin is set
  and that 2,464 texels were seen only in views it does not count (B25);
- the floor refills' roll along z and along x (B19);
- the ceiling relief's fallback height, padding and spacing.

## Starting a room

1. Measure the outline, openings, ceiling and fittings from the mesh in E57; choose `centre`,
   `floorZ` and `quarterTurns` so the windows' wall is on −z where there is one.
2. Write `<slug>.room.json` and run `check_room.py` with the manifest until it passes.
3. Run `build-room.py ... --plan` and read the ledger; then build into a work directory.

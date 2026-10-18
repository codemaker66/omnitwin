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
        [--expect-legacy]
    bash tools/surveyed-rooms/build-room.sh <room.json> <work-dir> [<publish-dir>]

| # | Step | Runs (in the work directory) | The Grand Hall's script |
| --- | --- | --- | --- |
| 0 | check | `check_room` and the build's own checks; writes `room.json`, `views/`, `build/{stations,ledger,plan}.json` | `wall-views.py`, committed views |
| 1 | inputs | `roombuild/step.py inputs`, `dump-mesh.mjs` | `fetch_inputs.py`, `dump-mesh.mjs` |
| 2 | depth | `render-depth-room.mjs build/stations.json 1024 data/depth1024` | `render-depth.mjs` |
| 3 | surfaces | `render.mjs views/views-walls.json out-walls`, and the ceiling's | `render.mjs` |
| 4 | project | `step.py project-wall <name>` per wall, `project-ceiling`, `project-dome <id>`, `project-floor` | `project-*.py` |
| 5 | windows | `step.py windows`: the masks, the layers and `build/glass.json` (with the scan check) | `window-relief.py` |
| 6 | corners | `step.py corners` | `fix-corners.py` |
| 7 | atlas | `step.py atlas` | `pack-atlas.py` |
| 8 | relief | `step.py wall-depth`, `relief-mesh-room.mjs build/relief-walls.json`; with a ceiling relief, `step.py ceiling-relief` and its GHR1 | `wall-depth.py`, `relief-mesh.mjs` |
| 9 | overhead | `step.py overhead proj` | `pack-overhead.py` |
| 10 | floor | `step.py flatten-floor`, `step.py pack-floor` | `flatten-floor.py`, `pack-floor.py` |
| 11 | publish | `build/survey.json`; with `--publish`, the outputs (DIR must be `survey.publish.folder`) | the tail of `build.sh` |

Inputs and depth maps already in the work directory are kept. `--inputs-from` hard-links (or
copies) another work directory's manifest, mesh, mesh dump and this room's panoramas; the inputs
step then checks the manifest, mesh and panoramas against the manifest's SHA-256. Its depth maps
are taken only with `--reuse-depth`, because the manifest holds no hashes for them: by default
the depth step renders every map, so an identity run compares the renderers too. Every path
taken from another tree is listed in `build/linked.json` and in `survey.json`, and
`prove-build-identity.py` reports those files as linked, never as identical.

`--from`/`--to` run a span of steps (the check always runs, and refuses if the views changed
under rendered surfaces). `--from windows` or `--from corners` is refused while a wall uses the
clear colour test, because the corners step rewrites `proj/wall-*.npz` in place; restart from
`project`. Editing patches on a built room is `--from atlas`. Changing a window, its glass block,
the walls or the wall views needs `--from windows` (`--from project` with clear glazing): the
windows step records a digest of those facts in `build/glass.json`, and the atlas and relief
steps refuse masks made from other facts. It also deletes the masks of walls that no longer have
glazing. Every step's command, time, exit status and the digests of the files it wrote are
appended to `build/steps.json`.

`SURVEYED_ROOMS_TEST_DEPTH_SIZE` (tests only) shrinks the depth maps (gate B21);
`SURVEYED_ROOMS_NODE_ROOT` meshes the relief with another checkout's meshoptimizer (gate B22).
Both are recorded in the ledger, and `--publish` refuses either. `survey.json` records the
meshoptimizer version that simplified each GHR1 file. `--publish` also refuses glass that the
scan disagrees with.

The Grand Hall's scripts in `tools/grand-hall-survey` are unchanged and still build it with
`build.sh`. The new steps import `project.py`, `window-relief.py`'s and `wall-depth.py`'s helpers
and `fetch_inputs.py`, call `dump-mesh.mjs`, `render.mjs`, `surface-offset.mjs` and
`page-server.mjs`, and port the rest of the scripts' statements with their literals replaced by
config values.

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
| B10 | glazing other than clear | the glass mask from `opening.glass` (any of its planes), two planes honoured, checked against the scan |
| B11 | a clear window with a segmental head | the colour test with a segmental outline |
| B14 | no `atlas.placement` | strips packed on shelves (next-fit, then first-fit decreasing), 8-texel gutters repeating the edges |
| B16 | `survey.ceilingRelief` | the ceiling's height field, meshed as a GHR1 entry |
| B17 | `floorPhoto` without `refill.shift` | floor refills skipped |
| B18 | the outline is not a rectangle | floor texels outside it leave the floor mask |
| B19 | boards run along z | refills roll along rows |
| B20 | a `copy` patch | the patch is taken from another wall, after every wall's own edits |
| B21 | `SURVEYED_ROOMS_TEST_DEPTH_SIZE` is set | test-sized depth maps (never published) |
| B22 | `SURVEYED_ROOMS_NODE_ROOT` is set | another checkout's meshoptimizer meshes the relief (never published) |

The Grand Hall opens none. The Saloon opens B5 (4 returns), B8 (4 returns), B6 and B9 (8 reflex
ends), B7, B10 (3 bays), B14 (a 4096 × 2304 atlas), B16, B17 and B18.

## Proofs

`prove-grand-hall.py` (config against sources, 18 October 2026): the views from the config are
identical to the committed files (`views-walls.json` `11526451…a40a61`, `views-ceiling.json`
`bc496802…3814c9`), and 170 values read from `hall-spec.ts`, the survey scripts and the web
modules match the config exactly, now including `survey.outputs` against `build.sh` and the
`pack-*.py` literals.

`prove-build-identity.py --static grand-hall.room.json --manifest <the twin's manifest.json>` (or
`SURVEYED_ROOMS_MANIFEST`): 81 checks, none different. Every table
the new steps derive from the config equals the old scripts' literals, including on the real
manifest the 49 stations' positions and gains bit for bit, the floor's 3.2 million texel
positions and the dome's 3.1 million texel positions and normals bit for bit, the atlas layout
and write order, the relief job, and the projection arguments per surface. It notices a changed
occluder, patch, floor scale, atlas order, relief order or projection argument.

`tests/test_gh_scripts.py` (T2): on synthetic inputs at the real views' sizes, the old scripts
and the new steps give identical files throughout (75 compared, 0 different): the end wall's
projection, the ceiling, the dome's texels, the floor at 30 px/m, the window glass and layers,
all twelve tiles' corner fixes, the atlas WebPs and PNG, the four relief maps, the GHR1 file
(byte for byte, both through the same meshoptimizer), the ceiling and dome WebPs, and the
flattened floor and its WebPs.

Not yet proven, because it needs the full two-hour build twice (not allowed on the shared PC):
identity on the real panoramas and mesh, end to end, including the depth renderer
(`render-depth-room.mjs`, so far only syntax-checked). To prove it:

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
    python -X utf8 -m unittest test_static test_units test_gates test_small_room
    python -X utf8 -m unittest test_gh_scripts        # stages of under two minutes each

Scratch goes to `SURVEYED_ROOMS_TEST_SCRATCH` (default: the system temp folder). The GHR1
comparisons and T3 need a Node install with meshoptimizer: this checkout's, or another named by
`SURVEYED_ROOMS_NODE_ROOT`. Without one they are skipped and say so. The `--static` proofs and
the manifest checks need the twin's manifest (`SURVEYED_ROOMS_MANIFEST`) and are skipped
without it.

T3 builds a 12-segment analytic room through the driver and checks the results against the
scene's own geometry and albedo. The room is at quarter turn 1. It has two glass planes and a
transom, a box standing in front of the glass, an open door, a mirror patch and a cross-wall
copy patch, one coffer off centre in x and z, and a lamp painted only in the panoramas.

T4 builds a small room for each gate that neither the Grand Hall nor T3 opens:
- a plane change placed 8 cm off in either direction (no hole in the mask, and the disagreement
  is reported);
- the frosted-lower and sheer classes;
- a clear window with a segmental head (B11);
- stale masks and the glass digest;
- a chamfered wall through the corners step (B4);
- the floor refills' roll along z and along x (B19);
- the ceiling relief's fallback height, padding and spacing.

## Starting a room

1. Measure the outline, openings, ceiling and fittings from the mesh in E57; choose `centre`,
   `floorZ` and `quarterTurns` so the windows' wall is on −z where there is one.
2. Write `<slug>.room.json` and run `check_room.py` with the manifest until it passes.
3. Run `build-room.py ... --plan` and read the ledger; then build into a work directory.

# Surveyed rooms

Each room drawn as surveyed has one config, `<slug>.room.json`. It records where the room sits
in the scan, its measured outline, openings, ceiling, floor, columns and fittings, what was
edited out of the scan, and how the survey renders it. `room.schema.json` defines it. The Grand
Hall's config, `grand-hall.room.json`, carries exactly the values the Grand Hall is built from
today, and `prove-grand-hall.py` checks that against the files that hold them.

| File | What it is |
| --- | --- |
| `room.schema.json` | JSON Schema (Draft 2020-12) for a room config |
| `grand-hall.room.json` | the Grand Hall, as built in `tools/grand-hall-survey` and `hall-spec.ts` |
| `roomlib.py` | frames, wall geometry and view generation (standard library only) |
| `room-views.py` | writes a room's `views-walls.json` and `views-ceiling.json` for `render.mjs` |
| `check_room.py` | validates a config against the schema, then checks its geometry |
| `prove-grand-hall.py` | the proof that the Grand Hall's config changes nothing |

All four scripts run under `python -X utf8 -I` with no packages beyond the standard library.

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
  the Saloon, from the research plan, is 1 (`x = 7.565 − Y`, `z = −2.065 − X`).
- **Outline**: `walls.vertices` are the wall-face corners in planner (x, z), counter-clockwise
  seen from above (from +x towards −z). Segment i runs from vertex i to vertex i + 1, the last
  closing the loop, with the room on its left. Each segment has an id, a height and a kind
  (`solid`, `partition`, `screen`, `open`); a curved wall gives its `sagitta`.
- **Along a wall**: u runs left to right as you face the wall from inside. So u = 0 is at the
  segment's end vertex. v is height above the floor. Openings and edits use (u, v).
- **Openings**: `kind` is what fills the hole (`door`, `window`, `arch` = nothing), `headShape`
  its top (`square`, `semicircular`, `segmental` with `headRise`), and `head` the top of a square
  opening or the springing of an arch. The web's `arched-window` is a window with a semicircular
  head. Give the centre as `centre` (u) or `centreE57` (projected onto the wall). `glazing` is
  one of `clear`, `frosted-lower`, `stained-backlit`, `sheer` or `none`.
- **Edits** that follow an opening name it: `{"opening": "door-end", "offset": -0.54}` is that
  opening's centre less 0.54 m; `{"openingDelta": [a, b]}` is centre(b) − centre(a).
- **Stations**: list every one the room uses. `room` stations must lie inside the outline;
  `doorway` stations name the opening they stand in or just beyond (up to 2 m beyond its face);
  `outside` stations need a note.
- **Survey**: `walls.segments[].survey` keeps a wall's name in survey files (the Grand Hall's
  fireplace wall is `fire`), its tile count, and an `anchorE57` where the rendered elevation
  starts if that is not the corner. Without one, views start at the corner and tiles are
  `ceil(length / tileMaxLength)`.

## What stays in code

The method stays in the scripts: projection weights and the consensus passes, nadir
thresholds, the window glass test, the filters and fill passes, corner fin thresholds and the
floor flattening scales. The config holds what changes from room to room: geometry, edits,
occluders, resolutions, extents, layout and the per-surface projection arguments the Grand
Hall's scripts pass.

## Usage

    python -X utf8 -I tools/surveyed-rooms/check_room.py <slug>.room.json --manifest <twin>/manifest.json
    python -X utf8 -I tools/surveyed-rooms/room-views.py <slug>.room.json <work-dir>
    python -X utf8 -I tools/surveyed-rooms/prove-grand-hall.py --scratch <dir>

`room-views.py` writes LF line ends, as committed, and leaves an existing file alone unless
its bytes already match or `--overwrite` is given. `check_room.py` exits 1 on any error; it uses
its own validator for the schema and, when `jsonschema` can be imported (not under `-I`), that
too.

## The Grand Hall proof (18 October 2026)

`prove-grand-hall.py` on this worktree:

- `views-walls.json` from the config: SHA-256 `11526451…a40a61`, identical to the committed
  file. The checkout has CRLF line ends (`b54322f7…ead3243`); with LF they are identical too.
  The old `wall-views.py`, rerun into scratch, writes the same bytes.
- `views-ceiling.json` from the config: `bc496802…3814c9`, identical to the committed file.
- 163 values read from `hall-spec.ts`, the survey scripts and the web modules beside it match
  the config exactly (`==` on doubles), including every opening's u computed the way
  `hall-spec.ts` does.
- `check_room.py` passes with no warnings; 20 deliberately broken copies each fail.

Two things a reader should know. The survey's wall views start 2.5 mm (X) and 3 mm (Y) off the
corners `hall-spec.ts` gives, so the config keeps them as `anchorE57`; without them the views
move up to 3.9 mm. The tile counts (4, 4, 2, 2) also follow from `tileMaxLength` 6 m.

## Starting a room

1. Measure the outline, openings, ceiling and fittings from the mesh in E57; choose `centre`,
   `floorZ` and `quarterTurns` so the windows' wall is on −z where there is one.
2. Write `<slug>.room.json` and run `check_room.py` with the manifest until it passes.
3. Run `room-views.py` into the work directory, then `render.mjs` as the Grand Hall build does.

The Grand Hall's build scripts still hold their own copies of these values; moving them onto
the config is the next step, with the published files' hashes as the test.

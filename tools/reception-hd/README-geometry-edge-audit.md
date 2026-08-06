# Geometry-only E57 photo check — v2

This computer-vision check asks one practical question: **when the laser scan
says there is a strong shape edge, does the photograph show an edge in the
same place?** Door frames, wall corners, furniture edges, and similar features
should line up when the camera face points in the correct direction.

The tool never asks for or reads LiDAR point colour. It reads only XYZ position
plus the organized row and column numbers. It does decode each embedded JPEG,
because visible photo edges are what the LiDAR shape edges are compared with.
Both sources still come from the same E57 container, so this is internal
evidence—not an independent camera survey or external ground truth.

## What v2 changed, and why

The first development report did not pass. Keep it exactly as it is:

`docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json`

Its exact receipt is 7,247,706 bytes, full-file SHA-256
`d8307d8547ba2bce44f87a3173497a83762f98c994e13af272d95c21a24f941a`,
and payload SHA-256
`cf5c21ff0c1a2ba243c4a51bb8f04d945b03511e4c02de002619f375e0321591`.
Every v2 command requires that exact file through
`--prior-development-report`. A renamed, edited, missing, or replacement file
is rejected before an E57 reader can be created.

The old report found the expected direction ranked first on all 42 development
photos, both before and after the small-shift check. It also found:

- 30 `UNIQUE`, 6 `NONUNIQUE`, and 6 `UNASSESSABLE` exact-placement results;
- one face below the old 24-cell coverage rule: scan 134, Skybox 0, with 22
  supported cells.

Scientific review found a construct mismatch. The 240 far-away placements ask
whether one exact pixel location is special. They do not ask which cube
direction or mirror is correct. V2 therefore keeps all 240 offsets, raw counts,
and limits unchanged, but reports them only as `EXACT_PHASE_DIAGNOSTIC` with
status `UNIQUE`, `NONUNIQUE`, or `UNASSESSABLE`. This diagnostic never changes
the discrete-orientation result and never validates continuous calibration.
It is not a p-value.

V2 also replaces the old count-only 24-cell veto with a distribution check.
A geometry mask must have at least 12 supported cells, span at least 3 rows and
3 columns of the 8×8 grid, and reach all 4 image quadrants. A cell is supported
only when it contains at least 25 geometry-edge pixels. The old 24-cell answer
is still reported as a diagnostic, but cannot change pass or fail.

## Run these three commands in order

Do not skip a command. All outputs are create-only: if the requested file
already exists, the tool stops instead of replacing it.

### 1. Run only the seven development scans

This opens scans `122, 124, 126, 130, 134, 140, 144`. It does not open any of
the 16 geometry-metric-heldout scans.

```powershell
python tools/reception-hd/audit_e57_geometry_edge_protocol.py run-development `
  --e57 F:\E57\cloud_0.e57 `
  --v2-report docs/reports/reception-room-e57-lidar-reprojection-2026-07-14-v2.json `
  --prior-development-report docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json `
  --output docs/reports/reception-room-e57-geometry-edge-development-v2-2026-07-14.json
```

Stop unless all 42 faces are `PASS_DISCRETE_GEOMETRY_ORIENTATION`. Do not lower
a limit merely to turn a result green.

### 2. Freeze the v2 protocol

This command decodes no scan. It verifies the exact failed v1 evidence and the
new v2 development evidence, then records exact hashes for the E57, colour
report, code, tests, dependencies, and expected heldout output name.

```powershell
python tools/reception-hd/audit_e57_geometry_edge_protocol.py create-protocol `
  --e57 F:\E57\cloud_0.e57 `
  --v2-report docs/reports/reception-room-e57-lidar-reprojection-2026-07-14-v2.json `
  --prior-development-report docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json `
  --development-report docs/reports/reception-room-e57-geometry-edge-development-v2-2026-07-14.json `
  --output docs/reports/reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json `
  --audit-output-file-name reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json
```

### 3. Run the 16 heldout scans once

This verifies every frozen input before creating an E57 reader. It then opens
exactly 16 heldout scans and requires exactly 96 face results. Missing or extra
rows are rejected; a majority vote is never used.

```powershell
python tools/reception-hd/audit_e57_geometry_edge_protocol.py run-audit `
  --protocol docs/reports/reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json `
  --e57 F:\E57\cloud_0.e57 `
  --v2-report docs/reports/reception-room-e57-lidar-reprojection-2026-07-14-v2.json `
  --prior-development-report docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json `
  --development-report docs/reports/reception-room-e57-geometry-edge-development-v2-2026-07-14.json `
  --output docs/reports/reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json
```

Do not change code or limits after seeing the heldout result. “Held out” here
means held out only from development of this new XYZ-versus-JPEG geometry
metric. These scans were already used in earlier colour/orientation work, so
they are not globally unseen.

## How a face is decided

The tool tries all 48 cube-face rotations and mirrors. Each candidate gets the
same nine small shifts: −4, 0, and +4 pixels in both directions. The expected
face must rank first before and after those shifts, clear both margin limits,
and have enough edge pixels, density, occupied area, photo edges, and
distributed image support.

- `PASS_DISCRETE_GEOMETRY_ORIENTATION`: the expected direction clears every
  discrete direction and evidence rule.
- `REJECT_GEOMETRY_MISMATCH`: evidence is sufficient, but the expected face
  loses the 48-way direction comparison or falls below the hard match limit.
- `BLOCKED_INSUFFICIENT_GEOMETRY`: there is too little usable or well-spread
  LiDAR geometry evidence.
- `BLOCKED_AMBIGUOUS`: the direction is tied, too close to call, or the photo
  edges are not assessable.
- `SHIFT_SENSITIVE`: warning only; it never changes the direction result.
- `EXACT_PHASE_DIAGNOSTIC`: exact-placement information only; `UNIQUE`,
  `NONUNIQUE`, and `UNASSESSABLE` never change the direction result.

All six faces at a station must pass. Five passes cannot hide one rejection or
blocked face. All 96 heldout faces must pass for the overall discrete gate to
pass.

## What even a perfect result does not permit

These values always remain false:

- continuous calibration validated;
- metric geometry validated;
- known-pose materialization permitted;
- training permitted.

Privacy review, rights approval, lens and intrinsic calibration, distortion,
metric depth, camera centre, and inter-station registration remain separate
required work. The JSON digest detects ordinary changes but is not a signature,
trusted timestamp, or proof of who ran the test.

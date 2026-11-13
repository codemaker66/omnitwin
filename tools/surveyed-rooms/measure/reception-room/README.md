# Measuring the Reception Room (T-662, 13 November 2026)

The scripts that measured `../../reception-room.room.json` from the twin, kept as the record of how each
figure was found. They follow the Saloon's pass (`../saloon/`) and import its loaders, line fitter and
cube-face sampler without changing them.

Inputs, as the Saloon's: a work directory named by `ROOMS_SURVEY_WORK` holding the twin's
`manifest.json` and the decoded mesh (`mesh/positions.f32`, `mesh/indices.u32`, `mesh/chunks.u16`);
`E57_CUBE_FACES` (the export's native 4096 px cube faces, with a trailing slash). Outputs go to
`RECEPTION_MEASURE_OUT` (default `<work>/reception-measure`). Run `01` to `09` in order with
`python -X utf8`; each takes seconds, except `08` (about four minutes, 600 MB).

Frame: E57 metres, Z up. Planner: quarter turn 0, `x = X - 16.06`, `z = 7.36 - Y`, `y = Z + 2.869`, so
the window wall (E57 +Y, 281.1 degrees true) is on -z. Heights below are above E57 Z -2.869.

## What each script found

| Script | Finds | Result |
| --- | --- | --- |
| `01_stations.py` | stations 119-146, floor and ceiling at each, plan sections | 123-144 in the room (lens 1.47-1.52 m up); 122 in the corridor door's reveal; 121 in the corridor |
| `02_floor_ceiling.py` | floor plane; ceiling height raster (2.5 cm) | floor `Z = -2.8999 + 0.00075 X + 0.00251 Y`, rms 6.5 mm over 82 m2; -2.8690 at the origin |
| `03_wall_peaks.py` | candidate wall offsets and their runs | the L, its piers, the two wardrobes' planes |
| `04_wall_fits.py` | robust line per wall face in three bands | table below |
| `05_elev.py` | 2 cm depth rasters of the walls, with profiles | door edges and heads, skirting, cornice, curtain plane |
| `06_plan_features.py` | columns, the pier's end, ceiling parts | below |
| `07_window_edges.py`, `planecrop.py` | photographs re-projected on a plane, with a grid | windows, doors, fittings, the junction |
| `08_raycheck.py` | the independent check | below |
| `09_write_config.py` | writes the config | outline 101.75 m2, perimeter 45.76 m |

Wall faces, plain wall band (0.6-1.8 m, five sections, 1 cm samples; RANSAC then Tukey IRLS at 2 cm):

| Face | E57 offset | Angle to the axis | Support per level | rms |
| --- | --- | --- | --- | --- |
| window wall (bare at X 11.26-11.60 only) | Y 13.562 | not measured (see below) | 0.33 m | 0.8 mm |
| west wall, window part | X 11.279 at Y 10.625 | -1.01 deg | 5.42 m | 2.4 mm |
| stub wall, west | Y 7.672 | +0.60 deg | 1.31 m | 2.4 mm |
| west wall, inner part | X 12.731 | +0.11 deg | 5.15 m | 4.8 mm |
| south wall, west plane | Y 1.162 | -0.29 deg | 1.66 m | 7.5 mm |
| return in the south wall | X 15.051 | | 0.27 m | 4.1 mm |
| south wall, east plane | Y 1.491 | -0.28 deg | 3.90 m | 5.0 mm |
| east wall, inner part | X 19.997 | +0.14 deg | 5.66 m | 6.8 mm (inliers 0.91) |
| pier, south face / north face with the east stub | Y 7.265 / Y 7.496 | | 0.71 / 1.41 m | 0.2 mm |
| pier, end face | X 19.133 | | 0.21 m | 1.4 mm |
| fire-door pier (leaf plane X 20.765) | X 20.679 | | 0.28 m | 7.2 mm |
| east wall, window part | X 20.893 | -0.42 deg | 3.68 m | 2.8 mm |
| north-east pier | X 20.676 | -0.49 deg | 0.65 m | 0.3 mm |

The skirting stands 1-2 cm proud to 0.30 m. The wall's top band (2.2-2.36 m) repeats the offsets within
7 mm, except over the west wardrobe, where the wall (Y 1.145) is 17 mm behind its doors' plane. The outline is drawn
axis-parallel except that west wall, which is 10.4 cm out of parallel over its length and is drawn as
measured.

The window wall's direction could not be measured (0.34 m of bare wall), and it is drawn parallel to the
E57 X axis. That is an assumption with evidence against it: the pelmet over the curtains is a straight
line at -0.57 degrees to the axis (`05_elev.py h north 3.00`: 0.21 m in front of Y 13.56 at X 11.45,
0.30 m at X 20.45), and the drapes' fronts drift the same way by 4 cm. If the wall is parallel to its
pelmet, its east end is at Y 13.47, 9 cm nearer the room than drawn. The window part is skew in other
ways too: its west wall is at -1.01 degrees, and the downstand face at the junction runs from Y 7.595
(X 12.9) to 7.52 (X 19.0), 7.5 cm south of the west stub wall's plane.

Columns (four faces each, 0.6-1.8 m): north, centre E57 (14.799, 7.211), 0.284 x 0.279 m; south,
(14.767, 2.966), 0.268 x 0.306 m; 81-87 % of their perimeter lies on axis-parallel faces and the cube
faces show square shafts on moulded bases. They are square, not round.

Ceiling parts (connected pieces of the raster; plumb-line means in brackets): window field 3.126 m, 47.0 m2
flat (3.125); west coffer 2.822 m, 4.9 m2 (2.822); east coffer 2.825 m, 8.8 m2 (2.824); soffit 2.419 m,
19.3 m2 (2.415-2.424); band along the wardrobes 2.514 m, 6.5 m2 (2.515); three cassettes 3.5 cm proud.

## Independent check (`08_raycheck.py`)

A second method on a different sample of the same mesh: no sections, no rasters.

1. Tape lines (pairs of opposite rays, wall to wall, at 1.0 and 1.5 m): window part 9.598-9.630 m wide
   (it widens northwards with the west wall); inner part 7.261-7.276 m, but 7.240-7.257 m between Y 4.6
   and 5.6; window part's depth at the west end 5.894-5.896 m; inner part's depth at the east 5.781-5.791 m.
   Against the fitted lines: within 9 mm, except the 22-28 mm at the bulge. The whole length cannot be
   taped in one line (the window wall is bare only at the west end, where the stub wall is in the way);
   a line by the west side ends on a sheer fold hanging in the wall's plane and gives 12.38-12.39 m, a
   lower bound on the outline's 12.400 m.
2. Fans from the 22 stations (33 089 hits at five pitches): each face's robust line differs from the
   plan-section fit by 1.4 mm at most, and in angle by 0.03 degrees on the long walls.
3. Plumb lines on a 0.2 m grid (2 411): floor `Z = -2.9161 + 0.00123 X + 0.00378 Y`, rms 9.0 mm, -2.8685
   at the origin; ceiling parts within 4 mm of the raster's medians.

Corrections it caused:

- The inner part's east wall is not one plane: it bulges 2-3 cm into the room between Y 4.6 and 5.6.
  The wall stays one segment; its note and the residuals say so.
- The floor's fall is 3.8 mm/m along Y when sampled evenly, not the 2.5 mm/m of the area-weighted fit
  (which rejects what lies over 2 cm from the mode). The floor's note gives both; `floorZ` is unchanged
  (the two agree at the origin within 0.5 mm).
- The window wall's fit first took a sheer fold lying in the wall's plane (X 12.66-12.85) as wall, which
  gave Y 13.557 and a false angle. Restricted to the bare wall it is Y 13.562, and the tape line gives 13.561.

Earlier corrections, from the photographs: the pier at the junction ends at X 19.133 (first read as
19.23 off a plan section), and the "pier" at X 20.765 is the fire door's leaf, 0.086 m behind its pier's face.

## Windows

The mesh holds nothing beyond Y 13.72 on this wall: only sheers and drapes, 0.14-0.18 m in front of the
face. The frames show through the sheers, so the windows were read from the cube faces re-projected on
planes parallel to the wall (`07_window_edges.py`, 2.5-8 mm per pixel), by eye. Threshold and step finders
were tried and dropped: the drapes' stripes are stronger than the frames.

- Depth: on the plane Y 13.80 the daylight opening's head and the sill lines sit at the same height from
  stations 1.9 m and 3.8-5.0 m away (a line 10 cm off that plane would move 2.8 cm between them), so the
  frame is about 0.24 m behind the wall face as drawn. An automatic reading (`07_window_edges.py heads`)
  agrees for the second window (2.609-2.624 m from five stations 1.9 to 4.5 m away, one outlier at 2.541:
  within about 2 cm of that plane); on the others it scatters by 7-50 mm between stations and would put
  the frames 0.03-0.12 m further back. Carried as 0.24 m, -0.04 to +0.12.
- Heights: head 2.58 m (2.54-2.62 by eye over the four windows; 2.56, 2.61, 2.59 and 2.57 automatically;
  the second also shows a thin bright line at 2.69 m, taken as light over its top rail); glass sill 1.00 m; window board 0.93-0.95 m, its nosing
  about 0.06 m behind the wall face.
- Along the wall: west glazing edges at X 14.25 (second window, from scan_136 at 54 degrees) and 16.47
  (third, from scan_135 at 56 degrees), so the pitch is 2.22 m. The second window's glass is seen as far
  east as X 15.87 (scan_139). The gaps between drapes are X 12.15-13.40, 14.30-15.72, about 16.5-18.0 and
  18.87-20.24.
- Not measured: the width. Every east jamb is behind a drape, and steeper views show only sheer. The
  config carries 1.62 m, the least the photographs allow (piers then 0.60 m); it may be up to about 1.9 m.
  The first and fourth windows are placed by the pitch alone.

Settling it needs a view the scan does not have: the drapes drawn back, a photograph from the yard, or a
tape on site.

## Measured against the records

| | Measured | Production record | Venue's plan | Difference |
| --- | --- | --- | --- | --- |
| Shape | L, 16 wall faces | rectangle | L | the record's rectangle is not the room |
| Window part's width | 9.60-9.63 m (9.449 m of window wall) | 11.2 m | 9.6 m | record +1.6 m; plan 0 to -0.03 m |
| Inner part's width | 7.266 m (7.24 at the bulge) | | 7.3 m | plan +0.03 m |
| Length | 12.071 m (east), 12.400 m (west, to the wardrobe doors) | 13.4 m | 12 m | record +1.0 to +1.3 m; plan -0.07 to -0.40 m |
| Area | 101.75 m2 (57.05 north of the downstand at Y 7.56, 44.70 south of it) | 150 m2 | | record +48 m2 |
| Height | 3.126 m (window part); 2.82 m coffers; 2.419 and 2.514 m soffits | 3.2 m | | record +0.07 m over the highest ceiling, +0.78 m over the lowest |
| Windows | 4, 2.22 m apart | 4 | 4 bays | |
| Partition | none seen, and no track | "sound-proof wall" | sliding door at the junction, a door at its west end | the plan's partition is not in the scan |
| East side of the inner part | one straight wall | | two set-backs about 1.8 m deep | the plan's set-backs are not in the scan |

The venue's plan was used for its three labels and its shape only; it is private and nothing of it is
copied here. Its own labels imply scales 8 % apart. The 2010 drawings have no ground floor.

## Inventory for the later stages

Openings (centre and width along the wall, heights above the floor):

| Opening | Wall | E57 centre | Width | Sill | Head | Glazing | In the scan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| window-1 to window-4 | window | X 12.84, 15.06, 17.28, 19.50 | 1.62 (least) | 0.93 board, 1.00 glass | 2.58 square | sheer over clear glass, drapes | closed |
| door-corridor | west-inner | Y 2.152 | 1.155 | 0 | 2.02 square | none | open, leaf swung into the corridor |
| door-fire-exit | door-pier | Y 8.065 | 0.86 | 0 | 2.02 square | none | closed |
| wardrobe-east | south-east | X 17.155 | 2.35 (three leaves) | 0 | 1.93 square | clear panes, recorded as none | closed |
| wardrobe-west | south-west | X 14.00 | 1.84 (three leaves) | 0 | 1.93 square | clear panes, recorded as none | closed |

Fittings the schema cannot hold (positions E57, read from single-station crops, +-0.05 to 0.1 m unless a
mesh figure is given):

- Ceiling cassettes: window field, X 13.2-14.225 by Y 10.125-11.05 and X 17.975-19.025 by Y 10.025-11.075
  (mesh, faces 3.09 m); east coffer, X 15.825-16.625 by Y 4.075-4.95 (mesh, face 2.79 m).
- Access hatches, 0.6 m square: window field at (13.75, 11.5), (15.25, 10.65), (18.5, 9.65); east soffit
  X 18.9-19.5 by Y 5.0-5.65; one in the east coffer by the cassette.
- Downlights: window field on a 1.75 m grid, X 12.55, 14.3, 16.05, 17.8, 19.55 by Y 12.3, 10.6, 8.9
  (about 13 lit; the other places hold speakers or sensors); east coffer six (X 15.5 and 17.4 by Y 6.2, 5.1,
  4.1); west coffer three (X about 13.5); south band three (Y 2.4, X 14.75, 16.0, 17.25); east soffit
  four (X 19.1, Y 6.15, 4.8, 3.45, 2.15).
- A small ceiling device at (16.6, 10.5) in the window field (projector point or sensor), two detectors by it.
- Wall lights at 2.0 m: west wall of the window part Y 8.6 and 12.65; east wall Y 9.35 and 12.0; inner
  west wall Y 3.8 and 6.7; inner east wall Y 2.6 and 6.1; south wall X 15.4; at least one more by the junction (seen from scan_136, not placed).
- Picture rail at 2.13 m with an LED strip on it, on every wall but the window wall; a second concealed
  strip in each coffer's rim.
- Roll-down screen housing on the west wall (Y 9.45-11.85, 2.78-2.97 m); exit signs over both doors; a
  wifi access point (west wall, Y 8.75, 0.55 m); air-conditioning controllers (inner east wall, Y 5.4-5.6,
  1.3 m); a fire alarm call point (inner west wall, Y 3.05, 1.2 m).

Movable things to edit out: the sheers and drapes over the whole window wall (they are the only surface
the scan has there, from the floor to 2.89 m); two fire extinguishers on a stand in the south-east corner
(X 19.7-20.0, Y 1.5-1.8, to 0.75 m: the south-east wall's first 0.3 m and the inner east wall's last
0.3 m); one on a stand in the south-west corner by the west wardrobe (X 12.75-13.0, Y 1.2-1.45, to
0.8 m); the open corridor door's leaf (in the corridor, outside the outline). The room was otherwise
empty. A person stands in scan_123's panorama, by the corridor door.

Seen poorly: the window wall itself (curtained; bare for 0.34 m); the wardrobes' interiors and whatever
their panes reflect; the south column hides the west wardrobe's east leaf from most stations; the floor
mirrors every downlight; the north-east pier's last 0.3 m is behind the drapes' stack.

Not found: the sliding partition. The soffit and the floor at the junction (crops from scan_143 on the
planes 2.419 m and 0 m) show no track. The pier at the junction's east end (0.864 x 0.231 m) and the
downstand face at Y 7.56 are where one would close.

Stations: scan_123 to scan_144 room; scan_122 doorway (door-corridor, 0.075 m beyond the face); scan_121
corridor, 1.47 m beyond the face, left out.

## What the schema and the driver cannot express

- The driver refuses the config as it stands: `free-standing elements are not supported yet` (the two
  columns). With them taken out of a scratch copy, `--plan` accepts the rest and opens 49 gates: B4 (the
  west wall), B5 and B8 (the short faces), B6 and B9 (reflex ends), B7, B10 (four sheer windows), B14
  (a 4096 x 2048 atlas, three shelves), B16, B17 and B18.
- Sheer glazing takes the whole glass outline as glass. Here a drape overlaps both sides of every window,
  so the mask will hold drape; and the outline's width is not measured.
- No internal line: a partition's track (or its absence) cannot be recorded; `kind: partition` exists
  only for outline segments.
- `fittings.kind` has no cassette, downlight, hatch, wall light, screen or sign; `concealedLights` lists
  walls, so a coffer's uplight has no place.
- A glazed door (the wardrobes) cannot say it is glazed without being a window; a cupboard's depth has
  no field.
- One flat floor: the 3-5 cm fall is recorded only in a note.
- Ceiling regions are simple polygons: the cornice band round the window field (a ring) and the coffers'
  coved rims are described in notes; `relief.holdCeiling` is one height, and the walls here stop at
  2.419, 2.514 and 3.126 m.
- `site` has no field for the yard's level or the rear facade the windows are in.

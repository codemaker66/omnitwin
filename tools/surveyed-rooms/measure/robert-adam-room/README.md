# Measuring the Robert Adam Room (T-662, 13 November 2026)

The scripts that measured `../../robert-adam-room.room.json` from the twin, kept as the record of how each
figure was found. They follow the Saloon's and the Reception Room's passes (`../saloon/`,
`../reception-room/`) and import their loaders, ray caster and cube-face sampler without changing them.

Inputs, as theirs: a work directory named by `ROOMS_SURVEY_WORK` holding the twin's `manifest.json` and the
decoded mesh (`mesh/positions.f32`, `mesh/indices.u32`, `mesh/chunks.u16`); `E57_CUBE_FACES` (the export's
native 4096 px cube faces, with a trailing slash). Outputs go to `ROBERT_ADAM_MEASURE_OUT` (default
`<work>/robert-adam-measure`). Run `01` to `13` in order with `python -X utf8`; each takes seconds, except
`10` (four to eight minutes, about 600 MB).

Frame: E57 metres, Z up. Planner: quarter turn 2 (the Grand Hall's), `x = 0.32 - X`, `z = Y + 0.04`,
`y = Z + 3.575`, so the street wall (E57 -Y, 101.1 degrees true) is on -z. One room on two floors: y = 0 is
the lower floor (E57 Z -3.575) and the upper floor is y = 0.594 (Z -2.981). The scripts print heights above
each section's own floor (Z -3.574 and -2.981); the config gives every height above the lower floor.

## What each script found

| Script | Finds | Result |
| --- | --- | --- |
| `01_stations.py` | stations 80-122, floor and ceiling at each, plan sections | 86-88, 94-111, 113 on the lower floor; 112, 114-120 on the upper; 85 in the lobby door's passage; 89-93 in the rear corridor |
| `02_floors.py` | the lowest up-facing surface (2 cm raster), a plane per floor | below |
| `03_steps.py` | vertical sections of the flight | four risers, three treads, two plinths |
| `04_wall_peaks.py` | candidate wall offsets and their runs | 75 faces |
| `05_wall_fits.py` | a robust line per face | table below |
| `06_elev.py` | 2 cm depth rasters of walls, with row and column readers | openings' edges, boards and heads |
| `07_ceiling.py` | the lowest down-facing surface (2.5 cm raster), named parts | beams and panels, all flat |
| `08_curves_columns.py` | circles for the curved walls and the columns | screen wall r 1.052 m; columns r 0.076 m |
| `09_fittings.py` | the chandeliers in the mesh | three, in a row at Y -4.84 |
| `10_raycheck.py` | the independent check | below |
| `11_ceiling_parts.py` | each ceiling part's bounds | 11 panels, 4 higher beams, 3 lowered bands, the raised field |
| `12_write_config.py` | writes the config | 64 walls, perimeter 97.22 m, 164.5 m2 |
| `13_outline_picture.py` | the outline drawn over the sections | a picture to look at |
| `views.py` | panoramas, pinhole views and plane crops from the cube faces | windows, doors, chandeliers, the steps |

`06_elev.py` and `views.py` take their subject on the command line. The rasters made (`06_elev.py make
<name> <axis> <face> <side> <along0> <along1> <z0> <z1> [res] [front]`, heights in E57 Z):

    street Y -10.5  + -6.2  6.7  -3.65 -0.25 0.02 0.3      back  Y -1.485 - -6.2  6.7 -3.65 -0.25
    west   X -5.924 + -11.5 -3.0 -3.65 -0.25               east  X 6.564  - -11.5 -1.2 -3.65 -0.25 0.02 1.4
    upE    X 0.11   - 2.9  10.0  -3.05 -0.6  0.02 0.35     upN   Y 11.29  - -5.6  1.75 -3.05 -0.6 0.02 0.35
    upW1   X -5.49  + 5.7  11.4  -3.05 -0.6  0.02 0.4      upW2  X -4.07  + -0.1  5.9  -3.05 -0.6 0.02 0.4
    upS    Y 1.455  + -4.2 -1.2  -3.05 -0.6  0.02 0.3      loWd  X -4.768 + -3.4 -1.4 -3.65 -0.3  0.02 0.3
    lobby  X 5.269  - -6.0 -3.7  -3.65 -0.3  0.02 0.3

The photographs re-projected (`views.py plane`, or `ralib.crop_plane`, at 4-5 mm per pixel): the west
window on Y -11.32 from station 108, the east window on Y -11.126 from 95, the entrance screen on Y -11.43
from 104; the double door on X 0.11 from 117, the north doors on Y 11.31 from 119 and Y 11.25 from 118, the
timber door on X -4.768 from 100, the lobby door on X 5.269 from 96; each chandelier on the plane Y = its
axis from 107, 103 and 94; the step alcove on the levels Z -3.428, -3.290, -3.147 (from 113) and -2.985
(from 112). Pinhole views (`views.py persp`) from 103 and 109 settled the beams and from 119 the nook.

## The room, in words

A lower hall on the Glassford Street front and, four risers up at its back, a low upper section under the
Saloon. The lower hall has two piers standing out from the street wall (three bays: a window, a glazed
entrance screen in a recess, a window), shoulders where it narrows towards the back, a casing round the
double door to the entrance hall on the east, and two recesses in its back wall: the platform lift's bay
and the step alcove. A block of walling stands between the lift and the steps, and a matching pilaster
east of the alcove; both face the piers, and the four carry the two long beams.

The steps rise in the alcove through a square-headed, timber-lined arch to a landing, which opens west
into a lobby. The rear corridor's rounded corner bows into the lobby as a quarter-circle screen wall. A
second arch, with a pair of leaves that stood open, leads north into the main upper room, an L with two
slim columns, a casing along its west wall and a tapering nook in its north-east corner.

## Wall faces

Plan sections at five heights, 1 cm samples, Tukey IRLS at 2 cm in two passes (within 5 cm of the believed
offset, then within 4 cm of the first line). The lower section is read 0.45-1.05 m above its floor: above
the skirting (1-3 cm proud to 0.3 m) and below the west wall's dado rail, which matters only there (the wall
above the rail lies 0.165 m further back). The upper section is read 0.5-1.5 m above its own floor.

| Face | E57 offset | Angle to the axis | Support per level | rms |
| --- | --- | --- | --- | --- |
| lower west wall (dado) | X -5.924 at Y -6.82 | +0.19 deg, drawn | 6.96 m | 1.6 mm |
| the same wall above its dado | X -6.089 | +0.30 deg | 6.96 m | 5.9 mm |
| street wall, west bay / under its board | Y -10.917 / -10.914 | | 0.49 / 2.10 m | 4.3 / 3.3 mm |
| west pier: west, end, east | X -2.826, Y -8.099, X -1.749 | -0.36, +0.05, -0.17 deg | 2.04, 0.93, 1.64 m | 4.0, 7.6, 1.2 mm |
| entrance recess: west, east | X -1.558, 1.235 | +1.9, +1.2 deg | 1.04, 1.03 m | 3.0, 3.4 mm |
| east pier: west, end, east | X 1.728, Y -8.083, X 2.763 | -0.36, -0.47, +0.16 deg | 1.55, 0.91, 1.95 m | 0.9, 9.0, 6.7 mm |
| street wall, east bay (dwarf wall) | Y -10.707 | +0.02 deg | 1.91 m | 3.1 mm |
| window glass: west, east | Y -11.318, -11.120 | | 1.14, 1.12 m | 7.3, 5.3 mm |
| south-east return and its west face | Y -9.957, X 5.064 | | 1.40, 0.81 m | 8.2, 4.2 mm |
| lower east wall, south part | X 6.564 at Y -8.26 | -0.41 deg, drawn | 3.28 m | 1.3 mm |
| east wall each side of the lobby door | X 6.244, 6.241 | | 0.64, 0.48 m | 1.7, 2.6 mm |
| lobby door's casing: south, face, north | Y -5.817, X 5.269, Y -3.865 | | 0.76, 0.37, 0.72 m | 1.6, 9.2, 2.5 mm |
| shoulders: north-east, north-west | Y -3.276, -3.278 | | 0.75, 1.11 m | 1.9, 2.4 mm |
| east wall, north part | X 5.300 | -0.43 deg | 1.70 m | 0.2 mm |
| back wall, east | Y -1.484 | -0.04 deg | 2.41 m | 1.2 mm |
| east pilaster / the block's south face | Y -1.586 / -1.577 | | 0.79 / 0.88 m | 4.7 / 9.0 mm |
| alcove: west wall, east wall | X -1.728, 1.632 | -1.9, -0.7 deg | 1.52, 1.10 m | 5.6, 5.5 mm |
| top riser (the arch's wall) | Y 0.376 | -0.41 deg | 0.86 m | 3.6 mm |
| arch's linings: west, east | X -1.244, 1.131 | | 0.27, 0.21 m | 5.1, 5.4 mm |
| lift bay: east, north wall, west | X -2.887, Y 0.026, X -4.573 | | 1.31, 0.37, 1.42 m | 6.8, 1.9, 2.8 mm |
| west wall, north part (timber door) | X -4.768 | -0.62 deg | 0.42 m | 5.0 mm |
| landing: east wall, west wall | X 1.233, -1.346 | | 0.48, 0.70 m | 1.6, 4.1 mm |
| lobby: west wall, south wall | X -4.065 at Y 1.53, Y 1.450 | +0.70, -0.80 deg | 2.85, 1.38 m | 2.9, 7.8 mm |
| upper east wall | X 0.125 at Y 7.47 | +0.61 deg, drawn | 2.10 m | 2.5 mm |
| upper north wall | Y 11.271 at X -1.80 | -0.87 deg, drawn | 6.78 m | 2.3 mm |
| upper west wall / its casing | X -5.488 / -5.237 | -0.01 / +0.19 deg | 5.35 / 2.97 m | 2.0 / 5.8 mm |
| upper west return, wall south of it | Y 5.742, X -3.994 | | 0.85, 0.64 m | 2.0, 3.9 mm |
| arch leaves, open: east, west | X -0.109, -3.775 | | 1.82, 1.84 m | 1.4, 2.5 mm |

Four long walls are drawn as measured; the rest are drawn parallel to the E57 axes at their fitted offset,
which puts a face's ends up to 1.7 cm from its fitted line (the west pier's west face). A wall's height in
the config is the ceiling met 0.10 m inside its face (90th percentile along it), no more than the highest
ceiling part.

Curved walls (`08`, five heights): the screen wall's room side is a circle of radius 1.052 m about
(1.144, 2.307), rms 5.6 mm over 991 points, a quarter turn from (1.144, 1.255) to (0.092, 2.307), tangent to
the landing's wall line at one end and the lobby's east wall at the other. The nook's south wall is not a
circle: a circle of 1.29 m about (1.420, 9.639) fits only its first 45 degrees (rms 8.1 mm), after which the
wall tightens and then runs straight at 12-14 degrees to the north wall. It is drawn as six chords through
(0.151, 9.86), (0.215, 10.10), (0.304, 10.30), (0.499, 10.50), (0.749, 10.69), (1.350, 10.832) and
(1.672, 10.902), read off the sections; a plant and stored battens hide parts of it, so +-2 cm.

Columns: circles of radius 0.076 m at (-2.062, 6.222) and (-2.038, 8.790), rms 5.6 and 4.3 mm: round, 0.152 m
across, from the upper floor to the raised field (2.288 m).

## Floors and steps

| | E57 Z | rms | Note |
| --- | --- | --- | --- |
| lower floor | -3.5687 + 0.00054 X + 0.00102 Y | 4.0 mm over 91.5 m2 | -3.575 at its centre; level within 1.5 cm |
| upper floor | -2.9611 + 0.00574 X - 0.00052 Y | 7.3 mm over 33.7 m2 | -2.981 at its centre; falls 3 cm westwards over 5.6 m |

The flight (vertical sections at six X, `03`): straight, 2.40 m wide between two plinths, its first tread
2.93 m wide. It looks bowed only in a panorama.

| | Riser's face, E57 Y (at X -1.1 .. +1.0) | Rise | Tread's level, Z | Going | Tread's ends, X |
| --- | --- | --- | --- | --- | --- |
| 1 | -0.529 .. -0.545 | 0.149 m | -3.429 | 0.298 m | -1.516 .. 1.417 |
| 2 | -0.234 .. -0.248 | 0.140 m | -3.289 | 0.305 m | -1.262 .. 1.140 |
| 3 | 0.068 .. 0.060 | 0.144 m | -3.145 | 0.309 m | -1.262 .. 1.140 |
| 4 (to the upper floor) | 0.383 .. 0.364 | 0.162 m | -2.983 | | the arch, -1.244 .. 1.131 |

Total rise 0.595 m. Every riser runs 15-20 mm askew over the flight (about -0.5 degrees) and is drawn square
at its middle (-0.536, -0.238, 0.067, 0.376). The plinths (X -1.527..-1.262 and 1.140..1.417, Y -0.238..0.376)
are level with the third tread and carry potted plants; between each and the alcove's wall a strip 0.2 m
wide stays at the lower floor's level. Brass nosings on every tread and on the landing's edge; the first
tread's nosing returns along both its ends. Brass handrails on both sides run from a post by the first
tread's end to a post on the landing by the arch's jamb (seen in the panoramas; not measured, +-0.1 m).

The platform lift stood down, in its bay: footprint E57 X -4.03..-3.00, Y -1.634..-0.031 (the gate's fit is
poor, rms 14 mm), its gate 5-15 cm south of the bay's mouth. It rises to a landing (X -4.07..-3.07,
Y 0.03..1.45, ceiling 1.98 m above the upper floor) that opens north into the lobby.

## Ceilings

Lower section (heights above Z -3.574; add 1 mm for the config's): no vaults, domes or segmental beams.
What reads as arches in the panoramas are straight beams in an equirectangular picture; a pinhole view
from station 103 shows them straight, and each soffit's spread is under 2 cm.

| Part | Height | Bounds, E57 |
| --- | --- | --- |
| long beams, west / east | 2.799 / 2.826 m | X -2.9..-1.75 / 1.6..2.8, from the piers to the block and the pilaster |
| cross beams of the middle aisle | 2.809-2.818 m | Y -3.4..-3.0, -6.7..-6.3, -8.5..-8.2, -1.5..-1.15 |
| cross beams of the side aisles | 2.895, 2.900 m (west); 2.931, 2.924 m (east) | Y -3.3..-2.9 and -6.8..-6.4 |
| 11 raised panels | 3.172-3.216 m | see the config; the centre one X -1.575..1.525, Y -6.25..-3.425 |
| bays by the street wall | 2.795 m (west), 2.808 m (east), 2.797 m (entrance recess) | |
| boxed lintels over the windows | 2.677 m (west), 2.716 m (east) | from the glass to 0.47 m inside the wall's face |
| lift bay | 2.705 m | |
| lobby door's casing, top / its passage | 2.16 m | |

The panels are flat, each within a moulded cornice about 0.1 m wide. The centre, west and east panels
carry round plaster medallions and the chandeliers; a concealed light in the cornice washes the centre
panel (seen lit; the others not checked one by one).

Upper section (heights above its own floor, Z -2.981; add 0.594 for the config's): lower ceiling 2.166-2.180 m
(landing, lobby, and a border round the raised field); raised field 2.288-2.293 m, two rectangles,
X -4.55..-0.875 by Y 6.125..10.275 and X -2.95..-0.875 by Y 3.125..6.125; the arch between lobby and main
room 2.055 m; the lift's landing 1.981 m; the west casing's top 1.55 m; a boxing 0.11 m proud along the head
of the west wall from 1.98 m (lobby and the stretch north of the arch).

## Independent check (`10_raycheck.py`)

A second method on a different sample of the same mesh: no sections, no rasters.

1. Tape lines (pairs of opposite rays, wall to wall, at two heights; 19 dimensions, 38 rows of two to four
   lines): lower section 12.478-12.487 m west wall to east wall (fitted 12.478-12.488), 12.151-12.161 m north
   of the lobby door, 10.060-10.067 m north of the shoulders; west bay 3.094-3.109 m, between the piers
   3.475-3.479 m, east bay 3.796-3.818 m; entrance recess 2.781-2.798 m; east window's glass to the back wall
   9.632-9.642 m; west window's glass to the shoulder 8.035-8.044 m; pier ends to the block and the pilaster
   6.512-6.523 m and 6.489-6.501 m at the edges; alcove 3.342-3.344 m above its mirrors; arch 2.345-2.380 m
   (the plants on the plinths reach into the line); upper section 5.607-5.615 m wide, 4.093-4.105 m in its
   narrow part, 4.111-4.135 m across the lobby, 9.820-9.831 m long, 5.568-5.575 m from the west return to the
   north wall. Against the fitted faces: within 9 mm, but for the lines named under "corrections" and one
   line of the south-east return (14 mm, not explained).
2. Fans from the 30 stations (20 597 hits at four pitches): 65 faces compared, ten more drew too few hits.
   Each drawn face's robust line is within 3 mm of the plan-section fit, except the lobby's south wall
   (+6.0 mm), the street wall's west face (-5.7 mm on 21 hits) and the entrance screen (+21 mm). Two faces
   that are not drawn differ more: the lift's gate (16 mm) and the west wall above its dado (6 mm). Angles
   on the long walls agree within 0.02 degrees.
3. Plumb lines on a 0.2 m grid: lower floor `Z = -3.5683 + 0.00060 X + 0.00106 Y` (2 412 lines, rms 3.9 mm),
   -3.5751 at the centre against the raster's -3.5753; upper floor `Z = -2.9656 + 0.00456 X - 0.00022 Y`
   (1 161 lines, rms 7.4 mm), -2.9798 against -2.9805. Eighteen ceiling parts within 2 mm of the raster's
   medians.
4. The steps: plumb lines every centimetre up three lines give tread levels -3.574..-3.582, -3.425..-3.429,
   -3.287..-3.289, -3.142..-3.146, -2.980..-2.988 and risers at -0.525..-0.545, -0.235..-0.240, 0.060..0.075,
   0.365..0.375; level rays at the middle of each riser give -0.529..-0.545, -0.234..-0.249, 0.060..0.070,
   0.362..0.383. Against the sections: levels within 4 mm, riser lines within 10 mm.

Corrections it caused:

- The entrance screen. The section fit mixed the door leaf and the sidelights (two planes 5 cm apart) and
  gave Y -11.407 with a false slope of -1.7 degrees. The fans give -11.385 with no slope. It is drawn
  parallel to the axis at -11.40, the door leaf's face, with the sidelights' glass 0.05 m behind.
- The alcove's east wall. It was first drawn at X 1.664, a surface of the sections. A tape line above the
  mirrors reads 3.343 m between the two walls, which puts the east wall at 1.632 (the fit) and the surface
  at 1.664 behind the mirror: a false surface. The east wall, the pilaster's length and the alcove's panel
  moved 3.2 cm.
- The lobby's south wall is drawn at Y 1.453, between the sections (1.450) and the fans (1.456); the street
  wall's west face at -10.920, between -10.917 and -10.922.
- The pier ends, the block's face and the pilaster are fluted, not flat: a tape line down the middle of
  each reads 2.2-4.3 cm longer than lines near its edges. The faces stay where the fits put them; their
  notes and residuals say so.
- The upper west return is not one plane: a line at X -4.4 reads 8.3 cm short, because the return's east
  0.45 m stands 6 cm further north. Not drawn; the wall's note says so.
- The upper floor's fall is 4.6 mm/m when sampled evenly, not the raster fit's 5.7 mm/m. Both are given.
- Lines that met something other than a wall, and say nothing about the outline: a mullion of the west
  window (4 cm, which confirms it stands that far proud of the glass), the planters' plants in the entrance
  recess at 1.5 m, the framed painting on the block's north face at 1.5 m (2.9 cm), the west casing in the
  upper section (25 cm), the plants on the plinths at the arch.

Earlier corrections, from the photographs and from reading the sections again: the steps are straight,
not bowed, and the beams straight, not segmental (panoramas bend straight lines); the room has no domes;
the arch to the upper section is square-headed and as high as the upper ceiling; the "curved screen wall"
is a quarter circle at the lobby, not the upper section's east wall, which is straight; stations 92 and 93
stand inside that circle, in the corridor; the north wall's fit first lost its east third to a 5 cm window
(hence the second pass); the east chandelier's axis is X 4.52 by the photograph against 4.57 in the mesh.

## Openings

Heights above the lower floor. Edges from the depth rasters (`06`), checked on photographs re-projected at
4-5 mm per pixel on each opening's own plane (`views.py plane`).

| Opening | Wall | E57 centre | Width | Sill | Head | Glazing | In the scan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| window-west | street-w | X -4.606 | 2.26 | 0.605 | 2.677 (lintel; glass to 2.805) | frosted film to 2.00 m, clear above; glass Y -11.318 | closed; a plant before its west light |
| entrance-screen | entrance | X -0.17 | 2.72 | 0.285 (plinth) | 2.745 (door leaf 2.805) | frosted to 1.945 m with the ENTRANCE lettering, clear above | door closed, not in use; two planters before it |
| window-east | street-e | X 3.935 | 2.23 | 0.637 | 2.716 (lintel; glass to 2.825) | frosted film to 2.04 m, clear above; glass Y -11.120 | closed; a plant at each side |
| door-lobby | casing | Y -4.835 | 1.35 | 0 | 2.05 | none | open: two pairs of leaves folded into the passage |
| door-west | door-wall | Y -2.735 | 0.71 | 0 | 2.045 | none | closed |
| door-corridor | up-east | Y 7.495 | 1.66 | 0.594 | 2.634 | none | closed (double) |
| door-north-east | up-north | X -0.22 | 0.94 | 0.594 | 2.599 | none | closed |
| door-north-west | up-north | X -2.785 | 0.95 | 0.594 | 2.584 | none | closed |
| lift-landing | lift-landing | X -3.569 | 0.99 | 0.594 | 2.569 | none | open way, no door |

Each window has three lights between two mullions 0.12 m wide. The frosting is a film on single panes, not
a second row of panes: there is no transom. Two openings are not on the outline and so are not in this
table: the arch to the upper section (2.375 m wide, in the outline as its two jambs) and the arch between
the lobby and the main upper room (wall to wall, 4.12 m, head 2.055 m above the upper floor), whose pair of
leaves stood open against the side walls.

## Measured against the records

| | Measured | Venue's website | Production record | Venue's plan | Difference |
| --- | --- | --- | --- | --- | --- |
| Lower section, width | 11.19 m west wall to the lobby door's casing; 12.49 m wall to wall south of that door; 12.16 m north of it; 10.07 m north of the shoulders | 11.2 m | none | 11.4 m | website 0.01 m over the first; plan 0.2 m over it; the room is 1.3 m wider than either at its widest |
| Lower section, depth | 7.64 m street wall's face to the shoulders; 9.44 m to the back wall; 9.92 m from the entrance screen; 6.52 m from the pier ends | 7.6 m | none | 7.4 m | website 0.04 m under the first; plan 0.24 m under it |
| Lower section, height | 2.80-2.83 m under the beams; 3.17-3.22 m in the panels | 2.8 m | none | | website is the beams' soffit |
| Lower section, area | 109.0 m2 of floor (with the recess, the lift bay and the alcove's floor) | 85.1 m2 | none | | website 23.9 m2 under; 11.19 x 7.64 m is 85.5 m2 |
| Steps | 3.1 m2 with the plinths; four risers, 0.595 m | | | four treads drawn | |
| Upper section, width | 5.61 m | 5.6 m | 5.6 m | 5.6 m | 0.01 m |
| Upper section, length | 9.82 m lobby's south wall to the north wall; 8.2 m north of the arch | 9.7 m | 9.7 m | 10 m | website and record 0.12 m under; plan 0.18 m over |
| Upper section, height | 2.17 m; 2.29 m under the raised field | 2.18 m | 2.18 m | | 0.01 m |
| Upper section, area | 52.5 m2 (main room 43.1, lobby 6.7, landing 2.6) | 54.3 m2 | 54.3 m2, one rectangle | | 1.8 m2 over |
| Whole room | 164.5 m2 | 139.4 m2 in two rectangles | the upper rectangle only | | |
| Street openings | two windows and a glazed entrance screen | "3 windows" | | two windows | the plan leaves the middle bay blank |
| East wall of the upper section | straight (+0.61 deg), a quarter circle at its south end, a free curve at its north end | | | one long arc with a double door in it | the plan's arc is not in the scan |
| Between lobby and main upper room | an arch with a pair of leaves | | | zigzag lines (a curtain) | |
| Columns | two, round, 0.152 m | | | two circles | |

The website's areas are the products of its two figures. The production record
(`packages/types/src/trades-hall-venue-truth.ts`, the API seed) holds 9.7 x 5.6 x 2.18 m, one rectangle. The
venue's plan was used for its four labels and its layout only; it is private and nothing of it is copied
here. It is not to scale: its own labels imply scales from 41 to 100 pixels per metre. The 2010 drawings
are a basement, a first-floor and a second-floor sheet: no ground floor, so they hold nothing of this room
(the basement sheet shows the storey below; it was not registered to the scan or used).

## Inventory for the later stages

Piers and casings (all fluted, white, on dark bases about 0.3 m high; flutes 2-4 cm deep):

- West pier: E57 X -2.826..-1.749 (1.077 m), from the street wall to Y -8.099; its end 6 cm wider each side
  for 0.3 m. East pier: X 1.728..2.763 (1.035 m), to Y -8.083. Both to the beams (2.80 and 2.83 m). In the
  outline.
- The block between the lift and the steps: south face Y -1.577, X -2.887..-1.793 (casing; corners
  chamfered), west face X -2.887 (-3.072 north of Y 0.7), north face Y 1.453, east face X -1.346 north of
  the arch. Room lies on all four sides of it: see the gaps.
- East pilaster: Y -1.586, X 1.607..2.763, 0.10 m proud of the back wall.
- A loudspeaker at the head of each of the four, facing the hall.

Fittings (positions E57; the schema holds only the chandeliers):

- Chandeliers, crystal, on chains from the medallions: west (-4.50, -4.834), reach 0.22 m, lowest 2.20 m;
  centre (-0.042, -4.850), reach 0.30 m, lowest 2.10 m; east (4.52, -4.838), reach 0.23 m, lowest 2.255 m,
  0.46 m clear of the lobby door's casing. Read from one photograph each on the plane through the axis;
  the mesh gives 2.28, 2.145 and 2.30 m.
- Downlights in the beams and in the upper ceiling; exit signs over the lobby door, over the double door
  and hung over the landing; fire call points on the lobby door's casing (south of the door, 1.1 m) and on
  the block's north face.
- Mirrors in timber frames on both alcove walls, skirting to about 2 m. They show the room and the scanner.
- Two ventilation grilles beside the timber door (Y -2.2..-1.55, at about 0.4 and 1.1 m).
- Radiator covers: upper east wall Y 8.4..9.78 (0.88 m high, 0.31 m deep); the upper west wall's casing
  Y 8.2..11.3 (1.55 m high, 0.25 m deep).
- A framed painting, fire notices and an extinguisher on the block's north face.

Movable things in the scan, to be edited out:

| Thing | Where (E57) | Hides |
| --- | --- | --- |
| plant in a pot | X -6.0..-5.4, Y -11.2..-10.3, to 1.6 m | the west wall's south 0.6 m, the west window's west light |
| two plants | X 2.8..3.3 and 4.6..5.05, Y -11.0..-10.2 | both ends of the east window, the pier's and the return's faces there |
| two white planters with plants | X -1.5..-0.9 and 0.15..0.9, Y -11.3..-10.75 | the entrance screen's sidelights below 1.6 m |
| two plants on the plinths | by the steps | the arch's jambs and the alcove's north corners |
| plant in a pot | X -0.2..0.2, Y 10.05..10.4 | the nook's curved wall, first chords |
| battens, poles, a banner stand | X 1.35..1.65, Y 10.85..11.15 | the nook's end |
| fire extinguisher on the floor | by the block's north-east corner (X -1.45, Y 1.55) | the corner's foot |
| the arch's leaves, open | against up-east (Y 3.09..4.99) and up-west-s (Y 3.14..4.97), 2.0 m high | those walls |
| the lobby door's leaves, open | in the passage beyond the casing | the passage's sides (outside the outline) |

The room was otherwise empty: no furniture. The plants' and planters' extents are read off the plan
sections (+-0.1 m).

Seen poorly: the upper west wall behind its open leaf (not at all) and the upper east wall behind the other;
the upper ceiling, 0.7 m above the cameras and so seen at a low angle everywhere but straight overhead; the
walls behind the west casing and the radiator cover; both alcove walls (mirrors); the lift bay's north and
west walls behind the lift's glass; the entrance screen's sidelights behind the planters; the nook's end.
The 17 October research counted the upper walls 39-75 % seen by three stations and the upper west wall at
Y 2.7..6.0 by one to three; this pass did not recount.

Stations: scan_086 to 088, 094 to 111 and 113 stand on the lower floor (105 in the entrance recess, 113 in
the alcove, 102 under the centre chandelier); scan_112 and 114 to 120 on the upper floor (112 on the
landing, 114 and 115 in the lobby); scan_085 in the lobby door's passage, 1.48 m beyond the casing's face
(a doorway station). Left out: scan_089 to 091 in the rear corridor's east-west run, scan_092 and 093 in
its bend behind the screen wall (0.3-0.8 m from the wall's corridor face; the double door to the room was
closed), scan_081 to 084 in the entrance hall.

## What the schema and the driver cannot express

The driver refuses the config as it stands, for three reasons: `a curved wall (sagitta) is not supported
yet`, `free-standing elements are not supported yet`, `more than one floor level is not supported yet`. With
the sagitta, the two columns and all but the lower floor level taken out of a scratch copy, `--plan`
accepts the rest and opens 232 gates: B4 (14 walls off the axes: the four drawn as measured, the screen wall's chord, the six chords of the nook and three short stretches by the upper arch), B5 (32) and B8 (50) for the short
faces, B6 and B9 (64 each: reflex ends), B7, B10 (the three glazed openings), B14 (an 8192 x 4096 atlas),
B16, B17 and B18.

Schema:

- One floor datum. A wall has a height but no foot, so the upper section's walls are given by their heads
  above the lower floor; its doors carry sills of 0.594 m; `freeStanding.height` does not say from where
  (the columns' own length is given); the checker measures every station's lens from y = 0 and warns for
  the eight on the upper floor.
- `floor.levels` are flat polygons with a height and a note. They cannot say "a step", "nothing may be
  placed here", a riser, a nosing, a handrail or a lift; the upper floor's 3 cm fall is in a note; overlap
  order is not defined.
- An outline is one simple polygon. The block between the lift and the steps has room on all four sides
  (lift bay, lift landing, lobby, steps). To keep one polygon the lift's upper landing is left outside and
  entered through an opening (`lift-landing`); the lift bay below it is inside. A polygon with a hole, or a
  free-standing element with its own outline, would say what is there.
- No internal line. The arch with a pair of leaves between the lobby and the main upper room, and the arch
  at the head of the steps, have no place as openings; the first is a ceiling `beam` region and a note.
- `sagitta` gives one circular arc. That fits the screen wall; the nook's free curve is six chords. Floor
  and ceiling regions cannot be curved: the upper floor's outline samples the arc.
- A glass block may not rise above its face opening. Both windows' glass runs 0.11-0.13 m higher than the
  boxed lintel in front of it; the lintel's soffit is given as both heads.
- A door cannot be glazed (the driver ignores a door's glass): the entrance screen, a glazed door between
  sidelights, is recorded as one window.
- `published` holds one set of figures; the venue publishes two for this room.
- `fittings.kind` has no loudspeaker, downlight, sign, grille, radiator cover, mirror, handrail or lift;
  `concealedLights` lists walls, so the light in a ceiling panel's cornice has no place.
- Ceiling regions are flat polygons with one height: a cornice's profile, and the light trough inside it,
  are in notes only. `ceiling.height` is one figure for two sections.
- `site` has one pavement level for the whole front.

Driver and the surfaces it builds:

- Wall views use one `eyeInset` (1.0 m here). The nook's walls face each other 0.32-1.37 m apart, so its
  elevations would be taken from behind the opposite wall; the east chandelier hangs 0.46 m clear of the
  lobby door's casing, inside the casing's view (the checker warns of it).
- Wall views and the relief run from y = 0 on every wall; the upper section's walls start at 0.594 m.
- The floor photograph and its mask are one plane at y = 0: the upper floor, the treads and the plinths are
  at five other heights, and the risers and plinth sides are vertical faces inside the floor.
- The ceiling relief is one height field from 2.3 m up. In the upper section that band also holds the
  arch's head, the open leaves' tops and the lift landing's lintel.
- Height fields cannot hold: the columns (neither wall nor ceiling), the handrails, the lift with its glass
  and rails, the chandeliers (occluders keep rays out of them, nothing draws them), the light troughs in
  the panels' cornices (behind an upstand: past vertical from below), and the mirrors, whose photographs
  are reflections. There are no vault undersides to hold: the ceilings are flat.
- `relief.holdCeiling` is one height; walls here stop anywhere from 2.57 to 3.22 m.

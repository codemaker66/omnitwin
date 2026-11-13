"""Writes ../../robert-adam-room.room.json from the figures measured by 01-11 (each constant names its
source; the outline's constants are checked against 05's fits when they are at hand).

Planner frame: quarter turn 2, x = 0.32 - X, z = Y + 0.04, y = Z + 3.575, so the street wall (E57 -Y,
101.1 deg true) is on -z, as the Grand Hall's is. The origin is the middle of the outline's bounding box.

    12_write_config.py [out.json]"""
import json
import math
import os
import sys

import numpy as np
from ralib import OUT, FLOOR_LO, FLOOR_UP

CX, CY, FLOOR_Z = 0.32, -0.04, -3.575
UP = round(FLOOR_UP - FLOOR_Z, 3)            # the upper floor above the lower: 0.594 (02, 10)
fits = json.load(open(OUT + "/scripts/wall_fits.json")) if os.path.exists(OUT + "/scripts/wall_fits.json") else {}


def pl(X, Y):
    return [round(CX - X, 3), round(Y - CY, 3)]


def adopted(name, value, tol=0.006):
    """A face's offset as drawn; refuses to differ from 05's fit by more than tol."""
    if name in fits and abs(fits[name]["offset_at_mid"] - value) > tol:
        raise SystemExit("%s: drawn at %.3f but fitted at %.3f" % (name, value, fits[name]["offset_at_mid"]))
    return value


# --- wall faces, E57 (05_wall_fits.py; lower section 0.45-1.05 m above its floor, upper 0.5-1.5 m above its own) ----
def W(Y):                                    # lower west wall, its dado face: +0.19 deg (rms 1.6 mm)
    return -5.9238 + 0.00337 * (Y + 6.823)


def ES(Y):                                   # lower east wall, south part: -0.41 deg (rms 1.3 mm)
    return 6.5641 - 0.00714 * (Y + 8.262)


def NW_(X):                                  # upper north wall: -0.87 deg (rms 2.3 mm)
    return 11.2711 - 0.01517 * (X + 1.8)


def UE(Y):                                   # upper east wall: +0.61 deg (rms 2.5 mm)
    return 0.1254 + 0.01068 * (Y - 7.474)


SW = adopted("street_w", -10.920)            # street wall's face in the west bay (sections -10.917, fans -10.922)
PWW, PWN, PWE = adopted("pier_w_west", -2.826), adopted("pier_w_north", -8.099), adopted("pier_w_east", -1.749)
SCW, RW = adopted("street_c_west", -10.287), adopted("recess_west", -1.558)
ENT = -11.400                                # the entrance screen: its door leaf's face (06; fans -11.385, sidelights' glass -11.45)
RE, SCE = adopted("recess_east", 1.235), adopted("street_c_east", -10.260)
PEW, PEN, PEE = adopted("pier_e_west", 1.728), adopted("pier_e_north", -8.083), adopted("pier_e_east", 2.763)
SE = adopted("street_e_below_sill", -10.707)  # east bay: the dwarf wall under the window (no wall face above it)
SEW, SER = adopted("se_west", 5.064), adopted("se_return", -9.957)
EJ, EM = adopted("east_jog", -6.569), adopted("east_mid", 6.244)
DS, DF, DN = adopted("door_south", -5.817), adopted("door_face", 5.269), adopted("door_north", -3.865)
EN, NES, NEE = adopted("east_north", 6.241), adopted("ne_south", -3.276), adopted("ne_east", 5.300)
BE, PIL = adopted("back_east", -1.484), adopted("pilaster_east", -1.586)
PILX = 2.763                                 # the east pilaster's side, in line with the east pier's (read off the sections, +-2 cm)
AE, AW = adopted("alcove_east_mirror", 1.632), adopted("alcove_west_mirror", -1.728)   # the alcove's side walls (see the README on the mirrors)
RISER4 = adopted("top_riser", 0.376)         # the top riser and the wall the arch is in
JW, JE = adopted("arch_jamb_west_lining", -1.244), adopted("arch_jamb_east_lining", 1.131)
JSTEP = 0.68                                 # where the arch's timber lining ends (linings to 0.63-0.66, walls from 0.68-0.71)
BEU, LE = adopted("block_east_up", -1.346), adopted("arch_jamb_east", 1.233)
SCR_C, SCR_R = (1.144, 2.307), 1.052         # the screen wall's circle, room side (08: rms 5.6 mm over 991 points)
SCR_S, SCR_W = 1.258, 0.092                  # its tangents: tail south (fit 1.261, circle 1.255), tail north (circle 0.092)
ARCH_Y = 3.05                                # the arch between the lobby and the main upper room (07: soffit at Y 3.02..3.10)
NOOK = [(0.215, 10.10), (0.304, 10.30), (0.499, 10.50), (0.749, 10.69), (1.350, 10.832), (1.672, 10.902)]   # 08 and the README
NOOK_Y0, NOOK_END = 9.86, adopted("nook_end", 1.672)
WN, WR = adopted("west_north", -5.488), adopted("west_return", 5.742)
WS_N, WS_S = -3.986, -4.046                  # upper west wall, south part, at the return and at the arch (fit -3.994 at Y 5.38)
LOB_W = -4.066                               # the lobby's west wall at its south end (fit -4.065 at Y 1.525, +0.70 deg)
LOB_S = 1.453                                # the lobby's south wall: the block's north face (sections 1.450, fans 1.456)
BWU = adopted("block_west_up", -3.072)
BS, BW = adopted("block_south", -1.577), adopted("block_west", -2.887)
LIFT_N = 0.0                                 # the lift bay's north side: wall at 0.026, the riser under the upper floor's edge at -0.031
LW, BAY, DW, NWS = adopted("lift_west", -4.573), adopted("bay_south_west", -1.487), adopted("door_wall_west", -4.768), adopted("nw_step", -3.278)

# --- the outline, counter-clockwise from the lower section's south-west corner: (id, name, E57 end vertex, kind, note) ---
V0 = (W(SW), SW)
OUTLINE = [
    ("street-w", "Street wall, west bay", (PWW, SW), "solid", "E57 Y = -10.920 (wall face above and below the window; the apron under the board is 2.5 cm proud). Carries the west window. A boxed lintel 2.677 m up runs 0.44 m into the room over it."),
    ("pier-w-w", "West pier, west face", (PWW, PWN), "solid", "E57 X = -2.826 (rms 4.0 mm). The piers are fluted casings on dark bases; this pier's end is 6 cm wider each side for its last 0.3 m (X -2.888)."),
    ("pier-w-n", "West pier, end", (PWE, PWN), "solid", "E57 Y = -8.099 (rms 7.6 mm: the flutes; a tape line down its middle reads 2-3 cm deeper than its edges). A loudspeaker at its head."),
    ("pier-w-e", "West pier, east face", (PWE, SCW), "solid", "E57 X = -1.749 (rms 1.2 mm)."),
    ("street-cw", "Street wall, centre bay, west of the recess", (RW, SCW), "solid", "E57 Y = -10.287, 0.19 m long."),
    ("recess-w", "Entrance recess, west side", (RW, ENT), "solid", "E57 X = -1.558 (rms 3.0 mm; +1.9 deg over its 1.1 m, drawn axis-parallel)."),
    ("entrance", "Entrance screen", (RE, ENT), "screen", "E57 Y = -11.40: a white timber screen across the back of the recess, a glazed door between two sidelights, on a dark timber plinth 0.285 m high. The door's leaf is at -11.40 and the sidelights' glass at -11.45. Two planters stand in front of it; the door is not in use."),
    ("recess-e", "Entrance recess, east side", (RE, SCE), "solid", "E57 X = 1.235 (rms 3.4 mm)."),
    ("street-ce", "Street wall, centre bay, east of the recess", (PEW, SCE), "solid", "E57 Y = -10.260, 0.49 m long."),
    ("pier-e-w", "East pier, west face", (PEW, PEN), "solid", "E57 X = 1.728 (rms 0.9 mm). Its end is wider for its last 0.3 m (X 1.613)."),
    ("pier-e-n", "East pier, end", (PEE, PEN), "solid", "E57 Y = -8.083 (rms 9.0 mm: the flutes). A loudspeaker at its head."),
    ("pier-e-e", "East pier, east face", (PEE, SE), "solid", "E57 X = 2.763 (rms 6.7 mm)."),
    ("street-e", "Street wall, east bay", (SEW, SE), "solid", "E57 Y = -10.707: the dwarf wall under the east window. This bay has no wall face above the board: the window fills it from pier to return. A boxed lintel 2.716 m up runs over it."),
    ("se-west", "East bay, return", (SEW, SER), "solid", "E57 X = 5.064 (rms 4.2 mm)."),
    ("se-return", "South-east return", (ES(SER), SER), "solid", "E57 Y = -9.957 (rms 8.2 mm)."),
    ("east-s", "East wall, south part", (ES(EJ), EJ), "solid", "Drawn as measured: E57 X 6.576 at the return to 6.552 at the jog (-0.41 deg, rms 1.3 mm)."),
    ("east-jog", "East wall, jog", (EM, EJ), "solid", "0.31 m step at E57 Y -6.569."),
    ("east-mid", "East wall, south of the lobby door", (EM, DS), "solid", "E57 X = 6.244 (rms 1.7 mm)."),
    ("casing-s", "Lobby door's casing, south side", (DF, DS), "solid", "E57 Y = -5.817: the doorway to the entrance hall stands in a casing 0.975 m into the room and 1.95 m wide."),
    ("casing", "Lobby door's casing, face", (DF, DN), "solid", "E57 X = 5.269 (jambs rms 9 mm; the head over the door fits the same plane, 4.5 mm). Carries the double door to the entrance hall, a timber architrave, an exit sign on a cornice shelf and a fire call point south of the door; the casing's top is 2.16 m, with the east panel above it."),
    ("casing-n", "Lobby door's casing, north side", (EN, DN), "solid", "E57 Y = -3.865."),
    ("east-n", "East wall, north of the lobby door", (EN, NES), "solid", "E57 X = 6.241 (rms 2.6 mm), 0.59 m long."),
    ("ne-south", "North-east shoulder", (NEE, NES), "solid", "E57 Y = -3.276: the room narrows here by 0.94 m, as it does on the west at Y -3.278."),
    ("ne-east", "East wall, north part", (NEE, BE), "solid", "E57 X = 5.300 (rms 0.2 mm)."),
    ("back-east", "Back wall, east", (PILX, BE), "solid", "E57 Y = -1.484 (rms 1.2 mm), plain."),
    ("pilaster-rtn", "East pilaster, side", (PILX, PIL), "solid", "0.10 m step."),
    ("pilaster", "East pilaster", (AE, PIL), "solid", "E57 Y = -1.586: a fluted casing as wide as the east pier, facing it, with a loudspeaker at its head. Its west return stands at X 1.607, 2.5 cm into the alcove's mouth."),
    ("alcove-e", "Step alcove, east wall", (AE, RISER4), "solid", "E57 X = 1.632 (the fit keeps 57% of its points: a timber-framed mirror from the skirting to about 2 m gives the mesh a false surface behind it at 1.66; a tape line above both mirrors reads 3.343 m wall to wall, the two fits 3.350). A niche 0.23 m wide and 0.17 m deep at its north end (X 1.44..1.66, Y to 0.55) is drawn closed."),
    ("archwall-e", "Wall of the arch, east of it", (JE, RISER4), "solid", "E57 Y = 0.376."),
    ("archjamb-e", "Arch to the upper section, east jamb", (JE, JSTEP), "solid", "E57 X = 1.131: the arch's timber lining, 0.30 m deep. The arch is 2.375 m wide and as high as the upper section's ceiling (2.77 m above the lower floor), square-headed."),
    ("landing-rt-e", "Landing, east return", (LE, JSTEP), "solid", "0.10 m step behind the lining."),
    ("landing-e", "Landing, east wall", (LE, SCR_S), "solid", "E57 X = 1.233 (rms 1.6 mm)."),
    ("screen-tail", "Screen wall, south tail", (SCR_C[0], SCR_S), "solid", "E57 Y = 1.258, 0.09 m, tangent to the curve."),
    ("screen", "Curved screen wall", (SCR_W, SCR_C[1]), "solid", "A quarter circle, radius 1.052 m about E57 (1.144, 2.307) (rms 5.6 mm over five heights), bowing into the room: the outside of the rear corridor's rounded corner. White, plain, with a skirting. The chord is drawn; the wall's middle stands 0.308 m inside it."),
    ("lobby-e", "Lobby, east wall", (UE(ARCH_Y), ARCH_Y), "solid", "From the curve's end to the arch into the main upper room: E57 X 0.092 to 0.078."),
    ("up-east", "Upper section, east wall", (UE(NOOK_Y0), NOOK_Y0), "solid", "Drawn as measured: E57 X 0.078 at the arch to 0.151 at the nook (+0.61 deg, rms 2.5 mm). A partition 0.19 m thick with the rear corridor behind it. Carries the double door to the corridor, a pier 0.19 x 0.30 m at Y 8.40..8.72 and a radiator cover (Y 8.4..9.78, 0.88 m high, 0.31 m deep). The arch's east leaf stood open against it (Y 3.09..4.99, face X -0.109)."),
] + [
    ("nook-%d" % (k + 1), "North-east nook, curved wall, chord %d" % (k + 1), p, "solid",
     "The nook's south wall is a free curve, not a circle (a circle of 1.29 m fits only its first 45 degrees, rms 8 mm): drawn as chords through measured points." if k == 0 else "")
    for k, p in enumerate(NOOK)
] + [
    ("nook-end", "North-east nook, end", (NOOK_END, NW_(NOOK_END)), "solid", "E57 X = 1.672: the nook narrows from 1.37 m to 0.32 m and stops. Battens, poles and a banner stand were stored in it."),
    ("up-north", "Upper section, north wall", (WN, NW_(WN)), "solid", "Drawn as measured: E57 Y 11.218 at the nook's end to 11.327 at the west wall (-0.87 deg, rms 2.3 mm over 6.8 m). Carries two doors."),
    ("up-west", "Upper section, west wall", (WN, WR), "solid", "E57 X = -5.488 (rms 2.0 mm, read above the casing). A boxed casing with radiator grilles stands 0.251 m in front of it from Y 8.2 to the north wall, 1.55 m high (face X -5.237)."),
    ("up-return", "Upper section, west return", (WS_N, WR), "solid", "E57 Y = 5.742 (rms 2.0 mm); its east 0.45 m stands 6 cm further north (5.80)."),
    ("up-west-s", "Upper section, west wall, south part", (WS_S, ARCH_Y), "solid", "E57 X -3.986 at the return to -4.046 at the arch (the bare wall is seen only at Y 5.06..5.70, -3.994, and south of the arch). The arch's west leaf stood open against it (Y 3.14..4.97, face X -3.775): the wall behind the leaf was not seen."),
    ("lobby-w", "Lobby, west wall", (LOB_W, LOB_S), "solid", "E57 X -4.046 at the arch to -4.066 (+0.70 deg, rms 2.9 mm). It runs on south past the lift's landing to Y 0.03. A boxing 0.11 m proud runs along its head from 1.98 m above the upper floor (as along the wall north of the arch), which is where the height given stops."),
    ("lift-landing", "Lobby, opening to the lift's landing", (BWU, LOB_S), "solid", "E57 Y = 1.453: the line of the lobby's south wall across the way to the platform lift's upper landing (X -4.07..-3.07, Y 0.03..1.45, outside this outline; ceiling 1.98 m above the upper floor). The whole segment is the opening."),
    ("lobby-s", "Lobby, south wall", (BEU, LOB_S), "solid", "E57 Y = 1.453 (sections 1.450, fans 1.456; rms 7.8 mm): the north face of the block between the lift and the steps. A framed painting, fire notices, a call point and an extinguisher on it."),
    ("block-e", "Landing, west wall", (BEU, JSTEP), "solid", "E57 X = -1.346 (rms 4.1 mm): the block's east face, with a rounded corner to the lobby."),
    ("landing-rt-w", "Landing, west return", (JW, JSTEP), "solid", "0.10 m step behind the arch's lining."),
    ("archjamb-w", "Arch to the upper section, west jamb", (JW, RISER4), "solid", "E57 X = -1.244: the arch's timber lining."),
    ("archwall-w", "Wall of the arch, west of it", (AW, RISER4), "solid", "E57 Y = 0.376."),
    ("alcove-w", "Step alcove, west wall", (AW, BS), "solid", "E57 X = -1.728 (rms 5.6 mm; -1.9 deg over 1.2 m, drawn axis-parallel). Carries a timber-framed mirror. The block's casing returns at X -1.793 for its south 0.4 m, 6.5 cm behind this face."),
    ("block-s", "Block between the lift and the steps, south face", (BW, BS), "solid", "E57 Y = -1.577 (rms 9.0 mm: the flutes): a fluted casing facing the west pier, with a loudspeaker at its head and a lift call button on it. Its corners are chamfered."),
    ("block-w", "Lift bay, east wall", (BW, LIFT_N), "solid", "E57 X = -2.887 (rms 6.8 mm)."),
    ("lift-head", "Lift bay, north side under the landing", (LOB_W, LIFT_N), "screen", "E57 Y = 0.0 (the riser under the upper floor's edge is at -0.031). To 0.594 m it is the edge of the upper floor; above that, the lift's gate on its landing (top rail about 1.1 m above the upper floor). Height given: the riser's."),
    ("lift-head-w", "Lift bay, north wall", (LW, LIFT_N), "solid", "E57 Y = 0.026 (rms 1.9 mm), drawn in line with the riser."),
    ("lift-w", "Lift bay, west wall", (LW, BAY), "solid", "E57 X = -4.573 (rms 2.8 mm)."),
    ("bay-return", "Return by the lift bay", (DW, BAY), "solid", "0.195 m step at E57 Y -1.487."),
    ("door-wall", "West wall, north part", (DW, NWS), "solid", "E57 X = -4.768 (rms 5.0 mm). Carries the timber door and two ventilation grilles."),
    ("nw-step", "North-west shoulder", (W(NWS), NWS), "solid", "E57 Y = -3.278 (rms 2.4 mm)."),
    ("west", "West wall", V0, "solid", "Drawn as measured at its dado: E57 X -5.912 at the shoulder to -5.938 at the street wall (+0.19 deg, rms 1.6 mm over 7 m). The dado stands 0.165 m proud of the wall to its rail at about 1.2 m; above the rail the wall is at X -6.089 (rms 5.9 mm). A plant stood in the south-west corner."),
]
E57 = [V0] + [s[2] for s in OUTLINE[:-1]]     # vertex i starts segment i
N = len(OUTLINE)
verts = [pl(*p) for p in E57]
SAG = SCR_R - math.sqrt(SCR_R ** 2 - (math.hypot(SCR_W - SCR_C[0], SCR_C[1] - SCR_S) / 2) ** 2)


def poly_area(P):
    return abs(sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))) / 2


def inside(P, x, y):
    n, c = len(P), False
    for i in range(n):
        (x0, y0), (x1, y1) = P[i], P[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


# --- wall heights: the ceiling met 0.10 m inside each face (07's raster), above the lower floor ---------------------
RES, RX0, RY1 = 0.025, -7.0, 12.0
ceil = np.load(OUT + "/scripts/ceiling_low.npy")


def ceiling_at(X, Y):
    i, j = int((RY1 - Y) / RES), int((X - RX0) / RES)
    return ceil[i, j] - FLOOR_Z if 0 <= i < ceil.shape[0] and 0 <= j < ceil.shape[1] else float("nan")


def wall_height(a, b):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)          # the room is on the left
    hs = [ceiling_at(a[0] + (b[0] - a[0]) * t + 0.10 * n[0], a[1] + (b[1] - a[1]) * t + 0.10 * n[1]) for t in np.linspace(0.08, 0.92, max(3, int(L / 0.05)))]
    hs = [h for h in hs if h == h and 2.3 < h < 3.4]
    return round(float(np.percentile(hs, 90)), 3) if hs else None


segments, heights = [], {}
for i, (sid, name, end, kind, note) in enumerate(OUTLINE):
    h = wall_height(E57[i], end)
    if sid == "lift-head":
        h = UP
    if sid == "screen":                        # its chord lies behind the wall, under the corridor's ceiling: the lobby's is given
        h = round(2.171 + FLOOR_UP - FLOOR_Z, 3)
    if h is None:                              # a plant or stored things under the ceiling there: take the last wall's
        if not heights:
            raise SystemExit("no ceiling over wall " + sid)
        h = heights[OUTLINE[i - 1][0]]
    heights[sid] = h
    seg = {"id": sid, "name": name, "kind": kind, "height": h}
    if sid == "screen":
        seg["sagitta"] = -round(SAG, 3)
    if note:
        seg["note"] = note
    segments.append(seg)

# --- areas (E57 polygons; the screen wall's arc taken off the chord) -----------------------------------------------
ARC_CUT = SCR_R ** 2 * (math.pi / 4 - 0.5)
iA, iB = [s[0] for s in OUTLINE].index("archwall-e"), [s[0] for s in OUTLINE].index("archjamb-w")
UPPER_E57 = E57[iA + 1:iB + 2]                 # from the arch's east jamb round to its west jamb, closed along the top riser
arc = [(SCR_C[0] - SCR_R * math.sin(math.radians(t)), SCR_C[1] - SCR_R * math.cos(math.radians(t))) for t in (15, 30, 45, 60, 75)]
k = UPPER_E57.index((SCR_C[0], SCR_S))
UPPER_FLOOR = UPPER_E57[:k + 1] + arc + UPPER_E57[k + 1:]
A_TOTAL = poly_area(E57) - ARC_CUT
A_UPPER = poly_area(UPPER_FLOOR)
RISER1 = -0.536                               # 03 and 10: risers at Y -0.536, -0.238, 0.067, 0.376 on the flight's centre line
A_STEPS = (AE - AW) * (RISER4 - RISER1)
A_LOWER = A_TOTAL - A_UPPER - A_STEPS

# --- openings ------------------------------------------------------------------------------------------------------
GLASS_W, GLASS_E = adopted("glass_w", -11.318), adopted("glass_e", -11.120)
openings = [
    {"id": "window-west", "wall": "street-w", "kind": "window", "headShape": "square", "centreE57": [-4.606, SW], "width": 2.26, "sill": 0.605, "head": 2.677,
     "glazing": "frosted-lower", "dressing": "none", "stateInScan": "closed", "reveal": {"depth": round(SW - GLASS_W, 3)},
     "glass": {"width": 2.25, "sill": 0.605, "head": 2.677, "headShape": "square", "planes": [{"depth": round(SW - GLASS_W, 3), "note": "E57 Y -11.318 (rms 7.3 mm; fans -11.319)."}],
               "frostedBelow": 2.0, "note": "Three lights, 0.50, 1.02 and 0.49 m of glass between mullions 0.12 m wide (centres X -5.17 and -4.03) standing 4-5 cm proud of the glass. A frosted film with seven crests reaches 2.00 m; the glass above is clear. The glass itself rises to 2.805 m, 0.13 m above the lintel's soffit and behind it: the schema's glass may not rise above its face opening, so 2.677 is given."},
     "note": "Jambs E57 X -5.73 and -3.48 (mesh; -5.742 and -3.47 on the photograph re-projected on the glass plane). Board at 0.605 m. A plant stood in front of its west light."},
    {"id": "entrance-screen", "wall": "entrance", "kind": "window", "headShape": "square", "centreE57": [-0.17, ENT], "width": 2.72, "sill": 0.285, "head": 2.745,
     "glazing": "frosted-lower", "dressing": "none", "stateInScan": "closed",
     "glass": {"width": 2.72, "sill": 0.285, "head": 2.745, "headShape": "square", "planes": [{"depth": 0.05, "note": "Sidelights' glass at E57 Y -11.45; the door leaf's own glass about -11.41."}],
               "frostedBelow": 1.945, "note": "Sidelights X -1.53..-0.79 and 0.45..1.19; the door's glass X -0.57..0.22, from 0.535 m. The frosting carries the lettering THE TRADES HALL OF GLASGOW ... ENTRANCE and an arrow. The sidelights' sills are behind the planters and were not seen: the plinth's 0.285 m is given."},
     "note": "A glazed door (leaf X -0.77..0.43, hinged on the west, closed, to 2.805 m) between two sidelights (to 2.745 m): recorded as a window because the schema's doors are not glazed. Two white planters with plants stood in front of it."},
    {"id": "window-east", "wall": "street-e", "kind": "window", "headShape": "square", "centreE57": [3.935, SE], "width": 2.23, "sill": 0.637, "head": 2.716,
     "glazing": "frosted-lower", "dressing": "none", "stateInScan": "closed", "reveal": {"depth": round(SE - GLASS_E, 3)},
     "glass": {"width": 2.23, "sill": 0.637, "head": 2.716, "headShape": "square", "planes": [{"depth": round(SE - GLASS_E, 3), "note": "E57 Y -11.120 (rms 5.3 mm; fans -11.120)."}],
               "frostedBelow": 2.04, "note": "Three lights, 0.48, 1.03 and 0.50 m of glass between mullions (centres X 3.36 and 4.50). Frosted film with crests to 2.04 m, clear above. The glass rises to 2.825 m behind the lintel, whose soffit (2.716 m) is given."},
     "note": "Fills the bay: glass from E57 X 2.82 to 5.05, the pier and the return as its jambs. Board at 0.637 m. A plant stood at each side of it."},
    {"id": "door-lobby", "wall": "casing", "kind": "door", "headShape": "square", "centreE57": [DF, -4.835], "width": 1.35, "sill": 0, "head": 2.05,
     "glazing": "none", "stateInScan": "open", "note": "To the entrance hall: clear between E57 Y -5.51 and -4.16 at the face (the reveals are -5.510 and -4.172), head 2.035 (mesh) to 2.075 m (photograph). Two pairs of leaves, panelled timber and glazed timber, all folded back into a passage 1.7 m deep. Station 85 stands in the passage."},
    {"id": "door-west", "wall": "door-wall", "kind": "door", "headShape": "square", "centreE57": [DW, -2.735], "width": 0.71, "sill": 0, "head": 2.045,
     "glazing": "none", "stateInScan": "closed", "note": "A six-panel timber door in a timber architrave 0.18 m wide (architrave E57 Y -3.30..-2.18, to 2.20 m); the leaf is 0.10-0.14 m behind the face."},
    {"id": "door-corridor", "wall": "up-east", "kind": "door", "headShape": "square", "centreE57": [round(UE(7.495), 3), 7.495], "width": 1.66, "sill": UP, "head": round(UP + 2.04, 3),
     "glazing": "none", "stateInScan": "closed", "note": "White double doors to the rear corridor, leaves E57 Y 6.665..8.325, 2.04 m high, with brass pulls and an exit sign over them. Sill and head are above the lower floor: the door stands on the upper floor."},
    {"id": "door-north-east", "wall": "up-north", "kind": "door", "headShape": "square", "centreE57": [-0.22, round(NW_(-0.22), 3)], "width": 0.94, "sill": UP, "head": round(UP + 2.005, 3),
     "glazing": "none", "stateInScan": "closed", "note": "A white flush door at the mouth of the nook (leaf E57 X -0.69..0.25), 2.005 m high."},
    {"id": "door-north-west", "wall": "up-north", "kind": "door", "headShape": "square", "centreE57": [-2.785, round(NW_(-2.785), 3)], "width": 0.95, "sill": UP, "head": round(UP + 1.99, 3),
     "glazing": "none", "stateInScan": "closed", "note": "A white flush door with a vent grille, a kick plate and an entry lock (leaf E57 X -3.26..-2.31), 1.99 m high."},
    {"id": "lift-landing", "wall": "lift-landing", "kind": "arch", "headShape": "square", "centreE57": [round((LOB_W + BWU) / 2, 3), LOB_S], "width": round(BWU - LOB_W - 0.004, 3), "sill": UP, "head": round(UP + 1.975, 3),
     "glazing": "none", "note": "The way to the platform lift's upper landing: no door, a lintel 1.975 m above the upper floor."},
]

# --- stations ------------------------------------------------------------------------------------------------------
stations = [{"id": "scan_085", "role": "doorway", "opening": "door-lobby", "note": "In the lobby door's passage, 1.48 m beyond the casing's face."}]
stations += [{"id": "scan_%03d" % k, "role": "room"} for k in [86, 87, 88] + list(range(94, 112)) + [113]]
stations += [{"id": "scan_%03d" % k, "role": "room"} for k in [112] + list(range(114, 121))]
for s in stations:
    if s["id"] == "scan_105":
        s["note"] = "In the entrance recess, 0.34 m from the screen."
    if s["id"] == "scan_113":
        s["note"] = "In the step alcove, at the foot of the steps."
    if s["id"] == "scan_112":
        s["note"] = "On the landing at the head of the steps; like the seven that follow it stands on the upper floor, 2.07 m above the lower floor that y = 0 is."
    if s["id"] == "scan_102":
        s["note"] = "Directly under the centre chandelier."

# --- floor ---------------------------------------------------------------------------------------------------------
T1W, T1E, T2W, T2E, PLW, PLE = -1.516, 1.417, -1.262, 1.140, -1.527, 1.417     # 03: tread and plinth ends
R1, R2, R3 = RISER1, -0.238, 0.067


def rect(x0, x1, y0, y1):
    return [pl(x0, y0), pl(x1, y0), pl(x1, y1), pl(x0, y1)]


levels = [
    {"id": "lower", "height": 0, "note": "E57 Z = -3.5687 + 0.00054 X + 0.00102 Y (rms 4.0 mm over 91.5 m2; plumb lines -3.5683 + 0.00060 X + 0.00106 Y, rms 3.9 mm): -3.575 at the lower section's centre, level within 1.5 cm."},
    {"id": "step-1", "height": 0.146, "outline": rect(T1W, T1E, R1, R2), "note": "First tread, E57 Z -3.429, riser 0.149 m at Y -0.536 (it runs -0.529 at X -1 to -0.545 at X +1: the flight is 0.5 deg askew). 2.93 m wide, wider than the others: it returns in front of the plinths. Brass nosing on its front and both ends."},
    {"id": "step-2", "height": 0.286, "outline": rect(T2W, T2E, R2, R3), "note": "Second tread, E57 Z -3.289, riser 0.140 m at Y -0.238, going 0.298 m, 2.40 m wide between the plinths. Brass nosing."},
    {"id": "step-3", "height": 0.430, "outline": rect(T2W, T2E, R3, RISER4), "note": "Third tread, E57 Z -3.145, riser 0.144 m at Y 0.067, going 0.305 m. Brass nosing. The upper floor is one more riser up: 0.162 m at Y 0.376, going 0.309 m."},
    {"id": "plinth-west", "height": 0.430, "outline": rect(PLW, T2W, R2, RISER4), "note": "A dark timber plinth beside the flight, level with the third tread (0.265 x 0.61 m), carrying a potted plant. Between it and the alcove's wall a strip 0.2 m wide stays at the lower floor's level, where the handrail's posts stand."},
    {"id": "plinth-east", "height": 0.430, "outline": rect(T2E, PLE, R2, RISER4), "note": "As the west plinth (0.277 x 0.61 m), with a plant."},
    {"id": "upper", "height": UP, "outline": [pl(*p) for p in UPPER_FLOOR],
     "note": "E57 Z = -2.9611 + 0.00574 X - 0.00052 Y (rms 7.3 mm; plumb lines -2.9656 + 0.00456 X - 0.00022 Y, rms 7.4 mm): -2.981 at its centre, but it falls westwards, -2.963 at the east wall to -2.993 at the west wall (3 cm over 5.6 m). Everything north of the top riser: the landing, the lobby and the main upper room."},
    {"id": "lift-platform", "height": 0, "outline": rect(-4.03, -3.0, -1.634, -0.031), "note": "The platform lift's footprint as scanned (platform down): 1.03 x 1.60 m, its gate 5-15 cm in front of the bay's mouth. Nothing can be placed here."},
]

# --- ceiling -------------------------------------------------------------------------------------------------------
parts = json.load(open(OUT + "/scripts/ceiling_parts.json"))


def y_lo(h):                                  # a height printed above FLOOR_LO, as planner y
    return round(h + FLOOR_LO - FLOOR_Z, 3)


def y_up(h):                                  # a height printed above FLOOR_UP, as planner y
    return round(h + FLOOR_UP - FLOOR_Z, 3)


def fit_rect(x0, x1, y0, y1, step=0.01):
    """The rectangle pulled in, a centimetre at a time, until its sides lie inside the outline (a panel
    that runs over a wall's dado or a casing). A side moves while a point along it is outside; a corner
    left outside moves whichever side frees it sooner."""
    def side_out(which, x0, x1, y0, y1):
        ts = np.linspace(0.12, 0.88, 9)
        if which == "x0":
            return any(not inside(E57, x0, y0 + (y1 - y0) * t) for t in ts)
        if which == "x1":
            return any(not inside(E57, x1, y0 + (y1 - y0) * t) for t in ts)
        if which == "y0":
            return any(not inside(E57, x0 + (x1 - x0) * t, y0) for t in ts)
        return any(not inside(E57, x0 + (x1 - x0) * t, y1) for t in ts)
    for _ in range(150):
        r = dict(x0=x0, x1=x1, y0=y0, y1=y1)
        moved = False
        for which in ("x0", "x1", "y0", "y1"):
            if side_out(which, **r):
                r[which] += step if which in ("x0", "y0") else -step
                moved = True
        x0, x1, y0, y1 = r["x0"], r["x1"], r["y0"], r["y1"]
        if not moved:
            break
    for cx, cy, sx, sy in ((x0, y0, "x0", "y0"), (x1, y0, "x1", "y0"), (x1, y1, "x1", "y1"), (x0, y1, "x0", "y1")):
        r = dict(x0=x0, x1=x1, y0=y0, y1=y1)
        if inside(E57, r[sx], r[sy]):
            continue
        for kstep in range(1, 60):
            dx = kstep * step * (1 if sx == "x0" else -1)
            dy = kstep * step * (1 if sy == "y0" else -1)
            if inside(E57, r[sx] + dx, r[sy]):
                r[sx] += dx
                break
            if inside(E57, r[sx], r[sy] + dy):
                r[sy] += dy
                break
        x0, x1, y0, y1 = r["x0"], r["x1"], r["y0"], r["y1"]
    return round(x0, 3), round(x1, 3), round(y0, 3), round(y1, 3)


PANEL_NAMES = {"alcove": (-0.05, -0.4), "north-west": (-3.85, -2.2), "north-centre": (0.0, -2.2), "north-east": (4.05, -2.2), "west": (-4.5, -4.85),
               "centre": (0.0, -4.85), "east": (4.5, -4.85), "south-west": (-4.5, -7.5), "south-centre": (0.0, -7.4), "south-east": (4.1, -7.5),
               "between-piers": (0.0, -9.2)}


def named(r, names):
    cx, cy = (r["X"][0] + r["X"][1]) / 2, (r["Y"][0] + r["Y"][1]) / 2
    return min(names, key=lambda key: math.hypot(names[key][0] - cx, names[key][1] - cy))


regions = []
for r in parts["lower: raised panels (above 3.05 m)"]:
    nm = named(r, PANEL_NAMES)
    note = "Flat raised panel within a moulded cornice; bounds where the ceiling passes 3.05 m: E57 X %.2f..%.2f, Y %.2f..%.2f (%.1f m2, %d%% of its rectangle)." % (
        r["X"][0], r["X"][1], r["Y"][0], r["Y"][1], r["area"], round(r["fill"] * 100))
    if nm in ("centre", "west", "east"):
        note += " A round plaster medallion with a chandelier at its centre; a concealed light in the cornice washes the panel (seen lit on the centre one)."
    if nm == "east":
        # it runs round the lobby door's casing: drawn as the panel less the casing
        g = 0.012
        outline = [pl(r["X"][0], r["Y"][0]), pl(EM - g, r["Y"][0]), pl(EM - g, DS - g), pl(DF - g, DS - g), pl(DF - g, DN + g), pl(EN - g, DN + g), pl(EN - g, NES - g), pl(r["X"][0], NES - g)]
        note += " It runs round the lobby door's casing and is drawn so."
    else:
        x0, x1, y0, y1 = fit_rect(r["X"][0], r["X"][1], r["Y"][0], r["Y"][1])
        outline = rect(x0, x1, y0, y1)
        if max(abs(x0 - r["X"][0]), abs(x1 - r["X"][1]), abs(y0 - r["Y"][0]), abs(y1 - r["Y"][1])) > 0.03:
            note += " Drawn pulled in to the outline (X %.2f..%.2f, Y %.2f..%.2f): the panel runs over a dado, a casing or a wall's head." % (x0, x1, y0, y1)
    regions.append({"id": "panel-" + nm, "kind": "raised-panel", "outline": outline, "height": y_lo(r["height"]),
                    "heightRange": [y_lo(r["spread"][0]), y_lo(r["spread"][1])], "note": note})
BEAM_NAMES = {"north-west": (-3.85, -3.1), "south-west": (-4.5, -6.6), "north-east": (4.05, -3.1), "south-east": (4.1, -6.6)}
for r in parts["lower: higher cross beams (2.86-2.96 m)"]:
    x0, x1, y0, y1 = fit_rect(r["X"][0], r["X"][1], r["Y"][0], r["Y"][1])
    regions.append({"id": "beam-" + named(r, BEAM_NAMES), "kind": "beam", "outline": rect(x0, x1, y0, y1), "height": y_lo(r["height"]),
                    "heightRange": [y_lo(r["spread"][0]), y_lo(r["spread"][1])],
                    "note": "A cross beam of the side aisle with a flat soffit, 0.10-0.13 m higher than the main beams (E57 X %.2f..%.2f, Y %.2f..%.2f)." % (r["X"][0], r["X"][1], r["Y"][0], r["Y"][1])})
regions += [
    {"id": "lintel-west", "kind": "soffit", "outline": rect(W(SW) + 0.02, PWW - 0.012, SW + 0.012, -10.45), "height": y_lo(2.677), "heightRange": [y_lo(2.674), y_lo(2.706)],
     "note": "A boxed lintel along the street wall over the west window, from the wall's face 0.47 m into the room (to E57 Y -10.45); it runs on behind the face to the window's head."},
    {"id": "lintel-east", "kind": "soffit", "outline": rect(PEE + 0.012, SEW - 0.012, SE + 0.012, -10.25), "height": y_lo(2.716), "heightRange": [y_lo(2.713), y_lo(2.729)],
     "note": "As the west lintel, over the east window, to E57 Y -10.25."},
    {"id": "lift-bay", "kind": "soffit", "outline": rect(LW + 0.012, BW - 0.012, BAY + 0.012, LIFT_N - 0.012), "height": y_lo(2.705), "heightRange": [y_lo(2.700), y_lo(2.711)],
     "note": "The lift bay's ceiling (plumb lines 2.705 m)."},
]
ed = parts["upper raised field edges"]
rf = parts["upper: raised field (above 2.23 m over the upper floor)"][0]
regions += [
    {"id": "upper-low", "kind": "soffit", "outline": [pl(*p) for p in UPPER_FLOOR], "height": y_up(2.171), "heightRange": [y_up(2.163), y_up(2.184)],
     "note": "The upper section's lower ceiling, 2.166-2.180 m above its own floor: the landing, the lobby, and a border round the raised field (0.94 m wide on the west, 1.0 m on the north and east, and the south-west quarter). Downlights; an air grille and an exit sign over the landing."},
    {"id": "upper-raised-north", "kind": "raised-panel", "outline": rect(ed["west_north"], rf["X"][1], ed["step_Y"], rf["Y"][1]), "height": y_up(2.288), "heightRange": [y_up(2.277), y_up(2.296)],
     "note": "The raised field's north rectangle, 2.288 m above the upper floor (plumb lines 2.288): E57 X %.2f..%.2f, Y %.2f..%.2f. Plain, flat, square-edged. Both columns stand under it." % (ed["west_north"], rf["X"][1], ed["step_Y"], rf["Y"][1])},
    {"id": "upper-raised-south", "kind": "raised-panel", "outline": rect(ed["west_south"], rf["X"][1], rf["Y"][0], ed["step_Y"]), "height": y_up(2.293), "heightRange": [y_up(2.280), y_up(2.296)],
     "note": "The raised field's south rectangle, 2.293 m above the upper floor: E57 X %.2f..%.2f, Y %.2f..%.2f." % (ed["west_south"], rf["X"][1], rf["Y"][0], ed["step_Y"])},
    {"id": "arch-main", "kind": "beam", "outline": rect(WS_S + 0.02, UE(ARCH_Y) - 0.02, 3.02, 3.10), "height": y_up(2.055), "heightRange": [y_up(2.051), y_up(2.062)],
     "note": "The head of the arch between the lobby and the main upper room, 2.055 m above the upper floor, wall to wall (4.12 m). A pair of white leaves 1.9 m wide hang on its jambs; both stood open, back against the side walls. This internal doorway has no place in the outline."},
]

# a wall's head, read through a cornice, may not stand above the highest ceiling part
TOP = max(r["height"] for r in regions)
for seg in segments:
    seg["height"] = heights[seg["id"]] = min(seg["height"], TOP)
TALLEST = max(heights.values())

# --- columns, fittings, occluders --------------------------------------------------------------------------------------
COLS = [("column-south", (-2.062, 6.222), 5.6), ("column-north", (-2.038, 8.790), 4.3)]      # 08: radius 0.076 m both
free = [{"id": cid, "kind": "column", "shape": "round", "centre": pl(*c), "size": [0.152, 0.152], "height": 2.288,
         "note": "A slender round white column, diameter 0.152 m (circle fit rms %.1f mm at five heights), E57 (%.3f, %.3f). It stands on the upper floor (y %.3f) and meets the raised field (y %.3f): the height given is its own length." % (rms, c[0], c[1], UP, y_up(2.288))}
        for cid, c, rms in COLS]
CH = [("chandelier-west", (-4.50, -4.834), 0.22, 2.20, 2.28, 3.167, "crystal-chandelier-small", "five candle lamps"),
      ("chandelier-centre", (-0.042, -4.850), 0.30, 2.10, 2.145, 3.182, "crystal-chandelier-large", "eight candle lamps in two tiers; station 102 stands under it"),
      ("chandelier-east", (4.52, -4.838), 0.23, 2.255, 2.30, 3.209, "crystal-chandelier-small", "five candle lamps; the mesh puts its axis at X 4.57, the ceiling rose in the photograph at 4.51")]
fittings, occluders = [], []
for fid, c, reach, lowest, lowest_mesh, panel, style, what in CH:
    p = pl(*c)
    fittings.append({"id": fid, "kind": "chandelier", "style": style, "position": [p[0], 2.55, p[1]], "suspension": y_lo(panel), "lowest": lowest, "radius": reach,
                     "note": "A crystal chandelier, %s, on a chain from the middle of its panel's medallion. Lowest drop %.2f m and reach %.2f m from the photograph re-projected on the plane through its axis (the mesh, which loses the crystals, gives %.3f m)." % (what, lowest, reach, lowest_mesh)})
    occluders.append({"id": fid.replace("chandelier", "occluder"), "shape": "vertical-cylinder", "centreE57": [c[0], c[1]], "radius": round(reach + 0.06, 2),
                      "zE57": [round(FLOOR_Z + lowest - 0.05, 3), round(FLOOR_Z + y_lo(panel), 3)], "fitting": fid})

# --- site (tools/grand-hall-survey/README.md, Frame) ---------------------------------------------------------------------
GH_X, GH_Z = 8.795 - CX, CY + 4.963            # this origin in the Grand Hall's planner frame
grid = [round(259332 + GH_X * -0.22427 + GH_Z * -0.97453, 2), round(665191 + GH_X * -0.97453 + GH_Z * 0.22427, 2)]
floor_odn = round(14.19 - 0.045 + FLOOR_Z, 3)
site = {"frame": "grand-hall-planner", "observer": {"latitude": 55.8593, "longitude": -4.2491}, "minusZBearingTrue": 101.1, "minusZBearingGrid": 102.96,
        "gridMinusTrueDeg": 1.861, "gridOrigin": grid, "floorODN": floor_odn, "pavementY": round(10.40 - floor_odn, 3), "daylightChannel": "windows",
        "note": "Derived from the Grand Hall frame constants (tools/grand-hall-survey/README.md, Frame; merchant-city-v2 frame block). This room's quarter turn is the Grand Hall's, so its -z is the Grand Hall's -z, E57 -Y: 101.1 deg true, 102.96 grid, facing Glassford Street. gridOrigin = the Grand Hall's (259332, 665191) + this origin's Grand Hall planner position (x = 8.795 - 0.32 = %.3f, z = -0.04 + 4.963 = %.3f) on +x (-0.22427, -0.97453) and +z (-0.97453, 0.22427). floorODN = 14.19 - 0.045 - 3.575 (the Grand Hall's floor is E57 Z 0.045 at 14.19 m ODN); pavementY = 10.40 - floorODN: the lower floor is 0.17 m above the Glassford Street pavement as the Grand Hall's frame has it (one pavement level for the whole front: its fall along the street is not measured here). The three street openings are one storey below the Grand Hall's windows: their skylines must be recomputed at this height."
        % (GH_X, GH_Z)}

# --- survey ----------------------------------------------------------------------------------------------------------
xs, zs = [v[0] for v in verts], [v[1] for v in verts]
EX, EZ = max(xs) - min(xs), max(zs) - min(zs)


def px(ppm):
    return [math.ceil(EX * ppm), math.ceil(EZ * ppm)]


survey = {
    "methodRevision": 2,
    "publish": {"folder": "packages/web/public/rooms/robert-adam-room/survey-2026-07-11", "revision": 1},
    "projection": {"walls": {"cosMin": 0.2, "pCos": 4.0, "qDist": 3.0, "maxDist": 16.0}, "ceiling": {"cosMin": 0.15, "pCos": 4.0, "qDist": 3.0, "maxDist": 16.0},
                   "floor": {"cosMin": 0.12, "pCos": 2.0, "qDist": 2.0, "maxDist": 16.0, "glare": 1, "nadir": True}},
    "wallViews": {"ppm": 200, "heightRange": [-0.05, round(TALLEST + 0.08, 2)], "eyeInset": 1.0, "near": 0.0, "far": 2.3, "tileMaxLength": 6.0, "modes": ["position"]},
    "ceilingView": {"name": "ceiling-pos", "ppm": 150, "eyeHeight": 1.0, "near": 1.3, "far": 2.3, "modes": ["position"]},
    "floorPhoto": {"ppm": 120, "refill": {"innerFraction": 0.75, "easeDeg": 4}},
    "atlas": {"size": 8192, "height": 4096, "ppm": {"pixels": 200, "span": 1}, "vRange": [-0.02, round(TALLEST + 0.02, 3)], "featherTexels": 10, "gutter": 8},
    "relief": {"container": "GHR1", "ppm": 100, "vRange": [0, TALLEST], "depthRange": [-1.2, 0.9], "simplifyError": 0.005, "holdFloor": 0.04, "holdCeiling": round(TALLEST - 0.04, 3)},
    "ceilingRelief": {"container": "GHR1", "id": "ceiling", "ppm": 75, "heightRange": [2.3, 3.3], "simplifyError": 0.005},
    "outputs": {"walls": [{"file": "walls-8192.webp", "size": [8192, 4096]}, {"file": "walls-4096.webp", "size": [4096, 2048]}], "relief": "walls-relief.bin",
                "ceiling": [{"file": "ceiling-%d.webp" % px(150)[0], "size": px(150)}, {"file": "ceiling-%d.webp" % px(75)[0], "size": px(75)}],
                "ceilingRelief": "ceiling-relief.bin",
                "floor": [{"file": "floor-%d.webp" % px(120)[0], "size": px(120)}, {"file": "floor-%d.webp" % px(60)[0], "size": px(60)}], "manifest": "survey.json"},
}

# --- provenance ------------------------------------------------------------------------------------------------------
residuals = [
    {"quantity": "wall face lines (75 faces fitted)", "kind": "fit-rms", "value": 0.009, "unit": "m", "note": "Largest per-face inlier rms: the fluted casings (pier ends, the block, the lobby door's casing: 7-9 mm). Plain faces 0.2-5 mm."},
    {"quantity": "walls' deviation from the E57 axes", "kind": "fit-max", "value": 0.87, "unit": "deg", "note": "The upper north wall, drawn as measured (10.9 cm over 7.2 m), as are the upper east wall (+0.61 deg), the lower west wall (+0.19) and the lower east wall's south part (-0.41). The others are drawn axis-parallel: up to 1.7 cm from the fitted line at a face's ends (the west pier's west face, -0.36 deg over 2.8 m)."},
    {"quantity": "independent check: station-fan line fits against the plan-section fits", "kind": "check", "value": 0.006, "unit": "m", "note": "65 faces from 30 stations (20 597 hits; ten more faces drew too few). Every drawn face within 3 mm except the lobby's south wall (+6 mm, drawn between the two) and the street wall's west face (-6 mm on 21 hits, likewise). The entrance screen differed by 21 mm: see the README's corrections."},
    {"quantity": "independent check: tape lines against the fitted outline", "kind": "check", "value": 0.009, "unit": "m", "note": "19 dimensions at two heights (38 rows of two to four lines), leaving out lines that met a plant, a mullion, a picture frame, the west casing or the flutes of a casing (each named in the README). Largest of the rest: 9 mm (entrance recess), 14 mm on one line of the south-east return."},
    {"quantity": "screen wall: circle through five heights", "kind": "fit-rms", "value": 0.0056, "unit": "m", "note": "Radius 1.052 m, 991 points. The nook's curved wall is not a circle: chords through measured points, within about 1 cm."},
    {"quantity": "lower floor plane", "kind": "fit-rms", "value": 0.004, "unit": "m", "note": "91.5 m2; plumb lines 3.9 mm rms and the same plane within 0.2 mm at the centre."},
    {"quantity": "upper floor plane", "kind": "fit-rms", "value": 0.0073, "unit": "m", "note": "33.7 m2; it is tilted 4.6-5.7 mm/m westwards, so a flat upper level at 0.594 m is within 1.7 cm of it."},
    {"quantity": "steps: tread levels and riser lines, sections against plumb lines and level rays", "kind": "check", "value": 0.01, "unit": "m", "note": "Tread levels agree within 4 mm; riser lines within 10 mm. Each riser runs 15-20 mm askew over the flight's 2.4 m and is drawn square at its middle."},
    {"quantity": "ceiling parts: raster medians against plumb lines", "kind": "check", "value": 0.002, "unit": "m", "note": "18 parts, each within 2 mm."},
    {"quantity": "alcove's side walls", "kind": "tolerance", "value": 0.03, "unit": "m", "note": "Both carry mirrors, behind which the mesh is not trusted; a tape line above the mirrors gives 3.343 m between them, the fits 3.350."},
    {"quantity": "upper west wall behind the open leaf (E57 Y 3.1..5.0)", "kind": "tolerance", "value": 0.03, "unit": "m", "note": "Not seen: drawn straight between the wall each side of the leaf."},
    {"quantity": "openings' edges and heads", "kind": "tolerance", "value": 0.02, "unit": "m", "note": "2 cm depth rasters and 4-5 mm photographs re-projected on each opening's own plane; the lobby door's jambs differ by 4-7 cm between the two (the open leaves lie in the reveals) and the mesh's are given."},
    {"quantity": "chandeliers' lowest points", "kind": "tolerance", "value": 0.05, "unit": "m", "note": "Read by eye from one photograph each; the mesh reads 5-8 cm higher."},
]
provenance = {
    "measuredBy": "T-662, robert-adam-measure (Claude)",
    "method": "As the Saloon's and the Reception Room's: plan sections of the reviewed Matterport dollhouse mesh with robust line fits (Tukey IRLS, two passes) per wall face, circles for the curved wall and the columns; vertical sections for the steps; 2 cm depth rasters and photographs re-projected on each opening's plane for the openings; the lowest down-facing surface on a 2.5 cm raster for the ceilings. An independent pass by ray casting (tape lines wall to wall, fans of rays from the 30 stations, plumb lines, level rays at each riser) checked the outline, both floors, the steps and the ceilings. Scripts: tools/surveyed-rooms/measure/robert-adam-room/.",
    "date": "2026-11-13",
    "sources": ["twin mesh/dollhouse.glb (sha256 21ee0973..., matches the twin manifest)", "twin manifest.json (station poses, E57 frame)",
                "native 4096 px cube faces (image2D) from the Matterport .e57 export, read-only", "twin panoramas tiles/scan_NNN/equirect_512.webp (contact sheets only)",
                "the venue's Robert Adam Room plan (its four labels and its layout only; private, not copied)"],
    "residuals": residuals,
    "note": "One room on two floors: y = 0 is the lower floor, and every height in this file is above it, the upper section's walls, doors, ceiling and columns included (its floor is y = 0.594). What the schema cannot say about this room is listed in the measurement README.",
}

room = {
    "$schema": "./room.schema.json", "schemaVersion": 1, "slug": "robert-adam-room", "name": "Robert Adam Room", "venue": "trades-hall",
    "published": {"length": 11.2, "width": 7.6, "height": 2.8, "area": 85.1,
                  "source": "tradeshallglasgow.co.uk/rooms (research/research-room-facts.md, fetched 2026-10-17); the venue's own room plan labels 11.4 m, 7.4 m, 10 m and 5.6 m",
                  "note": "The fields hold the lower section's published figures; the venue also publishes the upper section, 9.7 x 5.6 x 2.18 m, 54.3 m2 (the schema holds one set). Measured: lower section %.1f m2 of floor, steps %.1f m2, upper section %.1f m2, %.1f m2 in all. The published 11.2 x 7.6 m is the lower section's west wall to the lobby door's casing (11.19 m) by the street wall's face to the shoulders (7.64 m); the room is wider than that south of the lobby door (12.49 m) and deeper in the middle (9.44 m from the street wall's face to the back wall, 9.92 m from the entrance screen). The published 2.8 m is the beams' soffit (2.80-2.83 m); the panels between them are 3.17-3.22 m. Upper section: 5.61 m wide by 9.82 m from the lobby's south wall to the north wall, 2.17 m under its lower ceiling and 2.29 m under the raised field. Drawing and planning use the measured outline; the published capacities are kept (decided 18 October 2026). One room with two floor levels; nothing can be placed on the steps."
                  % (A_LOWER, A_STEPS, A_UPPER, A_TOTAL)},
    "source": {"kind": "matterport-e57-twin", "captureId": "trades-hall-matterport-e57-2026-07-11", "captured": "2026-07-11", "twin": "https://twin.venviewer.com/trades-hall",
               "manifest": "manifest.json", "mesh": "mesh/dollhouse.glb", "meshSha256": "21ee097393cdaf80d5924a876fc73cbf149c0d4b050bcb56011dad2e1dd3aa9a", "meshTier": "ops-grade-2cm",
               "panoramas": {"path": "tiles/scan_{index:03d}/equirect_8192.webp", "size": 8192}, "frame": {"name": "e57", "units": "m", "up": "+Z"},
               "note": "Capture date as the twin gives it; unverified, as the Saloon's config notes."},
    "transform": {"centre": [CX, CY], "floorZ": FLOOR_Z, "quarterTurns": 2,
                  "note": "x = 0.32 - X, y = Z + 3.575, z = Y + 0.04. A proper rotation (det +1), the Grand Hall's quarter turn; the street wall is on -z and +x points 191.1 deg true. The centre is the middle of the outline's bounding box (X -5.938..6.576, Y -11.400..11.327) within 2 mm; it falls on the steps. Floor Z -3.575 is the lower floor's plane at the lower section's centre (-3.5753 by the raster's fit, -3.5751 by plumb lines)."},
    "site": site, "stations": stations,
    "walls": {"vertices": verts, "segments": segments},
    "openings": openings,
    "ceiling": {"kind": "coffered", "height": 2.80, "heightRange": [2.79, 2.83], "regions": regions,
                "note": "Lower section: a grid of flat-soffited beams (2.799 m under the west one, 2.826 m under the east, 2.81-2.82 m across the middle aisle) with moulded cornices, and eleven flat raised panels between them (3.17-3.22 m). There are no vaults, domes or segmental beams: what read as arches in the panoramas are straight beams in an equirectangular picture. The bays by the street wall (2.795 and 2.808 m), the entrance recess (2.797 m) and the strip by the east wall (2.802 m) are at the beams' level. The height given is the beams' soffit, the venue's published 2.8 m. Upper section: see the upper regions; every height here is above the lower floor."},
    "floor": {"kind": "strip-boards", "boardsRun": "z", "levels": levels,
              "note": "Mid-brown oak boards in both sections, running along E57 Y in the lower section (not measured in the upper; board width not measured). The steps are the same oak with brass nosings. The schema's levels carry no flag: the steps (step-1 to step-3), the plinths and the lift's platform are places where nothing can be placed, and that is said only in their notes. Brass handrails run up both sides of the flight from posts beside the first tread to posts on the landing."},
    "freeStanding": free, "fittings": fittings, "edits": [
        {"type": "recess", "wall": "casing", "u": [{"opening": "door-lobby", "offset": -0.675}, {"opening": "door-lobby", "offset": 0.675}], "v": [0.0, 2.05], "depth": 0.3, "leafPlane": 0.05,
         "applies": ["relief"], "note": "PROPOSED. The lobby door stood open: a plain recess, its closed leaves modelled by the web. Leaf plane not measured."}],
    "occluders": occluders, "survey": survey, "provenance": provenance,
}
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "robert-adam-room.room.json")
with open(out, "w", encoding="utf8", newline="\n") as f:
    json.dump(room, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote %s: %d walls, perimeter %.2f m" % (os.path.basename(out), N, sum(math.hypot(E57[(i + 1) % N][0] - E57[i][0], E57[(i + 1) % N][1] - E57[i][1]) for i in range(N))))
print("areas: outline (chords) %.2f, less the screen wall's arc %.2f = %.2f m2; upper section %.2f; steps and plinths %.2f; lower section %.2f" % (
    poly_area(E57), ARC_CUT, A_TOTAL, A_UPPER, A_STEPS, A_LOWER))
print("bounding box E57: X %.3f..%.3f, Y %.3f..%.3f; middle (%.3f, %.3f)" % (min(p[0] for p in E57), max(p[0] for p in E57), min(p[1] for p in E57), max(p[1] for p in E57),
                                                                          (min(p[0] for p in E57) + max(p[0] for p in E57)) / 2, (min(p[1] for p in E57) + max(p[1] for p in E57)) / 2))
print("wall heights: " + ", ".join("%s %.3f" % kv for kv in heights.items()))
print("regions: " + ", ".join("%s %.3f" % (r["id"], r["height"]) for r in regions))

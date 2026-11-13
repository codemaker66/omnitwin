"""Writes ../../reception-room.room.json from the figures measured by 01-08 (each constant names its
source). Planner frame: quarter turn 0, x = X - 16.06, z = 7.36 - Y, y = Z + 2.869, so the window wall
(E57 +Y, 281.1 deg true) is on -z.

    09_write_config.py [out.json]"""
import json
import math
import os
import sys

CX, CY, FLOOR_Z = 16.06, 7.36, -2.869


def pl(X, Y):
    return [round(X - CX, 3), round(CY - Y, 3)]


# Wall faces, E57, plain wall band 0.6-1.8 m (04_wall_fits.py; the station fans of 08 agree within 1.4 mm)
N, SW, SE = 13.562, 1.162, 1.491            # window wall; south wall's west and east planes (Y)
WI, EI, EO = 12.731, 19.997, 20.893         # inner west, inner east, window part's east wall (X)
STW, STE = 7.672, 7.496                     # the window part's south wall, west and east of the opening (Y)
PS, PW = 7.265, 19.133                      # the pier at the junction: south face (Y), west face (X; 06)
DP, NP = 20.679, 20.676                     # fire-door pier and north-east pier faces (X)
RET = 15.051                                # the return in the south wall (X)


def WO(Y):
    """The window part's west wall, 1.01 deg off the axis (04: 11.279 at Y 10.625)."""
    return 11.279 - 0.01763 * (Y - 10.625)


E57 = [
    (EI, SE), (EI, PS), (PW, PS), (PW, STE), (DP, STE), (DP, 8.79), (EO, 8.79), (EO, 12.51), (NP, 12.51), (NP, N),
    (WO(N), N), (WO(STW), STW), (WI, STW), (WI, SW), (RET, SW), (RET, SE),
]
SOFFIT, STRIP, FIELD = 2.419, 2.514, 3.126  # 02 and 06; the plumb lines of 08 agree within 4 mm
SEGS = [
    ("east-inner", "East wall, inner part", SOFFIT, "E57 X = 19.997 (0.14 deg off the axis). Not one plane: it bulges 2-3 cm into the room between Y 4.6 and 5.6 (tape lines 7.240-7.257 m across there, 7.261-7.276 m elsewhere). Two wall lights, two air-conditioning controllers (Y 5.4-5.6, 1.3 m up)."),
    ("pier-south", "Pier at the junction, south face", SOFFIT, "E57 Y = 7.265, X 19.133..19.997: a papered pier 0.864 x 0.231 m, floor to soffit, with skirting and picture rail."),
    ("pier-west", "Pier at the junction, end face", SOFFIT, "E57 X = 19.133 (rms 1.4 mm)."),
    ("stub-east", "South wall of the window part, east of the opening", FIELD, "E57 Y = 7.496: the pier's north face and the wall east of it, to the fire-door pier."),
    ("door-pier", "East wall, fire-door pier", FIELD, "E57 X = 20.679, Y 7.496..8.79: stands 0.214 m in front of the east wall and carries the fire exit door (leaf plane X 20.765)."),
    ("door-return", "Return from the fire-door pier", FIELD, "0.214 m step at E57 Y 8.79."),
    ("east-outer", "East wall, window part", FIELD, "E57 X = 20.893 (rms 2.8 mm; -0.42 deg, 2.7 cm over its run, drawn axis-parallel). Two wall lights."),
    ("north-return", "Return to the north-east pier", FIELD, "0.217 m step at E57 Y 12.51."),
    ("north-pier", "North-east pier", FIELD, "E57 X = 20.676, Y 12.51..13.562. Its last 0.3 m is behind the drapes' stack."),
    ("window", "Window wall (four windows behind sheers and drapes)", FIELD, "E57 Y = 13.562, facing 281.1 deg true. The bare face is seen only at the west end (X 11.26..11.60, 0.33 m per level, rms 0.8 mm; a tape line from the stub wall there gives 13.561). Its direction is not measured: it is drawn parallel to the E57 X axis. Elsewhere sheers and drapes hang 0.14-0.18 m in front of it, from a track under the cornice (2.89 m) to the floor. Skirting line Y 13.545."),
    ("west-outer", "West wall, window part", FIELD, "Drawn as measured, not axis-parallel: E57 X 11.227 at the window wall to 11.331 at Y 7.672 (-1.01 deg, rms 2.4 mm; the station fans give -0.99). A roll-down screen's housing under the cornice (Y 9.45..11.85, 2.78-2.97 m), two wall lights, a wifi access point (Y 8.75, 0.55 m)."),
    ("stub-west", "South wall of the window part, west of the opening", FIELD, "E57 Y = 7.672, X 11.331..12.731 (rms 2.4 mm)."),
    ("west-inner", "West wall, inner part", SOFFIT, "E57 X = 12.731 (rms 4.8 mm, 0.11 deg). Carries the door to the corridor; two wall lights, a fire alarm call point (Y 3.05, 1.2 m)."),
    ("south-west", "South wall, west plane (wardrobe)", STRIP, "E57 Y = 1.162 (rms 7.5 mm): the plane of the west wardrobe's glazed doors, 0.329 m behind the east plane."),
    ("south-return", "Return in the south wall", STRIP, "0.329 m step at E57 X 15.051."),
    ("south-east", "South wall, east plane (wardrobe)", STRIP, "E57 Y = 1.491 (rms 5.0 mm; -0.28 deg, 2.4 cm over its run, drawn axis-parallel). The soffit over it is 2.514 m west of X 18.05 and 2.419 m east of it. One wall light between the wardrobes (X 15.4)."),
]
verts = [pl(*p) for p in E57]
area = abs(sum(verts[i][0] * verts[(i + 1) % 16][1] - verts[(i + 1) % 16][0] * verts[i][1] for i in range(16))) / 2

# Windows (07 and the README): the glass plane and the heights from several stations; the pitch from the
# west glazing edges of the second and third windows; the width is the least the photographs allow.
W_PITCH, W_WIDTH, W2_WEST = 2.22, 1.62, 14.25
W_NOTE = ("Behind sheers and drapes; the mesh holds only curtain, so this is read from the native cube faces re-projected on the plane Y 13.80. "
          "Measured: the daylight opening's head 2.58 m and glass sill 1.00 m (window board 0.93-0.95 m), each at the same height from stations 1.9 m and 3.8-5.0 m away, which puts the frame 0.24 +-0.04 m behind the wall face; "
          "west glazing edges at E57 X 14.25 (this window, from scan_136) and 16.47 (the third, from scan_135), a pitch of 2.22 m. "
          "Inferred: the width. Every east jamb is hidden by a drape; this window's glass is seen as far east as X 15.87 (scan_139), so it is at least 1.62 m wide and the piers at most 0.60 m. "
          "The first and fourth windows are placed by the pitch alone (the first's glass is seen from X 12.15 to at least 13.47, the fourth's from 18.87 to 20.24, between their drapes).")
openings = []
for k in range(4):
    xc = W2_WEST + W_WIDTH / 2 + (k - 1) * W_PITCH
    openings.append({
        "id": "window-%d" % (k + 1), "wall": "window", "kind": "window", "headShape": "square", "centreE57": [round(xc, 3), N],
        "width": W_WIDTH, "sill": 0.93, "head": 2.58, "glazing": "sheer", "dressing": "curtains-and-sheers", "stateInScan": "closed",
        "reveal": {"depth": 0.24},
        "glass": {"width": W_WIDTH, "sill": 1.0, "head": 2.58, "headShape": "square",
                  "planes": [{"depth": 0.24, "note": "E57 Y 13.80 +-0.04: on this plane the head and sill lines keep their height between near and far stations."}],
                  "note": "Clear glass in a white frame behind a sheer; a drape overlaps each side of it as scanned (the gaps between drapes are about 1.25-1.4 m)."},
        "note": W_NOTE if k == 1 else "As window-2, placed by the 2.22 m pitch%s. See window-2's note." % ("" if k == 2 else " (not measured directly)"),
    })
openings += [
    {"id": "door-corridor", "wall": "west-inner", "kind": "door", "headShape": "square", "centreE57": [WI, 2.152], "width": 1.155, "sill": 0, "head": 2.02, "glazing": "none", "stateInScan": "open",
     "note": "To the oak-panelled rear corridor (scan_121, scan_122). Mesh: open Y 1.575..2.73 below 2.02 m; architraves Y 1.45..2.85. The white panelled leaf stood open into the corridor on the south jamb. Exit sign above."},
    {"id": "door-fire-exit", "wall": "door-pier", "kind": "door", "headShape": "square", "centreE57": [DP, 8.065], "width": 0.86, "sill": 0, "head": 2.02, "glazing": "none", "stateInScan": "closed",
     "note": "Six-panel leaf with a panic bar, Y 7.635..8.495, its plane X 20.765 (0.086 m behind the pier's face; the mesh has it 6 cm askew). Exit sign above (to 2.45 m)."},
    {"id": "wardrobe-east", "wall": "south-east", "kind": "door", "headShape": "square", "centreE57": [17.155, SE], "width": 2.35, "sill": 0, "head": 1.93, "glazing": "none", "stateInScan": "closed",
     "note": "Three dark timber leaves, each of four clear panes, X 15.98..18.33 in the wall's plane; architrave X 15.83..18.45, top 2.03 m. The scan sees through the panes to lit shelves and the back at Y 0.36 (1.13 m behind). The schema has no glazed door: glazing is 'none' so the build leaves it alone."},
    {"id": "wardrobe-west", "wall": "south-west", "kind": "door", "headShape": "square", "centreE57": [14.0, SW], "width": 1.84, "sill": 0, "head": 1.93, "glazing": "none", "stateInScan": "closed",
     "note": "Three glazed leaves about 0.6 m wide, X 13.08..14.92 (panes seen through at X 13.22-13.46, 13.82-14.06, 14.48-14.66; the south column hides the east leaf from most stations); architrave X 13.03..15.05, top 2.03 m; back at Y 0.36 (0.80 m behind)."},
]

room = {
    "$schema": "./room.schema.json", "schemaVersion": 1, "slug": "reception-room", "name": "Reception Room", "venue": "trades-hall",
    "published": {
        "length": 13.4, "width": 11.2, "height": 3.2, "area": 150,
        "source": "tradeshallglasgow.co.uk/rooms (research/research-room-facts.md, fetched 2026-10-17); the venue's own room plan labels 9.6 m, 7.3 m and 12 m",
        "note": "Measured: an L of %.1f m2. Window part 9.60-9.63 m wide (9.449 m of window wall between the west wall and the north-east pier) by 5.890 m (west) to 6.066 m (east); inner part 7.266 m wide by 6.510 m (to the south wall's west plane) or 6.005 m (east plane); 12.400 m from the window wall to the wardrobe doors on the west, 12.071 m on the east. Ceilings 3.126 m (window part), 2.82 m (two coffers), 2.419 m and 2.514 m (soffits). Drawing and planning use the measured outline; the published capacities are kept (decided 18 October 2026)." % area,
    },
    "source": {"kind": "matterport-e57-twin", "captureId": "trades-hall-matterport-e57-2026-07-11", "captured": "2026-07-11", "twin": "https://twin.venviewer.com/trades-hall",
               "manifest": "manifest.json", "mesh": "mesh/dollhouse.glb", "meshSha256": "21ee097393cdaf80d5924a876fc73cbf149c0d4b050bcb56011dad2e1dd3aa9a", "meshTier": "ops-grade-2cm",
               "panoramas": {"path": "tiles/scan_{index:03d}/equirect_8192.webp", "size": 8192}, "frame": {"name": "e57", "units": "m", "up": "+Z"},
               "note": "Capture date as the twin gives it; unverified, as the Saloon's config notes."},
    "transform": {"centre": [CX, CY], "floorZ": FLOOR_Z, "quarterTurns": 0,
                  "note": "x = X - 16.06, y = Z + 2.869, z = 7.36 - Y. A proper rotation (det +1); the window wall is on -z (z = -6.202) and +x points 11.1 deg true. The centre is the middle of the outline's bounding box (X 11.227..20.893, Y 1.162..13.562) within 2 mm. Floor Z -2.869 is the floor plane at the centre (-2.8690 by the area-weighted fit, -2.8685 by plumb lines); the floor is not level, see floor.note."},
    "site": {"frame": "grand-hall-planner", "observer": {"latitude": 55.8593, "longitude": -4.2491}, "minusZBearingTrue": 281.1, "minusZBearingGrid": 282.96, "gridMinusTrueDeg": 1.861,
             "gridOrigin": [259321.62, 665200.84], "floorODN": 11.276, "pavementY": -0.876, "daylightChannel": "windows",
             "note": "Derived from the Grand Hall frame constants (tools/grand-hall-survey/README.md, Frame; merchant-city-v2 frame block), as the Saloon's. This room's planner -z is E57 +Y, opposite the Grand Hall's -z (E57 -Y, 101.1 deg true, 102.96 grid): 281.1 true, 282.96 grid. gridOrigin = the Grand Hall's (259332, 665191) + this origin's Grand Hall planner position (x = 8.795 - 16.06 = -7.265, z = 7.36 + 4.963 = 12.323) on +x (-0.22427, -0.97453) and +z (-0.97453, 0.22427) = (259332 + 1.629 - 12.009, 665191 + 7.080 + 2.764). floorODN = 14.19 - 0.045 - 2.869 (the Grand Hall's floor is E57 Z 0.045 at 14.19 m ODN); pavementY = 10.40 - 11.276, the Glassford Street pavement, which this room does not face. The windows look west-north-west over the rear yard: its ground level, the rear facade's line and the skylines are not measured here (the 17 October research puts the yard at about E57 Z -3.3, y -0.43: a lead, unverified)."},
    "stations": [{"id": "scan_122", "role": "doorway", "opening": "door-corridor", "note": "In the corridor door's reveal, 0.075 m beyond the wall face. scan_121 stands in the corridor 1.47 m beyond it and is left out."}]
                + [{"id": "scan_%03d" % i, "role": "room"} for i in range(123, 145)],
    "walls": {
        "vertices": verts,
        "segments": [{"id": i, "name": n, "kind": "solid", "height": h, "note": t} for i, n, h, t in SEGS],
        "elevation": {"levels": {"skirtingTop": 0.3, "pictureRail": 2.13, "innerSoffit": SOFFIT, "southSoffit": STRIP, "corniceBottom": 2.89, "ceiling": FIELD},
                      "offsets": {"skirtingProud": 0.017}},
    },
    "openings": openings,
    "ceiling": {
        "kind": "stepped", "height": FIELD, "heightRange": [3.115, 3.135],
        "regions": [
            {"id": "inner-soffit", "kind": "soffit", "height": SOFFIT, "heightRange": [2.41, 2.43],
             "outline": [pl(WI, SW), pl(RET, SW), pl(RET, SE), pl(EI, SE), pl(EI, PS), pl(PW, PS), pl(PW, 7.56), pl(WI, 7.56)],
             "note": "The inner part's lowest ceiling, a frame about the two coffers. Its north edge is the downstand's face at E57 Y 7.56 (from 2.42 m up to the window part's cornice), between the two stub walls."},
            {"id": "south-strip", "kind": "soffit", "height": STRIP, "heightRange": [2.505, 2.525],
             "outline": [pl(WI, SW), pl(RET, SW), pl(RET, SE), pl(18.05, SE), pl(18.05, 2.725), pl(WI, 2.725)],
             "note": "A band 0.095 m higher than the soffit in front of the wardrobes, to E57 X 18.05 and Y 2.725 (6.5 m2). Three downlights."},
            {"id": "coffer-west", "kind": "raised-panel", "height": 2.822, "heightRange": [2.81, 2.83],
             "outline": [pl(12.925, 3.45), pl(14.4, 3.45), pl(14.4, 6.8), pl(12.925, 6.8)],
             "note": "Flat of the west coffer (4.9 m2); its coved rim reaches E57 X 12.80..14.525, Y 3.325..6.95 and holds a concealed uplight. Three downlights."},
            {"id": "coffer-east", "kind": "raised-panel", "height": 2.825, "heightRange": [2.81, 2.84],
             "outline": [pl(15.175, 3.425), pl(18.0, 3.425), pl(18.0, 6.775), pl(15.175, 6.775)],
             "note": "Flat of the east coffer (8.8 m2); rim to E57 X 15.05..18.15, Y 3.30..6.90, with a concealed uplight. A ceiling cassette (X 15.825..16.625, Y 4.075..4.95, face 2.790 m) and six downlights."},
        ],
        "note": "Stepped. Window part: a flat field at 3.126 m (47 m2 flat, E57 X 11.425..20.725, Y 7.70..13.175) inside a plaster cornice that starts 2.89 m up the walls; two cassettes (E57 X 13.2..14.225, Y 10.125..11.05 and X 17.975..19.025, Y 10.025..11.075, faces 3.09 m), three access hatches, downlights on a 1.75 m grid. Inner part: a soffit at 2.419 m with two coffers at 2.82 m and a band at 2.514 m along the wardrobes. Cassettes, downlights, hatches and wall lights have no place in the schema (the measuring README lists them). From the lowest down-facing mesh surface on a 2.5 cm raster; plumb-line rays agree within 4 mm.",
    },
    "floor": {"kind": "strip-boards", "boardsRun": "z", "levels": [{"id": "main", "height": 0}],
              "note": "Dark, glossy hardwood strip boards running along E57 Y (planner z), about 0.13 m wide (read off one floor crop, not measured). Not level: the floor rises towards the windows, Z = -2.8999 + 0.00075 X + 0.00251 Y (area-weighted, rms 6.5 mm) or -2.9161 + 0.00123 X + 0.00378 Y (plumb lines, rms 9 mm), 3-5 cm over the room's length, while the ceilings are level; clear heights under the window part's field run 3.08-3.14 m. The gloss mirrors every downlight: floor photographs need glare handling."},
    "freeStanding": [
        {"id": "column-north", "kind": "column", "shape": "square", "centre": pl(14.799, 7.211), "size": [0.284, 0.279], "height": SOFFIT,
         "note": "White, square, with a moulded base (settled from the cube faces: not round). Faces E57 X 14.657/14.942, Y 7.072/7.351 (rms 3.0-6.8 mm)."},
        {"id": "column-south", "kind": "column", "shape": "square", "centre": pl(14.767, 2.966), "size": [0.268, 0.306], "height": SOFFIT,
         "note": "Faces E57 X 14.634/14.901, Y 2.813/3.119 (rms 1.2-5.2 mm); under the edge between the soffit and the south band."},
    ],
    "fittings": [],
    "concealedLights": [
        {"id": "rail-uplight", "kind": "uplight-strip", "height": 2.13, "level": "pictureRail",
         "walls": [s[0] for s in SEGS if s[0] != "window"],
         "note": "An LED strip on the picture rail washes the band above it on every wall but the window wall (2.13 m to the soffit in the inner part, to the cornice in the window part). The coffers' rims hold a second concealed uplight, which the schema cannot place (it lists walls only)."},
    ],
    "edits": [
        {"type": "recess", "wall": "west-inner", "u": [{"opening": "door-corridor", "offset": -0.578}, {"opening": "door-corridor", "offset": 0.578}], "v": [0.0, 2.02], "depth": 0.3, "leafPlane": 0.05, "applies": ["relief"],
         "note": "PROPOSED. The corridor door stood open: a plain recess, its closed leaf modelled by the web. Leaf plane not measured."},
    ],
    "occluders": [],
    "survey": {
        "methodRevision": 2, "publish": {"folder": "packages/web/public/rooms/reception-room/survey-2026-07-11", "revision": 1},
        "projection": {"walls": {"cosMin": 0.2, "pCos": 4.0, "qDist": 3.0, "maxDist": 16.0}, "ceiling": {"cosMin": 0.15, "pCos": 4.0, "qDist": 3.0, "maxDist": 16.0},
                       "floor": {"cosMin": 0.12, "pCos": 2.0, "qDist": 2.0, "maxDist": 16.0, "glare": 1, "nadir": True}},
        "wallViews": {"ppm": 200, "heightRange": [-0.05, 3.2], "eyeInset": 1.2, "near": 0.0, "far": 2.5, "tileMaxLength": 6.0, "modes": ["position"]},
        "ceilingView": {"name": "ceiling-pos", "ppm": 150, "eyeHeight": 1.0, "near": 1.3, "far": 2.25, "modes": ["position"]},
        "floorPhoto": {"ppm": 120, "refill": {"innerFraction": 0.75, "easeDeg": 4}},
        "atlas": {"size": 4096, "height": 2048, "ppm": {"pixels": 200, "span": 1}, "vRange": [-0.02, 3.146], "featherTexels": 10, "gutter": 8},
        "relief": {"container": "GHR1", "ppm": 100, "vRange": [0, FIELD], "depthRange": [-1.2, 0.9], "simplifyError": 0.005, "holdFloor": 0.04, "holdCeiling": 3.086},
        "ceilingRelief": {"container": "GHR1", "id": "ceiling", "ppm": 75, "heightRange": [2.3, 3.25], "simplifyError": 0.005},
        "outputs": {"walls": [{"file": "walls-4096.webp", "size": [4096, 2048]}, {"file": "walls-2048.webp", "size": [2048, 1024]}], "relief": "walls-relief.bin",
                    "ceiling": [{"file": "ceiling-1450.webp", "size": [1450, 1860]}, {"file": "ceiling-725.webp", "size": [725, 930]}], "ceilingRelief": "ceiling-relief.bin",
                    "floor": [{"file": "floor-1160.webp", "size": [1160, 1488]}, {"file": "floor-580.webp", "size": [580, 744]}], "manifest": "survey.json"},
    },
    "provenance": {
        "measuredBy": "T-662, reception-measure (Claude)",
        "method": "As the Saloon's: plan sections of the reviewed Matterport dollhouse mesh with robust line fits (RANSAC then Tukey IRLS) in three height bands; 2 cm orthographic depth rasters of each wall for openings; the lowest down-facing surface on a 2.5 cm raster for the ceiling. An independent pass by ray casting (tape lines wall to wall, fans of rays from the 22 stations, plumb lines on a 0.2 m grid) checked the outline and the heights. The windows, which the mesh does not hold, were read from the native E57 cube faces (4096 px) re-projected on planes parallel to the wall and compared between stations. Scripts: tools/surveyed-rooms/measure/reception-room/.",
        "date": "2026-11-13",
        "sources": ["twin mesh/dollhouse.glb (sha256 21ee0973..., matches the twin manifest)", "twin manifest.json (station poses, E57 frame)",
                    "native 4096 px cube faces (image2D) from the Matterport .e57 export, read-only", "twin panoramas tiles/scan_NNN/equirect_512.webp (contact sheet only)",
                    "the venue's Reception Room plan (its three labels only; private, not copied)"],
        "residuals": [
            {"quantity": "wall face lines, plain wall band 0.6-1.8 m (14 faces)", "kind": "fit-rms", "value": 0.0075, "unit": "m", "note": "Largest per-face inlier rms (the south wall's west plane); others 0.2-7.2 mm."},
            {"quantity": "walls' deviation from the E57 axes", "kind": "fit-max", "value": 1.01, "unit": "deg", "note": "The window part's west wall, drawn as measured (10.4 cm over its 5.89 m). The other long walls: east -0.42, south -0.28, inner walls +0.11 and +0.14: up to 1.4 cm from the drawn axis-parallel line at a wall's ends. The window wall's own direction is not measured."},
            {"quantity": "independent check: station-fan line fits against the plan-section fits (14 faces)", "kind": "check", "value": 0.0014, "unit": "m", "note": "Largest difference of offset; angles agree within 0.03 deg on the long walls."},
            {"quantity": "independent check: tape lines against the fitted outline", "kind": "check", "value": 0.009, "unit": "m", "note": "34 lines over four dimensions, outside the inner east wall's bulge. The whole length cannot be taped in one line; a line to a sheer fold in the window wall's plane gives 12.38-12.39 m against the outline's 12.400 m."},
            {"quantity": "inner east wall: bulge between E57 Y 4.6 and 5.6", "kind": "fit-max", "value": 0.028, "unit": "m", "note": "Found by the tape lines; the wall is drawn as one plane."},
            {"quantity": "floor plane", "kind": "fit-rms", "value": 0.009, "unit": "m", "note": "Plumb lines; 6.5 mm area-weighted. The two fits agree at the origin within 0.5 mm and differ in slope (2.5 and 3.8 mm/m along Y)."},
            {"quantity": "floor fall, window wall to south wall", "kind": "fit-max", "value": 0.047, "unit": "m", "note": "3.8 mm/m over 12.4 m by plumb lines (31 mm by the area-weighted fit). The planner's floor is flat, at the centre's level."},
            {"quantity": "ceiling parts: raster medians against plumb-line means", "kind": "check", "value": 0.004, "unit": "m", "note": "3.126/3.125, 2.822/2.822, 2.825/2.824, 2.419/2.415-2.424, 2.514/2.515."},
            {"quantity": "columns' faces", "kind": "fit-rms", "value": 0.0068, "unit": "m"},
            {"quantity": "door edges", "kind": "tolerance", "value": 0.02, "unit": "m", "note": "2 cm depth rasters and 6-8 mm photo crops, edges judged by eye."},
            {"quantity": "windows: glass plane's depth behind the wall face", "kind": "tolerance", "value": 0.04, "unit": "m", "note": "From the head and sill lines keeping their height between stations 1.9 m and 3.8-5.0 m away (1 cm of reading is 4 cm of depth)."},
            {"quantity": "windows: sill and head heights", "kind": "tolerance", "value": 0.03, "unit": "m", "note": "Through a sheer, 4 mm crops."},
            {"quantity": "windows: west glazing edges of the second and third", "kind": "tolerance", "value": 0.02, "unit": "m", "note": "One station each; the pitch between them is insensitive to the glass depth (1.4 cm per 10 cm)."},
            {"quantity": "windows: width", "kind": "tolerance", "value": 0.15, "unit": "m", "note": "NOT measured: 1.62 m is the least the photographs allow; the east jambs are hidden by the drapes. It may be up to about 1.9 m."},
            {"quantity": "the venue's plan labels against the scan", "kind": "check", "value": 0.4, "unit": "m", "note": "9.6 against 9.60-9.63 m; 7.3 against 7.266 m; 12 against 12.071 m (east) and 12.400 m (west)."},
        ],
        "note": "Draft, not reviewed. The windows' width and the first and fourth windows' positions are inferred, as their notes say. The edit marked PROPOSED needs the projected photographs to confirm. No sliding partition or track is visible at the junction in this scan (soffit and floor crops from scan_143), though the venue's brochure and plan show one.",
    },
}

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "reception-room.room.json")
with open(out, "w", encoding="utf8", newline="\n") as f:
    json.dump(room, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote", os.path.normpath(out), "outline area %.2f m2" % area, "perimeter %.2f m" % sum(math.dist(verts[i], verts[(i + 1) % 16]) for i in range(16)))

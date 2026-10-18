"""Writes saloon.room.draft.json against tools/surveyed-rooms/room.schema.json."""
import sys, json, math
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from common import *

CX, CY, FZ = -2.065, 7.565, 0.002


def P(X, Y):
    """E57 (X, Y) -> planner (x, z); quarterTurns 1: x = -(Y - CY), z = -(X - CX)."""
    return [round(CY - Y, 4), round(CX - X, 4)]


def PY(Z):
    return round(Z - FZ, 3)


OL = json.load(open(OUT + "/scripts/outlines.json"))
wall = OL["panelling (wall face, 1.6-2.8 m fits)"]["e57"]
H = 5.515


def seg(i, name, note):
    return {"id": i, "name": name, "kind": "solid", "height": H, "note": note}


segments = [
    seg("front", "Front wall (lobby to the Grand Hall)", "E57 Y = 1.470 (panelling; plaster 1.448, pedestal 1.510). Carries the lobby door and the store door; a carved sideboard stands against it (E57 X -3.32..-1.00)."),
    seg("window-front-end", "Window wall, front end", "E57 X = 1.429 (panelling; plaster 1.470, pedestal 1.341). Carries the open door to the passage beside the booking suite (FIRST 2010 F.03)."),
    seg("window-front-return", "Return to the window recess", "0.240 m step from the end section to the pier line, at E57 Y 3.630."),
    seg("window", "Window wall (three stained-glass bays)", "Pier line E57 X = 1.669 (panelling; plaster 1.693, pedestal 1.568). Faces 11.1 deg true, into the roofed space over the booking suite: no sky."),
    seg("window-rear-return", "Return from the window recess", "0.194 m step at E57 Y 11.400."),
    seg("window-rear-end", "Window wall, rear end", "E57 X = 1.475 (panelling incl. the door leaves; pier 1.453, plaster 1.468, pedestal 1.333). Carries the door to Stair 8 (FIRST 2010 F.02)."),
    seg("rear", "Rear wall", "E57 Y = 13.661 (panelling; plaster 13.665, pedestal 13.639). Two honours boards with pediments; no openings."),
    seg("fireplace-rear-end", "Fireplace wall, rear end", "E57 X = -5.626 (panelling; plaster -5.633, pedestal -5.50). Closed panelled door, purpose unconfirmed (cupboard or symmetry door)."),
    seg("fireplace-rear-return", "Return to the fireplace recess", "0.178 m step at E57 Y 11.462."),
    seg("fireplace", "Fireplace wall", "E57 X = -5.804 (panelling; plaster -5.823, pedestal -5.782). White marble chimneypiece centred at E57 Y 7.54: shelf top 1.55 m, Y 6.30..8.75, 0.14 m proud; surround Y 6.55..8.525, 0.05 m proud; opening Y 6.925..8.16 (1.235 m) x 0.99 m high, firebox to X -6.0 (0.2 m behind the face); hearth and brass fender 0.59 m into the room (to X -5.21), Y 6.29..8.87, at most 0.10 m high. Three honours boards with pediments above the dado."),
    seg("fireplace-front-return", "Return from the fireplace recess", "0.225 m step at E57 Y 3.679."),
    seg("fireplace-front-end", "Fireplace wall, front end", "E57 X = -5.579 (panelling; plaster -5.581, pedestal -5.539). Closed panelled door, purpose unconfirmed."),
]
vertices = [P(x, y) for x, y in wall]

openings = []
for oid, cy, w in (("window-front", 4.926, 1.90), ("window-centre", 7.499, 1.88), ("window-rear", 10.075, 1.90)):
    openings.append({
        "id": oid, "wall": "window", "kind": "window", "headShape": "semicircular", "centreE57": [1.669, cy],
        "width": w, "sill": 1.20, "head": 4.44, "glazing": "stained-backlit", "dressing": "none", "stateInScan": "closed",
        "reveal": {"depth": 0.546, "sashHalfWidth": 0.81},
        "note": "Face opening of the recessed bay (half-depth width 1.80-1.84, arch circle rms 5 mm, apex 5.39). Leaded glass in a timber frame in the plane E57 X 2.215 (0.546 behind the pier face): glazed 1.62-1.63 wide, glass sill 1.31, springing 4.49, apex 5.30, transom 3.45-3.52 (centre bay, native skybox faces of scan_053). Reveals splay from 1.89 to 1.67 at the glass. Lit from behind (no sky).",
    })
doors = [
    ("door-lobby", "front", [-0.005, 1.470], 1.10, 2.45, "open", "To the lobby (scan_048) and the Grand Hall's end door (door-end there: 1.08 wide). Mesh: no surface within 0.9 m behind the face for X -0.55..0.53 below 2.40 m; photo jambs 0.575..-0.56. The 1.1 m leaf stood open into the Saloon, hinged on the -X jamb, swung to E57 (-1.25, 2.45)."),
    ("door-store", "front", [-4.08, 1.470], 1.19, 2.44, "closed", "Single panelled leaf X -4.675..-3.485 (native skybox faces, scan_062). FIRST 2010: to F.22 store / Stair 4 corridor. Exit sign hangs above."),
    ("door-passage", "window-front-end", [1.429, 2.34], 1.12, 2.45, "open", "Opening Y 1.78..2.90 between architraves (photo); mesh opening Y 1.85..2.92 behind splayed jambs. A leaf stands ajar in the passage. FIRST 2010: to the lobby by F.03 / F.16."),
    ("door-stair", "window-rear-end", [1.475, 12.67], 1.09, 2.46, "closed", "Leaf-and-a-half (0.78 + 0.31 m), Y 12.125..13.215, 0.02-0.05 m behind the end panelling. FIRST 2010: to F.02 Stair 8. Exit sign hangs above."),
    ("door-fireplace-rear", "fireplace-rear-end", [-5.626, 12.71], 1.23, 2.46, "closed", "Panelled leaf Y 12.10..13.325, flush with the end panelling; the piano stands in front of its lower half. FIRST 2010 and the venue plan draw it in a recess to the main wall line; the scan shows it flush with the proud end section."),
    ("door-fireplace-front", "fireplace-front-end", [-5.579, 2.42], 1.22, 2.43, "closed", "Panelled leaf Y 1.81..3.025, flush with the end panelling (same disagreement with the plans as the rear one)."),
]
for oid, w_, c, width, head, state, note in doors:
    openings.append({"id": oid, "wall": w_, "kind": "door", "headShape": "square", "centreE57": c, "width": width,
                     "sill": 0, "head": head, "glazing": "none", "stateInScan": state, "note": note})

cp = json.load(open(OUT + "/scripts/ceiling_parts.json"))


def rect(xa, xb, ya, yb):
    return [P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb)]


def octo(cx, cy, R=0.316):
    return [P(cx + R * math.cos(math.radians(22.5 + 45 * k)), cy + R * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]


regions = [{"id": "inner-frame", "kind": "raised-panel", "outline": rect(-4.10, 0.00, 2.95, 12.20), "height": PY(5.569),
            "note": "Panel inside the coffer ring, 5 cm above the field; a moulding at 5.60-5.62 frames it."}]
for nm, sq in zip(("front", "centre", "rear"), sorted(cp["squares"], key=lambda s: s["cy"])):
    regions.append({"id": f"square-{nm}", "kind": "raised-panel", "outline": rect(sq["x"][0], sq["x"][1], sq["y"][0], sq["y"][1]),
                    "height": PY(sq["zmed"]), "note": f"Raised square (5 cm raster, +-0.05 m), centre E57 ({sq['cx']}, {sq['cy']})."})
for nm, rp in zip(("front", "centre", "rear"), sorted(cp["raised"], key=lambda s: s["cy"])):
    note = ("Central raised panel with a shallow medallion (down to 5.80); no fitting." if nm == "centre"
            else "Central raised panel carrying an electrolier's rose.")
    regions.append({"id": f"panel-{nm}", "kind": "raised-panel", "outline": rect(rp["x"][0], rp["x"][1], rp["y"][0], rp["y"][1]),
                    "height": PY(rp["zmed"]), "note": note})
for k, c in enumerate(sorted(cp["coffers"], key=lambda c: (round(c["cy"], 0), c["cx"]))):
    regions.append({"id": f"coffer-{k + 1:02d}", "kind": "recess", "outline": octo(c["cx"], c["cy"]), "height": PY(c["zmed"]),
                    "note": f"Octagonal coffer with a rosette, centre E57 ({c['cx']}, {c['cy']}); a regular octagon of the measured area (equivalent diameter {2 * math.sqrt(c['area'] / math.pi):.2f} m)."})

hang = sorted(json.load(open(OUT + "/scripts/hanging.json")), key=lambda f: f["centreXY"][1])
fittings, occluders = [], []
for nm, f in zip(("front", "rear"), hang):
    X, Y = f["centreXY"]
    x, z = P(X, Y)
    fittings.append({
        "id": f"electrolier-{nm}", "kind": "electrolier", "style": "saloon-electrolier", "position": [x, PY(4.30), z],
        "suspension": PY(5.857), "lowest": PY(f["lowestZ"]), "radius": round(f["reach98"] + 0.01, 2),
        "note": f"Gilt scrolled electrolier, about three tiers of candle lamps. Axis E57 ({X}, {Y}); mesh lowest point Z {f['lowestZ']} (finial at 3.60 on its axis plane in the native skybox faces); widest at 4.2-4.4 m; body top about 4.9 m; rose on the raised panel at 5.857. Reach = 98th percentile radius of the mesh body. Needs a new fitting template.",
    })
    occluders.append({"id": f"electrolier-{nm}-body", "shape": "vertical-cylinder", "centreE57": [X, Y], "radius": 0.75, "zE57": [3.58, 4.95], "fitting": f"electrolier-{nm}"})
    occluders.append({"id": f"electrolier-{nm}-stem", "shape": "vertical-cylinder", "centreE57": [X, Y], "radius": 0.17, "zE57": [4.95, 5.87],
                      "fitting": f"electrolier-{nm}", "note": "Stem and upper scrolls to the rose."})

stations_ = [{"id": "scan_048", "role": "doorway", "opening": "door-lobby",
              "note": "The lobby between the Grand Hall's end door and the Saloon, 0.29 m beyond the front wall's face; the Grand Hall lists it too."}]
stations_ += [{"id": f"scan_{i:03d}", "role": "room"} for i in range(49, 75)]

gh = json.load(open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "..", "grand-hall.room.json"), encoding="utf8"))
ghx, ghz = 8.795 - CX, CY + 4.963          # the Saloon origin in the Grand Hall planner frame
gE = 259332.0 + ghx * -0.22427 + ghz * -0.97453
gN = 665191.0 + ghx * -0.97453 + ghz * 0.22427
bf = json.load(open(OUT + "/scripts/band_fits.json"))
pan_rms = max(bf[w]["panelling 1.6-2.8"]["rms_mm"] for w in bf)

room = {
    "$schema": "./room.schema.json", "schemaVersion": 1, "slug": "saloon", "name": "Saloon", "venue": "trades-hall",
    "published": {
        "length": 12, "width": 7, "height": 5.4, "area": 84,
        "source": "tradeshallglasgow.co.uk/rooms (research/research-room-facts.md, fetched 2026-10-17); the venue's plan labels 11.9 x 6.9 m",
        "note": "Measured: 12.19 m (panelling, front to rear) x 7.47 m (fireplace panelling to the window piers; 7.01 m between the end sections), 89.3 m2 inside the panelling; ceiling field 5.515 m, raised panels to 5.855 m, wall plaster to the cornice at 5.45 m. Drawing and planning use the measured outline; published capacities are kept (website 80 theatre / 40 classroom / 60 dinner / 80 reception).",
    },
    "source": gh["source"],
    "transform": {
        "centre": [CX, CY], "floorZ": FZ, "quarterTurns": 1,
        "note": "x = 7.565 - Y, y = Z - 0.002, z = -2.065 - X. A proper rotation (det +1); the window wall is on -z (z = -3.734) and +x points 101.1 deg true. The centre is the panelling's centre within 4 mm (X -2.068, Y 7.566) and the ceiling's (-2.07, 7.55); floor Z 0.002 is the floor plane at the centre (fit 0.0054 + 0.00135 X, rms 7 mm).",
    },
    "site": {
        "frame": "grand-hall-planner", "observer": gh["site"]["observer"], "minusZBearingTrue": 11.1, "minusZBearingGrid": 12.96,
        "gridMinusTrueDeg": 1.861, "gridOrigin": [round(gE, 2), round(gN, 2)], "floorODN": round(FZ + 14.145, 3),
        "pavementY": round(10.40 - (FZ + 14.145), 3), "daylightChannel": "none",
        "note": "Derived from the Grand Hall frame constants (README, merchant-city-v2 frame block): the Saloon's planner -z is E57 +X, 90 deg left of the Grand Hall's -z (101.1 true, 102.96 grid). gridOrigin = the Grand Hall's (259332, 665191) + the Saloon origin's Grand Hall planner position (x 10.860, z 12.528) on +x (-0.22427, -0.97453) and +z (-0.97453, 0.22427). The windows look into a roofed space over the booking suite (LiDAR roof at Z 11.5-12 from 0.5 m out; FIRST 2010 F.03); the glass is lit from behind and no sun reaches the floor.",
    },
    "stations": stations_,
    "walls": {
        "vertices": vertices, "segments": segments,
        "elevation": {
            "levels": {"skirtingTop": 0.19, "dadoRail": 1.06, "dadoTop": 1.24, "panelRail": 1.52, "panelCorniceBottom": 2.80,
                       "panelCorniceTop": 3.16, "corniceBottom": 5.45, "ceiling": 5.515},
            "offsets": {"skirtingProud": 0.12, "dadoProud": 0.088, "dadoCapProud": 0.12, "panelRailProud": 0.035,
                        "panelCorniceProud": 0.11, "plasterSet": -0.017},
        },
    },
    "openings": openings,
    "ceiling": {
        "kind": "coffered", "height": 5.515, "heightRange": [5.505, 5.525], "regions": regions,
        "note": "Flat field at 5.515 with a ring of 36 octagonal coffers with rosettes (recessed to 5.63; 7 per short side, 13 per long side, pitch 0.90-0.92 m, ring centrelines E57 X -4.83 / 0.69, Y 2.20 / 12.89), a framed inner panel at 5.567, three raised squares at 5.713 and central raised panels at 5.855; a shallow cornice from 5.45. From down-facing mesh surfaces on a 5 cm raster; the ceiling relief should come from the mesh, these regions summarise it.",
    },
    "floor": {
        "kind": "herringbone-parquet", "boardsRun": "x", "levels": [{"id": "main", "height": 0}],
        "note": "Oak herringbone: spines run along the room (E57 Y, planner x); the joint direction flips every 0.355 m across the room (6 courses over E57 X -3.28..-1.15, native skybox faces of scan_058). Block width not settled (42-70 mm between an FFT and the eye): measure it on the floor photograph. Floor flat to 7 mm rms, 1.4 mm/m fall along E57 X.",
    },
    "freeStanding": [], "fittings": fittings, "concealedLights": [],
    "edits": [
        {"type": "recess", "wall": "front", "u": [{"opening": "door-lobby", "offset": -0.55}, {"opening": "door-lobby", "offset": 0.55}],
         "v": [0.0, 2.45], "depth": 0.3, "leafPlane": 0.05, "applies": ["relief"],
         "note": "PROPOSED. The lobby door stood open: a plain recess, its closed leaf modelled by the web (as the Grand Hall's main door). Leaf plane not measured."},
        {"type": "recess", "wall": "window-front-end", "u": [{"opening": "door-passage", "offset": -0.56}, {"opening": "door-passage", "offset": 0.56}],
         "v": [0.0, 2.45], "depth": 0.3, "leafPlane": 0.05, "applies": ["relief"],
         "note": "PROPOSED. The passage door stood open. Leaf plane not measured."},
        {"type": "patch", "wall": "front", "u": [2.0, 2.7], "v": [0.0, 2.45], "mode": "mirror", "about": 1.434, "applies": ["photo", "relief"],
         "note": "PROPOSED. The lobby door's open leaf stands in front of the panelling at E57 X -1.27..-0.57; mirrored about the door's centre (u 1.434). The source holds a corner loudspeaker above 1.6 m: patch that first or split v."},
    ],
    "occluders": occluders,
    "survey": {
        "projection": {"walls": gh["survey"]["projection"]["walls"], "ceiling": gh["survey"]["projection"]["ceiling"]},
        "wallViews": {"ppm": 200, "heightRange": [-0.05, 5.6], "eyeInset": 1.2, "near": 0.0, "far": 2.0, "tileMaxLength": 6.0, "modes": ["position"]},
        "ceilingView": {"name": "ceiling-pos", "ppm": 150, "eyeHeight": 1.0, "near": 4.35, "far": 5.0, "modes": ["position"]},
    },
    "provenance": {
        "measuredBy": "T-662 stage 0, saloon-measure (Claude)",
        "method": "Plan sections of the reviewed Matterport dollhouse mesh (dump checked against the GLB's accessor bounds to 0.001 mm) with robust line fits (RANSAC then Tukey IRLS) in four height bands; orthographic depth rasters of each wall (2 cm) for openings, bays and relief bands; down-facing surfaces on a 5 cm raster for the ceiling; clustering for fittings and furniture; opening edges against a metric grid in orthographic crops from the native E57 skybox faces (4096^2, oriented by correlation with the twin's world-aligned 512 px panoramas, r 0.92-0.99). Scripts: tools/surveyed-rooms/measure/saloon/.",
        "date": "2026-10-18",
        "sources": ["twin mesh/dollhouse.glb (sha256 21ee0973..., matches the twin manifest)", "twin manifest.json (station poses, E57 frame)",
             "twin panoramas tiles/scan_NNN/equirect_512.webp", "native 4096 px cube faces (image2D) from the Matterport .e57 export, read-only",
             "2010 FIRST floor plan (the venue's drawing, vector paths)", "the venue's Saloon room plan supplied by Blake (saloon.png)"],
        "residuals": [
            {"quantity": "wall face lines, panelling band 1.6-2.8 m (8 walls)", "kind": "fit-rms", "value": round(pan_rms / 1000, 4), "unit": "m",
             "note": "Largest per-wall inlier rms (fireplace main); others 5.3-7.5 mm. Panelling mouldings stand up to 4 cm proud (p95 13-60 mm)."},
            {"quantity": "plaster planes 3.4-5.2 m", "kind": "fit-rms", "value": 0.0063, "unit": "m", "note": "2.2-6.3 mm per wall, inliers 0.96-1.00."},
            {"quantity": "walls' deviation from the E57 axes", "kind": "fit-max", "value": 0.47, "unit": "deg",
             "note": "Long walls -0.17 (fireplace) and 0.00 (piers); short walls -0.11..-0.23 (front) and -0.32..-0.47 (rear): up to 4 cm over the room. The outline is drawn axis-parallel."},
            {"quantity": "window arches: circle fit to the reveal edges", "kind": "fit-rms", "value": 0.0055, "unit": "m"},
            {"quantity": "floor plane", "kind": "fit-rms", "value": 0.0071, "unit": "m", "note": "Z = 0.0054 + 0.00135 X - 0.00005 Y over 76.7 m2."},
            {"quantity": "electrolier lowest point, mesh against the skybox photo", "kind": "check", "value": 0.02, "unit": "m"},
            {"quantity": "door and window edges in the skybox crops", "kind": "tolerance", "value": 0.02, "unit": "m",
             "note": "5 mm per pixel, edges judged by eye. The 2 cm depth rasters agree within 0.07 m for the open doors and cannot see flush closed leaves."},
            {"quantity": "FIRST 2010 plan against the scan, scaled from the Grand Hall's length", "kind": "check", "value": 0.165, "unit": "m",
             "note": "rms over 17 features (walls, bays, doors, fireplace); max 0.33 m. See saloon.measurements.json."},
            {"quantity": "venue plan (saloon.png) against the scan, scale fitted", "kind": "check", "value": 0.114, "unit": "m",
             "note": "rms over 17 features; its own labels (11.9 x 6.9) imply scales 6% apart."},
        ],
        "note": "Draft, not reviewed. Edits marked PROPOSED need the projected photographs to confirm.",
    },
}
with open(OUT + "/saloon.room.draft.json", "w", encoding="utf8") as f:
    f.write(json.dumps(room, indent=1, ensure_ascii=False) + "\n")
print("wrote draft;", len(regions), "ceiling regions;", len(openings), "openings")

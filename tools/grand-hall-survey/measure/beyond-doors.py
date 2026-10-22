"""What lies just beyond the Grand Hall's four doors, measured for the planner's section (S3d).

For each doorway, the floor of the space beyond it within a reach of its outer face:

- the end door (D1) and the main door (D2), from the scan: a plan-view height map of the dollhouse
  mesh (2 cm cells, the highest up-facing surface under 0.3 m), its cells within 6 cm of the
  space's own floor level, the part joined to the doorway; the main door's stairwell (Stair 5),
  the cells more than 15 cm below it;
- the fireplace door (D3) and the fire exit (D4), which the scan did not reach, from the 2010 FIRST
  plan as first-floor.py registers it: its floor, joined to the doorway.

Each floor meets its doorway's outer face across the doorway's width (the doorway's own
threshold ends there). It also measures, from the mesh, the landing's balustrade (rail, newels,
balusters) and the panelling on the Saloon's face of the door wall, which hall-neighbours.ts draws.

Usage:
    python3 $SURVEY/measure/beyond-doors.py --mesh data/mesh --first-floor first-floor-2010.json --out beyond-doors.json
Requirements: numpy, shapely 2, trimesh.
"""
import argparse
import json
import os

import numpy as np
import trimesh
from shapely import affinity
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

HL, HW = 21.135 / 2, 10.59 / 2
CELL = 0.02

# The doorways as hall-spec.ts has them: wall, extent along it in planner terms, and the depth of
# the opening (its outer face).
DOORS = [
    # The Saloon itself: past its west face (x 7.45, open there to the end of the F.16 corridor,
    # a pale stone floor seen only at a graze) lies another room's floor.
    {"opening": "door-end", "label": "D1", "wall": "door", "x0": 8.27, "x1": 9.37, "outer": HW + 1.14, "reach": 2.4,
     "beyond": "F.01 Saloon", "from": "scan", "clip": (7.45, 60.0)},
    {"opening": "door-main", "label": "D2", "wall": "door", "x0": -0.72, "x1": 0.73, "outer": HW + 1.09, "reach": 2.4,
     "beyond": "F.16 Corridor at the head of Stair 5 (F.17)", "from": "scan"},
    {"opening": "door-fireplace", "label": "D3", "wall": "door", "x0": -9.41, "x1": -8.33, "outer": HW + 0.78, "reach": 2.4,
     "beyond": "the fireplace end of F.16 (its north-north-east end), a lobby toward the Kitchen F.10 and Corridor F.08", "from": "plan"},
    {"opening": "door-fire-exit", "label": "D4", "wall": "fireplace", "z0": -3.765, "z1": -2.705, "outer": -HL - 1.21, "reach": 1.2,
     "beyond": "F.11 Stair 7's landing", "from": "plan"},
]


def load_mesh(mesh_dir):
    pos = np.fromfile(os.path.join(mesh_dir, "positions.f32"), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(mesh_dir, "indices.u32"), dtype=np.uint32).reshape(-1, 3)
    planner = np.stack([8.795 - pos[:, 0], pos[:, 2] - 0.045, pos[:, 1] + 4.963], axis=1)
    return planner, idx


def heightmap(v, idx, xl, zl, ymax=0.3):
    """The highest up-facing surface under `ymax` in each CELL of [xl] x [zl] (NaN: none)."""
    a, b, c = v[idx[:, 0]], v[idx[:, 1]], v[idx[:, 2]]
    n = np.cross(b - a, c - a)
    up = n[:, 1] / np.maximum(np.linalg.norm(n, axis=1), 1e-12)
    keep = (up > 0.7) & (np.maximum(np.maximum(a[:, 1], b[:, 1]), c[:, 1]) < ymax)
    lo = np.minimum(np.minimum(a, b), c)
    hi = np.maximum(np.maximum(a, b), c)
    keep &= (hi[:, 0] > xl[0]) & (lo[:, 0] < xl[1]) & (hi[:, 2] > zl[0]) & (lo[:, 2] < zl[1])
    w = int(round((xl[1] - xl[0]) / CELL))
    h = int(round((zl[1] - zl[0]) / CELL))
    hm = np.full((h, w), np.nan)
    for A, B, C in zip(a[keep], b[keep], c[keep]):
        i0 = max(0, int((min(A[0], B[0], C[0]) - xl[0]) / CELL))
        i1 = min(w - 1, int((max(A[0], B[0], C[0]) - xl[0]) / CELL) + 1)
        j0 = max(0, int((min(A[2], B[2], C[2]) - zl[0]) / CELL))
        j1 = min(h - 1, int((max(A[2], B[2], C[2]) - zl[0]) / CELL) + 1)
        if i1 < i0 or j1 < j0:
            continue
        gx, gz = np.meshgrid(xl[0] + (np.arange(i0, i1 + 1) + 0.5) * CELL, zl[0] + (np.arange(j0, j1 + 1) + 0.5) * CELL)
        d = (B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2])
        if abs(d) < 1e-12:
            continue
        l1 = ((gx - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (gz - A[2])) / d
        l2 = ((B[0] - A[0]) * (gz - A[2]) - (gx - A[0]) * (B[2] - A[2])) / d
        inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l1 + l2 <= 1 + 1e-9)
        y = A[1] + l1 * (B[1] - A[1]) + l2 * (C[1] - A[1])
        sub = hm[j0:j1 + 1, i0:i1 + 1]
        update = inside & (np.isnan(sub) | (y > sub))
        sub[update] = y[update]
    return hm


def cells_polygon(mask, xl, zl):
    """The union of a mask's cells as polygons (planner x, z)."""
    rows = []
    for j in range(mask.shape[0]):
        row = mask[j]
        i = 0
        while i < len(row):
            if row[i]:
                k = i
                while k < len(row) and row[k]:
                    k += 1
                rows.append(box(xl[0] + i * CELL, zl[0] + j * CELL, xl[0] + k * CELL, zl[0] + (j + 1) * CELL))
                i = k
            else:
                i += 1
    return unary_union(rows)


def joined(geometry, seed):
    parts = [g for g in getattr(geometry, "geoms", [geometry]) if not g.is_empty]
    touching = [g for g in parts if g.distance(seed) < 0.03]
    return unary_union(touching) if touching else Polygon()


def door_frame(door):
    """The doorway's strip just beyond its outer face, the half plane beyond it and its centre."""
    if door["wall"] == "door":
        strip = box(door["x0"], door["outer"], door["x1"], door["outer"] + 0.06)
        beyond = box(-60, door["outer"], 60, 60)
        centre = Point((door["x0"] + door["x1"]) / 2, door["outer"])
    else:
        strip = box(door["outer"] - 0.06, door["z0"], door["outer"], door["z1"])
        beyond = box(-60, -60, door["outer"], 60)
        centre = Point(door["outer"], (door["z0"] + door["z1"]) / 2)
    return strip, beyond, centre


# The hall's bodies in plan, as hall-wall-body.ts builds them (first-floor.py has the same).
T_WINDOW, T_END, T_FIRE = 0.95, 1.21, 1.21
DOOR_WALL = [(7.0, HL, 1.14), (3.0, 7.0, 1.28), (0.73, 3.0, 1.14), (-0.72, 0.73, 1.09), (-6.0, -0.72, 1.14),
             (-8.33, -6.0, 0.46), (-9.41, -8.33, 0.78), (-HL, -9.41, 0.78)]


def hall_body():
    parts = [box(-HL, -HW, HL, HW), box(-HL, -HW - T_WINDOW, HL, -HW), box(HL, -HW, HL + T_END, HW),
             box(-HL - T_FIRE, -HW, -HL, HW), box(HL, -HW - T_WINDOW, HL + T_END, -HW), box(-HL - T_FIRE, -HW - T_WINDOW, -HL, -HW),
             box(HL, HW, HL + T_END, HW + 1.14), box(-HL - T_FIRE, HW, -HL, HW + 0.78)]
    parts += [box(x0, HW, x1, HW + t) for x0, x1, t in DOOR_WALL]
    return unary_union(parts)


BODY = hall_body()


def to_wall(geometry, door, reach):
    """Carries a floor to the hall's outer face: swept toward the hall by up to `reach` (the scan's
    floor stops short of the face at the feet of the panelling and doorcases; the plan's wall
    faces lie a few centimetres off the scan's), then cut back to the hall's bodies, so the floor
    meets their outer faces wherever it reaches them and never stands under them."""
    strip, _, _ = door_frame(door)
    step = 0.02
    toward = (0.0, -step) if door["wall"] == "door" else (step, 0.0)
    swept = unary_union([affinity.translate(geometry, toward[0] * k, toward[1] * k) for k in range(int(round(reach / step)) + 1)])
    # The doorway's strip starts at its own outer face, a little inside the body where a
    # neighbouring stretch of wall is thicker; the body there is the doorway's opening.
    return unary_union([swept.difference(BODY), strip])


def ring(polygon, digits=3):
    return [[round(x, digits), round(z, digits)] for x, z in polygon.exterior.coords[:-1]]


def polygons(geometry):
    return [g for g in getattr(geometry, "geoms", [geometry]) if isinstance(g, Polygon) and not g.is_empty]


def scan_floor(v, idx, door):
    strip, beyond, centre = door_frame(door)
    r = door["reach"]
    xl = (centre.x - r - 0.1, centre.x + r + 0.1)
    zl = (door["outer"] - 0.1, door["outer"] + r + 0.1)
    hm = heightmap(v, idx, xl, zl)
    # The space's own floor level: the median height just beyond the doorway.
    gx = xl[0] + (np.arange(hm.shape[1]) + 0.5) * CELL
    gz = zl[0] + (np.arange(hm.shape[0]) + 0.5) * CELL
    near = hm[(gz > door["outer"] + 0.1) & (gz < door["outer"] + 0.5)][:, (gx > door["x0"]) & (gx < door["x1"])]
    level = float(np.nanmedian(near))
    disc = Point(centre).buffer(r, 64)
    floor = cells_polygon(np.abs(hm - level) < 0.06, xl, zl)
    # Close the seams a cell or two wide in the mesh, not the furniture.
    floor = floor.buffer(0.03, join_style=2).buffer(-0.03, join_style=2)
    floor = joined(floor.intersection(disc).intersection(beyond), strip)
    # The panelling's and doorcases' feet stand on it along the wall: carried to the wall's face.
    floor = to_wall(floor, door, reach=0.2).intersection(disc)
    if "clip" in door:
        floor = floor.intersection(box(door["clip"][0], -60, door["clip"][1], 60))
    floor = floor.simplify(0.025, preserve_topology=True)
    well = None
    if door["opening"] == "door-main":
        found = cells_polygon(hm < level - 0.15, xl, zl).buffer(0.03, join_style=2).buffer(-0.03, join_style=2)
        found = found.intersection(disc).intersection(beyond).difference(floor)
        parts = sorted(polygons(found), key=lambda g: -g.area)
        well = parts[0].simplify(0.025, preserve_topology=True) if parts else None
    return floor, level, well


def plan_floor(first_floor, door):
    strip, beyond, centre = door_frame(door)
    disc = Point(centre).buffer(door["reach"], 64)
    floors = unary_union([Polygon(f["outline"], f["holes"]) for f in first_floor["floor"]])
    free = joined(floors.intersection(disc).intersection(beyond), strip.buffer(0.08))
    return to_wall(free, door, reach=0.4).intersection(disc).simplify(0.025, preserve_topology=True)


def balustrade(v):
    """The landing's balustrade over the stairwell: rail and newels."""
    def inbox(lo, hi):
        return v[np.all((v >= lo) & (v <= hi), axis=1)]
    tops, zs = [], []
    for x0 in np.arange(-0.75, 0.76, 0.25):
        pts = inbox([x0 - 0.1, 0.5, 7.8], [x0 + 0.1, 1.3, 8.4])
        top = pts[:, 1].max()
        band = pts[pts[:, 1] > top - 0.05]
        tops.append(top)
        zs.append((band[:, 2].min(), band[:, 2].max()))
    newels = []
    for sx in (-1, 1):
        pts = inbox([sx * 1.2 - 0.25, -0.2, 7.8], [sx * 1.2 + 0.25, 2.5, 8.35])
        low = pts[(pts[:, 1] > 0.05) & (pts[:, 1] < 0.6)]
        newels.append({"x": [round(float(low[:, 0].min()), 3), round(float(low[:, 0].max()), 3)],
                       "z": [round(float(low[:, 2].min()), 3), round(float(low[:, 2].max()), 3)],
                       "top": round(float(pts[:, 1].max()), 3)})
    return {
        "railTop": round(float(np.median(tops)), 3),
        "railZ": [round(float(np.median([z[0] for z in zs])), 3), round(float(np.median([z[1] for z in zs])), 3)],
        "newels": newels,
        "method": "mesh vertices over the straight run (x -0.75..0.75, every 0.25 m): the rail's top and the depth of its top 5 cm; each newel's footprint between 0.05 and 0.6 m and its top (finial)",
    }


def balusters(mesh):
    """Balusters' centres from a section at 0.3 m (loops 4-9 cm across) and their pitch."""
    segs = trimesh.intersections.mesh_plane(mesh, [0, 1, 0], [0, 0.3, 0])[:, :, [0, 2]]
    mid = segs.mean(axis=1)
    pts = segs[(np.abs(mid[:, 0]) < 1.05) & (mid[:, 1] > 7.95) & (mid[:, 1] < 8.25)].reshape(-1, 2)
    xs = np.sort(pts[:, 0])
    groups = [g for g in np.split(xs, np.where(np.diff(xs) > 0.03)[0] + 1) if 0.04 <= g.max() - g.min() <= 0.09]
    centres = [float(g.mean()) for g in groups]
    steps = np.diff(centres)
    return {"centres": [round(c, 3) for c in centres], "pitch": round(float(np.median(steps[(steps > 0.1) & (steps < 0.2)])), 3),
            "width": round(float(np.median([g.max() - g.min() for g in groups])), 3), "z": round(float(np.median(pts[:, 1])), 3),
            "method": "a section of the mesh at 0.3 m: loops 4-9 cm across over the straight run; the run's middle is broken in the mesh (a station stood in front of it), so it is drawn at the measured pitch between the end balusters"}


def saloon_panelling(mesh):
    """The Saloon's face of the door wall beside the end door, in vertical sections (planes x =
    const, every 10 cm): at each height (5 cm bands) the surface nearest the wall, as how far it
    stands proud of the door wall's outer face (HW + 1.14). The plaster is the face between 1.3 and
    1.9 m; the dado's top is the lowest height above 0.5 m from which the face stays within 2 cm of
    the plaster; east of the doorway a case stands out from the dado, its top where the nearest
    surface jumps more than 30 cm out."""
    face0 = HW + 1.14
    out = {}
    # "west" and "east" here are the planner's -x and +x, not the compass (planner +x bears 191 degrees, SSW).
    for side, xs in (("west", np.arange(7.75, 8.15, 0.1)), ("east", np.arange(9.9, 11.55, 0.1))):
        tops, prouds, cases, plasters = [], [], [], []
        for x in xs:
            s = trimesh.intersections.mesh_plane(mesh, [1, 0, 0], [x, 0, 0])[:, :, [2, 1]].reshape(-1, 2)
            pts = s[(s[:, 0] > 6.3) & (s[:, 0] < 7.2) & (s[:, 1] > 0.02) & (s[:, 1] < 2.0)]
            bands = {}
            for y0 in np.arange(0.1, 1.95, 0.05):
                q = pts[(pts[:, 1] > y0 - 0.025) & (pts[:, 1] < y0 + 0.025)]
                if len(q):
                    bands[round(float(y0), 2)] = float(q[:, 0].min()) - face0
            found = [v for y, v in bands.items() if 1.3 <= y <= 1.9]
            plaster = float(np.median(found)) if found else float("nan")
            plasters.append(plaster)
            heights = sorted(bands)
            top = next((y for y in heights if y > 0.5 and all(abs(bands[h] - plaster) < 0.02 for h in heights if y <= h <= y + 0.15)), None)
            if top is not None:
                tops.append(top)
            low = [v for y, v in bands.items() if 0.15 <= y <= 0.6 and v < plaster + 0.2]
            if low:
                prouds.append(float(np.median(low)))
            jump = [y for y, v in bands.items() if v > plaster + 0.3 and 0.5 < y < 1.1]
            if jump:
                cases.append((max(jump), float(np.median([bands[y] for y in jump]))))
        entry = {"x": [round(float(xs[0]), 2), round(float(xs[-1]), 2)], "plaster": round(float(np.nanmedian(plasters)), 3),
                 "top": round(float(np.median(tops)), 3), "proud": round(float(np.median(prouds)), 3)}
        if len(cases) >= len(xs) // 2:
            entry["case"] = {"top": round(float(np.median([c[0] for c in cases])), 3), "proud": round(float(np.median([c[1] for c in cases])), 3)}
        out[side] = entry
    out["method"] = "vertical sections (planes x = const, every 10 cm) through the Saloon's face of the door wall; at each 5 cm of height the surface nearest the wall, as metres proud of the door wall's outer face (HW + 1.14): the plaster (1.3-1.9 m), the dado's top (the lowest height above 0.5 m from which the face stays within 2 cm of the plaster for 15 cm), the dado's face (0.15-0.6 m, median) and, where the nearest surface jumps more than 30 cm out between 0.5 and 1.1 m in half the sections or more, a case: its top and how far it stands out"
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mesh", required=True)
    parser.add_argument("--first-floor", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    v, idx = load_mesh(args.mesh)
    mesh = trimesh.Trimesh(v, idx, process=False)
    first_floor = json.load(open(args.first_floor))
    doors = []
    for door in DOORS:
        entry = {k: door[k] for k in ("opening", "label", "wall", "outer", "reach", "beyond", "from")}
        if door["from"] == "scan":
            floor, level, well = scan_floor(v, idx, door)
            entry["floorLevel"] = round(level, 3)
            entry["source"] = "scan: dollhouse mesh height map at 2 cm, cells within 6 cm of the floor's level beyond the doorway, joined to it, within the reach"
            if well is not None:
                entry["well"] = ring(well)
                entry["wellSource"] = "scan: cells more than 15 cm below the landing (Stair 5's flights and well), within the reach"
        else:
            floor = plan_floor(first_floor, door)
            entry["floorLevel"] = None
            entry["source"] = "2010 FIRST plan (first-floor-2010.json, registered to the scan): its floor joined to the doorway, within the reach"
        parts = sorted(polygons(floor), key=lambda g: -g.area)
        # Holes under movable things (the Saloon leaf as it stood in the scan) are floor too.
        parts[0] = Polygon(parts[0].exterior, [r for r in parts[0].interiors if Polygon(r).area >= 0.3])
        entry["floor"] = ring(parts[0])
        entry["holes"] = [ring(Polygon(r)) for r in parts[0].interiors]
        entry["area"] = round(parts[0].area, 3)
        doors.append(entry)
    out = {
        "version": 1,
        "frame": "planner (metres): x toward the end wall, z from the window wall (-) to the door wall (+), the hall's floor y = 0",
        "doors": doors,
        "balustrade": {**balustrade(v), "balusters": balusters(mesh)},
        "saloonPanelling": saloon_panelling(mesh),
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps({d["label"]: {"area": d["area"], "level": d["floorLevel"], "vertices": len(d["floor"]), "holes": len(d["holes"])} for d in doors}))
    print(json.dumps({"balustrade": out["balustrade"], "saloon": out["saloonPanelling"]}, indent=1))


if __name__ == "__main__":
    main()

"""The first floor around the Grand Hall, from the venue's 2010 FIRST floor plan.

The plan (FIRST 2010.pdf, page 1) is a vector drawing: its walls are paths filled grey (0.73),
the poche. This reads those paths (no raster, no tracing), unions them, and registers them to
the planner's frame against the scan:

1. A first transform from the hall's own interior: the plan's four inner faces of the hall
   (found by casting lines across the poche from inside the hall) are set on the scan's
   (planner x = +-10.5675, z = +-5.295; hall-spec.ts).
2. An affine refinement (iterated closest points, trimmed) that fits the plan's wall faces to the
   scan's: horizontal sections of the dollhouse mesh at 2.6 and 3.2 m (above the panelling, under
   the ceilings) in the hall, the Saloon (F.01) and the stair hall of Stair 5 (F.17), weighted
   by length. Residuals are reported per region.

It then cuts away the hall itself (its bodies and the plinth ring, as hall-wall-body.ts and
hall-section.ts draw them: nothing published may stand where the hall stands), drops slivers
thinner than 6 cm, simplifies by 1 cm, and writes the walls and the floor between them (the
building's footprint less its walls and the hall) as polygons in the planner frame, each with
the plan paths it came from.

Usage:
    python3 $SURVEY/measure/first-floor.py --plan "FIRST 2010.pdf" --mesh data/mesh --out $PUBLIC/first-floor-2010.json

The output is the venue's drawing as vectors, published beside the survey's photographs for the Atelier section
(Blake, 22 Oct 2026: Trades Hall has given permission to publish the 2010 first-floor plan outline).
Requirements: PyMuPDF (fitz), numpy, shapely 2, trimesh (mesh sections).
"""
import argparse
import hashlib
import json
import os

import fitz
import numpy as np
import trimesh
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union
from shapely.validation import make_valid

GREY = (0.73, 0.73, 0.73)
HL, HW = 21.135 / 2, 10.59 / 2
# The hall's walls as hall-spec.ts has them (thickness from the room's plane, the door wall's
# stretches and doorways), so the published plan never overlaps the hall's bodies or its ring.
T_WINDOW, T_END, T_FIRE = 0.95, 1.21, 1.21
DOOR_WALL = [  # (x from, x to, thickness)
    (7.0, HL, 1.14), (3.0, 7.0, 1.28), (0.73, 3.0, 1.14), (-0.72, 0.73, 1.09), (-6.0, -0.72, 1.14),
    (-8.33, -6.0, 0.46), (-9.41, -8.33, 0.78), (-HL, -9.41, 0.78),
]
# The city model's cut-out for the hall (context/build_context.py; hall-context.ts CITY_SITE_CUT): |x| 11.2, the
# street face at z -6.24, the back at z 5.95. The street side lies under the window wall's body (z to -6.245), so the
# ring there is the body's whichever line it is cut at.
CITY_CUTOUT = (11.2, 6.24, 5.95)  # half x, street (-z), back (+z)
CUTOUT_MARGIN = 0.01


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def bezier(p0, p1, p2, p3, n=8):
    out = []
    for s in np.linspace(0, 1, n + 1)[1:]:
        u = 1 - s
        out.append((u ** 3 * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s ** 3 * p3[1]))
    return out


def path_polygons(drawing):
    """The closed outlines of one filled path (lines, curves, rectangles, quads), PDF points."""
    polys, cur, last = [], [], None

    def flush():
        nonlocal cur
        if len(cur) >= 3:
            polys.append(cur)
        cur = []

    for item in drawing["items"]:
        kind = item[0]
        if kind == "re":
            flush()
            r = item[1]
            polys.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            last = None
            continue
        if kind == "qu":
            flush()
            q = item[1]
            polys.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)])
            last = None
            continue
        a = (item[1].x, item[1].y)
        if last is None or abs(a[0] - last[0]) > 1e-3 or abs(a[1] - last[1]) > 1e-3:
            flush()
            cur = [a]
        if kind == "l":
            b = (item[2].x, item[2].y)
            cur.append(b)
            last = b
        elif kind == "c":
            pts = bezier(a, (item[2].x, item[2].y), (item[3].x, item[3].y), (item[4].x, item[4].y))
            cur.extend(pts)
            last = pts[-1]
    flush()
    return polys


def read_poche(pdf):
    page = fitz.open(pdf)[0]
    pieces = []
    for index, drawing in enumerate(page.get_drawings()):
        fill = drawing.get("fill")
        if fill is None or tuple(round(v, 3) for v in fill) != GREY:
            continue
        for outline in path_polygons(drawing):
            shape = make_valid(Polygon(outline)).buffer(0)
            if not shape.is_empty and shape.area > 1e-4:
                pieces.append((index, shape))
    return pieces


def crossings(walls, line):
    hit = walls.intersection(line)
    return [g for g in getattr(hit, "geoms", [hit]) if not g.is_empty and g.length > 0]


def hall_interior(walls, centre=(230.0, 520.0)):
    """The plan's inner faces of the hall: lines cast from inside the hall across the poche, the
    nearest hit each way, the most common over several lines (windows and doors let some through)."""
    cx, cy = centre

    def first_hit(origin, direction, reach=400):
        end = (origin[0] + direction[0] * reach, origin[1] + direction[1] * reach)
        best = None
        for g in crossings(walls, LineString([origin, end])):
            for p in (g.coords[0], g.coords[-1]):
                d = abs(p[0] - origin[0]) + abs(p[1] - origin[1])
                if best is None or d < best[0]:
                    best = (d, p)
        return None if best is None else best[1]

    rows = [cy + k for k in range(-220, 221, 20)]
    cols = [cx + k for k in range(-100, 101, 20)]
    window = [p[0] for y in rows if (p := first_hit((cx, y), (-1, 0))) is not None]
    door = [p[0] for y in rows if (p := first_hit((cx, y), (1, 0))) is not None]
    end = [p[1] for x in cols if (p := first_hit((x, cy), (0, -1))) is not None]
    fire = [p[1] for x in cols if (p := first_hit((x, cy), (0, 1))) is not None]

    def mode(values):
        vals, counts = np.unique(np.round(np.array(values), 2), return_counts=True)
        return float(vals[np.argmax(counts)])

    return {"window": mode(window), "door": mode(door), "end": mode(end), "fireplace": mode(fire)}


def affine_list(m):
    """shapely's affine_transform list from a 2x3 matrix [[a, b, xoff], [d, e, yoff]] (planner x, z)."""
    return [m[0][0], m[0][1], m[1][0], m[1][1], m[0][2], m[1][2]]


def hall_body_outline():
    parts = [box(-HL, -HW, HL, HW), box(-HL, -HW - T_WINDOW, HL, -HW), box(HL, -HW, HL + T_END, HW),
             box(-HL - T_FIRE, -HW, -HL, HW),
             box(HL, -HW - T_WINDOW, HL + T_END, -HW), box(-HL - T_FIRE, -HW - T_WINDOW, -HL, -HW)]
    for x0, x1, t in DOOR_WALL:
        parts.append(box(x0, HW, x1, HW + t))
    parts.append(box(HL, HW, HL + T_END, HW + 1.14))
    parts.append(box(-HL - T_FIRE, HW, -HL, HW + 0.78))
    body = unary_union(parts)
    ring = unary_union([body, box(-CITY_CUTOUT[0] + CUTOUT_MARGIN, -CITY_CUTOUT[1] + CUTOUT_MARGIN,
                                  CITY_CUTOUT[0] - CUTOUT_MARGIN, CITY_CUTOUT[2] - CUTOUT_MARGIN)])
    return body, ring


REGIONS = {
    "hall": ((-HL - 0.3, HL + 0.3), (-HW - 0.3, HW + 0.3)),
    "saloon": ((7.0, 15.2), (6.2, 19.0)),
    "stair-hall": ((-3.4, 3.4), (7.4, 12.2)),
}


def scan_samples(mesh_dir, heights=(2.6, 3.2)):
    pos = np.fromfile(os.path.join(mesh_dir, "positions.f32"), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(mesh_dir, "indices.u32"), dtype=np.uint32).reshape(-1, 3)
    planner = np.stack([8.795 - pos[:, 0], pos[:, 2] - 0.045, pos[:, 1] + 4.963], axis=1)
    mesh = trimesh.Trimesh(planner, idx, process=False)
    points, weights, regions = [], [], []
    for h in heights:
        segs = trimesh.intersections.mesh_plane(mesh, plane_normal=[0, 1, 0], plane_origin=[0, h, 0])[:, :, [0, 2]]
        mid = segs.mean(axis=1)
        length = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
        for name, (xl, zl) in REGIONS.items():
            m = (mid[:, 0] > xl[0]) & (mid[:, 0] < xl[1]) & (mid[:, 1] > zl[0]) & (mid[:, 1] < zl[1]) & (length > 1e-4)
            if name != "hall":
                # Beyond the hall: not the hall's own walls.
                m &= ~((np.abs(mid[:, 0]) < HL + 1.3) & (np.abs(mid[:, 1]) < HW + 1.3))
            points.append(mid[m])
            weights.append(length[m])
            regions += [name] * int(m.sum())
    return np.concatenate(points), np.concatenate(weights), np.array(regions)


def residuals(boundary, points):
    return np.array([boundary.distance(Point(p)) for p in points])


def weighted_quantile(values, weights, q):
    order = np.argsort(values)
    cw = np.cumsum(weights[order]) / weights.sum()
    return float(values[order][min(len(values) - 1, np.searchsorted(cw, q))])


def fit_affine(walls_pdf, initial, points, weights, iterations=24):
    """Iterated closest points: each scan point's nearest plan face, mapped back to the plan, and
    a weighted least-squares affine from plan to scan; trimmed at 0.45 m, then 0.3 m."""
    m = np.array(initial, float)
    boundary_pdf = walls_pdf.boundary
    for it in range(iterations):
        trim = 0.45 if it < iterations // 2 else 0.3
        boundary = affinity.affine_transform(boundary_pdf, affine_list(m))
        inv = np.linalg.inv(np.vstack([m, [0, 0, 1]]))
        src, dst, w = [], [], []
        for p, wt in zip(points, weights):
            q = nearest_points(boundary, Point(p))[0]
            if np.hypot(q.x - p[0], q.y - p[1]) > trim:
                continue
            src.append((inv @ np.array([q.x, q.y, 1.0]))[:2])
            dst.append(p)
            w.append(wt)
        src, dst, w = np.array(src), np.array(dst), np.sqrt(np.array(w))
        a = np.hstack([src, np.ones((len(src), 1))]) * w[:, None]
        m = np.array([np.linalg.lstsq(a, dst[:, 0] * w, rcond=None)[0], np.linalg.lstsq(a, dst[:, 1] * w, rcond=None)[0]])
    return m


def ring_coords(ring, digits=3):
    """A ring's points rounded to the millimetre, without the repeats rounding makes."""
    out = []
    for x, z in ring.coords[:-1]:
        point = [round(x, digits), round(z, digits)]
        if not out or point != out[-1]:
            out.append(point)
    while len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def polygons_of(geometry):
    if geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    return [g for g in getattr(geometry, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def ranges(indices):
    out, start, prev = [], None, None
    for i in sorted(set(indices)):
        if start is None:
            start = prev = i
        elif i == prev + 1:
            prev = i
        else:
            out.append(f"{start}" if start == prev else f"{start}-{prev}")
            start = prev = i
    if start is not None:
        out.append(f"{start}" if start == prev else f"{start}-{prev}")
    return ",".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--mesh", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    pieces = read_poche(args.plan)
    walls_pdf = unary_union([shape for _, shape in pieces])
    faces = hall_interior(walls_pdf)
    sz = 2 * HW / (faces["door"] - faces["window"])
    sx = 2 * HL / (faces["fireplace"] - faces["end"])
    # planner x = HL - (Y - end) * sx ; planner z = (X - window) * sz - HW
    initial = [[0.0, -sx, HL + faces["end"] * sx], [sz, 0.0, -HW - faces["window"] * sz]]
    points, weights, regions = scan_samples(args.mesh)
    near = residuals(affinity.affine_transform(walls_pdf, affine_list(initial)).boundary, points) < 0.6
    points, weights, regions = points[near], weights[near], regions[near]
    fitted = fit_affine(walls_pdf, initial, points, weights)
    report = {}
    for label, matrix in (("interior", initial), ("fitted", fitted)):
        res = residuals(affinity.affine_transform(walls_pdf, affine_list(matrix)).boundary, points)
        report[label] = {name: {"metres": round(float(weights[regions == name].sum()), 1),
                                "median": round(weighted_quantile(res[regions == name], weights[regions == name], 0.5), 3),
                                "p90": round(weighted_quantile(res[regions == name], weights[regions == name], 0.9), 3)}
                         for name in REGIONS if (regions == name).any()}
    placed = affinity.affine_transform(walls_pdf, affine_list(fitted))
    _, ring = hall_body_outline()
    cut = ring.buffer(0.002, join_style=2)
    walls = placed.difference(cut)
    # Slivers thinner than 6 cm (where the plan's faces of the hall's own walls fall a few
    # centimetres outside the scan's) go; the plan's thinnest real walls are about 10 cm.
    walls = walls.buffer(-0.03, join_style=2).buffer(0.03, join_style=2).intersection(walls)
    # Simplified one polygon at a time, neighbours can come to overlap: union them again, so no
    # two walls' tops share a plane.
    walls = unary_union([p.buffer(0) for p in polygons_of(walls.simplify(0.01, preserve_topology=True))])
    # And close the hairline gaps (under 1 cm) the plan's separate paths leave where walls meet.
    walls = walls.buffer(0.005, join_style=2).buffer(-0.005, join_style=2)
    wall_polys = [p for p in polygons_of(walls) if p.area > 0.02]
    # The building's footprint: its walls closed over their doors and windows (up to 3 m), filled.
    closed = placed.buffer(1.5, join_style=2).buffer(-1.5, join_style=2)
    footprint = unary_union([Polygon(p.exterior) for p in polygons_of(closed)])
    # Space the poche encloses with no door (a hole in a wall polygon: the light well F.28, the
    # lift shaft) has no floor.
    voids = unary_union([Polygon(r) for p in polygons_of(placed.buffer(0)) for r in p.interiors])
    floor = footprint.difference(unary_union(wall_polys)).difference(voids).difference(cut)
    floor = floor.buffer(-0.01, join_style=2).buffer(0.01, join_style=2).simplify(0.01, preserve_topology=True)
    floor = unary_union([p.buffer(0) for p in polygons_of(floor)]).difference(unary_union(wall_polys))
    floor_polys = [p for p in polygons_of(floor) if p.area > 0.25]

    sources = []
    for poly in wall_polys:
        hit = [index for index, shape in pieces if affinity.affine_transform(shape, affine_list(fitted)).intersects(poly)]
        sources.append(f"FIRST 2010.pdf p1, grey wall fill (0.73), drawing paths {ranges(hit)}")

    def vertex_count(polys):
        return sum(len(p.exterior.coords) - 1 + sum(len(r.coords) - 1 for r in p.interiors) for p in polys)

    out = {
        "version": 1,
        "frame": "planner (metres): x toward the end wall, z from the window wall (-) to the door wall (+), the hall's floor y = 0",
        "source": {
            "file": os.path.basename(args.plan),
            "sha256": sha256(args.plan),
            "page": 1,
            "what": "the venue's 2010 FIRST floor plan: the walls' grey poche paths (fill 0.73), read as vectors",
            "paths": len({index for index, _ in pieces}),
        },
        "registration": {
            "hallInteriorPdf": faces,
            "initial": [[round(v, 8) for v in row] for row in initial],
            "affine": [[round(float(v), 8) for v in row] for row in fitted],
            "method": "PDF (X, Y) points -> planner (x, z) = affine (rows x, z): first from the hall's inner faces, then trimmed iterated closest points to the scan's wall sections at 2.6 and 3.2 m in the hall, the Saloon F.01 and the stair hall F.17",
            "residuals": report,
        },
        "cutAway": "the hall's bodies and plinth ring (hall-wall-body.ts, hall-section.ts) and 2 mm round them; slivers under 6 cm; simplified by 1 cm",
        "walls": [{"id": f"w{i:03d}", "outline": ring_coords(p.exterior), "holes": [ring_coords(r) for r in p.interiors], "source": s}
                  for i, (p, s) in enumerate(zip(wall_polys, sources))],
        "floor": [{"id": f"f{i:02d}", "outline": ring_coords(p.exterior), "holes": [ring_coords(r) for r in p.interiors],
                   "source": "FIRST 2010.pdf p1: the building's footprint inside its outer walls, less the walls, the voids they enclose and the hall"}
                  for i, p in enumerate(floor_polys)],
        "stats": {"wallPolygons": len(wall_polys), "wallVertices": vertex_count(wall_polys),
                  "floorPolygons": len(floor_polys), "floorVertices": vertex_count(floor_polys)},
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(json.dumps({"faces": faces, "residuals": report, "stats": out["stats"]}, indent=1))


if __name__ == "__main__":
    main()

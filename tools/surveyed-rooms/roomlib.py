"""Shared geometry for surveyed-room configs (<slug>.room.json). Standard library only.

Frames (README.md): E57 is the capture's frame, Z up, metres. The planner frame is y up with
its origin at the centre of the room's floor. transform.quarterTurns k maps E57 offsets
X' = X - centre[0], Y' = Y - centre[1] to planner (x, z):
    k = 0: ( X', -Y')    k = 1: (-Y', -X')    k = 2: (-X',  Y')    k = 3: ( Y',  X')
and y = Z - floorZ. The tables below are exact (no trigonometry), so axis-aligned walls give
exact unit vectors and the Grand Hall's views come out bit for bit.

Walls: the outline's vertices run counter-clockwise seen from above; segment i runs from
vertex i to vertex i + 1 with the room on its left. Seen from inside, a wall's u runs left to
right, so u = 0 is at the segment's END vertex and u runs back towards its start.
"""
import json
import math

# (X', Y') from planner (x, z), and planner (x, z) from (X', Y'), per quarter turn.
_TO_E57 = {
    0: lambda x, z: (x, -z),
    1: lambda x, z: (-z, -x),
    2: lambda x, z: (-x, z),
    3: lambda x, z: (z, x),
}
_TO_PLANNER = {
    0: lambda X, Y: (X, -Y),
    1: lambda X, Y: (-Y, -X),
    2: lambda X, Y: (-X, Y),
    3: lambda X, Y: (Y, X),
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def turns(room):
    return room["transform"]["quarterTurns"]


def to_planner(room, X, Y, Z=None):
    """Planner (x, z), or (x, y, z) when Z is given, of an E57 point."""
    t = room["transform"]
    x, z = _TO_PLANNER[turns(room)](X - t["centre"][0], Y - t["centre"][1])
    return (x, z) if Z is None else (x, Z - t["floorZ"], z)


def to_e57(room, x, z):
    """E57 (X, Y) of a planner (x, z) point."""
    t = room["transform"]
    dX, dY = _TO_E57[turns(room)](x, z)
    return (t["centre"][0] + dX, t["centre"][1] + dY)


def to_e57_dir(room, dx, dz):
    """E57 (X, Y) of a planner (x, z) direction."""
    return _TO_E57[turns(room)](dx, dz)


def walls(room):
    """Each segment as a wall frame: planner and E57 u axis, inward normal, length, anchors."""
    verts = room["walls"]["vertices"]
    segs = room["walls"]["segments"]
    n = len(verts)
    out = []
    for i, seg in enumerate(segs):
        a = verts[i]
        b = verts[(i + 1) % n]
        dx, dz = a[0] - b[0], a[1] - b[1]          # left to right seen from inside: b -> a
        length = math.hypot(dx, dz)
        u = (dx / length, dz / length) if length > 0 else (0.0, 0.0)
        normal = (-u[1], u[0])                     # left of the travel a -> b: into the room
        survey = seg.get("survey", {})
        corner = to_e57(room, b[0], b[1])
        out.append(dict(
            id=seg["id"], index=i, segment=seg, start=a, end=b, length=length, height=seg["height"],
            origin=b, u=u, normal=normal,
            cornerE57=corner, uE57=to_e57_dir(room, *u), normalE57=to_e57_dir(room, *normal),
            anchorE57=tuple(survey["anchorE57"]) if "anchorE57" in survey else corner,
            name=survey.get("name", seg["id"]), tiles=survey.get("tiles"),
        ))
    return out


def wall_map(room):
    return {w["id"]: w for w in walls(room)}


def opening_centre(room, opening, wmap=None):
    """u of an opening's centre on its wall: `centre`, or the projection of `centreE57` from
    the wall's corner (the outline's, not the survey anchor)."""
    if "centre" in opening:
        return opening["centre"]
    w = (wmap or wall_map(room))[opening["wall"]]
    X, Y = opening["centreE57"]
    cX, cY = w["cornerE57"]
    return (X - cX) * w["uE57"][0] + (Y - cY) * w["uE57"][1]


def opening_offset(room, opening, wmap=None):
    """Distance of `centreE57` in front of (+) or behind (-) its wall face; 0 for `centre`."""
    if "centre" in opening:
        return 0.0
    w = (wmap or wall_map(room))[opening["wall"]]
    X, Y = opening["centreE57"]
    cX, cY = w["cornerE57"]
    return (X - cX) * w["normalE57"][0] + (Y - cY) * w["normalE57"][1]


def opening_top(opening):
    shape = opening["headShape"]
    if shape == "semicircular":
        return opening["head"] + opening["width"] / 2
    if shape == "segmental":
        return opening["head"] + opening.get("headRise", 0.0)
    return opening["head"]


def resolve_u(room, ref, openings=None, wmap=None):
    """A uRef: a number, or {opening, offset} = that opening's centre + offset."""
    if isinstance(ref, (int, float)):
        return ref
    openings = openings or {o["id"]: o for o in room["openings"]}
    return opening_centre(room, openings[ref["opening"]], wmap) + ref["offset"]


def resolve_shift(room, ref, openings=None, wmap=None):
    """A shiftRef: a number, or {openingDelta: [a, b]} = centre(b) - centre(a)."""
    if isinstance(ref, (int, float)):
        return ref
    openings = openings or {o["id"]: o for o in room["openings"]}
    a, b = ref["openingDelta"]
    return opening_centre(room, openings[b], wmap) - opening_centre(room, openings[a], wmap)


def signed_area(vertices):
    """Area of the outline, positive when it runs counter-clockwise seen from above
    (from +x towards -z in the planner frame)."""
    s = 0.0
    n = len(vertices)
    for i in range(n):
        x0, z0 = vertices[i]
        x1, z1 = vertices[(i + 1) % n]
        s += x0 * z1 - x1 * z0
    return -0.5 * s


def point_in_polygon(vertices, x, z):
    """Strictly inside by ray casting (points on an edge may go either way)."""
    inside = False
    n = len(vertices)
    for i in range(n):
        x0, z0 = vertices[i]
        x1, z1 = vertices[(i + 1) % n]
        if (z0 > z) != (z1 > z):
            xc = x0 + (z - z0) * (x1 - x0) / (z1 - z0)
            if x < xc:
                inside = not inside
    return inside


def distance_to_outline(vertices, x, z):
    best = math.inf
    n = len(vertices)
    for i in range(n):
        x0, z0 = vertices[i]
        x1, z1 = vertices[(i + 1) % n]
        dx, dz = x1 - x0, z1 - z0
        L2 = dx * dx + dz * dz
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - x0) * dx + (z - z0) * dz) / L2))
        best = min(best, math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)))
    return best


def half_up(value):
    """Pixel count: nearest integer, halves up. Matches round() on the Grand Hall's wall
    tiles (none is a half) and the hand-set ceiling view (1588.5 -> 1589)."""
    return int(math.floor(value + 0.5))


def wall_views(room):
    """The orthographic elevation tiles render.mjs draws for each wall (views-walls.json).
    The arithmetic follows tools/grand-hall-survey/wall-views.py operation for operation, so
    the Grand Hall's file is reproduced bit for bit."""
    wv = room["survey"]["wallViews"]
    ppm = wv["ppm"]
    h0, h1 = wv["heightRange"]
    inset = wv["eyeInset"]
    floor = room["transform"]["floorZ"]
    wmap = wall_map(room)
    order = wv.get("order") or [s["id"] for s in room["walls"]["segments"]]
    views = []
    for wall_id in order:
        w = wmap[wall_id]
        tiles = w["tiles"] or max(1, math.ceil(w["length"] / wv["tileMaxLength"]))
        tile_len = w["length"] / tiles
        start, u, normal = w["anchorE57"], w["uE57"], w["normalE57"]
        for t in range(tiles):
            u0 = t * tile_len
            uc = u0 + tile_len / 2
            cx = start[0] + u[0] * uc
            cy = start[1] + u[1] * uc
            zc = floor + (h0 + h1) / 2
            # camera `inset` metres inside the room, looking at the wall
            ex = cx + normal[0] * inset
            ey = cy + normal[1] * inset
            views.append(dict(name=f"wall-{w['name']}-{t}", eye=[ex, ey, zc], target=[cx, cy, zc], up=[0, 0, 1],
                              size=[tile_len, h1 - h0], pixels=[half_up(tile_len * ppm), half_up((h1 - h0) * ppm)],
                              near=wv["near"], far=wv["far"], modes=list(wv["modes"]), wall=w["name"], tile=t,
                              tiles=tiles, u0=u0))
    return views


def ceiling_view(room):
    """One view looking straight up over the outline's bounding box (views-ceiling.json):
    image right is E57 +X, image up E57 +Y."""
    cv = room["survey"]["ceilingView"]
    verts = room["walls"]["vertices"]
    xs = [v[0] for v in verts]
    zs = [v[1] for v in verts]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    X, Y = to_e57(room, (x0 + x1) / 2, (z0 + z1) / 2)
    span_x, span_z = x1 - x0, z1 - z0
    size = [span_x, span_z] if turns(room) % 2 == 0 else [span_z, span_x]
    eye_z = room["transform"]["floorZ"] + cv["eyeHeight"]
    ppm = cv["ppm"]
    return dict(name=cv["name"], eye=[X, Y, eye_z], target=[X, Y, eye_z + 1.0], up=[0, 1, 0], size=size,
                pixels=[half_up(size[0] * ppm), half_up(size[1] * ppm)], near=cv["near"], far=cv["far"],
                modes=list(cv["modes"]))


def wall_views_bytes(room):
    """views-walls.json as the Grand Hall's generator writes it: indent 1, no final newline, LF."""
    return json.dumps(wall_views(room), indent=1).encode("utf-8")


def ceiling_view_bytes(room):
    """views-ceiling.json as committed: one compact line and a final newline, LF."""
    return (json.dumps([ceiling_view(room)], separators=(",", ":")) + "\n").encode("utf-8")

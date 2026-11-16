"""An analytic room for T3: axis-aligned rectangles (with holes and painted regions) and one
vertical cylinder, ray-cast in the planner frame. It stands in for the dollhouse mesh and the
panoramas, so the build's results can be checked against known geometry and albedo.

The room: a 12-segment 6 x 4 x 3 m prism at quarter turn 1 (E57 X = 10 - z, Y = 20 - x, Z = y),
0.2 m returns into a window bay on -z and a fireplace recess on +z; an arched window whose glass
sits on two planes (0.5 m behind the face below 1.6 m, 0.55 m above) with a transom bar; an open
door on the front wall (nothing behind it); a box standing on the glass sill 0.22-0.32 m behind
the face (in front of the glass: not glass); a poster on the rear wall and one on fire-r-end (to
be patched out); one recessed coffer, off centre in both x and z (so a mirrored or flipped ceiling
fails), in a 3 m ceiling; a green cylinder (a fitting) that is painted in the panoramas only, as
an occluder the depth maps never see.
"""
import numpy as np

CENTRE = (10.0, 20.0)
HEIGHT = 3.0
VERTICES = [[3.0, 1.8], [3.0, -1.8], [1.8, -1.8], [1.8, -2.0], [-1.8, -2.0], [-1.8, -1.8], [-3.0, -1.8],
            [-3.0, 1.8], [-1.8, 1.8], [-1.8, 2.0], [1.8, 2.0], [1.8, 1.8]]
SEGMENTS = ["front", "win-f-end", "win-f-ret", "window", "win-r-ret", "win-r-end", "rear", "fire-r-end",
            "fire-r-ret", "fire", "fire-f-ret", "fire-f-end"]
ALBEDO = {
    "front": (0.45, 0.40, 0.30), "win-f-end": (0.40, 0.42, 0.30), "win-f-ret": (0.42, 0.38, 0.33),
    "window": (0.38, 0.40, 0.35), "win-r-ret": (0.42, 0.38, 0.33), "win-r-end": (0.40, 0.42, 0.30),
    "rear": (0.50, 0.42, 0.32), "fire-r-end": (0.36, 0.44, 0.30), "fire-r-ret": (0.42, 0.38, 0.33),
    "fire": (0.48, 0.36, 0.28), "fire-f-ret": (0.42, 0.38, 0.33), "fire-f-end": (0.36, 0.44, 0.30),
    "floor": (0.35, 0.25, 0.15), "ceiling": (0.80, 0.80, 0.75), "coffer": (0.60, 0.65, 0.80),
    "glass": (0.80, 0.50, 0.15), "frame": (0.15, 0.10, 0.07), "poster": (0.70, 0.10, 0.10),
    "poster2": (0.10, 0.20, 0.70), "lamp": (0.05, 0.60, 0.05), "outside": (0.02, 0.02, 0.02),
    "box": (0.30, 0.55, 0.60),
}
# The window: face opening centre x 0 (u 1.8 on the window wall), width 1.2, sill 0.8, arch from 1.9.
FACE = dict(width=1.2, sill=0.8, head=1.9)
FACE_TOP = FACE["head"] + FACE["width"] / 2
GLASS = dict(width=1.0, sill=0.9, head=1.95, split=1.6, bar=(1.55, 1.6), depths=(0.5, 0.55))
DOOR = dict(width=0.9, head=2.1)              # front wall, centre z 0 (u 1.8)
COFFERS = [(0.4, 1.9, -1.4, 0.0)]             # (x0, x1, z0, z1), recessed to 3.15: off centre in x and z
BOX = dict(x=(-0.15, 0.05), y=(0.9, 1.25), depth=(0.22, 0.32))   # behind the window face, on the glass sill
COFFER_TOP = 3.15
LAMP = dict(x=0.8, z=0.3, r=0.25, y=(0.5, 2.5))


def to_planner_points(P):
    """E57 (..., 3) -> planner (..., 3)."""
    return np.stack([CENTRE[1] - P[..., 1], P[..., 2], CENTRE[0] - P[..., 0]], -1)


def to_planner_dirs(D):
    return np.stack([-D[..., 1], D[..., 2], -D[..., 0]], -1)


def to_e57_points(p):
    return np.stack([CENTRE[0] - p[..., 2], CENTRE[1] - p[..., 0], p[..., 1]], -1)


def glass_outline(x, y):
    """Inside the glazed outline (minus the bar), at planner x (window centre 0) and height y."""
    half = GLASS["width"] / 2
    top = GLASS["head"] + np.sqrt(np.maximum(0.0, half * half - x * x))
    inside = (np.abs(x) <= half) & (y >= GLASS["sill"]) & (y <= top)
    return inside & ~((y >= GLASS["bar"][0]) & (y <= GLASS["bar"][1]))


def face_opening(x, y):
    half = FACE["width"] / 2
    return (np.abs(x) <= half) & (y >= FACE["sill"]) & (y <= FACE["head"] + np.sqrt(np.maximum(0.0, half * half - x * x)))


class Rect:
    """An axis-aligned rectangle: plane axis (0 x, 1 y, 2 z) at coordinate c, ranges on the other
    two axes, an albedo name or a function of the hit points, and an optional hole."""

    def __init__(self, axis, c, ranges, albedo, hole=None):
        self.axis, self.c, self.ranges, self.albedo, self.hole = axis, c, ranges, albedo, hole

    def colour(self, P):
        if callable(self.albedo):
            return self.albedo(P)
        return np.broadcast_to(np.array(ALBEDO[self.albedo]), P.shape).copy()


def _box_sides(x0, x1, y0, y1, z0, z1, albedo, skip=()):
    out = []
    for axis, lo, hi in ((0, x0, x1), (1, y0, y1), (2, z0, z1)):
        others = {a: r for a, r in ((0, (x0, x1)), (1, (y0, y1)), (2, (z0, z1))) if a != axis}
        for c, side in ((lo, "lo"), (hi, "hi")):
            if (axis, side) not in skip:
                out.append(Rect(axis, c, others, albedo))
    return out


def build():
    rects, names = [], []

    def add(rect, name):
        rects.append(rect)
        names.append(name)

    n = len(VERTICES)
    for i, name in enumerate(SEGMENTS):
        a, b = VERTICES[i], VERTICES[(i + 1) % n]
        if a[0] == b[0]:
            axis, c, other = 0, a[0], {2: tuple(sorted((a[1], b[1]))), 1: (0.0, HEIGHT)}
        else:
            axis, c, other = 2, a[1], {0: tuple(sorted((a[0], b[0]))), 1: (0.0, HEIGHT)}
        hole = None
        if name == "window":
            hole = lambda P: face_opening(P[:, 0], P[:, 1])  # noqa: E731
        if name == "front":
            hole = lambda P: (np.abs(P[:, 2]) <= DOOR["width"] / 2) & (P[:, 1] <= DOOR["head"])  # noqa: E731
        add(Rect(axis, c, other, name, hole), name)
    # floor and ceiling over the bounding box; coffers recessed in the ceiling
    add(Rect(1, 0.0, {0: (-3.0, 3.0), 2: (-2.0, 2.0)}, "floor"), "floor")

    def in_coffer(P):
        out = np.zeros(len(P), bool)
        for x0, x1, z0, z1 in COFFERS:
            out |= (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 2] >= z0) & (P[:, 2] <= z1)
        return out
    add(Rect(1, HEIGHT, {0: (-3.0, 3.0), 2: (-2.0, 2.0)}, "ceiling", in_coffer), "ceiling")
    for x0, x1, z0, z1 in COFFERS:
        for r in _box_sides(x0, x1, HEIGHT, COFFER_TOP, z0, z1, "coffer", skip={(1, "lo")}):
            add(r, "coffer")
    # the window bay behind the face: two glass planes, a step between them, reveals
    d0, d1 = GLASS["depths"]

    def pane(P):
        return np.where(glass_outline(P[:, 0], P[:, 1])[:, None], np.array(ALBEDO["glass"]), np.array(ALBEDO["frame"]))
    add(Rect(2, -2.0 - d0, {0: (-0.6, 0.6), 1: (FACE["sill"], GLASS["split"])}, pane), "pane-lower")
    add(Rect(2, -2.0 - d1, {0: (-0.6, 0.6), 1: (GLASS["split"], FACE_TOP)}, pane), "pane-upper")
    add(Rect(1, GLASS["split"], {0: (-0.6, 0.6), 2: (-2.0 - d1, -2.0 - d0)}, "frame"), "step")
    for x in (-0.6, 0.6):
        add(Rect(0, x, {1: (FACE["sill"], FACE_TOP), 2: (-2.0 - d1, -2.0)}, "frame"), "reveal")
    add(Rect(1, FACE["sill"], {0: (-0.6, 0.6), 2: (-2.0 - d0, -2.0)}, "frame"), "reveal")
    add(Rect(1, FACE_TOP, {0: (-0.6, 0.6), 2: (-2.0 - d1, -2.0)}, "frame"), "reveal")
    for r in _box_sides(*BOX["x"], *BOX["y"], -2.0 - BOX["depth"][1], -2.0 - BOX["depth"][0], "box", skip={(1, "lo")}):
        add(r, "box")
    # posters, 3 cm proud: on the rear wall (x = -3) and on fire-r-end (z = 1.8)
    for r in _box_sides(-3.0, -2.97, 0.5, 1.5, 0.8, 1.2, "poster", skip={(0, "lo")}):
        add(r, "poster")
    for r in _box_sides(-2.5, -2.1, 0.4, 1.2, 1.77, 1.8, "poster2", skip={(2, "hi")}):
        add(r, "poster2")
    return rects, names


SCENE = build()


def cast(O, D, tmin=1e-6, tmax=np.inf, lamp=False):
    """Nearest hit along rays O + t D (planner, D unit): (t, index into SCENE or -1 for nothing,
    -2 for the lamp), with t in (tmin, tmax)."""
    rects, _ = SCENE
    O = np.broadcast_to(np.asarray(O, float), D.shape)
    N = len(D)
    best = np.full(N, np.inf)
    which = np.full(N, -1)
    for k, r in enumerate(rects):
        a = r.axis
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (r.c - O[:, a]) / D[:, a]
        ok = np.isfinite(t) & (t > tmin) & (t < tmax) & (t < best)
        if not ok.any():
            continue
        idx = np.nonzero(ok)[0]
        P = O[idx] + t[idx, None] * D[idx]
        inside = np.ones(len(idx), bool)
        for axis, (lo, hi) in r.ranges.items():
            inside &= (P[:, axis] >= lo - 1e-9) & (P[:, axis] <= hi + 1e-9)
        if r.hole is not None:
            inside &= ~r.hole(P)
        hit = idx[inside]
        best[hit] = t[hit]
        which[hit] = k
    if lamp:
        ox, oz = O[:, 0] - LAMP["x"], O[:, 2] - LAMP["z"]
        dx, dz = D[:, 0], D[:, 2]
        A = dx * dx + dz * dz
        B = 2 * (ox * dx + oz * dz)
        C = ox * ox + oz * oz - LAMP["r"] ** 2
        disc = B * B - 4 * A * C
        with np.errstate(invalid="ignore", divide="ignore"):
            t = (-B - np.sqrt(disc)) / (2 * A)
        y = O[:, 1] + t * D[:, 1]
        ok = (disc > 0) & (A > 1e-12) & (t > tmin) & (t < best) & (y >= LAMP["y"][0]) & (y <= LAMP["y"][1])
        best[ok] = t[ok]
        which[ok] = -2
    return best, which


def colours(O, D, t, which):
    rects, _ = SCENE
    out = np.tile(np.array(ALBEDO["outside"]), (len(D), 1))
    O = np.broadcast_to(np.asarray(O, float), D.shape)
    out[which == -2] = ALBEDO["lamp"]
    for k in np.unique(which[which >= 0]):
        m = which == k
        out[m] = rects[k].colour(O[m] + t[m, None] * D[m])
    return out


def panorama_colour(station, dirs):
    """synth.write_panoramas callback: the scene's albedo seen from a station (E57 dirs)."""
    shape = dirs.shape
    D = to_planner_dirs(dirs.reshape(-1, 3))
    O = to_planner_points(np.asarray(station["t"], float))
    t, which = cast(O, D, lamp=True)
    return colours(O, D, t, which).reshape(shape)


def distance(origin, dirs):
    """synth.write_depth_maps callback: the mesh's distance (the lamp is not in the mesh)."""
    shape = dirs.shape[:-1]
    t, which = cast(to_planner_points(origin), to_planner_dirs(dirs.reshape(-1, 3)))
    return np.where(which >= 0, t, 1000.0).reshape(shape)


def render_view(view):
    """A view as render.mjs draws it in position mode: (h, w, 4) float32, rows from the bottom,
    plus the albedo (h, w, 3) and the rectangle hit (h, w), rows from the bottom."""
    eye, target, up = (np.asarray(view[k], float) for k in ("eye", "target", "up"))
    zc = eye - target
    zc /= np.linalg.norm(zc)
    xc = np.cross(up, zc)
    xc /= np.linalg.norm(xc)
    yc = np.cross(zc, xc)
    w, h = view["pixels"]
    sw, sh = view["size"]
    X, Y = np.meshgrid(((np.arange(w) + 0.5) / w - 0.5) * sw, ((np.arange(h) + 0.5) / h - 0.5) * sh)
    O = eye + X[..., None] * xc + Y[..., None] * yc
    Op = to_planner_points(O.reshape(-1, 3))
    Dp = np.broadcast_to(to_planner_dirs(-zc), Op.shape).copy()
    t, which = cast(Op, Dp, tmin=view["near"], tmax=view["far"])
    hit = which >= 0
    P = np.zeros((len(Op), 4), np.float32)
    P[hit, :3] = to_e57_points(Op[hit] + t[hit, None] * Dp[hit])
    P[hit, 3] = 1.0
    alb = colours(Op, Dp, t, which)
    return P.reshape(h, w, 4), alb.reshape(h, w, 3), which.reshape(h, w)

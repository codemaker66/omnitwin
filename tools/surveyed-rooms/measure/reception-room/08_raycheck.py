"""The independent check: a second method on a different sample of the mesh.

The first method fitted lines to plan sections at fixed heights and read heights off a raster of sampled
triangles. This one casts rays:
  1. tape lines: a pair of opposite horizontal rays from a point in the room, wall to wall, at 1.0 and
     1.5 m, for each main dimension (no fit at all);
  2. station fans: from every station in the room, rays every degree of azimuth at five pitches; the hits
     on each wall (wherever between 0.4 and 2.0 m they land) fitted with a robust line, compared with
     04_wall_fits.py;
  3. plumb lines: rays straight down and up on a 0.2 m grid; the floor's plane, and each ceiling part's
     height, compared with 02_floor_ceiling.py and 06_plan_features.py."""
import json
import numpy as np
from rlib import OUT, FLOOR_Z, WALLS, room_mesh, stations, cast, near_rays, subset, robust_mean

M = room_mesh()
a, b, c, nn, area, cen = M
fits = json.load(open(OUT + "/scripts/wall_fits.json"))["wall"]
out = {"tapes": [], "walls": {}, "heights": {}}


def tape(p, axis):
    """Distance wall to wall through p along E57 X (axis 0) or Y (axis 1): (length, low end, high end)."""
    d = np.zeros((2, 3))
    d[0, axis], d[1, axis] = -1, 1
    o = np.array([p, p], float)
    T, _ = cast(subset(M, near_rays(M, o, d, 14.0, 0.02)), o, d, 14.0)
    return T[0] + T[1], p[axis] - T[0], p[axis] + T[1]


print("1. tape lines (wall to wall, no fit)")
TAPES = [
    ("window part width (west wall to east wall)", 0, [(16.0, y) for y in (9.0, 9.6, 10.2, 10.8, 11.4, 12.0, 12.4)], ("west_outer", "east_outer")),
    ("inner part width (west wall to east wall)", 0, [(16.5, y) for y in (3.4, 4.0, 4.4, 5.0, 5.8, 6.4, 6.8)], ("west_inner", "east_inner")),
    ("window part depth at the west end (stub to window wall)", 1, [(11.42, 10.0), (11.50, 10.0), (11.56, 10.0)], ("stub_west", "north")),
    ("inner part depth, east (south wall to the pier)", 1, [(19.4, 4.0), (19.6, 4.0), (19.8, 4.0)], ("south_east", "box_south")),
    # No line runs from the bare window wall (X 11.26..11.60) to the south wall: the stub wall is in the way.
    # This one ends on a sheer fold hanging in the wall's plane, so it is a lower bound on the length.
    ("length by the west side, wardrobe doors to a sheer fold at the window wall", 1, [(12.77, 10.0), (12.80, 10.0)], ("south_west", "north")),
]
for name, axis, pts, (wa, wb) in TAPES:
    for h in (1.0, 1.5):
        rows = [tape((x, y, FLOOR_Z + h), axis) for x, y in pts]
        L = np.array([r[0] for r in rows])
        # the first method's figure on the same line: each wall's fitted line at this position
        exp = []
        for (x, y) in pts:
            s = (y, x)[axis]
            ends = [fits[w]["offset_at_mid"] + fits[w]["slope"] * (s - fits[w]["s_mid"]) for w in (wa, wb)]
            exp.append(ends[1] - ends[0])
        diff = (L - np.array(exp)) * 1000
        print("  %-68s v %.1f: %s   fits %.3f..%.3f   diff mm %s" % (
            name, h, " ".join("%.3f" % v for v in L), min(exp), max(exp), " ".join("%+.0f" % v for v in diff)))
        out["tapes"].append(dict(name=name, v=h, lengths=[float(v) for v in L], fitted=[float(v) for v in exp]))

print("\n2. station fans: hits on each wall, robust line, against the plan-section fit")
S, _ = stations()
vert = (np.abs(nn[:, 2]) < 0.7) & (cen[:, 2] > FLOOR_Z - 0.2) & (cen[:, 2] < FLOOR_Z + 3.4)
MV = subset(M, vert)
az = np.radians(np.arange(0, 360, 1.0) + 0.25)
hits, hn = [], []
for sid in range(123, 145):
    t = S[sid]["t"]
    for pitch in np.radians((-16, -8, 0, 8, 16)):
        d = np.stack([np.cos(az) * np.cos(pitch), np.sin(az) * np.cos(pitch), np.full_like(az, np.sin(pitch))], 1)
        T, K = cast(MV, t, d, 14.0)
        ok = np.isfinite(T)
        hits.append(t + d[ok] * T[ok, None])
        hn.append(MV[3][K[ok]])
H = np.concatenate(hits)
HN = np.concatenate(hn)
print("  %d hits from 22 stations" % len(H))
print("  wall              hits   offset   angle    rms    section fit   diff")
for name, (axis, off, ranges) in WALLS.items():
    o = 1 - axis
    m = (np.abs(H[:, axis] - off) < 0.05) & (np.abs(HN[:, axis]) > 0.9) & (H[:, 2] > FLOOR_Z + 0.4) & (H[:, 2] < FLOOR_Z + 2.0)
    mr = np.zeros(len(H), bool)
    for lo, hi in ranges:
        mr |= (H[:, o] > lo) & (H[:, o] < hi)
    m &= mr
    if m.sum() < 12 or name not in fits:
        print("  %-16s %5d   too few hits or no section fit" % (name, m.sum()))
        continue
    s, t_ = H[m, o], H[m, axis]
    f = fits[name]
    s0 = f["s_mid"]
    A = np.c_[np.ones(m.sum()), s - s0]
    w = np.ones(m.sum())
    for _ in range(30):
        co = np.linalg.lstsq(A * np.sqrt(w)[:, None], t_ * np.sqrt(w), rcond=None)[0]
        u = (t_ - A @ co) / 0.02
        w = np.where(np.abs(u) < 1, (1 - u * u) ** 2, 1e-9)
    r = t_ - A @ co
    inl = np.abs(r) < 0.02
    rms = float(np.sqrt((r[inl] ** 2).mean()) * 1000)
    ang = float(np.degrees(np.arctan(co[1])))
    diff = (co[0] - f["offset_at_mid"]) * 1000
    print("  %-16s %5d  %7.3f  %+6.2f  %5.1f    %7.3f %+6.2f  %+5.1f mm" % (name, m.sum(), co[0], ang, rms, f["offset_at_mid"], f["angle_deg"], diff))
    out["walls"][name] = dict(hits=int(m.sum()), offset=float(co[0]), angle_deg=ang, rms_mm=rms, diff_mm=float(diff))

print("\n3. plumb lines on a 0.2 m grid")
gx, gy = np.meshgrid(np.arange(11.5, 20.81, 0.2), np.arange(1.7, 13.31, 0.2))
G = np.stack([gx.ravel(), gy.ravel(), np.full(gx.size, FLOOR_Z + 1.3)], 1)
inside = ((G[:, 1] > 7.75) | ((G[:, 0] > 12.85) & (G[:, 0] < 19.9)))
G = G[inside]
MF = subset(M, (nn[:, 2] > 0.5) & (cen[:, 2] < FLOOR_Z + 0.6) & (cen[:, 2] > FLOOR_Z - 0.6))
MC = subset(M, (nn[:, 2] < -0.3) & (cen[:, 2] > FLOOR_Z + 1.7))
TD, _ = cast(MF, G, np.tile([0, 0, -1.0], (len(G), 1)), 3.0)
TU, _ = cast(MC, G, np.tile([0, 0, 1.0], (len(G), 1)), 4.0)
fz = G[:, 2] - TD
cz = G[:, 2] + TU - FLOOR_Z
ok = np.isfinite(fz) & (np.abs(fz - FLOOR_Z) < 0.06)
A = np.c_[G[ok, 0], G[ok, 1], np.ones(ok.sum())]
co = np.linalg.lstsq(A, fz[ok], rcond=None)[0]
r = fz[ok] - A @ co
print("  floor from %d plumb lines: Z = %.4f %+.5f X %+.5f Y, rms %.1f mm; at the origin (16.06, 7.36): %.4f" % (ok.sum(), co[2], co[0], co[1], np.sqrt((r ** 2).mean()) * 1000, co @ [16.06, 7.36, 1]))
out["floor"] = dict(plane=[float(v) for v in co], rms_mm=float(np.sqrt((r ** 2).mean()) * 1000), atOrigin=float(co @ [16.06, 7.36, 1]))
# ceiling parts: rectangles well inside each part (06_plan_features.py), X0 X1 Y0 Y1
PARTS = {
    "window-field": (11.9, 20.3, 8.2, 13.0),
    "coffer-west": (13.0, 14.3, 3.6, 6.7),
    "coffer-east": (15.3, 17.9, 3.6, 6.7),
    "soffit-junction": (13.0, 19.0, 7.05, 7.45),
    "soffit-east": (18.4, 19.8, 3.0, 6.9),
    "soffit-between-coffers": (14.62, 14.92, 3.6, 6.7),
    "soffit-south-strip": (13.0, 17.9, 1.75, 2.6),
}
print("  part                       lines  ceiling above FLOOR_Z (rms)   clear height above the floor under it (min..max)")
for name, (x0, x1, y0, y1) in PARTS.items():
    m = (G[:, 0] > x0) & (G[:, 0] < x1) & (G[:, 1] > y0) & (G[:, 1] < y1) & np.isfinite(cz) & np.isfinite(fz)
    if m.sum() < 3:
        print("  %-26s too few" % name)
        continue
    v, rms, inl = robust_mean(cz[m], c=0.03)
    clear = (cz[m] + FLOOR_Z) - fz[m]
    k = np.abs(cz[m] - v) < 0.03
    print("  %-26s %4d   %.3f (%.1f mm, %.2f in)   %.3f..%.3f" % (name, m.sum(), v, rms * 1000, inl, clear[k].min(), clear[k].max()))
    out["heights"][name] = dict(lines=int(m.sum()), ceiling=v, rms_mm=rms * 1000, clear=[float(clear[k].min()), float(clear[k].max())])
json.dump(out, open(OUT + "/scripts/raycheck.json", "w"), indent=1)

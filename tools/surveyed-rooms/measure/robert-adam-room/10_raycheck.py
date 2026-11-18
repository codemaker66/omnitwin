"""The independent check: a second method on a different sample of the mesh (no sections, no rasters).

  1. Tape lines: pairs of opposite horizontal rays from a point in the room, wall to wall, for each main
     dimension; set against the fitted faces of 05_wall_fits.py at the same place.
  2. Station fans: from every station in the room, rays every 1.5 degrees of azimuth at four pitches; the
     hits on each face fitted with a robust line and set against the plan-section fit.
  3. Plumb lines on a 0.2 m grid: each floor's plane; each ceiling part's height.
  4. The steps: plumb lines every centimetre up three lines of the flight (tread levels, riser places),
     and level rays at the middle of each riser (its face, no fit).

    python -X utf8 10_raycheck.py"""
import importlib
import json
import numpy as np
from ralib import OUT, FLOOR_LO, FLOOR_UP, room_mesh, stations, cast, near_rays, subset, robust_mean, fit_line

M = room_mesh()
a, b, c, nn, area, cen = M
FACES = importlib.import_module("05_wall_fits").FACES
fits = json.load(open(OUT + "/scripts/wall_fits.json"))
out = {"tapes": [], "walls": {}, "heights": {}, "steps": {}}


def line_at(name, s):
    f = fits[name]
    return f["offset_at_mid"] + f["slope"] * (s - f["s_mid"])


def tape(p, axis):
    d = np.zeros((2, 3))
    d[0, axis], d[1, axis] = -1, 1
    o = np.array([p, p], float)
    T, _ = cast(subset(M, near_rays(M, o, d, 16.0, 0.02)), o, d, 16.0)
    return T[0] + T[1], p[axis] - T[0], p[axis] + T[1]


print("1. tape lines (wall to wall, no fit); heights above each section's own floor")
TAPES = [
    # name, axis, points (X, Y), floor, heights, (low face, high face)
    ("lower section, west wall to east wall", 0, [(0.0, y) for y in (-6.9, -7.2, -7.5, -7.8)], FLOOR_LO, (0.6, 0.9), ("west", "east_south")),
    ("lower section, west wall to the wall north of the lobby door", 0, [(0.0, y) for y in (-3.45, -3.6, -3.75)], FLOOR_LO, (0.6, 0.9), ("west", "east_north")),
    ("lower section, door wall to the north-east wall", 0, [(0.0, y) for y in (-1.7, -1.9, -2.1)], FLOOR_LO, (0.6, 0.9), ("door_wall_west", "ne_east")),
    ("west bay, west wall to the pier", 0, [(-4.4, y) for y in (-8.9, -9.4, -9.9)], FLOOR_LO, (0.6, 0.9), ("west", "pier_w_west")),
    ("between the piers", 0, [(0.0, y) for y in (-8.8, -9.3, -9.8)], FLOOR_LO, (0.6, 0.9), ("pier_w_east", "pier_e_west")),
    ("east bay, pier to the east wall", 0, [(4.6, y) for y in (-8.6, -9.0, -9.4)], FLOOR_LO, (0.6, 0.9), ("pier_e_east", "east_south")),
    ("entrance recess, side to side", 0, [(0.0, y) for y in (-10.6, -10.9, -11.2)], FLOOR_LO, (1.5, 1.8), ("recess_west", "recess_east")),
    ("east aisle, window glass to the back wall", 1, [(x, -6.0) for x in (3.6, 3.9, 4.2)], FLOOR_LO, (0.8, 1.0), ("glass_e", "back_east")),
    # further west a plant stands in the line (X -6.0..-5.4 by the window)
    ("west aisle, window glass to the north-west step", 1, [(x, -6.0) for x in (-5.2, -5.05, -4.9)], FLOOR_LO, (0.8, 1.0), ("glass_w", "nw_step")),
    ("alcove, mirror wall to mirror wall", 0, [(0.0, y) for y in (-0.75, -0.65)], FLOOR_LO, (2.15, 2.3), ("alcove_west_mirror", "alcove_east_mirror")),
    ("arch to the steps, jamb to jamb", 0, [(0.0, y) for y in (0.47, 0.55)], FLOOR_UP, (1.0, 1.5), ("arch_jamb_west_lining", "arch_jamb_east_lining")),
    ("west pier's end to the block", 1, [(x, -5.0) for x in (-2.6, -2.3, -2.0)], FLOOR_LO, (0.6, 0.9), ("pier_w_north", "block_south")),
    ("east pier's end to the east pilaster", 1, [(x, -5.0) for x in (1.95, 2.25, 2.55)], FLOOR_LO, (0.6, 0.9), ("pier_e_north", "pilaster_east")),
    ("south-east return to the lobby door's casing", 1, [(x, -8.0) for x in (5.6, 5.9, 6.15)], FLOOR_LO, (0.6, 0.9), ("se_return", "door_south")),
    ("upper section, west wall to east wall", 0, [(-3.0, y) for y in (6.6, 7.0, 7.4, 9.9)], FLOOR_UP, (1.0, 1.5), ("west_north", "east")),
    ("upper section, narrow part, west wall to east wall", 0, [(-2.0, y) for y in (5.2, 5.45, 5.65)], FLOOR_UP, (1.0, 1.5), ("west_south", "east")),
    ("lobby, west wall to the screen wall's north tail", 0, [(-2.0, y) for y in (2.5, 2.7, 2.9)], FLOOR_UP, (1.0, 1.5), ("lobby_west", "curve_tail_north")),
    ("upper section, lobby's south wall to the north wall", 1, [(x, 6.0) for x in (-2.9, -2.6, -1.6)], FLOOR_UP, (1.0, 1.5), ("lobby_south", "north")),
    ("upper section, west return to the north wall", 1, [(x, 8.0) for x in (-5.0, -4.7, -4.4)], FLOOR_UP, (1.7, 1.9), ("west_return", "north")),
]
for name, axis, pts, fz, hs, (wa, wb) in TAPES:
    for h in hs:
        L = np.array([tape((x, y, fz + h), axis)[0] for x, y in pts])
        exp = np.array([line_at(wb, (y, x)[axis]) - line_at(wa, (y, x)[axis]) for x, y in pts])
        diff = (L - exp) * 1000
        print("  %-58s %.1f: %s  fitted %s  diff mm %s" % (name, h, " ".join("%.3f" % v for v in L), " ".join("%.3f" % v for v in exp), " ".join("%+.0f" % v for v in diff)))
        out["tapes"].append(dict(name=name, h=h, lengths=[float(v) for v in L], fitted=[float(v) for v in exp]))

print("\n2. station fans: hits on each face, robust line, against the plan-section fit")
S, _ = stations()
LOWER = [86, 87, 88] + list(range(94, 112)) + [113]
UPPER = [112] + list(range(114, 121))
az = np.radians(np.arange(0, 360, 1.5) + 0.4)
hits, hn = [], []
for group, ylim in ((LOWER, (-13.0, 1.6)), (UPPER, (-0.3, 13.0))):
    sel = (np.abs(nn[:, 2]) < 0.7) & (cen[:, 1] > ylim[0]) & (cen[:, 1] < ylim[1]) & (cen[:, 2] > FLOOR_LO - 0.2) & (cen[:, 2] < FLOOR_LO + 3.4)
    MV = subset(M, sel)
    for sid in group:
        t = S[sid]["t"]
        for pitch in np.radians((-28, -18, -9, 0)):
            d = np.stack([np.cos(az) * np.cos(pitch), np.sin(az) * np.cos(pitch), np.full_like(az, np.sin(pitch))], 1)
            T, K = cast(MV, t, d, 16.0)
            ok = np.isfinite(T)
            hits.append(t + d[ok] * T[ok, None])
            hn.append(MV[3][K[ok]])
H = np.concatenate(hits)
HN = np.concatenate(hn)
print("  %d hits from %d stations" % (len(H), len(LOWER) + len(UPPER)))
print("  face                    hits   offset   angle    rms    section fit        diff")
worst = 0.0
for name, (axis, off, runs, levels) in FACES.items():
    if name not in fits:
        continue
    f = fits[name]
    o = 1 - axis
    pred = f["offset_at_mid"] + f["slope"] * (H[:, o] - f["s_mid"])
    m = (np.abs(H[:, axis] - pred) < 0.05) & (np.abs(HN[:, axis]) > 0.9) & (H[:, 2] > min(levels) - 0.12) & (H[:, 2] < max(levels) + 0.12)
    mr = np.zeros(len(H), bool)
    for lo, hi in runs:
        mr |= (H[:, o] > lo) & (H[:, o] < hi)
    m &= mr
    if m.sum() < 12:
        print("  %-22s %5d   too few hits" % (name, m.sum()))
        continue
    g = fit_line(H[m, o], H[m, axis])
    at_mid = g["offset_at_mid"] + g["slope"] * (f["s_mid"] - g["s_mid"])
    diff = (at_mid - f["offset_at_mid"]) * 1000
    worst = max(worst, abs(diff)) if f["support"] > 0.5 else worst
    print("  %-22s %5d  %7.3f  %+6.2f  %5.1f    %7.3f %+6.2f   %+5.1f mm" % (name, m.sum(), at_mid, g["angle_deg"], g["rms_mm"], f["offset_at_mid"], f["angle_deg"], diff))
    out["walls"][name] = dict(hits=int(m.sum()), offset=float(at_mid), angle_deg=g["angle_deg"], rms_mm=g["rms_mm"], diff_mm=float(diff))
print("  largest difference over the faces with more than 0.5 m of section per level: %.1f mm" % worst)

print("\n3. plumb lines on a 0.2 m grid")
MF = subset(M, (nn[:, 2] > 0.5) & (cen[:, 2] < FLOOR_UP + 0.5))
MC = subset(M, (nn[:, 2] < -0.3) & (cen[:, 2] > FLOOR_LO + 1.9))


def plumb(G):
    TD, _ = cast(MF, G, np.tile([0, 0, -1.0], (len(G), 1)), 3.5)
    TU, _ = cast(MC, G, np.tile([0, 0, 1.0], (len(G), 1)), 4.0)
    return G[:, 2] - TD, G[:, 2] + TU


for name, fz, (x0, x1, y0, y1), origin in (("lower floor", FLOOR_LO, (-5.8, 6.4, -10.2, -1.7), (-0.2, -6.3)),
                                             ("upper floor", FLOOR_UP, (-5.4, 0.0, 1.6, 11.2), (-2.8, 6.4))):
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1e-6, 0.2), np.arange(y0, y1 + 1e-6, 0.2))
    G = np.stack([gx.ravel(), gy.ravel(), np.full(gx.size, fz + 1.3)], 1)
    fzs, czs = plumb(G)
    ok = np.isfinite(fzs) & (np.abs(fzs - fz) < 0.06)
    A = np.c_[G[ok, 0], G[ok, 1], np.ones(ok.sum())]
    co = np.linalg.lstsq(A, fzs[ok], rcond=None)[0]
    r = fzs[ok] - A @ co
    at = float(co @ [origin[0], origin[1], 1])
    print("  %s from %d plumb lines: Z = %.4f %+.5f X %+.5f Y, rms %.1f mm; at (%.1f, %.1f): %.4f" % (name, ok.sum(), co[2], co[0], co[1], np.sqrt((r ** 2).mean()) * 1000, origin[0], origin[1], at))
    out["heights"][name] = dict(plane=[float(v) for v in co], rms_mm=float(np.sqrt((r ** 2).mean()) * 1000), at=at)

PARTS = {
    # name: (X0, X1, Y0, Y1, floor)
    "beam N-S west": (-2.85, -1.80, -8.00, -1.70, FLOOR_LO), "beam N-S east": (1.65, 2.75, -8.00, -1.70, FLOOR_LO),
    "beam E-W west, south": (-5.90, -3.10, -6.72, -6.43, FLOOR_LO), "beam E-W east, south": (2.90, 5.30, -6.72, -6.43, FLOOR_LO),
    "panel centre": (-1.40, 1.35, -6.10, -3.60, FLOOR_LO), "panel west main": (-5.80, -3.15, -6.10, -3.55, FLOOR_LO),
    "panel east main": (3.00, 5.10, -6.10, -3.55, FLOOR_LO), "panel alcove": (-1.50, 1.40, -0.95, 0.15, FLOOR_LO),
    "west bay": (-5.80, -3.00, -10.20, -8.40, FLOOR_LO), "east bay": (2.95, 6.40, -9.80, -8.40, FLOOR_LO),
    "entrance recess": (-1.40, 1.10, -11.20, -10.00, FLOOR_LO), "lift bay": (-4.40, -3.10, -1.30, -0.10, FLOOR_LO),
    "upper raised field, north": (-4.40, -1.05, 6.30, 10.15, FLOOR_UP), "upper raised field, south": (-2.85, -1.05, 3.30, 6.00, FLOOR_UP),
    "upper border, north": (-5.30, -0.10, 10.45, 11.15, FLOOR_UP), "upper border, east": (-0.80, 0.00, 3.30, 9.80, FLOOR_UP),
    "upper lobby": (-3.90, -0.20, 1.60, 2.90, FLOOR_UP), "landing by the steps": (-1.20, 1.05, 0.75, 1.15, FLOOR_UP),
}
print("  part                         lines  ceiling above its floor level (rms)   clear height under it (min..max)")
for name, (x0, x1, y0, y1, fz) in PARTS.items():
    gx, gy = np.meshgrid(np.arange(x0 + 0.05, x1, 0.2), np.arange(y0 + 0.05, y1, 0.2))
    G = np.stack([gx.ravel(), gy.ravel(), np.full(gx.size, fz + 1.3)], 1)
    fzs, czs = plumb(G)
    ok = np.isfinite(fzs) & np.isfinite(czs)
    v, rms, inl = robust_mean(czs[ok] - fz, c=0.03)
    k = np.abs(czs[ok] - fz - v) < 0.03
    clear = (czs[ok] - fzs[ok])[k]
    print("  %-28s %4d   %.3f (%.1f mm, %.2f in)   %.3f..%.3f" % (name, ok.sum(), v, rms * 1000, inl, clear.min(), clear.max()))
    out["heights"][name] = dict(lines=int(ok.sum()), ceiling=v, rms_mm=rms * 1000, clear=[float(clear.min()), float(clear.max())])

print("\n4. the steps")
print("  plumb lines every centimetre along Y at three X: tread levels (E57 Z) and where the level changes")
for x0 in (-0.9, 0.0, 0.9):
    ys = np.arange(-0.95, 0.75, 0.01)
    G = np.stack([np.full_like(ys, x0), ys, np.full_like(ys, FLOOR_UP + 0.6)], 1)
    fzs, _ = plumb(G)
    lev, edges, i = [], [], 0
    while i < len(ys):
        j = i
        while j + 1 < len(ys) and np.isfinite(fzs[j + 1]) and np.isfinite(fzs[i]) and abs(fzs[j + 1] - fzs[i]) < 0.03:
            j += 1
        if j - i >= 5:
            lev.append(float(np.median(fzs[i:j + 1])))
            edges.append((float(ys[i]), float(ys[j])))
        i = j + 1
    print("  X %+.1f  levels %s" % (x0, "  ".join("%.3f" % v for v in lev)))
    print("          risers at Y %s   rises %s" % ("  ".join("%.3f" % ((edges[k][1] + edges[k + 1][0]) / 2) for k in range(len(edges) - 1)),
                                                 "  ".join("%.3f" % (lev[k + 1] - lev[k]) for k in range(len(lev) - 1))))
    out["steps"]["plumb %+.1f" % x0] = dict(levels=lev, edges=edges)
print("  level rays northwards at the middle of each riser (its face, no fit)")
mids = [(-3.502, "riser 1"), (-3.359, "riser 2"), (-3.217, "riser 3"), (-3.064, "riser 4")]
MR = subset(M, (cen[:, 0] > -2.2) & (cen[:, 0] < 2.0) & (cen[:, 1] > -1.6) & (cen[:, 1] < 2.0) & (cen[:, 2] < -2.7))
for z, name in mids:
    xs = np.array([-1.0, -0.5, 0.0, 0.5, 1.0])
    o = np.stack([xs, np.full_like(xs, -1.2), np.full_like(xs, z)], 1)
    T, _ = cast(MR, o, np.tile([0, 1.0, 0], (len(xs), 1)), 4.0)
    print("  %s at Z %.3f: Y %s" % (name, z, "  ".join("%.3f" % (-1.2 + t) for t in T)))
    out["steps"][name] = [float(-1.2 + t) for t in T]
json.dump(out, open(OUT + "/scripts/raycheck.json", "w"), indent=1)

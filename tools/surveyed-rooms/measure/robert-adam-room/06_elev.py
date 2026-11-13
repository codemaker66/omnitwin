"""Depth rasters of a wall (2 cm), from sampled triangles, with profiles: openings' edges, sills and heads.

    06_elev.py make <name> <X|Y> <face> <+|-> <along0> <along1> <z0> <z1> [res] [front]
        the wall face X = face or Y = face, seen from the side given (+: the room is at larger coordinate),
        between along0 and along1 (the other E57 axis) and E57 Z z0..z1. For each cell the surface nearest
        the room is kept, no nearer than `front` (default 0.6 m) in front of the face. Depth is metres
        behind the face.
    06_elev.py row <name> <z> [a0 a1]      depth along the wall at height z, as runs of equal depth
    06_elev.py col <name> <along> [z0 z1]  depth up the wall at one place, as runs of equal depth

Heights are E57 Z; the pictures label them so."""
import sys
import json
import numpy as np
from ralib import OUT, room_mesh, tri_points, grid_png


def make(name, axis, face, sign, a0, a1, z0, z1, res=0.02, front=0.6, back=1.6):
    M = room_mesh()
    a, b, c, nn, area, cen = M
    ax = 0 if axis == "X" else 1
    o = 1 - ax
    s = 1.0 if sign == "+" else -1.0
    dcen = s * (face - cen[:, ax])
    sel = (dcen > -front - 0.3) & (dcen < back + 0.3) & (cen[:, o] > a0 - 0.3) & (cen[:, o] < a1 + 0.3) & (cen[:, 2] > z0 - 0.3) & (cen[:, 2] < z1 + 0.3)
    W, H = int(round((a1 - a0) / res)), int(round((z1 - z0) / res))
    D = np.full((H, W), np.inf)
    for pts, _ in tri_points(a[sel], b[sel], c[sel], step=res / 2):
        d = s * (face - pts[:, ax])
        ix = ((pts[:, o] - a0) / res).astype(int)
        iy = ((z1 - pts[:, 2]) / res).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H) & (d > -front) & (d < back)
        np.minimum.at(D, (iy[ok], ix[ok]), d[ok])
    D[~np.isfinite(D)] = np.nan
    np.save(OUT + "/scripts/elev_%s.npy" % name, D)
    json.dump(dict(axis=axis, face=face, sign=sign, a0=a0, a1=a1, z0=z0, z1=z1, res=res), open(OUT + "/scripts/elev_%s.json" % name, "w"))
    # the picture: columns along the wall in increasing coordinate, rows from z1 down; grid in the along
    # coordinate and E57 Z (grid_png labels them X and Y)
    grid_png(D, -0.25, 1.0, a0, z1, res, 3, OUT + "/img/elev_%s.png" % name,
             "%s: wall %s = %.3f seen from %s; depth -0.25 (blue) .. 1.0 m (red) behind the face; columns: E57 %s, rows: E57 Z" % (
                 name, axis, face, sign, "YX"[ax]), step=0.5)
    print(name, D.shape, "finite %.2f" % np.isfinite(D).mean())


def runs(vals, coords, tol=0.025, minlen=3):
    out, i = [], 0
    n = len(vals)
    while i < n:
        if not np.isfinite(vals[i]):
            j = i
            while j + 1 < n and not np.isfinite(vals[j + 1]):
                j += 1
            if j - i + 1 >= minlen:
                out.append((coords[i], coords[j], None))
            i = j + 1
            continue
        j = i
        while j + 1 < n and np.isfinite(vals[j + 1]) and abs(vals[j + 1] - np.median(vals[i:j + 1])) < tol:
            j += 1
        if j - i + 1 >= minlen:
            out.append((coords[i], coords[j], float(np.median(vals[i:j + 1]))))
        i = j + 1
    return out


def load(name):
    return np.load(OUT + "/scripts/elev_%s.npy" % name), json.load(open(OUT + "/scripts/elev_%s.json" % name))


if __name__ == "__main__":
    a = sys.argv
    if a[1] == "make":
        make(a[2], a[3], float(a[4]), a[5], float(a[6]), float(a[7]), float(a[8]), float(a[9]),
             float(a[10]) if len(a) > 10 else 0.02, float(a[11]) if len(a) > 11 else 0.6)
    elif a[1] in ("row", "col"):
        D, m = load(a[2])
        res = m["res"]
        H, W = D.shape
        if a[1] == "row":
            z = float(a[3])
            iy = int((m["z1"] - z) / res)
            coords = m["a0"] + (np.arange(W) + 0.5) * res
            vals = np.nanmedian(D[max(iy - 1, 0):iy + 2], axis=0) if True else D[iy]
            lo, hi = (float(a[4]), float(a[5])) if len(a) > 5 else (m["a0"], m["a1"])
            k = (coords >= lo) & (coords <= hi)
            for p, q, v in runs(vals[k], coords[k]):
                print("  %7.2f..%7.2f  %s" % (p - res / 2, q + res / 2, "nothing" if v is None else "%.3f" % v))
        else:
            s = float(a[3])
            ix = int((s - m["a0"]) / res)
            coords = m["z1"] - (np.arange(H) + 0.5) * res
            vals = np.nanmedian(D[:, max(ix - 1, 0):ix + 2], axis=1)
            lo, hi = (float(a[4]), float(a[5])) if len(a) > 5 else (m["z0"], m["z1"])
            k = (coords >= lo) & (coords <= hi)
            for p, q, v in runs(vals[k], coords[k]):
                print("  Z %7.2f..%7.2f  %s" % (q - res / 2, p + res / 2, "nothing" if v is None else "%.3f" % v))

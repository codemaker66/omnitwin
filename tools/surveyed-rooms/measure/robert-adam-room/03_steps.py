"""The steps, from vertical sections of the mesh (no raster): each tread's level and each riser's line.

Sections along E57 Y at several X give the profile (riser positions, tread levels); sections along X at
several Y give where each tread ends sideways (the plinths either side). Risers are the near-vertical
pieces, treads the near-level ones.

    python -X utf8 03_steps.py"""
import json
import numpy as np
from ralib import OUT, room_mesh, vslice

M = room_mesh()
out = {"profiles": {}, "ends": {}}


def pieces(segs, s0, s1, z0=-3.70, z1=-2.90):
    """Near-vertical and near-level pieces of a section between s0 and s1: lists of (position, from, to, length)."""
    p, q = segs[:, 0], segs[:, 1]
    mid = (p + q) / 2
    keep = (mid[:, 0] > s0) & (mid[:, 0] < s1) & (mid[:, 1] > z0) & (mid[:, 1] < z1)
    p, q = p[keep], q[keep]
    d = q - p
    L = np.linalg.norm(d, axis=1)
    vert = np.abs(d[:, 0]) < 0.25 * L
    flat = np.abs(d[:, 1]) < 0.25 * L
    return (p[vert], q[vert], L[vert]), (p[flat], q[flat], L[flat])


def cluster(pos, w, lo, hi, tol=0.03):
    """Weighted clusters of positions: (mean, total weight, lo, hi)."""
    o = np.argsort(pos)
    pos, w, lo, hi = pos[o], w[o], lo[o], hi[o]
    groups, start = [], 0
    for i in range(1, len(pos) + 1):
        if i == len(pos) or pos[i] - pos[i - 1] > tol:
            s = slice(start, i)
            groups.append((float(np.average(pos[s], weights=w[s])), float(w[s].sum()), float(lo[s].min()), float(hi[s].max())))
            start = i
    return groups


print("profiles along Y (risers: Y of each face and the Z it spans; treads: Z and the Y it spans)")
for x0 in (-1.1, -0.8, -0.4, 0.3, 0.7, 1.0):
    segs, _ = vslice(M, 0, x0)
    (vp, vq, vl), (fp, fq, fl) = pieces(segs, -0.9, 0.7)
    ris = [g for g in cluster((vp[:, 0] + vq[:, 0]) / 2, vl, np.minimum(vp[:, 1], vq[:, 1]), np.maximum(vp[:, 1], vq[:, 1])) if g[1] > 0.06]
    tre = [g for g in cluster((fp[:, 1] + fq[:, 1]) / 2, fl, np.minimum(fp[:, 0], fq[:, 0]), np.maximum(fp[:, 0], fq[:, 0]), tol=0.02) if g[1] > 0.12]
    print("  X %+.1f  risers: %s" % (x0, "  ".join("Y %.3f (Z %.3f..%.3f)" % (g[0], g[2], g[3]) for g in ris)))
    print("          treads: %s" % "  ".join("Z %.3f (Y %.3f..%.3f)" % (g[0], g[2], g[3]) for g in tre))
    out["profiles"]["%+.1f" % x0] = dict(risers=ris, treads=tre)

print("\nsections along X (side faces: X of each and the Z it spans; levels: Z and the X it spans)")
for y0 in (-0.60, -0.40, -0.10, 0.20, 0.30, 0.60, 1.00):
    segs, _ = vslice(M, 1, y0)
    (vp, vq, vl), (fp, fq, fl) = pieces(segs, -2.0, 1.9)
    sid = [g for g in cluster((vp[:, 0] + vq[:, 0]) / 2, vl, np.minimum(vp[:, 1], vq[:, 1]), np.maximum(vp[:, 1], vq[:, 1])) if g[1] > 0.06]
    lev = [g for g in cluster((fp[:, 1] + fq[:, 1]) / 2, fl, np.minimum(fp[:, 0], fq[:, 0]), np.maximum(fp[:, 0], fq[:, 0]), tol=0.02) if g[1] > 0.12]
    print("  Y %+.2f  faces: %s" % (y0, "  ".join("X %.3f (Z %.3f..%.3f)" % (g[0], g[2], g[3]) for g in sid)))
    print("          levels: %s" % "  ".join("Z %.3f (X %.3f..%.3f)" % (g[0], g[2], g[3]) for g in lev))
    out["ends"]["%+.2f" % y0] = dict(faces=sid, levels=lev)
json.dump(out, open(OUT + "/scripts/steps.json", "w"), indent=1)

"""Candidate wall faces: where the plan sections' near-vertical faces pile up.

For each section of the room, points every 1 cm along the plan sections at several heights in the plain
wall band; those whose normal lies within 15 degrees of an E57 axis are binned by their offset across it
(1 cm bins). A peak holding more than `MIN` metres of section per level is listed with the runs it covers.

    python -X utf8 04_wall_peaks.py"""
import numpy as np
from ralib import room_mesh, band_points, FLOOR_LO, FLOOR_UP

M = room_mesh()
MIN = 0.25
PARTS = {
    # name: (X0, X1, Y0, Y1), heights above that part's floor, the floor
    "lower": ((-7.0, 7.6, -12.2, 0.6), (0.6, 0.9, 1.2, 1.5, 1.8), FLOOR_LO),
    "upper": ((-6.2, 2.0, -0.2, 12.0), (0.5, 0.8, 1.1, 1.4, 1.7), FLOOR_UP),
}


def runs(s, gap=0.08):
    s = np.sort(s)
    out, a = [], s[0]
    for i in range(1, len(s)):
        if s[i] - s[i - 1] > gap:
            out.append((a, s[i - 1]))
            a = s[i]
    out.append((a, s[-1]))
    return [(p, q) for p, q in out if q - p > 0.08]


for name, (box, levels, fz) in PARTS.items():
    pts, nrm, zz, ln = band_points(M, [fz + h for h in levels])
    inbox = (pts[:, 0] > box[0]) & (pts[:, 0] < box[1]) & (pts[:, 1] > box[2]) & (pts[:, 1] < box[3])
    pts, nrm, ln = pts[inbox], nrm[inbox], ln[inbox]
    print("== %s section, heights %s above Z %.3f" % (name, levels, fz))
    for axis in (0, 1):
        m = np.abs(nrm[:, axis]) > np.cos(np.radians(15))
        off, along, w = pts[m, axis], pts[m, 1 - axis], ln[m]
        lo = np.floor(off.min() * 100) / 100
        h, e = np.histogram(off, bins=np.arange(lo, off.max() + 0.02, 0.01), weights=w)
        h = h / len(levels)
        k = 0
        while k < len(h):
            if h[k] > MIN / 3:
                j = k
                while j + 1 < len(h) and h[j + 1] > MIN / 3:
                    j += 1
                tot = h[k:j + 1].sum()
                if tot > MIN:
                    sel = (off >= e[k]) & (off < e[j + 1])
                    c = np.average(off[sel], weights=w[sel])
                    rr = runs(along[sel])
                    print("  %s %7.3f  %5.2f m/level  runs %s" % ("XY"[axis], c, tot, " ".join("%.2f..%.2f" % r for r in rr)))
                k = j + 1
            else:
                k += 1

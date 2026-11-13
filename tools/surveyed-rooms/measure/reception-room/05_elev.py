"""Orthographic depth rasters of each wall from the mesh (2 cm): the nearest surface to the room within a
slab about the wall's reference plane, as metres in front of (+) or behind (-) that plane. Columns run in
increasing E57 along-coordinate (X for a wall across Y, Y for a wall across X), rows from the top down.

    05_elev.py                       build every raster and its picture
    05_elev.py h <wall> <v> [s0 s1 step]    depth along the wall at height v (cm)
    05_elev.py v <wall> <s> [v0 v1 step]    depth up the wall at along-coordinate s (cm)

The reference planes are the wall fits of 04_wall_fits.py, rounded to a millimetre."""
import json
import sys
import numpy as np
from rlib import OUT, FLOOR_Z, room_mesh, tri_points, grid_png

RES = 0.02
VR = (-0.1, 3.3)
# wall: axis the plane is across, its coordinate, the room's side (+1: the room lies at larger
# coordinates), the along range, and how far behind / in front of the plane to look.
WALLS = {
    "north": dict(axis="Y", ref=13.56, sign=-1, s=(11.0, 21.1), behind=0.9, front=0.6),
    "south": dict(axis="Y", ref=1.488, sign=1, s=(12.5, 20.2), behind=1.3, front=0.6),
    "west_outer": dict(axis="X", ref=11.27, sign=1, s=(7.4, 13.8), behind=0.6, front=0.6),
    "west_inner": dict(axis="X", ref=12.731, sign=1, s=(0.9, 7.9), behind=1.6, front=0.6),
    "east_outer": dict(axis="X", ref=20.891, sign=-1, s=(7.2, 13.8), behind=0.6, front=0.6),
    "east_inner": dict(axis="X", ref=19.991, sign=-1, s=(1.2, 7.6), behind=0.6, front=0.6),
    "mid_north_facing": dict(axis="Y", ref=7.60, sign=1, s=(11.0, 21.1), behind=0.5, front=0.5),
    "mid_south_facing": dict(axis="Y", ref=7.60, sign=-1, s=(12.5, 20.2), behind=0.5, front=0.6),
}


def build():
    a, b, c, nn, area, cen = room_mesh()
    meta = {}
    for name, w in WALLS.items():
        ax = 0 if w["axis"] == "X" else 1
        al = 1 - ax
        d_c = (cen[:, ax] - w["ref"]) * w["sign"]
        sel = ((d_c > -w["behind"] - 0.4) & (d_c < w["front"] + 0.4) & (cen[:, al] > w["s"][0] - 0.5) & (cen[:, al] < w["s"][1] + 0.5)
               & (nn[:, ax] * w["sign"] > 0.0))
        W = int(round((w["s"][1] - w["s"][0]) / RES))
        H = int(round((VR[1] - VR[0]) / RES))
        depth = np.full((H, W), -np.inf)
        for pts, _ in tri_points(a[sel], b[sel], c[sel], RES * 0.5):
            d = (pts[:, ax] - w["ref"]) * w["sign"]
            col = ((pts[:, al] - w["s"][0]) / RES).astype(int)
            row = ((VR[1] - (pts[:, 2] - FLOOR_Z)) / RES).astype(int)
            ok = (d > -w["behind"]) & (d < w["front"]) & (col >= 0) & (col < W) & (row >= 0) & (row < H)
            np.maximum.at(depth, (row[ok], col[ok]), d[ok])
        depth = np.where(np.isfinite(depth), depth, np.nan)
        np.save(OUT + "/scripts/elev_%s_depth.npy" % name, depth)
        meta[name] = dict(axis=w["axis"], ref=w["ref"], sign=w["sign"], s=list(w["s"]), v=list(VR), res=RES)
        # picture: columns along the wall, rows by height; reuse grid_png with "Y" standing for v
        grid_png(depth, -0.3, 0.3, w["s"][0], VR[1], RES, 3, OUT + "/elev_%s_depth.png" % name,
                 "%s: blue 0.3 m behind .. red 0.3 m in front of %s = %.3f; grid: along (labelled X) and height (labelled Y)" % (name, w["axis"], w["ref"]), 0.5)
        print(name, depth.shape, "coverage %.3f" % np.isfinite(depth).mean())
    json.dump(meta, open(OUT + "/scripts/elev_meta.json", "w"), indent=1)


def load(name):
    meta = json.load(open(OUT + "/scripts/elev_meta.json"))[name]
    return np.load(OUT + "/scripts/elev_%s_depth.npy" % name), meta


def profile(kind, name, at, lo=None, hi=None, step=0.04, band=0.06):
    d, mt = load(name)
    r = mt["res"]
    out = []
    with np.errstate(all="ignore"):
        if kind == "h":
            r0 = int((mt["v"][1] - (at + band / 2)) / r)
            r1 = int((mt["v"][1] - (at - band / 2)) / r) + 1
            seg = np.nanmedian(d[max(r0, 0):r1], axis=0)
            for s in np.arange(mt["s"][0] if lo is None else lo, mt["s"][1] if hi is None else hi, step):
                k = int((s - mt["s"][0]) / r)
                val = seg[k] if 0 <= k < len(seg) else np.nan
                out.append("%.2f:%s" % (s, "  --" if np.isnan(val) else "%+4.0f" % (val * 100)))
        else:
            c0 = int((at - band / 2 - mt["s"][0]) / r)
            c1 = int((at + band / 2 - mt["s"][0]) / r) + 1
            seg = np.nanmedian(d[:, max(c0, 0):c1], axis=1)
            for v in np.arange(-0.05 if lo is None else lo, 3.25 if hi is None else hi, step):
                k = int((mt["v"][1] - v) / r)
                val = seg[k] if 0 <= k < len(seg) else np.nan
                out.append("%.2f:%s" % (v, "  --" if np.isnan(val) else "%+4.0f" % (val * 100)))
    return out


if __name__ == "__main__":
    if len(sys.argv) == 1:
        build()
    else:
        res = profile(sys.argv[1], sys.argv[2], float(sys.argv[3]), *[float(x) for x in sys.argv[4:]])
        for i in range(0, len(res), 10):
            print("  ".join(res[i:i + 10]))

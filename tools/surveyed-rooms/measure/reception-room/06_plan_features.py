"""Things found in plan: the two columns and the pier at the junction (their faces from the plan sections,
0.6-1.8 m), and the ceiling's parts (connected pieces of the height map of 02_floor_ceiling.py within each
band of heights, with their bounds, area and median height)."""
import json
import numpy as np
from scipy import ndimage
from rlib import OUT, FLOOR_Z, room_mesh, band_points, robust_mean

M = room_mesh()
P, N, Z, L = band_points(M, [FLOOR_Z + h for h in (0.6, 0.9, 1.2, 1.5, 1.8)])
out = {"columns": [], "ceiling": []}


def faces(box, label):
    """The four faces of a free-standing box inside `box` (x0, x1, y0, y1): robust mean of each."""
    m = (P[:, 0] > box[0]) & (P[:, 0] < box[1]) & (P[:, 1] > box[2]) & (P[:, 1] < box[3])
    p, n, w = P[m], N[m], L[m]
    axial = (np.abs(n[:, 0]) > 0.94) | (np.abs(n[:, 1]) > 0.94)
    cx, cy = np.average(p[:, 0], weights=w), np.average(p[:, 1], weights=w)
    res = {}
    for name, ax, side in (("west", 0, -1), ("east", 0, 1), ("south", 1, -1), ("north", 1, 1)):
        k = (np.abs(n[:, ax]) > 0.94) & ((p[:, ax] - (cx, cy)[ax]) * side > 0)
        if k.sum() < 5:
            res[name] = None
            continue
        v, rms, inl = robust_mean(p[k, ax], w[k], c=0.015)
        res[name] = (v, rms, w[k].sum() / 5)
    print("%s: perimeter per level %.3f m, share of it on axis-parallel faces %.2f" % (label, w.sum() / 5, w[axial].sum() / w.sum()))
    for k, v in res.items():
        if v:
            print("   %-5s face %7.3f  rms %.1f mm  length %.2f m" % (k, v[0], v[1] * 1000, v[2]))
    return res


for label, box in (("column north (by the junction)", (14.4, 15.15, 6.9, 7.55)), ("column south", (14.4, 15.15, 2.6, 3.3))):
    r = faces(box, label)
    cx, cy = (r["west"][0] + r["east"][0]) / 2, (r["south"][0] + r["north"][0]) / 2
    sx, sy = r["east"][0] - r["west"][0], r["north"][0] - r["south"][0]
    print("   centre (%.3f, %.3f), size %.3f x %.3f m" % (cx, cy, sx, sy))
    out["columns"].append(dict(label=label, centre=[cx, cy], size=[sx, sy]))
# the pier at the junction's east end: its west face (the other faces are wall fits in 04)
m = (np.abs(N[:, 0]) > 0.94) & (P[:, 0] > 19.0) & (P[:, 0] < 19.5) & (P[:, 1] > 7.28) & (P[:, 1] < 7.49)
v, rms, _ = robust_mean(P[m, 0], L[m], c=0.015)
print("pier at the junction: west face X %.3f, rms %.1f mm, %.2f m per level" % (v, rms * 1000, L[m].sum() / 5))
out["pierWest"] = v

z = np.load(OUT + "/scripts/ceiling_zmap.npy")
mt = json.load(open(OUT + "/scripts/zmap_meta.json"))
res, x0, y1 = mt["res"], mt["x0"], mt["y1"]
print("\nceiling pieces (band of heights: bounds X, Y; area; median height; share of its bounding box)")
for lo, hi in ((1.9, 2.3), (2.39, 2.455), (2.49, 2.545), (2.56, 2.74), (2.74, 2.805), (2.805, 2.86), (2.86, 3.055), (3.055, 3.115), (3.115, 3.16)):
    lab, n = ndimage.label((z >= lo) & (z < hi))
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        cnt = int((lab[sl] == i).sum())
        area = cnt * res * res
        if area < 0.12:
            continue
        ya, yb = y1 - sl[0].stop * res, y1 - sl[0].start * res
        xa, xb = x0 + sl[1].start * res, x0 + sl[1].stop * res
        if xb < 11.2 or xa > 20.95 or yb < 1.1 or ya > 13.8 or (xb < 12.7 and yb < 7.6):
            continue
        med = float(np.median(z[sl][lab[sl] == i]))
        fill = area / ((xb - xa) * (yb - ya))
        print("  %.3f-%.3f  X %6.3f..%6.3f  Y %6.3f..%6.3f  %6.2f m2  %.3f m  %.2f" % (lo, hi, xa, xb, ya, yb, area, med, fill))
        out["ceiling"].append(dict(band=[lo, hi], bbox=[xa, xb, ya, yb], area=area, median=med, fill=fill))
json.dump(out, open(OUT + "/scripts/plan_features.json", "w"), indent=1)

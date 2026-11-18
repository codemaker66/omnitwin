"""The three chandeliers: where each hangs, its lowest point, its reach and where it meets the ceiling.

Triangles within 0.45 m of each believed axis (the east one hangs 0.87 m from the lobby door's casing), between head height and the ceiling panel, not part of
the ceiling itself (more than 6 cm below the panel). The axis is the area-weighted centroid of the body.

    python -X utf8 09_fittings.py"""
import json
import numpy as np
from ralib import OUT, room_mesh, FLOOR_LO

M = room_mesh()
a, b, c, nn, area, cen = M
low = np.load(OUT + "/scripts/ceiling_low.npy")
out = {}
print("fitting      axis X    axis Y   lowest (m)  body centre (m)  top (m)   reach (m)  panel (m)  area m2")
for name, (x, y) in {"west": (-4.5, -4.82), "centre": (-0.05, -4.85), "east": (4.4, -4.8)}.items():
    for _ in range(3):
        d = np.hypot(cen[:, 0] - x, cen[:, 1] - y)
        m = (d < 0.45) & (cen[:, 2] > FLOOR_LO + 1.9) & (cen[:, 2] < FLOOR_LO + 3.10)
        x, y = np.average(cen[m, 0], weights=area[m]), np.average(cen[m, 1], weights=area[m])
    pts = np.concatenate([a[m], b[m], c[m]])
    r = np.hypot(pts[:, 0] - x, pts[:, 1] - y)
    panel = np.nanmedian(low[int((12.0 - y - 0.9) / 0.025):int((12.0 - y - 0.6) / 0.025), int((x + 7.0 - 0.2) / 0.025):int((x + 7.0 + 0.2) / 0.025)]) - FLOOR_LO
    body = np.average(cen[m, 2], weights=area[m]) - FLOOR_LO
    out[name] = dict(axisE57=[float(x), float(y)], lowest=float(pts[:, 2].min() - FLOOR_LO), body=float(body), top=float(pts[:, 2].max() - FLOOR_LO),
                     reach=float(np.percentile(r, 99)), panel=float(panel))
    print("%-10s  %7.3f  %7.3f     %.3f        %.3f         %.3f     %.3f      %.3f     %.2f" % (
        name, x, y, out[name]["lowest"], body, out[name]["top"], out[name]["reach"], panel, area[m].sum()))
json.dump(out, open(OUT + "/scripts/fittings.json", "w"), indent=1)

import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from scipy import ndimage
from common import *
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
# everything free-hanging: triangles between 2.6 and 5.45 m, more than 0.35 m from the walls (plaster planes)
inside = (cen[:, 0] > -5.45) & (cen[:, 0] < 1.3) & (cen[:, 1] > 1.85) & (cen[:, 1] < 13.3)
hang = inside & (cen[:, 2] > 2.6) & (cen[:, 2] < 5.45)
print("hanging-zone triangles:", hang.sum())
# cluster in XY on a 10 cm grid
pts = cen[hang]
res_ = 0.1; X0, Y0 = -6, 1
g = np.zeros((int(9 / res_), int(14 / res_)), bool)
gi = ((pts[:, 0] - X0) / res_).astype(int); gj = ((pts[:, 1] - Y0) / res_).astype(int)
g[gi, gj] = True
lab, n = ndimage.label(ndimage.binary_dilation(g, iterations=2))
out = []
for k in range(1, n + 1):
    m = lab[gi, gj] == k
    if m.sum() < 30: continue
    idx = np.nonzero(hang)[0][m]
    A, B, Cc = a[idx], b[idx], c[idx]
    allv = np.concatenate([A, B, Cc])
    zmin = allv[:, 2].min(); zmax = allv[:, 2].max()
    w = area[idx]; cxy = np.average(cen[idx, :2], weights=w, axis=0)
    # body below the stem: use vertices below 4.6 m for the horizontal centre and reach
    body = allv[allv[:, 2] < zmax - 0.3]
    bc = np.median(body[:, :2], axis=0) if len(body) else cxy
    reach = np.percentile(np.hypot(body[:, 0] - bc[0], body[:, 1] - bc[1]), 99) if len(body) else 0
    # radius profile in 0.2 m height bands
    prof = []
    for z0 in np.arange(np.floor(zmin * 5) / 5, zmax, 0.2):
        s = allv[(allv[:, 2] >= z0) & (allv[:, 2] < z0 + 0.2)]
        if len(s): prof.append((round(float(z0), 1), round(float(np.percentile(np.hypot(s[:, 0] - bc[0], s[:, 1] - bc[1]), 98)), 2), len(s)))
    out.append(dict(tris=int(m.sum()), centreXY=[round(float(bc[0]), 3), round(float(bc[1]), 3)], lowestZ=round(float(zmin), 3), topZ=round(float(zmax), 3), reach98=round(float(reach), 2), radiusByHeight=prof))
for o in sorted(out, key=lambda o: o["centreXY"][1]): print(o)
json.dump(out, open(OUT + "/scripts/hanging.json", "w"), indent=1)

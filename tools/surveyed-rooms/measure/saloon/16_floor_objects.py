import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from scipy import ndimage
from common import *
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
# room interior at floor level, pedestal lines: X -5.778 (main) / -5.498 (ends), 1.567 (piers) / 1.335 (ends); Y 1.512 .. 13.625
x_lo = np.where((cen[:, 1] > 3.7) & (cen[:, 1] < 11.45), -5.778, -5.498)
x_hi = np.where((cen[:, 1] > 3.73) & (cen[:, 1] < 11.35), 1.567, 1.335)
gap = 0.04
inside = (cen[:, 0] > x_lo + gap) & (cen[:, 0] < x_hi - gap) & (cen[:, 1] > 1.512 + gap) & (cen[:, 1] < 13.625 - gap)
obj = inside & (cen[:, 2] > 0.03) & (cen[:, 2] < 2.6)
print("object-zone triangles:", obj.sum())
res_ = 0.05; X0, Y0 = -6, 1
gi = ((cen[obj, 0] - X0) / res_).astype(int); gj = ((cen[obj, 1] - Y0) / res_).astype(int)
g = np.zeros((int(9 / res_), int(14 / res_)), bool); g[gi, gj] = True
lab, n = ndimage.label(ndimage.binary_dilation(g, iterations=1))
out = []
ids = np.nonzero(obj)[0]
for k in range(1, n + 1):
    m = lab[gi, gj] == k
    if m.sum() < 15: continue
    idx = ids[m]
    V = np.concatenate([a[idx], b[idx], c[idx]])
    out.append(dict(tris=int(m.sum()), x=[round(float(V[:, 0].min()), 2), round(float(V[:, 0].max()), 2)], y=[round(float(V[:, 1].min()), 2), round(float(V[:, 1].max()), 2)], z=[round(float(V[:, 2].min()), 2), round(float(V[:, 2].max()), 2)], area=round(float(area[idx].sum()), 2)))
for o in sorted(out, key=lambda o: -o["tris"]): print(o)
json.dump(out, open(OUT + "/scripts/floor_objects.json", "w"), indent=1)

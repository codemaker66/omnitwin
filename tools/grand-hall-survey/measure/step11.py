import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from hallmesh import *
pos, idx, uv, chunk = load_mesh()
a, b, c, n, area = triangles(pos, idx)
cent = (a + b + c) / 3
FLOOR = 0.045
XC, YC = 8.795, -4.963
# Chandeliers: geometry hanging below the ceiling (z between 3.5 and 6.6) away from walls.
hang = (cent[:, 2] > FLOOR + 3.0) & (cent[:, 2] < FLOOR + 6.62) & (cent[:, 0] > -1.2) & (cent[:, 0] < 18.8) & (cent[:, 1] > -9.7) & (cent[:, 1] < -0.2)
pts = cent[hang]
print('hanging triangles', hang.sum())
# cluster by nearest of 5 expected centres
centres = np.array([[XC, YC], [XC + 6.656, YC + 2.661], [XC - 6.656, YC + 2.661], [XC + 6.656, YC - 2.661], [XC - 6.656, YC - 2.661]])
d = np.linalg.norm(pts[:, None, :2] - centres[None], axis=2)
k = np.argmin(d, axis=1)
for i, cc in enumerate(centres):
    m = (k == i) & (d[np.arange(len(k)), k] < 1.4)
    p = pts[m]
    if len(p) == 0: print(i, 'none'); continue
    print(f'chandelier {i}: n {len(p)} centre xy ({np.median(p[:,0]):.3f}, {np.median(p[:,1]):.3f}) z range {p[:,2].min()-FLOOR:.2f}..{p[:,2].max()-FLOOR:.2f} radius p95 {np.percentile(np.hypot(p[:,0]-np.median(p[:,0]), p[:,1]-np.median(p[:,1])),95):.2f}')

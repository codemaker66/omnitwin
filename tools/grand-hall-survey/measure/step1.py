import os
import numpy as np, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from hallmesh import *
pos, idx, uv, chunk = load_mesh()
a, b, c, n, area = triangles(pos, idx)
lo = np.array([-3.0, -12.0, -1.0]); hi = np.array([21.0, 2.5, 10.0])
sel = crop(a, b, c, lo, hi)
print("hall-region triangles", sel.sum(), "of", len(sel))
A, B, C, N, AR = a[sel], b[sel], c[sel], n[sel], area[sel]
cent = (A + B + C) / 3
# 1. Orientation from near-vertical surfaces (|nz| < 0.2): angle of horizontal normal mod 90°.
vert = np.abs(N[:, 2]) < 0.2
ang = np.degrees(np.arctan2(N[vert, 1], N[vert, 0])) % 90.0
w = AR[vert]
hist, edges = np.histogram(ang, bins=900, range=(0, 90), weights=w)
k = np.argmax(hist); peak = (edges[k] + edges[k + 1]) / 2
# refine: weighted mean within ±1° of peak (circular around 0/90)
d = ((ang - peak + 45) % 90) - 45
m = np.abs(d) < 1.0
refined = peak + np.sum(d[m] * w[m]) / np.sum(w[m])
print(f"wall orientation peak {peak:.3f}°, refined {refined:.3f}° (mod 90)")
# 2. Floor height: up-facing triangles in the hall interior.
up = (N[:, 2] > 0.95)
inner = (cent[:, 0] > 0) & (cent[:, 0] < 18) & (cent[:, 1] > -9) & (cent[:, 1] < 0) & (cent[:, 2] < 1.0)
zs = cent[up & inner, 2]; ws = AR[up & inner]
h, e = np.histogram(zs, bins=400, range=(-1, 1), weights=ws)
kk = np.argmax(h)
print(f"floor z peak {(e[kk]+e[kk+1])/2:.3f} m; weighted median {np.median(zs):.3f}; area {ws.sum():.1f} m2")
# 3. Ceiling: down-facing triangles above 4 m in the hall.
down = N[:, 2] < -0.95
hz = cent[down & (cent[:, 2] > 4) & (cent[:, 0] > -2) & (cent[:, 0] < 20) & (cent[:, 1] > -10.5) & (cent[:, 1] < 0.5), 2]
hw = AR[down & (cent[:, 2] > 4) & (cent[:, 0] > -2) & (cent[:, 0] < 20) & (cent[:, 1] > -10.5) & (cent[:, 1] < 0.5)]
h, e = np.histogram(hz, bins=120, range=(4, 10), weights=hw)
top = np.argsort(h)[::-1][:8]
print("ceiling z peaks:", [(round((e[i]+e[i+1])/2, 3), round(h[i], 1)) for i in sorted(top)])
np.save('analysis/orient.npy', np.array([refined]))

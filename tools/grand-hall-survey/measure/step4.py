import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
FLOOR = 0.045
v, P = load('rcp')
valid = P[..., 3] > 0.5
Z = np.where(valid, P[..., 2], np.nan)
X = P[..., 0]; Y = P[..., 1]
# Flat ceiling level statistics (outside dome region).
flat = valid & (Z > 6.0) & (Z < 7.2)
print('ceiling z percentiles (flat zone):', np.nanpercentile(Z[flat], [5, 25, 50, 75, 95]).round(3))
# Dome: points above 7.0
dome = valid & (Z > 6.95)
cx = np.mean(X[dome]); cy = np.mean(Y[dome])
print('dome region centroid', round(cx, 3), round(cy, 3), 'count', dome.sum())
r = np.hypot(X - cx, Y - cy)
for r0 in np.arange(0, 3.8, 0.1):
    m = valid & (r >= r0) & (r < r0 + 0.1)
    if m.sum() > 0:
        print(f'r {r0:.1f}-{r0+0.1:.1f}: z median {np.nanmedian(Z[m]):.3f} max {np.nanmax(Z[m]):.3f} n {m.sum()}')
# Hall extents from the ceiling map
xs = X[valid & (Z > 6.0)]; ys = Y[valid & (Z > 6.0)]
print('ceiling x range', np.percentile(xs, [0.1, 99.9]).round(3), 'y range', np.percentile(ys, [0.1, 99.9]).round(3))

"""The two floors and the steps between them.

1. Lowest up-facing surface on a 2 cm raster (sampled triangles): its histogram gives the levels.
2. A plane through each floor (Tukey, 2 cm), with its slope and rms.
3. The steps: the level of each tread (histogram over the step alcove) and a picture of the alcove.

    python -X utf8 02_floors.py"""
import json
import numpy as np
from ralib import OUT, room_mesh, tri_points, grid_png

M = room_mesh()
a, b, c, nn, area, cen = M
RES = 0.02
X0, X1, Y0, Y1 = -7.0, 7.5, -12.5, 12.0
W, H = int(round((X1 - X0) / RES)), int(round((Y1 - Y0) / RES))
low = np.full((H, W), np.inf)
sel = (nn[:, 2] > 0.8) & (cen[:, 2] > -3.8) & (cen[:, 2] < -2.6)
for pts, _ in tri_points(a[sel], b[sel], c[sel], step=0.01):
    ix = ((pts[:, 0] - X0) / RES).astype(int)
    iy = ((Y1 - pts[:, 1]) / RES).astype(int)
    ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
    np.minimum.at(low, (iy[ok], ix[ok]), pts[ok, 2])
low[~np.isfinite(low)] = np.nan
np.save(OUT + "/scripts/floor_low.npy", low)
grid_png(low, -3.62, -2.92, X0, Y1, RES, 2, OUT + "/img/floor_low.png", "lowest up-facing surface, E57 Z -3.62 (blue) .. -2.92 (red)")

z = low[np.isfinite(low)]
h, e = np.histogram(z, bins=np.arange(-3.80, -2.60, 0.005))
print("levels (5 mm bins holding over 0.15 m2):")
for k in np.nonzero(h * RES * RES > 0.15)[0]:
    print("  Z %.3f..%.3f  %.2f m2" % (e[k], e[k + 1], h[k] * RES * RES))

XX, YY = np.meshgrid(X0 + (np.arange(W) + 0.5) * RES, Y1 - (np.arange(H) + 0.5) * RES)
out = {}


def plane(name, m, z0):
    m = m & np.isfinite(low) & (np.abs(low - z0) < 0.06)
    A = np.c_[XX[m], YY[m], np.ones(m.sum())]
    zz = low[m]
    w = np.ones(m.sum())
    for _ in range(30):
        co = np.linalg.lstsq(A * np.sqrt(w)[:, None], zz * np.sqrt(w), rcond=None)[0]
        u = (zz - A @ co) / 0.02
        w = np.where(np.abs(u) < 1, (1 - u * u) ** 2, 1e-9)
    r = zz - A @ co
    inl = np.abs(r) < 0.02
    print("%s: Z = %.4f %+.5f X %+.5f Y, rms %.1f mm over %.1f m2 (inliers %.2f); range of the plane over it %.3f..%.3f" % (
        name, co[2], co[0], co[1], np.sqrt((r[inl] ** 2).mean()) * 1000, inl.sum() * RES * RES, inl.mean(), (A @ co).min(), (A @ co).max()))
    out[name] = dict(plane=[float(v) for v in co], rms_mm=float(np.sqrt((r[inl] ** 2).mean()) * 1000), area=float(inl.sum() * RES * RES))
    return co


lo = plane("lower floor", (YY < -1.7) & (YY > -11.0) & (XX > -6.0) & (XX < 5.2), -3.574)
up = plane("upper floor", (YY > 1.6) & (YY < 11.3) & (XX > -5.5) & (XX < -0.2), -2.981)
for name, co, pts in (("lower", lo, [(-0.2, -6.3), (-0.2, -1.7), (-5.5, -6.0), (4.5, -6.0), (-0.2, -10.3)]),
                      ("upper", up, [(-2.8, 6.4), (-2.8, 1.7), (-2.8, 11.0), (-0.3, 1.0)])):
    print("  %s plane at" % name, "  ".join("(%.1f, %.1f): %.4f" % (x, y, co @ [x, y, 1]) for x, y in pts))

print("\nstep alcove (X -2.0..1.7, Y -1.75..1.5): levels in 5 mm bins holding over 0.02 m2")
m = (XX > -2.0) & (XX < 1.7) & (YY > -1.75) & (YY < 1.5) & np.isfinite(low)
h, e = np.histogram(low[m], bins=np.arange(-3.70, -2.80, 0.005))
for k in np.nonzero(h * RES * RES > 0.02)[0]:
    print("  Z %.3f..%.3f  %.3f m2" % (e[k], e[k + 1], h[k] * RES * RES))
i0, i1 = int((Y1 - 1.6) / RES), int((Y1 + 1.9) / RES)
j0, j1 = int((-5.2 - X0) / RES), int((1.9 - X0) / RES)
grid_png(low[i0:i1, j0:j1], -3.60, -2.95, X0 + j0 * RES, Y1 - i0 * RES, RES, 5, OUT + "/img/steps_low.png",
         "steps and lift: lowest up-facing surface, Z -3.60 (blue) .. -2.95 (red)", step=0.5)
json.dump(out, open(OUT + "/scripts/floors.json", "w"), indent=1)

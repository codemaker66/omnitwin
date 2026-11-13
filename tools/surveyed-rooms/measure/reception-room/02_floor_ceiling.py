"""The floor plane and the ceiling's height map.

Floor: up-facing triangles near the believed level, an area-weighted plane fit with its residual.
Ceiling: the lowest down-facing surface above 1.9 m on a 2.5 cm raster (triangles sampled at 1 cm),
saved as scripts/ceiling_zmap.npy (heights above FLOOR_Z, rows from Y1 down, columns from X0), with the
area held at each height. The highest up-facing surface below 0.6 m is saved the same way (floor_zmap)."""
import json
import numpy as np
from rlib import OUT, BOX, FLOOR_Z, room_mesh, tri_points, grid_png

a, b, c, nn, area, cen = room_mesh()
RES = 0.025
X0, X1, Y0, Y1 = 10.5, 21.7, 0.7, 14.9
W, H = int(round((X1 - X0) / RES)), int(round((Y1 - Y0) / RES))

# floor
fm = (nn[:, 2] > 0.95) & (np.abs(cen[:, 2] - FLOOR_Z) < 0.3) & (cen[:, 0] > 11.4) & (cen[:, 0] < 20.8) & (cen[:, 1] > 1.6) & (cen[:, 1] < 13.4)
zs, ws, xy = cen[fm, 2], area[fm], cen[fm, :2]
h, e = np.histogram(zs, bins=np.arange(FLOOR_Z - 0.3, FLOOR_Z + 0.3, 0.002), weights=ws)
pk = e[np.argmax(h)] + 0.001
inl = np.abs(zs - pk) < 0.02
A = np.c_[xy[inl], np.ones(inl.sum())]
sw = np.sqrt(ws[inl])
coef = np.linalg.lstsq(A * sw[:, None], zs[inl] * sw, rcond=None)[0]
r = zs[inl] - A @ coef
print("floor: up-facing area %.1f m2, peak Z %.4f, inlier area %.1f m2" % (ws.sum(), pk, ws[inl].sum()))
print("floor plane: Z = %.4f %+.5f X %+.5f Y, rms %.1f mm, p95 |r| %.1f mm" % (coef[2], coef[0], coef[1], np.sqrt(np.average(r ** 2, weights=ws[inl])) * 1000, np.percentile(np.abs(r), 95) * 1000))
for lab, (x, y) in (("window part centre", (16.1, 10.5)), ("inner part centre", (16.4, 4.5)), ("NW", (11.6, 13.2)), ("NE", (20.6, 13.2)), ("SW", (13.0, 1.8)), ("SE", (19.8, 1.8))):
    print("   floor Z at %s (%.1f, %.1f): %.4f" % (lab, x, y, coef @ [x, y, 1]))

# ceiling height map and floor map
zc = np.full((H, W), np.inf)
zf = np.full((H, W), -np.inf)
box = (cen[:, 0] > X0 - 0.5) & (cen[:, 0] < X1 + 0.5) & (cen[:, 1] > Y0 - 0.5) & (cen[:, 1] < Y1 + 0.5)
cm = box & (nn[:, 2] < -0.3) & (cen[:, 2] > FLOOR_Z + 1.7) & (cen[:, 2] < FLOOR_Z + 4.2)
for pts, _ in tri_points(a[cm], b[cm], c[cm], 0.01):
    col = ((pts[:, 0] - X0) / RES).astype(int)
    row = ((Y1 - pts[:, 1]) / RES).astype(int)
    ok = (col >= 0) & (col < W) & (row >= 0) & (row < H) & (pts[:, 2] > FLOOR_Z + 1.9)
    np.minimum.at(zc, (row[ok], col[ok]), pts[ok, 2] - FLOOR_Z)
um = box & (nn[:, 2] > 0.3) & (cen[:, 2] > FLOOR_Z - 0.6) & (cen[:, 2] < FLOOR_Z + 0.8)
for pts, _ in tri_points(a[um], b[um], c[um], 0.01):
    col = ((pts[:, 0] - X0) / RES).astype(int)
    row = ((Y1 - pts[:, 1]) / RES).astype(int)
    ok = (col >= 0) & (col < W) & (row >= 0) & (row < H) & (pts[:, 2] < FLOOR_Z + 0.6)
    np.maximum.at(zf, (row[ok], col[ok]), pts[ok, 2] - FLOOR_Z)
zc = np.where(np.isfinite(zc), zc, np.nan)
zf = np.where(np.isfinite(zf), zf, np.nan)
np.save(OUT + "/scripts/ceiling_zmap.npy", zc)
np.save(OUT + "/scripts/floor_zmap.npy", zf)
json.dump(dict(x0=X0, y1=Y1, res=RES, shape=[H, W], floorZ=FLOOR_Z, floorPlane=[float(v) for v in coef]), open(OUT + "/scripts/zmap_meta.json", "w"))
grid_png(zc, 2.3, 3.3, X0, Y1, RES, 3, OUT + "/ceiling_heightmap.png", "lowest down-facing surface above 1.9 m: blue 2.3 .. red 3.3 m above the floor")
grid_png(zf, -0.05, 0.3, X0, Y1, RES, 3, OUT + "/floor_heightmap.png", "highest up-facing surface below 0.6 m: blue -0.05 .. red 0.30 m")
v = zc[np.isfinite(zc)]
hh, ee = np.histogram(v, bins=np.arange(1.9, 4.2, 0.01))
print("ceiling area by 1 cm of height (m2, >= 0.4):")
print("  ", [(round(float(ee[i]) + 0.005, 3), round(float(hh[i]) * RES * RES, 2)) for i in range(len(hh)) if hh[i] * RES * RES >= 0.4])

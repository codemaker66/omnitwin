"""The ceilings: the lowest down-facing surface over each cell of a 2.5 cm raster (sampled triangles), a
picture of each section's, and the levels each holds.

    python -X utf8 07_ceiling.py"""
import numpy as np
from ralib import OUT, room_mesh, tri_points, grid_png, FLOOR_LO, FLOOR_UP

M = room_mesh()
a, b, c, nn, area, cen = M
RES = 0.025
X0, X1, Y0, Y1 = -7.0, 7.5, -12.5, 12.0
W, H = int(round((X1 - X0) / RES)), int(round((Y1 - Y0) / RES))
low = np.full((H, W), np.inf)
# down-facing, above head height over either floor, below the storey above
sel = (nn[:, 2] < -0.2) & (cen[:, 2] > -1.75) & (cen[:, 2] < 0.2)
for pts, _ in tri_points(a[sel], b[sel], c[sel], step=0.0125):
    ix = ((pts[:, 0] - X0) / RES).astype(int)
    iy = ((Y1 - pts[:, 1]) / RES).astype(int)
    ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H) & (pts[:, 2] > -1.70)
    np.minimum.at(low, (iy[ok], ix[ok]), pts[ok, 2])
low[~np.isfinite(low)] = np.nan
np.save(OUT + "/scripts/ceiling_low.npy", low)


def part(name, x0, x1, y0, y1, zlo, zhi, fz, scale):
    i0, i1 = int((Y1 - y1) / RES), int((Y1 - y0) / RES)
    j0, j1 = int((x0 - X0) / RES), int((x1 - X0) / RES)
    sub = low[i0:i1, j0:j1]
    grid_png(sub, zlo, zhi, X0 + j0 * RES, Y1 - i0 * RES, RES, scale, OUT + "/img/ceiling_%s.png" % name,
             "%s ceiling: lowest down-facing surface, %.2f (blue) .. %.2f m (red) above its floor (Z %.3f)" % (name, zlo - fz, zhi - fz, fz), step=1.0)
    z = sub[np.isfinite(sub)]
    h, e = np.histogram(z, bins=np.arange(zlo - 0.6, zhi + 0.2, 0.01))
    print("%s: levels (1 cm bins holding over 0.6 m2), heights above Z %.3f" % (name, fz))
    for k in np.nonzero(h * RES * RES > 0.6)[0]:
        print("   %.2f..%.2f m  (Z %.2f)  %.1f m2" % (e[k] - fz, e[k + 1] - fz, e[k], h[k] * RES * RES))


part("lower", -6.3, 6.9, -11.6, 0.6, -0.95, -0.30, FLOOR_LO, 3)
part("upper", -5.8, 1.9, 0.2, 11.5, -0.86, -0.64, FLOOR_UP, 3)


def box(name, x0, x1, y0, y1, fz):
    """Median and spread of the raster in a rectangle well inside one part, above that section's floor."""
    i0, i1 = int((Y1 - y1) / RES), int((Y1 - y0) / RES)
    j0, j1 = int((x0 - X0) / RES), int((x1 - X0) / RES)
    v = low[i0:i1, j0:j1] - fz
    v = v[np.isfinite(v)]
    if len(v) < 4:
        print("  %-30s nothing" % name)
        return
    q = np.percentile(v, [2, 50, 98])
    print("  %-30s X %6.2f..%6.2f  Y %6.2f..%6.2f   %.3f  (2%%..98%%: %.3f..%.3f)  %.1f m2" % (name, x0, x1, y0, y1, q[1], q[0], q[2], len(v) * RES * RES))


print("\nlower section's parts, above Z %.3f" % FLOOR_LO)
for row in [
    ("beam N-S west", -2.85, -1.80, -8.00, -1.70), ("beam N-S east", 1.65, 2.75, -8.00, -1.70),
    ("beam E-W centre, north", -1.50, 1.40, -3.38, -3.00), ("beam E-W centre, south", -1.50, 1.40, -6.70, -6.30),
    ("beam E-W centre, pier line", -1.50, 1.40, -8.50, -8.22), ("beam at the alcove's mouth", -1.50, 1.40, -1.47, -1.18),
    ("beam E-W west, north", -4.60, -3.10, -3.27, -2.95), ("beam E-W west, south", -5.90, -3.10, -6.72, -6.43),
    ("beam E-W east, north", 2.90, 5.20, -3.27, -2.95), ("beam E-W east, south", 2.90, 5.30, -6.72, -6.43),
    ("panel centre", -1.40, 1.35, -6.10, -3.60), ("panel centre north", -1.50, 1.40, -2.70, -1.75),
    ("panel centre south", -1.50, 1.40, -7.90, -7.00), ("panel between the piers", -1.50, 1.45, -9.60, -8.75),
    ("panel alcove", -1.50, 1.40, -0.95, 0.15), ("panel west main", -5.80, -3.15, -6.10, -3.55),
    ("panel west north", -4.50, -3.15, -2.70, -1.70), ("panel west south", -5.80, -3.15, -7.95, -7.00),
    ("panel east main", 3.00, 5.10, -6.10, -3.55), ("panel east north", 3.00, 5.10, -2.70, -1.70),
    ("panel east south", 3.00, 5.20, -7.95, -7.00), ("west bay", -5.80, -3.00, -10.20, -8.40),
    ("west bay lintel", -5.80, -3.00, -10.85, -10.52), ("east bay", 2.95, 6.40, -9.80, -8.40),
    ("strip by the east wall", 5.55, 6.45, -8.20, -6.70), ("east bay lintel", 2.95, 4.90, -10.60, -10.35),
    ("entrance recess", -1.40, 1.10, -11.20, -10.00), ("lift bay", -4.40, -3.10, -1.30, -0.10),
    ("lobby door casing, top", 5.45, 6.10, -5.30, -4.30), ("lobby door's passage", 5.45, 6.80, -5.40, -4.30),
    ("arch to the steps, soffit", -1.10, 1.00, 0.42, 0.62),
]:
    box(*row, FLOOR_LO)
print("\nupper section's parts, above Z %.3f (add %.3f for heights above the lower floor)" % (FLOOR_UP, FLOOR_UP - FLOOR_LO))
for row in [
    ("raised field, north part", -4.40, -1.05, 6.30, 10.15), ("raised field, south part", -2.85, -1.05, 3.30, 6.00),
    ("border west", -5.40, -4.65, 6.00, 11.10), ("border north", -5.30, -0.10, 10.45, 11.15),
    ("border east", -0.80, 0.00, 3.30, 9.80), ("border south-west", -3.95, -3.10, 3.30, 5.60),
    ("lobby", -3.90, -0.20, 1.60, 2.90), ("landing by the steps", -1.20, 1.05, 0.75, 1.15),
    ("lift landing", -3.95, -3.15, 0.15, 1.35), ("arch to the main room, soffit", -3.80, -0.20, 3.02, 3.10),
    ("lintel over the lift landing", -3.95, -3.15, 1.42, 1.50), ("west casing, top", -5.44, -5.28, 8.40, 11.10),
    ("north-east nook", 0.20, 1.20, 10.95, 11.15),
]:
    box(*row, FLOOR_UP)

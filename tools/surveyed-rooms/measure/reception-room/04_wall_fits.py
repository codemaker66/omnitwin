"""Robust line fits of every wall face (the Saloon's fitter: RANSAC, then Tukey IRLS, scale 2 cm) on plan
sections sampled every centimetre, in three bands: the plain wall (0.6-1.8 m, five levels), the skirting
(0.08-0.20 m) and the wall's top (2.2-2.36 m, under the lowest soffit). Each fit gives the offset at the
run's middle, the wall's angle to the E57 axis, the axis-parallel offset, the support and the residuals."""
import json
import numpy as np
from rlib import OUT, FLOOR_Z, WALLS, room_mesh, band_points
from bandlib import fit_line

M = room_mesh()
BANDS = {"wall": (0.6, 0.9, 1.2, 1.5, 1.8), "skirting": (0.08, 0.12, 0.16, 0.20), "top": (2.2, 2.28, 2.36)}
out = {}
for band, hs in BANDS.items():
    P, N, Z, L = band_points(M, [FLOOR_Z + h for h in hs])
    out[band] = {}
    print("\nband %s (%s m above the floor)" % (band, ", ".join("%.2f" % h for h in hs)))
    print("  wall              offset   angle    parallel  support  inliers  rms   p95")
    for name, (axis, off, ranges) in WALLS.items():
        best = None
        for sgn in (1, -1):
            f = fit_line(P, N, Z, L, axis, sgn, off, ranges, tol=0.06)
            if f and (best is None or f["support_m"] > best["support_m"]):
                best = f
        if best is None:
            print("  %-16s  no fit" % name)
            continue
        out[band][name] = best
        print("  %-16s %7.3f  %+6.2f   %7.3f   %5.2f m   %4.2f   %4.1f  %5.1f" % (
            name, best["offset_at_mid"], best["angle_deg"], best["offset_axis_parallel"], best["support_m"], best["inlier_share"], best["rms_mm"], best["p95_abs_mm"]))
json.dump(out, open(OUT + "/scripts/wall_fits.json", "w"), indent=1)
w = out["wall"]
g = lambda k: w[k]["offset_axis_parallel"]
print("\nmain dimensions from the axis-parallel offsets (plain wall band):")
print("  length, window wall to the south wall's east plane: %.3f m; to its west plane: %.3f m" % (g("north") - g("south_east"), g("north") - g("south_west")))
print("  window part: width %.3f m (west_outer to east_outer), depth %.3f (stub_west) / %.3f (stub_east)" % (g("east_outer") - g("west_outer"), g("north") - g("stub_west"), g("north") - g("stub_east")))
print("  inner part: width %.3f m (west_inner to east_inner), depth %.3f (stub_west to south_west) / %.3f (stub_east to south_east)" % (g("east_inner") - g("west_inner"), g("stub_west") - g("south_west"), g("stub_east") - g("south_east")))

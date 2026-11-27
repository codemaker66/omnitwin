"""Stations 80-122: where each stands, the floor under it and the ceiling over it (plumb rays), and plan
sections of the two sections at several heights with the stations marked.

    python -X utf8 01_stations.py"""
import numpy as np
from ralib import OUT, SIDS, room_mesh, stations, cast, subset, section_png

M = room_mesh()
a, b, c, nn, area, cen = M
S, _ = stations()
print("mesh crop: %d triangles, %.0f m2" % (len(a), area.sum()))
up = subset(M, nn[:, 2] > 0.5)
dn = subset(M, nn[:, 2] < -0.3)
print("station        X        Y        Z    floor Z   lens up   ceiling Z   clear")
marks = []
for sid in SIDS:
    t = S[sid]["t"]
    td, _ = cast(up, t, np.array([[0, 0, -1.0]]), 4.0)
    tu, _ = cast(dn, t, np.array([[0, 0, 1.0]]), 6.0)
    fz, cz = t[2] - td[0], t[2] + tu[0]
    print("scan_%03d  %7.3f  %7.3f  %7.3f   %7.3f   %6.3f    %7.3f   %6.3f" % (sid, t[0], t[1], t[2], fz, td[0], cz, cz - fz))
    marks.append((t[0], t[1], str(sid)))
for z0 in (-3.45, -3.2, -2.9, -2.5, -2.0, -1.5, -1.0, -0.6):
    section_png(M, z0, OUT + "/img/section_z%+.2f.png" % z0, marks=marks, label="plan section at E57 Z %.2f" % z0)
    print("wrote section at Z", z0)

"""Stations 119-146: position, the floor below and the ceiling above each (vertical rays on the mesh),
and plan sections of the room's crop at five heights, drawn with a metric grid and the stations."""
import json
import numpy as np
from PIL import Image, ImageDraw
from rlib import OUT, BOX, SIDS, room_mesh, stations, slice_segments, cast, near_rays, subset

M = room_mesh()
print("crop triangles:", len(M[0]), "area m2: %.0f" % M[4].sum())
S, man = stations()
rows = {}
for i in SIDS:
    t = S[i]["t"]
    o = np.array([t, t])
    d = np.array([[0, 0, -1.0], [0, 0, 1.0]])
    sub = subset(M, near_rays(M, o, d, 6.0, 0.02))
    T, _ = cast(sub, o, d, 6.0)
    rows[i] = dict(t=[round(float(v), 4) for v in t], floorZ=round(float(t[2] - T[0]), 4), ceilingZ=round(float(t[2] + T[1]), 4))
    print("scan_%03d  X %7.3f  Y %7.3f  Z %7.3f   floor %7.3f  ceiling %7.3f  clear %.3f" % (
        i, t[0], t[1], t[2], t[2] - T[0], t[2] + T[1], T[0] + T[1]))
json.dump(rows, open(OUT + "/scripts/stations.json", "w"), indent=1)

PPM = 50
X0, X1, Y0, Y1 = BOX[0], BOX[1], BOX[2], BOX[3]
for z0 in (-2.57, -1.87, -1.27, -0.57, -0.27):
    segs, ti = slice_segments(M[0], M[1], M[2], z0)
    im = Image.new("RGB", (int((X1 - X0) * PPM), int((Y1 - Y0) * PPM)), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for g in np.arange(np.ceil(X0), X1, 1.0):
        x = (g - X0) * PPM
        dr.line([(x, 0), (x, im.size[1])], fill=(225, 225, 225))
        dr.text((x + 2, 2), "X%d" % g, fill=(150, 150, 150))
    for g in np.arange(np.ceil(Y0), Y1, 1.0):
        y = (Y1 - g) * PPM
        dr.line([(0, y), (im.size[0], y)], fill=(225, 225, 225))
        dr.text((2, y + 2), "Y%d" % g, fill=(150, 150, 150))
    for s in segs:
        dr.line([((s[0, 0] - X0) * PPM, (Y1 - s[0, 1]) * PPM), ((s[1, 0] - X0) * PPM, (Y1 - s[1, 1]) * PPM)], fill=(0, 0, 0))
    for i in SIDS:
        t = S[i]["t"]
        x, y = (t[0] - X0) * PPM, (Y1 - t[1]) * PPM
        dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(220, 0, 0))
        dr.text((x + 4, y - 5), str(i), fill=(220, 0, 0))
    im.save(OUT + "/slice_z%+.2f.png" % z0)
    print("slice at Z %.2f: %d segments" % (z0, len(segs)))

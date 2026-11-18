"""The ceiling's parts as rectangles, from the raster of 07_ceiling.py: each connected piece of a height band,
with its bounds, its median height and how much of its bounding rectangle it fills (1.00 = a rectangle).

Lower section: raised panels (above 3.05 m), the higher cross beams (2.86-2.96 m), the lowered bands
(2.64-2.74 m: the lintels over the windows, the lift bay). Upper section: the raised field (above 2.23 m
over its own floor), with the edges of its two rectangles.

    python -X utf8 11_ceiling_parts.py"""
import json
import numpy as np
from scipy import ndimage
from ralib import OUT, FLOOR_LO, FLOOR_UP

RES, X0, Y1 = 0.025, -7.0, 12.0
low = np.load(OUT + "/scripts/ceiling_low.npy")
H, W = low.shape
XX, YY = np.meshgrid(X0 + (np.arange(W) + 0.5) * RES, Y1 - (np.arange(H) + 0.5) * RES)
lower = (YY < 0.45) & (YY > -11.5) & (XX > -6.2) & (XX < 6.7)
upper = (YY > 1.5) & (YY < 11.4) & (XX > -5.6) & (XX < 0.2)
out = {}


def pieces(name, mask, fz, min_area):
    lab, n = ndimage.label(mask)
    rows = []
    for k in range(1, n + 1):
        m = lab == k
        a = m.sum() * RES * RES
        if a < min_area:
            continue
        ys, xs = np.nonzero(m)
        x0, x1 = X0 + xs.min() * RES, X0 + (xs.max() + 1) * RES
        y1, y0 = Y1 - ys.min() * RES, Y1 - (ys.max() + 1) * RES
        v = low[m] - fz
        rows.append(dict(X=[round(float(x0), 3), round(float(x1), 3)], Y=[round(float(y0), 3), round(float(y1), 3)], height=round(float(np.median(v)), 3),
                         spread=[round(float(np.percentile(v, 5)), 3), round(float(np.percentile(v, 95)), 3)], area=round(float(a), 2),
                         fill=round(float(a / ((x1 - x0) * (y1 - y0))), 2)))
    rows.sort(key=lambda r: (-r["Y"][1], r["X"][0]))
    print(name)
    for r in rows:
        print("   X %6.3f..%6.3f  Y %7.3f..%7.3f   %.3f m (5%%..95%%: %.3f..%.3f)  %5.2f m2  fill %.2f" % (
            r["X"][0], r["X"][1], r["Y"][0], r["Y"][1], r["height"], r["spread"][0], r["spread"][1], r["area"], r["fill"]))
    out[name] = rows


hl = low - FLOOR_LO
pieces("lower: raised panels (above 3.05 m)", lower & (hl > 3.05) & (hl < 3.3), FLOOR_LO, 0.5)
pieces("lower: higher cross beams (2.86-2.96 m)", lower & (hl > 2.86) & (hl < 2.96), FLOOR_LO, 0.25)
pieces("lower: lowered bands (2.64-2.74 m)", lower & (hl > 2.64) & (hl < 2.74), FLOOR_LO, 0.25)
hu = low - FLOOR_UP
mask = upper & (hu > 2.23) & (hu < 2.36)
pieces("upper: raised field (above 2.23 m over the upper floor)", mask, FLOOR_UP, 1.0)
# the raised field is two rectangles: read each one's west edge row by row
lab, n = ndimage.label(mask)
big = lab == (1 + np.argmax([(lab == k).sum() for k in range(1, n + 1)]))
west = np.array([XX[i][big[i]].min() - RES / 2 if big[i].any() else np.nan for i in range(H)])
ys = YY[:, 0]
north = west[(ys > 6.6) & (ys < 10.0)]
south = west[(ys > 3.5) & (ys < 5.8)]
wn, ws = float(np.nanmedian(north)), float(np.nanmedian(south))
step = ys[np.isfinite(west) & (west < (wn + ws) / 2)].min() - RES / 2
print("   west edge: X %.3f north of Y %.3f, X %.3f south of it" % (wn, step, ws))
out["upper raised field edges"] = dict(west_north=round(wn, 3), west_south=round(ws, 3), step_Y=round(float(step), 3))
json.dump(out, open(OUT + "/scripts/ceiling_parts.json", "w"), indent=1)

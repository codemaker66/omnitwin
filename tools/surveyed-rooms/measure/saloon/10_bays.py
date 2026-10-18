import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
d = np.load(OUT + "/scripts/elev_window_+X_depth.npy"); mt = meta["window_+X"]; r = mt["res"]
H, W = d.shape
us = mt["urange"][0] + (np.arange(W) + 0.5) * r; vs = mt["vrange"][1] - (np.arange(H) + 0.5) * r
Y = -us
deep = np.nan_to_num(d, nan=0) < -0.25
res = []
for name, (y0, y1) in (("bay_north", (8.9, 11.3)), ("bay_centre", (6.3, 8.7)), ("bay_south", (3.8, 6.2))):
    cols = np.nonzero((Y > y0) & (Y < y1))[0]
    sub = deep[:, cols]
    widths = []; edges = []
    for i in range(H):
        row = sub[i]
        if row.sum() == 0: widths.append(0); edges.append((np.nan, np.nan)); continue
        k = np.nonzero(row)[0]
        # largest contiguous run
        br = np.nonzero(np.diff(k) > 1)[0]; st = np.r_[0, br + 1]; en = np.r_[br, len(k) - 1]
        j = np.argmax(k[en] - k[st]); a_, b_ = k[st[j]], k[en[j]]
        widths.append((b_ - a_ + 1) * r); edges.append((Y[cols[b_]] - r / 2, Y[cols[a_]] + r / 2))
    widths = np.array(widths); edges = np.array(edges)
    rows = np.nonzero(widths > 0.3)[0]
    top_v = vs[rows.min()]; bot_v = vs[rows.max()]
    wmax = np.median(widths[(vs > bot_v + 0.3) & (vs < bot_v + 2.0)])
    # spring line: highest v where width >= 0.97*wmax, scanning down from the top
    spring = vs[np.nonzero((widths >= 0.97 * wmax))[0].min()]
    mid = np.nanmedian(edges[(vs > bot_v + 0.3) & (vs < spring - 0.1)], axis=0)
    centre = float(np.mean(mid))
    # depth of the bay back: median over the deep region between sill+0.2 and spring
    reg = (vs[:, None] > bot_v + 0.2) & (vs[:, None] < spring) & (np.abs(Y[cols][None, :] - centre) < 0.5)
    back = np.nanmedian(d[:, cols][reg])
    # glass width: region deeper than back+0.05 (deep plane) at mid height
    gl = (np.nan_to_num(d[:, cols], nan=0) < back + 0.06)
    gw = np.median([gl[i].sum() * r for i in range(H) if bot_v + 0.4 < vs[i] < spring - 0.2])
    # the arch: rise from spring to apex; fit circle radius
    apex = top_v; rise = apex - spring
    res.append(dict(id=name, centreY=round(centre, 3), faceEdgesY=[round(float(mid[0]), 3), round(float(mid[1]), 3)],
                    widthAtHalfDepth=round(float(wmax), 3), sillZ=round(float(bot_v), 3), springZ=round(float(spring), 3), headZ=round(float(apex), 3),
                    archRise=round(float(rise), 3), backDepthFromPierFace=round(float(-back), 3), backX=round(float(1.665 - back), 3), glassWidthAtBack=round(float(gw), 3)))
    print(res[-1])
    # print the width profile every 0.25 m
    print("   width by height:", [(round(float(v), 2), round(float(w), 2)) for v, w in zip(vs[::12], widths[::12]) if w > 0])
json.dump(res, open(OUT + "/scripts/bays.json", "w"), indent=1)

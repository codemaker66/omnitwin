import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
d = np.load(OUT + "/scripts/elev_window_+X_depth.npy"); mt = meta["window_+X"]; r = mt["res"]
H, W = d.shape
us = mt["urange"][0] + (np.arange(W) + 0.5) * r; vs = mt["vrange"][1] - (np.arange(H) + 0.5) * r
Y = -us
dd = np.nan_to_num(d, nan=0)
bays = json.load(open(OUT + "/scripts/bays.json"))
for bay in bays:
    cy = bay["centreY"]
    out = {}
    for thr in (-0.05, -0.25, -0.45):
        pts = []; widths = []
        for i in range(H):
            if vs[i] < 1.0: continue
            cols = np.nonzero(np.abs(Y - cy) < 1.2)[0]
            row = dd[i, cols] < thr
            c0 = np.argmin(np.abs(Y[cols] - cy))
            if not row[c0]: continue
            # walk out from the centre to the first non-deep texel on each side
            lft = c0
            while lft - 1 >= 0 and row[lft - 1]: lft -= 1
            rgt = c0
            while rgt + 1 < len(row) and row[rgt + 1]: rgt += 1
            ya, yb = Y[cols[rgt]] - r / 2, Y[cols[lft]] + r / 2
            widths.append((vs[i], yb - ya))
            if vs[i] > 4.6: pts += [(ya, vs[i]), (yb, vs[i])]
        widths = np.array(widths); pts = np.array(pts)
        # circle fit (algebraic, then refine) to the arch edges
        A = np.c_[2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))]; bvec = (pts ** 2).sum(1)
        cx, cz, k = np.linalg.lstsq(A, bvec, rcond=None)[0]; R = np.sqrt(k + cx ** 2 + cz ** 2)
        resid = np.hypot(pts[:, 0] - cx, pts[:, 1] - cz) - R
        straight = widths[(widths[:, 0] > 1.6) & (widths[:, 0] < 2.9), 1]
        out[thr] = dict(width_straight=round(float(np.median(straight)), 3), sill=round(float(widths[:, 0].min()), 3), apex=round(float(widths[:, 0].max()), 3),
                        arch_centre_Y=round(float(cx), 3), arch_centre_Z=round(float(cz), 3), arch_radius=round(float(R), 3), arch_rms_mm=round(float(np.sqrt((resid ** 2).mean()) * 1000), 1))
    bay["byDepthThreshold"] = {str(k): v for k, v in out.items()}
    print(bay["id"], json.dumps(bay["byDepthThreshold"]))
json.dump(bays, open(OUT + "/scripts/bays.json", "w"), indent=1)

"""The two curved walls and the two columns: circles through the plan sections (five heights, 1 cm samples).

Each circle is fitted by Gauss-Newton on the radial residual with Tukey weights (2 cm), starting from a
guess; only points whose section normal lies within 25 degrees of the radial direction are used.

    python -X utf8 08_curves_columns.py"""
import json
import numpy as np
from ralib import OUT, room_mesh, band_points, FLOOR_UP

M = room_mesh()
UP = [FLOOR_UP + h for h in (0.50, 0.75, 1.00, 1.25, 1.50)]
pts, nrm, zz, ln = band_points(M, UP, maxnz=0.6)

# name: (centre guess, radius guess, radial window, box X0 X1 Y0 Y1)
ARCS = {
    "screen wall, room side": ((1.18, 2.39), 1.12, 0.10, (-0.2, 1.22, 1.15, 2.60)),
    "screen wall, corridor side": ((1.20, 2.40), 0.93, 0.07, (0.15, 1.30, 1.35, 2.50)),
    "north-east nook wall, room side": ((1.15, 9.90), 0.98, 0.12, (0.05, 1.25, 9.85, 11.0)),
    "north-east nook wall, corridor side": ((1.15, 9.90), 0.78, 0.08, (0.25, 1.30, 9.85, 10.8)),
    "column south": ((-2.05, 6.20), 0.07, 0.06, (-2.3, -1.8, 5.95, 6.45)),
    "column north": ((-2.05, 8.85), 0.07, 0.06, (-2.3, -1.8, 8.55, 9.15)),
}
out = {}
print("arc                                   centre X    centre Y    radius    rms mm  points  spans (deg from +X)")
for name, ((cx, cy), r, win, (x0, x1, y0, y1)) in ARCS.items():
    m = (pts[:, 0] > x0) & (pts[:, 0] < x1) & (pts[:, 1] > y0) & (pts[:, 1] < y1)
    P, N, Wt = pts[m], nrm[m], ln[m]
    for it in range(40):
        d = P - [cx, cy]
        rho = np.linalg.norm(d, axis=1)
        e = d / rho[:, None]
        res = rho - r
        ok = (np.abs(res) < win) & (np.abs((e * N).sum(1)) > np.cos(np.radians(25)))
        u = res / 0.02
        w = Wt * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 1e-6) * ok
        J = np.c_[-e[:, 0], -e[:, 1], -np.ones(len(P))]
        step = np.linalg.lstsq(J * np.sqrt(w)[:, None], -res * np.sqrt(w), rcond=None)[0]
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
    inl = ok & (np.abs(res) < 0.02)
    ang = np.degrees(np.arctan2(d[inl, 1], d[inl, 0]))
    rms = float(np.sqrt(np.average(res[inl] ** 2, weights=Wt[inl])) * 1000)
    out[name] = dict(centre=[float(cx), float(cy)], radius=float(r), rms_mm=rms, n=int(inl.sum()), span=[float(ang.min()), float(ang.max())])
    print("%-36s  %8.3f    %8.3f   %7.3f    %5.1f   %5d   %.0f..%.0f" % (name, cx, cy, r, rms, inl.sum(), ang.min(), ang.max()))
json.dump(out, open(OUT + "/scripts/arcs.json", "w"), indent=1)

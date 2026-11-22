"""Compare the scan's Saloon with the 2010 FIRST licensing plan (vector PDF, points) and the venue plan (saloon.png, px)."""
import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
# measured (scan) values, E57: walls at the panelling band, openings from the elevations
M = dict(front=1.471, rear=13.661, fire_main=-5.804, fire_ends=-5.59, win_piers=1.668, win_ends=1.44, bay_back=2.215,
         bayS=4.93, bayC=7.50, bayN=10.08, firebox=7.55, D5=2.405, D4=12.81, D2=2.385, D6=12.70, D1=-0.01, D3=-4.03)
# FIRST 2010 (PDF points): ('Y'|'X', pdf coordinate, measured key)
F = [("Y", 374.88, "front"), ("Y", 643.8, "rear"), ("Y", 453.78, "bayS"), ("Y", 511.74, "bayC"), ("Y", 571.8, "bayN"), ("Y", 505.08, "firebox"),
     ("Y", 387.78, "D5"), ("Y", 621.12, "D4"), ("Y", 388.68, "D2"), ("Y", 623.64, "D6"),
     ("X", 190.32, "fire_main"), ("X", 197.52, "fire_ends"), ("X", 353.52, "win_piers"), ("X", 346.8, "win_ends"), ("X", 364.8, "bay_back"), ("X", 316.62, "D1"), ("X", 231.96, "D3")]
# venue plan (px; row -> Y decreasing, col -> X increasing)
V = [("Y", 36.5, "rear"), ("Y", 538.5, "front"), ("Y", 184.0, "bayN"), ("Y", 289.5, "bayC"), ("Y", 391.0, "bayS"), ("Y", 292.0, "firebox"),
     ("Y", 88.5, "D6"), ("Y", 494.5, "D2"), ("Y", 88.5, "D4"), ("Y", 496.5, "D5"),
     ("X", 103.0, "fire_main"), ("X", 116.0, "fire_ends"), ("X", 411.5, "win_piers"), ("X", 399.0, "win_ends"), ("X", 424.5, "bay_back"), ("X", 180.0, "D3"), ("X", 345.5, "D1")]
def fit(feats, ysign, fixed_s=None):
    # model: world = off_axis + sgn * coord / s ; unknowns: inv_s, offY, offX
    rows, rhs = [], []
    for ax, c, k in feats:
        sg = ysign if ax == "Y" else 1.0
        rows.append([sg * c, 1.0 if ax == "Y" else 0.0, 1.0 if ax == "X" else 0.0]); rhs.append(M[k])
    A = np.array(rows); b = np.array(rhs)
    if fixed_s is None:
        sol = np.linalg.lstsq(A, b, rcond=None)[0]
    else:
        sol2 = np.linalg.lstsq(A[:, 1:], b - A[:, 0] / fixed_s, rcond=None)[0]; sol = np.r_[1 / fixed_s, sol2]
    res = b - A @ sol
    return sol, res
out = {}
GH_PT = 754.32 - 283.68; GH_M = 21.135
s_gh = GH_PT / GH_M
print("FIRST 2010: Grand Hall inner faces 283.68..754.32 pt along its length = %.2f pt for 21.135 m -> %.3f pt/m (1:%.1f on the A3 sheet); across 102.96..350.88 = %.2f pt for 10.59 m -> %.3f pt/m" % (GH_PT, s_gh, 1000 / (s_gh * 25.4 / 72), 350.88 - 102.96, (350.88 - 102.96) / 10.59))
for lab, feats, ysign, fs in (("FIRST2010 scale from Grand Hall length", F, 1.0, s_gh), ("FIRST2010 free scale", F, 1.0, None),
                              ("venue plan scale from its 11.9 m label (500 px)", V, -1.0, 500 / 11.9), ("venue plan scale from its 6.9 m label (307 px)", V, -1.0, 307 / 6.9), ("venue plan free scale", V, -1.0, None)):
    sol, res = fit(feats, ysign, fs)
    s = 1 / sol[0]
    print(f"\n{lab}: scale {s:.3f} units/m; rms residual {np.sqrt(np.mean(res**2))*100:.1f} cm")
    rr = {}
    for (ax, c, k), r_ in zip(feats, res):
        rr[k] = round(float(r_), 3); print(f"   {k:10s} {ax} scan {M[k]:+.3f}  plan->scan residual (scan - plan) {r_*100:+6.1f} cm")
    # derived room sizes from the plan at this scale
    fy = {k: c for ax, c, k in feats}
    L_plan = abs(fy["rear"] - fy["front"]) / s; W_plan = abs(fy["win_piers"] - fy["fire_main"]) / s; Wend = abs(fy["win_ends"] - fy["fire_ends"]) / s
    print(f"   plan sizes at this scale: length {L_plan:.3f} m (scan 12.190), width main {W_plan:.3f} m (scan 7.472), width at ends {Wend:.3f} m (scan 7.03)")
    out[lab] = dict(scale_units_per_m=round(float(s), 4), rms_cm=round(float(np.sqrt(np.mean(res ** 2)) * 100), 1), residuals_m=rr, length=round(L_plan, 3), width_main=round(W_plan, 3), width_ends=round(Wend, 3))
json.dump(out, open(OUT + "/scripts/plan_compare.json", "w"), indent=1)

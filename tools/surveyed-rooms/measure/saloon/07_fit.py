import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
d = np.load(OUT + "/scripts/band_points.npz"); p, n, z, w = d["p"], d["n"], d["z"], d["w"]
NL = 13
rng = np.random.default_rng(7)
# id, axis of the wall's offset (0: X = const, wall runs along Y; 1: Y = const), inward normal sign, offset guess, along-range(s)
WALLS = [
    ("front_-Y", 1, +1, 1.485, [(-5.45, -3.6), (-3.3, -0.75), (0.62, 1.30)]),
    ("rear_+Y", 1, -1, 13.635, [(-5.45, 1.30)]),
    ("fireplace_-X_main", 0, +1, -5.79, [(3.80, 11.35)]),
    ("fireplace_-X_southEnd", 0, +1, -5.57, [(1.60, 3.05)]),
    ("fireplace_-X_northEnd", 0, +1, -5.595, [(12.05, 13.55)]),
    ("window_+X_piers", 0, -1, 1.665, [(3.80, 11.30)]),
    ("window_+X_southEndPier", 0, -1, 1.325, [(3.20, 3.68)]),
    ("window_+X_northEndPier", 0, -1, 1.325, [(11.40, 11.88)]),
    ("window_+X_northDoorFace", 0, -1, 1.47, [(12.10, 13.40)]),
]
def fit_line(axis, sgn, off, ranges, tol=0.04):
    o = 1 - axis
    m = (n[:, axis] * sgn > 0.9) & (np.abs(p[:, axis] - off) < tol)
    mr = np.zeros(len(p), bool)
    for lo, hi in ranges: mr |= (p[:, o] > lo) & (p[:, o] < hi)
    m &= mr
    s = p[m, o]; t = p[m, axis]; ww = w[m]
    # RANSAC for the initial line t = a + b*(s - s0)
    s0 = 0.5 * (s.min() + s.max())
    best = None
    for _ in range(400):
        i, j = rng.choice(len(s), 2, replace=False)
        if abs(s[i] - s[j]) < 0.3: continue
        b = (t[j] - t[i]) / (s[j] - s[i]); a = t[i] + b * (s0 - s[i])
        inl = np.abs(t - (a + b * (s - s0))) < 0.01
        sc = ww[inl].sum()
        if best is None or sc > best[0]: best = (sc, a, b)
    _, a, b = best
    # IRLS Tukey biweight, c = 2 cm
    for _ in range(30):
        r = t - (a + b * (s - s0))
        u = r / 0.02
        wt = ww * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0)
        A = np.c_[np.ones_like(s), s - s0] * np.sqrt(wt)[:, None]
        a, b = np.linalg.lstsq(A, t * np.sqrt(wt), rcond=None)[0]
    r = t - (a + b * (s - s0))
    inl = np.abs(r) < 0.02
    return dict(offset_at_mid=float(a), slope=float(b), angle_deg=float(np.degrees(np.arctan(b))), s_mid=float(s0),
                support_m=float(ww.sum() / NL), inlier_share=float(ww[inl].sum() / ww.sum()),
                rms_mm=float(np.sqrt(np.average(r[inl] ** 2, weights=ww[inl])) * 1000),
                p95_abs_mm=float(np.percentile(np.abs(r), 95) * 1000), span=[float(s.min()), float(s.max())],
                per_level_offset_mm=[float((np.median(t[(z[m] == zl)] - b * (s[(z[m] == zl)] - s0)) - a) * 1000) for zl in np.unique(z[m])])
res = {}
for wid, axis, sgn, off, rngs in WALLS:
    f = fit_line(axis, sgn, off, rngs)
    f.update(axis="X" if axis == 0 else "Y", inward_normal_sign=sgn, ranges=rngs)
    res[wid] = f
    lv = f["per_level_offset_mm"]
    print(f"{wid:28s} {f['axis']}={f['offset_at_mid']:.4f} at mid {f['s_mid']:.2f}  angle {f['angle_deg']:+.3f} deg  support {f['support_m']:.2f} m  inliers {f['inlier_share']:.2f}  rms {f['rms_mm']:.1f} mm  p95 {f['p95_abs_mm']:.1f} mm  level spread {min(lv):+.1f}..{max(lv):+.1f} mm")
json.dump(res, open(OUT + "/scripts/wall_fits.json", "w"), indent=1)
F = res
print("rear-front distance at X=-2.065 : %.4f" % ((F['rear_+Y']['offset_at_mid'] + F['rear_+Y']['slope'] * (-2.065 - F['rear_+Y']['s_mid'])) - (F['front_-Y']['offset_at_mid'] + F['front_-Y']['slope'] * (-2.065 - F['front_-Y']['s_mid']))))
for a_, b_ in (("front_-Y", "rear_+Y"), ("fireplace_-X_main", "window_+X_piers")):
    print("parallelism", a_, b_, "%.3f deg" % (F[a_]['angle_deg'] - F[b_]['angle_deg']))
# squareness: X walls run along Y: their direction (slope dX/dY); Y walls slope dY/dX. Perpendicular if angle_X_wall == -angle_Y_wall
print("squareness front vs -X main: %.3f deg (0 = square)" % (F['front_-Y']['angle_deg'] + F['fireplace_-X_main']['angle_deg']))
print("squareness rear vs +X piers: %.3f deg" % (F['rear_+Y']['angle_deg'] + F['window_+X_piers']['angle_deg']))

import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from bandlib import *
for name, lv in (("band 3.6-4.0", np.arange(3.6, 4.001, 0.05)), ("band 4.0-4.6", np.arange(4.0, 4.601, 0.05))):
    P, N, Z, W = band_points(lv)
    print("==", name)
    # peaks
    inroom = (P[:, 1] > 1.3) & (P[:, 1] < 13.9) & (P[:, 0] > -6.3) & (P[:, 0] < 2.6)
    for axis, sgn, lo, hi in ((0, 1, -6.2, -5.0), (0, -1, 1.0, 2.6), (1, 1, 1.0, 2.0), (1, -1, 13.0, 14.0)):
        mm = inroom & (N[:, axis] * sgn > 0.95)
        h, e = np.histogram(P[mm, axis], bins=np.arange(lo, hi, 0.01), weights=W[mm] / len(lv))
        top = np.argsort(h)[::-1][:5]
        print("  axis", "XY"[axis], "sgn", sgn, [(round(e[i] + 0.005, 3), round(h[i], 2)) for i in sorted(top)])

import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
d = np.load(OUT + "/scripts/band_points.npz"); p, n, z, w = d["p"], d["n"], d["z"], d["w"]
NL = 13
def peaks(vals, wts, lo, hi, minlen=0.15):
    h, e = np.histogram(vals, bins=np.arange(lo, hi, 0.01), weights=wts / NL)
    out = []
    for i in range(1, len(h) - 1):
        if h[i] >= h[i - 1] and h[i] > h[i + 1] and h[i - 1:i + 2].sum() >= minlen:
            out.append((round(e[i] + 0.005, 3), round(h[i - 1:i + 2].sum(), 2)))
    return out
inroom = (p[:, 1] > 1.3) & (p[:, 1] < 13.9) & (p[:, 0] > -6.3) & (p[:, 0] < 2.6)
for sgn, lab in ((1, "+nx (faces +X)"), (-1, "-nx (faces -X)")):
    m = inroom & (n[:, 0] * sgn > 0.95)
    print("X peaks, normal", lab, peaks(p[m, 0], w[m], -6.5, 3.0))
for sgn, lab in ((1, "+ny"), (-1, "-ny")):
    m = inroom & (n[:, 1] * sgn > 0.95)
    print("Y peaks, normal", lab, peaks(p[m, 1], w[m], 0.5, 14.5))

import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
d = np.load(OUT + "/scripts/band_points.npz"); p, n, z, w = d["p"], d["n"], d["z"], d["w"]
inroom = (p[:, 1] > 1.3) & (p[:, 1] < 13.9) & (p[:, 0] > -6.3) & (p[:, 0] < 2.6)
def runs(axis, sgn, v, tol=0.015, gap=0.08):
    o = 1 - axis
    m = inroom & (n[:, axis] * sgn > 0.95) & (np.abs(p[:, axis] - v) < tol)
    s = np.sort(p[m, o])
    if len(s) == 0: return []
    br = np.nonzero(np.diff(s) > gap)[0]
    st = np.r_[0, br + 1]; en = np.r_[br, len(s) - 1]
    return [(round(s[i], 2), round(s[j], 2)) for i, j in zip(st, en) if s[j] - s[i] > 0.08]
for v in (-5.795, -5.775, -5.735, -5.695, -5.645, -5.605, -5.575, -5.545, -5.495):
    print("X-wall(+nx) at", v, runs(0, 1, v, 0.012))
for v in (1.315, 1.335, 1.37, 1.405, 1.425, 1.475, 1.565, 1.635, 1.665, 2.225):
    print("X-wall(-nx) at", v, runs(0, -1, v, 0.012))
for v in (1.445, 1.485, 1.525, 1.585, 1.845):
    print("Y-wall(+ny) at", v, runs(1, 1, v, 0.015))
for v in (13.635,):
    print("Y-wall(-ny) at", v, runs(1, -1, v, 0.02))

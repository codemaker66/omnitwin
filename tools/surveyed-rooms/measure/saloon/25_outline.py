"""The measured outlines (E57) and their planner coordinates, areas and sizes."""
import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
# step positions along the long walls (panelling, 20_steps.py)
wS, wN, fS, fN = 3.630, 11.400, 3.679, 11.462
def outline(front, rear, fMain, fS_, fN_, wPier, wS_, wN_):
    return [(fS_, front), (wS_, front), (wS_, wS), (wPier, wS), (wPier, wN), (wN_, wN), (wN_, rear), (fN_, rear), (fN_, fN), (fMain, fN), (fMain, fS), (fS_, fS)]
O = {
    "panelling (wall face, 1.6-2.8 m fits)": outline(1.470, 13.661, -5.804, -5.579, -5.626, 1.669, 1.429, 1.475),
    "plaster (3.4-5.2 m fits)": outline(1.448, 13.665, -5.823, -5.581, -5.633, 1.693, 1.470, 1.468),
    "pedestal / floor line (0.3-1.0 m fits)": outline(1.510, 13.639, -5.782, -5.539, -5.50, 1.568, 1.341, 1.333),
}
def area(p):
    p = np.array(p); x, y = p[:, 0], p[:, 1]
    return 0.5 * (x @ np.roll(y, -1) - y @ np.roll(x, -1))
res = {}
for k, p in O.items():
    A = area(p)
    pl = [(round(7.565 - y, 4), round(-2.065 - x, 4)) for x, y in p]
    Apl = -area(pl)  # (x,z) frame is mirrored in 2D
    P = np.array(p)
    res[k] = dict(e57=[[round(x, 4), round(y, 4)] for x, y in p], planner_xz=[list(q) for q in pl], area_m2=round(float(A), 2),
                  length_Y=round(float(P[:, 1].max() - P[:, 1].min()), 3), width_main_X=round(float(P[:, 0].max() - P[:, 0].min()), 3),
                  width_ends_X=round(float(p[1][0] - p[0][0]), 3))
    print(k, "area %.2f m2, length %.3f, width main %.3f, width at ends %.3f" % (A, res[k]["length_Y"], res[k]["width_main_X"], res[k]["width_ends_X"]))
json.dump(res, open(OUT + "/scripts/outlines.json", "w"), indent=1)
print(json.dumps(res["panelling (wall face, 1.6-2.8 m fits)"]["planner_xz"]))

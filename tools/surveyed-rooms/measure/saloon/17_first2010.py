import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np, fitz
from common import *
d = fitz.open(__import__("os").environ.get("FIRST_2010_PDF", "work/blueprints/FIRST 2010.pdf")); p = d[0]
segs = []
for dr in p.get_drawings():
    col = tuple(round(v, 2) for v in (dr.get("color") or ())); fill = tuple(round(v, 2) for v in (dr.get("fill") or ()))
    for it in dr["items"]:
        if it[0] == "l":
            segs.append((it[1].x, it[1].y, it[2].x, it[2].y, dr["type"], col, fill, dr.get("width") or 0))
        elif it[0] == "re":
            r = it[1]
            for (x0, y0, x1, y1) in ((r.x0, r.y0, r.x1, r.y0), (r.x1, r.y0, r.x1, r.y1), (r.x1, r.y1, r.x0, r.y1), (r.x0, r.y1, r.x0, r.y0)):
                segs.append((x0, y0, x1, y1, dr["type"], col, fill, dr.get("width") or 0))
        elif it[0] == "qu":
            q = it[1]
            for k in range(4):
                a_, b_ = q[k], q[(k + 1) % 4]; segs.append((a_.x, a_.y, b_.x, b_.y, dr["type"], col, fill, dr.get("width") or 0))
print(len(segs), "segments")
S = np.array([s[:4] for s in segs]); typ = np.array([s[4] for s in segs]); red = np.array([s[5] == (1.0, 0.0, 0.0) for s in segs])
json.dump([list(map(float, s[:4])) + [s[4], list(s[5]), list(s[6]), float(s[7])] for s in segs], open(OUT + "/scripts/first2010_segments.json", "w"))
# Saloon region in PDF points
reg = (np.minimum(S[:, 0], S[:, 2]) > 370) & (np.maximum(S[:, 0], S[:, 2]) < 670) & (np.minimum(S[:, 1], S[:, 3]) > 170) & (np.maximum(S[:, 1], S[:, 3]) < 480)
L = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
vert = reg & (np.abs(S[:, 2] - S[:, 0]) < 0.05) & (L > 3)
hor = reg & (np.abs(S[:, 3] - S[:, 1]) < 0.05) & (L > 3)
def hist(vals, w, lab):
    order = np.argsort(vals); vals, w = vals[order], w[order]
    groups = []
    for v, ww in zip(vals, w):
        if groups and abs(v - groups[-1][0]) < 0.25: groups[-1][1] += ww; groups[-1][2].append(v)
        else: groups.append([v, ww, [v]])
    print(lab, [(round(float(np.mean(g[2])), 2), round(float(g[1]), 1)) for g in groups if g[1] > 25])
hist(S[vert, 0], L[vert], "vertical lines x (pt), total length > 25 pt:")
hist(S[hor, 1], L[hor], "horizontal lines y (pt):")
print("red segments in region:")
for s in S[reg & red]: print("  ", np.round(s, 2))

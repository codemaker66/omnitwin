import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np, json
from common import *
S, m = stations()
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
def ray_z(x, y, z0, up):
    # vertical ray hit against triangles (barycentric in XY)
    lo = np.minimum(np.minimum(a[:, :2], b[:, :2]), c[:, :2]); hi = np.maximum(np.maximum(a[:, :2], b[:, :2]), c[:, :2])
    sel = np.nonzero((lo[:, 0] <= x) & (hi[:, 0] >= x) & (lo[:, 1] <= y) & (hi[:, 1] >= y))[0]
    A, B, Cc = a[sel], b[sel], c[sel]
    v0 = B[:, :2] - A[:, :2]; v1 = Cc[:, :2] - A[:, :2]; v2 = np.array([x, y]) - A[:, :2]
    d = v0[:, 0] * v1[:, 1] - v0[:, 1] * v1[:, 0]
    ok = np.abs(d) > 1e-12
    u = (v2[:, 0] * v1[:, 1] - v2[:, 1] * v1[:, 0]) / np.where(ok, d, 1)
    v = (v0[:, 0] * v2[:, 1] - v0[:, 1] * v2[:, 0]) / np.where(ok, d, 1)
    inside = ok & (u >= 0) & (v >= 0) & (u + v <= 1)
    zz = (A[:, 2] + u * (B[:, 2] - A[:, 2]) + v * (Cc[:, 2] - A[:, 2]))[inside]
    zz = zz[zz > z0] if up else zz[zz < z0]
    if len(zz) == 0: return None
    return zz.min() if up else zz.max()
edges = {}
for e in m["edges"]:
    edges.setdefault(e["a"], []).append(e["b"]); edges.setdefault(e["b"], []).append(e["a"])
rows = []
for i in list(range(44, 78)):
    t = S[i]["t"]
    fl = ray_z(t[0], t[1], t[2], False); ce = ray_z(t[0], t[1], t[2], True)
    inside = (-5.8 < t[0] < 2.3) and (1.4 < t[1] < 13.7)
    nb = sorted(int(x[5:]) for x in edges.get(S[i]["id"], []))
    x, z = to_planner(t[0], t[1])
    rows.append(dict(station=i, X=round(float(t[0]), 3), Y=round(float(t[1]), 3), Zcam=round(float(t[2]), 3), floorZ=None if fl is None else round(float(fl), 3), ceilZ=None if ce is None else round(float(ce), 3), inSaloonBox=bool(inside), planner_xz=[round(float(x), 3), round(float(z), 3)], gain=S[i]["exposure"]["gain"], neighbours=nb, roomSlug=m["nodes"][i]["roomSlug"], floorIdx=m["nodes"][i]["floor"]))
    pass
json.dump(rows, open(OUT + "/stations_44_77.json", "w"), indent=1)

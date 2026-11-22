import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
sel = (cen[:, 0] > -8) & (cen[:, 0] < 5) & (cen[:, 1] > 0) & (cen[:, 1] < 15) & (cen[:, 2] > -0.5) & (cen[:, 2] < 6.5)
a, b, c, nn = a[sel], b[sel], c[sel], nn[sel]
pts, nrm, zz, ln = [], [], [], []
for z0 in np.arange(1.0, 1.6001, 0.05):
    segs, ti = slice_segments(a, b, c, z0)
    n = nn[ti]
    keep = np.abs(n[:, 2]) < 0.5
    segs, n = segs[keep], n[keep]
    L = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
    k = np.maximum(1, np.ceil(L / 0.01).astype(int))
    rep = np.repeat(np.arange(len(segs)), k)
    tt = (np.concatenate([np.arange(q) for q in k]) + 0.5) / k[rep]
    p = segs[rep, 0] + (segs[rep, 1] - segs[rep, 0]) * tt[:, None]
    nh = n[rep, :2] / np.linalg.norm(n[rep, :2], axis=1)[:, None]
    pts.append(p); nrm.append(nh); zz.append(np.full(len(p), z0)); ln.append((L / k)[rep])
pts = np.concatenate(pts); nrm = np.concatenate(nrm); zz = np.concatenate(zz); ln = np.concatenate(ln)
np.savez(OUT + "/scripts/band_points.npz", p=pts, n=nrm, z=zz, w=ln)
print(len(pts), "points")
# dominant orientation from normals (mod 90 deg), length weighted
ang = np.degrees(np.arctan2(nrm[:, 1], nrm[:, 0])) % 90
ang = np.where(ang > 45, ang - 90, ang)
h, e = np.histogram(ang, bins=np.arange(-45, 45.01, 0.1), weights=ln)
pk = e[np.argmax(h)] + 0.05
near = np.abs(ang - pk) < 2
print("dominant normal angle mod 90 (deg): histogram peak %.2f, weighted mean within +-2: %.3f, share of wall length within +-2 deg: %.2f" % (pk, np.average(ang[near], weights=ln[near]), ln[near].sum() / ln.sum()))

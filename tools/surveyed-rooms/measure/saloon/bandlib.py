import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
_M = None
def mesh_local():
    global _M
    if _M is None:
        P, I, C = load_mesh()
        a, b, c, nn, area, cen = tri_geometry(P, I)
        sel = (cen[:, 0] > -8) & (cen[:, 0] < 5) & (cen[:, 1] > -1) & (cen[:, 1] < 16) & (cen[:, 2] > -0.5) & (cen[:, 2] < 7)
        _M = (a[sel], b[sel], c[sel], nn[sel], area[sel], cen[sel])
    return _M
def band_points(levels, step=0.01, maxnz=0.5):
    a, b, c, nn, area, cen = mesh_local()
    pts, nrm, zz, ln = [], [], [], []
    for z0 in levels:
        segs, ti = slice_segments(a, b, c, z0)
        n = nn[ti]; keep = np.abs(n[:, 2]) < maxnz
        segs, n = segs[keep], n[keep]
        L = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
        k = np.maximum(1, np.ceil(L / step).astype(int))
        rep = np.repeat(np.arange(len(segs)), k)
        tt = (np.concatenate([np.arange(q) for q in k]) + 0.5) / k[rep]
        pts.append(segs[rep, 0] + (segs[rep, 1] - segs[rep, 0]) * tt[:, None])
        nrm.append(n[rep, :2] / np.linalg.norm(n[rep, :2], axis=1)[:, None]); zz.append(np.full(k.sum(), z0)); ln.append((L / k)[rep])
    return np.concatenate(pts), np.concatenate(nrm), np.concatenate(zz), np.concatenate(ln)
def fit_line(P, N, Z, W, axis, sgn, off, ranges, tol=0.04, c=0.02, seed=7):
    rng = np.random.default_rng(seed)
    NL = len(np.unique(Z))
    o = 1 - axis
    m = (N[:, axis] * sgn > 0.9) & (np.abs(P[:, axis] - off) < tol)
    mr = np.zeros(len(P), bool)
    for lo, hi in ranges: mr |= (P[:, o] > lo) & (P[:, o] < hi)
    m &= mr
    s = P[m, o]; t = P[m, axis]; ww = W[m]
    if len(s) < 10: return None
    s0 = 0.5 * (s.min() + s.max()); best = None
    for _ in range(400):
        i, j = rng.choice(len(s), 2, replace=False)
        if abs(s[i] - s[j]) < 0.2: continue
        b = (t[j] - t[i]) / (s[j] - s[i]); a = t[i] + b * (s0 - s[i])
        sc = ww[np.abs(t - (a + b * (s - s0))) < 0.01].sum()
        if best is None or sc > best[0]: best = (sc, a, b)
    if best is None: return None
    _, a, b = best
    for _ in range(30):
        r = t - (a + b * (s - s0)); u = r / c
        wt = ww * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0)
        A = np.c_[np.ones_like(s), s - s0] * np.sqrt(wt)[:, None]
        a, b = np.linalg.lstsq(A, t * np.sqrt(wt), rcond=None)[0]
    r = t - (a + b * (s - s0)); inl = np.abs(r) < c
    # fixed-angle (axis-parallel) robust offset too
    a0 = np.median(t)
    for _ in range(30):
        u = (t - a0) / c; wt = ww * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0)
        a0 = np.sum(wt * t) / np.sum(wt)
    return dict(offset_at_mid=float(a), slope=float(b), angle_deg=float(np.degrees(np.arctan(b))), s_mid=float(s0),
                offset_axis_parallel=float(a0), support_m=float(ww.sum() / NL), inlier_share=float(ww[inl].sum() / ww.sum()),
                rms_mm=float(np.sqrt(np.average(r[inl] ** 2, weights=ww[inl])) * 1000), p95_abs_mm=float(np.percentile(np.abs(r), 95) * 1000),
                span=[float(s.min()), float(s.max())])

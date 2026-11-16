"""Shared helpers for the Reception Room measurement pass (E57 frame, Z up, metres).

Inputs come from the same work directory as the Saloon's pass (ROOMS_SURVEY_WORK: manifest.json and the
decoded mesh under mesh/), plus ROOMS_SURVEY_PANO512 (the twin's 512 px panoramas, default
<work>/pano512) and E57_CUBE_FACES (the export's native cube faces). Outputs go to
RECEPTION_MEASURE_OUT (default <work>/reception-measure). The Saloon's loaders are imported, not copied."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "saloon"))
import numpy as np  # noqa: E402
from common import ROOT, load_mesh, tri_geometry, stations, slice_segments  # noqa: E402,F401

OUT = os.environ.get("RECEPTION_MEASURE_OUT", ROOT + "/reception-measure")
PANO = os.environ.get("ROOMS_SURVEY_PANO512", ROOT + "/pano512").rstrip("/") + "/"
os.makedirs(OUT + "/scripts", exist_ok=True)

# The crop of the building's mesh this pass reads: the room, its lobby and 3 m beyond its walls.
BOX = (8.0, 24.5, -2.0, 18.0, -4.5, 1.5)
# Stations examined (the lobby, the room and the first ones beyond).
SIDS = list(range(119, 147))
# Adopted in 02_floor_ceiling.py (the floor plane at the room's centre).
FLOOR_Z = -2.869


# wall: axis its plane is across (0 = X, 1 = Y), believed offset (03_wall_peaks.py), runs along the other axis
WALLS = {
    "north": (1, 13.558, [(11.26, 11.60)]),   # the only bare wall; a sheer fold lies in the same plane at X 12.66..12.85
    "west_outer": (0, 11.27, [(7.75, 13.50)]),
    "stub_west": (1, 7.678, [(11.36, 12.70)]),
    "west_inner": (0, 12.731, [(2.80, 7.64), (1.20, 1.54)]),
    "south_west": (1, 1.168, [(12.76, 15.02)]),
    "south_return": (0, 15.051, [(1.19, 1.47)]),
    "south_east": (1, 1.488, [(15.08, 19.96)]),
    "east_inner": (0, 19.991, [(1.52, 7.24)]),
    "box_south": (1, 7.268, [(19.26, 19.97)]),
    "box_west": (0, 19.16, [(7.29, 7.48)]),
    "stub_east": (1, 7.498, [(19.25, 20.74)]),
    "east_door_leaf": (0, 20.764, [(7.70, 8.44)]),
    "east_pier_south": (0, 20.681, [(7.52, 7.62), (8.52, 8.76)]),
    "east_outer": (0, 20.891, [(8.80, 12.48)]),
    "east_pier_north": (0, 20.681, [(12.52, 13.19)]),
}


def room_mesh():
    """(a, b, c, unit normal, area, centroid) of the triangles whose centroid lies in BOX; cached."""
    f = OUT + "/scripts/room_mesh.npz"
    if os.path.exists(f):
        d = np.load(f)
        return d["a"], d["b"], d["c"], d["nn"], d["area"], d["cen"]
    P, I, C = load_mesh()
    cen = P[I].mean(1)
    sel = ((cen[:, 0] > BOX[0]) & (cen[:, 0] < BOX[1]) & (cen[:, 1] > BOX[2]) & (cen[:, 1] < BOX[3])
           & (cen[:, 2] > BOX[4]) & (cen[:, 2] < BOX[5]))
    a, b, c, nn, area, cen = tri_geometry(P, I[sel])
    np.savez(f, a=a, b=b, c=c, nn=nn, area=area, cen=cen)
    return a, b, c, nn, area, cen


def band_points(M, levels, step=0.01, maxnz=0.5):
    """Points every `step` along the plan sections of near-vertical faces at each level:
    (XY, unit XY normal, level, length each point stands for)."""
    a, b, c, nn = M[0], M[1], M[2], M[3]
    pts, nrm, zz, ln = [], [], [], []
    for z0 in levels:
        segs, ti = slice_segments(a, b, c, z0)
        n = nn[ti]
        keep = np.abs(n[:, 2]) < maxnz
        segs, n = segs[keep], n[keep]
        L = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
        k = np.maximum(1, np.ceil(L / step).astype(int))
        rep = np.repeat(np.arange(len(segs)), k)
        tt = (np.concatenate([np.arange(q) for q in k]) + 0.5) / k[rep]
        pts.append(segs[rep, 0] + (segs[rep, 1] - segs[rep, 0]) * tt[:, None])
        nrm.append(n[rep, :2] / np.maximum(np.linalg.norm(n[rep, :2], axis=1), 1e-9)[:, None])
        zz.append(np.full(k.sum(), z0))
        ln.append((L / k)[rep])
    return np.concatenate(pts), np.concatenate(nrm), np.concatenate(zz), np.concatenate(ln)


def cast(M, o, d, tmax=40.0, chunk=4_000_000):
    """First hit of each ray o[i] + t d[i] (t in (1e-4, tmax)) on the triangles of M, by Moeller-Trumbore
    in chunks. Returns (t, triangle index); t = inf where nothing is hit. Back faces count: the mesh's
    winding is not relied on."""
    a, b, c = M[0], M[1], M[2]
    o = np.atleast_2d(np.asarray(o, float))
    d = np.atleast_2d(np.asarray(d, float))
    if len(o) == 1 and len(d) > 1:
        o = np.repeat(o, len(d), 0)
    e1, e2 = b - a, c - a
    T = np.full(len(d), np.inf)
    K = np.full(len(d), -1)
    if len(a) == 0:
        return T, K
    per = max(1, chunk // max(len(a), 1))
    for i0 in range(0, len(d), per):
        dd = d[i0:i0 + per][:, None, :]
        oo = o[i0:i0 + per][:, None, :]
        p = np.cross(dd, e2[None])
        det = (p * e1[None]).sum(-1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        s = oo - a[None]
        u = (s * p).sum(-1) * inv
        q = np.cross(s, e1[None])
        v = (dd * q).sum(-1) * inv
        t = (q * e2[None]).sum(-1) * inv
        hit = ok & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t > 1e-4) & (t < tmax)
        t = np.where(hit, t, np.inf)
        k = np.argmin(t, axis=1)
        T[i0:i0 + per] = t[np.arange(len(k)), k]
        K[i0:i0 + per] = np.where(np.isfinite(T[i0:i0 + per]), k, -1)
    return T, K


def subset(M, sel):
    return tuple(x[sel] for x in M)


def near_rays(M, o, d, tmax, pad=0.05):
    """The triangles a bundle of rays could reach: those whose bounds meet the bundle's bounds."""
    o = np.atleast_2d(o)
    d = np.atleast_2d(d)
    e = o + d * tmax if len(o) == len(d) else o[:1] + d * tmax
    lo = np.minimum(o.min(0), e.min(0)) - pad
    hi = np.maximum(o.max(0), e.max(0)) + pad
    a, b, c = M[0], M[1], M[2]
    tlo = np.minimum(np.minimum(a, b), c)
    thi = np.maximum(np.maximum(a, b), c)
    return np.all((thi >= lo) & (tlo <= hi), axis=1)


def robust_mean(x, w=None, c=0.02, it=30):
    """Tukey biweight location (scale c): (value, rms of the inliers, inlier share)."""
    x = np.asarray(x, float)
    w = np.ones_like(x) if w is None else np.asarray(w, float)
    m = np.median(x)
    for _ in range(it):
        u = (x - m) / c
        wt = w * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0)
        if wt.sum() <= 0:
            break
        m = float((wt * x).sum() / wt.sum())
    inl = np.abs(x - m) < c
    rms = float(np.sqrt(np.average((x[inl] - m) ** 2, weights=w[inl]))) if inl.any() else float("nan")
    return float(m), rms, float(w[inl].sum() / w.sum())


def planner(X, Y, centre):
    """E57 (X, Y) to the room's planner (x, z) at quarter turn 0: x = X - cx, z = cy - Y."""
    return np.asarray(X) - centre[0], centre[1] - np.asarray(Y)


def tri_points(a, b, c, step=0.01, per=150000):
    """Points on a regular barycentric lattice over each triangle, no further apart than `step`;
    yields (points, triangle index) in chunks."""
    emax = np.maximum(np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1)), np.linalg.norm(a - c, axis=1))
    nsub = np.clip(np.ceil(emax / step).astype(int), 1, 600)
    for k in np.unique(nsub):
        idx = np.nonzero(nsub == k)[0]
        ii, jj = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
        msk = ii + jj <= k
        bi, bj = ii[msk] / k, jj[msk] / k
        n = max(1, per // len(bi))
        for i0 in range(0, len(idx), n):
            q = idx[i0:i0 + n]
            pts = a[q][:, None, :] + bi[None, :, None] * (b[q] - a[q])[:, None, :] + bj[None, :, None] * (c[q] - a[q])[:, None, :]
            yield pts.reshape(-1, 3), np.repeat(q, len(bi))


def grid_png(arr, lo, hi, x0, y1, res, scale, out, label, step=1.0):
    """A false-colour picture of a north-up raster (rows from Y = y1 down, columns from X = x0) with a
    metric grid in E57 X and Y."""
    from PIL import Image, ImageDraw
    t = np.clip((np.nan_to_num(arr, nan=lo) - lo) / (hi - lo), 0, 1)
    rgb = np.stack([t, 1 - np.abs(t - 0.5) * 2, 1 - t], -1)
    rgb[~np.isfinite(arr)] = 0
    H, W = arr.shape
    im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((W * scale, H * scale), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for g in np.arange(np.ceil(x0 / step) * step, x0 + W * res, step):
        x = (g - x0) / res * scale
        d.line([(x, 0), (x, im.size[1])], fill=(255, 255, 255))
        d.text((x + 2, 2), "X%g" % g, fill=(255, 255, 255))
    for g in np.arange(np.ceil((y1 - H * res) / step) * step, y1, step):
        y = (y1 - g) / res * scale
        d.line([(0, y), (im.size[0], y)], fill=(255, 255, 255))
        d.text((2, y + 2), "Y%g" % g, fill=(255, 255, 255))
    d.text((10, im.size[1] - 14), label, fill=(255, 255, 255))
    im.save(out)

"""What each of the Grand Hall's five windows sees: rays through each window's glass (5 cm grid, the sashes'
1.11 m light from sill to top and, for the arches, the fanlight's half disc) from a pose, cast against the
published city model (merchant-city-v2.bin), classified by what they meet. Distances from the glass, heights above
the pavement (y = -3.79). Poses: Blake's room pose, the planner's opening view, straight out of the glass, and each
window's own panorama station (scan_042, 041, 039, 038, 040).

Usage: python3 window_sight.py <out.json>   (a minute or two, about 1 GB)"""
import json
import struct
import sys
from pathlib import Path

import numpy as np


def load(path):
    b = open(path, "rb").read()
    assert b[:4] == b"VVCX"
    _, vc, ic = struct.unpack_from("<III", b, 4)
    pos = np.frombuffer(b, "<i2", vc * 3, 16).reshape(-1, 3).astype(np.float64) / 100
    idx = np.frombuffer(b, "<u4", ic, 16 + vc * 6).reshape(-1, 3)
    return pos, idx

def triangles(pos, idx, centre=(0, 0, 0), radius=1e9):
    t = pos[idx]
    c = t.mean(1)
    keep = np.hypot(c[:, 0] - centre[0], c[:, 2] - centre[2]) < radius
    return t[keep]

def cast(tris, origins, dirs, chunk=1024):
    """Nearest hit distance and triangle index for each ray (inf / -1 where none). Moller-Trumbore."""
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    n = len(dirs)
    best = np.full(n, np.inf)
    which = np.full(n, -1)
    for s in range(0, len(tris), chunk):
        a, b1, b2 = v0[s:s + chunk], e1[s:s + chunk], e2[s:s + chunk]
        p = np.cross(dirs[:, None, :], b2[None])                 # (n, m, 3)
        det = np.einsum("nmk,mk->nm", p, b1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = origins[:, None, :] - a[None]
        u = np.einsum("nmk,nmk->nm", tv, p) * inv
        q = np.cross(tv, b1[None])
        v = np.einsum("nk,nmk->nm", dirs, q) * inv
        t = np.einsum("nmk,mk->nm", q, b2) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-4)
        t = np.where(hit, t, np.inf)
        j = np.argmin(t, 1)
        tj = t[np.arange(n), j]
        better = tj < best
        best[better] = tj[better]
        which[better] = j[better] + s
    return best, which

def normals(tris):
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)

MODEL = Path(__file__).resolve().parents[3] / "packages/web/public/rooms/grand-hall/context-2020-lidar/merchant-city-v2.bin"
PAVE = -3.79
W2 = 5.295
L2 = 21.135 / 2
XC = 8.795
def wx(scan_x): return -L2 + (L2 + XC - scan_x)
WINDOWS = [  # id, centre x, sill, top, glass z, fanlight
    ("arch-fireplace", wx(17.83) - 0.003, 0.915, 3.762, -W2 - 0.899, True),
    ("window-fireplace", wx(13.71) - 0.006, 0.935, 3.25, -W2 - 0.814, False),
    ("arch-centre", wx(8.82) - 0.009, 0.915, 3.815, -W2 - 0.569, True),
    ("window-end", wx(3.93) - 0.004, 0.935, 3.25, -W2 - 0.817, False),
    ("arch-end", wx(-0.19) - 0.017, 0.915, 3.769, -W2 - 0.9, True),
]
def glass_points(win, step=0.05):
    _, cx, sill, top, gz, fan = win
    pts = []
    for x in np.arange(cx - 0.555 + step / 2, cx + 0.555, step):
        for y in np.arange(sill + step / 2, top, step):
            pts.append((x, y, gz))
    if fan:
        r = 1.2
        for x in np.arange(cx - r + step / 2, cx + r, step):
            for y in np.arange(top + step / 2, top + r, step):
                if (x - cx) ** 2 + (y - top) ** 2 < r * r: pts.append((x, y, gz))
    return np.array(pts)

def classify(p, n):
    x, y, z = p
    if n[1] > 0.7 and y < PAVE + 0.8:
        if z > -24.4: return "Glassford Street (road and pavements)"
        if abs(x) < 7 and z > -84: return "Garth Street (road)"
        return "ground beyond"
    if n[2] > 0.6 and -27 < z < -23.3:
        if x < -35: return "frontage opposite: tall block north of the Bacchus building (x -51..-35)"
        if x < -5.5: return "frontage opposite: the Bacchus building, north corner of Garth Street (x -35..-5.5)"
        if x < 4.5: return "frontage opposite (mouth of Garth Street)"
        if x < 15.5: return "frontage opposite: 76 Glassford Street, the Blane Valley tenement, south corner of Garth Street (x 4.5..15.5)"
        if x < 30: return "frontage opposite: the buildings south of the tenement (x 15.5..30)"
        return "frontage opposite: further south (x > 30)"
    if abs(n[0]) > 0.6 and z < -24.4 and abs(x) < 8:
        return "Garth Street, north side wall" if n[0] > 0 else "Garth Street, south side wall"
    if z < -75 and abs(x) < 12: return "the building closing Garth Street (Hutcheson Street side)"
    if n[1] > 0.7: return "roofs"
    return "other walls"

def sight(eye, tris, nrm, wins=WINDOWS):
    out = {}
    for win in wins:
        g = glass_points(win)
        o = np.repeat(np.array(eye, float)[None], len(g), 0) if eye is not None else None
        if eye is None:  # straight out of the glass, perpendicular
            o = g.copy(); d = np.tile([0, 0, -1.0], (len(g), 1))
        else:
            d = g - o; d /= np.linalg.norm(d, axis=1, keepdims=True)
            o = g.copy()
        t, w = cast(tris, o + d * 0.4, d)  # start just past the window wall's outer face
        cats = {}
        for i in range(len(g)):
            if not np.isfinite(t[i]):
                key = "sky"
                cats.setdefault(key, []).append((np.nan, np.nan, np.nan, np.nan))
                continue
            p = o[i] + d[i] * (t[i] + 0.4)
            key = classify(p, nrm[w[i]])
            cats.setdefault(key, []).append((t[i] + 0.4, p[1] - PAVE, p[0], p[2]))
        total = len(g)
        rep = {}
        for k, v in sorted(cats.items(), key=lambda kv: -len(kv[1])):
            a = np.array(v)
            entry = {"share": round(len(v) / total, 3)}
            if k != "sky":
                entry["distance_m"] = [round(float(np.percentile(a[:, 0], q)), 1) for q in (5, 50, 95)]
                entry["height_above_pavement_m"] = [round(float(np.percentile(a[:, 1], q)), 1) for q in (5, 50, 95)]
                entry["x_m"] = [round(float(np.percentile(a[:, 2], q)), 1) for q in (5, 50, 95)]
                entry["z_m"] = [round(float(np.percentile(a[:, 3], q)), 1) for q in (5, 50, 95)]
            rep[k] = entry
        out[win[0]] = rep
    return out

if __name__ == "__main__":
    pos, idx = load(MODEL)
    tris = triangles(pos, idx, radius=200)
    tris = tris[tris[:, :, 2].min(1) < -6.0]
    nrm = normals(tris)
    unit = lambda v: np.array(v) / np.linalg.norm(v)
    poses = {
        "room (Blake's pose: 1.5, 1.6, 4.2 toward -1, 2.2, -5.3)": [1.5, 1.6, 4.2],
        "overview (the opening view: 22 m from -1, 0, -1 along 11.2, 12.6, 14.2)": list(np.array([-1, 0, -1]) + unit([11.2, 12.6, 14.2]) * 22),
        "straight out (perpendicular to the glass)": None,
    }
    stations = {"arch-fireplace": [-8.926, 1.414, -4.648], "window-fireplace": [-4.895, 1.448, -4.62], "arch-centre": [-0.132, 1.474, -4.572],
                "window-end": [4.867, 1.46, -4.156], "arch-end": [8.986, 1.452, -4.509]}
    res = {k: sight(v, tris, nrm) for k, v in poses.items()}
    res["each window's own panorama station (scan_042, 041, 039, 038, 040)"] = {
        w[0]: sight(stations[w[0]], tris, nrm, [w])[w[0]] for w in WINDOWS}
    json.dump(res, open(sys.argv[1], "w"), indent=1)
    for pose, wins in res.items():
        print("==", pose)
        for wid, rep in wins.items():
            print("  ", wid)
            for k, e in rep.items():
                print(f"      {e['share']:5.1%}  {k}  dist {e.get('distance_m')} h {e.get('height_above_pavement_m')} x {e.get('x_m')}")

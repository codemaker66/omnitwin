"""Whole-wall orthographic elevations at 1 cm from the native skybox faces: each texel takes the single
best-placed station (cos^4/d^3, no occlusion test), positions from the mesh depth raster. Openings overlaid."""
import sys, json, gc; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import *
from cubelib import Station
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
S, m = stations()
RES = 0.01
WALLS = {"window_+X": (1.3, 13.8), "fireplace_-X": (1.3, 13.8), "front_-Y": (-5.9, 1.7), "rear_+Y": (-5.9, 1.7)}
OPEN = {  # (label, along-wall a, b, v0, v1, kind)
    "window_+X": [("bay S 1.90", 3.976, 5.876, 1.20, 5.39, "arch"), ("bay C 1.88", 6.559, 8.439, 1.20, 5.38, "arch"), ("bay N 1.90", 9.125, 11.025, 1.20, 5.39, "arch"),
                  ("glass", 6.69, 8.31, 1.31, 5.30, "arch"), ("D2 1.12", 1.80, 2.92, 0, 2.45, "rect"), ("D6 1.09", 12.125, 13.215, 0, 2.46, "rect")],
    "fireplace_-X": [("D5 1.22", 1.81, 3.025, 0, 2.43, "rect"), ("D4 1.23", 12.10, 13.325, 0, 2.46, "rect"), ("shelf 1.55", 6.30, 8.75, 1.40, 1.55, "rect"),
                     ("surround", 6.55, 8.525, 0.08, 1.40, "rect"), ("opening", 6.925, 8.16, 0.08, 0.99, "rect")],
    "front_-Y": [("D1 1.10", -0.555, 0.545, 0, 2.45, "rect"), ("D3 1.19", -4.675, -3.485, 0, 2.44, "rect")],
    "rear_+Y": [],
}
LEVELS = [(0.19, "skirting"), (1.06, "dado cap"), (1.24, "dado top"), (2.80, "panel cornice"), (3.16, "panel top"), (5.45, "cornice"), (5.515, "ceiling field")]
try: F = ImageFont.truetype("arial.ttf", 14)
except Exception: F = None
for name, (w0, w1) in WALLS.items():
    mt = meta[name]; r = mt["res"]; sgn = mt["right"][0] + mt["right"][1]
    d = np.nan_to_num(np.load(OUT + f"/scripts/elev_{name}_depth.npy"), nan=0.0)
    ua, ub = sorted([sgn * w0, sgn * w1]); v0, v1 = -0.02, 5.62
    nu = int(round((ub - ua) / RES)); nv = int(round((v1 - v0) / RES))
    U = ua + (np.arange(nu) + 0.5) * RES; V = v1 - (np.arange(nv) + 0.5) * RES
    UU, VV = np.meshgrid(U, V)
    fc = (UU - mt["urange"][0]) / r - 0.5; fr = (mt["vrange"][1] - VV) / r - 0.5
    c0 = np.clip(np.floor(fc).astype(int), 0, d.shape[1] - 2); r0 = np.clip(np.floor(fr).astype(int), 0, d.shape[0] - 2)
    tc = np.clip(fc - c0, 0, 1); tr = np.clip(fr - r0, 0, 1)
    D = (d[r0, c0] * (1 - tc) + d[r0, c0 + 1] * tc) * (1 - tr) + (d[r0 + 1, c0] * (1 - tc) + d[r0 + 1, c0 + 1] * tc) * tr
    nin = np.array([mt["nin"][0], mt["nin"][1], 0.0]); R = np.array([mt["right"][0], mt["right"][1], 0.0])
    ref = np.array([mt["ref"][0] or 0.0, mt["ref"][1] or 0.0, 0.0]); base = ref - (ref @ R) * R
    P = (base + UU[..., None] * R + D[..., None] * nin); P[..., 2] = VV; P = P.reshape(-1, 3)
    ids = list(range(49, 75)) + ([48] if name == "front_-Y" else [])
    best = np.full(len(P), -1); bw = np.zeros(len(P))
    for i in ids:
        t = S[i]["t"]; v = P - t; dist = np.linalg.norm(v, axis=1); cos = (v @ -nin) / dist
        if (t - ref) @ nin < 0.2: continue
        w = np.where(cos > 0.2, cos ** 4 / dist ** 3, 0)
        upd = w > bw; best[upd] = i; bw[upd] = w[upd]
    col = np.zeros((len(P), 3), np.float32)
    for i in np.unique(best[best >= 0]):
        st = Station(int(i)); msk = best == i
        c = st.sample_points(P[msk]) * (st.gain / np.mean(st.gain))[None, :] ** 0  # exposure left as captured
        col[msk] = c; del st; gc.collect()
    im = Image.fromarray((np.clip(col.reshape(nv, nu, 3), 0, 1) * 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
    X = lambda wv: (sgn * wv - ua) / RES; Yp = lambda vv: (v1 - vv) / RES
    for lab, a, b, va, vb, kind in OPEN[name]:
        xa, xb = sorted([X(a), X(b)])
        if kind == "rect": dr.rectangle([xa, Yp(vb), xb, Yp(va)], outline=(255, 0, 255), width=2)
        else:
            rad = (xb - xa) / 2; spring = vb - rad * RES
            dr.line([(xa, Yp(va)), (xa, Yp(spring))], fill=(255, 140, 0), width=2); dr.line([(xb, Yp(va)), (xb, Yp(spring))], fill=(255, 140, 0), width=2)
            dr.line([(xa, Yp(va)), (xb, Yp(va))], fill=(255, 140, 0), width=2)
            dr.arc([xa, Yp(spring) - rad, xb, Yp(spring) + rad], 180, 360, fill=(255, 140, 0), width=2)
        dr.text((xa + 4, Yp(vb) + 4 if kind == "rect" else Yp(va) + 4), lab, fill=(255, 255, 0), font=F)
    for vv, lab in LEVELS:
        dr.line([(0, Yp(vv)), (40, Yp(vv))], fill=(0, 255, 255), width=2); dr.text((44, Yp(vv) - 8), f"{vv:.2f} {lab}", fill=(0, 255, 255), font=F)
    for wv in np.arange(np.ceil(min(w0, w1)), max(w0, w1), 1.0):
        dr.line([(X(wv), nv - 20), (X(wv), nv)], fill=(255, 255, 0), width=2); dr.text((X(wv) + 3, nv - 36), f"{'Y' if 'X' in name else 'X'} {wv:.0f}", fill=(255, 255, 0), font=F)
    im.save(OUT + f"/elevation_{name}_hires.jpg", quality=88)
    print(name, im.size, "stations used:", sorted(int(i) for i in np.unique(best[best >= 0])))

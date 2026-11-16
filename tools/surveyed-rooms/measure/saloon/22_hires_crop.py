"""Orthographic elevation crop of a wall at fine resolution, coloured from ONE station's native 4096^2 skybox faces;
surface positions from the mesh depth raster (2 cm, bilinear). Usage: wall w0 w1 v0 v1 res station out [gridstep]"""
import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from common import *
from cubelib import Station
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
def render(name, w0, w1, v0, v1, res, sid, out, grid=0.1, label_every=0.5):
    mt = meta[name]; r = mt["res"]; sgn = mt["right"][0] + mt["right"][1]
    d = np.load(OUT + f"/scripts/elev_{name}_depth.npy"); d = np.nan_to_num(d, nan=0.0)
    ua, ub = sorted([sgn * w0, sgn * w1])
    nu = int(round((ub - ua) / res)); nv = int(round((v1 - v0) / res))
    U = ua + (np.arange(nu) + 0.5) * res; V = v1 - (np.arange(nv) + 0.5) * res
    UU, VV = np.meshgrid(U, V)
    fc = (UU - mt["urange"][0]) / r - 0.5; fr = (mt["vrange"][1] - VV) / r - 0.5
    c0 = np.clip(np.floor(fc).astype(int), 0, d.shape[1] - 2); r0 = np.clip(np.floor(fr).astype(int), 0, d.shape[0] - 2)
    tc = np.clip(fc - c0, 0, 1); tr = np.clip(fr - r0, 0, 1)
    D = (d[r0, c0] * (1 - tc) + d[r0, c0 + 1] * tc) * (1 - tr) + (d[r0 + 1, c0] * (1 - tc) + d[r0 + 1, c0 + 1] * tc) * tr
    nin = np.array([mt["nin"][0], mt["nin"][1], 0.0]); R = np.array([mt["right"][0], mt["right"][1], 0.0])
    ref = np.array([mt["ref"][0] or 0.0, mt["ref"][1] or 0.0, 0.0]); base = ref - (ref @ R) * R
    P = base + UU[..., None] * R + D[..., None] * nin; P[..., 2] = VV
    st = Station(sid)
    col = st.sample_points(P.reshape(-1, 3)).reshape(nv, nu, 3)
    im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
    tick = lambda a: abs(a / label_every - round(a / label_every)) < 1e-6
    for wv in np.arange(np.ceil(min(w0, w1) / grid) * grid, max(w0, w1) + 1e-9, grid):
        x = (sgn * wv - ua) / res
        dr.line([(x, 0), (x, 6 if not tick(wv) else 14)], fill=(255, 255, 0)); dr.line([(x, nv - (6 if not tick(wv) else 14)), (x, nv)], fill=(255, 255, 0))
        if tick(wv): dr.text((x + 2, 14), f"{wv:.1f}", fill=(255, 255, 0))
    for vv in np.arange(np.ceil(v0 / grid) * grid, v1 + 1e-9, grid):
        y = (v1 - vv) / res
        dr.line([(0, y), (6 if not tick(vv) else 14, y)], fill=(0, 255, 255)); dr.line([(nu - (6 if not tick(vv) else 14), y), (nu, y)], fill=(0, 255, 255))
        if tick(vv): dr.text((16, y - 5), f"{vv:.1f}", fill=(0, 255, 255))
    im.save(out)
    return im.size
if __name__ == "__main__":
    a = sys.argv
    print(render(a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]), float(a[6]), int(a[7]), a[8]))

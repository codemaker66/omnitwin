import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from common import *
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
room = (cen[:, 0] > -5.75) & (cen[:, 0] < 1.62) & (cen[:, 1] > 1.5) & (cen[:, 1] < 13.62)
# floor
fm = room & (nn[:, 2] > 0.95) & (cen[:, 2] < 0.4) & (cen[:, 2] > -0.3)
zs, ws = cen[fm, 2], area[fm]
h, e = np.histogram(zs, bins=np.arange(-0.1, 0.1001, 0.002), weights=ws)
k = np.argmax(h)
print("floor: area %.1f m2, peak Z %.4f, weighted median %.4f, p5 %.4f p95 %.4f" % (ws.sum(), e[k] + 0.001, np.median(np.repeat(zs, 1)), np.percentile(zs, 5), np.percentile(zs, 95)))
A = np.c_[cen[fm, 0], cen[fm, 1], np.ones(fm.sum())]
inl = np.abs(zs - (e[k] + 0.001)) < 0.02
coef = np.linalg.lstsq(A[inl] * np.sqrt(ws[inl])[:, None], zs[inl] * np.sqrt(ws[inl]), rcond=None)[0]
res = zs[inl] - A[inl] @ coef
print("floor plane fit: Z = %.5f X + %.5f Y + %.4f  (slope %.1f mm/m along X, %.1f mm/m along Y), rms %.1f mm, inlier area %.1f m2" % (coef[0], coef[1], coef[2], coef[0] * 1000, coef[1] * 1000, np.sqrt(np.average(res ** 2, weights=ws[inl])) * 1000, ws[inl].sum()))
zc = coef @ [-2.065, 7.565, 1]
print("floor Z at room centre (-2.065, 7.565): %.4f; corners:" % zc, [round(float(coef @ [x, y, 1]), 4) for x, y in ((-5.5, 1.6), (1.3, 1.6), (1.3, 13.5), (-5.5, 13.5))])
# ceiling: down-facing triangles above 4.8 m
cm = room & (nn[:, 2] < -0.9) & (cen[:, 2] > 4.8)
zs2, ws2 = cen[cm, 2], area[cm]
h2, e2 = np.histogram(zs2, bins=np.arange(4.8, 6.6, 0.01), weights=ws2)
print("ceiling down-facing area by 1 cm bins (m2), bins with >= 0.5 m2:")
print("  ", [(round(e2[i] + 0.005, 3), round(h2[i], 2)) for i in range(len(h2)) if h2[i] >= 0.5])
# ceiling height map: lowest down-facing surface above 5.0 m in 5 cm cells, from rasterising triangle samples
res_ = 0.05; X0, X1, Y0, Y1 = -6.0, 2.4, 1.2, 14.0
Wd, Hd = int((X1 - X0) / res_), int((Y1 - Y0) / res_)
zmap = np.full((Hd, Wd), np.inf)
cm2 = (cen[:, 0] > X0) & (cen[:, 0] < X1) & (cen[:, 1] > Y0) & (cen[:, 1] < Y1) & (nn[:, 2] < -0.3) & (cen[:, 2] > 5.0) & (cen[:, 2] < 7.0)
A_, B_, C_ = a[cm2], b[cm2], c[cm2]
for i0 in range(0, len(A_), 20000):
    sl = slice(i0, i0 + 20000)
    emax = np.maximum(np.linalg.norm(B_[sl] - A_[sl], axis=1), np.linalg.norm(C_[sl] - A_[sl], axis=1))
    for kk in np.unique(np.clip(np.ceil(emax / 0.02).astype(int), 1, 200)):
        q = np.nonzero(np.clip(np.ceil(emax / 0.02).astype(int), 1, 200) == kk)[0] + i0
        ii, jj = np.meshgrid(np.arange(kk + 1), np.arange(kk + 1)); msk = ii + jj <= kk
        bi, bj = ii[msk] / kk, jj[msk] / kk
        pts = (A_[q][:, None] + bi[None, :, None] * (B_[q] - A_[q])[:, None] + bj[None, :, None] * (C_[q] - A_[q])[:, None]).reshape(-1, 3)
        col = ((pts[:, 0] - X0) / res_).astype(int); row = ((Y1 - pts[:, 1]) / res_).astype(int)
        ok = (col >= 0) & (col < Wd) & (row >= 0) & (row < Hd)
        np.minimum.at(zmap, (row[ok], col[ok]), pts[ok, 2])
np.save(OUT + "/scripts/ceiling_zmap.npy", zmap)
z = np.where(np.isfinite(zmap), zmap, np.nan)
lo, hi = 5.3, 6.0
t = np.clip((np.nan_to_num(z, nan=lo) - lo) / (hi - lo), 0, 1)
rgb = np.stack([t, 1 - np.abs(t - 0.5) * 2, 1 - t], -1); rgb[~np.isfinite(zmap)] = 0
im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((Wd * 4, Hd * 4), Image.NEAREST)
d = ImageDraw.Draw(im)
for gx in np.arange(-6, 2.5, 1.0):
    x = (gx - X0) / res_ * 4; d.line([(x, 0), (x, im.size[1])], fill=(255, 255, 255)); d.text((x + 2, 2), f"X{gx:.0f}", fill=(255, 255, 255))
for gy in np.arange(2, 14.1, 1.0):
    y = (Y1 - gy) / res_ * 4; d.line([(0, y), (im.size[0], y)], fill=(255, 255, 255)); d.text((2, y + 2), f"Y{gy:.0f}", fill=(255, 255, 255))
d.text((10, im.size[1] - 20), f"lowest down-facing surface above 5.0 m: blue {lo} m .. red {hi} m", fill=(255, 255, 255))
im.save(OUT + "/ceiling_heightmap.png")
# profiles along the room centre lines
def pr(axis_val, along, rng):
    out = []
    for s in np.arange(rng[0], rng[1], 0.1):
        if along == "Y": col = int((axis_val - X0) / res_); row = int((Y1 - s) / res_)
        else: col = int((s - X0) / res_); row = int((Y1 - axis_val) / res_)
        v = z[max(row - 1, 0):row + 2, max(col - 1, 0):col + 2]
        out.append(f"{s:.1f}:{np.nanmedian(v):.3f}" if np.isfinite(v).any() else f"{s:.1f}:--")
    return out
for lab, args in (("along Y at X=-2.065 (centre line)", (-2.065, "Y", (1.4, 13.8))), ("along X at Y=7.565 (centre line)", (7.565, "X", (-5.9, 2.4))), ("along X at Y=4.0", (4.0, "X", (-5.9, 2.4)))):
    o = pr(*args); print(lab)
    for i in range(0, len(o), 12): print("   " + "  ".join(o[i:i + 12]))

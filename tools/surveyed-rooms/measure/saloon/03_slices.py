import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from common import *
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
box = (-7.5, 0.0, 4.5, 15.0)  # X0, Y0, X1, Y1
sel = (cen[:, 0] > box[0] - 1) & (cen[:, 0] < box[2] + 1) & (cen[:, 1] > box[1] - 1) & (cen[:, 1] < box[3] + 1)
a, b, c = a[sel], b[sel], c[sel]
res = 0.01
W = int((box[2] - box[0]) / res); H = int((box[3] - box[1]) / res)
def raster(zs):
    acc = np.zeros((H, W), np.float32)
    for z0 in zs:
        segs, _ = slice_segments(a, b, c, z0)
        L = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
        n = np.maximum(2, (L / 0.005).astype(int))
        tt = np.concatenate([np.linspace(0, 1, k) for k in n])
        rep = np.repeat(np.arange(len(segs)), n)
        pts = segs[rep, 0] + (segs[rep, 1] - segs[rep, 0]) * tt[:, None]
        col = ((pts[:, 0] - box[0]) / res).astype(int); row = ((box[3] - pts[:, 1]) / res).astype(int)
        ok = (col >= 0) & (col < W) & (row >= 0) & (row < H)
        np.add.at(acc, (row[ok], col[ok]), 1)
    return acc
for name, zs in (("band1.0-1.6", np.arange(1.0, 1.601, 0.05)), ("z2.6", [2.6]), ("z4.0", [4.0]), ("z0.3", [0.3])):
    acc = raster(zs)
    img = (255 - np.clip(acc / max(1, np.percentile(acc[acc > 0], 60)) * 255, 0, 255)).astype(np.uint8)
    im = Image.fromarray(img).convert("RGB"); d = ImageDraw.Draw(im)
    for gx in np.arange(-7, 4.6, 1.0):
        x = (gx - box[0]) / res; d.line([(x, 0), (x, H)], fill=(255, 200, 200)); d.text((x + 2, 2), f"X{gx:.0f}", fill=(200, 0, 0))
    for gy in np.arange(0, 15.1, 1.0):
        y = (box[3] - gy) / res; d.line([(0, y), (W, y)], fill=(200, 200, 255)); d.text((2, y + 2), f"Y{gy:.0f}", fill=(0, 0, 200))
    S, m = stations()
    for i in range(48, 75):
        t = S[i]["t"]; x = (t[0] - box[0]) / res; y = (box[3] - t[1]) / res
        d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(0, 150, 0), width=2); d.text((x + 8, y - 6), str(i), fill=(0, 120, 0))
    im.save(OUT + f"/slice_{name}.png")
    np.save(OUT + f"/scripts/raster_{name}.npy", acc)
    print(name, im.size)

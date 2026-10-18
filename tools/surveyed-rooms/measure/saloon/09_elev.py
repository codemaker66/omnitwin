"""Orthographic wall elevations: a depth raster of the mesh seen from inside the room along each wall's
normal (first surface within a slab), coloured from the 512 px panoramas (robust weighted median of the
4 best-placed stations, exposure-corrected). No occlusion test: free-standing objects near a wall show."""
import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from common import *
RES = 0.02
P, I, C = load_mesh()
a, b, c, nn, area, cen = tri_geometry(P, I)
S, m = stations()
ST = [S[i] for i in range(48, 75)]
PAN = {s["id"]: np.asarray(Image.open(PANO + s["id"] + ".webp").convert("RGB")).astype(np.float32) / 255 for s in ST}
def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def l2s(x): x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
def sample(img, v):
    H, W = img.shape[:2]
    az = np.arctan2(v[:, 1], v[:, 0]) % (2 * np.pi); el = np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1]))
    fx = az / (2 * np.pi) * W - 0.5; fy = (np.pi / 2 - el) / np.pi * H - 0.5
    x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int); tx = (fx - x0)[:, None]; ty = (fy - y0)[:, None]
    x0w, x1w = x0 % W, (x0 + 1) % W; y0c, y1c = np.clip(y0, 0, H - 1), np.clip(y0 + 1, 0, H - 1)
    return (img[y0c, x0w] * (1 - tx) + img[y0c, x1w] * tx) * (1 - ty) + (img[y1c, x0w] * (1 - tx) + img[y1c, x1w] * tx) * ty
# wall: name, inward normal (XY), reference offset along the outward axis, right vector, u range (along right), slab behind/in front
WALLS = {
    "window_+X": dict(nin=(-1, 0), ref=(1.665, None), right=(0, -1), urange=(-14.0, -1.0)),
    "fireplace_-X": dict(nin=(1, 0), ref=(-5.80, None), right=(0, 1), urange=(1.0, 14.0)),
    "front_-Y": dict(nin=(0, 1), ref=(None, 1.48), right=(-1, 0), urange=(-2.0, 6.2)),
    "rear_+Y": dict(nin=(0, -1), ref=(None, 13.645), right=(1, 0), urange=(-6.2, 2.0)),
}
VR = (-0.1, 6.0)
def rasterize(w, behind=0.9, front=0.7):
    nin = np.array([w["nin"][0], w["nin"][1], 0.0]); R = np.array([w["right"][0], w["right"][1], 0.0])
    refpt = np.array([w["ref"][0] if w["ref"][0] is not None else 0.0, w["ref"][1] if w["ref"][1] is not None else 0.0, 0.0])
    dd = lambda X: (X - refpt) @ nin       # + into the room
    uu = lambda X: X @ R
    dc = dd(cen); uc = uu(cen)
    sel = (dc > -behind - 0.3) & (dc < front + 0.3) & (uc > w["urange"][0] - 0.5) & (uc < w["urange"][1] + 0.5) & (cen[:, 2] > VR[0] - 0.3) & (cen[:, 2] < VR[1] + 0.3) & (nn @ nin > 0.0)
    A, B, Cc = a[sel], b[sel], c[sel]
    emax = np.maximum(np.maximum(np.linalg.norm(B - A, axis=1), np.linalg.norm(Cc - B, axis=1)), np.linalg.norm(A - Cc, axis=1))
    nsub = np.clip(np.ceil(emax / (RES * 0.5)).astype(int), 1, 400)
    Wd = int((w["urange"][1] - w["urange"][0]) / RES); Hd = int((VR[1] - VR[0]) / RES)
    depth = np.full((Hd, Wd), -np.inf)
    for k in np.unique(nsub):
        idx = np.nonzero(nsub == k)[0]
        ii, jj = np.meshgrid(np.arange(k + 1), np.arange(k + 1)); msk = ii + jj <= k
        bi, bj = ii[msk] / k, jj[msk] / k
        for ch in range(0, len(idx), max(1, 200000 // len(bi))):
            q = idx[ch:ch + max(1, 200000 // len(bi))]
            pts = A[q][:, None, :] + bi[None, :, None] * (B[q] - A[q])[:, None, :] + bj[None, :, None] * (Cc[q] - A[q])[:, None, :]
            pts = pts.reshape(-1, 3)
            d_ = dd(pts); u_ = uu(pts)
            ok = (d_ > -behind) & (d_ < front)
            col = ((u_ - w["urange"][0]) / RES).astype(int); row = ((VR[1] - pts[:, 2]) / RES).astype(int)
            ok &= (col >= 0) & (col < Wd) & (row >= 0) & (row < Hd)
            np.maximum.at(depth, (row[ok], col[ok]), d_[ok])
    return depth, nin, R, refpt
out = {}
for name, w in WALLS.items():
    depth, nin, R, refpt = rasterize(w)
    Hd, Wd = depth.shape
    uu_ = w["urange"][0] + (np.arange(Wd) + 0.5) * RES; vv_ = VR[1] - (np.arange(Hd) + 0.5) * RES
    U, V = np.meshgrid(uu_, vv_)
    have = np.isfinite(depth)
    # world position: refpt + u*R (component along R) + d*nin + Z
    Pw = np.zeros((Hd, Wd, 3))
    base = refpt - (refpt @ R) * R
    Pw[..., :] = base + U[..., None] * R + np.where(have, depth, 0)[..., None] * nin
    Pw[..., 2] = V
    pts = Pw[have]
    cols, wts = [], []
    for s in ST:
        v = pts - s["t"]; dist = np.linalg.norm(v, axis=1); cos = (v @ -nin) / dist
        wgt = np.where(cos > 0.15, cos ** 4 / dist ** 3, 0)
        if (s["t"] - refpt) @ nin < 0.2: wgt[:] = 0
        g = s["exposure"]["gain"] * np.array(s["exposure"]["wb"])
        cols.append(s2l(sample(PAN[s["id"]], v)) * g); wts.append(wgt)
    cols = np.stack(cols, 1); wts = np.stack(wts, 1)
    order = np.argsort(-wts, axis=1)[:, :4]
    cw = np.take_along_axis(wts, order, 1); cc = np.take_along_axis(cols, order[..., None], 1)
    lum = cc @ np.array([0.2126, 0.7152, 0.0722])
    # weighted median by luminance
    o2 = np.argsort(lum, axis=1); cw2 = np.take_along_axis(cw, o2, 1); cs = np.cumsum(cw2, 1)
    k = np.argmax(cs >= 0.5 * cs[:, -1:], axis=1)
    pick = np.take_along_axis(o2, k[:, None], 1)[:, 0]
    colour = cc[np.arange(len(cc)), pick]
    img = np.zeros((Hd, Wd, 3)); img[have] = l2s(colour * 1.0)
    Image.fromarray((img * 255).astype(np.uint8)).save(OUT + f"/elevation_{name}_photo.png")
    dimg = np.where(have, depth, np.nan)
    np.save(OUT + f"/scripts/elev_{name}_depth.npy", dimg)
    lo, hi = -0.9, 0.7
    t = np.clip((np.nan_to_num(dimg, nan=lo) - lo) / (hi - lo), 0, 1)
    rgb = np.stack([t, 1 - np.abs(t - 0.5) * 2, 1 - t], -1); rgb[~have] = 0
    Image.fromarray((rgb * 255).astype(np.uint8)).save(OUT + f"/scripts/elev_{name}_depth.png")
    out[name] = dict(urange=w["urange"], vrange=VR, res=RES, right=w["right"], nin=w["nin"], ref=w["ref"])
    print(name, depth.shape, "coverage", have.mean().round(3))
json.dump(out, open(OUT + "/scripts/elev_meta.json", "w"), indent=1)

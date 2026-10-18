"""The floor photograph: flatten-floor.py and pack-floor.py driven by a room config.

flatten: divides out the polished floor's mid-scale blotches (masked blurs over the floor proper),
rolls off broad glare, then refills the boards beneath poorly seen stations (the config's
floor-refill discs, then proj/floor-patches.json) from the same boards refill.shift along their
run, towards the middle. gauss1d, blur and masked_blur are flatten-floor.py's own statements (it
runs at import, so they are copied, and the tests compare them with the original). Gates the
Grand Hall never opens: B17 (no refill.shift: no refills), B18 (the outline is not a rectangle:
texels outside it leave the floor mask before the blurs), B19 (boards run along z: the refill
rolls along rows).
pack: the flattened floor at each survey.outputs.floor size.
"""
import json
import os

import numpy as np
from PIL import Image

from . import legacy
from .relief import polygon_mask


def gauss1d(sigma_px):
    r = int(3 * sigma_px)
    x = np.arange(-r, r + 1)
    k = np.exp(-0.5 * (x / sigma_px) ** 2)
    return k / k.sum()

def blur(a, sigma_px):
    """Separable Gaussian along both axes via FFT-free direct convolution on a downsampled grid for speed."""
    step = max(1, int(sigma_px // 4))
    small = a[::step, ::step]
    k = gauss1d(sigma_px / step)
    pad = len(k) // 2
    def conv(arr, axis):
        p = np.pad(arr, [(pad, pad) if i == axis else (0, 0) for i in range(arr.ndim)], mode='edge')
        out = np.zeros_like(arr)
        for i, w in enumerate(k):
            sl = [slice(None)] * arr.ndim
            sl[axis] = slice(i, i + arr.shape[axis])
            out += w * p[tuple(sl)]
        return out
    s = conv(conv(small, 0), 1)
    # upsample back (bilinear)
    H, W = a.shape[:2]
    ys = np.clip((np.arange(H) / step), 0, s.shape[0] - 1)
    xs = np.clip((np.arange(W) / step), 0, s.shape[1] - 1)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, s.shape[0] - 1); x1 = np.minimum(x0 + 1, s.shape[1] - 1)
    ty = (ys - y0)[:, None]; tx = (xs - x0)[None, :]
    if a.ndim == 3:
        ty = ty[..., None]; tx = tx[..., None]
    top = s[y0][:, x0] * (1 - tx) + s[y0][:, x1] * tx
    bot = s[y1][:, x0] * (1 - tx) + s[y1][:, x1] * tx
    return top * (1 - ty) + bot * ty

def masked_blur(a, m, sigma_px):
    return blur(a * m[..., None], sigma_px) / np.maximum(blur(m, sigma_px), 1e-6)[..., None]


def flatten(room, src, dst, ppm):
    d = np.load(src)
    A = d['rgb'].astype(np.float64)
    w = d['weight']
    lum = A @ np.array([0.2126, 0.7152, 0.0722])
    x0, x1, z0, z1 = room.bbox()
    # The floor proper: seen, and not the dark wall bases at its edges.
    med = np.median(lum[w > 0])
    M = ((w > 0) & (lum > med * 0.45)).astype(np.float64)
    H_, W_ = A.shape[:2]
    cols = (np.arange(W_) + 0.5) / ppm + x0
    rows = z1 - (np.arange(H_) + 0.5) / ppm
    if not room.is_rectangle():                                              # B18
        M = M * polygon_mask(room.cfg['walls']['vertices'], cols[None, :], rows[:, None])
    mid = masked_blur(A, M, 0.25 * ppm)
    big = masked_blur(A, M, 2.5 * ppm)
    F = A / np.maximum(mid, 1e-4) * big
    # Daylight glare by the windows survives as broad bright pools: roll the
    # broad light off above the floor's typical level so no pool reads as a
    # white patch, leaving the boards' own variation untouched.
    lum_big = big @ np.array([0.2126, 0.7152, 0.0722])
    typical = np.median(lum_big[M > 0])
    knee = typical * 1.08
    excess = np.maximum(lum_big - knee, 0)
    target = knee + excess / (1 + excess / (typical * 0.12))
    F = F * (np.where(lum_big > knee, target / np.maximum(lum_big, 1e-6), 1.0))[..., None]
    F = np.where(M[..., None] > 0, F, A)
    refill = room.survey['floorPhoto'].get('refill', {})
    discs = 0
    if 'shift' in refill:
        # Beneath some stations the floor is poorly seen: refill those discs with the same
        # boards further along their run, towards the middle, feathered in where the
        # station's own view starts to count again.
        DISCS = [(e['centre'][0], e['centre'][1], refill['innerFraction'] * e['radius'], e['radius']) for e in room.floor_refills()]
        with open(os.path.join(os.path.dirname(os.path.abspath(src)), 'floor-patches.json')) as f:
            for p in json.load(f):
                DISCS.append((p['x'], p['z'], p['height'] * np.tan(np.radians(p['radius_deg'])),
                              p['height'] * np.tan(np.radians(p['radius_deg'] + refill['easeDeg']))))
        X, Z = np.meshgrid(cols, rows)
        shift = int(round(refill['shift'] * ppm))
        along_z = room.cfg['floor'].get('boardsRun', 'x') == 'z'                # B19
        boards = F.copy()
        for cx, cz, inner, outer in DISCS:
            alpha = np.clip((outer - np.hypot(X - cx, Z - cz)) / (outer - inner), 0, 1)[..., None]
            if alpha.any():
                if along_z:
                    F = F * (1 - alpha) + np.roll(boards, -shift if cz > 0 else shift, axis=0) * alpha
                else:
                    F = F * (1 - alpha) + np.roll(boards, -shift if cx < 0 else shift, axis=1) * alpha
        discs = len(DISCS)
    else:
        print('floor refills skipped: no survey.floorPhoto.refill.shift')               # B17
    np.savez_compressed(dst, rgb=F.astype(np.float32), weight=w)
    print('flattened', A.shape, 'floor texels', int(M.sum()), 'refill discs', discs)


def pack(room, src, out):
    linear_to_srgb = legacy.project().linear_to_srgb
    img = np.clip(linear_to_srgb(np.load(src)['rgb']), 0, 255).astype(np.uint8)
    for f in room.survey['outputs'].get('floor', []):
        size = tuple(f['size'])
        path = f"{out}/{f['file']}"
        Image.fromarray(img).resize(size, Image.LANCZOS).save(path, quality=86, method=6)
        print(path, size, round(os.path.getsize(path) / 1e6, 2), 'MB')

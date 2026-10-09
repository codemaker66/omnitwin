"""Evens out the floor orthophoto's mid-scale blotches.

The polished boards reflect the windows and chandeliers differently from
every station, and each station's view dominates a disc around it; the
result is soft blotches about a metre across. Board-scale detail (below
~0.35 m) and the room's broad fall of light (above ~2.5 m) are real and
kept; the band between is divided out. Masked (normalised) blurs keep the
wall bases from bleeding in.
Usage (in the work directory): python3 $SURVEY/flatten-floor.py <in.npz> <out.npz> <ppm>"""
import sys
import numpy as np

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

src, dst, ppm = sys.argv[1], sys.argv[2], float(sys.argv[3])
d = np.load(src)
A = d['rgb'].astype(np.float64)
w = d['weight']
lum = A @ np.array([0.2126, 0.7152, 0.0722])
# The floor proper: seen, and not the dark wall bases at its edges.
med = np.median(lum[w > 0])
M = ((w > 0) & (lum > med * 0.45)).astype(np.float64)
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

# Four stations stood in the window bays and doorways, where no neighbour
# sees the floor around their tripods well: those discs are refilled with the
# same boards 1.8 m along the hall (the boards run lengthwise, so the strips
# continue), feathered in.
L, W = 21.135, 10.59
DISCS = [(-0.13, -4.41, 0.85), (9.02, -4.10, 0.85), (-0.13, 4.93, 0.7), (8.85, 4.93, 0.7)]
H_, W_ = F.shape[:2]
cols = (np.arange(W_) + 0.5) / ppm - L / 2
rows = W / 2 - (np.arange(H_) + 0.5) / ppm
X, Z = np.meshgrid(cols, rows)
shift = int(round(1.8 * ppm))
for cx, cz, r in DISCS:
    d = np.hypot(X - cx, Z - cz)
    alpha = np.clip((r - d) / (0.25 * r), 0, 1)[..., None]
    source = np.roll(F, -shift if cx < 0 else shift, axis=1)
    F = F * (1 - alpha) + source * alpha
np.savez_compressed(dst, rgb=F.astype(np.float32), weight=w)
print('flattened', A.shape, 'floor texels', int(M.sum()))

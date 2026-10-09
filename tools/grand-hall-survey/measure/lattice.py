import os, sys, json, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
v, P = load('rcp')
img = np.asarray(Image.open('out/rcp.png').convert('L')).astype(np.float32)
H, W = img.shape
X = P[..., 0]; Y = P[..., 1]; valid = P[..., 3] > 0.5
# high-pass (gilt fillets are thin bright lines)
from numpy.fft import rfft2, irfft2
def blur(a, s):
    k = np.exp(-np.arange(-3*s, 3*s+1)**2 / (2*s*s)); k /= k.sum()
    a = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, a)
    return np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, a)
hp = img - blur(img, 6)
hp[~valid] = 0
# hexagon ring template (flat-topped, circumradius R px, 100 px/m), image is mirrored in x (RCP) - hexagon symmetric anyway
def hex_ring(R, width=2.5):
    n = int(R * 1.2)
    yy, xx = np.mgrid[-n:n+1, -n:n+1].astype(np.float32)
    # flat-topped hexagon: distance function
    q = np.abs(xx); r = np.abs(yy)
    d = np.maximum(r * 2 / np.sqrt(3), q + r / np.sqrt(3))  # = circumradius-normalised hex metric * ...
    t = np.exp(-((d - R) ** 2) / (2 * width ** 2))
    return t - t.mean()
best = None
for R in [42, 44, 46, 48]:
    t = hex_ring(R)
    th, tw = t.shape
    F = rfft2(hp, s=(H + th, W + tw)) * rfft2(t[::-1, ::-1], s=(H + th, W + tw))
    c = irfft2(F)[th//2:th//2+H, tw//2:tw//2+W]
    score = np.percentile(c, 99.9)
    if best is None or score > best[0]: best = (score, R, c)
score, R, c = best
print('best outer fillet circumradius px', R)
# peaks: local maxima above threshold
thr = np.percentile(c, 99.5)
peaks = []
cc = c.copy()
for _ in range(400):
    i = np.argmax(cc); y0, x0 = divmod(i, W)
    if cc[y0, x0] < thr: break
    peaks.append((x0, y0, cc[y0, x0]))
    cc[max(0,y0-35):y0+36, max(0,x0-35):x0+36] = -1e9
pts = np.array([(X[y, x], Y[y, x]) for x, y, s in peaks if valid[y, x]])
print('peaks', len(pts))
np.save('analysis/lattice-peaks.npy', pts)
# fit lattice: x = x0 + a*(k + (r%2)/2), y = y0 + b*r
best_fit = None
for a in np.arange(1.015, 1.035, 0.001):
    for b in np.arange(0.875, 0.905, 0.001):
        # phase from residuals
        r = np.round((pts[:, 1] - pts[0, 1]) / b)
        y0 = np.median(pts[:, 1] - b * r)
        r = np.round((pts[:, 1] - y0) / b)
        off = (r % 2) / 2
        k = np.round((pts[:, 0] - pts[0, 0]) / a - off)
        x0 = np.median(pts[:, 0] - a * (k + off))
        k = np.round((pts[:, 0] - x0) / a - off)
        res = np.hypot(pts[:, 0] - (x0 + a * (k + off)), pts[:, 1] - (y0 + b * r))
        err = np.median(res)
        if best_fit is None or err < best_fit[0]: best_fit = (err, a, b, x0, y0)
err, a, b, x0, y0 = best_fit
print(f'lattice a {a:.4f} b {b:.4f} x0 {x0:.4f} y0 {y0:.4f} median residual {err*1000:.1f} mm')
XC, YC = 8.795, -4.963
# phase relative to hall centre: find the row nearest YC and the cell nearest XC within it
r_c = (YC - y0) / b
print('centre row index (frac)', round(r_c, 3))
for r in [np.floor(r_c), np.ceil(r_c)]:
    off = (r % 2) / 2
    k = np.round((XC - x0) / a - off)
    print(f' row {r:.0f} at y {y0 + b*r:.4f} (planner z {y0 + b*r - YC:+.4f}); nearest cell x {x0 + a*(k+off):.4f} (planner x {XC - (x0 + a*(k+off)):+.4f})')

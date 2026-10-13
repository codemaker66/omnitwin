"""Projects the panoramas onto the dome, unrolled by angle and arc length.

Each texel is first moved onto the scanned surface along its normal
(surface-offset.mjs), so the coats of arms standing proud of the measured
profile are coloured where they are.
Usage (in the work directory): python3 $SURVEY/project-dome.py"""
import os, sys, json, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import *
XC, YC, FLOOR = 8.795, -4.963, 0.045
DOME_C = (8.793, -4.974)   # measured dome axis (E57)
# profile (radius, height above floor), as hall-spec / hall-ceiling define it
foot, sc, sr, band, crown_r, plate_r, plate_h, crown_h, ceiling = 3.32, 5.371, 3.67, 2.95, 1.2, 0.86, 8.75, 8.93, 6.7
def height(r):
    if r >= foot: return ceiling
    if r <= band: return min(sc + np.sqrt(max(0, sr*sr - r*r)), crown_h)
    top = sc + np.sqrt(max(0, sr*sr - band*band)); t = (r - band) / (foot - band)
    return ceiling + (top - ceiling) * np.sqrt(max(0, 1 - t*t))
prof = [(foot - (foot - crown_r) * i / 64, 0) for i in range(65)]
prof = [(r, height(r)) for r, _ in prof]
prof += [(plate_r + 0.12, crown_h), (plate_r + 0.02, crown_h - 0.04), (plate_r, plate_h + 0.02), (plate_r - 0.04, plate_h), (0.0, plate_h)]
prof = np.array(prof)
seg = np.hypot(np.diff(prof[:, 0]), np.diff(prof[:, 1]))
S = np.concatenate([[0], np.cumsum(seg)])
total = S[-1]
W, H = 4096, 768
s_rows = (np.arange(H) + 0.5) / H * total            # row 0 = foot
r_rows = np.interp(s_rows, S, prof[:, 0])
h_rows = np.interp(s_rows, S, prof[:, 1])
# inward normal per row from the profile slope
dr = np.gradient(np.interp(s_rows, S, prof[:, 0])); dh = np.gradient(np.interp(s_rows, S, prof[:, 1]))
ln = np.hypot(dr, dh) + 1e-9
nr = -dh / ln; nh = dr / ln
flip = nh > 0; nr[flip] *= -1; nh[flip] *= -1
theta = (np.arange(W) + 0.5) / W * 2 * np.pi          # planner angle from +x toward +z
TH, R = np.meshgrid(theta, r_rows)
_, Hh = np.meshgrid(theta, h_rows)
_, NR = np.meshgrid(theta, nr)
_, NH = np.meshgrid(theta, nh)
# planner -> E57: X = XC - x ; Y = z - 4.963 (=YC) ; Z = h + FLOOR ; dome axis at the measured centre
X = DOME_C[0] - R * np.cos(TH)
Y = DOME_C[1] + R * np.sin(TH)
Z = Hh + FLOOR
pts = np.stack([X, Y, Z], -1).reshape(-1, 3)
nx = -NR * np.cos(TH); ny = NR * np.sin(TH)
nrm = np.stack([nx, ny, NH], -1).reshape(-1, 3)
# Move each texel onto the scanned surface along its normal (the arms and the
# panel mouldings stand proud of the profile), so every station agrees on it.
import subprocess
np.concatenate([pts, nrm], 1).astype(np.float32).tofile('proj/dome-texels.f32')
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'surface-offset.mjs'), 'proj/dome-texels.f32', 'proj/dome-offset.f32', '0.45', '0.3'], check=True)
off = np.fromfile('proj/dome-offset.f32', dtype=np.float32).astype(np.float64)
print('offsets: hit', int(np.isfinite(off).sum()), 'of', len(off), 'p5/50/95', np.nanpercentile(off, [5, 50, 95]).round(3), flush=True)
off = np.where(np.isfinite(off), off, 0.0)
np.save('proj/dome-offset.npy', off.reshape(H, W).astype(np.float32))
pts = pts + nrm * off[:, None]
t0 = time.time()
rgb, ws = project(pts, nrm, stations(), cos_min=0.1)
np.savez_compressed('proj/dome.npz', rgb=rgb.reshape(H, W, 3).astype(np.float32), weight=ws.reshape(H, W).astype(np.float32))
save_rgb('proj/dome.png', rgb, W, H)
print('dome', len(pts), 'uncovered', int((ws == 0).sum()), 'arc', round(total, 3), round(time.time() - t0, 1), 's', flush=True)

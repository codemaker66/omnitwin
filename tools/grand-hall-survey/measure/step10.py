import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from step8 import components
def protrusions(name, hmin, hmax, tmin=0.02, tmax=0.6, min_px=3000):
    off = np.load(f'analysis/off-{name}.npy'); along = np.load(f'analysis/along-{name}.npy'); z = np.load(f'analysis/z-{name}.npy')
    mask = (~np.isnan(off)) & (off > tmin) & (off < tmax) & (z > hmin) & (z < hmax)
    lab, n = components(mask)
    res = []
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() < min_px: continue
        a = along[m]; zz = z[m]
        a0, a1 = np.percentile(a, [1, 99]); z0, z1 = np.percentile(zz, [1, 99])
        res.append((a0, a1, z0, z1, float(np.nanmedian(off[m])), float(np.nanpercentile(off[m], 95)), int(m.sum())))
    res.sort()
    print(f'== {name} protrusions h {hmin}-{hmax}')
    for a0, a1, z0, z1, d50, d95, npx in res:
        print(f'  along {a0:7.3f}..{a1:7.3f} (w {a1-a0:5.3f} c {(a0+a1)/2:7.3f})  h {z0:5.2f}..{z1:5.2f} (ht {z1-z0:4.2f})  proud p50 {d50:.3f} p95 {d95:.3f}  px {npx}')
import sys as _s
protrusions('elev-door', 2.0, 4.6)
protrusions('elev-window', 2.0, 4.0)
protrusions('elev-fire', 0.0, 5.0)
protrusions('elev-end', 0.0, 5.0)

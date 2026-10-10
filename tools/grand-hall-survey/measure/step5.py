import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
FLOOR = 0.045
def wall_profile(name, depth_axis, sign):
    v, P = load(name)
    valid = P[..., 3] > 0.5
    D = np.where(valid, P[..., depth_axis], np.nan)
    Zw = P[..., 2]
    print(f'== {name}')
    # depth (wall plane) by height band, median over the whole wall width
    for z0 in [0.2, 0.6, 1.0, 1.4, 1.7, 2.0, 2.6, 3.2, 3.8, 4.2, 4.5, 4.8, 5.1, 5.4, 5.7, 6.0, 6.3, 6.6]:
        m = valid & (np.abs(Zw - (FLOOR + z0)) < 0.05)
        if m.sum() < 50: continue
        d = D[m]
        print(f'  h {z0:.1f}: depth p10 {np.nanpercentile(d,10):.3f} p50 {np.nanpercentile(d,50):.3f} p90 {np.nanpercentile(d,90):.3f}')
wall_profile('elev-window', 1, -1)
wall_profile('elev-door', 1, 1)
wall_profile('elev-fire', 0, -1)
wall_profile('elev-end', 0, 1)

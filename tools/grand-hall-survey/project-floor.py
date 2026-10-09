"""Projects the panoramas onto the floor (an orthophoto looking down).

Image columns run with planner +x (E57 -X), rows from the door side
(planner +z, E57 +Y) at the top, as hall-geometry.ts maps the floor.
Also lists, in proj/floor-patches.json, the stations whose tripod patch is
too strong to trust near straight down (nadir_patch_radius): planner
position, lens height above the floor and the patch's radius in degrees.
flatten-floor.py refills the boards beneath them.
Usage (in the work directory): python3 $SURVEY/project-floor.py [px-per-metre, default 120]"""
import json, os, sys, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import *
L, W = 21.135, 10.59
XC, YC, FLOOR = 8.795, -4.963, 0.045
PPM = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
w, h = int(round(L * PPM)), int(round(W * PPM))
x = -L / 2 + (np.arange(w) + 0.5) / PPM
z = W / 2 - (np.arange(h) + 0.5) / PPM
Xp, Zp = np.meshgrid(x, z)
pts = np.stack([XC - Xp, Zp + YC, np.full_like(Xp, FLOOR)], -1).reshape(-1, 3)
nrm = np.tile(np.array([[0, 0, 1.0]]), (len(pts), 1))
t0 = time.time()
rgb, ws = project(pts, nrm, stations(), cos_min=0.12, p_cos=2.0, q_dist=2.0, nadir=True, glare=1)
suffix = '' if PPM == 120.0 else f'-{int(PPM)}'
np.savez_compressed(f'proj/floor{suffix}.npz', rgb=rgb.reshape(h, w, 3).astype(np.float32), weight=ws.reshape(h, w).astype(np.float32))
save_rgb(f'proj/floor{suffix}.png', rgb, w, h)
print('floor', len(pts), 'uncovered', int((ws == 0).sum()), round(time.time() - t0, 1), 's', flush=True)
patches = []
for s in stations():
    radius = nadir_patch_radius(s['id'])
    if radius > 0:
        X, Y, Z = s['t']
        patches.append(dict(id=s['id'], x=round(XC - X, 3), z=round(Y - YC, 3), height=round(Z - FLOOR, 3), radius_deg=radius))
with open('proj/floor-patches.json', 'w') as f:
    json.dump(patches, f, indent=1)
print('strong tripod patches', ' '.join(f"{p['id']} {p['radius_deg']:g}" for p in patches), flush=True)

"""Projects the panoramas onto the ceiling (flat lattice) from below.
Usage (in the work directory): python3 $SURVEY/project-ceiling.py"""
import os, sys, json, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import *
v = load_views('views-ceiling.json')[0]
w, h = v['pixels']
P = np.fromfile('out-walls/ceiling-pos.position.f32', dtype=np.float32).reshape(h, w, 4)[::-1]
valid = P[..., 3] > 0.5
pts = P[valid][:, :3].astype(np.float64)
nrm = np.tile(np.array([[0, 0, -1.0]]), (len(pts), 1))
t0 = time.time()
rgb, ws = project(pts, nrm, stations(), cos_min=0.15)
img = np.zeros((h, w, 3), np.float32); img[valid] = rgb
wt = np.zeros((h, w), np.float32); wt[valid] = ws
np.savez_compressed('proj/ceiling.npz', rgb=img, weight=wt, valid=valid)
# image as seen from below: columns = planner +x (E57 -X), rows top = E57 +Y (door side)
save_rgb('proj/ceiling.png', img.reshape(-1, 3), w, h)
print('ceiling', len(pts), 'uncovered', int((valid & (wt == 0)).sum()), round(time.time() - t0, 1), 's', flush=True)

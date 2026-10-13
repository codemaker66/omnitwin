"""Projects the station panoramas onto each wall's orthographic position tiles.
Usage (in the work directory): python3 $SURVEY/project-walls.py <window|door|end|fire>"""
import os, sys, json, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import *
wall = sys.argv[1]
views = [v for v in load_views('views-walls.json') if v['wall'] == wall]
NORMALS = {'window': (0, 1, 0), 'door': (0, -1, 0), 'end': (1, 0, 0), 'fire': (-1, 0, 0)}
t0 = time.time()
tiles = []
pts_all = []
for v in views:
    w, h = v['pixels']
    P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1]
    valid = P[..., 3] > 0.5
    tiles.append((v, valid))
    pts_all.append(P[valid][:, :3].astype(np.float64))
pts = np.concatenate(pts_all)
nrm = np.tile(np.array([NORMALS[wall]], float), (len(pts), 1))
rgb, ws = project(pts, nrm, stations())
offset = 0
for (v, valid), p in zip(tiles, pts_all):
    w, h = v['pixels']
    img = np.zeros((h, w, 3), np.float32)
    img[valid] = rgb[offset:offset + len(p)]
    weight = np.zeros((h, w), np.float32)
    weight[valid] = ws[offset:offset + len(p)]
    offset += len(p)
    np.savez_compressed(f"proj/{v['name']}.npz", rgb=img, weight=weight, valid=valid)
print(wall, 'texels', len(pts), 'uncovered', int((ws == 0).sum()), round(time.time() - t0, 1), 's', flush=True)

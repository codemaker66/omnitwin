"""Which stations coloured a box of one wall in each of two builds, and how those views lie.

    python -X utf8 stations_in_box.py <first_work> <second_work> <wall> <u0> <u1> <v0> <v1> <out.json>

For the texels of the box (the wall's own metres) whose station differs between the two builds, it lists each
build's stations with how many of those texels each coloured, and for each station the median length of its rays,
their cosine to the wall, and the clearance of its views from the nearest occluder's outline
(bestview.occluder_clearance). It answers "what did this patch of wall change from, and to": in November 2026 the
dark band the Saloon's second build printed on its window wall (u 4.98 to 5.36 m, v 3.16 to 3.21 m) was 529
texels from a station almost square to the wall given up for 539 from one far along it, three millimetres clearer.

Read-only. It opens the depth map of each station it lists."""
import json
import os
import sys

import wallviews as wv
import numpy as np

first, second = [os.path.abspath(a) for a in sys.argv[1:3]]
name = sys.argv[3]
u0, u1, v0, v1 = [float(a) for a in sys.argv[4:8]]
out_path = os.path.abspath(sys.argv[8])
room, B, lv = wv.setup(second)
P = B.P
sts = P.stations()
z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
z2 = np.load(os.path.join(second, 'proj', f'labels-{name}.npz'))
a, b = z1['texel_label'].astype(np.int64), z2['texel_label'].astype(np.int64)
grid = B.Grid(name)
box = ((grid.vrow >= v0 - 1e-6) & (grid.vrow <= v1 + 1e-6))[:, None] & ((grid.ucol >= u0 - 1e-6) & (grid.ucol <= u1 + 1e-6))[None, :]
r, c = np.nonzero(box & (a != b) & (a >= 0) & (b >= 0))
res = dict(wall=name, box_m=dict(u=[u0, u1], v=[v0, v1]), texels_in_the_box=int(box.sum()), texels_whose_station_differs=int(len(r)), builds=[])
points = grid.points(r, c, grid.depth[r, c])
for which, labels in (('first', a), ('second', b)):
    s = labels[r, c]
    rows = []
    for si in np.unique(s):
        k = np.nonzero(s == si)[0]
        v = points[k] - sts[si]['t']
        dist = np.linalg.norm(v, axis=1)
        cos = -(v @ grid.n) / np.maximum(dist, 1e-6)
        clearance = B.occluder_clearance(P.load_depth(sts[si]['id']), v, dist, cos)
        rows.append(dict(station=sts[si]['id'], texels=int(len(k)), ray_m_median=round(float(np.median(dist)), 2), cosine_median=round(float(np.median(cos)), 2),
                         clearance_mm_median=round(float(np.median(clearance)) * 1000, 1), clearance_mm_least=round(float(clearance.min()) * 1000, 1)))
    rows.sort(key=lambda x: -x['texels'])
    res['builds'].append(dict(build=which, stations=rows))
    print(which, json.dumps(rows))
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(res, f, indent=1)
print(json.dumps({k: res[k] for k in ('wall', 'box_m', 'texels_in_the_box', 'texels_whose_station_differs')}))

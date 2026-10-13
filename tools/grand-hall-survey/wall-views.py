"""Writes views-walls.json beside this script: orthographic elevation tiles per
wall at 200 px/m, seen from inside the room, for render.mjs.
Usage: python3 $SURVEY/wall-views.py"""
import json
import os
PPM = 200
FLOOR = 0.045
H0, H1 = -0.05, 7.0          # heights above floor covered
WALLS = {
  # name: (u axis start point (E57 XY at u=0), u direction, length, inward normal, plane coordinate)
  'window': dict(start=(19.36, -10.255), u=(-1, 0), length=21.135, normal=(0, 1)),
  'door':   dict(start=(-1.775, 0.335), u=(1, 0), length=21.135, normal=(0, -1)),
  'end':    dict(start=(-1.775, -10.255), u=(0, 1), length=10.59, normal=(1, 0)),
  'fire':   dict(start=(19.36, 0.335), u=(0, -1), length=10.59, normal=(-1, 0)),
}
views = []
for name, w in WALLS.items():
    tiles = 4 if w['length'] > 15 else 2
    tile_len = w['length'] / tiles
    for t in range(tiles):
        u0 = t * tile_len
        uc = u0 + tile_len / 2
        cx = w['start'][0] + w['u'][0] * uc
        cy = w['start'][1] + w['u'][1] * uc
        zc = FLOOR + (H0 + H1) / 2
        # camera 1.2 m inside the room looking at the wall
        ex = cx + w['normal'][0] * 1.2
        ey = cy + w['normal'][1] * 1.2
        views.append(dict(name=f'wall-{name}-{t}', eye=[ex, ey, zc], target=[cx, cy, zc], up=[0, 0, 1],
                          size=[tile_len, H1 - H0], pixels=[int(round(tile_len * PPM)), int(round((H1 - H0) * PPM))],
                          near=0.0, far=2.3, modes=['position'], wall=name, tile=t, tiles=tiles, u0=u0))
json.dump(views, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'views-walls.json'), 'w'), indent=1)
print(len(views), 'views', [v['pixels'] for v in views[:2]])

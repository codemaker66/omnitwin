"""Cuts the walls' 2 mm photographs (project-detail.py) into the detail tiles the planner streams (hall-detail.ts).

Each tile is 512 x 512 texels: 496 of its own (0.992 m of wall) inside an 8-texel gutter on every side that repeats
its neighbours' texels (or the wall's edge), so bilinear sampling and mip levels up to 3 (8 / 2^3 = 1 texel) never
read past a tile's own edge. Tile (column, row) holds u from column x 0.992 m along the wall and t = 6.72 m less the
height from row x 0.992 m down, in the atlas's frame (hall-atlas.ts). A tile whose own area is all window glass in
the published atlas (alpha under 192; the planner shows the city through glass and never draws detail there) is
left out. Encoded as WebP at quality 86, without alpha.

Writes <out>/detail/<wall>/<column>_<row>.webp (walls named as the planner names them: window, door, end,
fireplace) and <out>/detail/index.json: the grid (texel, tile, gutter, pitch, origin), each wall's columns and rows,
and every tile's bytes and SHA-256.

Usage (in the work directory): python3 $SURVEY/pack-detail.py --atlas <dir with walls-4096.webp> [--proj proj]
    [--out proj]"""
import argparse
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
Image.MAX_IMAGE_PIXELS = None

TEXEL = 0.002
TILE = 512
GUTTER = 8
UNIQUE = TILE - 2 * GUTTER
PITCH = UNIQUE * TEXEL
QUALITY = 86
L, W = 21.135, 10.59
SIZE = 4096
PPM = (SIZE / 2) / W
V_MIN, V_MAX = -0.02, 6.72
ROW = int(np.ceil((V_MAX - V_MIN) * PPM))
LENGTH = {'window': L, 'door': L, 'end': W, 'fire': W}
NAME = {'window': 'window', 'door': 'door', 'end': 'end', 'fire': 'fireplace'}
GLASS_ALPHA = 192


def tile_grid(wall):
    return int(np.ceil(LENGTH[wall] / PITCH - 1e-9)), int(np.ceil((V_MAX - V_MIN) / PITCH - 1e-9))


def glass_only(alpha, col, row, wall):
    """Whether tile (col, row)'s own area is all glass in the window wall's strip of the atlas's alpha."""
    if wall != 'window':
        return False
    w_dst = int(np.ceil(L * PPM))
    x0, x1 = int(np.floor(col * PITCH * PPM)), int(np.ceil(min((col + 1) * PITCH, L) * PPM))
    y0, y1 = int(np.floor(row * PITCH * PPM)), int(np.ceil(min((row + 1) * PITCH, V_MAX - V_MIN) * PPM))
    area = alpha[y0:min(y1, ROW), x0:min(x1, w_dst)]
    return area.size > 0 and bool((area < GLASS_ALPHA).all())


def encode(tile):
    buf = io.BytesIO()
    Image.fromarray(tile, 'RGB').save(buf, 'WEBP', quality=QUALITY, method=6)
    return buf.getvalue()


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--atlas', required=True, help='directory holding the published walls-4096.webp (its alpha marks glass)')
    a.add_argument('--proj', default='proj')
    a.add_argument('--out', default='proj')
    args = a.parse_args()
    alpha = np.asarray(Image.open(os.path.join(args.atlas, 'walls-4096.webp')).convert('RGBA'))[..., 3]
    root = os.path.join(args.out, 'detail')
    index = dict(format='venviewer-hall-detail', version=1, texelMetres=TEXEL, tileTexels=TILE, gutterTexels=GUTTER,
                 pitchMetres=PITCH, origin=dict(u=0.0, v=V_MAX), quality=QUALITY, walls={})
    total, count, skipped = 0, 0, []
    for wall in ('window', 'door', 'end', 'fire'):
        img = np.load(os.path.join(args.proj, f'detail-{wall}.npy'), mmap_mode='r')
        ncols, nrows = tile_grid(wall)
        if img.shape[:2] != (nrows * UNIQUE + 2 * GUTTER, ncols * UNIQUE + 2 * GUTTER):
            raise SystemExit(f'detail-{wall}.npy is {img.shape[:2]}, not the {nrows} x {ncols} tile grid')
        name = NAME[wall]
        os.makedirs(os.path.join(root, name), exist_ok=True)
        tiles = []
        for row in range(nrows):
            for col in range(ncols):
                if glass_only(alpha, col, row, wall):
                    skipped.append(f'{name}/{col}_{row}')
                    continue
                y, x = row * UNIQUE, col * UNIQUE
                data = encode(np.ascontiguousarray(img[y:y + TILE, x:x + TILE]))
                with open(os.path.join(root, name, f'{col}_{row}.webp'), 'wb') as f:
                    f.write(data)
                tiles.append(dict(column=col, row=row, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
                total += len(data)
                count += 1
        index['walls'][name] = dict(columns=ncols, rows=nrows, tiles=tiles)
        print(name, ncols, 'x', nrows, len(tiles), 'tiles', round(sum(t['bytes'] for t in tiles) / 1e6, 2), 'MB', flush=True)
    index['tiles'] = count
    index['totalBytes'] = total
    with open(os.path.join(root, 'index.json'), 'w', newline='\n') as f:
        json.dump(index, f, indent=1)
        f.write('\n')
    print(json.dumps(dict(tiles=count, total_mb=round(total / 1e6, 2), glass_only=skipped)), flush=True)


if __name__ == '__main__':
    main()

"""Where the portraits' canvases lie on the walls, measured for canvasveil.py's CANVASES (C5).

Each portrait's canvas is found inside its frame on the wall's 2.5 mm orthophoto (proj/<view>.fine.npz, the best-view
build): across a generous box round the frame, the luminance profiles (medians over the central half of the other
axis) are scanned on each side, within the outer 35% of the box, for the step down from the frame's gilt inner slip to
the paint (the mean over the centimetre outside a texel less the centimetre inside it); the innermost step within 60%
of the strongest, at its local peak, is the canvas's edge (the frame's outer edge against pale plaster can step as far
as the slip does). The edges are printed and written with an overlay of each box on the orthophoto, for a check by eye.

The boxes are read off the published atlas's strips (0.5 m grid); the edges inside them come from the photograph. Of the
twelve portraits, the end wall's (S4a's measuring box was u 4.62-5.98, v 2.25-4.47) and the fireplace's are in
canvasveil.py; door-2's lower edge and window-3's upper edge take in part of their frames.

Usage (in a work directory the build has filled):
    python3 $SURVEY/measure/locate-canvases.py <out-dir> [name ...]
Writes <out-dir>/canvases.json (each canvas's edges, u0 u1 v0 v1 in metres, and the step found on each side) and
<out-dir>/canvas-<name>.png."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bestview as B  # noqa: E402

BAND = 0.35               # share of the box's extent, from each side, searched for the canvas's edge
HALF = 4                  # fine texels (1 cm) either side of a step
STRONG = 0.6              # the innermost step within this share of the strongest is the edge
ROUGH = {                 # name: wall, u0, u1, v0, v1 (metres), a generous box round the frame
    'fire-portrait': ('fire', 4.1, 6.45, 1.8, 4.75),
    'end-portrait': ('end', 4.2, 6.45, 1.85, 4.9),
    'door-1': ('door', 3.25, 4.85, 2.1, 3.95),
    'door-2': ('door', 5.5, 7.05, 2.1, 4.0),
    'door-3': ('door', 7.6, 9.15, 2.1, 3.95),
    'door-4': ('door', 12.2, 13.65, 2.1, 3.8),
    'door-5': ('door', 14.45, 15.95, 2.15, 3.9),
    'door-6': ('door', 16.7, 18.1, 2.15, 3.85),
    'window-1': ('window', 3.2, 4.8, 2.1, 3.85),
    'window-2': ('window', 6.9, 8.45, 2.1, 3.9),
    'window-3': ('window', 12.4, 14.05, 2.15, 4.1),
    'window-4': ('window', 16.3, 17.8, 2.3, 4.05),
}


def fine(wall):
    """The wall's 2.5 mm orthophoto (sRGB) and the u of each fine column, v of each fine row."""
    grid = B.Grid(wall)
    parts = [np.load(os.path.join('proj', f"{v['name']}.fine.npz")) for v in B.wall_tiles(wall)]
    rgb = np.concatenate([p['rgb8'] for p in parts], axis=1)
    u = np.repeat(grid.ucol, 2) + np.tile([-0.25, 0.25], len(grid.ucol)) * np.repeat(grid.pitch_u, 2)
    v = np.repeat(grid.vrow, 2) - np.tile([-0.25, 0.25], len(grid.vrow)) * grid.pitch_v
    return rgb, u, v


def edge(profile, side):
    """Index of the first canvas texel from one side of a profile (side -1: low end, +1: high end) and its step."""
    n = len(profile)
    cs = np.concatenate([[0.0], np.cumsum(profile)])

    def mean(a, b):
        return (cs[b] - cs[a]) / (b - a)
    span = int(BAND * n)
    ks = np.arange(HALF, span) if side < 0 else np.arange(n - span, n - HALF)
    if side < 0:
        st = np.array([mean(k - HALF, k) - mean(k, k + HALF) for k in ks])
    else:
        st = np.array([mean(k, k + HALF) - mean(k - HALF, k) for k in ks])
    strong = np.nonzero(st >= STRONG * st.max())[0]
    i = strong.max() if side < 0 else strong.min()
    while 0 < i < len(st) - 1 and st[i + (1 if side < 0 else -1)] > st[i]:
        i += 1 if side < 0 else -1
    k = int(ks[i])
    return (k if side < 0 else k - 1), round(float(st[i]), 1)


def main():
    out = sys.argv[1]
    names = sys.argv[2:] or list(ROUGH)
    os.makedirs(out, exist_ok=True)
    cache, res = {}, {}
    for name in names:
        wall, u0, u1, v0, v1 = ROUGH[name]
        if wall not in cache:
            cache[wall] = fine(wall)
        rgb, u, v = cache[wall]
        cols = np.nonzero((u >= u0) & (u < u1))[0]
        rows = np.nonzero((v >= v0) & (v < v1))[0]
        r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
        L = rgb[r0:r1, c0:c1].astype(np.float32) @ B.LUMA
        h, w = L.shape
        across = np.median(L[h // 4:3 * h // 4], axis=0)
        down = np.median(L[:, w // 4:3 * w // 4], axis=1)
        (cl, sl), (ch, sh) = edge(across, -1), edge(across, +1)
        (rl, st), (rh, sb) = edge(down, -1), edge(down, +1)
        res[name] = dict(wall=wall, rough=[u0, u1, v0, v1], edges=[round(float(u[c0 + cl]), 3), round(float(u[c0 + ch]), 3),
                                                                   round(float(v[r0 + rh]), 3), round(float(v[r0 + rl]), 3)],
                         steps=dict(left=sl, right=sh, top=st, bottom=sb))
        im = Image.fromarray(rgb[r0:r1, c0:c1])
        ImageDraw.Draw(im).rectangle([cl, rl, ch, rh], outline=(0, 255, 0))
        im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(os.path.join(out, f'canvas-{name}.png'))
        print(name, res[name]['edges'], flush=True)
    with open(os.path.join(out, 'canvases.json'), 'w') as f:
        json.dump(res, f, indent=1)


if __name__ == '__main__':
    main()

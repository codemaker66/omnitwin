"""The four windows stand behind sheers and drapes, and the mesh holds only curtain (nothing lies beyond
Y 13.72 in it), so the windows are measured on the photographs: their frames show through the sheers.
For each window this renders a vertical plane parallel to the wall from several stations' native cube
faces, side by side, each with a metric grid. A frame edge that lies in the rendered plane appears at the
same X (and height) from every station; one in front of it or behind it shifts with the station's
distance and bearing. The plane on which the head and sill lines keep their height from near and far
stations is the frame's plane (Y 13.80), and the edges are read there by eye (README, windows).

    07_window_edges.py [plane Y] [res] [half-width] [name ...]     default 13.80 0.008 1.3, every window

Threshold and step finders were tried first and dropped: the drapes' woven stripes and the sheers'
overlaps are stronger steps than the frames."""
import sys
import numpy as np
from PIL import Image
from rlib import OUT
from planecrop import crop, save_grid

# window: nominal centre X, and the stations to render it from (east of it, in front, west of it)
WINDOWS = {"w1": (12.80, (137, 141, 138, 139)), "w2": (15.00, (136, 142, 137, 138, 139)),
           "w3": (17.30, (135, 134, 136, 142, 137)), "w4": (19.70, (135, 134, 136, 142))}
V0, V1 = 0.7, 2.9

def strip(plane, res, x0, x1, v0, v1, sids, out, grid=0.1, label=0.5):
    """One picture of the same patch of the plane from each station in turn, left to right."""
    tiles = []
    for sid in sids:
        f = OUT + "/scripts/_tile.png"
        save_grid(crop("Y", plane, x0, x1, v0, v1, res, sid), x0, v1, res, f, grid, label)
        tiles.append(np.asarray(Image.open(f).convert("RGB")))
        tiles.append(np.zeros((tiles[-1].shape[0], 4, 3), np.uint8))
    Image.fromarray(np.concatenate(tiles[:-1], 1)).save(out)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "tile":
        # tile <plane> <res> <x0> <x1> <v0> <v1> <out.png> <station ...>: a close strip about one edge
        strip(float(a[1]), float(a[2]), float(a[3]), float(a[4]), float(a[5]), float(a[6]), [int(s) for s in a[8:]], a[7], 0.05, 0.1)
        sys.exit(0)
    plane = float(a[0]) if len(a) > 0 else 13.80
    res = float(a[1]) if len(a) > 1 else 0.008
    half = float(a[2]) if len(a) > 2 else 1.3
    for name in (a[3:] or list(WINDOWS)):
        xc, sids = WINDOWS[name]
        tiles = []
        for sid in sids:
            f = OUT + "/scripts/_tile.png"
            save_grid(crop("Y", plane, xc - half, xc + half, V0, V1, res, sid), xc - half, V1, res, f)
            tiles.append(np.asarray(Image.open(f).convert("RGB")))
            tiles.append(np.zeros((tiles[-1].shape[0], 4, 3), np.uint8))
        out = OUT + "/window_%s_Y%.2f.png" % (name, plane)
        Image.fromarray(np.concatenate(tiles[:-1], 1)).save(out)
        print(name, "plane Y %.2f" % plane, "stations", sids, "->", out)

"""The four windows stand behind sheers and drapes, and the mesh holds only curtain (nothing lies beyond
Y 13.72 in it), so the windows are measured on the photographs: their frames show through the sheers.
For each window this renders a vertical plane parallel to the wall from several stations' native cube
faces, side by side, each with a metric grid. A frame edge that lies in the rendered plane appears at the
same X (and height) from every station; one in front of it or behind it shifts with the station's
distance and bearing. The plane on which the head and sill lines keep their height from near and far
stations is the frame's plane (Y 13.80), and the edges are read there by eye (README, windows).

    07_window_edges.py [plane Y] [res] [half-width] [name ...]     default 13.80 0.008 1.3, every window
    07_window_edges.py tile <plane> <res> <x0> <x1> <v0> <v1> <out.png> <station ...>     a close strip
    07_window_edges.py heads                                        the head lines, read automatically

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


def heads(plane=13.80, res=0.0025):
    """An automatic reading of each window's head line (the first strong drop of brightness going up,
    over the columns where glass shows) from every station with a view, and the depth offset e from
    `plane` that best explains how its apparent height changes with the station's distance D:
    v = zs + (head - zs) D / (D + e). It scatters by 7-50 mm between stations (they lock on different
    edges through the sheer), so it bounds the depth rather than fixing it."""
    from rlib import FLOOR_Z, stations
    S, _ = stations()
    extra = {"w1": (), "w2": (141,), "w3": (), "w4": ()}
    for name, (xc, sids) in WINDOWS.items():
        obs = []
        for sid in tuple(sids) + extra[name]:
            lum = crop("Y", plane, xc - 0.9, xc + 0.9, 2.2, 2.85, res, sid) @ np.array([0.2126, 0.7152, 0.0722])
            colb = lum[int(0.35 / res):int(0.55 / res)].mean(0)          # rows 2.30-2.50 m: glass
            cols = colb > 0.85 * np.percentile(colb, 98)
            if cols.sum() < 40:
                continue
            prof = lum[:, cols].mean(1)[::-1]
            k = 4
            sm = np.convolve(prof, np.ones(k) / k, "same")
            g = sm[2 * k:] - sm[:-2 * k]
            v = 2.2 + (np.arange(len(g)) + k + 0.5) * res
            m = (v > 2.45) & (v < 2.80)
            j = np.nonzero(m & (g < 0.5 * g[m].min()))[0][0]
            while j + 1 < len(g) and g[j + 1] < g[j]:
                j += 1
            t = S[sid]["t"]
            obs.append((sid, plane - t[1], t[2] - FLOOR_Z, v[j]))
        print(name, " ".join("scan_%d: D %.2f, head %.3f;" % (o[0], o[1], o[3]) for o in obs))
        D, zs, va = (np.array([o[i] for o in obs]) for i in (1, 2, 3))
        best = None
        for e in np.arange(-0.25, 0.4001, 0.005):
            f = D / (D + e)
            vt = np.mean((va - zs) / f + zs)
            rms = np.sqrt(((va - (zs + (vt - zs) * f)) ** 2).mean())
            if best is None or rms < best[0]:
                best = (rms, e, vt)
        print("   best offset from Y %.2f: %+.3f m, head %.3f m, rms %.1f mm (%.1f mm with no offset)" % (
            plane, best[1], best[2], best[0] * 1000, np.sqrt(((va - va.mean()) ** 2).mean()) * 1000))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "heads":
        heads()
        sys.exit(0)
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

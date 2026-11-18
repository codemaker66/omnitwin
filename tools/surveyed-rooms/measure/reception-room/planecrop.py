"""Orthographic crops of an axis-parallel vertical plane, coloured from one station's native 4096 px cube
faces (the Saloon's cubelib sampler), with a metric grid: the ruler for edges of doors, windows and
fittings. Unlike the Saloon's crop this needs no depth raster: the plane is given, so the same wall can be
re-projected at several depths and two stations compared (07_window_edges.py).

    planecrop.py <X|Y> <plane> <along0> <along1> <v0> <v1> <res> <station> <out.png>

`X 20.0` is the plane X = 20.0 with E57 Y along it; `Y 13.5` is the plane Y = 13.5 with E57 X along it.
v is height above FLOOR_Z. Columns run in increasing along-coordinate (not left to right as seen); a final
`flip` mirrors the picture. `Z 2.42 x0 x1 y0 y1` is the level 2.42 m above the floor, north up."""
import sys
import numpy as np
from PIL import Image, ImageDraw
from rlib import FLOOR_Z
from cubelib import Station

_ST = {}


def station(sid):
    if sid not in _ST:
        _ST[sid] = Station(sid)
    return _ST[sid]


def crop(axis, plane, s0, s1, v0, v1, res, sid):
    """float RGB (rows from v1 down, columns from s0 up) of the plane as station `sid` photographed it."""
    ns, nv = int(round((s1 - s0) / res)), int(round((v1 - v0) / res))
    s = s0 + (np.arange(ns) + 0.5) * res
    v = v1 - (np.arange(nv) + 0.5) * res
    SS, VV = np.meshgrid(s, v)
    P = np.zeros((nv, ns, 3))
    P[..., 0 if axis == "X" else 1] = plane
    P[..., 1 if axis == "X" else 0] = SS
    P[..., 2] = VV + FLOOR_Z
    return station(sid).sample_points(P.reshape(-1, 3)).reshape(nv, ns, 3)


def crop_level(h, x0, x1, y0, y1, res, sid):
    """The horizontal plane h above the floor (a ceiling field, or the floor at h = 0) as station `sid`
    photographed it: rows from Y = y1 down, columns from X = x0 up (north up, as the plan sections)."""
    nx, ny = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    XX, YY = np.meshgrid(x0 + (np.arange(nx) + 0.5) * res, y1 - (np.arange(ny) + 0.5) * res)
    P = np.stack([XX, YY, np.full_like(XX, FLOOR_Z + h)], -1)
    return station(sid).sample_points(P.reshape(-1, 3)).reshape(ny, nx, 3)


def save_grid(img, s0, v1, res, out, grid=0.1, label=0.5, flip=False):
    """Write a crop with ticks every `grid` and labels every `label` metres. flip mirrors the picture so it
    reads as seen from inside the room when the along-coordinate runs right to left."""
    nv, ns = img.shape[:2]
    a = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    if flip:
        a = a[:, ::-1]
    im = Image.fromarray(a)
    d = ImageDraw.Draw(im)
    s1 = s0 + ns * res
    v0 = v1 - nv * res
    is_label = lambda q: abs(q / label - round(q / label)) < 1e-6
    for g in np.arange(np.ceil(s0 / grid) * grid, s1 + 1e-9, grid):
        x = (g - s0) / res
        x = ns - x if flip else x
        n = 14 if is_label(g) else 6
        d.line([(x, 0), (x, n)], fill=(255, 255, 0))
        d.line([(x, nv - n), (x, nv)], fill=(255, 255, 0))
        if is_label(g):
            d.text((x + 2, 14), "%.1f" % g, fill=(255, 255, 0))
    for g in np.arange(np.ceil(v0 / grid) * grid, v1 + 1e-9, grid):
        y = (v1 - g) / res
        n = 14 if is_label(g) else 6
        d.line([(0, y), (n, y)], fill=(0, 255, 255))
        d.line([(ns - n, y), (ns, y)], fill=(0, 255, 255))
        if is_label(g):
            d.text((16, y - 5), "%.1f" % g, fill=(0, 255, 255))
    im.save(out)


if __name__ == "__main__":
    a = sys.argv
    axis, plane, s0, s1, v0, v1, res, sid, out = a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]), float(a[6]), float(a[7]), int(a[8]), a[9]
    # "Z h x0 x1 y0 y1": the level h above the floor, with the grid's "height" axis standing for Y
    img = crop_level(plane, s0, s1, v0, v1, res, sid) if axis == "Z" else crop(axis, plane, s0, s1, v0, v1, res, sid)
    save_grid(img, s0, v1, res, out, flip=len(a) > 10 and a[10] == "flip")
    print(img.shape)

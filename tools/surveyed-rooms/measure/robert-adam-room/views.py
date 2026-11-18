"""Pictures from one station's native 4096 px cube faces, for reading what the mesh cannot say.

    views.py equi  <station> <width> <out.jpg>
        the whole panorama, world-aligned: column = azimuth from E57 +X towards +Y, left to right
        decreasing (as a camera turning clockwise seen from above sees it), row 0 = straight up.
    views.py persp <station> <azimuth deg> <elevation deg> <fov deg> <w> <h> <out.jpg>
        a pinhole view; azimuth from E57 +X towards +Y.
    views.py plane <X|Y> <plane> <along0> <along1> <z0> <z1> <res> <station> <out.png> [flip] [gain]
        an orthographic crop of the vertical plane X = plane or Y = plane, heights in E57 Z, with a grid.
    views.py level <z> <x0> <x1> <y0> <y1> <res> <station> <out.png> [gain]
        an orthographic crop of the horizontal plane Z = z, north up, with a grid in E57 X and Y."""
import sys
import numpy as np
from PIL import Image
from ralib import station, crop_plane, crop_level, save_grid


def equi(sid, width):
    h = width // 2
    az = np.radians(180.0 - (np.arange(width) + 0.5) / width * 360.0)      # +X in the middle, +Y to its left
    el = np.radians(90.0 - (np.arange(h) + 0.5) / h * 180.0)
    A, E = np.meshgrid(az, el)
    d = np.stack([np.cos(E) * np.cos(A), np.cos(E) * np.sin(A), np.sin(E)], -1)
    return station(sid).sample_dirs(d.reshape(-1, 3)).reshape(h, width, 3)


def persp(sid, az, el, fov, w, h):
    az, el = np.radians(az), np.radians(el)
    f = np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
    r = np.array([np.sin(az), -np.cos(az), 0.0])
    u = np.cross(r, f)
    t = np.tan(np.radians(fov) / 2)
    xs = ((np.arange(w) + 0.5) / w * 2 - 1) * t
    ys = (1 - (np.arange(h) + 0.5) / h * 2) * t * h / w
    X, Y = np.meshgrid(xs, ys)
    d = f[None, None] + X[..., None] * r[None, None] + Y[..., None] * u[None, None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    return station(sid).sample_dirs(d.reshape(-1, 3)).reshape(h, w, 3)


def save(img, out, gain=1.0):
    Image.fromarray((np.clip(img * gain, 0, 1) * 255).astype(np.uint8)).save(out, quality=88)


if __name__ == "__main__":
    a = sys.argv
    if a[1] == "equi":
        save(equi(int(a[2]), int(a[3])), a[4])
    elif a[1] == "persp":
        save(persp(int(a[2]), float(a[3]), float(a[4]), float(a[5]), int(a[6]), int(a[7])), a[8])
    elif a[1] == "plane":
        axis, plane, s0, s1, z0, z1, res, sid, out = a[2], float(a[3]), float(a[4]), float(a[5]), float(a[6]), float(a[7]), float(a[8]), int(a[9]), a[10]
        rest = a[11:]
        gain = float([r for r in rest if r != "flip"][0]) if [r for r in rest if r != "flip"] else 1.0
        save_grid(crop_plane(axis, plane, s0, s1, z0, z1, res, sid), s0, z1, res, out, flip="flip" in rest, gain=gain)
    elif a[1] == "level":
        z, x0, x1, y0, y1, res, sid, out = float(a[2]), float(a[3]), float(a[4]), float(a[5]), float(a[6]), float(a[7]), int(a[8]), a[9]
        save_grid(crop_level(z, x0, x1, y0, y1, res, sid), x0, y1, res, out, gain=float(a[10]) if len(a) > 10 else 1.0)

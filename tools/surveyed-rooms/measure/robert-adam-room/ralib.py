"""Shared helpers for the Robert Adam Room measurement pass (E57 frame, Z up, metres).

Inputs as the Saloon's and the Reception Room's passes: a work directory named by ROOMS_SURVEY_WORK holding
the twin's manifest.json and the decoded mesh under mesh/; ROOMS_SURVEY_PANO512 (the twin's 512 px
panoramas, default <work>/pano512); E57_CUBE_FACES (the export's native 4096 px cube faces, with a trailing
slash). Outputs go to ROBERT_ADAM_MEASURE_OUT (default <work>/robert-adam-measure). The other rooms'
loaders, ray caster and samplers are imported, not copied."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "saloon"))
sys.path.insert(0, os.path.join(HERE, "..", "reception-room"))
import numpy as np  # noqa: E402
from common import ROOT, load_mesh, tri_geometry, stations, slice_segments  # noqa: E402,F401

OUT = os.environ.get("ROBERT_ADAM_MEASURE_OUT", ROOT + "/robert-adam-measure")
# rlib makes its own output folder when imported: point it at ours, so this pass writes nowhere else.
os.environ["RECEPTION_MEASURE_OUT"] = OUT
from rlib import cast, subset, near_rays, robust_mean, tri_points, band_points, grid_png  # noqa: E402,F401

PANO = os.environ.get("ROOMS_SURVEY_PANO512", ROOT + "/pano512").rstrip("/") + "/"
os.makedirs(OUT + "/scripts", exist_ok=True)
os.makedirs(OUT + "/img", exist_ok=True)

# The crop of the building's mesh this pass reads: both sections, the lobby, the corridor and 2-3 m beyond.
BOX = (-9.5, 9.5, -14.0, 14.5, -4.6, 0.6)
# Stations examined: the entrance hall's last ones, the room, the rear corridor, the first Reception ones.
SIDS = list(range(80, 123))
# Adopted in 02_floors.py: the lower floor's plane at the lower section's centre, and the upper floor's.
FLOOR_LO = -3.574
FLOOR_UP = -2.981


def room_mesh():
    """(a, b, c, unit normal, area, centroid) of the triangles whose centroid lies in BOX; cached."""
    f = OUT + "/scripts/ra_mesh.npz"
    if os.path.exists(f):
        d = np.load(f)
        return d["a"], d["b"], d["c"], d["nn"], d["area"], d["cen"]
    P, I, C = load_mesh()
    cen = P[I].mean(1)
    sel = ((cen[:, 0] > BOX[0]) & (cen[:, 0] < BOX[1]) & (cen[:, 1] > BOX[2]) & (cen[:, 1] < BOX[3])
           & (cen[:, 2] > BOX[4]) & (cen[:, 2] < BOX[5]))
    a, b, c, nn, area, cen = tri_geometry(P, I[sel])
    np.savez(f, a=a, b=b, c=c, nn=nn, area=area, cen=cen)
    return a, b, c, nn, area, cen


def fit_line(s, t, w=None, c=0.02, it=30):
    """Robust line t = t0 + k (s - s_mid) (Tukey biweight, scale c): dict of the fit."""
    s = np.asarray(s, float)
    t = np.asarray(t, float)
    w0 = np.ones_like(s) if w is None else np.asarray(w, float)
    sm = float((s.min() + s.max()) / 2)
    A = np.c_[np.ones(len(s)), s - sm]
    co = np.array([np.median(t), 0.0])
    for _ in range(it):
        u = (t - A @ co) / c
        wt = w0 * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 1e-9)
        co = np.linalg.lstsq(A * np.sqrt(wt)[:, None], t * np.sqrt(wt), rcond=None)[0]
    r = t - A @ co
    inl = np.abs(r) < c
    return dict(offset_at_mid=float(co[0]), slope=float(co[1]), angle_deg=float(np.degrees(np.arctan(co[1]))),
                s_mid=sm, s0=float(s[inl].min()) if inl.any() else float("nan"),
                s1=float(s[inl].max()) if inl.any() else float("nan"),
                rms_mm=float(np.sqrt(np.average(r[inl] ** 2, weights=w0[inl])) * 1000) if inl.any() else float("nan"),
                inliers=float(w0[inl].sum() / w0.sum()), n=int(len(s)))


def section_png(M, z0, out, x0=-9.5, x1=9.5, y0=-14.0, y1=14.5, ppm=60, marks=(), label="", maxnz=2.0):
    """A north-up picture of the plan section at Z = z0 (white lines), a 1 m grid in E57 X and Y, and the
    stations in `marks` ((x, y, text)). X runs left to right, Y bottom to top."""
    from PIL import Image, ImageDraw
    a, b, c, nn = M[0], M[1], M[2], M[3]
    segs, ti = slice_segments(a, b, c, z0)
    keep = np.abs(nn[ti][:, 2]) < maxnz
    segs = segs[keep]
    W, H = int((x1 - x0) * ppm), int((y1 - y0) * ppm)
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for g in np.arange(np.ceil(x0), x1, 1.0):
        x = (g - x0) * ppm
        d.line([(x, 0), (x, H)], fill=(40, 40, 70) if g % 5 else (70, 70, 120))
        d.text((x + 2, 2), "X%g" % g, fill=(120, 120, 200))
    for g in np.arange(np.ceil(y0), y1, 1.0):
        y = (y1 - g) * ppm
        d.line([(0, y), (W, y)], fill=(40, 40, 70) if g % 5 else (70, 70, 120))
        d.text((2, y + 2), "Y%g" % g, fill=(120, 120, 200))
    for s in segs:
        d.line([((s[0, 0] - x0) * ppm, (y1 - s[0, 1]) * ppm), ((s[1, 0] - x0) * ppm, (y1 - s[1, 1]) * ppm)], fill=(255, 255, 255))
    for (mx, my, txt) in marks:
        px, py = (mx - x0) * ppm, (y1 - my) * ppm
        d.ellipse([px - 3, py - 3, px + 3, py + 3], outline=(255, 80, 80))
        d.text((px + 4, py - 5), txt, fill=(255, 160, 80))
    d.text((10, H - 14), label, fill=(255, 255, 255))
    im.save(out)


_ST = {}


def station(sid):
    from cubelib import Station
    if sid not in _ST:
        _ST[sid] = Station(sid)
    return _ST[sid]


def crop_plane(axis, plane, s0, s1, z0, z1, res, sid):
    """float RGB (rows from Z = z1 down, columns from s0 up) of the vertical plane X = plane (axis "X", E57 Y
    along it) or Y = plane (axis "Y", E57 X along it) as station `sid` photographed it. Heights are E57 Z."""
    ns, nv = int(round((s1 - s0) / res)), int(round((z1 - z0) / res))
    SS, VV = np.meshgrid(s0 + (np.arange(ns) + 0.5) * res, z1 - (np.arange(nv) + 0.5) * res)
    P = np.zeros((nv, ns, 3))
    P[..., 0 if axis == "X" else 1] = plane
    P[..., 1 if axis == "X" else 0] = SS
    P[..., 2] = VV
    return station(sid).sample_points(P.reshape(-1, 3)).reshape(nv, ns, 3)


def crop_level(z, x0, x1, y0, y1, res, sid):
    """The horizontal plane E57 Z = z as station `sid` photographed it: rows from Y = y1 down, columns from
    X = x0 up (north up, as the plan sections)."""
    nx, ny = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    XX, YY = np.meshgrid(x0 + (np.arange(nx) + 0.5) * res, y1 - (np.arange(ny) + 0.5) * res)
    P = np.stack([XX, YY, np.full_like(XX, z)], -1)
    return station(sid).sample_points(P.reshape(-1, 3)).reshape(ny, nx, 3)


def save_grid(img, s0, v1, res, out, grid=0.1, label=0.5, flip=False, gain=1.0):
    """Write a crop with ticks every `grid` and labels every `label` metres (columns from s0 up, rows from
    v1 down). flip mirrors it, so a wall reads as seen from inside when its coordinate runs right to left."""
    from PIL import Image, ImageDraw
    nv, ns = img.shape[:2]
    a = (np.clip(img * gain, 0, 1) * 255).astype(np.uint8)
    if flip:
        a = a[:, ::-1]
    im = Image.fromarray(a)
    d = ImageDraw.Draw(im)
    s1 = s0 + ns * res
    v0 = v1 - nv * res

    def is_label(q):
        return abs(q / label - round(q / label)) < 1e-6
    for g in np.arange(np.ceil(s0 / grid - 1e-9) * grid, s1 + 1e-9, grid):
        x = (g - s0) / res
        x = ns - x if flip else x
        n = 14 if is_label(g) else 6
        d.line([(x, 0), (x, n)], fill=(255, 255, 0))
        d.line([(x, nv - n), (x, nv)], fill=(255, 255, 0))
        if is_label(g):
            d.text((x + 2, 14), "%.1f" % g, fill=(255, 255, 0))
    for g in np.arange(np.ceil(v0 / grid - 1e-9) * grid, v1 + 1e-9, grid):
        y = (v1 - g) / res
        n = 14 if is_label(g) else 6
        d.line([(0, y), (n, y)], fill=(0, 255, 255))
        d.line([(ns - n, y), (ns, y)], fill=(0, 255, 255))
        if is_label(g):
            d.text((16, y - 5), "%.1f" % g, fill=(0, 255, 255))
    im.save(out)


def vslice(M, axis, value):
    """Segments where the triangles of M cross the vertical plane X = value (axis 0) or Y = value (axis 1):
    ((n, 2, 2) end points as (along, Z), with along = E57 Y for axis 0 and E57 X for axis 1; triangle index)."""
    perm = [1, 2, 0] if axis == 0 else [0, 2, 1]
    a, b, c = (m[:, perm] for m in M[:3])
    return slice_segments(a, b, c, value)


def sections_png(M, zs, out, x0, x1, y0, y1, ppm=300, grid=0.5, label=""):
    """Plan sections at several heights over one another (red, green, blue, yellow, magenta, cyan in the
    order given), north up, with a grid every `grid` metres in E57 X and Y: for reading small features."""
    from PIL import Image, ImageDraw
    cols = [(255, 70, 70), (70, 255, 70), (90, 140, 255), (255, 255, 60), (255, 80, 255), (60, 255, 255)]
    W, H = int(round((x1 - x0) * ppm)), int(round((y1 - y0) * ppm))
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for g in np.arange(np.ceil(x0 / grid - 1e-9) * grid, x1, grid):
        x = (g - x0) * ppm
        d.line([(x, 0), (x, H)], fill=(45, 45, 80))
        d.text((x + 2, 2), "%g" % round(g, 3), fill=(150, 150, 230))
    for g in np.arange(np.ceil(y0 / grid - 1e-9) * grid, y1, grid):
        y = (y1 - g) * ppm
        d.line([(0, y), (W, y)], fill=(45, 45, 80))
        d.text((2, y + 2), "%g" % round(g, 3), fill=(150, 150, 230))
    a, b, c = M[0], M[1], M[2]
    box = (np.maximum(np.maximum(a[:, 0], b[:, 0]), c[:, 0]) > x0 - 0.2) & (np.minimum(np.minimum(a[:, 0], b[:, 0]), c[:, 0]) < x1 + 0.2) \
        & (np.maximum(np.maximum(a[:, 1], b[:, 1]), c[:, 1]) > y0 - 0.2) & (np.minimum(np.minimum(a[:, 1], b[:, 1]), c[:, 1]) < y1 + 0.2)
    for k, z0 in enumerate(zs):
        segs, _ = slice_segments(a[box], b[box], c[box], z0)
        for s in segs:
            d.line([((s[0, 0] - x0) * ppm, (y1 - s[0, 1]) * ppm), ((s[1, 0] - x0) * ppm, (y1 - s[1, 1]) * ppm)], fill=cols[k % len(cols)])
        d.text((10 + 90 * k, H - 14), "Z %.2f" % z0, fill=cols[k % len(cols)])
    d.text((10, H - 28), label, fill=(255, 255, 255))
    im.save(out)

"""Synthetic survey inputs for the tests: a manifest, distance cubemaps, panoramas and, for the
mini Grand Hall (T2), position tiles at the real views' sizes and projected npz files.

Conventions are project.py's and the measuring page's: cubemap faces as project.FACES with rows
from the bottom; equirectangular panoramas as project.sample_pano reads them; position tiles as
render.mjs writes them (float32 x, y, z, alpha per texel, rows from the bottom).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
if ROOMS not in sys.path:
    sys.path.insert(0, ROOMS)
import roomlib  # noqa: E402

FACES = [((1, 0, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)),
         ((0, -1, 0), (0, 0, 1)), ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, 1, 0))]
# The Grand Hall's interior box in E57 (hall-spec.ts faces; floor and ceiling).
GH_BOX = (-1.7725, 19.3625, -10.258, 0.332, 0.045, 6.745)
# Three stations in the hall and one outside it (the Saloon): both builds must drop that one.
GH_STATIONS = [
    dict(id="scan_000", t=[0.5, -5.0, 1.5], gain=1.0),
    dict(id="scan_001", t=[8.8, -5.0, 1.55], gain=1.1),
    dict(id="scan_002", t=[17.0, -2.0, 1.5], gain=0.95),
    dict(id="scan_049", t=[-6.0, 7.0, 1.5], gain=1.0),
]


def _basis(d, up):
    z = -np.array(d, float)
    x = np.cross(np.array(up, float), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return x, y, z


def cube_directions(size):
    """(6, size, size, 3) unit directions of every cubemap texel centre (rows from the bottom),
    as project.depth_lookup indexes them."""
    n = (np.arange(size) + 0.5) / size * 2 - 1
    NY, NX = np.meshgrid(n, n, indexing="ij")
    out = np.empty((6, size, size, 3))
    for f, (d, up) in enumerate(FACES):
        x, y, z = _basis(d, up)
        v = NX[..., None] * x + NY[..., None] * y - z
        out[f] = v / np.linalg.norm(v, axis=-1, keepdims=True)
    return out


def pano_directions(W, H):
    """(H, W, 3) unit directions of every equirectangular texel centre (project.sample_pano)."""
    az = (np.arange(W) + 0.5) / W * 2 * np.pi
    el = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    AZ, EL = np.meshgrid(az, el)
    return np.stack([np.cos(EL) * np.cos(AZ), np.cos(EL) * np.sin(AZ), np.sin(EL)], -1)


def box_distance(origin, dirs, box):
    """Distance from origin (inside the box) to its walls along unit dirs (..., 3)."""
    x0, x1, y0, y1, z0, z1 = box
    lo, hi = np.array([x0, y0, z0]), np.array([x1, y1, z1])
    o = np.asarray(origin, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        t_hi = (hi - o) / dirs
        t_lo = (lo - o) / dirs
    t = np.where(dirs > 0, t_hi, np.where(dirs < 0, t_lo, np.inf))
    return t.min(axis=-1)


def write_manifest(data, stations, wb=(1.01, 1, 1.03)):
    nodes = [dict(id=s["id"], index=int(s["id"][5:]), pose=dict(t=list(s["t"])), exposure=dict(gain=s["gain"], wb=list(wb)))
             for s in stations]
    os.makedirs(data, exist_ok=True)
    with open(os.path.join(data, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(nodes=nodes, mesh=dict(path="mesh/dollhouse.glb"), contentHashes={}), f, indent=1)


def write_depth_maps(data, stations, size, distance):
    """distance(origin, dirs) -> distances; one data/depth1024/<id>.f32 per station."""
    dirs = cube_directions(size)
    os.makedirs(os.path.join(data, "depth1024"), exist_ok=True)
    for s in stations:
        D = distance(np.asarray(s["t"], float), dirs).astype(np.float32)
        D.tofile(os.path.join(data, "depth1024", f"{s['id']}.f32"))


def srgb8(linear):
    c = np.clip(linear, 0, 1)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.clip(np.round(s * 255), 0, 255).astype(np.uint8)


def write_panoramas(data, stations, W, H, colour):
    """colour(station, dirs) -> linear RGB (H, W, 3); saved as lossless WebP, divided by the
    station's gain so that project()'s exposure correction gives the scene's colour back."""
    dirs = pano_directions(W, H)
    os.makedirs(os.path.join(data, "pano8k"), exist_ok=True)
    for s in stations:
        rgb = colour(s, dirs) / (s["gain"] * np.array([1.01, 1.0, 1.03]))
        Image.fromarray(srgb8(rgb)).save(os.path.join(data, "pano8k", f"{s['id']}_8192.webp"), lossless=True)


def gh_sky(s, dirs):
    """A smooth panorama for the mini Grand Hall (no scene: only the code paths matter)."""
    az = np.arctan2(dirs[..., 1], dirs[..., 0])
    el = np.arcsin(np.clip(dirs[..., 2], -1, 1))
    k = int(s["id"][5:])
    return np.stack([0.35 + 0.2 * np.sin(3 * az + k), 0.3 + 0.15 * np.cos(2 * el), 0.25 + 0.1 * np.sin(az + el)], -1)


def write_gh_inputs(data, depth_size=64, pano=(256, 128)):
    write_manifest(data, GH_STATIONS)
    write_depth_maps(data, GH_STATIONS, depth_size, lambda o, d: box_distance(o, d, GH_BOX))
    write_panoramas(data, GH_STATIONS, *pano, gh_sky)


# --- the mini Grand Hall's walls ---------------------------------------------------------------------

def _top(o, du):
    if o["headShape"] == "semicircular":
        half = o["width"] / 2
        return o["head"] + np.sqrt(np.maximum(0.0, half * half - du ** 2))
    return o["head"]


def gh_relief(room, wall, U, V):
    """Depth (in front of the wall face), validity and linear colour of a synthetic Grand Hall
    wall at (U, V): skirting, pilasters, a fin of the neighbouring wall in each corner, and the
    config's openings (open doors unseen, closed doors set back, windows with curtains at -0.2
    and glass at -0.9; the end arch's glass not separated, as in the scan)."""
    L = wall["length"]
    d = np.zeros(U.shape)
    d[V < 0.16] = 0.02
    d[(np.mod(U, 2.0) < 0.3) & (V >= 0.16)] = 0.05
    fin = (((U > 0.1) & (U < 0.3)) | ((L - U > 0.1) & (L - U < 0.3))) & (V > 1.0) & (V < 2.0)
    d[fin] = 0.6
    valid = np.ones(U.shape, bool)
    colour = np.stack([0.45 + 0.1 * np.sin(U), 0.35 + 0.05 * np.cos(2 * V), np.full(U.shape, 0.22)], -1)
    for o in room["openings"]:
        if o["wall"] != wall["id"]:
            continue
        c = roomlib.opening_centre(room, o)
        half = o["width"] / 2
        inside = (np.abs(U - c) <= half) & (V >= o["sill"]) & (V <= _top(o, U - c))
        if o["kind"] == "door":
            if o["stateInScan"] == "open":
                valid &= ~inside
            else:
                d[inside] = -0.05
            continue
        curtain = inside & (np.abs(U - c) > 0.45 * half)
        glass = inside & ~curtain
        d[curtain] = -0.2
        d[glass] = -0.25 if o["id"] == "arch-end" else -0.9
        colour[curtain] = (0.5, 0.15, 0.1)
        colour[glass] = (0.15, 0.25, 0.6)
    return d, valid, colour


def write_gh_walls(room, work, rng):
    """out-walls/<view>.position.f32 and proj/<view>.npz for every wall tile of the views."""
    views = roomlib.wall_views(room)
    walls = {w["name"]: w for w in roomlib.walls(room)}
    os.makedirs(os.path.join(work, "out-walls"), exist_ok=True)
    os.makedirs(os.path.join(work, "proj"), exist_ok=True)
    ppm, top = 200.0, room["survey"]["wallViews"]["heightRange"][1]
    for name, wall in walls.items():
        nX, nY = wall["normalE57"]
        axis = 0 if abs(nX) == 1.0 else 1
        plane, sign = wall["cornerE57"][axis], (nX, nY)[axis]
        offset = 0
        for v in sorted((v for v in views if v["wall"] == name), key=lambda v: v["tile"]):
            w, h = v["pixels"]
            U, V = np.meshgrid((offset + np.arange(w) + 0.5) / ppm, top - (np.arange(h) + 0.5) / ppm)
            d, valid, colour = gh_relief(room, wall, U, V)
            valid &= rng.random(U.shape) > 0.0005
            x_off = ((np.arange(w) + 0.5) / w - 0.5) * v["size"][0]
            y_off = ((h - 1 - np.arange(h) + 0.5) / h - 0.5) * v["size"][1]
            X_off, Y_off = np.meshgrid(x_off, y_off)
            P = np.zeros((h, w, 4), np.float32)
            P[..., 0] = v["target"][0] + X_off * wall["uE57"][0]
            P[..., 1] = v["target"][1] + X_off * wall["uE57"][1]
            P[..., 2] = v["target"][2] + Y_off
            P[..., axis] = plane + sign * d
            P[..., 3] = valid
            P[~valid, :3] = 0
            P[::-1].tofile(os.path.join(work, "out-walls", f"{v['name']}.position.f32"))
            weight = (valid & (rng.random(U.shape) > 0.002)).astype(np.float32) * (1 + 0.01 * U).astype(np.float32)
            np.savez_compressed(os.path.join(work, "proj", f"{v['name']}.npz"),
                                rgb=np.where(valid[..., None], colour, 0).astype(np.float32), weight=weight, valid=valid)
            offset += w


def write_gh_ceiling_tile(room, work, every=32):
    """The ceiling's position tile, valid on every `every`-th row only (keeps projection cheap)."""
    v = roomlib.ceiling_view(room)
    w, h = v["pixels"]
    x_off = ((np.arange(w) + 0.5) / w - 0.5) * v["size"][0]
    y_off = ((np.arange(h) + 0.5) / h - 0.5) * v["size"][1]          # rows from the bottom
    X_off, Y_off = np.meshgrid(x_off, y_off)
    P = np.zeros((h, w, 4), np.float32)
    P[..., 0] = v["eye"][0] - X_off                                   # image right = E57 -X
    P[..., 1] = v["eye"][1] + Y_off                                   # image up = E57 +Y
    P[..., 2] = 6.745 + 0.08 * ((np.floor(X_off) + np.floor(Y_off)) % 2)
    P[..., 3] = (np.arange(h)[:, None] % every) == 0
    P[P[..., 3] == 0, :3] = 0
    P.tofile(os.path.join(work, "out-walls", f"{v['name']}.position.f32"))


def write_dense_npz(path, h, w, rng, with_valid):
    """A smooth projected surface with a few unseen texels (fill must run)."""
    yy, xx = np.mgrid[0:h, 0:w]
    rgb = np.stack([0.3 + 0.1 * np.sin(xx / 97.0), 0.25 + 0.1 * np.cos(yy / 53.0), 0.2 + 0.05 * np.sin((xx + yy) / 71.0)], -1)
    weight = (rng.random((h, w)) > 0.004).astype(np.float32)
    arrays = dict(rgb=rgb.astype(np.float32), weight=weight)
    if with_valid:
        arrays["valid"] = np.ones((h, w), bool)
    np.savez_compressed(path, **arrays)


def write_gh_overhead_and_floor(work, rng):
    write_dense_npz(os.path.join(work, "proj", "ceiling.npz"), 1589, 3170, rng, True)
    write_dense_npz(os.path.join(work, "proj", "dome.npz"), 768, 4096, rng, False)
    write_dense_npz(os.path.join(work, "proj", "floor.npz"), 1271, 2536, rng, False)
    with open(os.path.join(work, "proj", "floor-patches.json"), "w") as f:
        json.dump([dict(id="scan_001", x=0.004, z=0.037, height=1.505, radius_deg=14.0)], f, indent=1)

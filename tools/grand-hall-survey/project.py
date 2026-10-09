"""Projects the world-aligned 8K station panoramas onto measured surfaces.

Each output texel has a world position and surface normal (E57 frame, Z up).
Every station that sees the texel (in front of the surface, and not occluded
according to its distance cubemap rendered from the dollhouse mesh) contributes
its panorama colour, weighted towards near and head-on views. Colours are
blended in linear light after each panorama's manifest exposure correction.
"""
import json
import os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.getcwd(), "data")
FACES = [((1, 0, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)),
         ((0, -1, 0), (0, 0, 1)), ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, 1, 0))]
DEPTH_SIZE = 1024
DEPTH_DIR = "depth1024"


def _basis(d, up):
    z = -np.array(d, float)
    x = np.cross(np.array(up, float), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return x, y, z


BASES = [_basis(d, u) for d, u in FACES]
DIRS = np.array([d for d, _ in FACES], float)


def load_views(name):
    """A view list kept beside these tools (views-walls.json, views-ceiling.json, ...)."""
    return json.load(open(os.path.join(HERE, name)))


def stations(max_index=48):
    m = json.load(open(os.path.join(DATA, "manifest.json")))
    out = []
    for n in m["nodes"]:
        i = int(n["id"][5:])
        if i <= max_index:
            g = n["exposure"]["gain"]
            wb = n["exposure"]["wb"]
            out.append(dict(id=n["id"], t=np.array(n["pose"]["t"], float), gain=np.array([g * wb[0], g * wb[1], g * wb[2]])))
    return out


def load_depth(sid):
    a = np.fromfile(os.path.join(DATA, DEPTH_DIR, f"{sid}.f32"), dtype=np.float32)
    return a.reshape(6, DEPTH_SIZE, DEPTH_SIZE)


def depth_lookup(depth, v):
    """Nearest stored distance around world directions v (N,3): the minimum
    over a 3x3 neighbourhood, so thin occluders are not missed."""
    face = np.argmax(v @ DIRS.T, axis=1)
    out = np.full(len(v), 1000.0, np.float32)
    for f, (x, y, z) in enumerate(BASES):
        m = face == f
        if not m.any():
            continue
        vv = v[m]
        pz = vv @ z
        nx = (vv @ x) / -pz
        ny = (vv @ y) / -pz
        col = np.clip(((nx + 1) / 2 * DEPTH_SIZE).astype(int), 0, DEPTH_SIZE - 1)
        row = np.clip(((ny + 1) / 2 * DEPTH_SIZE).astype(int), 0, DEPTH_SIZE - 1)
        d = depth[f]
        best = d[row, col]
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                best = np.minimum(best, d[np.clip(row + dr, 0, DEPTH_SIZE - 1), np.clip(col + dc, 0, DEPTH_SIZE - 1)])
        out[m] = best
    return out


# The five chandeliers (E57 centre XY, radius, Z span): rays through them are
# rejected outright, since their crystal and arms are finer than any depth map.
CHANDELIERS = [
    # central gilt chandelier: body, then its thin stem to the dome's plate
    ((8.767, -4.958), 0.9, (3.95, 6.35)),
    ((8.767, -4.958), 0.14, (6.35, 8.9)),
    # the four scroll chandeliers: body, then stem to the rose
    ((15.509, -2.288), 0.66, (3.65, 5.3)),
    ((15.509, -2.288), 0.12, (5.3, 6.8)),
    ((2.116, -2.286), 0.66, (3.65, 5.3)),
    ((2.116, -2.286), 0.12, (5.3, 6.8)),
    ((15.456, -7.737), 0.66, (3.65, 5.3)),
    ((15.456, -7.737), 0.12, (5.3, 6.8)),
    ((2.102, -7.686), 0.66, (3.65, 5.3)),
    ((2.102, -7.686), 0.12, (5.3, 6.8)),
]


def blocked_by_chandelier(S, P):
    """Whether each segment S->P (P: N,3) passes through a chandelier volume."""
    blocked = np.zeros(len(P), bool)
    V = P - S
    for (cx, cy), r, (z0, z1) in CHANDELIERS:
        # t range where the segment's height is within the chandelier's span
        vz = V[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            ta = np.where(np.abs(vz) > 1e-9, (z0 - S[2]) / vz, -np.inf)
            tb = np.where(np.abs(vz) > 1e-9, (z1 - S[2]) / vz, np.inf)
        lo = np.clip(np.minimum(ta, tb), 0, 1)
        hi = np.clip(np.maximum(ta, tb), 0, 1)
        inside_span = (np.abs(vz) <= 1e-9) & (S[2] >= z0) & (S[2] <= z1)
        lo = np.where(inside_span, 0, lo)
        hi = np.where(inside_span, 1, hi)
        Dx = S[0] - cx
        Dy = S[1] - cy
        vv = V[:, 0] ** 2 + V[:, 1] ** 2
        t = np.where(vv > 1e-12, -(Dx * V[:, 0] + Dy * V[:, 1]) / np.maximum(vv, 1e-12), 0)
        t = np.clip(t, lo, hi)
        qx = Dx + t * V[:, 0]
        qy = Dy + t * V[:, 1]
        hit = (hi > lo) & (qx * qx + qy * qy < r * r)
        blocked |= hit
    return blocked


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055) * 255.0


_pano_cache = {}


def load_pano(sid, lod=8192):
    key = (sid, lod)
    if key not in _pano_cache:
        _pano_cache.clear()
        path = os.path.join(DATA, "pano8k" if lod == 8192 else "pano", f"{sid}_{lod}.webp")
        _pano_cache[key] = np.asarray(Image.open(path).convert("RGB"))
    return _pano_cache[key]


def sample_pano(img, v):
    """Bilinear sample of an equirect image along world directions v (N,3)."""
    H, W = img.shape[:2]
    az = np.arctan2(v[:, 1], v[:, 0]) % (2 * np.pi)
    el = np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1]))
    fx = az / (2 * np.pi) * W - 0.5
    fy = (np.pi / 2 - el) / np.pi * H - 0.5
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    tx = (fx - x0)[:, None]
    ty = (fy - y0)[:, None]
    x0w = x0 % W
    x1w = (x0 + 1) % W
    y0c = np.clip(y0, 0, H - 1)
    y1c = np.clip(y0 + 1, 0, H - 1)
    c00 = img[y0c, x0w].astype(np.float32)
    c10 = img[y0c, x1w].astype(np.float32)
    c01 = img[y1c, x0w].astype(np.float32)
    c11 = img[y1c, x1w].astype(np.float32)
    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty


def _station_samples(st, points, normals, cos_min, p_cos, q_dist, max_dist, lod, nadir=0.0):
    v = points - st["t"]
    dist = np.linalg.norm(v, axis=1)
    cos = -np.einsum("ij,ij->i", v, normals) / np.maximum(dist, 1e-6)
    ok = (cos > cos_min) & (dist < max_dist)
    down = -v[:, 2] / np.maximum(dist, 1e-6)
    if nadir > 0:
        # The panoramas' nadirs are patched over the tripod: rays within
        # `nadir` radians of straight down are skipped, fading in over the
        # next 12 degrees so no seam marks the patch's edge.
        ok &= down < np.cos(nadir)
    if not ok.any():
        return None
    idx = np.nonzero(ok)[0]
    idx = idx[~blocked_by_chandelier(st["t"], points[idx])]
    if len(idx) == 0:
        return None
    depth = load_depth(st["id"])
    stored = depth_lookup(depth, v[idx])
    d = dist[idx]
    tol = 0.035 + 0.008 * d / np.maximum(cos[idx], 0.25)
    vis = stored >= d - tol
    idx = idx[vis]
    if len(idx) == 0:
        return None
    img = load_pano(st["id"], lod)
    col = srgb_to_linear(sample_pano(img, v[idx])) * st["gain"][None, :]
    w = (cos[idx] ** p_cos) / (dist[idx] ** q_dist)
    if nadir > 0:
        angle = np.arccos(np.clip(down[idx], -1, 1))
        fade = np.clip((angle - nadir) / np.radians(12), 0, 1)
        w = w * fade * fade * (3 - 2 * fade)
    return idx, col, w


def project(points, normals, station_list=None, lod=8192, cos_min=0.2, p_cos=4.0, q_dist=3.0, max_dist=16.0, report=False, robust=True, nadir=0.0, glare=0):
    """Returns linear RGB (N,3) and the total weight (N,) per texel. A second
    pass down-weights any station whose colour disagrees with the consensus
    (an occluder the depth maps missed). With `glare` > 0, that many further
    passes down-weight only samples brighter than the consensus — reflections
    on a polished surface, which only ever add light."""
    if station_list is None:
        station_list = stations()
    N = len(points)
    acc = np.zeros((N, 3), np.float64)
    wsum = np.zeros(N, np.float64)
    for st in station_list:
        res = _station_samples(st, points, normals, cos_min, p_cos, q_dist, max_dist, lod, nadir)
        if res is None:
            continue
        idx, col, w = res
        acc[idx] += col * w[:, None]
        wsum[idx] += w
        if report:
            print(f"  {st['id']}: {len(idx)} texels")
    mean = acc / np.maximum(wsum, 1e-12)[:, None]
    if not robust:
        return mean, wsum
    acc2 = np.zeros((N, 3), np.float64)
    wsum2 = np.zeros(N, np.float64)
    luma = np.array([0.2126, 0.7152, 0.0722])
    for st in station_list:
        res = _station_samples(st, points, normals, cos_min, p_cos, q_dist, max_dist, lod, nadir)
        if res is None:
            continue
        idx, col, w = res
        m = mean[idx]
        diff = np.abs((col - m) @ luma) + 0.5 * np.abs(col - m).max(axis=1)
        sigma = 0.02 + 0.2 * (m @ luma)
        agree = np.exp(-(diff / sigma) ** 2)
        w2 = w * (agree + 1e-4)
        acc2[idx] += col * w2[:, None]
        wsum2[idx] += w2
    out = np.where(wsum2[:, None] > 0, acc2 / np.maximum(wsum2, 1e-12)[:, None], mean)
    for _ in range(glare):
        acc3 = np.zeros((N, 3), np.float64)
        wsum3 = np.zeros(N, np.float64)
        for st in station_list:
            res = _station_samples(st, points, normals, cos_min, p_cos, q_dist, max_dist, lod, nadir)
            if res is None:
                continue
            idx, col, w = res
            m = out[idx]
            brighter = np.maximum(0.0, (col - m) @ luma)
            agree = np.exp(-(brighter / (0.01 + 0.12 * (m @ luma))) ** 2)
            w3 = w * (agree + 1e-4)
            acc3[idx] += col * w3[:, None]
            wsum3[idx] += w3
        out = np.where(wsum3[:, None] > 0, acc3 / np.maximum(wsum3, 1e-12)[:, None], out)
    return out, wsum


def save_rgb(path, rgb_linear, w, h, quality=90):
    img = linear_to_srgb(rgb_linear.reshape(h, w, 3)).astype(np.uint8)
    im = Image.fromarray(img)
    if path.endswith(".webp"):
        im.save(path, quality=quality, method=6)
    else:
        im.save(path)
    return im


def plane_grid(origin, u_dir, v_dir, u_len, v_len, ppm):
    """Texel centres on a plane: rows from the top (v_len) down to 0."""
    w = int(round(u_len * ppm))
    h = int(round(v_len * ppm))
    us = (np.arange(w) + 0.5) / ppm
    vs = v_len - (np.arange(h) + 0.5) / ppm
    U, V = np.meshgrid(us, vs)
    P = np.asarray(origin)[None, None, :] + U[..., None] * np.asarray(u_dir)[None, None, :] + V[..., None] * np.asarray(v_dir)[None, None, :]
    return P.reshape(-1, 3), w, h

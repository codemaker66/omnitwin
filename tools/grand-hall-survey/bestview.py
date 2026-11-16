"""Best-view texturing of the Grand Hall's walls: what label-views.py and project-walls.py --labels share.

After Waechter, Moehrle and Goesele, "Let There Be Color! Large-Scale Texturing of 3D Reconstructions"
(ECCV 2014): every part of a wall takes its colour from the one panorama that photographed it most
sharply, instead of an average of every panorama that saw it. Averaging is what blurred the walls: on
the end wall's deacon boards the median texel mixed six stations, and at the relief's depth those
stations disagree by 8-10 mm, which doubled the lettering, while varnish glare from a few of them
lifted the portraits' dark canvases.

The grid is each wall's orthophoto (200 px/m, rows from v = 7.0 m down; views-walls.json's position
tiles, with the corners' fins moved back onto the wall by fix-corners.py --positions-only), cut into
40 mm blocks of 8 x 8 texels. A texel's world point is its place on the wall plane plus its depth
along the wall's normal; a sub-sample inside a texel takes the depth interpolated bilinearly, or the
texel's own depth across a step in the relief.

Colours are worked in the panoramas' own sRGB encoding (0-255 floats), each station's exposure (the
manifest's gain and white balance) applied in linear light, as project.py applies it.
"""
import ctypes
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as P  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

SRC_PPM = 200.0          # orthophoto texels per metre
SRC_TOP = 7.0            # v (metres above the floor) at the top edge of the orthophotos
FLOOR = 0.045            # E57 Z of the hall's floor
BLOCK = 8                # texels per 40 mm block
L, W = 21.135, 10.59
COS_MIN, MAX_DIST = 0.2, 16.0   # visibility(): the least cosine of incidence and the farthest station (project.py's defaults)
# How far beyond the mesh's outline of an occluder a station's view of what lies behind is not trusted (metres, measured
# at the occluder). 0.0: no margin, as the Grand Hall is built. tools/surveyed-rooms sets it for a room (its gate B25);
# label-views.py then counts only the views clear of that margin (occluder_cube, clear_of_occluders below).
OCCLUDER_MARGIN = 0.0
MARGIN_TEXELS = 16              # the margin reaches at most this many cubemap texels from a ray
PIX_RAD = 2 * np.pi / 8192   # angular size of an 8K equirect pixel (its rows; columns are finer off the horizon)
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# Each wall's frame in the E57 plan (X, Y), as wall-views.py placed the orthographic tiles: u = 0 at
# `start`, u runs along `u`, `n` points into the room.
WALLS = {
    'window': dict(start=(19.36, -10.255), u=(-1.0, 0.0), n=(0.0, 1.0), length=L),
    'door': dict(start=(-1.775, 0.335), u=(1.0, 0.0), n=(0.0, -1.0), length=L),
    'end': dict(start=(-1.775, -10.255), u=(0.0, 1.0), n=(1.0, 0.0), length=W),
    'fire': dict(start=(19.36, 0.335), u=(0.0, -1.0), n=(-1.0, 0.0), length=W),
}


def below_normal_priority():
    """Survey jobs share the machine with release gates: run below normal priority (Windows)."""
    if os.name == 'nt':
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)


def peak_mb():
    """This process's peak working set (MB, Windows; 0 elsewhere): the build keeps it under 1.5 GB."""
    if os.name != 'nt':
        return 0
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                    ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                    ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                    ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]
    c = Counters()
    c.cb = ctypes.sizeof(c)
    psapi = ctypes.WinDLL('psapi')
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    k32 = ctypes.WinDLL('kernel32')
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return round(c.PeakWorkingSetSize / 2 ** 20)


def mem_mb():
    """This process's working set now (MB, Windows; 0 elsewhere)."""
    if os.name != 'nt':
        return 0
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                    ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                    ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                    ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]
    c = Counters()
    c.cb = ctypes.sizeof(c)
    psapi = ctypes.WinDLL('psapi')
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    k32 = ctypes.WinDLL('kernel32')
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return round(c.WorkingSetSize / 2 ** 20)


# sRGB codes (0-255 floats) to linear light and back, as float32 lookups in quarter-code steps
# (project.py's formulas; the round trip is exact at the grid and within 0.01 code between).
_CODES = np.arange(0, 255.001, 0.25, dtype=np.float64)
_LIN = P.srgb_to_linear(_CODES)


def to_linear(x):
    return np.interp(x, _CODES, _LIN).astype(np.float32)


def to_srgb(y):
    return np.interp(np.clip(y, 0.0, 1.0), _LIN, _CODES).astype(np.float32)


def use_data(path):
    """Point project.py at a data directory (manifest, depth maps, panoramas) other than ./data."""
    P.DATA = os.path.abspath(path)


def wall_vectors(wall):
    f = WALLS[wall]
    o = np.array([f['start'][0], f['start'][1], FLOOR])
    u = np.array([f['u'][0], f['u'][1], 0.0])
    n = np.array([f['n'][0], f['n'][1], 0.0])
    return o, u, n


def wall_tiles(wall):
    return sorted([v for v in P.load_views('views-walls.json') if v['wall'] == wall], key=lambda v: v['tile'])


class Grid:
    """A wall's orthophoto grid: the relief as depth along the wall's normal (metres, from the frame's
    plane) at every texel the mesh covers, and each texel's place on the plane. A tile's texels are
    its own width over its pixels (4.9988 mm along the long walls' 1057-pixel tiles, 5 mm elsewhere).
    Reads out-walls/<view>.fixed.f32 (the corners' fins moved back onto the wall) when present and
    `fixed`, else the rendered positions, and checks every covered texel lies at its centre."""

    def __init__(self, wall, fixed=True):
        self.wall = wall
        self.o, self.u, self.n = wall_vectors(wall)
        depth, valid, ucol, pitch = [], [], [], []
        for v in wall_tiles(wall):
            w, h = v['pixels']
            name = f"out-walls/{v['name']}.fixed.f32"
            if not (fixed and os.path.exists(name)):
                name = f"out-walls/{v['name']}.position.f32"
            Pt = np.fromfile(name, dtype=np.float32).reshape(h, w, 4)[::-1]
            ok = Pt[..., 3] > 0.5
            rel = Pt[..., :3].astype(np.float64) - self.o
            pu = v['size'][0] / w
            self.pitch_v = v['size'][1] / h
            cols = v['u0'] + (np.arange(w) + 0.5) * pu
            rows = SRC_TOP - (np.arange(h) + 0.5) * self.pitch_v
            du = np.abs(rel @ self.u - cols[None, :])[ok]
            dv = np.abs(rel[..., 2] - rows[:, None])[ok]
            if du.size and (du.max() > 0.001 or dv.max() > 0.001):
                raise SystemExit(f'{name}: positions are off their texel centres by {du.max():.4f} / {dv.max():.4f} m')
            depth.append(np.where(ok, rel @ self.n, 0.0).astype(np.float32))
            valid.append(ok)
            ucol.append(cols)
            pitch.append(np.full(w, pu))
            self.vrow = rows
        self.depth = np.concatenate(depth, 1)
        self.valid = np.concatenate(valid, 1)
        self.ucol = np.concatenate(ucol)
        self.pitch_u = np.concatenate(pitch)

    def points(self, r, c, depth, fr=0.0, fc=0.0):
        """World points (N, 3) of texels (r, c) at sub-texel offsets (fr down, fc along u, in texels)
        and the given depth along the wall's normal (metres)."""
        uu = self.ucol[c] + fc * self.pitch_u[c]
        vv = self.vrow[r] - fr * self.pitch_v
        out = np.empty((len(uu), 3))
        out[:, 0] = self.o[0] + uu * self.u[0] + depth * self.n[0]
        out[:, 1] = self.o[1] + uu * self.u[1] + depth * self.n[1]
        out[:, 2] = self.o[2] + vv
        return out

    def col_at(self, u):
        """Fractional texel column (centres at integers) of positions u along the wall."""
        return np.interp(u, self.ucol, np.arange(len(self.ucol), dtype=np.float64))

    def row_at(self, v):
        return (SRC_TOP - np.asarray(v)) / self.pitch_v - 0.5


def blocks_shape(H, Wd):
    return (H + BLOCK - 1) // BLOCK, (Wd + BLOCK - 1) // BLOCK


def block_sum(a, nby, nbx):
    """Sums of a per-texel (H, W[, ...]) array over 8 x 8 blocks."""
    H, Wd = a.shape[:2]
    pad = [(0, nby * BLOCK - H), (0, nbx * BLOCK - Wd)] + [(0, 0)] * (a.ndim - 2)
    a = np.pad(a, pad)
    return a.reshape(nby, BLOCK, nbx, BLOCK, *a.shape[2:]).sum(axis=(1, 3))


def sub_depth(depth, valid, r, c, fr, fc, step=0.01):
    """Depth at fractional texel offsets (fr down, fc along u, in texels, within +-0.5) of texels
    (r, c): bilinear in the relief, the texel's own depth across a step of more than `step` metres."""
    H, Wd = depth.shape
    y = r + fr
    x = c + fc
    fy = np.floor(y)
    fx = np.floor(x)
    y0 = np.clip(fy.astype(np.int64), 0, H - 1)
    x0 = np.clip(fx.astype(np.int64), 0, Wd - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    x1 = np.clip(x0 + 1, 0, Wd - 1)
    ty = (y - fy).astype(np.float32)
    tx = (x - fx).astype(np.float32)
    d00, d01, d10, d11 = depth[y0, x0], depth[y0, x1], depth[y1, x0], depth[y1, x1]
    ok = valid[y0, x0] & valid[y0, x1] & valid[y1, x0] & valid[y1, x1]
    hi = np.maximum(np.maximum(d00, d01), np.maximum(d10, d11))
    lo = np.minimum(np.minimum(d00, d01), np.minimum(d10, d11))
    smooth = ok & (hi - lo <= step)
    bil = (d00 * (1 - tx) + d01 * tx) * (1 - ty) + (d10 * (1 - tx) + d11 * tx) * ty
    return np.where(smooth, bil, depth[r, c])


def blocked_by_chandelier(S, Pts):
    """project.py's chandelier test (the same arithmetic), run per chandelier volume only on the rays
    whose height range reaches it: most rays to a wall pass below the chandeliers."""
    blocked = np.zeros(len(Pts), bool)
    zlo = np.minimum(S[2], Pts[:, 2])
    zhi = np.maximum(S[2], Pts[:, 2])
    for (cx, cy), r, (z0, z1) in P.CHANDELIERS:
        cand = np.nonzero((zhi >= z0) & (zlo <= z1))[0]
        if not len(cand):
            continue
        V = Pts[cand] - S
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
        blocked[cand] |= (hi > lo) & (qx * qx + qy * qy < r * r)
    return blocked


def visibility(st, depthcube, pts, nrm):
    """Whether station `st` saw each point (project.py's test: in front of the surface within 78
    degrees, nearer than 16 m, clear of the chandeliers, nothing nearer in its distance cubemap),
    with the distance and the cosine of incidence."""
    v = pts - st['t']
    dist = np.linalg.norm(v, axis=1)
    cos = -(v @ nrm) / np.maximum(dist, 1e-6)
    ok = (cos > COS_MIN) & (dist < MAX_DIST)
    idx = np.nonzero(ok)[0]
    if len(idx):
        idx = idx[~blocked_by_chandelier(st['t'], pts[idx])]
    vis = np.zeros(len(pts), bool)
    if len(idx):
        stored = P.depth_lookup(depthcube, v[idx])
        d = dist[idx]
        tol = 0.035 + 0.008 * d / np.maximum(cos[idx], 0.25)
        vis[idx[stored >= d - tol]] = True
    return vis, dist, cos


# ---------------------------------------------------------------- the occluders' margin (OCCLUDER_MARGIN > 0 only)
#
# The mesh draws a thing standing proud of a wall (a pediment, a lamp) a little smaller than the panoramas show it, so
# along the edge of the zone it hides from a station, the station's photograph still shows the thing where the mesh
# says the wall is in view. A blend of many stations washes those rims out; one station a block prints them, far from
# the thing itself (the Saloon's pediments, 0.3 m proud: outlines in the plaster half a metre above them). The cure is
# the depth-border mask of masked photo blending (Callieri, Cignoni, Corsini and Scopigno 2008): a view is not trusted
# within a margin of an occluder's outline.

def cube_texel(cube, v):
    """The cubemap's own texel along world directions v (N, 3): project.depth_lookup's indexing without its 3 x 3."""
    face = np.argmax(v @ P.DIRS.T, axis=1)
    out = np.full(len(v), 1000.0, np.float32)
    size = cube.shape[-1]
    for f, (x, y, z) in enumerate(P.BASES):
        m = face == f
        if not m.any():
            continue
        vv = v[m]
        pz = vv @ z
        col = np.clip((((vv @ x) / -pz + 1) / 2 * size).astype(int), 0, size - 1)
        row = np.clip((((vv @ y) / -pz + 1) / 2 * size).astype(int), 0, size - 1)
        out[m] = cube[f][row, col]
    return out


def texel_angle(size):
    """The angle (radians) each texel of a cubemap face spans, as the side of a square of its solid angle:
    2 / size at the face's centre, 0.44 of that in a corner."""
    n = (np.arange(size) + 0.5) / size * 2 - 1
    return ((2.0 / size) * (1.0 + n[:, None] ** 2 + n[None, :] ** 2) ** -0.75).astype(np.float32)


def padded_cube(cube, pad):
    """The distance cubemap with `pad` more texels round every face, read from the neighbouring faces along the
    padding texels' own directions, so a neighbourhood near a face's edge sees what lies across it."""
    size = cube.shape[-1]
    n = (np.arange(-pad, size + pad) + 0.5) / size * 2 - 1
    NY, NX = np.meshgrid(n, n, indexing='ij')
    edge = np.ones(NX.shape, bool)
    edge[pad:-pad, pad:-pad] = False
    out = np.empty((6, size + 2 * pad, size + 2 * pad), np.float32)
    for f, (x, y, z) in enumerate(P.BASES):
        out[f, pad:-pad, pad:-pad] = cube[f]
        out[f][edge] = cube_texel(cube, NX[edge][:, None] * x + NY[edge][:, None] * y - z)
    return out


def _min3(a):
    """The 3 x 3 minimum over the last two axes (edges repeated)."""
    b = a.copy()
    np.minimum(b[..., 1:], a[..., :-1], out=b[..., 1:])
    np.minimum(b[..., :-1], a[..., 1:], out=b[..., :-1])
    c = b.copy()
    np.minimum(c[..., 1:, :], b[..., :-1, :], out=c[..., 1:, :])
    np.minimum(c[..., :-1, :], b[..., 1:, :], out=c[..., :-1, :])
    return c


def occluder_cube(depthcube):
    """For every texel of a station's distance cubemap, the nearest surface within OCCLUDER_MARGIN of its ray: the
    least stored distance s among the texels up to m away (m = 1..MARGIN_TEXELS) with s x m x the texel's angle
    <= OCCLUDER_MARGIN, that is, standing no farther than the margin from the ray where the surface is. Infinite
    where there is none."""
    pad = MARGIN_TEXELS
    cur = padded_cube(depthcube, pad)
    angle = texel_angle(depthcube.shape[-1])
    near = np.full(depthcube.shape, np.inf, np.float32)
    for m in range(1, pad + 1):
        cur = _min3(cur)
        c = cur[:, pad:-pad, pad:-pad]
        near = np.where((c * (m * angle)[None] <= OCCLUDER_MARGIN) & (c < near), c, near)
    return near


def clear_of_occluders(near, v, dist, cos):
    """Whether points along v from a station (N, 3; their distances and cosines of incidence) are clear of every
    occluder's margin: nothing in `near` (occluder_cube) stands nearer than the point by more than visibility()'s
    tolerance and what the surface's own slope explains over the margin (the wall itself is nearer on one side of the
    ray, by the margin x the tangent of incidence)."""
    tol = 0.035 + 0.008 * dist / np.maximum(cos, 0.25)
    slope = OCCLUDER_MARGIN * np.sqrt(np.maximum(1.0 - cos * cos, 0.0)) / np.maximum(cos, 1e-6)
    return cube_texel(near, v) >= dist - tol - slope


class Pano:
    """A station's 8K panorama with its exposure: colour samples in exposure-corrected sRGB (0-255
    floats), and luminance samples from a 16-bit luminance image (raw, or exposure-corrected with
    the white balance's luma-weighted gain)."""

    def __init__(self, st):
        self.st = st
        self.img = np.asarray(Image.open(os.path.join(P.DATA, 'pano8k', f"{st['id']}_8192.webp")).convert('RGB'))
        lin = P.srgb_to_linear(np.arange(256, dtype=np.float64))
        # per channel: raw code -> corrected sRGB code, linear in between (applied after bilinear sampling)
        self.lut = [np.clip(P.linear_to_srgb(lin * g), 0, 255).astype(np.float32) for g in st['gain']]
        self.lut_l = np.clip(P.linear_to_srgb(lin * float(LUMA @ np.asarray(st['gain'], np.float32))), 0, 255).astype(np.float32)
        self.codes = np.arange(256, dtype=np.float32)
        self._lum = None

    def rgb(self, pts):
        raw = P.sample_pano(self.img, pts - self.st['t'])
        out = np.empty(raw.shape, np.float32)
        for ch in range(3):
            out[:, ch] = np.interp(raw[:, ch], self.codes, self.lut[ch])
        return out

    def lum16(self):
        if self._lum is None:
            H = self.img.shape[0]
            out = np.empty(self.img.shape[:2], np.uint16)
            for y in range(0, H, 512):
                out[y:y + 512] = np.round(self.img[y:y + 512].astype(np.float32) @ (LUMA * 200)).astype(np.uint16)
            self._lum = out
        return self._lum

    def lum(self, pts, corrected=True):
        """Bilinear luminance along the rays to `pts` (0-255; exposure-corrected unless `corrected` is False)."""
        img = self.lum16()
        v = (pts - self.st['t']).astype(np.float32)
        Hh, Ww = img.shape
        az = np.arctan2(v[:, 1], v[:, 0]) % np.float32(2 * np.pi)
        el = np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1]))
        fx = az / np.float32(2 * np.pi) * Ww - 0.5
        fy = (np.float32(np.pi / 2) - el) / np.float32(np.pi) * Hh - 0.5
        x0 = np.floor(fx)
        y0 = np.floor(fy)
        tx = fx - x0
        ty = fy - y0
        x0 = x0.astype(np.int64)
        y0 = y0.astype(np.int64)
        x0w = x0 % Ww
        x1w = (x0 + 1) % Ww
        y0c = np.clip(y0, 0, Hh - 1)
        y1c = np.clip(y0 + 1, 0, Hh - 1)
        a = (img[y0c, x0w] * (1 - tx) + img[y0c, x1w] * tx) * (1 - ty) + (img[y1c, x0w] * (1 - tx) + img[y1c, x1w] * tx) * ty
        a = a * np.float32(1 / 200)
        return np.interp(a, self.codes, self.lut_l).astype(np.float32) if corrected else a.astype(np.float32)

    def close(self):
        self.img = None
        self._lum = None


def station_faces_wall(st, wall, margin=0.05):
    """Whether a station stands in front of the wall's plane (can see its room face at all)."""
    o, u, n = wall_vectors(wall)
    return float((st['t'] - o) @ n) > margin


def threads():
    """Worker threads for the row bands of a station (numpy releases the GIL in its loops); the
    survey keeps to four on the shared machine."""
    return int(os.environ.get('SURVEY_THREADS', '4'))


def wait_while_quiet():
    """Pauses while the file named by SURVEY_PAUSE_FILE exists (the machine's 'quiet' flag)."""
    import time
    flag = os.environ.get('SURVEY_PAUSE_FILE')
    waited = False
    while flag and os.path.exists(flag):
        if not waited:
            print('  paused: quiet', flush=True)
            waited = True
        time.sleep(30)


def pack_bits(mask):
    return np.packbits(mask, axis=-1)


def unpack_bits(bits, width):
    return np.unpackbits(bits, axis=-1, count=width).astype(bool)


def save_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)

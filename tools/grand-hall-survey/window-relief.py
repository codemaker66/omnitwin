"""Window relief and glass mask from the scan.

The windows are deep embrasures: curtains hang near the front, the glazing
sits up to 0.95 m back. The dollhouse mesh measures that depth at every
orthophoto texel (the window wall's position tiles), but noisily at the
curtains' edges; each opening's depth is rebuilt as two clean layers — the
curtains (and columns, and blind plaster) on their own smoothed depths, the
glazing flat at its measured depth — eased into each other along the glass
mask. The mask (glazing seen between the curtains) also lets the renderer
treat glass as outside light rather than a lit surface.

Outputs (on the window orthophoto grid, 200 px/m, rows from v = 7.0):
  proj/window-glass.npy     glass mask, packed into the wall atlas's alpha
  proj/window-layered.npy   layered depth inside each opening, for wall-depth.py
Usage (in the work directory): python3 $SURVEY/window-relief.py
"""
import os
import json, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import linear_to_srgb, load_views

L, W = 21.135, 10.59
SRC_PPM, SRC_TOP = 200.0, 7.0
XC = 8.795
WALL_Y = -4.963 - W / 2
RANGE = (-1.0, 0.15)            # depth range for the 8-bit median filter, metres
window_u = lambda scan_x: L / 2 + XC - scan_x
# id, kind, centre, width, sill, head (as hall-spec.ts HALL_OPENINGS)
OPENINGS = [
    ('arch-fireplace', 'arched-window', window_u(17.83), 2.7, 0.915, 3.76),
    ('window-fireplace', 'window', window_u(13.71), 1.43, 0.935, 3.305),
    ('arch-centre', 'arched-window', window_u(8.82), 2.67, 0.915, 3.76),
    ('window-end', 'window', window_u(3.93), 1.43, 0.935, 3.305),
    ('arch-end', 'arched-window', window_u(-0.19), 2.7, 0.915, 3.76),
]
# The end arch's glazing was not reconstructed (the mesh closes it with a
# plane); its twin across the hall's centre line gives the glass depth.
TWIN = {'arch-end': 'arch-fireplace'}


def depth_map():
    views = [v for v in load_views('views-walls.json') if v['wall'] == 'window']
    tiles = []
    for v in views:
        w, h = v['pixels']
        P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1]
        tiles.append(np.where(P[..., 3] > 0.5, P[..., 1] - WALL_Y, np.nan))
    return np.concatenate(tiles, 1)


def photo():
    tiles = [np.load(f'proj/wall-window-{t}.npz') for t in range(4)]
    return linear_to_srgb(np.concatenate([t['rgb'] for t in tiles], 1)) / 255.0


def top_at(kind, centre, width, head, u):
    if kind != 'arched-window':
        return head
    half = width / 2
    return head + np.sqrt(np.maximum(0.0, half * half - (u - centre) ** 2))


def median(a, size, lo, hi):
    """Median filter of a float map via an 8-bit image."""
    q = np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
    f = np.asarray(Image.fromarray(q).filter(ImageFilter.MedianFilter(size)), np.float32)
    return lo + f / 255 * (hi - lo)


def morph(mask, op, size):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MaxFilter(size) if op == 'grow' else ImageFilter.MinFilter(size))
    return np.asarray(im) > 127


def row_intervals(mask, bounds, smooth=61):
    """The glazing between the curtains, row by row (rows run down the window).

    Each row keeps its longest run; the runs' ends are median-smoothed up the
    window, then only ever widen going down (curtains part from the head and
    are tied back low), and stay within the sash's own jambs."""
    h, w = mask.shape
    lo = np.full(h, -1.0)
    hi = np.full(h, -1.0)
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        padded = np.concatenate([[0], row.astype(np.int8), [0]])
        edges = np.flatnonzero(np.diff(padded))
        starts, ends = edges[::2], edges[1::2]
        k = int(np.argmax(ends - starts))
        if ends[k] - starts[k] >= 20:
            lo[y], hi[y] = starts[k], ends[k]
    have = lo >= 0
    if not have.any():
        return np.zeros_like(mask)
    half = smooth // 2
    s_lo = np.full(h, np.nan)
    s_hi = np.full(h, np.nan)
    for y in range(h):
        window = slice(max(0, y - half), min(h, y + half + 1))
        sel = have[window]
        if sel.sum() >= 5:
            s_lo[y] = np.median(lo[window][sel])
            s_hi[y] = np.median(hi[window][sel])
    first = int(np.argmax(np.isfinite(s_lo)))
    out = np.zeros_like(mask)
    a, b = np.inf, -np.inf
    for y in range(first, h):
        if np.isfinite(s_lo[y]):
            a, b = min(a, s_lo[y]), max(b, s_hi[y])
        if not np.isfinite(a):
            continue
        a0, b0 = int(max(a, bounds[0])), int(min(b, bounds[1]))
        if b0 > a0:
            out[y, a0:b0] = True
    return out


def fill_from(a, passes=400):
    """Fills NaNs from their nearest measured neighbours (4-neighbour growth)."""
    a = a.copy()
    valid = np.isfinite(a)
    for _ in range(passes):
        if valid.all():
            break
        acc = np.zeros_like(a); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(valid, (dy, dx), (0, 1)); si = np.roll(np.where(valid, a, 0), (dy, dx), (0, 1))
            acc += si * sv; cnt += sv
        grow = (~valid) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow]
        valid |= grow
    return np.where(valid, a, np.nanmean(a) if valid.any() else 0.0)


def blur(a, radius):
    """Box blur of a float map (edge-clamped), applied twice for a soft kernel."""
    out = a.astype(np.float32)
    for _ in range(2):
        for axis in (0, 1):
            pad = [(0, 0), (0, 0)]
            pad[axis] = (radius, radius)
            p = np.pad(out, pad, mode='edge')
            c = np.cumsum(p, axis=axis, dtype=np.float64)
            c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
            n = out.shape[axis]
            hi = np.take(c, np.arange(2 * radius + 1, 2 * radius + 1 + n), axis=axis)
            lo = np.take(c, np.arange(0, n), axis=axis)
            out = ((hi - lo) / (2 * radius + 1)).astype(np.float32)
    return out


def main():
    D = depth_map()
    rgb = photo()
    H, Wd = D.shape
    rows = SRC_TOP - (np.arange(H) + 0.5) / SRC_PPM          # v of each row
    cols = (np.arange(Wd) + 0.5) / SRC_PPM                   # u of each column
    Dm = median(D, 9, *RANGE)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cool = (b - r) / (r + g + b + 1e-6)
    glass = np.zeros(D.shape, bool)
    relief = {}
    glass_depth = {}
    for oid, kind, centre, width, sill, head in OPENINGS:
        half = width / 2
        c0, c1 = int((centre - half) * SRC_PPM), int(np.ceil((centre + half) * SRC_PPM))
        c0, c1 = max(c0, 0), min(c1, Wd)
        U = cols[c0:c1][None, :]
        V = rows[:, None]
        inside = (V >= sill) & (V <= top_at(kind, centre, width, head, U))
        region = (slice(None), slice(c0, c1))
        d = Dm[region]
        deepest = np.nanpercentile(np.where(inside, d, np.nan), 3)
        front = np.nanpercentile(np.where(inside, d, np.nan), 60)
        separated = front - deepest > 0.12
        cut = (front + deepest) / 2
        colour_glass = cool[region] > -0.05
        g_mask = inside & colour_glass & ((d < cut) if separated else True)
        # Clean: drop specks (curtain folds in shadow), close the glazing bars,
        # then keep one run per row — the glazing between the curtains — with
        # its edges smoothed up the window.
        g_mask = morph(morph(g_mask, 'shrink', 5), 'grow', 5)
        g_mask = morph(morph(g_mask, 'grow', 7), 'shrink', 7) & inside
        sash = 0.55 if kind == 'arched-window' else half - 0.1
        bounds = ((centre - sash) * SRC_PPM - c0, (centre + sash) * SRC_PPM - c0)
        g_mask = row_intervals(g_mask, bounds) & inside
        glass[region] |= g_mask
        glass_depth[oid] = float(np.median(d[g_mask])) if separated else None
        print(oid, 'front', round(float(front), 3), 'deepest', round(float(deepest), 3), 'separated', bool(separated), 'glass px', int(g_mask.sum()))
        relief[oid] = (kind, centre, width, sill, head, region, inside, g_mask)
    np.save('proj/window-glass.npy', glass)
    layered = np.full(D.shape, np.nan, np.float32)
    for oid, (kind, centre, width, sill, head, region, inside, g_mask) in relief.items():
        # Two layers, as the scan has them: the curtains (and columns, and
        # blind plaster) on their own smoothed depths, the glazing flat at
        # its measured depth behind them, eased into each other over a few
        # centimetres along the glass mask's clean edge.
        d = Dm[region]
        front_layer = fill_from(np.where(inside & ~g_mask, d, np.nan))
        front_layer = blur(median(front_layer, 9, *RANGE), 6)
        twin = TWIN.get(oid)
        glass_at = glass_depth[oid] if glass_depth.get(oid) is not None else glass_depth.get(twin) if twin is not None else None
        if glass_at is None:
            glass_at = float(np.nanpercentile(np.where(inside, d, np.nan), 3))
        soft = blur(g_mask.astype(np.float32), 5)
        d = front_layer * (1 - soft) + glass_at * soft
        d = np.minimum(d, -0.02)
        layered[region] = np.where(inside, d, layered[region])
    np.save('proj/window-layered.npy', layered)


if __name__ == '__main__':
    main()

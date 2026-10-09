"""Each wall's relief from the scan, cleaned for meshing.

The dollhouse mesh gives the depth in front of (+) or behind (-) the wall
plane at every orthophoto texel (the walls' position tiles). Before meshing:
  - each window takes its layered depth — curtains in front, glazing behind
    (window-relief.py);
  - the end door, open in the scan, takes the fireplace-end door's closed
    leaves (pack-atlas.py copies their photograph the same way);
  - the main door, open in the scan, becomes a plain recess for the modelled
    leaves;
  - movable equipment is patched out exactly as in the atlas.
Writes relief/<wall>.f32 at 100 px/m (rows from v = 7.0 down) and .json.
Usage (in the work directory): python3 $SURVEY/wall-depth.py window door end fire"""
import os
import json, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import load_views

L, W = 21.135, 10.59
XC, YC = 8.795, -4.963
PPM, TOP = 200.0, 7.0
PLANES = {
    'window': (1, YC - W / 2, 1.0), 'door': (1, YC + W / 2, -1.0),
    'end': (0, XC - L / 2, 1.0), 'fire': (0, XC + L / 2, -1.0),
}
LENGTH = {'window': L, 'door': L, 'end': W, 'fire': W}
door_u = lambda scan_x: L / 2 - XC + scan_x
DOOR_END, DOOR_MAIN, DOOR_FIRE = door_u(-0.025), door_u(8.79), door_u(17.665)
DOOR_HEAD = 2.35
# (wall, dst u0, u1, v0, v1, mode, arg) — as pack-atlas.py
PATCHES = [
    ('window', 0.0, 0.8, 0.0, 1.6, 'mirror', L / 2),
    ('door', 0.0, 0.75, 0.0, 1.54, 'shift', 2.72),
    ('door', DOOR_END - 0.54, DOOR_END + 0.54, 0.0, DOOR_HEAD, 'shift', DOOR_FIRE - DOOR_END),
    ('end', 10.12, 10.59, 0.3, 1.48, 'shift', -1.06),
    ('fire', 3.15, 3.58, 0.0, 1.48, 'mirror', 5.332),
    ('fire', 9.6, 10.59, 0.0, 1.72, 'shift', -3.18),
]


def depth_map(wall):
    """Depth from the walls' position tiles, with the corners' fins removed
    (fix-corners.py writes the corrected tiles)."""
    views = [v for v in load_views('views-walls.json') if v['wall'] == wall]
    axis, plane, sign = PLANES[wall]
    tiles = []
    for v in sorted(views, key=lambda v: v['tile']):
        w, h = v['pixels']
        fixed = f"out-walls/{v['name']}.fixed.f32"
        source = fixed if os.path.exists(fixed) else f"out-walls/{v['name']}.position.f32"
        P = np.fromfile(source, dtype=np.float32).reshape(h, w, 4)[::-1]
        tiles.append(np.where(P[..., 3] > 0.5, (P[..., axis] - plane) * sign, np.nan))
    return np.concatenate(tiles, 1)


def px(u, v):
    return int(round(u * PPM)), int(round((TOP - v) * PPM))


def patch(D, u0, u1, v0, v1, mode, arg):
    c0, r1 = px(u0, v0); c1, r0 = px(u1, v1)
    if mode == 'shift':
        s0 = int(round((u0 + arg) * PPM)); src = D[r0:r1, s0:s0 + (c1 - c0)].copy()
    else:
        m0 = int(round((2 * arg - u1) * PPM)); src = D[r0:r1, m0:m0 + (c1 - c0)][:, ::-1].copy()
    D[r0:r1, c0:c0 + src.shape[1]] = src


def fill(a, passes=60):
    a = a.copy(); valid = np.isfinite(a)
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
    return np.where(valid, a, 0.0)


def denoise(D, keep):
    """Median 5x5 (via 16-bit split), except where `keep` (already clean)."""
    lo, hi = -1.2, 1.2
    q = np.clip((D - lo) / (hi - lo) * 65535, 0, 65535)
    coarse = np.asarray(Image.fromarray((q / 256).astype(np.uint8)).filter(ImageFilter.MedianFilter(5)), np.float32)
    med = lo + (coarse * 256 + 128) / 65535 * (hi - lo)
    out = np.where(np.abs(D - med) < 0.012, D, med)
    return np.where(keep, D, out)


def main(wall):
    D = depth_map(wall)
    keep = np.zeros(D.shape, bool)
    if wall == 'window':
        layered = np.load('proj/window-layered.npy')
        inside = np.isfinite(layered)
        D = np.where(inside, layered, D)
        keep |= inside
    if wall == 'door':
        c0, r1 = px(DOOR_MAIN - 0.715, 0.0); c1, r0 = px(DOOR_MAIN + 0.715, DOOR_HEAD)
        D[r0:r1, c0:c1] = -0.3
        keep[r0:r1, c0:c1] = True
    for p in PATCHES:
        if p[0] == wall:
            patch(D, *p[1:])
    D = np.clip(fill(D), -1.0, 0.9)
    D = denoise(D, keep)
    # The floor and ceiling are edge-on to these views: hold the bottom and
    # top few centimetres to the skirting's and the bead's own depth, and
    # keep the adjacent wall (seen edge-on in the corners) out of the ends.
    r_floor = int(round((TOP - 0.04) * PPM)); D[r_floor:] = D[r_floor - 1]
    r_ceiling = int(round((TOP - 6.66) * PPM)); D[:r_ceiling] = D[r_ceiling]
    end = int(0.04 * PPM)
    width_px = int(round(LENGTH[wall] * PPM))
    D[:, :end] = np.clip(D[:, :end], -0.1, 0.12)
    D[:, width_px - end:width_px] = np.clip(D[:, width_px - end:width_px], -0.1, 0.12)
    h, w = D.shape
    width = int(round(LENGTH[wall] * PPM))
    D = D[:, :width]
    h2, w2 = h // 2, width // 2
    D2 = D[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).mean(axis=(1, 3)).astype(np.float32)
    D2.tofile(f'relief/{wall}.f32')
    json.dump({'width': int(w2), 'height': int(h2), 'ppm': PPM / 2, 'top': TOP, 'length': LENGTH[wall]}, open(f'relief/{wall}.json', 'w'))
    print(wall, D2.shape, 'range', round(float(D2.min()), 3), round(float(D2.max()), 3))


if __name__ == '__main__':
    for wall in sys.argv[1:]:
        main(wall)

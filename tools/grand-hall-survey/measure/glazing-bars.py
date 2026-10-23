"""Glazing of the Grand Hall's five windows, measured in the public panoramas.

Writes the figures behind HALL_GLAZING (packages/web/src/components/grand-hall/hall-spec.ts):

1. The glass plane: the window wall's relief (walls-relief.bin) rasterised at 2 cm over each window, its median
   depth where the wall atlas marks glass (alpha 128/255).
2. The bars: each window is rectified at 2 mm a pixel on that plane from four stations that see it (its own,
   scan_038-042, about 1.5 m in front of it, and three others at up to 31 degrees), with project.py's own camera
   model (world-aligned equirectangular images sampled by sample_pano, which already reads the stored mirror image
   the right way round; the manifest's exposure gain applied). A painted bar against the glass is a bright,
   unsaturated ridge: each station's column and row profiles (the median, over the visible glass, of luminance
   above its local 5 cm mean) are searched within 3 cm of the expected bars, and each bar's centroid is
   triangulated over the stations (its position and depth, by least squares on their rays). The window's bar plane
   is the median triangulated depth; each bar's position on it is the median of the stations' rays moved there.
3. The arched windows' heads: the own station's view on the relief's plane, sampled in polar coordinates about the
   centre light's middle on the transom: the transom (the side panes' strongest rows 3.6-3.95 m), radials (angular
   ridges over the lower and upper radius bands), the ring's rims (radial ridges over 60-120 degrees), the ring's
   piercings (angular minima at mid-ring) and the centre petal's head (the radial ridge over 86-94 degrees).
4. The paint: the median colour along the vertical bars' centrelines in each own station, and each bar's width at
   half its ridge's height.

Inputs are read-only: --data holds manifest.json and pano8k/scan_NNN_8192.webp (fetch_inputs.py; every panorama
used is checked against the manifest's SHA-256), --atlas the published walls-4096.webp and --relief
walls-relief.bin. The E57's own cube faces are not used: they are not public.

Usage: python3 glazing-bars.py --data DIR --atlas walls-4096.webp --relief walls-relief.bin --out DIR
Writes DIR/glazing-bars.json and DIR/<window>-<station>-rectified.png. About 2.5 minutes, 0.8 GB.
"""
import argparse
import hashlib
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import project  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
L, W = 21.135, 10.59
XC, YC, ZF = 8.795, -4.963, 0.045
ATLAS_SIZE = 4096
ATLAS_PPM = (ATLAS_SIZE / 2) / W
ATLAS_VMAX = 6.72
PPM = 500.0  # rectified pixels per metre (2 mm)
window_u = lambda scan_x: L / 2 + XC - scan_x
# id, kind, centre u, width, sill, head (hall-spec.ts HALL_OPENINGS), the stations that see it (own first)
OPENINGS = [
    ('arch-fireplace', 'arched-window', window_u(17.83), 2.7, 0.915, 3.76, ['scan_042', 'scan_033', 'scan_032', 'scan_034']),
    ('window-fireplace', 'window', window_u(13.71), 1.43, 0.935, 3.305, ['scan_041', 'scan_030', 'scan_031', 'scan_024']),
    ('arch-centre', 'arched-window', window_u(8.82), 2.67, 0.915, 3.76, ['scan_039', 'scan_013', 'scan_022', 'scan_043']),
    ('window-end', 'window', window_u(3.93), 1.43, 0.935, 3.305, ['scan_038', 'scan_005', 'scan_006', 'scan_012']),
    ('arch-end', 'arched-window', window_u(-0.19), 2.7, 0.915, 3.76, ['scan_040', 'scan_004', 'scan_037', 'scan_044']),
]
# Where to look for bars (u from the opening's centre, v above the floor): three panes of 0.37 m across, and
# the rows every 0.55-0.6 m that every window shows.
VERTICAL_GUESS = (-0.19, 0.18)
ROW_GUESS = {'arched-window': (0.95, 1.56, 2.17, 2.72, 3.29), 'window': (0.95, 1.54, 2.13, 2.64)}
SEARCH = 0.03


def to_e57(points):
    """Planner points (N,3) to the E57 frame."""
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    return np.stack([XC - x, z + YC, y + ZF], 1)


def wall_point(u, v, depth):
    """Window wall-local (u, v, depth into the room) to planner points."""
    u = np.asarray(u, float)
    v = np.asarray(v, float)
    return np.stack([-L / 2 + u, v, np.full_like(u, -W / 2) + depth], -1)


def read_window_relief(path):
    """The window wall's relief mesh: (positions (u, v, depth), triangles)."""
    buf = open(path, 'rb').read()
    assert buf[:4] == b'GHR1'
    count = struct.unpack_from('<I', buf, 4)[0]
    off = 8
    for _ in range(count):
        wid = buf[off:off + 12].rstrip(b'\0').decode()
        vc, tc, ib = struct.unpack_from('<III', buf, off + 12)
        rng = struct.unpack_from('<6f', buf, off + 24)
        off += 48
        q = np.frombuffer(buf, np.uint16, vc * 3, off).reshape(-1, 3).astype(np.float64)
        off = (off + vc * 6 + 3) & ~3
        idx = np.frombuffer(buf, np.uint16 if ib == 2 else np.uint32, tc * 3, off).reshape(-1, 3)
        off = (off + tc * 3 * ib + 3) & ~3
        if wid == 'window':
            p = np.empty_like(q)
            for a in range(3):
                p[:, a] = rng[2 * a] + q[:, a] / 65535 * (rng[2 * a + 1] - rng[2 * a])
            return p, idx
    raise SystemExit('no window wall in the relief')


def glass_alpha(atlas, u, v):
    """The atlas alpha (0-255) at window-wall (u, v), nearest texel."""
    px = np.clip((np.asarray(u) * ATLAS_PPM).astype(int), 0, ATLAS_SIZE - 1)
    py = np.clip(((ATLAS_VMAX - np.asarray(v)) * ATLAS_PPM).astype(int), 0, ATLAS_SIZE - 1)
    return atlas[py, px]


def relief_depth(positions, triangles, u0, u1, v0, v1, step=0.02):
    """The relief's nearest depth on a 2 cm grid over (u0..u1, v0..v1), NaN where it has none."""
    us = np.arange(u0, u1, step)
    vs = np.arange(v0, v1, step)
    depth = np.full((len(vs), len(us)), np.nan)
    tri = positions[triangles]
    keep = (tri[:, :, 0].max(1) >= u0) & (tri[:, :, 0].min(1) <= u1) & (tri[:, :, 1].max(1) >= v0) & (tri[:, :, 1].min(1) <= v1)
    for t in tri[keep]:
        i0 = max(0, int(np.floor((t[:, 0].min() - u0) / step)))
        i1 = min(len(us), int(np.ceil((t[:, 0].max() - u0) / step)) + 1)
        j0 = max(0, int(np.floor((t[:, 1].min() - v0) / step)))
        j1 = min(len(vs), int(np.ceil((t[:, 1].max() - v0) / step)) + 1)
        if i1 <= i0 or j1 <= j0:
            continue
        uu, vv = np.meshgrid(us[i0:i1], vs[j0:j1])
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = t
        det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(det) < 1e-12:
            continue
        l1 = ((y2 - y3) * (uu - x3) + (x3 - x2) * (vv - y3)) / det
        l2 = ((y3 - y1) * (uu - x3) + (x1 - x3) * (vv - y3)) / det
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        d = l1 * z1 + l2 * z2 + l3 * z3
        sub = depth[j0:j1, i0:i1]
        sub[inside] = np.fmin(sub[inside], d[inside])  # where triangles overlap, the deeper (the glass behind)
    return depth, us, vs


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def checked_panorama(data, manifest, sid, checked):
    path = os.path.join(data, 'pano8k', f'{sid}_8192.webp')
    if sid not in checked:
        expected = manifest.get('contentHashes', {}).get(f'tiles/{sid}/equirect_8192.webp')
        if expected is None or sha256(path) != expected:
            raise SystemExit(f'{sid}: the panorama is not the manifest\'s')
        checked.add(sid)
    return project.load_pano(sid)


def rectify(img, station, u0, u1, v0, v1, depth):
    """The plane at `depth` seen from `station`, rows from v1 down to v0, 2 mm a pixel (sRGB 0-255)."""
    us = u0 + (np.arange(int(round((u1 - u0) * PPM))) + 0.5) / PPM
    vs = v1 - (np.arange(int(round((v1 - v0) * PPM))) + 0.5) / PPM
    U, V = np.meshgrid(us, vs)
    P = to_e57(wall_point(U.ravel(), V.ravel(), depth))
    rgb = project.sample_pano(img, P - station['t'][None, :])
    return rgb.reshape(len(vs), len(us), 3).astype(np.float32), us, vs


def luminance(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def profiles(rgb, glass):
    """Column and row ridge profiles: luminance above its local 5 cm mean, median over the visible glass."""
    lum = luminance(rgb)
    sat = rgb.max(2) - rgb.min(2)
    ok = glass & (sat < 60)
    hx = lum - ndi.uniform_filter1d(lum, 25, axis=1)
    hy = lum - ndi.uniform_filter1d(lum, 25, axis=0)
    col = np.array([np.median(hx[ok[:, j], j]) if ok[:, j].sum() > 50 else 0.0 for j in range(lum.shape[1])])
    row = np.array([np.median(hy[i, ok[i]]) if ok[i].sum() > 50 else 0.0 for i in range(lum.shape[0])])
    return ndi.gaussian_filter1d(col, 1.5), ndi.gaussian_filter1d(row, 1.5)


def centroid(profile, axis, at):
    m = np.abs(axis - at) <= SEARCH
    w = np.clip(profile[m], 0, None)
    return (float((axis[m] * w).sum() / w.sum()), float(w.max())) if w.sum() > 0 else (None, 0.0)


def triangulate(observations):
    """(position, depth) from rays: each (s, S, app, d0) is a station at s along the axis and S in front of the
    wall's plane, seeing the bar at `app` on the plane at depth d0."""
    A = np.array([[S - d0, app - s] for s, S, app, d0 in observations])
    y = np.array([S * (app - s) + s * (S - d0) for s, S, app, d0 in observations])
    (b, d), *_ = np.linalg.lstsq(A, y, rcond=None)
    return float(b), float(d)


def peaks(profile, axis, low, high, threshold, gap):
    idx = [i for i in range(2, len(profile) - 2) if low <= axis[i] <= high and profile[i] > threshold
           and profile[i] >= profile[i - 1] and profile[i] >= profile[i + 1]]
    picked = []
    for i in sorted(idx, key=lambda i: -profile[i]):
        if all(abs(i - j) >= gap for j in picked):
            picked.append(i)
    return sorted(picked)


def head(img, station, centre, glass_depth, light_centre):
    """An arched window's head, in the own station's view on the relief's plane."""
    u0, v1 = centre - 0.7, 5.15
    rgb, us, vs = rectify(img, station, u0, centre + 0.7, 3.4, v1, glass_depth)
    lum = luminance(rgb)
    side = (np.abs(us - light_centre) > 0.25) & (np.abs(us - light_centre) < 0.5)
    hy = lum - ndi.uniform_filter1d(lum, 25, axis=0)
    rows = ndi.gaussian_filter1d(np.median(hy[:, side], axis=1), 1.5)
    found = sorted(peaks(rows, vs, 3.6, 3.95, 8, 10), key=lambda i: -rows[i])[:2]
    transom = float(np.mean([vs[i] for i in found]))
    smooth = ndi.gaussian_filter(lum, 1.0)
    rs = np.arange(0.12, 1.35, 0.002)

    def sample(u, v):
        return ndi.map_coordinates(smooth, [(v1 - v) * PPM - 0.5, (u - u0) * PPM - 0.5], order=1, mode='nearest')
    polar = np.array([sample(light_centre + rs * math.cos(math.radians(t)), transom + rs * math.sin(math.radians(t))) for t in range(181)])

    def angular(r0, r1):
        p = polar[:, (rs >= r0) & (rs <= r1)].mean(1)
        return p - ndi.uniform_filter1d(p, 9, mode='nearest')

    def radial(t0, t1):
        p = polar[t0:t1].mean(0)
        return p - ndi.uniform_filter1d(p, 31, mode='nearest')
    angles = np.arange(181.0)
    lower = angular(0.26, 0.5)
    upper = angular(0.85, 1.05)
    ring = radial(60, 121)
    ring_radii = [float(rs[i]) for i in peaks(ring, rs, 0.4, 0.85, 6, 5)]
    rims = [r for r in ring_radii if r > 0.4]
    inner = float(np.mean([r for r in rims if r < 0.6])) if any(r < 0.6 for r in rims) else None
    outer = float(np.mean([r for r in rims if r >= 0.68])) if any(r >= 0.68 for r in rims) else None
    middle = ((inner or 0.53) + (outer or 0.75)) / 2
    mid = polar[:, np.abs(rs - middle) < 0.012].mean(1)
    mid = mid - ndi.uniform_filter1d(mid, 15, mode='nearest')
    holes = [int(t) for t in range(30, 151) if mid[t] < -6 and mid[t] <= mid[t - 1] and mid[t] <= mid[t + 1]]
    petal = radial(86, 95)
    tops = [float(rs[i]) for i in peaks(petal, rs, 1.15, 1.3, 6, 5)]
    return dict(transom=round(transom, 4),
                lower_radials_deg=[int(angles[i]) for i in peaks(lower, angles, 20, 160, 4, 20)][:2],
                upper_radials_deg=[int(angles[i]) for i in peaks(upper, angles, 70, 110, 4, 8)][:2],
                ring_rims=[round(r, 3) for r in ring_radii], ring_inner=None if inner is None else round(inner, 3),
                ring_outer=None if outer is None else round(outer, 3), piercings_deg=holes,
                petal_top=round(float(np.mean(tops)), 3) if tops else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--atlas', required=True)
    ap.add_argument('--relief', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    project.DATA = args.data
    manifest = json.load(open(os.path.join(args.data, 'manifest.json')))
    stations = {s['id']: s for s in project.stations()}
    atlas = np.asarray(Image.open(args.atlas))[..., 3]
    relief, triangles = read_window_relief(args.relief)
    checked = set()
    result = {'method': __doc__.split('\n\n')[1].strip(), 'windows': {}}
    for wid, kind, centre, width, sill, top_guess, views in OPENINGS:
        crown = top_guess + (width / 2 if kind == 'arched-window' else 0)
        depth, dus, dvs = relief_depth(relief, triangles, centre - 0.7, centre + 0.7, sill, crown)
        DU, DV = np.meshgrid(dus, dvs)
        on_glass = (glass_alpha(atlas, DU, DV) < 160) & np.isfinite(depth)
        glass_depth = float(np.median(depth[on_glass]))
        u0, u1, v0, v1 = centre - 0.7, centre + 0.7, sill - 0.05, (4.2 if kind == 'arched-window' else 3.35)
        seen = {}
        own_rgb = None
        for sid in views:
            img = checked_panorama(args.data, manifest, sid, checked)
            rgb, us, vs = rectify(img, stations[sid], u0, u1, v0, v1, glass_depth)
            UU, VV = np.meshgrid(us, vs)
            glass = glass_alpha(atlas, UU, VV) < 192
            col, row = profiles(rgb, glass)
            X, Y, Z = stations[sid]['t']
            eye = (XC - X, Z - ZF, Y - YC)
            seen[sid] = dict(col=col, row=row, eye=eye)
            if sid == views[0]:
                own_rgb = rgb
                Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(os.path.join(args.out, f'{wid}-{sid}-rectified.png'))
        bars = []
        for axis_kind, guesses in (('vertical', [centre + g for g in VERTICAL_GUESS]), ('horizontal', ROW_GUESS[kind])):
            for guess in guesses:
                obs = []
                for sid, s in seen.items():
                    ex, ey, ez = s['eye']
                    S = ez + W / 2
                    if axis_kind == 'vertical':
                        at, strength = centroid(s['col'], us, guess)
                        origin = ex + L / 2
                    else:
                        at, strength = centroid(s['row'], vs, guess)
                        origin = ey
                    if at is not None and strength > 4:
                        obs.append((origin, S, at, glass_depth))
                if len(obs) < 2:
                    continue
                position, d = triangulate(obs)
                bars.append(dict(kind=axis_kind, guess=round(guess, 4), observations=obs, triangulated=(round(position, 4), round(d, 4))))
        plane = float(np.median([b['triangulated'][1] for b in bars]))
        for b in bars:
            moved = [s + (app - s) * (S - plane) / (S - d0) for s, S, app, d0 in b['observations']]
            b['at'] = round(float(np.median(moved)), 4)
            b['spread'] = round(float(np.ptp(moved)), 4)
            b['stations'] = len(moved)
            del b['observations']
        verticals = [b for b in bars if b['kind'] == 'vertical']
        light_centre = float(np.mean([b['at'] for b in verticals])) if verticals else centre
        own_head = None
        if kind == 'arched-window':
            own_head = head(checked_panorama(args.data, manifest, views[0], checked), stations[views[0]], centre, glass_depth, light_centre)
        # The paint along the vertical bars in the own station, and the bars' widths at half their ridges.
        lum = luminance(own_rgb)
        UU, VV = np.meshgrid(us, vs)
        glass = glass_alpha(atlas, UU, VV) < 192
        paint, widths = [], []
        for b in verticals:
            j = int(round((b['at'] - u0) * PPM))
            rows = glass[:, j]
            profile = np.median(lum[rows][:, j - 30:j + 31], axis=0)
            k = int(np.argmax(profile[20:41])) + 20
            base = np.percentile(profile, 20)
            half = base + (profile[k] - base) / 2
            lo, hi = k, k
            while lo > 0 and profile[lo] > half:
                lo -= 1
            while hi < len(profile) - 1 and profile[hi] > half:
                hi += 1
            widths.append((hi - lo) / PPM)
            paint.append(np.median(own_rgb[rows, j + k - 30], axis=0))
        glass_rows = np.where(glass[:, np.abs(us - light_centre) < 0.3].any(1))[0]
        result['windows'][wid] = dict(
            stations=views, glass_depth=round(glass_depth, 4), bar_plane=round(plane, 4),
            glass_bottom=round(float(vs[glass_rows.max()]), 4) if len(glass_rows) else None,
            light_centre_from_opening=round(light_centre - centre, 4),
            verticals_from_opening=[round(b['at'] - centre, 4) for b in verticals],
            rows=[b['at'] for b in bars if b['kind'] == 'horizontal'], bars=bars,
            vertical_widths=[round(w, 4) for w in widths],
            paint_srgb=[round(float(c)) for c in np.median(np.array(paint), axis=0)] if paint else None,
            head=own_head)
        print(wid, json.dumps({k: v for k, v in result['windows'][wid].items() if k != 'bars'}), flush=True)
    all_paint = [w['paint_srgb'] for w in result['windows'].values() if w['paint_srgb']]
    result['paint_srgb_median'] = [int(np.median([p[i] for p in all_paint])) for i in range(3)]
    json.dump(result, open(os.path.join(args.out, 'glazing-bars.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()

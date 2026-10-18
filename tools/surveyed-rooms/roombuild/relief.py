"""The walls' relief and the ceiling's: wall-depth.py driven by a room config, the GHR1 job files
for relief-mesh-room.mjs, and the ceiling relief (gate B16).

Walls (wall-depth.py): depth from the position tiles (corners fixed); then each glazed wall's
layered depth, the relief recesses, the relief patches; fill and clip to relief.depthRange; clear
the corner intrusions; denoise; hold the floor and ceiling rows and clamp the ends; 2 x 2 mean.
fill() and denoise() are wall-depth.py's own objects; px(), patch() and clear_corner_intrusions()
are its statements with the ppm and top passed in (theirs read the module globals PPM and TOP,
and TOP is the room's own). Gates the Grand Hall never opens: B8 (a wall too short for a clean
reference beyond its corner zone takes reference 0), B9 (no intrusion clearing at a reflex
corner), B20 (patches copied from another wall run after every wall's own edits).

Ceiling (B16): a height field from the view up at the ceiling, H = Z - floorZ, with the fittings'
footprints and anything outside ceilingRelief.heightRange removed, filled, clipped, denoised over
that range, set to the reference height outside the outline, and halved (2 x 2 mean). The fill
works on H - reference, so a texel beyond its reach takes the reference height rather than 0
(those inside the outline are counted and reported), and an odd width or height is padded by its
last column or row before halving. It is stored as depth = reference - H (positive towards the
room, like the walls' depth) with u = planner x and v = planner z, so relief-mesh-room.mjs meshes
it like a wall: triangles run counter-clockwise seen from below (x cross z = -y). Its .json gives
the halved texels' exact spacing per axis (ppmU, ppmV), which the mesher uses; ppm is nominal.
"""
import json
import os

import numpy as np
from PIL import Image, ImageFilter

from . import legacy, windows

CORNER_ZONE = 0.9   # metres from a corner where a neighbour's fittings can reach
INTRUSION = 0.8     # further proud than any fitting of the wall's own, short of the 0.9 m limit
END_BAND = 0.04     # metres at each end clamped to END_CLAMP (the adjacent wall seen edge-on)
END_CLAMP = (-0.1, 0.12)
SHORT_WALL = 2.0    # metres: shorter walls have no clean band beyond the corner zone (B8)
OCCLUDER_MARGIN = 0.02      # metres round a fitting's footprint that is not ceiling


def polygon_mask(vertices, X, Z):
    """Even-odd inside test of the outline (planner x, z) at every (X, Z)."""
    inside = np.zeros(np.broadcast(X, Z).shape, bool)
    n = len(vertices)
    for i in range(n):
        x0, z0 = vertices[i]
        x1, z1 = vertices[(i + 1) % n]
        if z0 == z1:
            continue
        crosses = (z0 > Z) != (z1 > Z)
        xc = x0 + (Z - z0) * (x1 - x0) / (z1 - z0)
        inside ^= crosses & (X < xc)
    return inside


def depth_map(room, wall):
    """Depth from the walls' position tiles, with the corners' fins removed (the corners step
    writes the corrected tiles)."""
    tiles = []
    for v in sorted(room.tiles(wall), key=lambda v: v['tile']):
        w, h = v['pixels']
        fixed = f"out-walls/{v['name']}.fixed.f32"
        source = fixed if os.path.exists(fixed) else f"out-walls/{v['name']}.position.f32"
        P = np.fromfile(source, dtype=np.float32).reshape(h, w, 4)[::-1]
        tiles.append(np.where(P[..., 3] > 0.5, room.depth(wall, P), np.nan))
    return np.concatenate(tiles, 1)


def px(u, v, ppm, top):
    return int(round(u * ppm)), int(round((top - v) * ppm))


def patch(D, u0, u1, v0, v1, mode, arg, ppm, top, source=None):
    c0, r1 = px(u0, v0, ppm, top); c1, r0 = px(u1, v1, ppm, top)
    if mode == 'shift':
        s0 = int(round((u0 + arg) * ppm)); src = D[r0:r1, s0:s0 + (c1 - c0)].copy()
    elif mode == 'mirror':
        m0 = int(round((2 * arg - u1) * ppm)); src = D[r0:r1, m0:m0 + (c1 - c0)][:, ::-1].copy()
    else:
        s0 = int(round(arg[1] * ppm)); src = source[r0:r1, s0:s0 + (c1 - c0)]
        src = (src[:, ::-1] if arg[2] else src).copy()
    D[r0:r1, c0:c0 + src.shape[1]] = src


def clear_corner_intrusions(D, length, ppm, skip=(False, False), short=False):
    """Gives each corner zone back its own face where a neighbouring wall's bench, seen end-on,
    stands out to the depth limit: those texels take their row's depth just beyond the zone, never
    behind the wall's plane. skip = (left, right) ends not cleared (B9); short: reference 0 (B8)."""
    u = (np.arange(D.shape[1]) + 0.5) / ppm
    for dist, skipped in zip((u, length - u), skip):
        if skipped:
            continue
        zone = (dist >= 0) & (dist < CORNER_ZONE)
        beyond = (dist >= CORNER_ZONE) & (dist < CORNER_ZONE + 0.1)
        if short:
            reference = np.zeros(D.shape[0], D.dtype)
        else:
            reference = np.maximum(np.median(D[:, beyond], axis=1), 0.0)
        rows, cols = np.nonzero(zone[None, :] & (D > INTRUSION))
        D[rows, cols] = reference[rows]
    return D


def denoise_range(D, keep, lo, hi):
    """wall-depth.py's denoise over [lo, hi] instead of its fixed +-1.2 m: median 5 x 5 via a
    16-bit split, except where `keep`."""
    q = np.clip((D - lo) / (hi - lo) * 65535, 0, 65535)
    coarse = np.asarray(Image.fromarray((q / 256).astype(np.uint8)).filter(ImageFilter.MedianFilter(5)), np.float32)
    med = lo + (coarse * 256 + 128) / 65535 * (hi - lo)
    out = np.where(np.abs(D - med) < 0.012, D, med)
    return np.where(keep, D, out)


def walls(room):
    """wall-depth.py for every wall in order: relief/<name>.f32 and .json."""
    wd = legacy.wall_depth()
    fill, denoise = wd.fill, wd.denoise
    rel = room.survey['relief']
    PPM = float(room.survey['wallViews']['ppm'])
    TOP = room.survey['wallViews']['heightRange'][1]
    patches = room.patches('relief')
    recesses = room.recesses('relief')
    glazed = windows.glass_walls(room)
    staged = {}
    for wall in room.order:
        D = depth_map(room, wall)
        keep = np.zeros(D.shape, bool)
        if wall['name'] in glazed:
            layered = np.load(f"proj/{wall['name']}-layered.npy")
            inside = np.isfinite(layered)
            D = np.where(inside, layered, D)
            keep |= inside
        for w, u0, u1, v0, v1, depth in recesses:
            if w is wall:
                c0, r1 = px(u0, v0, PPM, TOP); c1, r0 = px(u1, v1, PPM, TOP)
                D[r0:r1, c0:c1] = -depth
                keep[r0:r1, c0:c1] = True
        for p in patches:
            if p[0] is wall and p[5] != 'copy':
                patch(D, *p[1:], PPM, TOP)
        staged[wall['id']] = (D, keep)
    for p in patches:                                                         # B20
        if p[5] == 'copy':
            patch(staged[p[0]['id']][0], *p[1:], PPM, TOP, source=staged[p[6][0]['id']][0])
    os.makedirs('relief', exist_ok=True)
    for wall in room.order:
        D, keep = staged.pop(wall['id'])
        length = wall['length']
        D = np.clip(fill(D), *rel['depthRange'])
        D = clear_corner_intrusions(D, length, PPM, room.ends_reflex(wall), length < SHORT_WALL)
        D = denoise(D, keep)
        # The floor and ceiling are edge-on to these views: hold the bottom and
        # top few centimetres to the skirting's and the bead's own depth, and
        # keep the adjacent wall (seen edge-on in the corners) out of the ends.
        r_floor = int(round((TOP - rel['holdFloor']) * PPM)); D[r_floor:] = D[r_floor - 1]
        r_ceiling = int(round((TOP - rel['holdCeiling']) * PPM)); D[:r_ceiling] = D[r_ceiling]
        end = int(END_BAND * PPM)
        width_px = int(round(length * PPM))
        D[:, :end] = np.clip(D[:, :end], *END_CLAMP)
        D[:, width_px - end:width_px] = np.clip(D[:, width_px - end:width_px], *END_CLAMP)
        h, w = D.shape
        width = int(round(length * PPM))
        D = D[:, :width]
        h2, w2 = h // 2, width // 2
        D2 = D[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).mean(axis=(1, 3)).astype(np.float32)
        D2.tofile(f"relief/{wall['name']}.f32")
        json.dump({'width': int(w2), 'height': int(h2), 'ppm': PPM / 2, 'top': TOP, 'length': length}, open(f"relief/{wall['name']}.json", 'w'))
        print(wall['name'], D2.shape, 'range', round(float(D2.min()), 3), round(float(D2.max()), 3))


def walls_job(room):
    """The job relief-mesh-room.mjs meshes the walls from (relief.order, GHR1 ids)."""
    rel = room.survey['relief']
    return dict(out='proj/' + room.survey['outputs']['relief'], error=rel['simplifyError'],
                entries=[dict(id=room.relief_id(w), file=f"relief/{w['name']}", u0=0, vRange=list(rel['vRange']),
                              dRange=list(rel['depthRange'])) for w in room.relief_order()])


def ceiling(room):
    """The ceiling relief (B16): relief/ceiling.f32 and .json."""
    wd = legacy.wall_depth()
    cr = room.survey['ceilingRelief']
    lo, hi = cr['heightRange']
    reference = room.cfg['ceiling']['height']
    floorZ = room.cfg['transform']['floorZ']
    v = room.ceiling_view()
    w, h = v['pixels']
    P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1].astype(np.float64)
    valid = P[..., 3] > 0.5
    H = np.where(valid, P[..., 2] - floorZ, np.nan)
    excluded = np.zeros(H.shape, bool)
    for (cx, cy), r, (z0, z1) in room.occluder_tuples():
        # The fitting, wherever it could be: inside its footprint, at or below its top.
        foot = (P[..., 0] - cx) ** 2 + (P[..., 1] - cy) ** 2 < (r + OCCLUDER_MARGIN) ** 2
        excluded |= valid & foot & (H <= z1 - floorZ + OCCLUDER_MARGIN)
    H[excluded] = np.nan
    outside_range = valid & ((H < lo) | (H > hi))
    H[outside_range] = np.nan
    x0, x1, z0, z1 = room.bbox()
    xs = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    zs = z1 - (np.arange(h) + 0.5) * (z1 - z0) / h
    inside = polygon_mask(room.cfg['walls']['vertices'], xs[None, :], zs[:, None])
    # wall-depth's fill leaves texels beyond its reach at 0: fill H - reference, so they take the
    # reference height (a flat ceiling), and count those inside the outline.
    reached = wd.fill(np.where(np.isfinite(H), 1.0, np.nan)) > 0.5
    unfilled = int((inside & ~reached).sum())
    if unfilled:
        print(f"WARNING ceiling relief: {unfilled} texels inside the outline are beyond the fill's reach of any "
              f"measured one; they take the reference height {reference}")
    H = np.clip(reference + wd.fill(H - reference), lo, hi)
    H = denoise_range(H, np.zeros(H.shape, bool), lo, hi)
    H[~inside] = reference
    if h % 2 or w % 2:                       # pad an odd size with its last column or row: none dropped
        H = np.pad(H, ((0, h % 2), (0, w % 2)), mode='edge')
    h2, w2 = H.shape[0] // 2, H.shape[1] // 2
    H2 = H.reshape(h2, 2, w2, 2).mean(axis=(1, 3))
    depth = (reference - H2).astype(np.float32)
    os.makedirs('relief', exist_ok=True)
    depth.tofile('relief/ceiling.f32')
    # ppm is the nominal scale; ppmU and ppmV the halved texels' exact spacing (2 x span / texels),
    # which relief-mesh-room.mjs places the vertices by.
    meta = {'width': int(w2), 'height': int(h2), 'ppm': cr['ppm'], 'ppmU': w / (2 * (x1 - x0)), 'ppmV': h / (2 * (z1 - z0)),
            'top': z1, 'length': x1 - x0, 'u0': x0, 'reference': reference, 'heightRange': [lo, hi],
            'unfilledInside': unfilled}
    with open('relief/ceiling.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f)
    print('ceiling relief', depth.shape, 'excluded', int(excluded.sum()), 'out of range', int(outside_range.sum()),
          'height', round(float(reference - depth.max()), 3), '..', round(float(reference - depth.min()), 3))


def ceiling_job(room):
    cr = room.survey['ceilingRelief']
    lo, hi = cr['heightRange']
    reference = room.cfg['ceiling']['height']
    x0, x1, z0, z1 = room.bbox()
    error = cr.get('simplifyError', room.survey['relief']['simplifyError'])
    return dict(out='proj/' + room.survey['outputs']['ceilingRelief'], error=error,
                entries=[dict(id=cr['id'], file='relief/ceiling', u0=x0, vRange=[z0, z1], dRange=[reference - hi, reference - lo])])

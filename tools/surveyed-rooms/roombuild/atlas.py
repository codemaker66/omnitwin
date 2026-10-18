"""Packs the walls' orthophotos into the wall atlas: pack-atlas.py driven by a room config.

Fills the texels no panorama saw, applies the photo patches (movable equipment, open leaves) and
resamples every wall to the atlas scale. A wall's glass mask (proj/<wall>-glass.npy, from the
windows step, for the walls build/glass.json lists against this config) goes into the alpha
channel: 255 - 127 * glass. fill() and patch() are
pack-atlas.py's own statements (fill verbatim; patch with the source ppm, top and feather passed
in rather than read from module globals).

With survey.atlas.placement the strips go where it says, written in its order (the Grand Hall's
end and fireplace strips meet at column 2048, so the order is kept). Without it (gate B14) the
strips are packed on shelves in wall order, next-fit with a GUTTER between strips filled by
repeating their edges, first-fit decreasing if next-fit does not fit. Patches copied from another
wall (B20) run after every wall has been filled and patched on its own, in config order.
"""
import json
import os

import numpy as np
from PIL import Image

from . import legacy, windows

FILL_PASSES = 40
GUTTER = 8                    # texels between packed strips
HEIGHT_STEP = 256             # a packed atlas's height is rounded up to this


def fill(img, valid, passes=FILL_PASSES):
    """Grow valid colour into invalid texels (simple 4-neighbour dilation)."""
    img = img.copy(); valid = valid.copy()
    for _ in range(passes):
        if valid.all(): break
        acc = np.zeros_like(img); cnt = np.zeros(valid.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(valid, (dy, dx), (0, 1)); si = np.roll(img, (dy, dx), (0, 1))
            acc += si * sv[..., None]; cnt += sv
        grow = (~valid) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    if not valid.all():
        img[~valid] = img[valid].mean(axis=0)
    return img


def patch(img, u0, u1, v0, v1, mode, arg, length, feather, src_ppm, src_top, source=None):
    """pack-atlas.py's patch. mode 'shift' copies from u + arg, 'mirror' reflects about u = arg,
    'copy' takes `source` (another wall's image) from u = arg[1], mirrored if arg[2]."""
    def px(u, v):
        return int(round(u * src_ppm)), int(round((src_top - v) * src_ppm))
    c0, r1 = px(u0, v0); c1, r0 = px(u1, v1)
    if mode == 'shift':
        s0 = int(round((u0 + arg) * src_ppm)); src = img[r0:r1, s0:s0 + (c1 - c0)].copy()
    elif mode == 'mirror':
        m0 = int(round((2 * arg - u1) * src_ppm)); src = img[r0:r1, m0:m0 + (c1 - c0)][:, ::-1].copy()
    else:
        s0 = int(round(arg[1] * src_ppm)); src = source[r0:r1, s0:s0 + (c1 - c0)]
        src = (src[:, ::-1] if arg[2] else src).copy()
    h, w = src.shape[:2]
    # Feather the seams, except along the wall's own ends and the floor. (featherTexels 0, which
    # pack-atlas.py never used, means hard seams rather than a division by zero.)
    ramp = (lambda n: np.clip(np.arange(n) / feather, 0, 1)) if feather > 0 else (lambda n: np.ones(n))  # noqa: E731
    wx = np.ones(w); wy = np.ones(h)
    if u0 > 0.01: wx = np.minimum(wx, ramp(w))
    if u1 < length - 0.01: wx = np.minimum(wx, ramp(w)[::-1])
    wy = np.minimum(wy, ramp(h))
    if v0 > 0.01: wy = np.minimum(wy, ramp(h)[::-1])
    alpha = np.minimum.outer(wy, wx)[..., None]
    img[r0:r1, c0:c1] = img[r0:r1, c0:c1] * (1 - alpha) + src * alpha
    return img


def _shelves(widths, size, gutter, order):
    """Next-fit shelves over `order`; returns [(index, x, shelf)]."""
    out, x, shelf = [], 0, 0
    for i in order:
        if x > 0 and x + widths[i] > size:
            shelf, x = shelf + 1, 0
        out.append((i, x, shelf))
        x += widths[i] + gutter
    return out


def _first_fit_decreasing(widths, size, gutter):
    free = []                                    # next free x per shelf
    out = []
    for i in sorted(range(len(widths)), key=lambda i: -widths[i]):
        for s, x in enumerate(free):
            if x + widths[i] <= size:
                out.append((i, x, s)); free[s] = x + widths[i] + gutter
                break
        else:
            out.append((i, 0, len(free))); free.append(widths[i] + gutter)
    return out


def layout(room):
    """The atlas: width, height, strip height ROW, scale, and each wall's strip (wall, x, y, w)
    in write order."""
    atlas = room.survey['atlas']
    SIZE = atlas['size']
    PPM = atlas['ppm']['pixels'] / atlas['ppm']['span']
    V_MIN, V_MAX = atlas['vRange']
    ROW = int(np.ceil((V_MAX - V_MIN) * PPM))
    if 'placement' in atlas:
        strips = [(room.wmap[p['wall']], p['column'], p['row'] * ROW) for p in atlas['placement']]
        height, gutter, packing = atlas.get('height', SIZE), 0, 'placement'
    else:
        gutter = atlas.get('gutter', GUTTER)
        walls = room.order
        widths = [int(np.ceil(w['length'] * PPM)) for w in walls]
        if max(widths) > SIZE:
            raise ValueError(f"a wall strip is {max(widths)} texels, wider than the atlas ({SIZE})")
        placed, packing = _shelves(widths, SIZE, gutter, range(len(walls))), 'next-fit'
        shelves = max(s for _, _, s in placed) + 1
        needed = shelves * ROW + (shelves - 1) * gutter
        if 'height' in atlas and needed > atlas['height']:
            placed, packing = _first_fit_decreasing(widths, SIZE, gutter), 'first-fit-decreasing'
            shelves = max(s for _, _, s in placed) + 1
            needed = shelves * ROW + (shelves - 1) * gutter
        height = atlas.get('height') or -(-needed // HEIGHT_STEP) * HEIGHT_STEP
        if needed > height:
            raise ValueError(f"the walls need {needed} texels of atlas height; survey.atlas.height is {height}")
        strips = [(walls[i], x, s * (ROW + gutter)) for i, x, s in sorted(placed, key=lambda p: (p[2], p[1]))]
    return dict(width=SIZE, height=height, row=ROW, ppm=PPM, vRange=[V_MIN, V_MAX], gutter=gutter, packing=packing,
                strips=[dict(wall=w, x=x, y=y, w=int(np.ceil(w['length'] * PPM))) for w, x, y in strips])


def _load(room, wall, linear_to_srgb):
    d = [np.load(f"proj/{v['name']}.npz") for v in sorted(room.tiles(wall), key=lambda v: v['tile'])]
    rgb = np.concatenate([x['rgb'] for x in d], axis=1)
    weight = np.concatenate([x['weight'] for x in d], axis=1)
    valid = np.concatenate([x['valid'] for x in d], axis=1) & (weight > 0)
    img = linear_to_srgb(rgb).astype(np.float32)
    return img, valid


def _fill_gutters(atlas, alpha, lay):
    """Packed atlases: repeat each strip's edges into the gutters and the unused areas."""
    ROW = lay['row']
    shelves = sorted({s['y'] for s in lay['strips']})
    for y in shelves:
        row = sorted((s for s in lay['strips'] if s['y'] == y), key=lambda s: s['x'])
        band = slice(y, y + ROW)
        for a, b in zip(row, row[1:]):
            gap0, gap1 = a['x'] + a['w'], b['x']
            mid = (gap0 + gap1) // 2
            for arr in (atlas, alpha):
                arr[band, gap0:mid] = arr[band, gap0 - 1:gap0]
                arr[band, mid:gap1] = arr[band, gap1:gap1 + 1]
        last = row[-1]['x'] + row[-1]['w']
        for arr in (atlas, alpha):
            arr[band, last:] = arr[band, last - 1:last]
    for y, nxt in zip(shelves, shelves[1:]):
        gap0, gap1 = y + ROW, nxt
        mid = (gap0 + gap1) // 2
        for arr in (atlas, alpha):
            arr[gap0:mid] = arr[gap0 - 1]
            arr[mid:gap1] = arr[gap1]


def run(room):
    linear_to_srgb = legacy.project().linear_to_srgb
    wv = room.survey['wallViews']
    SRC_PPM = float(wv['ppm'])
    SRC_TOP = wv['heightRange'][1]          # v at the top edge of the orthophotos
    feather = room.survey['atlas'].get('featherTexels', 10)
    lay = layout(room)
    SIZE_W, SIZE_H, ROW, PPM = lay['width'], lay['height'], lay['row'], lay['ppm']
    V_MIN, V_MAX = lay['vRange']
    patches = room.patches('photo')
    glazed = windows.glass_walls(room)
    images = {}
    for s in lay['strips']:
        wall = s['wall']
        img, valid = _load(room, wall, linear_to_srgb)
        img = fill(img, valid)
        for p in patches:
            if p[0] is wall and p[5] != 'copy':
                img = patch(img, *p[1:], wall['length'], feather, SRC_PPM, SRC_TOP)
        images[wall['id']] = img
    for p in patches:                                                       # B20
        if p[5] == 'copy':
            target, src = p[0], p[6][0]
            images[target['id']] = patch(images[target['id']], *p[1:], target['length'], feather, SRC_PPM, SRC_TOP,
                                         source=images[src['id']])
    atlas = np.zeros((SIZE_H, SIZE_W, 3), np.float32)
    # Alpha carries the glass mask (glazing seen between the curtains): opaque
    # everywhere else, half where the photograph shows the view out.
    alpha = np.full((SIZE_H, SIZE_W), 255.0, np.float32)
    for s in lay['strips']:
        wall = s['wall']
        img = images[wall['id']]
        width_src = int(round(wall['length'] * SRC_PPM))
        r_top = int(round((SRC_TOP - V_MAX) * SRC_PPM)); r_bot = int(round((SRC_TOP - V_MIN) * SRC_PPM))
        crop = img[r_top:r_bot, :width_src]
        w_dst = int(np.ceil(wall['length'] * PPM))
        im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).resize((w_dst, ROW), Image.LANCZOS)
        x0, y0 = s['x'], s['y']
        atlas[y0:y0 + ROW, x0:x0 + w_dst] = np.asarray(im, np.float32)
        if wall['name'] in glazed:
            glass = np.load(f"proj/{wall['name']}-glass.npy").astype(np.float32)
            g = Image.fromarray((glass[r_top:r_bot, :width_src] * 255).astype(np.uint8)).resize((w_dst, ROW), Image.BILINEAR)
            alpha[y0:y0 + ROW, x0:x0 + w_dst] = 255 - np.asarray(g, np.float32) / 255 * 127
        print(wall['name'], crop.shape, '->', (ROW, w_dst), 'at', (x0, y0))
    if lay['packing'] != 'placement':
        _fill_gutters(atlas, alpha, lay)
    # the unused bottom strip repeats the last rows (keeps mipmaps clean)
    bottom = max(s['y'] for s in lay['strips']) + ROW
    atlas[bottom:] = atlas[bottom - 1]
    if lay['packing'] != 'placement':
        alpha[bottom:] = alpha[bottom - 1]
    rgba = np.dstack([atlas, alpha]).astype(np.uint8)
    out = Image.fromarray(rgba, 'RGBA')
    files = room.survey['outputs']['walls']
    out.save('proj/' + os.path.splitext(files[0]['file'])[0] + '.png')
    for f in files:
        if tuple(f['size']) == (SIZE_W, SIZE_H):
            out.save(f"proj/{f['file']}", quality=86, alpha_quality=90, method=6)
        else:
            out.resize(tuple(f['size']), Image.LANCZOS).save(f"proj/{f['file']}", quality=86, alpha_quality=90, method=6)
    print({f['file']: round(os.path.getsize(f"proj/{f['file']}") / 1e6, 2) for f in files})
    os.makedirs('build', exist_ok=True)
    with open('build/atlas.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(describe(room, lay), f, indent=1)


def describe(room, lay):
    return dict(width=lay['width'], height=lay['height'], row=lay['row'], ppm=lay['ppm'], vRange=lay['vRange'],
                gutter=lay['gutter'], packing=lay['packing'],
                strips=[dict(wall=s['wall']['id'], reliefId=room.relief_id(s['wall']), length=s['wall']['length'],
                             x=s['x'], y=s['y'], w=s['w'], h=lay['row']) for s in lay['strips']])

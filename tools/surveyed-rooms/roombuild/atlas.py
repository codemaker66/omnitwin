"""Packs the walls' orthophotos into the wall atlas: pack-atlas.py driven by a room config.

Where the photographs step wrote a wall's 2.5 mm orthophoto (proj/<view>.fine.npz), its colour comes
from that, so it reaches the atlas's scale through one Lanczos reduction; the patches are the same
in metres and the glass mask is the elevation's own. Fills the texels no panorama saw, takes the
varnish veil off the wall's canvases (proj/canvas-<wall>.npz, after the fill), applies the photo
patches (movable equipment, open leaves) and resamples every wall to the atlas scale, one wall at
a time. A wall's glass mask (proj/<wall>-glass.npy, from the windows step, for the walls
build/glass.json lists against this config) goes into the alpha channel: 255 - 127 * glass.

This is a port of pack-atlas.py's body, which is one flat script around the Grand Hall's four
strips: the layout, the per-wall glass and the copied patches differ here. fill() and
fill_sparse() are pack-atlas.py's own functions, taken from its source (legacy.pack_atlas_functions);
canvasveil.py is imported; patch() is pack-atlas.py's statements with the source scale, top and
feather passed in, and a third mode.

With survey.atlas.placement the strips go where it says, written in its order (the Grand Hall's
end and fireplace strips meet at column 2048, so the order is kept). Without it (gate B14) the
strips are packed on shelves in wall order, next-fit with a GUTTER between strips filled by
repeating their edges, first-fit decreasing if next-fit does not fit. Patches copied from another
wall (B20) run after every wall has been filled and patched on its own, in config order; every
wall's orthophoto is then held in memory at once (about 140 MB a 10 m wall at 2.5 mm).
"""
import json
import os

import numpy as np
from PIL import Image

from . import legacy, windows

FILL_PASSES = 40
GUTTER = 8                    # texels between packed strips
HEIGHT_STEP = 256             # a packed atlas's height is rounded up to this


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


def _load(room, wall, linear_to_srgb):
    """pack-atlas.py's load(): the wall's orthophoto (sRGB floats), the texels that carry colour,
    and texels per elevation texel: 2 for the photographs' 2.5 mm orthophoto (proj/<view>.fine.npz,
    when every tile has one), else 1 for the 5 mm one."""
    tiles = sorted(room.tiles(wall), key=lambda v: v['tile'])
    if all(os.path.exists(f"proj/{v['name']}.fine.npz") for v in tiles):
        d = [np.load(f"proj/{v['name']}.fine.npz") for v in tiles]
        img = np.concatenate([x['rgb8'] for x in d], axis=1).astype(np.float32)
        valid = np.concatenate([x['valid'] for x in d], axis=1)
        return img, valid, 2
    d = [np.load(f"proj/{v['name']}.npz") for v in tiles]
    rgb = np.concatenate([x['rgb'] for x in d], axis=1)
    weight = np.concatenate([x['weight'] for x in d], axis=1)
    valid = np.concatenate([x['valid'] for x in d], axis=1) & (weight > 0)
    img = linear_to_srgb(rgb).astype(np.float32)
    return img, valid, 1


def _prepare(room, wall, patches, feather, SRC_PPM, SRC_TOP, pa, linear_to_srgb):
    """One wall's orthophoto, filled, its canvases without their veil, its own patches applied
    (pack-atlas.py's loop body up to the crop). Returns the image and its scale."""
    img, valid, scale = _load(room, wall, linear_to_srgb)
    img = pa['fill'](img, valid, FILL_PASSES) if scale == 1 else pa['fill_sparse'](img, valid, FILL_PASSES * scale)
    if scale == 2:
        # the portraits' canvases lose their varnish veil, after the fill (whose last resort, the wall's mean colour,
        # they would otherwise move); the fine texel (2r + i, 2c + j) lies a quarter of a 5 mm texel either side of the
        # texel's centre
        canvasveil = legacy.canvasveil(room)
        for f in canvasveil.load('proj', wall['name']):
            r0, r1, c0, c1 = f['box']
            # one 5 mm texel round the field's own: its extent reaches past their centres
            y0, y1, x0, x1 = 2 * max(r0 - 1, 0), 2 * (r1 + 1), 2 * max(c0 - 1, 0), 2 * (c1 + 1)
            rr, cc = np.meshgrid(np.arange(y0, y1), np.arange(x0, x1), indexing='ij')
            block = img[y0:y1, x0:x1]
            new = canvasveil.apply([f], (rr / 2.0 - 0.25).ravel(), (cc / 2.0 - 0.25).ravel(), block.reshape(-1, 3)).reshape(block.shape)
            img[y0:y1, x0:x1] = new
            print(wall['name'], 'canvas', f['name'], 'veil taken off', flush=True)
    for p in patches:
        if p[0] is wall and p[5] != 'copy':
            img = patch(img, *p[1:], wall['length'], feather * scale, SRC_PPM * scale, SRC_TOP)
    return img, scale


def run(room, *args):
    """step.py atlas [--alpha-from <dir>]. With --alpha-from, the alpha channel is the one of that
    folder's first walls file (pack-atlas.py --alpha-from: a rebuild of the walls' colour keeps the
    glass that was published)."""
    alpha_from = args[args.index('--alpha-from') + 1] if '--alpha-from' in args else None
    linear_to_srgb = legacy.project().linear_to_srgb
    pa = legacy.pack_atlas_functions()
    wv = room.survey['wallViews']
    SRC_PPM = float(wv['ppm'])
    SRC_TOP = wv['heightRange'][1]          # v at the top edge of the orthophotos
    feather = room.survey['atlas'].get('featherTexels', 10)
    lay = layout(room)
    SIZE_W, SIZE_H, ROW, PPM = lay['width'], lay['height'], lay['row'], lay['ppm']
    V_MIN, V_MAX = lay['vRange']
    patches = room.patches('photo')
    glazed = windows.glass_walls(room)
    copies = [p for p in patches if p[5] == 'copy']
    held = {}
    if copies:                                                              # B20
        # every wall is filled and patched on its own before any copy, so all are held at once
        for s in lay['strips']:
            held[s['wall']['id']] = _prepare(room, s['wall'], patches, feather, SRC_PPM, SRC_TOP, pa, linear_to_srgb)
        for p in copies:
            target, src = p[0], p[6][0]
            (img, scale), (source, source_scale) = held[target['id']], held[src['id']]
            if scale != source_scale:
                raise SystemExit(f"patch copied from {src['id']} to {target['id']}: one has a 2.5 mm orthophoto and the other has not")
            held[target['id']] = (patch(img, *p[1:], target['length'], feather * scale, SRC_PPM * scale, SRC_TOP, source=source), scale)
    atlas = np.zeros((SIZE_H, SIZE_W, 3), np.float32)
    # Alpha carries the glass mask (glazing seen between the curtains): opaque
    # everywhere else, half where the photograph shows the view out.
    alpha = np.full((SIZE_H, SIZE_W), 255.0, np.float32)
    for s in lay['strips']:
        wall = s['wall']
        img, scale = held.pop(wall['id']) if copies else _prepare(room, wall, patches, feather, SRC_PPM, SRC_TOP, pa, linear_to_srgb)
        width_src = int(round(wall['length'] * SRC_PPM))
        r_top = int(round((SRC_TOP - V_MAX) * SRC_PPM)); r_bot = int(round((SRC_TOP - V_MIN) * SRC_PPM))
        crop = img[r_top * scale:r_bot * scale, :width_src * scale]
        shape = crop.shape
        w_dst = int(np.ceil(wall['length'] * PPM))
        im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).resize((w_dst, ROW), Image.LANCZOS)
        del img, crop
        x0, y0 = s['x'], s['y']
        atlas[y0:y0 + ROW, x0:x0 + w_dst] = np.asarray(im, np.float32)
        if wall['name'] in glazed:
            glass = np.load(f"proj/{wall['name']}-glass.npy").astype(np.float32)
            g = Image.fromarray((glass[r_top:r_bot, :width_src] * 255).astype(np.uint8)).resize((w_dst, ROW), Image.BILINEAR)
            alpha[y0:y0 + ROW, x0:x0 + w_dst] = 255 - np.asarray(g, np.float32) / 255 * 127
        print(wall['name'], shape, '->', (ROW, w_dst), 'at', (x0, y0), flush=True)
    if lay['packing'] != 'placement':
        _fill_gutters(atlas, alpha, lay)
    # the unused bottom strip repeats the last rows (keeps mipmaps clean)
    bottom = max(s['y'] for s in lay['strips']) + ROW
    atlas[bottom:] = atlas[bottom - 1]
    if lay['packing'] != 'placement':
        alpha[bottom:] = alpha[bottom - 1]
    files = room.survey['outputs']['walls']
    if alpha_from is not None:
        previous = os.path.join(alpha_from, files[0]['file'])
        alpha = np.asarray(Image.open(previous).convert('RGBA'), np.float32)[..., 3]
        if alpha.shape != (SIZE_H, SIZE_W):
            raise SystemExit(f"{previous} is {alpha.shape[1]} x {alpha.shape[0]}, not this atlas's {SIZE_W} x {SIZE_H}")
        print('alpha from', previous, 'glass texels', int((alpha < 192).sum()), flush=True)
    rgba = np.dstack([atlas, alpha]).astype(np.uint8)
    out = Image.fromarray(rgba, 'RGBA')
    out.save('proj/' + os.path.splitext(files[0]['file'])[0] + '.png')
    for f in files:
        if tuple(f['size']) == (SIZE_W, SIZE_H):
            out.save(f"proj/{f['file']}", quality=86, alpha_quality=90, method=6)
        else:
            out.resize(tuple(f['size']), Image.LANCZOS).save(f"proj/{f['file']}", quality=86, alpha_quality=90, method=6)
    print({f['file']: round(os.path.getsize(f"proj/{f['file']}") / 1e6, 2) for f in files})
    os.makedirs('build', exist_ok=True)
    with open('build/atlas.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(dict(describe(room, lay), alphaFrom=alpha_from), f, indent=1)


def describe(room, lay):
    return dict(width=lay['width'], height=lay['height'], row=lay['row'], ppm=lay['ppm'], vRange=lay['vRange'],
                gutter=lay['gutter'], packing=lay['packing'],
                strips=[dict(wall=s['wall']['id'], reliefId=room.relief_id(s['wall']), length=s['wall']['length'],
                             x=s['x'], y=s['y'], w=s['w'], h=lay['row']) for s in lay['strips']])

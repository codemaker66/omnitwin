"""Three builds of a room's walls side by side at named places, to be looked at.

    python -X utf8 three_way.py [--photographs] [--names "a|b|c"] <first_work> <second_work> <third_work> <out_dir> <wall>:<u>:<v>[:<size>[:<zoom>]] ...

For each place (a wall and a point on it in the wall's own metres) it cuts the same window out of each build and
writes one sheet: first | second | third, enlarged without smoothing so that a texel stays a texel. <size> is the
window's side in texels (default 160 = 0.8 m at 200 texels a metre), <zoom> the enlargement (default 4). --names
captions the three builds (default: each work folder's name). three-way.json holds, place by place, the window (u
and v in metres) and how many of its texels differ by more than 6 levels on some channel between each two of the
builds (first_second, second_third, first_third).

Without --photographs the windows come from each build's wall atlas (proj/walls-4096.png, placed by
build/atlas.json): what the planner draws, patches and fill included; the atlas step must have run in all three.
With --photographs they come from the walls step's own photographs (proj/wall-<wall>-<tile>.npz, read as
wallviews.py reads them): what the labels alone decide, before any patch, and a texel no station coloured (its
blend weight 0, which the atlas step fills) is drawn magenta.

Read-only on the three work folders."""
import json
import os
import sys

import wallviews as wv
import numpy as np
from PIL import Image, ImageDraw


def flag(args, name, default):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    return default


def atlas_cutter(works):
    """Windows out of each build's wall atlas, in the atlas's own sRGB."""
    atlases, images = [], []
    for w in works:
        with open(os.path.join(w, 'build', 'atlas.json'), encoding='utf-8') as f:
            atlases.append(json.load(f))
        images.append(np.asarray(Image.open(os.path.join(w, 'proj', 'walls-4096.png')).convert('RGB')))
    a0 = atlases[0]
    for a in atlases[1:]:
        if not (a['strips'] == a0['strips'] and a['ppm'] == a0['ppm'] and a['vRange'] == a0['vRange']):
            raise SystemExit('the atlases are laid out differently: these are not builds of one room config')
    ppm, (_, v1) = a0['ppm'], a0['vRange']
    strips = {s['wall']: s for s in a0['strips']}

    def cuts_of(name, u, v, size):
        s = strips[name]
        ww, hh = min(size, s['w']), min(size, s['h'])
        c = int(np.clip(round(u * ppm - ww / 2), 0, s['w'] - ww))
        r = int(np.clip(round((v1 - v) * ppm - hh / 2), 0, s['h'] - hh))      # the atlas's rows run down from the top of vRange
        cuts = [im[s['y'] + r:s['y'] + r + hh, s['x'] + c:s['x'] + c + ww] for im in images]
        return cuts, (c / ppm, (c + ww) / ppm), (v1 - (r + hh) / ppm, v1 - r / ppm), ppm
    return cuts_of


def photograph_cutter(works):
    """Windows out of each build's walls-step photographs, in sRGB, magenta where no station coloured a texel."""
    _, B, _ = wv.setup(works[2])
    grids, shots = {}, {}

    def shot(work, name):
        parts = wv._tiles(work, name)                                          # the tiles as wallviews.photograph reads them
        rgb = np.concatenate([p['rgb'] for p in parts], 1)
        coloured = np.concatenate([p['valid'] & (p['weight'] > 0) for p in parts], 1)
        img = np.clip(B.P.linear_to_srgb(rgb), 0, 255).astype(np.uint8)
        img[~coloured] = (255, 0, 255)
        return img

    def cuts_of(name, u, v, size):
        if name not in grids:
            grids[name] = B.Grid(name)
        grid = grids[name]
        H, W = grid.depth.shape
        ww, hh = min(size, W), min(size, H)
        c = int(np.clip(int(np.argmin(np.abs(grid.ucol - u))) - ww // 2, 0, W - ww))
        r = int(np.clip(int(np.argmin(np.abs(grid.vrow - v))) - hh // 2, 0, H - hh))
        cuts = []
        for w in works:
            if (w, name) not in shots:
                shots[(w, name)] = shot(w, name)
            cuts.append(shots[(w, name)][r:r + hh, c:c + ww])
        vs = grid.vrow[r:r + hh]
        return cuts, (float(grid.ucol[c]), float(grid.ucol[c + ww - 1])), (float(vs.min()), float(vs.max())), 1.0 / abs(float(grid.ucol[1] - grid.ucol[0]))
    return cuts_of


def main(argv):
    args = list(argv)
    photographs = '--photographs' in args
    if photographs:
        args.remove('--photographs')
    names = flag(args, '--names', None)
    works = [os.path.abspath(a) for a in args[:3]]
    out = os.path.abspath(args[3])
    places = args[4:]
    names = names.split('|') if names else [os.path.basename(w) for w in works]
    if len(names) != 3:
        raise SystemExit('--names takes three captions, as "a|b|c"')
    os.makedirs(out, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None
    cuts_of = photograph_cutter(works) if photographs else atlas_cutter(works)
    kind = "the walls step's photographs, before any patch" if photographs else 'the wall atlas, as drawn'
    record = []
    for k, place in enumerate(places):
        parts = place.split(':')
        name, u, v = parts[0], float(parts[1]), float(parts[2])
        size = int(parts[3]) if len(parts) > 3 else 160
        zoom = int(parts[4]) if len(parts) > 4 else 4
        cuts, (u_a, u_b), (v_a, v_b), ppm = cuts_of(name, u, v, size)
        hh, ww = cuts[0].shape[:2]
        gap = 10
        sheet = Image.new('RGB', (3 * ww * zoom + 2 * gap, hh * zoom + 44), (255, 255, 255))
        draw = ImageDraw.Draw(sheet)
        draw.text((6, 4), f'{name}   u {u_a:.2f} to {u_b:.2f} m, v {v_a:.2f} to {v_b:.2f} m   ({ww / ppm:.2f} m across, each texel {zoom} x {zoom} pixels; {kind})', fill=(0, 0, 0))
        for i, cut in enumerate(cuts):
            x = i * (ww * zoom + gap)
            draw.text((x + 6, 24), names[i], fill=(0, 0, 0))
            sheet.paste(Image.fromarray(np.ascontiguousarray(cut)).resize((ww * zoom, hh * zoom), Image.NEAREST), (x, 44))

        def differ(i, j):
            return int((np.abs(cuts[i].astype(np.int16) - cuts[j].astype(np.int16)).max(axis=2) > 6).sum())

        path = os.path.join(out, f'{k + 1:02d}-{name}-u{u:.2f}-v{v:.2f}.jpg')
        sheet.save(path, quality=92)
        row = dict(file=os.path.basename(path), wall=name, u=[round(u_a, 3), round(u_b, 3)], v=[round(v_a, 3), round(v_b, 3)],
                   texels_differing_by_over_6_levels=dict(first_second=differ(0, 1), second_third=differ(1, 2), first_third=differ(0, 2)))
        record.append(row)
        print(json.dumps(row), flush=True)
    with open(os.path.join(out, 'three-way.json'), 'w', encoding='utf-8') as f:
        json.dump(record, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])

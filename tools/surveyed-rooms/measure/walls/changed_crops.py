"""Where two builds of a room's walls differ, to be looked at: the numbers of compare_builds.py say how much, and
a pair of eyes has to say whether it matters.

    python -X utf8 changed_crops.py <first_work> <second_work> <out_dir> [--top 3] [--size 360] [--level 6] [--zoom N] [--walls a,b]

Reads each build's wall atlas (proj/walls-4096.png, placed by build/atlas.json; the atlas step has run in both)
and, wall by wall, finds the windows that hold the most changed texels. It writes one sheet a window:
first build | second build | the difference (white = unchanged, red = a step of more than 24 levels), with the
wall's own coordinates in its banner, and changed.json with the counts. A texel counts as changed when any
channel differs by more than --level of 255. Windows are --size texels square (360 = 1.8 m at 200 texels a
metre), chosen greedily, each new one clear of those already taken; --zoom N enlarges N times without smoothing,
for a close look (--size 110 --zoom 6 is 0.55 m of wall).

Read-only on both work folders."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

args = sys.argv[1:]


def flag(name, default):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    return default


top, size, level = int(flag('--top', 3)), int(flag('--size', 360)), int(flag('--level', 6))
zoom = int(flag('--zoom', 0))                          # 0: twice the size up to 400 texels, else as it is; N: N times, nearest texel
only = flag('--walls', '')
first, second, out = [os.path.abspath(a) for a in args[:3]]
os.makedirs(out, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None
with open(os.path.join(first, 'build', 'atlas.json'), encoding='utf-8') as f:
    a1 = json.load(f)
with open(os.path.join(second, 'build', 'atlas.json'), encoding='utf-8') as f:
    a2 = json.load(f)
if not (a1['strips'] == a2['strips'] and a1['ppm'] == a2['ppm'] and a1['vRange'] == a2['vRange']):
    raise SystemExit('the two atlases are laid out differently: these are not two builds of one room config')
im1 = np.asarray(Image.open(os.path.join(first, 'proj', 'walls-4096.png')).convert('RGB')).astype(np.int16)
im2 = np.asarray(Image.open(os.path.join(second, 'proj', 'walls-4096.png')).convert('RGB')).astype(np.int16)
if im1.shape != im2.shape:
    raise SystemExit(f'the two atlases are not of one size: {im1.shape} and {im2.shape}')
ppm, (v0, v1) = a1['ppm'], a1['vRange']
summary = []
for strip in a1['strips']:
    name, x, y, w, h = strip['wall'], strip['x'], strip['y'], strip['w'], strip['h']
    if only and name not in only.split(','):
        continue
    p1, p2 = im1[y:y + h, x:x + w], im2[y:y + h, x:x + w]
    gap = np.abs(p1 - p2).max(axis=2)
    changed = gap > level
    row = dict(wall=name, texels=int(w * h), changed=int(changed.sum()), greatest_step=int(gap.max()), windows=[])
    left = changed.copy()
    ww, hh = min(size, w), min(size, h)
    for k in range(top):                                # greedy windows by changed texels, through an integral image
        if not left.any():
            break
        ii = np.zeros((h + 1, w + 1), np.int64)
        ii[1:, 1:] = left.cumsum(0).cumsum(1)
        sums = ii[hh:, ww:] - ii[:-hh, ww:] - ii[hh:, :-ww] + ii[:-hh, :-ww]
        r, c = np.unravel_index(int(sums.argmax()), sums.shape)
        n = int(sums[r, c])
        if n < 40:
            break
        u_a, u_b = c / ppm, (c + ww) / ppm
        v_b, v_a = v1 - r / ppm, v1 - (r + hh) / ppm    # the atlas's rows run down from the top of vRange
        g = gap[r:r + hh, c:c + ww]
        diff = np.clip(255 - g.astype(np.int32) * 8, 0, 255).astype(np.uint8)
        diff = np.dstack([diff, diff, diff])
        diff[changed[r:r + hh, c:c + ww] & (g > 24)] = (200, 30, 30)
        pad = np.full((hh, 6, 3), 255, np.uint8)
        sheet = Image.fromarray(np.hstack([p1[r:r + hh, c:c + ww].astype(np.uint8), pad, p2[r:r + hh, c:c + ww].astype(np.uint8), pad, diff]))
        scale = zoom or (2 if ww <= 400 else 1)
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST if zoom else Image.LANCZOS)
        banner = Image.new('RGB', (sheet.width, 26), (255, 255, 255))
        ImageDraw.Draw(banner).text((6, 6), f'{name}  u {u_a:.2f}-{u_b:.2f} m, v {v_a:.2f}-{v_b:.2f} m   |   first build   |   second build   |   '
                                    f'difference ({n} texels changed here; red: a step over 24 levels)', fill=(0, 0, 0))
        full = Image.new('RGB', (sheet.width, sheet.height + 26), (255, 255, 255))
        full.paste(banner, (0, 0))
        full.paste(sheet, (0, 26))
        path = os.path.join(out, f'{name}-{k + 1}.jpg')
        full.save(path, quality=90)
        row['windows'].append(dict(file=os.path.basename(path), u=[round(u_a, 3), round(u_b, 3)], v=[round(v_a, 3), round(v_b, 3)], changed=n))
        left[r:r + hh, c:c + ww] = False
    summary.append(row)
    print(json.dumps(row), flush=True)
with open(os.path.join(out, 'changed.json'), 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=1)
print('changed texels in all:', sum(r['changed'] for r in summary), 'of', sum(r['texels'] for r in summary))

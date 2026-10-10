"""Packs the ceiling orthophoto and the unrolled dome for the web (hall-photos.ts).

Texels no panorama saw (the roses' and the plate's centres, hidden by the
chandeliers' stems) are filled from their neighbours.
Usage (in the work directory): python3 $SURVEY/pack-overhead.py <out-dir>"""
import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import linear_to_srgb


def fill(img, valid, passes=200):
    img = img.copy(); valid = valid.copy()
    for _ in range(passes):
        if valid.all():
            break
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


def save(img, path, size):
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)
    im.save(path, quality=86, method=6)
    print(path, size, round(os.path.getsize(path) / 1e6, 2), 'MB')


out = sys.argv[1] if len(sys.argv) > 1 else 'proj'
c = np.load('proj/ceiling.npz')
ceiling = fill(linear_to_srgb(c['rgb']).astype(np.float32), c['valid'] & (c['weight'] > 0))
save(ceiling, f'{out}/ceiling-3072.webp', (3072, 1536))
save(ceiling, f'{out}/ceiling-1536.webp', (1536, 768))
d = np.load('proj/dome.npz')
dome = fill(linear_to_srgb(d['rgb']).astype(np.float32), d['weight'] > 0)
save(dome, f'{out}/dome-4096.webp', (4096, 768))
save(dome, f'{out}/dome-2048.webp', (2048, 384))

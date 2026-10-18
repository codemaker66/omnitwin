"""Packs the ceiling orthophoto and the unrolled domes for the web: pack-overhead.py driven by a
room config (file names and sizes from survey.outputs). fill() and save() are its statements.

Texels no panorama saw (behind the fittings' stems) are filled from their neighbours.
"""
import os

import numpy as np
from PIL import Image

from . import legacy

FILL_PASSES = 200


def fill(img, valid, passes=FILL_PASSES):
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


def run(room, out='proj'):
    linear_to_srgb = legacy.project().linear_to_srgb
    outputs = room.survey['outputs']
    c = np.load('proj/ceiling.npz')
    ceiling = fill(linear_to_srgb(c['rgb']).astype(np.float32), c['valid'] & (c['weight'] > 0))
    for f in outputs.get('ceiling', []):
        save(ceiling, f"{out}/{f['file']}", tuple(f['size']))
    for dome in room.cfg['ceiling'].get('domes', []):
        d = np.load(f"proj/{dome['id']}.npz")
        img = fill(linear_to_srgb(d['rgb']).astype(np.float32), d['weight'] > 0)
        for f in outputs['domes'][dome['id']]:
            save(img, f"{out}/{f['file']}", tuple(f['size']))

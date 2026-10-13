"""Packs the flattened floor orthophoto for the web (hall-photos.ts).
Usage (in the work directory): python3 $SURVEY/pack-floor.py <in.npz> <out-dir>
Writes floor-2560.webp and floor-1280.webp (2:1, as hall-geometry.ts maps the floor)."""
import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import linear_to_srgb

src, out = sys.argv[1], sys.argv[2]
img = np.clip(linear_to_srgb(np.load(src)['rgb']), 0, 255).astype(np.uint8)
for size in [(2560, 1280), (1280, 640)]:
    path = f'{out}/floor-{size[0]}.webp'
    Image.fromarray(img).resize(size, Image.LANCZOS).save(path, quality=86, method=6)
    print(path, size, round(os.path.getsize(path) / 1e6, 2), 'MB')

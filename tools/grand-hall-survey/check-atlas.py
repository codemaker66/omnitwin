"""Checks a built wall atlas before it is published, against the build it replaces.

- sizes: walls-4096.webp is 4096 x 4096 RGBA and walls-2048.webp 2048 x 2048 RGBA;
- alpha marks the window glass only: in walls-4096 every texel is opaque (255) except inside the
  window wall's five openings, where the glass is 128 and the mask's resampled edge lies between
  (the runtime cuts glass below 0.75, hall-materials.ts GLAZING_CUT); nothing below 128. In
  walls-2048 the Lanczos reduction rings at those edges, so there it is only checked that nothing
  outside the openings is translucent;
- the glass area (alpha below 192) is within 2% of the previous build at both sizes;
- every wall strip carries colour (no empty strip).
Usage: python3 $SURVEY/check-atlas.py <new-dir> <previous-dir> [--json out.json]
Exits non-zero if any check fails."""
import argparse
import json
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
L, W = 21.135, 10.59
XC = 8.795
SIZE = 4096
PPM = (SIZE / 2) / W
V_MIN, V_MAX = -0.02, 6.72
ROW = int(np.ceil((V_MAX - V_MIN) * PPM))
window_u = lambda scan_x: L / 2 + XC - scan_x
# as window-relief.py: id, kind, centre u, width, sill, head (hall-spec.ts HALL_OPENINGS)
OPENINGS = [
    ('arch-fireplace', 'arched-window', window_u(17.83), 2.7, 0.915, 3.76),
    ('window-fireplace', 'window', window_u(13.71), 1.43, 0.935, 3.305),
    ('arch-centre', 'arched-window', window_u(8.82), 2.67, 0.915, 3.76),
    ('window-end', 'window', window_u(3.93), 1.43, 0.935, 3.305),
    ('arch-end', 'arched-window', window_u(-0.19), 2.7, 0.915, 3.76),
]


def openings_mask(size, margin_px):
    """Texels of the window wall's strip inside an opening's outline, grown by `margin_px`."""
    ppm = PPM * size / SIZE
    row = ROW * size // SIZE
    m = np.zeros((size, size), bool)
    v = V_MAX - (np.arange(row) + 0.5) / ppm
    grow = margin_px / ppm
    for _, kind, centre, width, sill, head in OPENINGS:
        half = width / 2 + grow
        c0, c1 = max(int(np.floor((centre - half) * ppm)), 0), min(int(np.ceil((centre + half) * ppm)), size)
        u = (np.arange(c0, c1) + 0.5) / ppm
        top = np.full(u.shape, head + grow)
        if kind == 'arched-window':
            top = head + np.sqrt(np.maximum(0.0, (width / 2) ** 2 - (u - centre) ** 2)) + grow
        m[:row, c0:c1] |= (v[:, None] >= sill - grow) & (v[:, None] <= top[None, :])
    return m


def load(path):
    im = Image.open(path)
    return im.size, im.mode, np.asarray(im.convert('RGBA'))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('new')
    a.add_argument('previous')
    a.add_argument('--json')
    args = a.parse_args()
    report, failures = {}, []

    def check(name, ok, detail):
        report[name] = dict(ok=bool(ok), **detail)
        if not ok:
            failures.append(name)

    for size in (4096, 2048):
        sz, mode, new = load(f'{args.new}/walls-{size}.webp')
        _, _, prev = load(f'{args.previous}/walls-{size}.webp')
        check(f'{size}.size', sz == (size, size) and mode == 'RGBA', dict(size=list(sz), mode=mode))
        alpha = new[..., 3]
        glass = int((alpha < 192).sum())
        glass_prev = int((prev[..., 3] < 192).sum())
        change = glass / max(glass_prev, 1) - 1
        check(f'{size}.glass_area', abs(change) <= 0.02, dict(texels=glass, previous=glass_prev, change=round(change, 4)))
        inside = openings_mask(size, margin_px=2 if size == 4096 else 4)
        stray = int(((alpha < 255) & ~inside).sum())
        check(f'{size}.alpha_only_in_openings', stray == 0, dict(translucent_outside=stray))
        if size == 4096:
            translucent = alpha < 255
            exact = int((alpha == 128).sum())
            check('4096.alpha_glass_128', int((alpha < 128).sum()) == 0 and exact / max(int(translucent.sum()), 1) >= 0.95,
                  dict(below_128=int((alpha < 128).sum()), at_128=exact, between=int((translucent & (alpha > 128)).sum())))
        row = ROW * size // SIZE
        strips = {'window': (0, 0, size), 'door': (row, 0, size), 'end': (2 * row, 0, size // 2), 'fire': (2 * row, size // 2, size)}
        empty = [k for k, (y, x0, x1) in strips.items() if new[y:y + row, x0:x1, :3].std() < 2]
        check(f'{size}.strips_coloured', not empty, dict(empty=empty))
    report['ok'] = not failures
    if args.json:
        with open(args.json, 'w') as f:
            json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))
    if failures:
        sys.exit('failed: ' + ', '.join(failures))


if __name__ == '__main__':
    main()

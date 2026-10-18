"""Checks the DSM grid's orientation and prints the terrain's spread around the hall (diagnostic).

The grid's documented layout is row 0 = south, column 0 = west, cell centres at
-1500 + (i + 0.5) * 0.5 m from E 259329 N 665183. The hall's dome crown (24.19 m
above the 10.7 m ODN datum, at local E 3.0, N 8.0) must then be the highest point
near that cell; the stored grid is compared with its flipped and transposed
versions. Then the DSM's and a 30 m minimum filter's percentiles within 260 m,
from which build_context.py's ground and level parameters were chosen.

Usage: python3 probe.py <dsm-dir> [--ground-out <file.npy>]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

ap = argparse.ArgumentParser(description="DSM orientation and terrain probe (diagnostic).")
ap.add_argument("dsm_dir", type=Path, help="directory holding heights_50cm.f32 and meta.json (fetch_dsm.py)")
ap.add_argument("--ground-out", type=Path, help="also save the 30 m minimum-filter ground (1 m cells) as .npy")
args = ap.parse_args()
m = json.loads((args.dsm_dir / "meta.json").read_text(encoding="utf-8"))
G = m['grid']; R = m['res']; H = m['sizeM'] / 2
raw = np.fromfile(args.dsm_dir / "heights_50cm.f32", '<f4').reshape(G, G)   # stored order


def cell(e, n):  # hypothesis: stored row 0 = south, col 0 = west, centres at -1500+(i+.5)*.5
    return (n + H) / R - 0.5, (e + H) / R - 0.5


r, c = cell(3.0, 8.0); print('dome cell (row,col)=', r, c)
cands = {'stored (row0=S)': raw, 'flipud (row0=N)': np.flipud(raw), 'transposed': raw.T, 'fliplr': np.fliplr(raw)}
for name, a in cands.items():
    rr, cc = int(round(r)), int(round(c))
    win = a[rr - 6:rr + 7, cc - 6:cc + 7]
    i = np.unravel_index(np.argmax(win), win.shape)
    print(f'{name:18s} value@(3,8) block max={a[int(np.floor(r)):int(np.floor(r)) + 2, int(np.floor(c)):int(np.floor(c)) + 2].max():7.3f}  6m-window max={win.max():7.3f} at offset (dN,dE)=({(i[0] - 6) * R:+.1f},{(i[1] - 6) * R:+.1f}) m')
a = raw; rr, cc = int(np.floor(r)), int(np.floor(c))
blk = a[rr - 1:rr + 3, cc - 1:cc + 3]; print(np.round(blk, 2))
w = a[rr - 20:rr + 21, cc - 20:cc + 21]; print('10m window max', w.max(), 'argmax offset m', (np.array(np.unravel_index(np.argmax(w), w.shape)) - 20) * R)
# is it a strict local max over radius 5 m?
mx = ndi.maximum_filter(a[rr - 40:rr + 41, cc - 40:cc + 41], size=21)
print('local max (21x21) at dome cell:', a[rr:rr + 2, cc:cc + 2].max() == mx[40:42, 40:42].max())
# terrain stats within 260 m
n0 = int(round((8.0 + H) / R)); e0 = int(round((3.0 + H) / R)); K = int(270 / R)
sub = a[n0 - K:n0 + K, e0 - K:e0 + K]
yy, xx = np.mgrid[-K:K, -K:K] * R; rad = np.hypot(yy, xx)
ins = rad <= 260
print('DSM within 260 m pct 1,5,25,50,75,95,99:', np.round(np.percentile(sub[ins], [1, 5, 25, 50, 75, 95, 99]), 2))
# ground estimate: 30 m min filter on 1 m
g = ndi.minimum_filter(sub[::2, ::2], size=30)
print('ground (30m min) within 260: pct 0,5,50,95,100:', np.round(np.percentile(g[ins[::2, ::2]], [0, 5, 50, 95, 100]), 2))
if args.ground_out:
    np.save(args.ground_out, g)

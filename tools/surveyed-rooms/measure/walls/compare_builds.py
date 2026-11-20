"""Two builds of one room's walls, compared where their labels differ: are the second build's photographs better
or worse than the first's on the same texels?

    python -X utf8 compare_builds.py <first_work> <second_work> <out.json> [<wall> ...]

The two work folders are builds of the same room config from the same inputs (the labels and walls steps have
run in both); what differs is the tools' code or one setting. For each wall this reads both builds' labels
(proj/labels-<wall>.npz) and photographs (proj/wall-<wall>-<tile>.npz) and the wall's relief. Every texel whose
station changed is set, in each build's own photograph, against its clean surroundings (wallviews.py: the texels
within 10 cm on the same surface that kept their station in both builds and were seen clear by it), and counted
DARK or OFF in each.

It prints, wall by wall and for the texels left to be seen (outside the config's photo patches): the changed
texels, how many are dark and off in each build, how many were cured and how many are new, the mean distance
from the surroundings in each, and how many moved nearer or farther by more than 2 levels; the same split by
what the change did to the texel (a doubtful view became a clear one, or another doubtful one); and the rate at
which the measure calls a CLEAN texel beside them dark or off, against which every count is to be read.

Read-only on both folders. A rule for which view a texel takes is judged on this before it is changed: gate
B25's second step was chosen on a synthetic wall alone in November 2026 and printed a new dark band on a real
one (the README has the account)."""
import json
import os
import sys

import wallviews as wv
import numpy as np
from scipy import ndimage

first, second, out_path = [os.path.abspath(a) for a in sys.argv[1:4]]
walls = sys.argv[4:] or wv.walls_of(second)
room, B, lv = wv.setup(second)
rng = np.random.default_rng(20261120)


def judged(L, ref):
    return L < wv.DARK * ref, np.abs(L - ref) > wv.OFF


rows = []
for name in walls:
    z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
    z2 = np.load(os.path.join(second, 'proj', f'labels-{name}.npz'))
    if [str(x) for x in z1['stations']] != [str(x) for x in z2['stations']]:
        raise SystemExit(f'{name}: the two builds do not have the same stations')
    old, new = z1['texel_label'], z2['texel_label']
    clearbits = z2['clearbits']
    grid = B.Grid(name)
    rgb1, ok1 = wv.photograph(first, name)
    rgb2, ok2 = wv.photograph(second, name)
    if not rgb1.shape[:2] == rgb2.shape[:2] == old.shape == new.shape == grid.depth.shape:
        raise SystemExit(f'{name}: the two builds are not of the same grid')
    L1, L2 = wv.levels(rgb1), wv.levels(rgb2)
    depth = grid.depth.astype(np.float32)
    # Clean: the same station in both builds, which saw the texel clear, coloured in both.
    r, c = np.nonzero((new >= 0) & (new == old))
    own = np.zeros(new.shape, bool)
    own[r, c] = wv.bit(clearbits, new[r, c].astype(np.int64), r, c)
    clean = own & ok1 & ok2 & grid.valid
    covered = wv.under_a_patch(room, grid, name)

    r, c = np.nonzero((new != old) & (new >= 0) & (old >= 0) & ok1 & ok2)
    ref1, n1 = wv.surroundings(L1, clean, depth, r, c)
    ref2, n2 = wv.surroundings(L2, clean, depth, r, c)
    have = (n1 >= wv.FEW) & (n2 >= wv.FEW)
    a1, a2 = L1[r, c], L2[r, c]
    dark1, off1 = judged(a1, ref1)
    dark2, off2 = judged(a2, ref2)
    dev1, dev2 = np.abs(a1 - ref1), np.abs(a2 - ref2)
    seen = have & ~covered[r, c]
    was_clear = wv.bit(clearbits, old[r, c].astype(np.int64), r, c)
    now_clear = wv.bit(clearbits, new[r, c].astype(np.int64), r, c)

    def tally(m):
        if not m.any():
            return dict(texels=0)
        return dict(texels=int(m.sum()),
                    dark=dict(first=int((dark1 & m).sum()), second=int((dark2 & m).sum()),
                              cured=int((dark1 & ~dark2 & m).sum()), new=int((~dark1 & dark2 & m).sum())),
                    off=dict(first=int((off1 & m).sum()), second=int((off2 & m).sum()),
                             cured=int((off1 & ~off2 & m).sum()), new=int((~off1 & off2 & m).sum())),
                    mean_distance_levels=dict(first=round(float(dev1[m].mean()), 2), second=round(float(dev2[m].mean()), 2)),
                    nearer_by_2=int(((dev2 < dev1 - 2) & m).sum()), farther_by_2=int(((dev2 > dev1 + 2) & m).sum()))

    def patches(mask):
        """The largest connected patches of the texels in `mask`, and where they are on the wall (metres)."""
        img = np.zeros(old.shape, bool)
        img[r[mask], c[mask]] = True
        lab, n = ndimage.label(img, structure=np.ones((3, 3)))
        if n == 0:
            return []
        sizes = ndimage.sum(img, lab, index=np.arange(1, n + 1))
        out = []
        for i in np.argsort(-sizes)[:4]:
            rr, cc = np.nonzero(lab == i + 1)
            out.append(dict(texels=int(sizes[i]), u=[round(float(grid.ucol[cc.min()]), 3), round(float(grid.ucol[cc.max()]), 3)],
                            v=[round(float(grid.vrow[rr.max()]), 3), round(float(grid.vrow[rr.min()]), 3)]))
        return out

    # How often the measure calls a clean texel bad, where it is used: clean texels within the reach of a changed one.
    beside = np.zeros(old.shape, bool)
    beside[r, c] = True
    beside = ndimage.binary_dilation(beside, structure=np.ones((3, 3)), iterations=wv.REACH)
    br, bc = np.nonzero(clean & beside)
    pick = rng.choice(len(br), size=min(20000, len(br)), replace=False) if len(br) else np.zeros(0, np.int64)
    bref, bn = wv.surroundings(L2, clean, depth, br[pick], bc[pick])
    bhave = bn >= wv.FEW
    bdark, boff = judged(L2[br[pick], bc[pick]], bref)

    row = dict(wall=name, station_changed=int(len(r)), with_surroundings=int(have.sum()),
               all=tally(have), left_to_be_seen=tally(seen),
               doubtful_to_clear=tally(seen & ~was_clear & now_clear), doubtful_to_doubtful=tally(seen & ~was_clear & ~now_clear),
               clear_to_clear=tally(seen & was_clear & now_clear), clear_to_doubtful=tally(seen & was_clear & ~now_clear),
               newly_dark_patches=patches(~dark1 & dark2 & seen), cured_dark_patches=patches(dark1 & ~dark2 & seen),
               clean_texels_beside=dict(texels=int(bhave.sum()), dark=int((bdark & bhave).sum()), off=int((boff & bhave).sum())))
    rows.append(row)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(dict(reach_texels=wv.REACH, near_depth_m=wv.NEAR_DEPTH, dark_under=wv.DARK, off_levels=wv.OFF, walls=rows), f, indent=1)

    a = row['left_to_be_seen']
    b = row['clean_texels_beside']
    if a.get('texels'):
        print(f"{name:24s} changed {a['texels']:6d} | dark {a['dark']['first']:5d} -> {a['dark']['second']:5d} (cured {a['dark']['cured']:5d}, new {a['dark']['new']:5d})"
              f" | off {a['off']['first']:5d} -> {a['off']['second']:5d} | distance {a['mean_distance_levels']['first']:5.1f} -> {a['mean_distance_levels']['second']:5.1f}"
              f" | nearer {a['nearer_by_2']:5d}, farther {a['farther_by_2']:5d} | clean texels beside: {100 * b['dark'] / max(b['texels'], 1):4.1f}% dark, {100 * b['off'] / max(b['texels'], 1):4.1f}% off",
              flush=True)
    else:
        print(f"{name:24s} changed {int(len(r)):6d} | none that could be judged", flush=True)


def total(part, *keys):
    n = 0
    for row in rows:
        v = row[part]
        for k in keys:
            v = v.get(k, 0) if isinstance(v, dict) else 0
        n += v
    return n


for part in ('left_to_be_seen', 'doubtful_to_clear', 'doubtful_to_doubtful', 'clear_to_clear', 'clear_to_doubtful'):
    print(f"TOTAL {part:22s} texels {total(part, 'texels'):6d} | dark {total(part, 'dark', 'first'):5d} -> {total(part, 'dark', 'second'):5d}"
          f" (cured {total(part, 'dark', 'cured'):5d}, new {total(part, 'dark', 'new'):5d}) | off {total(part, 'off', 'first'):5d} -> {total(part, 'off', 'second'):5d}"
          f" | nearer {total(part, 'nearer_by_2'):5d}, farther {total(part, 'farther_by_2'):5d}")
t = max(total('clean_texels_beside', 'texels'), 1)
print(f"the measure on clean texels beside them: {100 * total('clean_texels_beside', 'dark') / t:.1f}% called dark, {100 * total('clean_texels_beside', 'off') / t:.1f}% called off"
      f" ({total('clean_texels_beside', 'texels')} texels): read every count above against that")

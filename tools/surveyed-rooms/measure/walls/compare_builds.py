"""Two builds of one room's walls, compared where their labels differ: are the second build's photographs better
or worse than the first's on the same texels?

    python -X utf8 compare_builds.py [--apart-from <reference_work>] <first_work> <second_work> <out.json> [<wall> ...]

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

The noise. Each judgement (dark; off; farther from the surroundings by more than 2 levels) is also given as pairs,
not as two rates: the texels that turned worse, that turned better and that are as they were, with the exact sign
test on the first two (wallviews.py). A patch of texels that changes station changes together, so the same is
counted with the patch as the unit: the connected patches of ALL the texels whose label differs, so that a patch
is one unit even where some of its texels are not judged or are of another kind, and a patch is worse where more
of its texels in the group counted turned worse than better. And the control: clean texels within reach of a
judged texel left to be seen, left to be seen themselves, whose station is the same in both builds, counted the
same way. That is what two builds do to a texel neither of them moved.

A texel the first build left without a station, and the second gives one, is a FORMER HOLE: in the first build
it shows what the atlas step filled it with (wallviews.filled), so that fill is set against the second build's
view. Former holes are counted as a class of their own and in `all_left_to_be_seen`; the other classes, and
`left_to_be_seen`, are the texels that had a station in both builds, as before.

With --apart-from, the changed texels are also split by whether the second build's station is the reference
build's too: with a third build as the reference, the texels that went back to what it had, and the rest.

The bar. A wall fails where more of its patches turned worse than better and the sign test by patch still passes
0.05 after Holm's correction over every wall and judgement tested (raw, 24 tests at 0.05 name some wall four times
in five by chance alone). That test has little power on a small wall, so each class of change is also tested with
the walls pooled, by patch. The sign test asks whether the split is even; where a wall's control leans one way
itself (the two builds level that wall differently), the split to compare with is the control's, printed beside
it. p_worse is the one-sided companion: the chance of at least so many turning worse, for a question set
beforehand as "is it worse?".

Read-only on both folders. A rule for which view a texel takes is judged on this before it is changed: gate
B25's second step was chosen on a synthetic wall alone in November 2026 and printed a new dark band on a real
one (the README has the account)."""
import json
import os
import sys

import wallviews as wv
import numpy as np
from scipy import ndimage

args = sys.argv[1:]
reference = None
if '--apart-from' in args:
    at = args.index('--apart-from')
    reference = os.path.abspath(args[at + 1])
    del args[at:at + 2]
first, second, out_path = [os.path.abspath(a) for a in args[:3]]
walls = args[3:] or wv.walls_of(second)
room, B, lv = wv.setup(second)
rng = np.random.default_rng(20261120)


JUDGEMENTS = ('dark', 'off', 'distance')                  # distance: from the surroundings, by more than 2 levels


def judged(L, ref):
    return L < wv.DARK * ref, np.abs(L - ref) > wv.OFF


def pairs(counts):
    """One line of each judgement's pairs: worse/better/as they were, and the sign test's p."""
    return ', '.join(f"{key} {counts[key]['worse']}/{counts[key]['better']}/{counts[key]['unchanged']} (p {counts[key]['p_exact']:.2g})" for key in JUDGEMENTS)


rows = []
for name in walls:
    z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
    z2 = np.load(os.path.join(second, 'proj', f'labels-{name}.npz'))
    if [str(x) for x in z1['stations']] != [str(x) for x in z2['stations']]:
        raise SystemExit(f'{name}: the two builds do not have the same stations')
    old, new = z1['texel_label'], z2['texel_label']
    clearbits = z2['clearbits']
    first_bits = z1['clearbits'] if 'clearbits' in z1.files else clearbits     # the first build's own, where it kept them
    grid = B.Grid(name)
    rgb1, ok1 = wv.photograph(first, name)
    rgb2, ok2 = wv.photograph(second, name)
    if not rgb1.shape[:2] == rgb2.shape[:2] == old.shape == new.shape == grid.depth.shape:
        raise SystemExit(f'{name}: the two builds are not of the same grid')
    L1, L2 = wv.levels(rgb1), wv.levels(rgb2)
    depth = grid.depth.astype(np.float32)
    # Clean: the same station in both builds, which saw the texel clear by each build's own statistics, coloured in both.
    r, c = np.nonzero((new >= 0) & (new == old))
    own = np.zeros(new.shape, bool)
    own[r, c] = wv.bit(clearbits, new[r, c].astype(np.int64), r, c) & wv.bit(first_bits, new[r, c].astype(np.int64), r, c)
    clean = own & ok1 & ok2 & grid.valid
    covered = wv.under_a_patch(room, grid, name)
    patch_of, _ = wv.patch_image(new != old)             # every texel whose label differs, a hole that took a view among them

    # The changed texels: a station in both builds, or a hole in the first that the second gives a view. A hole
    # shows, in the first build, what the atlas step filled it with.
    hole = (old < 0) & (new >= 0) & ok2 & grid.valid
    r, c = np.nonzero(((new != old) & (new >= 0) & (old >= 0) & ok1 & ok2) | hole)
    was_hole = hole[r, c]
    kept = ~was_hole                                         # a station in both builds
    patch = patch_of[r, c]
    ref1, n1 = wv.surroundings(L1, clean, depth, r, c)
    ref2, n2 = wv.surroundings(L2, clean, depth, r, c)
    have = (n1 >= wv.FEW) & (n2 >= wv.FEW)
    a1, a2 = L1[r, c], L2[r, c]
    if was_hole.any():
        a1 = np.where(was_hole, wv.levels(wv.filled(first, name, B.P))[r, c], a1)
    dark1, off1 = judged(a1, ref1)
    dark2, off2 = judged(a2, ref2)
    dev1, dev2 = np.abs(a1 - ref1), np.abs(a2 - ref2)
    seen = have & ~covered[r, c]
    was_clear = kept & wv.bit(first_bits, np.where(kept, old[r, c], 0).astype(np.int64), r, c)
    now_clear = wv.bit(clearbits, new[r, c].astype(np.int64), r, c)
    # Each of JUDGEMENTS as pairs: (its name, the texels that turned worse, the texels that turned better).
    judgements = (('dark', ~dark1 & dark2, dark1 & ~dark2), ('off', ~off1 & off2, off1 & ~off2),
                  ('distance', dev2 > dev1 + 2, dev2 < dev1 - 2))

    def by_patch(m):
        """The pairs again with the patch as the unit (wallviews.patch_counts): of the patches that hold a texel of
        `m`, how many turned worse, how many better, how many neither."""
        out = dict(patches=0)
        for key, worse, better in judgements:
            counts = wv.patch_counts(patch, worse, better, m)
            out['patches'] = counts.pop('patches')
            out[key] = counts
        return out

    def tally(m):
        if not m.any():
            return dict(texels=0)
        return dict(texels=int(m.sum()),
                    dark=dict(first=int((dark1 & m).sum()), second=int((dark2 & m).sum()),
                              cured=int((dark1 & ~dark2 & m).sum()), new=int((~dark1 & dark2 & m).sum())),
                    off=dict(first=int((off1 & m).sum()), second=int((off2 & m).sum()),
                             cured=int((off1 & ~off2 & m).sum()), new=int((~off1 & off2 & m).sum())),
                    mean_distance_levels=dict(first=round(float(dev1[m].mean()), 2), second=round(float(dev2[m].mean()), 2)),
                    nearer_by_2=int(((dev2 < dev1 - 2) & m).sum()), farther_by_2=int(((dev2 > dev1 + 2) & m).sum()),
                    paired={key: wv.paired_counts(worse, better, m) for key, worse, better in judgements},
                    paired_by_patch=by_patch(m))

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

    # The control, and how often the measure calls a clean texel bad where it is used: clean texels within the reach
    # of a changed texel that is judged and left to be seen, themselves left to be seen.
    beside = np.zeros(old.shape, bool)
    beside[r[seen & kept], c[seen & kept]] = True
    beside = ndimage.binary_dilation(beside, structure=np.ones((3, 3)), iterations=wv.REACH)
    br, bc = np.nonzero(clean & beside & ~covered)
    pick = rng.choice(len(br), size=min(20000, len(br)), replace=False) if len(br) else np.zeros(0, np.int64)
    bref, bn = wv.surroundings(L2, clean, depth, br[pick], bc[pick])
    bhave = bn >= wv.FEW
    bL1, bL2 = L1[br[pick], bc[pick]], L2[br[pick], bc[pick]]
    bdark, boff = judged(bL2, bref)
    # The same clean texels in the first build: what two builds do to a texel whose station neither changed.
    bref1, _ = wv.surroundings(L1, clean, depth, br[pick], bc[pick])
    bdark1, boff1 = judged(bL1, bref1)
    bdev1, bdev2 = np.abs(bL1 - bref1), np.abs(bL2 - bref)
    control = dict(dark=wv.paired_counts(~bdark1 & bdark, bdark1 & ~bdark, bhave), off=wv.paired_counts(~boff1 & boff, boff1 & ~boff, bhave),
                   distance=wv.paired_counts(bdev2 > bdev1 + 2, bdev2 < bdev1 - 2, bhave))

    row = dict(wall=name, station_changed=int(kept.sum()), with_surroundings=int((have & kept).sum()),
               all=tally(have & kept), left_to_be_seen=tally(seen & kept), all_left_to_be_seen=tally(seen),
               doubtful_to_clear=tally(seen & kept & ~was_clear & now_clear), doubtful_to_doubtful=tally(seen & kept & ~was_clear & ~now_clear),
               clear_to_clear=tally(seen & kept & was_clear & now_clear), clear_to_doubtful=tally(seen & kept & was_clear & ~now_clear),
               former_holes=dict(tally(seen & was_hole), in_all=int(was_hole.sum()), under_a_patch=int((was_hole & covered[r, c]).sum()),
                                 took_a_clear_view=int((was_hole & now_clear).sum())),
               newly_dark_patches=patches(~dark1 & dark2 & seen & kept), cured_dark_patches=patches(dark1 & ~dark2 & seen & kept),
               clean_texels_beside=dict(texels=int(bhave.sum()), dark=int((bdark & bhave).sum()), off=int((boff & bhave).sum()), paired=control))
    if reference:
        like = new[r, c] == np.load(os.path.join(reference, 'proj', f'labels-{name}.npz'))['texel_label'][r, c]
        row.update(as_the_reference=tally(seen & like), unlike_the_reference=tally(seen & ~like),
                   as_the_reference_in_all=int(like.sum()), unlike_the_reference_in_all=int((~like).sum()))
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
        print(f"{'':24s} pairs, worse/better/as they were: {pairs(a['paired'])} | by patch ({a['paired_by_patch']['patches']}): {pairs(a['paired_by_patch'])}"
              f" | clean texels beside ({b['texels']}): {pairs(b['paired'])}", flush=True)
    else:
        print(f"{name:24s} changed {int(len(r)):6d} | none that could be judged", flush=True)


def total(part, *keys):
    n = 0
    for row in rows:
        v = row.get(part, {})
        for k in keys:
            v = v.get(k, 0) if isinstance(v, dict) else 0
        n += v
    return n


def pairs_over_the_walls(part, *unit):
    out = {}
    for key in JUDGEMENTS:
        w, b, u = (total(part, *unit, key, k) for k in ('worse', 'better', 'unchanged'))
        out[key] = dict(worse=w, better=b, unchanged=u, p_exact=wv.sign_test(w, b), p_worse=wv.sign_test_worse(w, b))
    return out


PARTS = ('left_to_be_seen', 'doubtful_to_clear', 'doubtful_to_doubtful', 'clear_to_clear', 'clear_to_doubtful', 'former_holes', 'all_left_to_be_seen')
PARTS += ('as_the_reference', 'unlike_the_reference') if reference else ()
pooled = {}
for part in PARTS:
    print(f"TOTAL {part:22s} texels {total(part, 'texels'):6d} | dark {total(part, 'dark', 'first'):5d} -> {total(part, 'dark', 'second'):5d}"
          f" (cured {total(part, 'dark', 'cured'):5d}, new {total(part, 'dark', 'new'):5d}) | off {total(part, 'off', 'first'):5d} -> {total(part, 'off', 'second'):5d}"
          f" | nearer {total(part, 'nearer_by_2'):5d}, farther {total(part, 'farther_by_2'):5d}")
    if total(part, 'texels'):
        by_texel, by_patch_ = pairs_over_the_walls(part, 'paired'), pairs_over_the_walls(part, 'paired_by_patch')
        pooled[part] = dict(texels=total(part, 'texels'), patches=total(part, 'paired_by_patch', 'patches'), paired=by_texel, paired_by_patch=by_patch_)
        is_it_worse = ', '.join(f"{key} p {by_patch_[key]['p_worse']:.2g}" for key in JUDGEMENTS)
        print(f"      {'':22s} pairs, worse/better/as they were: {pairs(by_texel)}"
              f" | by patch ({pooled[part]['patches']}): {pairs(by_patch_)} | is it worse, by patch: {is_it_worse}")
t = max(total('clean_texels_beside', 'texels'), 1)
print(f"the measure on clean texels beside them: {100 * total('clean_texels_beside', 'dark') / t:.1f}% called dark, {100 * total('clean_texels_beside', 'off') / t:.1f}% called off"
      f" ({total('clean_texels_beside', 'texels')} texels): read every count above against that")
print(f"the same clean texels as pairs, worse/better/as they were: {pairs(pairs_over_the_walls('clean_texels_beside', 'paired'))}: what two builds do to a texel neither moved")
# The bar: per wall and judgement, by patch, raw and after Holm's correction over the whole family.
family = [(row, key) for row in rows if row['all_left_to_be_seen'].get('texels') for key in JUDGEMENTS]
adjusted = wv.holm([row['all_left_to_be_seen']['paired_by_patch'][key]['p_exact'] for row, key in family])
tests = []
for (row, key), h in zip(family, adjusted):
    t, k = row['all_left_to_be_seen']['paired_by_patch'][key], row['clean_texels_beside']['paired'][key]
    tests.append(dict(wall=row['wall'], judgement=key, patches=row['all_left_to_be_seen']['paired_by_patch']['patches'], worse=t['worse'], better=t['better'],
                      unchanged=t['unchanged'], p_exact=t['p_exact'], p_holm=h, fails=bool(t['worse'] > t['better'] and h < 0.05),
                      control_worse=k['worse'], control_better=k['better']))
print(f'per wall and judgement, by patch, every changed texel left to be seen ({len(tests)} tests; a wall fails where more turned worse and Holm p is under 0.05):')
for x in tests:
    if x['worse'] or x['better']:
        print(f"  {x['wall']:24s} {x['judgement']:9s} {x['worse']:3d}/{x['better']:3d}/{x['unchanged']:3d}  raw p {x['p_exact']:.2g}  Holm p {x['p_holm']:.2g}"
              f"  control {x['control_worse']}/{x['control_better']}{'  FAILS' if x['fails'] else ''}")
print('walls that fail: ' + ('; '.join(f"{x['wall']} ({x['judgement']})" for x in tests if x['fails']) or 'none'))
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(dict(reach_texels=wv.REACH, near_depth_m=wv.NEAR_DEPTH, dark_under=wv.DARK, off_levels=wv.OFF, walls=rows, pooled=pooled, per_wall_tests=tests), f, indent=1)

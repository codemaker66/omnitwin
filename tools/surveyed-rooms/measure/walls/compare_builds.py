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
counted with the patch as the unit, in two ways. BY PATCH: the connected patches of ALL the texels whose label
differs, so that a patch is one unit even where some of its texels are not judged or are of another kind, and a
patch is worse where more of its texels in the group counted turned worse than better. That numbering depends on
what else changed between the two builds (on the Saloon the same judged texels of one class on one wall were 8
patches against one build and 42 against another), and one patch may hold texels of several classes, so the
classes' counts by patch overlap and their pooled tests are not independent of each other. BY OWN PATCH: the
connected patches of every texel of the class itself, judged or not, under a photo patch or not, each read from
its judged texels left to be seen as above. Nothing outside the class joins or cuts them, so for a test stated
in advance on one class the own patch is the unit.

And the control: clean texels within reach of a judged texel left to be seen, left to be seen themselves, whose
station is the same in both builds, counted the same way. That is what two builds do to a texel neither of them
moved. It is counted BY TEXEL, up to 20,000 a wall drawn from overlapping windows, so its texels are not
independent pairs: its sign tests' p values are lower bounds, printed as such, never p values to act on. What it
gives is its split, the share of its changed pairs that turned worse, against which the per-wall table also reads
each wall's patches (below).

A texel the first build left without a station, and the second gives one, is a FORMER HOLE: in the first build
it shows what the atlas step filled it with (wallviews.filled), so that fill is set against the second build's
view. Former holes are counted as a class of their own and in `all_left_to_be_seen`; the other classes, and
`left_to_be_seen`, are the texels that had a station in both builds, as before.

With --apart-from, the changed texels are also split by whether the second build's station is the reference
build's too: with a third build as the reference, the texels that went back to what it had (as_the_reference),
and the rest (unlike_the_reference: a station that is neither the first build's nor the reference's). The
reference must have the same stations as the two builds, since a station is compared by its number.

The bar. A wall fails where more of its patches turned worse than better and the sign test by patch still passes
0.05 after Holm's correction over every wall and judgement tested (raw, 24 tests at 0.05 name some wall four times
in five by chance alone). That test has little power on a small wall, so each class of change is also tested with
the walls pooled, by patch and by own patch. The sign test asks whether the split is even, and the bar stays on
that. Where a wall's control leans one way itself (the two builds level that wall differently), the split to
compare with is the control's: so the per-wall table also gives, for reading and deciding nothing, the chance of
at least so many of the wall's patches turning worse at an even split (p_worse) and were each to turn worse with
the control's own share (p_worse_at_control_share, at control_share_worse; an even share where the control has
no changed pair). p_worse is the one-sided companion everywhere: the chance of at least so many turning worse,
for a question set beforehand as "is it worse?".

Read-only on both folders. A rule for which view a texel takes is judged on this before it is changed: gate
B25's second step was chosen on a synthetic wall alone in November 2026 and printed a new dark band on a real
one (the README has the account). The per-wall computation is compare_wall, on arrays, and the bar is
wall_tests, so that both are tested on made-up walls (tests/test_units.py, CompareBuilds); main() reads the
files, prints and writes."""
import json
import os
import sys

import wallviews as wv
import numpy as np
from scipy import ndimage

JUDGEMENTS = ('dark', 'off', 'distance')                  # distance: from the surroundings, by more than 2 levels
CONTROL_TEXELS = 20000                                    # clean texels beside the changed ones judged on a wall, at most
SEED = 20261120                                           # the control's draw: one generator through the walls in turn
PARTS = ('left_to_be_seen', 'doubtful_to_clear', 'doubtful_to_doubtful', 'clear_to_clear', 'clear_to_doubtful', 'former_holes', 'all_left_to_be_seen')
APART = ('as_the_reference', 'unlike_the_reference')      # with --apart-from


def judged(L, ref):
    return L < wv.DARK * ref, np.abs(L - ref) > wv.OFF


def pairs(counts):
    """One line of each judgement's pairs: worse/better/as they were, and the sign test's p."""
    return ', '.join(f"{key} {counts[key]['worse']}/{counts[key]['better']}/{counts[key]['unchanged']} (p {counts[key]['p_exact']:.2g})" for key in JUDGEMENTS)


def is_it_worse(counts):
    """One line of each judgement's one-sided p (p_worse)."""
    return ', '.join(f"{key} p {counts[key]['p_worse']:.2g}" for key in JUDGEMENTS)


def holes_given_a_view(old, new, ok2, valid):
    """The FORMER HOLES the measure judges: texels the first build left without a station that the second gives one
    it coloured. In the first build such a texel shows what the atlas step filled it with."""
    return (old < 0) & (new >= 0) & ok2 & valid


def classes(old, new, clearbits, first_bits):
    """Each class of change over the whole wall, from the labels and clear bits alone: every texel of the class,
    whether it can be judged or not (coloured in both builds, with surroundings, outside the photo patches). The
    connected patches of one of these masks are that class's own patches (paired_by_own_patch), which no texel of
    another class can join or cut. A texel the second build leaves without a station is in none."""
    kept = (new != old) & (new >= 0) & (old >= 0)             # a station in both builds, not the same one
    r, c = np.nonzero(kept)
    was, now = np.zeros(new.shape, bool), np.zeros(new.shape, bool)
    was[r, c] = wv.bit(first_bits, old[r, c].astype(np.int64), r, c)
    now[r, c] = wv.bit(clearbits, new[r, c].astype(np.int64), r, c)
    hole = (old < 0) & (new >= 0)
    return dict(all=kept, left_to_be_seen=kept, all_left_to_be_seen=kept | hole,
                doubtful_to_clear=kept & ~was & now, doubtful_to_doubtful=kept & ~was & ~now,
                clear_to_clear=kept & was & now, clear_to_doubtful=kept & was & ~now, former_holes=hole)


def compare_wall(name, old, new, clearbits, first_bits, L1, L2, ok1, ok2, valid, depth, covered, ucol, vrow, rng,
                 reference=None, filled1=None):
    """One wall of the two builds: the row main() writes for it, and beside it the texels each part of the row
    counted, as whole-wall masks for a test to read (they are not written).

    old, new: each build's station at every texel (the labels' texel_label; below 0, none). clearbits, first_bits:
    the second and the first build's packed clear bits (stations, rows, bytes). L1, L2: each build's photograph in
    sRGB levels (wallviews.levels); ok1, ok2: where each is coloured. valid: the wall's own texels; depth: its relief
    (metres); covered: under a photo patch of the config. ucol, vrow: each column's u and each row's v (metres), for
    where the dark patches are. rng: the control's draw, which it advances. reference: a third build's labels
    (--apart-from), or None. filled1: the first build's photograph as the atlas step fills it, in levels
    (wallviews.filled); needed where the wall has a former hole, and refused for want of it.

    The masks: under each key the row counts with tally, the texels that tally counted; with a reference, also
    as_the_reference_in_all and unlike_the_reference_in_all, the changed texels counted by the row's numbers of
    those names, judged or not; and `changed`, every texel compared."""
    if not old.shape == new.shape == L1.shape == L2.shape == ok1.shape == ok2.shape == valid.shape == depth.shape == covered.shape:
        raise ValueError(f'{name}: the arrays are not of one grid')
    if reference is not None and reference.shape != new.shape:
        raise ValueError(f'{name}: the reference build is not of the same grid')
    depth = np.asarray(depth, np.float32)
    # Clean: the same station in both builds, which saw the texel clear by each build's own statistics, coloured in both.
    r, c = np.nonzero((new >= 0) & (new == old))
    clear_in_both = np.zeros(new.shape, bool)
    clear_in_both[r, c] = wv.bit(clearbits, new[r, c].astype(np.int64), r, c) & wv.bit(first_bits, new[r, c].astype(np.int64), r, c)
    clean = clear_in_both & ok1 & ok2 & valid
    patch_of, _ = wv.patch_image(new != old)             # every texel whose label differs, a hole that took a view among them

    # The changed texels: a station in both builds, or a hole in the first that the second gives a view. A hole
    # shows, in the first build, what the atlas step filled it with.
    hole = holes_given_a_view(old, new, ok2, valid)
    r, c = np.nonzero(((new != old) & (new >= 0) & (old >= 0) & ok1 & ok2) | hole)
    was_hole = hole[r, c]
    kept = ~was_hole                                         # a station in both builds
    patch = patch_of[r, c]
    ref1, n1 = wv.surroundings(L1, clean, depth, r, c)
    ref2, n2 = wv.surroundings(L2, clean, depth, r, c)
    have = (n1 >= wv.FEW) & (n2 >= wv.FEW)
    a1, a2 = L1[r, c], L2[r, c]
    if was_hole.any():
        if filled1 is None:
            raise ValueError(f'{name}: a former hole, and no filled photograph of the first build to judge it by')
        a1 = np.where(was_hole, filled1[r, c], a1)
    dark1, off1 = judged(a1, ref1)
    dark2, off2 = judged(a2, ref2)
    dev1, dev2 = np.abs(a1 - ref1), np.abs(a2 - ref2)
    seen = have & ~covered[r, c]
    was_clear = kept & wv.bit(first_bits, np.where(kept, old[r, c], 0).astype(np.int64), r, c)
    now_clear = wv.bit(clearbits, new[r, c].astype(np.int64), r, c)
    # Each of JUDGEMENTS as pairs: (its name, the texels that turned worse, the texels that turned better).
    judgements = (('dark', ~dark1 & dark2, dark1 & ~dark2), ('off', ~off1 & off2, off1 & ~off2),
                  ('distance', dev2 > dev1 + 2, dev2 < dev1 - 2))
    whole = classes(old, new, clearbits, first_bits)

    def image(m):
        out = np.zeros(new.shape, bool)
        out[r[m], c[m]] = True
        return out

    def by_patch(m, unit):
        """The pairs again with the patch as the unit (wallviews.patch_counts), `unit` numbering each changed
        texel's patch: of the patches that hold a texel of `m`, how many turned worse, how many better, how many
        neither."""
        out = dict(patches=0)
        for key, worse, better in judgements:
            counts = wv.patch_counts(unit, worse, better, m)
            out['patches'] = counts.pop('patches')
            out[key] = counts
        return out

    def tally(m, own):
        """The counts of the changed texels in `m`, each of them a texel of the whole class `own` (classes), whose
        connected patches are the own patches."""
        if not m.any():
            return dict(texels=0)
        own_patch = wv.patch_image(own)[0][r, c]
        if not own_patch[m].all():
            raise AssertionError(f'{name}: a texel counted outside its own class')     # the classes are the same tests on the labels
        return dict(texels=int(m.sum()),
                    dark=dict(first=int((dark1 & m).sum()), second=int((dark2 & m).sum()),
                              cured=int((dark1 & ~dark2 & m).sum()), new=int((~dark1 & dark2 & m).sum())),
                    off=dict(first=int((off1 & m).sum()), second=int((off2 & m).sum()),
                             cured=int((off1 & ~off2 & m).sum()), new=int((~off1 & off2 & m).sum())),
                    mean_distance_levels=dict(first=round(float(dev1[m].mean()), 2), second=round(float(dev2[m].mean()), 2)),
                    nearer_by_2=int(((dev2 < dev1 - 2) & m).sum()), farther_by_2=int(((dev2 > dev1 + 2) & m).sum()),
                    paired={key: wv.paired_counts(worse, better, m) for key, worse, better in judgements},
                    paired_by_patch=by_patch(m, patch), paired_by_own_patch=by_patch(m, own_patch))

    def patches(mask):
        """The largest connected patches of the texels in `mask`, and where they are on the wall (metres)."""
        img = image(mask)
        lab, n = ndimage.label(img, structure=np.ones((3, 3)))
        if n == 0:
            return []
        sizes = ndimage.sum(img, lab, index=np.arange(1, n + 1))
        out = []
        for i in np.argsort(-sizes)[:4]:
            rr, cc = np.nonzero(lab == i + 1)
            out.append(dict(texels=int(sizes[i]), u=[round(float(ucol[cc.min()]), 3), round(float(ucol[cc.max()]), 3)],
                            v=[round(float(vrow[rr.max()]), 3), round(float(vrow[rr.min()]), 3)]))
        return out

    # The control, and how often the measure calls a clean texel bad where it is used: clean texels within the reach
    # of a changed texel that is judged and left to be seen, themselves left to be seen. Counted by texel: its p values
    # take texels judged from overlapping windows for independent pairs, so they are lower bounds.
    beside = image(seen & kept)
    beside = ndimage.binary_dilation(beside, structure=np.ones((3, 3)), iterations=wv.REACH)
    br, bc = np.nonzero(clean & beside & ~covered)
    pick = rng.choice(len(br), size=min(CONTROL_TEXELS, len(br)), replace=False) if len(br) else np.zeros(0, np.int64)
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

    counted = dict(all=have & kept, left_to_be_seen=seen & kept, all_left_to_be_seen=seen,
                   doubtful_to_clear=seen & kept & ~was_clear & now_clear, doubtful_to_doubtful=seen & kept & ~was_clear & ~now_clear,
                   clear_to_clear=seen & kept & was_clear & now_clear, clear_to_doubtful=seen & kept & was_clear & ~now_clear,
                   former_holes=seen & was_hole)
    t = {key: tally(m, whole[key]) for key, m in counted.items()}
    row = dict(wall=name, station_changed=int(kept.sum()), with_surroundings=int((have & kept).sum()),
               all=t['all'], left_to_be_seen=t['left_to_be_seen'], all_left_to_be_seen=t['all_left_to_be_seen'],
               doubtful_to_clear=t['doubtful_to_clear'], doubtful_to_doubtful=t['doubtful_to_doubtful'],
               clear_to_clear=t['clear_to_clear'], clear_to_doubtful=t['clear_to_doubtful'],
               former_holes=dict(t['former_holes'], in_all=int(was_hole.sum()), under_a_patch=int((was_hole & covered[r, c]).sum()),
                                 took_a_clear_view=int((was_hole & now_clear).sum())),
               newly_dark_patches=patches(~dark1 & dark2 & seen & kept), cured_dark_patches=patches(dark1 & ~dark2 & seen & kept),
               clean_texels_beside=dict(texels=int(bhave.sum()), dark=int((bdark & bhave).sum()), off=int((boff & bhave).sum()), paired=control))
    masks = {key: image(m) for key, m in counted.items()}
    masks['changed'] = image(np.ones(len(r), bool))
    if reference is not None:
        like = new[r, c] == reference[r, c]
        changed = whole['all_left_to_be_seen']               # every changed texel with a station in the second build
        row.update(as_the_reference=tally(seen & like, changed & (new == reference)), unlike_the_reference=tally(seen & ~like, changed & (new != reference)),
                   as_the_reference_in_all=int(like.sum()), unlike_the_reference_in_all=int((~like).sum()))
        masks.update(as_the_reference=image(seen & like), unlike_the_reference=image(seen & ~like),
                     as_the_reference_in_all=image(like), unlike_the_reference_in_all=image(~like))
    return row, masks


def total(rows, part, *keys):
    n = 0
    for row in rows:
        v = row.get(part, {})
        for k in keys:
            v = v.get(k, 0) if isinstance(v, dict) else 0
        n += v
    return n


def pairs_over_the_walls(rows, part, *unit):
    out = {}
    for key in JUDGEMENTS:
        w, b, u = (total(rows, part, *unit, key, k) for k in ('worse', 'better', 'unchanged'))
        out[key] = dict(worse=w, better=b, unchanged=u, p_exact=wv.sign_test(w, b), p_worse=wv.sign_test_worse(w, b))
    return out


def wall_tests(rows):
    """The bar: per wall and judgement, by patch, every changed texel left to be seen, for every wall with any.
    Raw p, Holm's over the whole family, and whether the wall fails (more of its patches turned worse than better,
    and Holm p under 0.05). Beside them, for reading and deciding nothing: the control's split, and the one-sided p
    at an even split and at the control's own share of worse."""
    family = [(row, key) for row in rows if row['all_left_to_be_seen'].get('texels') for key in JUDGEMENTS]
    adjusted = wv.holm([row['all_left_to_be_seen']['paired_by_patch'][key]['p_exact'] for row, key in family])
    tests = []
    for (row, key), h in zip(family, adjusted):
        t, k = row['all_left_to_be_seen']['paired_by_patch'][key], row['clean_texels_beside']['paired'][key]
        tests.append(dict(wall=row['wall'], judgement=key, patches=row['all_left_to_be_seen']['paired_by_patch']['patches'], worse=t['worse'], better=t['better'],
                          unchanged=t['unchanged'], p_exact=t['p_exact'], p_holm=h, fails=bool(t['worse'] > t['better'] and h < 0.05),
                          control_worse=k['worse'], control_better=k['better'], p_worse=t['p_worse'],
                          control_share_worse=k['worse'] / (k['worse'] + k['better']) if k['worse'] + k['better'] else 0.5,
                          p_worse_at_control_share=wv.sign_test_worse_against(t['worse'], t['better'], k['worse'], k['better'])))
    return tests


def print_wall(row):
    name, a, b = row['wall'], row['left_to_be_seen'], row['clean_texels_beside']
    if a.get('texels'):
        print(f"{name:24s} changed {a['texels']:6d} | dark {a['dark']['first']:5d} -> {a['dark']['second']:5d} (cured {a['dark']['cured']:5d}, new {a['dark']['new']:5d})"
              f" | off {a['off']['first']:5d} -> {a['off']['second']:5d} | distance {a['mean_distance_levels']['first']:5.1f} -> {a['mean_distance_levels']['second']:5.1f}"
              f" | nearer {a['nearer_by_2']:5d}, farther {a['farther_by_2']:5d} | clean texels beside: {100 * b['dark'] / max(b['texels'], 1):4.1f}% dark, {100 * b['off'] / max(b['texels'], 1):4.1f}% off",
              flush=True)
        print(f"{'':24s} pairs, worse/better/as they were: {pairs(a['paired'])} | by patch ({a['paired_by_patch']['patches']}): {pairs(a['paired_by_patch'])}"
              f" | clean texels beside ({b['texels']}), by texel, each p a lower bound: {pairs(b['paired'])}", flush=True)
    else:
        print(f"{name:24s} changed {row['station_changed'] + row['former_holes']['in_all']:6d} | none that could be judged", flush=True)


def pool(rows, parts):
    """Each part pooled over the walls, with its TOTAL lines: by texel, by patch and by own patch."""
    pooled = {}
    for part in parts:
        print(f"TOTAL {part:22s} texels {total(rows, part, 'texels'):6d} | dark {total(rows, part, 'dark', 'first'):5d} -> {total(rows, part, 'dark', 'second'):5d}"
              f" (cured {total(rows, part, 'dark', 'cured'):5d}, new {total(rows, part, 'dark', 'new'):5d}) | off {total(rows, part, 'off', 'first'):5d} -> {total(rows, part, 'off', 'second'):5d}"
              f" | nearer {total(rows, part, 'nearer_by_2'):5d}, farther {total(rows, part, 'farther_by_2'):5d}")
        if total(rows, part, 'texels'):
            by_texel, by_patch, by_own = (pairs_over_the_walls(rows, part, unit) for unit in ('paired', 'paired_by_patch', 'paired_by_own_patch'))
            pooled[part] = dict(texels=total(rows, part, 'texels'), patches=total(rows, part, 'paired_by_patch', 'patches'), paired=by_texel, paired_by_patch=by_patch,
                                own_patches=total(rows, part, 'paired_by_own_patch', 'patches'), paired_by_own_patch=by_own)
            print(f"      {'':22s} pairs, worse/better/as they were: {pairs(by_texel)}"
                  f" | by patch ({pooled[part]['patches']}): {pairs(by_patch)} | is it worse, by patch: {is_it_worse(by_patch)}"
                  f" | by own patch ({pooled[part]['own_patches']}): {pairs(by_own)} | is it worse, by own patch: {is_it_worse(by_own)}")
    return pooled


def main(argv):
    args = list(argv)
    reference = None
    if '--apart-from' in args:
        at = args.index('--apart-from')
        reference = os.path.abspath(args[at + 1])
        del args[at:at + 2]
    first, second, out_path = [os.path.abspath(a) for a in args[:3]]
    walls = args[3:] or wv.walls_of(second)
    room, B, _ = wv.setup(second)
    rng = np.random.default_rng(SEED)
    rows = []

    def write(**more):
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(dict(reach_texels=wv.REACH, near_depth_m=wv.NEAR_DEPTH, dark_under=wv.DARK, off_levels=wv.OFF, walls=rows, **more), f, indent=1)

    for name in walls:
        z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
        z2 = np.load(os.path.join(second, 'proj', f'labels-{name}.npz'))
        stations = [str(x) for x in z2['stations']]
        if [str(x) for x in z1['stations']] != stations:
            raise SystemExit(f'{name}: the two builds do not have the same stations')
        old, new = z1['texel_label'], z2['texel_label']
        clearbits = z2['clearbits']
        first_bits = z1['clearbits'] if 'clearbits' in z1.files else clearbits     # the first build's own, where it kept them
        grid = B.Grid(name)
        rgb1, ok1 = wv.photograph(first, name)
        rgb2, ok2 = wv.photograph(second, name)
        if not rgb1.shape[:2] == rgb2.shape[:2] == old.shape == new.shape == grid.depth.shape:
            raise SystemExit(f'{name}: the two builds are not of the same grid')
        labels3 = None
        if reference:
            z3 = np.load(os.path.join(reference, 'proj', f'labels-{name}.npz'))
            if [str(x) for x in z3['stations']] != stations:                       # a station is compared by its number
                raise SystemExit(f'{name}: the reference build does not have the same stations')
            labels3 = z3['texel_label']
        filled1 = wv.levels(wv.filled(first, name, B.P)) if holes_given_a_view(old, new, ok2, grid.valid).any() else None
        row, _ = compare_wall(name, old, new, clearbits, first_bits, wv.levels(rgb1), wv.levels(rgb2), ok1, ok2, grid.valid,
                              grid.depth.astype(np.float32), wv.under_a_patch(room, grid, name), grid.ucol, grid.vrow, rng, labels3, filled1)
        rows.append(row)
        write()
        print_wall(row)

    pooled = pool(rows, PARTS + (APART if reference else ()))
    t = max(total(rows, 'clean_texels_beside', 'texels'), 1)
    print(f"the measure on clean texels beside them: {100 * total(rows, 'clean_texels_beside', 'dark') / t:.1f}% called dark, {100 * total(rows, 'clean_texels_beside', 'off') / t:.1f}% called off"
          f" ({total(rows, 'clean_texels_beside', 'texels')} texels): read every count above against that")
    print(f"the same clean texels as pairs, worse/better/as they were: {pairs(pairs_over_the_walls(rows, 'clean_texels_beside', 'paired'))}: what two builds do to a texel neither moved"
          " (by texel, from overlapping windows: each p a lower bound, not one to act on)")
    # The bar: per wall and judgement, by patch, raw and after Holm's correction over the whole family.
    tests = wall_tests(rows)
    print(f'per wall and judgement, by patch, every changed texel left to be seen ({len(tests)} tests; a wall fails where more turned worse and Holm p is under 0.05;'
          " is it worse, one-sided at an even split and at the control's own share, decides nothing):")
    for x in tests:
        if x['worse'] or x['better']:
            print(f"  {x['wall']:24s} {x['judgement']:9s} {x['worse']:3d}/{x['better']:3d}/{x['unchanged']:3d}  raw p {x['p_exact']:.2g}  Holm p {x['p_holm']:.2g}"
                  f"  control {x['control_worse']}/{x['control_better']}"
                  f"  is it worse: p {x['p_worse']:.2g} even, p {x['p_worse_at_control_share']:.2g} at the control's {x['control_share_worse']:.2g}"
                  f"{'  FAILS' if x['fails'] else ''}")
    print('walls that fail: ' + ('; '.join(f"{x['wall']} ({x['judgement']})" for x in tests if x['fails']) or 'none'))
    write(pooled=pooled, per_wall_tests=tests)


if __name__ == '__main__':
    main(sys.argv[1:])

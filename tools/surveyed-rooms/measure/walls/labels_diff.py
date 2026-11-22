"""Where two builds of a room's walls give a texel a different station, and of what kind.

    python -X utf8 labels_diff.py [--apart-from <reference_work>] [--expect <expected.json>] [--photographs] <first_work> <other_work> <out.json>

The two work folders are builds of one room config from the same inputs with an occluder margin (gate B25); the
labels step has run in both. The statistics (which stations saw a texel, and saw it clear of the margin) are then
the same in both, and are read from <other_work>. Per wall it counts the valid texels by what the first build gave
and what the other gives:

  the same station
  doubtful to clear       a doubtful view that became a clear one (the gate's first step)
  doubtful to doubtful    a doubtful view that became another doubtful one (its second step)
  clear to clear          a clear view that became another station's clear view
  clear to doubtful       should be none
  hole to clear, hole to doubtful   a texel the first build left without a station, though a station saw it
  labelled to hole        should be none
  unexplained             what is left, which is 0 by construction: each build leaves a texel a hole or gives it a
                          clear or a doubtful view, and the kinds above take every pair of those that can differ
                          (labelled to hole takes both a clear and a doubtful view lost). It checks this script's
                          own partition; it is no finding about the builds, and no part of a forecast's evidence.

With --apart-from, the texels that differ are also split by the reference build's label: `back` where the other
build's station is the reference's, `new` where it is neither the first build's nor the reference's. With a third
build as <first_work>, a fourth as <other_work> and the first build as the reference, `new` is the set of texels
that compare_builds.py --apart-from calls unlike_the_reference: both read it off the same three label files.

With --expect, the totals and each wall's counts are set against a JSON written BEFORE the other build was made
({"total": {...}, "walls": {"<wall>": {...}}}, any of the keys this prints): a forecast is only one if it is
checked (against_forecast). Any difference is printed and the exit status is 1.

With --photographs, every wall whose labels are the same in both builds on every texel is also asked whether its
photographs are: whether the walls step's files of it (proj/wall-<wall>-<tile>.npz and .fine.npz) are the same
files in both builds, holding the same arrays, each of one dtype, shape and bytes in both (same_photographs). It
reports and decides nothing: where the labels are the same and a photograph is not, something else changed
between the builds (the statistics, or the walls step itself).

Read-only on every folder. A rule for the labels is forecast on a build's saved arrays (forecast_labels.py), then
built, then checked with this, before any photograph is judged."""
import glob
import hashlib
import json
import os
import re
import sys

import wallviews as wv
import numpy as np

KINDS = ('doubtful_to_clear', 'doubtful_to_doubtful', 'clear_to_clear', 'clear_to_doubtful', 'hole_to_clear', 'hole_to_doubtful', 'labelled_to_hole')


def flag(args, name):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return os.path.abspath(value)
    return None


def against_forecast(total, rows, want):
    """Every count of a forecast `want` ({"total": {...}, "walls": {"<wall>": {...}}}) that the build's `total` and
    per-wall `rows` do not equal, as one line each; none where the build is the forecast. Every total and every
    per-wall count the forecast names is compared, and one the build does not count is a difference."""
    wrong = [f"total {k}: expected {v}, found {total.get(k)}" for k, v in want.get('total', {}).items() if total.get(k) != v]
    by_wall = {row['wall']: row for row in rows}
    for wall, keys in want.get('walls', {}).items():
        wrong += [f"{wall} {k}: expected {v}, found {by_wall.get(wall, {}).get(k)}" for k, v in keys.items() if by_wall.get(wall, {}).get(k) != v]
    return wrong


def same_photographs(first, other, wall):
    """Whether two builds' walls-step photographs of a wall are one: the files the walls step wrote for it in each
    (by name: proj/wall-<wall>-<tile>.npz, the photograph at the wall's texels, and proj/wall-<wall>-<tile>.fine.npz,
    the 2.5 mm one the atlas step draws from where it is there), and in every file every array, compared by dtype,
    shape and a SHA-256 of its bytes. The counts, and the file or array that differs, if any."""
    exact = re.compile(rf'^wall-{re.escape(wall)}-(\d+)(\.fine)?\.npz$')     # "window" must not take "window-front-end"'s tiles

    def tiles(work):
        return {os.path.basename(f): f for f in glob.glob(os.path.join(work, 'proj', f'wall-{wall}-*.npz')) if exact.match(os.path.basename(f))}

    def digest(a):
        return a.dtype.str, a.shape, hashlib.sha256(np.ascontiguousarray(a)).hexdigest()

    a, b = tiles(first), tiles(other)
    out = dict(files=len(b), arrays=0, identical=0, differ=[f'{t}: in one build only' for t in sorted(set(a) ^ set(b))])
    for t in sorted(set(a) & set(b), key=lambda t: (int(exact.match(t).group(1)), t)):
        with np.load(a[t]) as za, np.load(b[t]) as zb:
            for k in sorted(set(za.files) | set(zb.files)):
                out['arrays'] += 1
                if k in za.files and k in zb.files and digest(za[k]) == digest(zb[k]):
                    out['identical'] += 1
                else:
                    out['differ'].append(f'{t}: {k}')
    return out


def main(argv):
    args = list(argv)
    reference, expected = flag(args, '--apart-from'), flag(args, '--expect')
    photographs = '--photographs' in args
    if photographs:
        args.remove('--photographs')
    first, other, out_path = [os.path.abspath(a) for a in args[:3]]
    room, B, lv = wv.setup(other)
    rows, tot = [], {}
    for name in wv.walls_of(other):
        z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
        z2 = np.load(os.path.join(other, 'proj', f'labels-{name}.npz'))
        if [str(x) for x in z1['stations']] != [str(x) for x in z2['stations']]:
            raise SystemExit(f'{name}: the two builds do not have the same stations')
        a, b = z1['texel_label'].astype(np.int64), z2['texel_label'].astype(np.int64)
        grid = B.Grid(name)
        clear, seen = z2['clearbits'], z2['seenbits']
        same_statistics = bool(np.array_equal(z1['clearbits'], clear) and np.array_equal(z1['seenbits'], seen)) if 'clearbits' in z1.files else None
        width = a.shape[1]
        any_clear = B.unpack_bits(np.bitwise_or.reduce(clear, axis=0), width)
        any_seen = B.unpack_bits(np.bitwise_or.reduce(seen, axis=0), width)
        valid = grid.valid

        def own(labels):
            """Labelled by a view its station saw clear."""
            r, c = np.nonzero(labels >= 0)
            out = np.zeros(labels.shape, bool)
            out[r, c] = wv.bit(clear, labels[r, c], r, c)
            return out

        a_clear, b_clear = own(a), own(b)
        a_has, b_has = a >= 0, b >= 0
        a_doubt, b_doubt = a_has & ~a_clear, b_has & ~b_clear
        differs = (a != b) & valid
        row = dict(wall=name, valid=int(valid.sum()), the_statistics_are_the_same=same_statistics,
                   labelled_first=int((a_has & valid).sum()), labelled_other=int((b_has & valid).sum()),
                   doubtful_first=int((a_doubt & valid).sum()), doubtful_other=int((b_doubt & valid).sum()),
                   doubtful_with_a_clear_view_from_some_station_first=int((a_doubt & any_clear & valid).sum()),
                   doubtful_with_a_clear_view_from_some_station_other=int((b_doubt & any_clear & valid).sum()),
                   seen_without_a_label_first=int((any_seen & ~a_has & valid).sum()), seen_without_a_label_other=int((any_seen & ~b_has & valid).sum()),
                   differ=int(differs.sum()),
                   doubtful_to_clear=int((differs & a_doubt & b_clear).sum()), doubtful_to_doubtful=int((differs & a_doubt & b_doubt).sum()),
                   clear_to_clear=int((differs & a_clear & b_clear).sum()), clear_to_doubtful=int((differs & a_clear & b_doubt).sum()),
                   hole_to_clear=int((differs & ~a_has & b_clear).sum()), hole_to_doubtful=int((differs & ~a_has & b_doubt).sum()),
                   labelled_to_hole=int((differs & a_has & ~b_has).sum()))
        row['unexplained'] = row['differ'] - sum(row[k] for k in KINDS)        # 0 by construction: a check of the partition above
        if reference:
            ref = np.load(os.path.join(reference, 'proj', f'labels-{name}.npz'))['texel_label'].astype(np.int64)
            row.update(back=int((differs & (b == ref)).sum()), new=int((differs & (b != ref)).sum()))
        if photographs:
            row['labels_the_same_everywhere'] = bool(np.array_equal(a, b))
            row['photographs'] = same_photographs(first, other, name) if row['labels_the_same_everywhere'] else None
        rows.append(row)
        for k, v in row.items():
            if isinstance(v, int) and not isinstance(v, bool):
                tot[k] = tot.get(k, 0) + v
        shot = row.get('photographs')
        print(f"{name:24s} differ {row['differ']:6d} | " + ' | '.join(f"{k.replace('_', ' ')} {row[k]}" for k in KINDS if row[k])
              + (f" | back {row['back']}, new {row['new']}" if reference else '') + f" | unexplained {row['unexplained']} | same statistics: {same_statistics}"
              + (f" | the same labels, photograph arrays identical: {shot['identical']} of {shot['arrays']} in {shot['files']} files" if shot else ''), flush=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(dict(first=os.path.basename(first), other=os.path.basename(other), reference=os.path.basename(reference) if reference else None,
                       walls=rows, total=tot), f, indent=1)
    print('TOTAL', json.dumps(tot))
    if photographs:
        same = [row for row in rows if row['photographs']]
        print('walls with the same labels on every texel: ' + ('; '.join(
            f"{row['wall']} (photograph arrays identical: {row['photographs']['identical']} of {row['photographs']['arrays']}"
            + (f"; differ: {', '.join(row['photographs']['differ'])}" if row['photographs']['differ'] else '') + ')' for row in same) or 'none'))
    if expected:
        with open(expected, encoding='utf-8') as f:
            want = json.load(f)
        wrong = against_forecast(tot, rows, want)
        if wrong:
            print('NOT AS EXPECTED:\n  ' + '\n  '.join(wrong))
            sys.exit(1)
        print(f"as expected: {len(want.get('total', {}))} totals and {sum(len(k) for k in want.get('walls', {}).values())} per-wall counts")


if __name__ == '__main__':
    main(sys.argv[1:])

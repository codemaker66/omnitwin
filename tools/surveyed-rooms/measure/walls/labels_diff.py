"""Where two builds of a room's walls give a texel a different station, and of what kind.

    python -X utf8 labels_diff.py [--apart-from <reference_work>] [--expect <expected.json>] <first_work> <other_work> <out.json>

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
  unexplained             what is left: should be none

With --apart-from, the texels that differ are also split by the reference build's label: `back` where the other
build's station is the reference's, `new` where it is neither the first build's nor the reference's. With a third
build as <first_work>, a fourth as <other_work> and the first build as the reference, `new` is the set of texels
that compare_builds.py --apart-from calls unlike_the_reference: both read it off the same three label files.

With --expect, the totals and each wall's counts are set against a JSON written BEFORE the other build was made
({"total": {...}, "walls": {"<wall>": {...}}}, any of the keys this prints): a forecast is only one if it is
checked. Any difference is printed and the exit status is 1.

Read-only on every folder. A rule for the labels is forecast on a build's saved arrays (forecast_labels.py), then
built, then checked with this, before any photograph is judged."""
import json
import os
import sys

import wallviews as wv
import numpy as np

args = sys.argv[1:]


def flag(name):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return os.path.abspath(value)
    return None


reference, expected = flag('--apart-from'), flag('--expect')
first, other, out_path = [os.path.abspath(a) for a in args[:3]]
room, B, lv = wv.setup(other)
KINDS = ('doubtful_to_clear', 'doubtful_to_doubtful', 'clear_to_clear', 'clear_to_doubtful', 'hole_to_clear', 'hole_to_doubtful', 'labelled_to_hole')
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
    row['unexplained'] = row['differ'] - sum(row[k] for k in KINDS)
    if reference:
        ref = np.load(os.path.join(reference, 'proj', f'labels-{name}.npz'))['texel_label'].astype(np.int64)
        row.update(back=int((differs & (b == ref)).sum()), new=int((differs & (b != ref)).sum()))
    rows.append(row)
    for k, v in row.items():
        if isinstance(v, int) and not isinstance(v, bool):
            tot[k] = tot.get(k, 0) + v
    print(f"{name:24s} differ {row['differ']:6d} | " + ' | '.join(f"{k.replace('_', ' ')} {row[k]}" for k in KINDS if row[k])
          + (f" | back {row['back']}, new {row['new']}" if reference else '') + f" | unexplained {row['unexplained']} | same statistics: {same_statistics}", flush=True)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(dict(first=os.path.basename(first), other=os.path.basename(other), reference=os.path.basename(reference) if reference else None,
                   walls=rows, total=tot), f, indent=1)
print('TOTAL', json.dumps(tot))
if expected:
    with open(expected, encoding='utf-8') as f:
        want = json.load(f)
    wrong = [f"total {k}: expected {v}, found {tot.get(k)}" for k, v in want.get('total', {}).items() if tot.get(k) != v]
    by_wall = {row['wall']: row for row in rows}
    for wall, keys in want.get('walls', {}).items():
        wrong += [f"{wall} {k}: expected {v}, found {by_wall.get(wall, {}).get(k)}" for k, v in keys.items() if by_wall.get(wall, {}).get(k) != v]
    if wrong:
        print('NOT AS EXPECTED:\n  ' + '\n  '.join(wrong))
        sys.exit(1)
    print(f"as expected: {len(want.get('total', {}))} totals and {sum(len(k) for k in want.get('walls', {}).values())} per-wall counts")

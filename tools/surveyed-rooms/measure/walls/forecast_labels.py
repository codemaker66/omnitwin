"""What the labels step, as it is coded in this checkout, makes of a build's saved statistics: a forecast of a
build's labels before it is built.

    python -X utf8 forecast_labels.py <work> <out.json> [--against <other_work>] [--against <another_work>]

<work> is a build with an occluder margin (gate B25) whose labels step has run. Its labels files keep, for each
wall, the blocks' ranking and labels and which stations saw each texel at all and clear of the margin (ranked,
label, seenbits, clearbits). None of those depends on how a texel that no ranked station saw clear is given its
view, so label-views.py's own functions for that are run on them here, with no build: texel_labels (the ranking
alone), block_sequence, clear_views, and the choice doubtful_views makes (the first station of the sequence that
saw the texel; the clearance it also works out decides nothing).

Per wall it counts where the forecast differs from the labels <work> itself wrote, and from each --against
build's. Of the texels where it differs from <work>'s own labels: `back` where it is the first --against build's
station, `new` where it is none of the given builds'. And how much of the first --against build's clear labelling
the forecast keeps. On the Saloon in November 2026, <work> the third build and --against the first: one sequence
for both steps differs from the third build on 450 texels, 209 back and 241 new, and keeps every clear label of
the first build.

Read-only. A changed rule is forecast with this, then built, then the build's labels are checked against the
forecast with labels_diff.py --expect, before any photograph is judged."""
import json
import os
import sys

import wallviews as wv
import numpy as np

args = sys.argv[1:]
against = []
while '--against' in args:
    i = args.index('--against')
    against.append(os.path.abspath(args[i + 1]))
    del args[i:i + 2]
work, out_path = [os.path.abspath(a) for a in args[:2]]
room, B, lv = wv.setup(work)
rows, tot = [], {}
for name in wv.walls_of(work):
    z = np.load(os.path.join(work, 'proj', f'labels-{name}.npz'))
    grid = B.Grid(name)
    clear, seen = z['clearbits'], z['seenbits']
    width = grid.depth.shape[1]
    ranked, label = z['ranked'], z['label'].astype(np.int64)
    sequence = lv.block_sequence(ranked, label, seen, width)
    forecast, outside = lv.clear_views(sequence, lv.texel_labels(ranked, clear, grid.valid, tuple(int(x) for x in z['region'])), clear)
    forecast = forecast.astype(np.int64)
    any_clear = B.unpack_bits(np.bitwise_or.reduce(clear, axis=0), width)
    any_seen = B.unpack_bits(np.bitwise_or.reduce(seen, axis=0), width)
    r, c = np.nonzero(any_seen & ~any_clear & (forecast < 0))          # doubtful_views' own texels
    pick = np.full(len(r), -1, np.int64)
    for k in range(sequence.shape[-1]):
        s = sequence[r // B.BLOCK, c // B.BLOCK, k].astype(np.int64)
        saw = (s >= 0) & (pick < 0)
        saw[saw] = wv.bit(seen, s[saw], r[saw], c[saw])
        pick = np.where(saw, s, pick)
    forecast[r, c] = pick
    own = z['texel_label'].astype(np.int64)
    valid = grid.valid
    differs = (forecast != own) & valid
    row = dict(wall=name, valid=int(valid.sum()), labelled=int(((forecast >= 0) & valid).sum()), clear_views_from_outside_the_ranking=int(outside),
               doubtful_views=int(len(r)), seen_without_a_label=int((any_seen & (forecast < 0) & valid).sum()),
               differ_from_its_own_labels=int(differs.sum()))
    others = [np.load(os.path.join(w, 'proj', f'labels-{name}.npz'))['texel_label'].astype(np.int64) for w in against]
    if others:
        first = others[0]
        rr, cc = np.nonzero((first >= 0) & valid)
        first_clear = np.zeros(first.shape, bool)
        first_clear[rr, cc] = wv.bit(clear, first[rr, cc], rr, cc)
        unlike_all = np.logical_and.reduce([forecast != o for o in others])
        row.update(back=int((differs & (forecast == first)).sum()), new=int((differs & unlike_all).sum()),
                   the_first_given_builds_clear_labels=int(first_clear.sum()), of_them_kept=int((first_clear & (forecast == first)).sum()))
        for w, o in zip(against, others):
            row[f'differ_from_{os.path.basename(w)}'] = int(((forecast != o) & valid).sum())
    rows.append(row)
    for k, v in row.items():
        if k != 'wall':
            tot[k] = tot.get(k, 0) + v
    print(name, json.dumps({k: v for k, v in row.items() if k != 'wall'}), flush=True)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(dict(work=os.path.basename(work), against=[os.path.basename(w) for w in against], walls=rows, total=tot), f, indent=1)
print('TOTAL', json.dumps(tot))

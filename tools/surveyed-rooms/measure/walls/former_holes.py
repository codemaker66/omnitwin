"""The texels a build left as holes though a station saw them, and none clear: should such a texel take a doubtful
view, or be left to the atlas step's fill? Scored before the view is ever built.

    python -X utf8 former_holes.py <first_work> <second_work> <out.json>

<first_work> is a build whose rule for a doubtful view left some seen texels without a station (in November 2026
the Saloon's first build asked a block's six ranked stations and the six that saw most of it, and left 100).
<second_work> is any build of the same config whose labels keep every station's bits. The sequence in this
checkout's label-views.py (block_sequence) gives each such texel a view; that view and the fill are both set, per
wall, against the texel's clean surroundings in the first build's own photograph (wallviews.py: the texels within
reach that took a clear view, on the same surface):

  view   one sample of the station the sequence picks, from its panorama at the wall's relief, exposure corrected
         as the walls step corrects it; not levelled, since nothing levels a texel-sized island
  fill   what the atlas step puts there: pack-atlas.py's own fill on the first build's photograph (wallviews.filled)

Holes under a photo patch of the config are counted and left out: they are never seen. Once the second rule is
built, compare_builds.py gives the same comparison on the two builds' real photographs (its former_holes class);
this script is for before that. Read-only; it opens the panorama of each station it needs once."""
import json
import os
import sys

import wallviews as wv
import numpy as np

first, second, out_path = [os.path.abspath(a) for a in sys.argv[1:4]]
room, B, lv = wv.setup(second)
P = B.P
sts = P.stations()
rows, need, W = [], {}, {}
for name in wv.walls_of(second):
    z1 = np.load(os.path.join(first, 'proj', f'labels-{name}.npz'))
    z2 = np.load(os.path.join(second, 'proj', f'labels-{name}.npz'))
    old = z1['texel_label']
    grid = B.Grid(name)
    clear, seen = z2['clearbits'], z2['seenbits']
    width = old.shape[1]
    any_clear = B.unpack_bits(np.bitwise_or.reduce(clear, axis=0), width)
    any_seen = B.unpack_bits(np.bitwise_or.reduce(seen, axis=0), width)
    label = z2['label'].astype(np.int64)
    r, c = np.nonzero(any_seen & ~any_clear & grid.valid & (old < 0))          # seen, by none clear, without a station in the first build
    covered = wv.under_a_patch(room, grid, name)
    row = dict(wall=name, former_holes=int(len(r)), under_a_patch=int(covered[r, c].sum()))
    rows.append(row)
    if not len(r):
        continue
    sequence = lv.block_sequence(z2['ranked'], label, seen, width)[r // B.BLOCK, c // B.BLOCK].astype(np.int64)
    pick = np.full(len(r), -1, np.int64)
    place = np.full(len(r), -1, np.int64)
    for k in range(sequence.shape[1]):
        s = sequence[:, k]
        ok = (s >= 0) & (pick < 0)
        saw = ok & wv.bit(seen, np.where(ok, s, 0), r, c)
        place = np.where(saw, k, place)
        pick = np.where(saw, s, pick)
    if (pick < 0).any():
        raise SystemExit(f'{name}: {int((pick < 0).sum())} texels a station saw are in no sequence')
    rgb1, ok1 = wv.photograph(first, name)
    L1 = wv.levels(rgb1)
    rr, cc = np.nonzero(old >= 0)
    own = np.zeros(old.shape, bool)
    own[rr, cc] = wv.bit(clear, old[rr, cc].astype(np.int64), rr, cc)
    ref, n = wv.surroundings(L1, own & ok1 & grid.valid, grid.depth.astype(np.float32), r, c)
    W[name] = dict(grid=grid, r=r, c=c, pick=pick, place=place, ref=ref, n=n, Lfill=wv.levels(wv.filled(first, name, P))[r, c],
                   seen_ok=~covered[r, c], Lview=np.full(len(r), np.nan, np.float32), row=row, own=label[r // B.BLOCK, c // B.BLOCK])
    for si in np.unique(pick):
        need.setdefault(int(si), []).append(name)

for si in sorted(need):
    pano = B.Pano(sts[si])
    for name in need[si]:
        w = W[name]
        k = np.nonzero(w['pick'] == si)[0]
        grid = w['grid']
        w['Lview'][k] = pano.rgb(grid.points(w['r'][k], w['c'][k], grid.depth[w['r'][k], w['c'][k]])) @ wv.LUMA
    print('sampled', sts[si]['id'], 'for', need[si], flush=True)
    del pano

tot = dict(texels=0, left_to_be_seen=0, judged=0, view_dark=0, fill_dark=0, view_off=0, fill_off=0, view_distance=0.0, fill_distance=0.0,
           view_nearer_by_2=0, fill_nearer_by_2=0, within_2=0, from_the_blocks_own_station=0)
for name, w in W.items():
    m = w['seen_ok'] & (w['n'] >= wv.FEW) & ~np.isnan(w['Lview'])
    dv, df = np.abs(w['Lview'] - w['ref']), np.abs(w['Lfill'] - w['ref'])
    row = w['row']
    row.update(left_to_be_seen=int(w['seen_ok'].sum()), judged=int(m.sum()),
               place_in_the_sequence=dict(least=int(w['place'].min()), most=int(w['place'].max())),
               stations={sts[int(s)]['id']: int((w['pick'] == s).sum()) for s in np.unique(w['pick'])},
               from_the_blocks_own_station=int((w['pick'] == w['own']).sum()))
    tot['texels'] += int(len(w['r']))
    tot['left_to_be_seen'] += row['left_to_be_seen']
    tot['from_the_blocks_own_station'] += row['from_the_blocks_own_station']
    if m.any():
        row.update(view=dict(dark=int((w['Lview'][m] < wv.DARK * w['ref'][m]).sum()), off=int((dv[m] > wv.OFF).sum()), mean_distance=round(float(dv[m].mean()), 2)),
                   fill=dict(dark=int((w['Lfill'][m] < wv.DARK * w['ref'][m]).sum()), off=int((df[m] > wv.OFF).sum()), mean_distance=round(float(df[m].mean()), 2)),
                   paired=dict(view_nearer_by_2=int((dv[m] < df[m] - 2).sum()), fill_nearer_by_2=int((df[m] < dv[m] - 2).sum()),
                               within_2=int((np.abs(dv[m] - df[m]) <= 2).sum())))
        tot['judged'] += int(m.sum())
        for side in ('view', 'fill'):
            tot[f'{side}_dark'] += row[side]['dark']
            tot[f'{side}_off'] += row[side]['off']
        tot['view_distance'] += float(dv[m].sum())
        tot['fill_distance'] += float(df[m].sum())
        for key in ('view_nearer_by_2', 'fill_nearer_by_2', 'within_2'):
            tot[key] += row['paired'][key]
tot['p_the_fill_nearer'] = wv.sign_test_worse(tot['fill_nearer_by_2'], tot['view_nearer_by_2'])
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(dict(walls=rows, total=tot), f, indent=1)
for row in rows:
    if row['former_holes']:
        print(json.dumps(row))
j = max(tot['judged'], 1)
print(f"TOTAL former holes {tot['texels']}, left to be seen {tot['left_to_be_seen']}, judged {tot['judged']}"
      f" | view: dark {tot['view_dark']}, off {tot['view_off']}, mean distance {tot['view_distance'] / j:.2f}"
      f" | fill: dark {tot['fill_dark']}, off {tot['fill_off']}, mean distance {tot['fill_distance'] / j:.2f}"
      f" | the view nearer its surroundings by over 2 levels on {tot['view_nearer_by_2']}, the fill on {tot['fill_nearer_by_2']}, within 2 on {tot['within_2']}"
      f" (one-sided p that the fill is the nearer: {tot['p_the_fill_nearer']:.2g}) | from the block's own station {tot['from_the_blocks_own_station']}")

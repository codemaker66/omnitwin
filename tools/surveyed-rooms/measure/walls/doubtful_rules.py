"""Which doubtful view should a wall texel take? The candidate rules, scored on one room's real walls.

    python -X utf8 doubtful_rules.py <work> <out.json> [--stations a,b] [<wall> ...]

<work> is the work folder of a build whose labels step has run with an occluder margin (gate B25). With a margin,
a texel that stations saw, and none of them clear of an occluder's margin, must still take a view. Here every such
texel is sampled from EVERY station that saw it (one sample from the station's panorama at the wall's relief), and
each view is judged against the same station's own picture of the clean wall beside it: the median luminance of
the texels within 10 cm that this station saw clear, on the same surface (wallviews.py). That is the measure of
16 November 2026 for an occluder's rim, and it does not depend on a station's exposure. Each rule then picks its
station for every texel, and is scored:

  sequence      the tools' rule: the first station of the block's sequence that saw the texel (label-views.py
                doubtful_sequence: the block's ranked stations, then every station by how much of the block it saw)
  farthest      the station whose ray passes farthest from the occluder's outline (bestview.occluder_clearance)
  floor-NN      the first station of the sequence whose ray passes NN mm or more from the outline; where none
                does, the sequence's first
  own-first     the block's own station if it saw the texel, else the farthest
  best          the view nearest its own station's clean wall: what no rule can beat on this measure

For each rule it prints how many of its views are DARK and OFF, their mean distance from their station's clean
wall, and how many texels it takes from a station other than their block's own. The last matters as much as the
first two: a texel-sized island of another station's picture inside a block is not levelled with its neighbours,
and shows in the finished photograph whatever its own station's clean wall looks like. compare_builds.py measures
that, on two finished builds.

What this found on the Saloon (November 2026, 28,250 doubtful texels left to be seen): every rule above but
`best` shows the occluder's edge about as often (50 dark in 1,000), so none earns its place by that; `farthest`
takes more than twice as many texels from another station than `sequence` does. The README has the account.

Read-only on the work folder. It opens each station's panorama once (about 0.8 GB at its peak, two minutes for
twelve walls)."""
import json
import os
import sys
import time

import wallviews as wv
import numpy as np
from scipy import ndimage

args = sys.argv[1:]
only_stations = None
if '--stations' in args:
    i = args.index('--stations')
    only_stations = args[i + 1].split(',')
    del args[i:i + 2]
work, out_path = [os.path.abspath(a) for a in args[:2]]
walls = args[2:] or wv.walls_of(work)
room, B, lv = wv.setup(work)
P = B.P
sts = P.stations()
S = len(sts)
FLOORS = (0.010, 0.020, 0.030)
RULES = ['sequence', 'farthest'] + [f'floor-{int(f * 1000)}' for f in FLOORS] + ['own-first', 'best']
T0 = time.time()


def say(*a):
    print(f'[{time.time() - T0:6.1f} s]', *a, flush=True)


# ---- each wall's doubtful texels, their neighbourhood, and its own labels ----
W = {}
for name in walls:
    z = np.load(os.path.join(work, 'proj', f'labels-{name}.npz'))
    if 'clearbits' not in z.files:
        raise SystemExit(f'{name}: these labels were made without an occluder margin')
    if [str(x) for x in z['stations']] != [s['id'] for s in sts]:
        raise SystemExit(f'{name}: the labels do not hold this room\'s stations')
    grid = B.Grid(name)
    clear, seen = z['clearbits'], z['seenbits']
    width = grid.depth.shape[1]
    any_clear = B.unpack_bits(np.bitwise_or.reduce(clear, axis=0), width)
    any_seen = B.unpack_bits(np.bitwise_or.reduce(seen, axis=0), width)
    todo = any_seen & ~any_clear & grid.valid                      # seen by some station, by none clear
    r, c = np.nonzero(todo)
    label = z['label'].astype(np.int64)
    n = len(r)
    W[name] = dict(grid=grid, clear=clear, seen=seen, r=r, c=c,
                   near=ndimage.binary_dilation(todo, structure=np.ones((3, 3)), iterations=wv.REACH),
                   seen_ok=~wv.under_a_patch(room, grid, name)[r, c],
                   built=z['texel_label'][r, c].astype(np.int64),
                   sequence=lv.doubtful_sequence(z['ranked'], label, seen, width)[r // B.BLOCK, c // B.BLOCK].astype(np.int64),
                   own=label[r // B.BLOCK, c // B.BLOCK],
                   L=np.full((n, S), np.nan, np.float32), ref=np.full((n, S), np.nan, np.float32),
                   cnt=np.zeros((n, S), np.int32), gap=np.full((n, S), np.nan, np.float32),
                   cos=np.full((n, S), np.nan, np.float32), dist=np.full((n, S), np.nan, np.float32))
    say(name, 'doubtful texels', n)
    del z

# ---- every station once: its picture of each wall's doubtful texels and of its own clean wall beside them ----
for si, st in enumerate(sts):
    if only_stations and st['id'] not in only_stations:
        continue
    pano = depthcube = None
    for name in walls:
        w = W[name]
        grid, r, c = w['grid'], w['r'], w['c']
        cand = wv.bit(w['seen'], si, r, c)
        if not cand.any():
            continue
        if pano is None:
            pano, depthcube = B.Pano(st), P.load_depth(st['id'])
        clean = w['near'] & B.unpack_bits(w['clear'][si], grid.depth.shape[1]) & grid.valid
        cr, cc = np.nonzero(clean)
        L = np.full(grid.depth.shape, np.nan, np.float32)
        if len(cr):
            L[cr, cc] = pano.rgb(grid.points(cr, cc, grid.depth[cr, cc])) @ wv.LUMA
        k = np.nonzero(cand)[0]
        pts = grid.points(r[k], c[k], grid.depth[r[k], c[k]])
        w['L'][k, si] = pano.rgb(pts) @ wv.LUMA
        w['ref'][k, si], w['cnt'][k, si] = wv.surroundings(L, clean, grid.depth.astype(np.float32), r[k], c[k])
        v = pts - st['t']
        dist = np.linalg.norm(v, axis=1)
        cos = -(v @ grid.n) / np.maximum(dist, 1e-6)
        w['gap'][k, si] = B.occluder_clearance(depthcube, v, dist, cos)
        w['cos'][k, si], w['dist'][k, si] = cos, dist
    say(st['id'], 'sampled' if pano is not None else 'sees no doubtful texel')
    del pano, depthcube


# ---- the rules ----
def choose(w):
    n = len(w['r'])
    rows = np.arange(n)
    have = ~np.isnan(w['L'])                                       # the stations that saw the texel
    gap = np.where(have, w['gap'], -1.0)
    farthest = np.where(have.any(1), gap.argmax(1), -1)
    seq = w['sequence']
    sh = np.zeros(seq.shape, bool)                                 # does the k-th of the sequence see the texel?
    sg = np.full(seq.shape, -1.0)
    for k in range(seq.shape[1]):
        s = seq[:, k]
        ok = s >= 0
        sh[:, k] = ok & have[rows, np.where(ok, s, 0)]
        sg[:, k] = np.where(sh[:, k], gap[rows, np.where(ok, s, 0)], -1.0)
    first = np.where(sh.any(1), seq[rows, sh.argmax(1)], -1)
    out = dict(sequence=first, farthest=farthest)
    for f in FLOORS:
        okf = sh & (sg >= f)
        out[f'floor-{int(f * 1000)}'] = np.where(okf.any(1), seq[rows, okf.argmax(1)], first)
    own = w['own']
    own_saw = (own >= 0) & have[rows, np.where(own >= 0, own, 0)]
    out['own-first'] = np.where(own_saw, own, farthest)
    dev = np.where(have & (w['cnt'] >= wv.FEW), np.abs(w['L'] - w['ref']), np.inf)
    out['best'] = np.where(np.isfinite(dev).any(1), dev.argmin(1), -1)
    return out


def score(w, pick, mask):
    rows = np.arange(len(w['r']))
    ok = mask & (pick >= 0)
    p = np.where(ok, pick, 0)
    L, ref, cnt = w['L'][rows, p], w['ref'][rows, p], w['cnt'][rows, p]
    judged = ok & ~np.isnan(L) & (cnt >= wv.FEW)
    if not judged.any():
        return dict(texels=int(mask.sum()), judged=0)
    return dict(texels=int(mask.sum()), judged=int(judged.sum()),
                dark=int((judged & (L < wv.DARK * ref)).sum()), off=int((judged & (np.abs(L - ref) > wv.OFF)).sum()),
                mean_distance=round(float(np.abs(L - ref)[judged].mean()), 2),
                not_the_blocks_own=int((judged & (pick != w['own'])).sum()))


picks = {name: choose(W[name]) for name in walls}
result = dict(reach_texels=wv.REACH, near_depth_m=wv.NEAR_DEPTH, dark_under=wv.DARK, off_levels=wv.OFF, walls={}, rules={}, pairs={})
unlike = 0
for name in walls:
    w = W[name]
    result['walls'][name] = {rule: score(w, picks[name][rule], w['seen_ok']) for rule in RULES}
    result['walls'][name]['doubtful_texels'] = int(len(w['r']))
    result['walls'][name]['left_to_be_seen'] = int(w['seen_ok'].sum())
    if not only_stations:
        unlike += int((picks[name]['sequence'] != w['built']).sum())
result['sequence_differs_from_the_builds_own_labels'] = unlike


def together(common):
    out = {}
    for rule in RULES:
        tot = dict(texels=0, judged=0, dark=0, off=0, dist=0.0, other=0)
        for name in walls:
            w = W[name]
            rows = np.arange(len(w['r']))
            mask = w['seen_ok'].copy()
            if common:                                             # the texels where every rule's view could be judged
                for other in RULES:
                    p = picks[name][other]
                    ok = p >= 0
                    pp = np.where(ok, p, 0)
                    mask &= ok & ~np.isnan(w['L'][rows, pp]) & (w['cnt'][rows, pp] >= wv.FEW)
            s = score(w, picks[name][rule], mask)
            tot['texels'] += s['texels']
            tot['judged'] += s.get('judged', 0)
            tot['dark'] += s.get('dark', 0)
            tot['off'] += s.get('off', 0)
            tot['dist'] += s.get('mean_distance', 0.0) * s.get('judged', 0)
            tot['other'] += s.get('not_the_blocks_own', 0)
        j = max(tot['judged'], 1)
        out[rule] = dict(texels=tot['texels'], judged=tot['judged'], dark=tot['dark'], off=tot['off'],
                         dark_per_1000=round(1000 * tot['dark'] / j, 1), off_per_1000=round(1000 * tot['off'] / j, 1),
                         mean_distance=round(tot['dist'] / j, 2), not_the_blocks_own=tot['other'])
    return out


result['rules']['each_rule_where_it_could_be_judged'] = together(False)
result['rules']['where_every_rule_could_be_judged'] = together(True)

# What predicts a dirty view on real walls: every (texel, station) pair that could be judged.
flat = {key: np.concatenate([W[n][key][W[n]['seen_ok']].ravel() for n in walls]) for key in ('L', 'ref', 'cnt', 'gap', 'dist', 'cos')}
own = np.concatenate([(np.arange(S)[None, :] == W[n]['own'][:, None])[W[n]['seen_ok']].ravel() for n in walls])
ok = ~np.isnan(flat['L']) & (flat['cnt'] >= wv.FEW)
dark = ok & (flat['L'] < wv.DARK * flat['ref'])
off = ok & (np.abs(flat['L'] - flat['ref']) > wv.OFF)


def by(name, edges, values, scale=1.0):
    rows = []
    for a, b in zip(edges[:-1], edges[1:]):
        m = ok & (values >= a) & (values < b)
        if m.any():
            rows.append(dict(span=[round(a * scale, 3), round(b * scale, 3)], pairs=int(m.sum()),
                             dark_per_1000=round(float(1000 * dark[m].sum() / m.sum()), 1), off_per_1000=round(float(1000 * off[m].sum() / m.sum()), 1)))
    result['pairs'][name] = rows


result['pairs']['judged'] = int(ok.sum())
by('by_clearance_mm', [0, 0.010, 0.020, 0.030, 0.040, B.OCCLUDER_MARGIN + 1e-4], flat['gap'], 1000.0)
by('by_distance_m', [0, 1.5, 2.5, 4.0, 6.0, 99.0], flat['dist'])
by('by_cosine', [0, 0.3, 0.5, 0.7, 0.85, 1.01], flat['cos'])
for flag, key in ((True, 'the_blocks_own_station'), (False, 'another_station')):
    m = ok & (own == flag)
    result['pairs'][key] = dict(pairs=int(m.sum()), dark_per_1000=round(float(1000 * dark[m].sum() / max(m.sum(), 1)), 1),
                                off_per_1000=round(float(1000 * off[m].sum() / max(m.sum(), 1)), 1))
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=1)

if not only_stations:
    print(f'the sequence rule, worked out here, against the labels this build wrote: {unlike} texels differ'
          ' (0 if the build was made with this rule)')
for title in ('each_rule_where_it_could_be_judged', 'where_every_rule_could_be_judged'):
    print('==', title.replace('_', ' '))
    for rule in RULES:
        s = result['rules'][title][rule]
        print(f"  {rule:10s} judged {s['judged']:6d} of {s['texels']:6d} | dark {s['dark']:5d} ({s['dark_per_1000']:5.1f} in 1,000) | off {s['off']:5d} ({s['off_per_1000']:5.1f})"
              f" | mean distance {s['mean_distance']:5.2f} | from a station not the block's own {s['not_the_blocks_own']:6d}")
print('== what predicts a dirty view: dark / off in 1,000, over every judged pair of texel and station')
for key in ('by_clearance_mm', 'by_distance_m', 'by_cosine'):
    print(' ', key.replace('_', ' '), '|', '  '.join(f"{x['span'][0]:g}-{x['span'][1]:g}: {x['dark_per_1000']:.0f}/{x['off_per_1000']:.0f} (n {x['pairs']})" for x in result['pairs'][key]))
print("  the block's own station", result['pairs']['the_blocks_own_station'], '| another', result['pairs']['another_station'])
say('done; peak', B.peak_mb(), 'MB')

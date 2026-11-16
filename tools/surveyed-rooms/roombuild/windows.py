"""Window relief and glass mask: window-relief.py driven by a room config.

For every wall with a window whose glazing the build reads, in wall order, writes on the wall's
orthophoto grid (wallViews.ppm, rows from v = wallViews.heightRange[1]):
  proj/<wall>-glass.npy     glass mask, packed into the wall atlas's alpha
  proj/<wall>-layered.npy   layered depth inside each opening, for the relief step
and build/glass.json (per opening: class, outline, planes, pixels).

Clear glazing keeps the old loop body verbatim: the colour test (glazing is bluer than the
curtains), the depth separation, the morphology and the row intervals, and the glass depth from
the median, else the twin's (reveal.glassDepthFrom), else the 3rd percentile. The helpers
(median, morph, row_intervals, fill_from, blur, top_at) are window-relief.py's own objects.

Glazing other than clear (gate B10) is masked from the measured glass block instead:
stained-backlit and frosted-lower glass is the glazed outline, less its bars, wherever the scan
sees nothing or sees a surface within GLASS_TOL of any of the opening's glass planes (so a plane
change placed a few centimetres off cannot punch holes in the mask, whatever the planes' spacing);
sheer glass is the outline less its bars (the sheer hides the glass). The relief blends the front
layer into the plane the config gives each row, so two planes are honoured.

Where the rows change plane, and how deep each plane sits, is then checked against the scan
(measure_planes): every glass texel goes to its nearest plane, each row votes, and the split is
the row boundary that misassigns the fewest rows. A split more than SPLIT_TOL from the config's
`below`, or a plane whose median depth is more than PLANE_TOL from the config's, is recorded in
build/glass.json as a disagreement; the build carries on (the files are there to look at) and
publishing refuses. Sheer glass is not checked: the scan sees the sheer, not the glass.

build/glass.json also carries inputs_digest(room), the config facts this step reads; the atlas
and relief steps refuse masks made from other facts. Masks of walls that no longer have glazing
are deleted, so a stale file is never picked up.
"""
import hashlib
import json
import os

import numpy as np

from . import legacy

RANGE = (-1.0, 0.15)            # depth range for the 8-bit median filter, metres (window-relief.py)
GLASS_TOL = 0.05                # metres: a scanned surface this close to one of the glass planes is the glass
SASH_INSET = 0.1                # window-relief.py: a square window's sash is inset 0.1 from each jamb
SPLIT_TOL = 0.03                # metres: a measured plane change this far from the config's `below` disagrees
PLANE_TOL = 0.03                # metres: a plane's measured median depth this far from the config's disagrees
SPLIT_MIN_TEXELS = 10           # glass texels a row needs to vote on its plane
SPLIT_MIN_ROWS = 10             # voting rows needed on each side of a measured split
PLANE_MARGIN = 0.1              # metres either side of a configured split left out of a plane's depth
PLANE_MIN_TEXELS = 200          # texels needed to measure a plane's depth


def _kind(o):
    return 'arched-window' if o['headShape'] == 'semicircular' else 'window'


def _top(shape, centre, width, head, rise, U):
    """The outline's top over the columns U (array), any head shape."""
    half = width / 2
    if shape == 'semicircular':
        return head + np.sqrt(np.maximum(0.0, half * half - (U - centre) ** 2))
    if shape == 'segmental':
        radius = (rise * rise + half * half) / (2 * rise)
        return head + rise - radius + np.sqrt(np.maximum(0.0, radius * radius - (U - centre) ** 2))
    return head


def _sash(o):
    reveal = o.get('reveal', {})
    if 'sashHalfWidth' in reveal:
        return reveal['sashHalfWidth']
    return o['width'] / 2 - reveal.get('sashInset', SASH_INSET)


def plane_depths(glass, V):
    """Per row (V: H x 1), minus the depth of the glass plane holding that height."""
    planes = glass['planes']
    out = np.full(V.shape, -float(planes[-1]['depth']))
    for p in reversed(planes[:-1]):
        out = np.where(V < p['below'], -float(p['depth']), out)
    return out


def bar_rows(glass, V):
    bars = np.zeros(V.shape, bool)
    for b0, b1 in glass.get('bars', []):
        bars |= (V >= b0) & (V <= b1)
    return bars


def _no_notes(value):
    if isinstance(value, dict):
        return {k: _no_notes(v) for k, v in value.items() if k != 'note'}
    if isinstance(value, list):
        return [_no_notes(v) for v in value]
    return value


def inputs_digest(room):
    """SHA-256 of the config facts this step reads (windows, walls, transform, wall views, method
    revision), notes left out: the atlas and relief steps check build/glass.json against it."""
    cfg = room.cfg
    facts = dict(windows=[o for o in cfg['openings'] if o['kind'] == 'window'], walls=cfg['walls'],
                 transform=cfg['transform'], wallViews=room.survey['wallViews'], methodRevision=room.revision)
    return hashlib.sha256(json.dumps(_no_notes(facts), sort_keys=True).encode('utf-8')).hexdigest()


def on_glass(D, Dm, planes):
    """Texels that may be glass: unseen, or (8-bit median depth) within GLASS_TOL of any of the
    opening's planes. For one plane this is window-relief's test against that plane."""
    near = np.zeros(D.shape, bool)
    for p in planes:
        near |= np.abs(Dm + float(p['depth'])) < GLASS_TOL
    return np.isnan(D) | near


def geometric_glass(o, D, Dm, V, U, centre, morph):
    """B10 for one opening over its columns: (mask, each row's plane depth, glazed outline, bar rows).
    D and Dm are the raw and median depth over the opening's columns; V (H, 1) and U (1, W) its
    rows' and columns' v and u."""
    gl = o['glass']
    gw, gs = gl.get('width', 2 * _sash(o)), gl.get('sill', o['sill'])
    gh, gshape = gl.get('head', o['head']), gl.get('headShape', o['headShape'])
    ginside = (V >= gs) & (V <= _top(gshape, centre, gw, gh, gl.get('headRise'), U)) & (np.abs(U - centre) <= gw / 2)
    pd = plane_depths(gl, V)                     # (H, 1): minus each row's glass depth
    bars = bar_rows(gl, V)
    if o['glazing'] == 'sheer':
        g_mask = ginside & ~bars
    else:
        g_mask = ginside & ~bars & on_glass(D, Dm, gl['planes'])
    g_mask = morph(morph(g_mask, 'shrink', 5), 'grow', 5)
    g_mask = morph(morph(g_mask, 'grow', 7), 'shrink', 7) & ginside & ~bars
    return g_mask, pd, ginside, bars


def measure_planes(gl, D, V, ginside, bars):
    """Where the scan's glass changes plane, and each plane's depth, against the config.

    Texels: inside the glazed outline, seen, within GLASS_TOL of a plane; each goes to its nearest
    plane. A row with SPLIT_MIN_TEXELS of them votes for the plane most of them are on; the bars'
    rows vote too (a transom often closes the lower light, and leaving its rows out would put
    the split in the middle of it). For the split between planes k and k + 1 (rows between the
    neighbouring configured splits), every row boundary is tried; the ones misassigning the
    fewest voting rows give the measured range (and its middle), which needs SPLIT_MIN_ROWS
    voting rows each side. The config disagrees when its `below` lies more than SPLIT_TOL outside
    that range. A plane's depth is the median over its configured rows, off the bars and
    PLANE_MARGIN clear of any split."""
    planes = gl['planes']
    depths = np.array([float(p['depth']) for p in planes])
    v = V[:, 0]
    seen = ginside & np.isfinite(D)
    dist = np.stack([np.abs(np.where(seen, D, np.inf) + d) for d in depths])     # (P, H, W)
    nearest = np.argmin(dist, axis=0)
    usable = seen & (np.min(dist, axis=0) < GLASS_TOL)
    counts = np.stack([(usable & (nearest == k)).sum(axis=1) for k in range(len(planes))], 1)   # (H, P)
    splits, out_planes, disagreements = [], [], []
    bounds = [-np.inf] + [float(p['below']) for p in planes[:-1]] + [np.inf]
    for k in range(len(planes) - 1):
        below = bounds[k + 1]
        rows = np.nonzero((v > bounds[k]) & (v < bounds[k + 2]))[0]
        n = counts[rows, k] + counts[rows, k + 1]
        voting = n >= SPLIT_MIN_TEXELS
        rows, upper = rows[voting], (2 * counts[rows, k + 1] >= n)[voting]
        order = np.argsort(v[rows])
        rv, up = v[rows][order], upper[order]
        entry = dict(between=[k, k + 1], below=below, measured=None, misassigned=None, votingRows=int(len(rv)))
        if len(rv) >= 2 * SPLIT_MIN_ROWS:
            # Boundary i sits between rows i - 1 and i (ascending v): err = upper rows under it plus
            # lower rows over it, tried for i in SPLIT_MIN_ROWS .. len - SPLIT_MIN_ROWS.
            up_below = np.concatenate([[0], np.cumsum(up)])
            low_above = np.concatenate([np.cumsum((~up)[::-1])[::-1], [0]])
            err = up_below + low_above
            idx = np.arange(SPLIT_MIN_ROWS, len(rv) - SPLIT_MIN_ROWS + 1)
            best = idx[err[idx] == err[idx].min()]
            at = lambda i: float((rv[i - 1] + rv[i]) / 2)  # noqa: E731
            lo, hi = at(best[0]), at(best[-1])
            entry.update(measured=round((lo + hi) / 2, 4), range=[round(lo, 4), round(hi, 4)], misassigned=int(err[best[0]]))
            if below < lo - SPLIT_TOL or below > hi + SPLIT_TOL:
                disagreements.append(f"plane {k} -> {k + 1} changes at v {lo:.3f}..{hi:.3f} in the scan, {below} in the config")
        splits.append(entry)
    for k, p in enumerate(planes):
        rows = (v > bounds[k]) & (v < bounds[k + 1])
        for b in bounds[1:-1]:
            rows &= np.abs(v - b) > PLANE_MARGIN
        texels = usable & ~bars & rows[:, None]
        entry = dict(plane=k, depth=float(p['depth']), measured=None, texels=int(texels.sum()))
        if texels.sum() >= PLANE_MIN_TEXELS:
            measured = -float(np.median(D[texels]))
            entry['measured'] = round(measured, 4)
            if abs(measured - float(p['depth'])) > PLANE_TOL:
                disagreements.append(f"plane {k} is {measured:.3f} deep in the scan, {p['depth']} in the config")
        out_planes.append(entry)
    return dict(splits=splits, planes=out_planes, disagreements=disagreements)


def depth_map(room, wall):
    tiles = []
    for v in room.tiles(wall):
        w, h = v['pixels']
        P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1]
        tiles.append(np.where(P[..., 3] > 0.5, room.depth(wall, P), np.nan))
    return np.concatenate(tiles, 1)


def photo(room, wall):
    linear_to_srgb = legacy.project().linear_to_srgb
    tiles = [np.load(f"proj/{v['name']}.npz") for v in room.tiles(wall)]
    return linear_to_srgb(np.concatenate([t['rgb'] for t in tiles], 1)) / 255.0


def run_wall(room, wall, report):
    wr = legacy.window_relief()
    median, morph, row_intervals, fill_from, blur, top_at = wr.median, wr.morph, wr.row_intervals, wr.fill_from, wr.blur, wr.top_at
    SRC_PPM = float(room.survey['wallViews']['ppm'])
    SRC_TOP = room.survey['wallViews']['heightRange'][1]
    openings = [o for o in room.openings_on(wall) if o['kind'] == 'window' and o['glazing'] != 'none']
    D = depth_map(room, wall)
    H, Wd = D.shape
    rows = SRC_TOP - (np.arange(H) + 0.5) / SRC_PPM          # v of each row
    cols = (np.arange(Wd) + 0.5) / SRC_PPM                   # u of each column
    Dm = median(D, 9, *RANGE)
    cool = None
    if any(o['glazing'] == 'clear' for o in openings):
        rgb = photo(room, wall)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        cool = (b - r) / (r + g + b + 1e-6)
    glass = np.zeros(D.shape, bool)
    relief = {}
    glass_depth = {}
    twins = {o['id']: o['reveal']['glassDepthFrom'] for o in openings if 'glassDepthFrom' in o.get('reveal', {})}
    for o in openings:
        oid, kind, centre, width, sill, head = o['id'], _kind(o), room.opening_centre(o), o['width'], o['sill'], o['head']
        half = width / 2
        c0, c1 = int((centre - half) * SRC_PPM), int(np.ceil((centre + half) * SRC_PPM))
        c0, c1 = max(c0, 0), min(c1, Wd)
        U = cols[c0:c1][None, :]
        V = rows[:, None]
        if o['headShape'] == 'segmental':
            inside = (V >= sill) & (V <= _top('segmental', centre, width, head, o['headRise'], U))
        else:
            inside = (V >= sill) & (V <= top_at(kind, centre, width, head, U))
        region = (slice(None), slice(c0, c1))
        d = Dm[region]
        if o['glazing'] == 'clear':
            deepest = np.nanpercentile(np.where(inside, d, np.nan), 3)
            front = np.nanpercentile(np.where(inside, d, np.nan), 60)
            separated = front - deepest > 0.12
            cut = (front + deepest) / 2
            colour_glass = cool[region] > -0.05
            g_mask = inside & colour_glass & ((d < cut) if separated else True)
            # Clean: drop specks (curtain folds in shadow), close the glazing bars,
            # then keep one run per row — the glazing between the curtains — with
            # its edges smoothed up the window.
            g_mask = morph(morph(g_mask, 'shrink', 5), 'grow', 5)
            g_mask = morph(morph(g_mask, 'grow', 7), 'shrink', 7) & inside
            sash = _sash(o)
            bounds = ((centre - sash) * SRC_PPM - c0, (centre + sash) * SRC_PPM - c0)
            g_mask = row_intervals(g_mask, bounds) & inside
            glass[region] |= g_mask
            glass_depth[oid] = float(np.median(d[g_mask])) if separated else None
            print(oid, 'front', round(float(front), 3), 'deepest', round(float(deepest), 3), 'separated', bool(separated), 'glass px', int(g_mask.sum()))
            relief[oid] = (kind, centre, width, sill, head, region, inside, g_mask, None)
            report[oid] = dict(wall=wall['id'], glazing='clear', method='colour', separated=bool(separated),
                               glassDepth=glass_depth[oid], pixels=int(g_mask.sum()))
            continue
        # Geometric glass (B10): the measured outline, planes and bars.
        gl = o['glass']
        g_mask, pd, ginside, bars = geometric_glass(o, D[region], Dm[region], V, U, centre, morph)
        glass[region] |= g_mask
        glass_depth[oid] = -float(gl['planes'][0]['depth'])
        print(oid, o['glazing'], 'planes', [p['depth'] for p in gl['planes']], 'glass px', int(g_mask.sum()), 'of outline', int((ginside & ~bars).sum()))
        relief[oid] = (kind, centre, width, sill, head, region, inside, g_mask, pd)
        report[oid] = dict(wall=wall['id'], glazing=o['glazing'], method='outline', planes=gl['planes'],
                           bars=gl.get('bars', []), frostedBelow=gl.get('frostedBelow'), pixels=int(g_mask.sum()),
                           outlinePixels=int((ginside & ~bars).sum()))
        if o['glazing'] != 'sheer':
            check = measure_planes(gl, D[region], V, ginside, bars)
            report[oid]['scan'] = check
            for line in check['disagreements']:
                print(f"WARNING {oid}: {line}")
    np.save(f"proj/{wall['name']}-glass.npy", glass)
    layered = np.full(D.shape, np.nan, np.float32)
    for oid, (kind, centre, width, sill, head, region, inside, g_mask, pd) in relief.items():
        # Two layers, as the scan has them: the curtains (and columns, and
        # blind plaster) on their own smoothed depths, the glazing flat at
        # its measured depth behind them, eased into each other over a few
        # centimetres along the glass mask's clean edge.
        d = Dm[region]
        front_layer = fill_from(np.where(inside & ~g_mask, d, np.nan))
        front_layer = blur(median(front_layer, 9, *RANGE), 6)
        if pd is not None:
            glass_at = pd                               # each row's own plane
        else:
            twin = twins.get(oid)
            glass_at = glass_depth[oid] if glass_depth.get(oid) is not None else glass_depth.get(twin) if twin is not None else None
            if glass_at is None:
                glass_at = float(np.nanpercentile(np.where(inside, d, np.nan), 3))
        soft = blur(g_mask.astype(np.float32), 5)
        d = front_layer * (1 - soft) + glass_at * soft
        d = np.minimum(d, -0.02)
        layered[region] = np.where(inside, d, layered[region])
    np.save(f"proj/{wall['name']}-layered.npy", layered)


def run(room):
    report = {}
    walls = room.glazed_walls()
    glazed = {w['name'] for w in walls}
    for wall in room.walls:                    # masks of walls that no longer have glazing
        for suffix in ('glass', 'layered'):
            stale = f"proj/{wall['name']}-{suffix}.npy"
            if wall['name'] not in glazed and os.path.exists(stale):
                os.remove(stale)
                print('removed stale', stale)
    for wall in walls:
        run_wall(room, wall, report)
    disagreements = [f"{oid}: {line}" for oid, r in report.items() for line in r.get('scan', {}).get('disagreements', [])]
    os.makedirs('build', exist_ok=True)
    with open('build/glass.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(dict(walls=[w['id'] for w in walls], inputsDigest=inputs_digest(room), openings=report,
                       disagreements=disagreements), f, indent=1)
    if not walls:
        print('no glazed windows')


def glass_walls(room):
    """Names of the walls whose glass mask and layered depth the windows step wrote from this
    config's facts (build/glass.json). Refuses a missing record, a record made from other facts,
    or a listed file that is not there."""
    path = 'build/glass.json'
    if not os.path.exists(path):
        raise SystemExit('build/glass.json is missing: run the windows step first')
    with open(path, encoding='utf-8') as f:
        record = json.load(f)
    if record.get('inputsDigest') != inputs_digest(room):
        raise SystemExit('the windows, walls or wall views changed since the windows step: rerun from `windows` '
                         '(from `project` when a window uses the clear colour test)')
    names = [room.wmap[i]['name'] for i in record['walls']]
    for name in names:
        for suffix in ('glass', 'layered'):
            if not os.path.exists(f"proj/{name}-{suffix}.npy"):
                raise SystemExit(f"build/glass.json lists wall {name} but proj/{name}-{suffix}.npy is missing: rerun from `windows`")
    return set(names)

"""Projects the station panoramas onto each wall's orthographic position tiles.

Without --labels: every station that saw a texel contributes, weighted towards near and head-on
views (project.py's blend).

With --labels (the published build): each texel takes its colour from one station, the label
label-views.py chose for its 40 mm block (the next station in the block's ranking where that one
did not see the texel), sampled at the scanned relief:
  - every texel is sampled 2 x 2 times, a 2.5 mm orthophoto (proj/<view>.fine.npz, sRGB) that
    pack-atlas.py reduces to the atlas in one Lanczos step (the 5 mm orthophoto, the 2 x 2 mean,
    is written as before for window-relief.py);
  - the stations' colours are levelled with Waechter, Moehrle and Goesele's global adjustment
    (2014): a colour offset per station at every block corner, solved by least squares so the
    stations meeting at a seam agree there while each offset varies smoothly within its patch;
  - what still differs along a seam is spread into both sides by a local Poisson blend: a
    membrane in a three-block band, half the remaining step at the seam, nothing at the band's
    edge (Perez, Gangnet and Blake 2003, as Waechter et al.'s local step), solved in strips;
  - the seams are feathered over one block.
label-views.py also records the depth where each block's best views agree; sampling there
(--depth-offsets) read fewer of the deacon boards' names than the relief (26.6% against 31.6% on
the end wall) and lifted cornices' lit edges onto the panelling above, so it is for measuring only.
Writes the same proj/<view>.npz files (linear colour, weight, coverage) as the blend, so
window-relief.py and pack-atlas.py read either, and proj/composite-<wall>.json (seam steps,
adjustments, memory, timings). Peak memory about 1.2 GB (the window wall).

Usage (in the work directory): python3 $SURVEY/project-walls.py <window|door|end|fire>
    [--labels [--no-global] [--no-local] [--levelling offset|gain] [--depth-offsets [--depth-clip LO HI]]]
    [--data DIR] [--out proj]
(--no-global, --no-local, --levelling gain and --depth-offsets are for measuring what a step does.)"""
import argparse
import json
import os
import sys
import time
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import load_views, project, stations  # noqa: E402

NORMALS = {'window': (0, 1, 0), 'door': (0, -1, 0), 'end': (1, 0, 0), 'fire': (-1, 0, 0)}


def blend(wall):
    views = [v for v in load_views('views-walls.json') if v['wall'] == wall]
    t0 = time.time()
    tiles = []
    pts_all = []
    for v in views:
        w, h = v['pixels']
        P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1]
        valid = P[..., 3] > 0.5
        tiles.append((v, valid))
        pts_all.append(P[valid][:, :3].astype(np.float64))
    pts = np.concatenate(pts_all)
    nrm = np.tile(np.array([NORMALS[wall]], float), (len(pts), 1))
    rgb, ws = project(pts, nrm, stations())
    offset = 0
    for (v, valid), p in zip(tiles, pts_all):
        w, h = v['pixels']
        img = np.zeros((h, w, 3), np.float32)
        img[valid] = rgb[offset:offset + len(p)]
        weight = np.zeros((h, w), np.float32)
        weight[valid] = ws[offset:offset + len(p)]
        offset += len(p)
        np.savez_compressed(f"proj/{v['name']}.npz", rgb=img, weight=weight, valid=valid)
    print(wall, 'texels', len(pts), 'uncovered', int((ws == 0).sum()), round(time.time() - t0, 1), 's', flush=True)


# ------------------------------------------------------------------ best view

FEATHER = 8          # texels: seams are feathered over one block
BAND = 24            # texels: the local Poisson blend's band on each side of a seam (three blocks)
SEAM_SIGMA = 4.0     # texels: the remaining step is smoothed along the seam over half a block
SMOOTH_W = 10.0      # Waechter's 1/lambda: weight of an offset's change along a block edge
REG_W = 1e-3         # keeps every offset defined (and near 0) where no seam constrains it
CAUCHY_LEVELS = 4.0  # seam residual (sRGB levels) at which a seam's weight halves
OFFSET_MAX = 48.0    # offsets are bounded to +-48 levels
LIGHT_MIN = 70.0     # gains: stations are compared only over blocks both see at least this light (sRGB levels)
LOG_EPS = 0.002      # gains: linear light added before the log
CAUCHY_LOG = 0.05    # gains: seam residual (about 5%) at which a seam's weight halves
GAIN_MAX = 1.3       # gains are bounded to 1/1.3..1.3
BAND_ROWS = 64       # texel rows per sampling band
FLAT_STD = 12.0      # sRGB levels: blocks flat enough to compare two views' colours
# a texel's four 2.5 mm sub-samples (offsets down and along u, in texels), in the fine orthophoto's
# order: row 2r + i, column 2c + j for (i, j) = (0, 0), (0, 1), (1, 0), (1, 1)
SUBS2 = ((-0.25, -0.25), (-0.25, 0.25), (0.25, -0.25), (0.25, 0.25))


def upsample_blocks(a, H, Wd):
    """Bilinear from block centres to texel centres (clamped at the edges)."""
    from bestview import BLOCK
    nby, nbx = a.shape[:2]
    y = np.clip((np.arange(H) + 0.5) / BLOCK - 0.5, 0, nby - 1)
    x = np.clip((np.arange(Wd) + 0.5) / BLOCK - 0.5, 0, nbx - 1)
    y0 = np.minimum(np.floor(y).astype(int), nby - 2 if nby > 1 else 0); x0 = np.minimum(np.floor(x).astype(int), nbx - 2 if nbx > 1 else 0)
    y1 = np.minimum(y0 + 1, nby - 1); x1 = np.minimum(x0 + 1, nbx - 1)
    ty = (y - y0).astype(np.float32)[:, None]; tx = (x - x0).astype(np.float32)[None, :]
    if a.ndim == 3:
        ty = ty[..., None]; tx = tx[..., None]
    top = a[y0][:, x0] * (1 - tx) + a[y0][:, x1] * tx
    bot = a[y1][:, x0] * (1 - tx) + a[y1][:, x1] * tx
    return (top * (1 - ty) + bot * ty).astype(np.float32)


def corners_to_texels(g, r, c):
    """Bilinear from block corners (nby + 1, nbx + 1, 3) to texels (r, c)."""
    from bestview import BLOCK
    y = (r + 0.5) / BLOCK
    x = (c + 0.5) / BLOCK
    i0 = np.floor(y).astype(int); j0 = np.floor(x).astype(int)
    ty = (y - i0)[:, None].astype(np.float32); tx = (x - j0)[:, None].astype(np.float32)
    return (g[i0, j0] * (1 - tx) + g[i0, j0 + 1] * tx) * (1 - ty) + (g[i0 + 1, j0] * (1 - tx) + g[i0 + 1, j0 + 1] * tx) * ty


def global_adjustment(label, rgb, cover, flat, model='offset'):
    """Waechter et al.'s global colour adjustment on the block-corner grid: unknown offsets
    g(corner, station), in sRGB levels, for the corners of every block a station labels; at each
    corner where stations meet, (C_a + g_a) - (C_b + g_b) -> 0; along every block edge, an offset
    changes little within its station's patch (weight SMOOTH_W). C_a - C_b is measured over the
    corner's blocks that both stations saw whole and that are flat (`flat`: little texture, no step
    in the relief), where a few millimetres of misregistration between the two views cannot pass
    for a colour difference; and the seams are re-weighted (Cauchy, CAUCHY_LEVELS, five rounds), so
    a corner whose two views disagree for another reason (glare, parallax) does not pull a whole
    patch. Offsets are bounded to OFFSET_MAX levels.
    Additive offsets in the panoramas' sRGB encoding, as in the paper: tried as gains in linear
    light (exposure and white balance multiply light), the seams' disagreement was mostly glare,
    which adds light, and on dark varnish it read as a doubled or halved exposure: 41% of the gains
    met a 1.5x bound and flat seams were left twice as far apart.
    Returns {station: (nby + 1, nbx + 1, 3) offsets, NaN where undefined} and a summary."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import factorized
    import bestview as B
    nby, nbx = label.shape
    S = rgb.shape[0]
    gain = model == 'gain'
    values = np.log(B.to_linear(rgb) + LOG_EPS) if gain else rgb
    light = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)) >= LIGHT_MIN if gain else np.ones(rgb.shape[:3], bool)
    has = label >= 0
    bi, bj = np.nonzero(has)
    lab = label[bi, bj].astype(np.int64)
    corners = [(bi, bj), (bi, bj + 1), (bi + 1, bj), (bi + 1, bj + 1)]
    keys = np.concatenate([(ci * (nbx + 1) + cj) * S + lab for ci, cj in corners])
    uk, inv = np.unique(keys, return_inverse=True)
    n = len(uk)
    vid = inv.reshape(4, -1)                      # unknown index of each block's 4 corners
    # smoothness along the four edges of every labelled block (unique edges per station)
    edges = np.concatenate([np.stack([vid[0], vid[1]], 1), np.stack([vid[2], vid[3]], 1),
                            np.stack([vid[0], vid[2]], 1), np.stack([vid[1], vid[3]], 1)])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    # seams: at every corner, each pair of stations that label one of its blocks
    corner_of = uk // S
    station_of = uk % S
    order = np.argsort(corner_of, kind='stable')
    cs = corner_of[order]
    starts = np.flatnonzero(np.r_[True, cs[1:] != cs[:-1]])
    ends = np.r_[starts[1:], len(cs)]
    multi = (ends - starts) >= 2
    pa, pb, diffs = [], [], []
    for s0, s1 in zip(starts[multi], ends[multi]):
        ids = order[s0:s1]
        ci, cj = divmod(int(corner_of[ids[0]]), nbx + 1)
        blocks = [(i, j) for i in (ci - 1, ci) for j in (cj - 1, cj) if 0 <= i < nby and 0 <= j < nbx and has[i, j] and flat[i, j]]
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                a, b = int(station_of[ids[x]]), int(station_of[ids[y]])
                common = [(i, j) for i, j in blocks if cover[a, i, j] >= 0.9 and cover[b, i, j] >= 0.9 and light[a, i, j] and light[b, i, j]]
                if not common:
                    continue
                ii = np.array([i for i, _ in common]); jj = np.array([j for _, j in common])
                pa.append(ids[x]); pb.append(ids[y])
                diffs.append((values[b, ii, jj] - values[a, ii, jj]).mean(axis=0))
    m = len(edges)
    k = len(pa)
    pa = np.array(pa, np.int64); pb = np.array(pb, np.int64)
    diffs = np.array(diffs, np.float64).reshape(k, 3)
    sw = np.sqrt(SMOOTH_W)
    luma = np.array([0.2126, 0.7152, 0.0722])
    wseam = np.ones(k)
    g = np.zeros((n, 3))
    resid = np.zeros(k)
    for _ in range(5):
        rows = np.concatenate([np.arange(m), np.arange(m), m + np.arange(k), m + np.arange(k), m + k + np.arange(n)])
        cols = np.concatenate([edges[:, 0], edges[:, 1], pa, pb, np.arange(n)])
        sq = np.sqrt(wseam)
        vals = np.concatenate([np.full(m, sw), np.full(m, -sw), sq, -sq, np.full(n, np.sqrt(REG_W))])
        A = coo_matrix((vals, (rows, cols)), shape=(m + k + n, n)).tocsc()
        b = np.concatenate([np.zeros((m, 3)), diffs * sq[:, None], np.zeros((n, 3))])
        solve = factorized((A.T @ A).tocsc())
        g = np.stack([solve(A.T @ b[:, ch]) for ch in range(3)], -1)
        del solve, A
        resid = ((g[pa] - g[pb]) - diffs) @ luma
        wseam = 1.0 / (1.0 + (resid / (CAUCHY_LOG if gain else CAUCHY_LEVELS)) ** 2)
    bound = float(np.log(GAIN_MAX)) if gain else OFFSET_MAX
    bounded = int((np.abs(g) > bound).any(axis=1).sum())
    g = np.clip(g, -bound, bound).astype(np.float32)
    out = {}
    for s in np.unique(station_of):
        grid = np.full((nby + 1, nbx + 1, 3), np.nan, np.float32)
        sel = station_of == s
        ci, cj = np.divmod(corner_of[sel], nbx + 1)
        grid[ci, cj] = g[sel]
        out[int(s)] = grid
    absg = np.abs(g @ luma.astype(np.float32))
    seam_l = np.abs(diffs @ luma)
    unit = (lambda x: round(100 * float(np.expm1(x)), 1)) if gain else (lambda x: round(float(x), 2))
    return out, dict(model='gains in linear light, from light blocks' if gain else 'additive sRGB levels', units='percent' if gain else 'sRGB levels',
                     unknowns=int(n), seam_equations=int(k),
                     seam_step_median=unit(np.median(seam_l)) if k else None,
                     seam_residual_median=unit(np.median(np.abs(resid))) if k else None,
                     seams_downweighted=int((wseam < 0.5).sum()) if k else 0, bounded=bounded,
                     correction_abs_median=unit(np.median(absg)), correction_abs_p95=unit(np.percentile(absg, 95)),
                     correction_abs_max=unit(absg.max()))


def filled_offsets(grid):
    """A station's corner offsets with the corners it does not label filled from the nearest it does."""
    from scipy import ndimage
    if grid is None:
        return None
    missing = np.isnan(grid[..., 0])
    if missing.all():
        return np.zeros_like(grid)
    if missing.any():
        _, (ii, jj) = ndimage.distance_transform_edt(missing, return_indices=True)
        grid = grid[ii, jj]
    return grid


def seam_neighbours(tl):
    """For each texel, the label of its first 4-neighbour (right, left, below, above) with another
    label, or -1."""
    H, Wd = tl.shape
    nb = np.full((H, Wd), -1, np.int16)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        other = np.full((H, Wd), -1, np.int16)
        ys = slice(max(dy, 0), H + min(dy, 0)); yd = slice(max(-dy, 0), H + min(-dy, 0))
        xs = slice(max(dx, 0), Wd + min(dx, 0)); xd = slice(max(-dx, 0), Wd + min(-dx, 0))
        other[yd, xd] = tl[ys, xs]
        take = (nb < 0) & (other >= 0) & (other != tl) & (tl >= 0)
        nb[take] = other[take]
    return nb


def box_feather(ind):
    """A label's indicator box-filtered over one block: a linear ramp of one block across its seams."""
    from scipy import ndimage
    return ndimage.uniform_filter(ind.astype(np.float32), size=FEATHER, mode='nearest')


def membrane(tl, valid, seam_has, dirichlet):
    """Local Poisson blend: p harmonic over each label's texels within BAND of a seam (texels
    coupled only to 4-neighbours of the same label), p = the seam value on seam texels and 0 beyond
    the band. Returns p (H, W, 3)."""
    from scipy import ndimage
    from scipy.sparse import coo_matrix, diags
    from scipy.sparse.linalg import cg
    H, Wd = tl.shape
    dist = ndimage.distance_transform_edt(~seam_has)
    free = (dist > 0) & (dist <= BAND) & (tl >= 0) & valid
    idx = np.full((H, Wd), -1, np.int64)
    n = int(free.sum())
    p = np.zeros((H, Wd, 3), np.float32)
    p[seam_has] = dirichlet[seam_has]
    if n == 0:
        return p, 0
    idx[free] = np.arange(n)
    deg = np.zeros(n)
    rows, cols = [], []
    rhs = np.zeros((n, 3))
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        ys = slice(max(dy, 0), H + min(dy, 0)); yd = slice(max(-dy, 0), H + min(-dy, 0))
        xs = slice(max(dx, 0), Wd + min(dx, 0)); xd = slice(max(-dx, 0), Wd + min(-dx, 0))
        a_free = free[yd, xd]
        same = (tl[yd, xd] == tl[ys, xs]) & valid[ys, xs] & a_free
        ia = idx[yd, xd][same]
        deg_add = np.zeros(n); np.add.at(deg_add, ia, 1.0); deg += deg_add
        nb_free = free[ys, xs][same]
        ib = idx[ys, xs][same]
        rows.append(ia[nb_free]); cols.append(ib[nb_free])
        # fixed neighbours: seam texels carry their value, texels beyond the band carry 0
        fixed_val = p[ys, xs][same][~nb_free]
        np.add.at(rhs, ia[~nb_free], fixed_val)
    r = np.concatenate(rows); c = np.concatenate(cols)
    Lm = coo_matrix((np.full(len(r), -1.0), (r, c)), shape=(n, n)).tocsr() + diags(deg + 1e-4)
    pre = diags(1.0 / (deg + 1e-4))
    out = np.zeros((n, 3))
    for ch in range(3):
        x, info = cg(Lm, rhs[:, ch], M=pre, rtol=1e-5, maxiter=3000)
        out[:, ch] = x
    p[free] = out.astype(np.float32)
    return p, n


STRIP = 1024         # texel columns per membrane solve
STRIP_MARGIN = 96    # columns solved on each side of a strip and discarded (four bands)


def membrane_strips(tl, valid, seam_has, dirichlet):
    """membrane() in strips of STRIP columns, each solved with STRIP_MARGIN columns either side and
    only its own columns kept: every free texel lies within BAND of a fixed value (its seam's, or 0
    beyond the band), so the solution's dependence on texels four bands away is far below a level.
    Solved whole, the window wall's band took a sparse system of 2 GB."""
    H, Wd = tl.shape
    p = np.zeros((H, Wd, 3), np.float32)
    for x0 in range(0, Wd, STRIP):
        x1 = min(x0 + STRIP, Wd)
        xa, xb = max(x0 - STRIP_MARGIN, 0), min(x1 + STRIP_MARGIN, Wd)
        q, _ = membrane(tl[:, xa:xb], valid[:, xa:xb], seam_has[:, xa:xb], dirichlet[:, xa:xb])
        p[:, x0:x1] = q[:, x0 - xa:x1 - xa]
        del q
    from scipy import ndimage
    dist = ndimage.distance_transform_edt(~seam_has)
    total = int(((dist > 0) & (dist <= BAND) & (tl >= 0) & valid).sum())
    return p, total


def station_band(B, grid, pano, omega, delta_t, y0, x0, b0, b1):
    """One band of a station's region: the 2 x 2 sub-sample colours (2.5 mm) of its texels where it
    carries weight. Returns (rows, cols, colours (n, 4, 3), weights, samples) or None."""
    depth, valid = grid.depth, grid.valid
    ry, rx = np.nonzero(omega[b0:b1] > 0)
    if not len(ry):
        return None
    r_abs = ry + b0 + y0
    c_abs = rx + x0
    dd0 = delta_t[r_abs, c_abs]
    col = np.empty((len(ry), 4, 3), np.float32)
    for k, (fr, fc) in enumerate(SUBS2):
        d = B.sub_depth(depth, valid, r_abs, c_abs, np.float32(fr), np.float32(fc)) + dd0
        col[:, k] = pano.rgb(grid.points(r_abs, c_abs, d, fr, fc))
    return r_abs, c_abs, col, omega[b0:b1][ry, rx], 4 * len(ry)


def block_flatness(grid, lb, label):
    """Blocks where a colour comparison between two views is fair: the relief steps less than 1 cm
    inside the block and its label's luminance spreads less than FLAT_STD."""
    import bestview as B
    H, Wd = grid.depth.shape
    nby, nbx = B.blocks_shape(H, Wd)
    d = np.pad(np.where(grid.valid, grid.depth, np.nan), ((0, nby * B.BLOCK - H), (0, nbx * B.BLOCK - Wd)), constant_values=np.nan)
    d = d.reshape(nby, B.BLOCK, nbx, B.BLOCK)
    span = np.nanmax(d, axis=(1, 3)) - np.nanmin(d, axis=(1, 3))
    lum = lb['rgb'] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    var = np.maximum(lb['lum2'] - lum ** 2, 0)
    lab = np.where(label >= 0, label, 0)
    std = np.sqrt(np.take_along_axis(var, lab[None], 0)[0])
    return (span < 0.01) & (std < FLAT_STD) & (label >= 0)


def best_view(args):
    import bestview as B
    from concurrent.futures import ThreadPoolExecutor
    from scipy import ndimage
    warnings.filterwarnings('ignore', category=RuntimeWarning)
    B.below_normal_priority()
    B.use_data(args.data)
    wall = args.wall
    t0 = time.time()
    lb = np.load(os.path.join(args.out, f'labels-{wall}.npz'))
    ids = [str(x) for x in lb['stations']]
    sts = {s['id']: s for s in B.P.stations()}
    label = lb['label'].astype(np.int64)
    tl = lb['texel_label'].astype(np.int16)
    visbits = lb['visbits']
    grid = B.Grid(wall)
    depth, valid = grid.depth, grid.valid
    H, Wd = depth.shape
    delta_b = lb['delta'] if args.depth_offsets else np.zeros_like(lb['delta'])
    if args.depth_offsets and args.depth_clip is not None:
        delta_b = np.clip(delta_b, args.depth_clip[0] / 1000, args.depth_clip[1] / 1000)
    delta_t = upsample_blocks(delta_b, H, Wd)
    flat = block_flatness(grid, lb, label)
    mem0 = (B.mem_mb(), B.peak_mb())
    if args.no_global:
        offsets, gsum = {}, dict(skipped=True)
    else:
        offsets, gsum = global_adjustment(label, lb['rgb'], lb['cover'].astype(np.float32), flat, model=args.levelling)
    t1 = time.time()
    mem = dict(before_adjust=list(mem0), after_adjust=[B.mem_mb(), B.peak_mb()])
    used = [int(s) for s in np.unique(tl[tl >= 0])]
    nbl = seam_neighbours(tl)
    seam = nbl >= 0
    A = np.zeros((H, Wd, 4, 3), np.float32)        # weighted colour of each texel's four 2.5 mm sub-samples
    Wt = np.zeros((H, Wd), np.float32)
    own_w = np.zeros((H, Wd), np.float32)
    # on seam texels: the adjusted colour of the texel's own station and of its neighbour's station,
    # and their luminances before adjustment (for the seam report)
    slot = np.full((H, Wd), -1, np.int32)
    ns = int(seam.sum())
    slot[seam] = np.arange(ns, dtype=np.int32)
    own_c = np.full((ns, 3), np.nan, np.float32)
    other_c = np.full((ns, 3), np.nan, np.float32)
    own_raw = np.full(ns, np.nan, np.float32)
    other_raw = np.full(ns, np.nan, np.float32)
    sampled = 0
    # one band at a time: the bands of a station are memory-bound, and threads only contended (4 threads
    # took four times as long as one on the end wall)
    with ThreadPoolExecutor(1) as pool:
        for s in used:
            B.wait_while_quiet()
            ts = time.time()
            ind = tl == s
            rr, cc = np.nonzero(ind)
            y0, y1 = max(rr.min() - FEATHER, 0), min(rr.max() + FEATHER + 1, H)
            x0, x1 = max(cc.min() - FEATHER, 0), min(cc.max() + FEATHER + 1, Wd)
            vis = B.unpack_bits(visbits[s, y0:y1], Wd)[:, x0:x1] & valid[y0:y1, x0:x1]
            omega = box_feather(ind[y0:y1, x0:x1]) * vis
            support = omega > 0
            g = filled_offsets(offsets.get(s))
            pano = B.Pano(sts[ids[s]])
            bands = [b0 for b0 in range(0, y1 - y0, BAND_ROWS) if support[b0:b0 + BAND_ROWS].any()]
            results = pool.map(lambda b0: station_band(B, grid, pano, omega, delta_t, y0, x0, b0, min(b0 + BAND_ROWS, y1 - y0)), bands)
            for res in results:
                if res is None:
                    continue
                R, C, D4, wv, nsub = res
                sampled += nsub
                if g is None:
                    D4a = D4
                elif args.levelling == 'gain':
                    D4a = B.to_srgb(B.to_linear(D4) * np.exp(corners_to_texels(g, R, C))[:, None, :])
                else:
                    D4a = D4 + corners_to_texels(g, R, C)[:, None, :]
                A[R, C] += D4a * wv[:, None, None]
                Dd = D4.mean(axis=1)
                col = D4a.mean(axis=1)
                Wt[R, C] += wv
                mine = tl[R, C] == s
                own_w[R[mine], C[mine]] = wv[mine]
                sl = slot[R, C]
                sel = (sl >= 0) & mine
                own_c[sl[sel]] = col[sel]
                own_raw[sl[sel]] = Dd[sel] @ B.LUMA
                sel = (sl >= 0) & (nbl[R, C] == s)
                other_c[sl[sel]] = col[sel]
                other_raw[sl[sel]] = Dd[sel] @ B.LUMA
            pano.close()
            print(f'  {ids[s]}: {int(ind.sum())} texels, {time.time() - ts:.1f} s', flush=True)
    t2 = time.time()
    mem['after_sampling'] = [B.mem_mb(), B.peak_mb()]
    # local Poisson blend of what the global adjustment left at the seams. The step is oriented from
    # the lower station index to the higher, so both sides of a seam smooth the same quantity.
    ok_j = np.isfinite(own_c[:, 0]) & np.isfinite(other_c[:, 0])
    sy, sx = np.nonzero(seam)
    sign = np.where(tl[sy, sx] < nbl[sy, sx], 1.0, -1.0).astype(np.float32)
    has_j = np.zeros((H, Wd), bool)
    has_j[sy[ok_j], sx[ok_j]] = True
    gm = ndimage.gaussian_filter(has_j.astype(np.float32), SEAM_SIGMA)
    Js = np.zeros((H, Wd, 3), np.float32)
    sgn = np.zeros((H, Wd), np.float32)
    sgn[sy, sx] = sign
    for ch in range(3):
        J = np.zeros((H, Wd), np.float32)
        J[sy[ok_j], sx[ok_j]] = (other_c[ok_j, ch] - own_c[ok_j, ch]) * sign[ok_j]
        Js[..., ch] = np.where(has_j, ndimage.gaussian_filter(J, SEAM_SIGMA) / np.maximum(gm, 1e-6) * sgn, 0)
    del gm, J
    if args.no_local:
        p, nfree = np.zeros((H, Wd, 3), np.float32), 0
        Js[:] = 0
    else:
        p, nfree = membrane_strips(tl, valid, has_j, Js / 2)
    mem['after_poisson'] = [B.mem_mb(), B.peak_mb()]
    # the other stations feathered into a texel take their own side's seam value
    feathered = (Wt - own_w) > 1e-6
    ni, nj = ndimage.distance_transform_edt(~has_j, return_distances=False, return_indices=True)
    fy, fx = np.nonzero(feathered)
    near = Js[ni[fy, fx], nj[fy, fx]]
    same_side = tl[ni[fy, fx], nj[fy, fx]] == tl[fy, fx]
    del ni, nj
    A += (own_w[..., None] * p)[:, :, None, :]
    A[fy, fx] += ((Wt - own_w)[fy, fx, None] * np.where(same_side[:, None], -near / 2, near / 2))[:, None, :]
    A /= np.maximum(Wt, 1e-6)[..., None, None]
    np.clip(A, 0, 255, out=A)
    covered = Wt > 0
    t3 = time.time()
    # seam report: luminance steps between the two stations at their seam texels, per 40 mm of seam
    luma = np.array([0.2126, 0.7152, 0.0722], np.float32)
    seg_all = (sy // B.BLOCK) * (Wd // B.BLOCK + 1) + sx // B.BLOCK

    flat_seam = flat[np.minimum(sy // B.BLOCK, flat.shape[0] - 1), np.minimum(sx // B.BLOCK, flat.shape[1] - 1)]

    def steps(a, b, only_flat=False):
        sel = ok_j & np.isfinite(a) & np.isfinite(b) & (flat_seam if only_flat else True)
        seg = seg_all[sel]
        da = np.bincount(seg, a[sel]); db = np.bincount(seg, b[sel]); cnt = np.bincount(seg)
        k = cnt > 0
        step = np.abs(da[k] - db[k]) / np.maximum((da[k] + db[k]) / 2, 1.0)
        return dict(segments=int(k.sum()), median=round(float(np.median(step)), 4), p90=round(float(np.percentile(step, 90)), 4)) if k.any() else {}
    ps = p[sy, sx]
    jss = Js[sy, sx]
    fo, ft = (own_c + ps) @ luma, (other_c - jss / 2) @ luma
    seams = dict(raw=steps(own_raw, other_raw), after_global=steps(own_c @ luma, other_c @ luma), after_local=steps(fo, ft),
                 flat_raw=steps(own_raw, other_raw, True), flat_after_global=steps(own_c @ luma, other_c @ luma, True), flat_after_local=steps(fo, ft, True))
    del p, Js, own_c, other_c, own_raw, other_raw, ps, jss, fo, ft, slot, nbl
    mem['before_output'] = [B.mem_mb(), B.peak_mb()]
    x = 0
    for v in B.wall_tiles(wall):
        w, h = v['pixels']
        sl = slice(x, x + w)
        vt = valid[:, sl]
        cv = vt & covered[:, sl]
        lin = np.zeros((h, w, 3), np.float32)
        fine = np.zeros((2 * h, 2 * w, 3), np.uint8)
        for r0 in range(0, h, BAND_ROWS):              # in bands: no whole-tile float64 temporaries
            r1 = min(r0 + BAND_ROWS, h)
            a = A[r0:r1, sl]                            # (rows, w, 4, 3) sRGB
            lin[r0:r1] = np.where(vt[r0:r1, :, None], B.to_linear(a).mean(axis=2), 0)
            f = np.round(a).astype(np.uint8).reshape(r1 - r0, w, 2, 2, 3).transpose(0, 2, 1, 3, 4).reshape(2 * (r1 - r0), 2 * w, 3)
            fine[2 * r0:2 * r1] = np.where(np.repeat(np.repeat(cv[r0:r1], 2, axis=0), 2, axis=1)[..., None], f, 0)
        np.savez_compressed(os.path.join(args.out, f"{v['name']}.npz"), rgb=lin,
                            weight=np.where(cv, Wt[:, sl], 0).astype(np.float32), valid=vt)
        del lin
        fv = np.repeat(np.repeat(cv, 2, axis=0), 2, axis=1)
        np.savez_compressed(os.path.join(args.out, f"{v['name']}.fine.npz"), rgb8=fine, valid=fv)
        del fine, fv
        x += w
    mem['after_output'] = [B.mem_mb(), B.peak_mb()]
    rep = dict(wall=wall, stations_used=len(used), sub_samples=int(sampled), texels_valid=int(valid.sum()),
               texels_coloured=int((covered & valid).sum()), flat_blocks=int(flat.sum()), global_adjustment=gsum, poisson_free_texels=int(nfree),
               seam_luminance_step=seams, params=dict(feather=FEATHER, band=BAND, seam_sigma=SEAM_SIGMA, smooth_w=SMOOTH_W, reg_w=REG_W, flat_std=FLAT_STD,
                                                      no_global=bool(args.no_global), no_local=bool(args.no_local), levelling=args.levelling,
                                                      depth_offsets=bool(args.depth_offsets), depth_clip_mm=args.depth_clip),
               seconds=dict(adjust=round(t1 - t0, 1), sample=round(t2 - t1, 1), poisson=round(t3 - t2, 1), total=round(time.time() - t0, 1)), memory_mb=mem, peak_mb=B.peak_mb())
    with open(os.path.join(args.out, f'composite-{wall}.json'), 'w') as f:
        json.dump(rep, f, indent=1)
    print(json.dumps(dict(seams=seams, global_adjustment=gsum, coloured=rep['texels_coloured'], valid=rep['texels_valid'], seconds=rep['seconds'], peak_mb=rep['peak_mb'])), flush=True)


def main():
    a = argparse.ArgumentParser()
    a.add_argument('wall', choices=list(NORMALS))
    a.add_argument('--labels', action='store_true')
    a.add_argument('--data', default='data')
    a.add_argument('--out', default='proj')
    a.add_argument('--no-global', action='store_true', help='diagnostic: skip the global colour adjustment')
    a.add_argument('--no-local', action='store_true', help='diagnostic: skip the local Poisson blend')
    a.add_argument('--levelling', choices=['offset', 'gain'], default='offset', help="the global adjustment as sRGB offsets (Waechter et al.'s; default) or, diagnostic, gains in linear light")
    a.add_argument('--depth-offsets', action='store_true', help="diagnostic: sample at label-views.py's photo-consistent depth offsets instead of the relief")
    a.add_argument('--depth-clip', type=float, nargs=2, default=None, metavar=('LO_MM', 'HI_MM'), help='with --depth-offsets: bound them (millimetres)')
    args = a.parse_args()
    if args.labels:
        best_view(args)
    else:
        blend(args.wall)


if __name__ == '__main__':
    main()

"""Chooses, for every 40 mm block of a wall, the station whose panorama photographed it most sharply
(its label), and the depth at which the best views of it agree. project-walls.py --labels then
colours the wall from those labels.

1. Statistics. Every station in front of the wall is tested texel by texel as project.py tests it
   (in front of the surface, nearer than 16 m, clear of the chandeliers, nothing nearer in its
   distance cubemap). Per block: the share of the block it saw, its mean colour (one sample a
   texel), its local Laplacian energy (mean |Laplacian| of luminance sampled at 2.5 mm, 2 x 2 a
   texel) and the projected size of a panorama pixel there (distance x pixel angle / cos incidence).
2. Rejection. Among the stations that saw at least 95% of a block: an occluder the depth maps
   missed shows as a view darker than the block's darker views, or of another hue, by more than
   project.py's consensus tolerance (glare lifts many views of varnish, so the plain consensus made
   the few clear views look like outliers); glare as a luminance more than 2.5 median absolute
   deviations above the median view (the deviation floored at 1.5 levels + 6%, so exposure
   differences on matte walls do not trip it).
3. Labels. Data cost = log(best score / score) + glare lift, score = Laplacian energy x (2 mm / pixel
   size), its log averaged over the blocks around (Gaussian, one block): the measured sharpness of
   the station's view of the region, weighted towards near, head-on views. Glare is a smooth veil
   the Laplacian does not see, so a view also pays GLARE_W for each unit it is brighter than the
   block's darker quarter of views, beyond GLARE_FREE. Smoothness: a Potts cost between 4-neighbour
   blocks, halved where the relief steps between them (a board's or frame's edge, where a seam
   hides; a seam through lettering is the worst place for one). Minimised by alpha-expansion
   (Boykov, Veksler and Zabih 2001) with SciPy's max-flow (Dinic); ICM from the best data term
   with three sweeps only if no max-flow is available.
4. Depth. For each textured block, the projection depth is swept from -1 to +5 cm along the wall's
   normal in 2 mm steps from the mesh's relief, sampling the block's three best stations at its
   64 texel centres; the depth where their exposure-normalised luminances agree best, refined
   between steps by a parabola, is fitted with a membrane weighted by how clear each minimum was,
   so the offset varies smoothly over the wall. It is recorded (delta, sweep_cost) as a measure of
   where the views agree; project-walls.py samples at the relief unless asked to use it, because
   with one station per block it bent lettering between blocks and lifted cornices' lit edges.

Memory stays under 1.5 GB: statistics run in bands of 64 texel rows (one row of overlap each side,
so the Laplacian is whole), the sweep in passes of at most 40,000 blocks, and one panorama is held
at a time. A station's bands run on SURVEY_THREADS threads (default 4) at below-normal priority, and
the run pauses between stations while the file SURVEY_PAUSE_FILE names exists.

Usage (in the work directory): python3 $SURVEY/label-views.py <window|door|end|fire>
    [--data DIR] [--out proj] [--region U0 U1 V0 V1] [--stats-cache FILE]
(--region and --stats-cache are for development: one part of a wall, statistics kept between runs.)
Writes <out>/labels-<wall>.npz and <out>/labels-<wall>.json."""
import argparse
import json
import os
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy import ndimage

warnings.filterwarnings('ignore', category=RuntimeWarning)   # all-NaN medians of blocks no station saw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bestview as B  # noqa: E402
P = B.P

COVER_MIN = 0.95          # a candidate saw at least this share of the block's texels
GLARE_MAD = 2.5           # glare: brighter than the consensus median by this many deviations
FOOT_REF_MM = 2.0
SCORE_SIGMA = 1.0         # blocks: a station's sharpness is judged over its view of the region
GLARE_W = 3.0             # data cost per unit of lift above the block's darker candidates
GLARE_FREE = 0.10         # lift within which views count as the same (matte walls, exposure, noise)
DEPTH_SMOOTH = 10.0       # the depth field's membrane weight between neighbouring blocks
POTTS = 1.2               # smoothness cost of a seam in uniform wall (data costs are log score ratios)
POTTS_EDGE = 0.5          # share of it left where the two blocks' colours differ strongly
EDGE_STEP = 0.01          # metres of relief step between blocks at which a seam costs ~POTTS_EDGE
D_MAX = 4.0               # data costs are clipped here (a 55x worse score)
SCALE = 1000              # integer capacities for the max-flow
RANKED = 6
DEPTHS = np.round(np.arange(-0.010, 0.0501, 0.002), 4)
K0 = int(np.argmin(np.abs(DEPTHS)))
TEXTURE_STD = 4.0         # sRGB levels of luminance spread that make a block worth sweeping
PASS_BLOCKS = 40000       # blocks per sweep pass
CHUNK = 64                # texel rows per band in the statistics


def parse():
    a = argparse.ArgumentParser()
    a.add_argument('wall', choices=list(B.WALLS))
    a.add_argument('--data', default='data')
    a.add_argument('--region', type=float, nargs=4, default=None, metavar=('U0', 'U1', 'V0', 'V1'))
    a.add_argument('--out', default='proj')
    a.add_argument('--stats-cache', default=None, help='development: reuse (or write) the statistics here')
    return a.parse_args()


def region_blocks(args, grid):
    H, Wd = grid.depth.shape
    nby, nbx = B.blocks_shape(H, Wd)
    if args.region is None:
        return 0, nby, 0, nbx
    ru0, ru1, rv0, rv1 = args.region
    c0 = int(np.floor(grid.col_at(ru0) / B.BLOCK)); c1 = int(np.ceil(grid.col_at(ru1) / B.BLOCK))
    r0 = int(np.floor(grid.row_at(rv1) / B.BLOCK)); r1 = int(np.ceil(grid.row_at(rv0) / B.BLOCK))
    return max(r0, 0), min(r1, nby), max(c0, 0), min(c1, nbx)


# ---------------------------------------------------------------- 1. statistics

SUBS = ((-0.25, -0.25), (-0.25, 0.25), (0.25, -0.25), (0.25, 0.25))


def band_stats(grid, st, cube, pano, r0, r1, C0, C1, nb_c0, nb_c1):
    """One band's per-block sums for one station (rows r0..r1, columns C0..C1)."""
    depth, valid = grid.depth, grid.valid
    H = depth.shape[0]
    e0, e1 = max(r0 - 1, 0), min(r1 + 1, H)
    rr, cc = np.nonzero(valid[e0:e1, C0:C1])
    if not len(rr):
        return None
    rr = rr + e0
    cc = cc + C0
    vis, dist, cos = B.visibility(st, cube, grid.points(rr, cc, depth[rr, cc]), grid.n)
    if not vis.any():
        return None
    rv, cv = rr[vis], cc[vis]
    inside = (rv >= r0) & (rv < r1)
    h, w = r1 - r0, C1 - C0
    ri, ci = rv[inside], cv[inside]
    col = pano.rgb(grid.points(ri, ci, depth[ri, ci]))
    he = e1 - e0
    dense = np.full((2 * he, 2 * w), np.nan, np.float32)
    for fr, fc in SUBS:
        dd = B.sub_depth(depth, valid, rv, cv, np.float32(fr), np.float32(fc))
        dense[2 * (rv - e0) + (fr > 0), 2 * (cv - C0) + (fc > 0)] = pano.lum(grid.points(rv, cv, dd, fr, fc))
    lp = np.full(dense.shape, np.nan, np.float32)
    lp[1:-1, 1:-1] = np.abs(4 * dense[1:-1, 1:-1] - dense[:-2, 1:-1] - dense[2:, 1:-1] - dense[1:-1, :-2] - dense[1:-1, 2:])
    k0 = 2 * (r0 - e0)
    lp = lp[k0:k0 + 2 * h].reshape(h, 2, w, 2).transpose(0, 2, 1, 3).reshape(h, w, 4)
    lok = np.isfinite(lp)
    a0, a1 = r0 // B.BLOCK, (r1 + B.BLOCK - 1) // B.BLOCK
    bnby, bnbx = a1 - a0, nb_c1 - nb_c0

    def bs(x):
        return B.block_sum(x, bnby, bnbx)

    t = np.zeros((h, w, 6), np.float32)
    t[ri - r0, ci - C0, 0] = 1
    t[ri - r0, ci - C0, 1:4] = col
    t[ri - r0, ci - C0, 4] = (col @ B.LUMA) ** 2
    t[ri - r0, ci - C0, 5] = (dist[vis] * B.PIX_RAD / cos[vis] * 1000.0)[inside]
    sums = bs(t)
    lap_sum = bs(np.where(lok, lp, 0).sum(axis=2))
    lap_n = bs(lok.sum(axis=2).astype(np.float32))
    return a0, a1, sums, lap_sum, lap_n, ri, ci


def statistics(grid, sts, rb):
    wall, depth, valid = grid.wall, grid.depth, grid.valid
    H, Wd = depth.shape
    nby, nbx = B.blocks_shape(H, Wd)
    br0, br1, bc0, bc1 = rb
    R0, R1 = br0 * B.BLOCK, min(br1 * B.BLOCK, H)
    C0, C1 = bc0 * B.BLOCK, min(bc1 * B.BLOCK, Wd)
    S = len(sts)
    cover = np.zeros((S, nby, nbx), np.float32)
    rgb = np.zeros((S, nby, nbx, 3), np.float32)
    lap = np.zeros((S, nby, nbx), np.float32)
    lum2 = np.zeros((S, nby, nbx), np.float32)
    foot = np.full((S, nby, nbx), np.inf, np.float32)
    visbits = np.zeros((S, H, (Wd + 7) // 8), np.uint8)
    nvalid = B.block_sum(valid.astype(np.float32), nby, nbx)
    bands = list(range(R0, R1, CHUNK))
    with ThreadPoolExecutor(B.threads()) as pool:
        for si, st in enumerate(sts):
            if not B.station_faces_wall(st, wall):
                continue
            B.wait_while_quiet()
            t0 = time.time()
            cube = P.load_depth(st['id'])
            pano = B.Pano(st)
            pano.lum16()
            vis_all = np.zeros((H, Wd), bool)
            results = list(pool.map(lambda r0: band_stats(grid, st, cube, pano, r0, min(r0 + CHUNK, R1), C0, C1, bc0, bc1), bands))
            seen = 0
            for res in results:
                if res is None:
                    continue
                a0, a1, sums, lap_sum, lap_n, ri, ci = res
                vis_all[ri, ci] = True
                seen += len(ri)
                nv = sums[..., 0]
                cover[si, a0:a1, bc0:bc1] = nv / np.maximum(nvalid[a0:a1, bc0:bc1], 1)
                rgb[si, a0:a1, bc0:bc1] = sums[..., 1:4] / np.maximum(nv, 1)[..., None]
                lum2[si, a0:a1, bc0:bc1] = sums[..., 4] / np.maximum(nv, 1)
                foot[si, a0:a1, bc0:bc1] = np.where(nv > 0, sums[..., 5] / np.maximum(nv, 1), np.inf)
                lap[si, a0:a1, bc0:bc1] = lap_sum / np.maximum(lap_n, 1)
            visbits[si] = B.pack_bits(vis_all)
            pano.close()
            print(f'  {st["id"]}: {seen} texels seen, {time.time() - t0:.1f} s', flush=True)
    return dict(cover=cover, rgb=rgb, lap=lap, lum2=lum2, foot=foot, visbits=visbits, nvalid=nvalid)


# ---------------------------------------------------------------- 2. rejection and labels

def srgb_to_lin(x):
    return P.srgb_to_linear(np.clip(x, 0, 255))


def candidates(stats):
    cover, rgb, lap, foot = stats['cover'], stats['rgb'], stats['lap'], stats['foot']
    lum = rgb @ B.LUMA
    covering = cover >= COVER_MIN
    # blocks no station saw whole fall back to the stations that saw most of them
    anyfull = covering.any(axis=0)
    best_cover = cover.max(axis=0)
    covering = np.where(anyfull[None], covering, (cover >= 0.5 * best_cover[None]) & (cover > 0))
    used = np.where(covering, lum, np.nan)
    med = np.nanmedian(used, axis=0)
    mad = np.nanmedian(np.abs(used - med[None]), axis=0)
    med_rgb = np.stack([np.nanmedian(np.where(covering, rgb[..., c], np.nan), axis=0) for c in range(3)], -1)
    floor = 1.5 + 0.06 * med
    glare = covering & (lum > (med + GLARE_MAD * np.maximum(mad, floor))[None])
    # Occluders the depth maps missed: project.py's consensus test on block means in linear light,
    # but against the darker half of the views (glare lifts many views of a varnished surface, and
    # against the plain consensus the few clear views looked like outliers) and only for views
    # darker than that or of another hue; a brighter view is glare's to judge.
    lin = srgb_to_lin(rgb)
    dark = covering & (lum <= med[None])
    ref = np.stack([np.nanmedian(np.where(dark, lin[..., c], np.nan), axis=0) for c in range(3)], -1)
    ref = np.where(np.isfinite(ref), ref, srgb_to_lin(np.nan_to_num(med_rgb)))
    dl = lin - ref[None]
    dlum = dl @ B.LUMA
    hue = np.abs(dl - dlum[..., None]).max(axis=-1)
    sigma = (0.03 + 0.3 * (ref @ B.LUMA))[None]
    occl = covering & ~glare & ((-dlum > 2 * sigma) | (hue > 2 * sigma))
    keep = covering & ~glare & ~occl
    # never leave a block without a candidate: keep the covering station nearest the consensus
    none = covering.any(axis=0) & ~keep.any(axis=0)
    if none.any():
        d = np.where(covering, np.abs(lum - med[None]), np.inf)
        pick = np.argmin(d, axis=0)
        ii, jj = np.nonzero(none)
        keep[pick[ii, jj], ii, jj] = True
    raw = lap * (FOOT_REF_MM / np.maximum(foot, 0.1))
    eps = 1e-3 * float(np.nanmedian(np.where(keep, raw, np.nan))) if keep.any() else 1e-6
    # A station's sharpness is a property of its view of a region more than of one block's content:
    # the log score is averaged over the blocks around (Gaussian, SCORE_SIGMA blocks) that it saw.
    logs = np.log(raw + eps)
    smooth = np.empty_like(logs)
    for s in range(logs.shape[0]):
        m = covering[s].astype(np.float32)
        if not m.any():
            smooth[s] = logs[s]
            continue
        num = ndimage.gaussian_filter(np.where(covering[s], logs[s], 0).astype(np.float32), SCORE_SIGMA)
        den = ndimage.gaussian_filter(m, SCORE_SIGMA)
        smooth[s] = np.where(den > 1e-3, num / np.maximum(den, 1e-6), logs[s])
    score = np.where(keep, np.exp(smooth), 0)
    best = np.where(keep, smooth, -np.inf).max(axis=0)
    # Glare only ever adds light, as a smooth veil the Laplacian does not see: a candidate brighter than
    # the block's darker candidates (their lower quartile) pays in proportion to the lift.
    ref = np.nanpercentile(np.where(keep, lum, np.nan), 25, axis=0)
    lift = np.clip((lum - ref[None]) / np.maximum(ref, 8.0)[None] - GLARE_FREE, 0, None)
    D = np.full(score.shape, np.inf)
    sharp = np.broadcast_to(best[None], score.shape)[keep] - smooth[keep]
    D[keep] = np.clip(sharp + GLARE_W * lift[keep], 0, D_MAX)
    # where glare changed the choice: the sharpest covering station was rejected as glare or paid for it
    sharpest = np.argmax(np.where(covering, smooth, -np.inf), axis=0)
    paid = np.where(covering, GLARE_W * lift, 0) > 0.5
    glare_changed = (np.take_along_axis(glare | paid, sharpest[None], 0)[0]) & covering.any(axis=0)
    return dict(D=D, keep=keep, covering=covering, glare=glare, occl=occl, score=score, med_rgb=med_rgb, med=med, mad=mad,
                glare_changed=glare_changed, lift=lift)


def potts_weights(grid, has):
    """The Potts cost of a seam between neighbouring blocks: POTTS on a flat wall, less where the
    relief steps between them (a board's or frame's edge), where a seam hides. (A seam through
    lettering is the worst place for one, so colour contrast does not lower it.)"""
    H, Wd = grid.depth.shape
    nby, nbx = has.shape
    n = B.block_sum(grid.valid.astype(np.float32), nby, nbx)
    mean = B.block_sum(np.where(grid.valid, grid.depth, 0).astype(np.float32), nby, nbx) / np.maximum(n, 1)

    def w(a, b, ha, hb):
        step = np.abs(a - b) / EDGE_STEP
        return np.where(ha & hb, POTTS * (POTTS_EDGE + (1 - POTTS_EDGE) * np.exp(-step ** 2)), 0.0)
    return w(mean[:, :-1], mean[:, 1:], has[:, :-1], has[:, 1:]), w(mean[:-1], mean[1:], has[:-1], has[1:])


def energy(Di, wr, wd, label):
    has = label >= 0
    lab = np.where(has, label, 0)
    e = int(np.where(has, np.take_along_axis(Di, lab[None], 0)[0], 0).sum())
    e += int((wr * (label[:, :-1] != label[:, 1:])).sum())
    e += int((wd * (label[:-1] != label[1:])).sum())
    return e


def expand(Di, wr, wd, label, a, big):
    """One alpha-expansion move: the labelling within one swap to `a` of the lowest energy, by a
    minimum cut (Kolmogorov and Zabih's construction; the Potts term is a metric, so the move's
    energy is submodular). Returns the new labelling, or None if no block can take `a`."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import maximum_flow, breadth_first_order
    ny, nx = label.shape
    free = (Di[a] < big) & (label != a) & (label >= 0)
    n = int(free.sum())
    if n == 0:
        return None
    idx = np.full((ny, nx), -1, np.int64)
    idx[free] = np.arange(n)
    lab = np.where(label >= 0, label, 0)
    U0 = np.take_along_axis(Di, lab[None], 0)[0][free].astype(np.int64)
    U1 = Di[a][free].astype(np.int64)
    rows, cols, caps = [], [], []

    def pairs(w, lp, lq, fp, fq, ip, iq):
        A = w * (lp != lq)
        Bc = w * (lp != a)          # x_p = 0, x_q = 1: labels (lp, a)
        C = w * (lq != a)           # x_p = 1, x_q = 0: labels (a, lq)
        both = fp & fq
        # E = A + (C - A) x_p - C x_q + (B + C - A)(1 - x_p) x_q
        t = (C - A)[both]
        np.add.at(U1, ip[both][t >= 0], t[t >= 0])
        np.add.at(U0, ip[both][t < 0], -t[t < 0])
        np.add.at(U0, iq[both], C[both])
        cap = (Bc + C - A)[both]
        m = cap > 0
        rows.append(ip[both][m]); cols.append(iq[both][m]); caps.append(cap[m])
        # one end fixed (its label stays)
        pf = fp & ~fq & (lq >= 0)
        np.add.at(U0, ip[pf], A[pf]); np.add.at(U1, ip[pf], C[pf])
        qf = fq & ~fp & (lp >= 0)
        np.add.at(U0, iq[qf], A[qf]); np.add.at(U1, iq[qf], Bc[qf])

    pairs(wr, label[:, :-1], label[:, 1:], free[:, :-1], free[:, 1:], idx[:, :-1], idx[:, 1:])
    pairs(wd, label[:-1], label[1:], free[:-1], free[1:], idx[:-1], idx[1:])
    m = np.minimum(U0, U1)
    U0 -= m
    U1 -= m
    s, t = n, n + 1
    nodes = np.arange(n)
    r = np.concatenate([np.full(n, s)[U1 > 0], nodes[U0 > 0]] + rows)
    c = np.concatenate([nodes[U1 > 0], np.full(n, t)[U0 > 0]] + cols)
    k = np.concatenate([U1[U1 > 0], U0[U0 > 0]] + caps)
    G = coo_matrix((k.astype(np.int32), (r, c)), shape=(n + 2, n + 2)).tocsr()
    G.sum_duplicates()
    res = maximum_flow(G, s, t, method='dinic')
    R = (G - res.flow).tocsr()
    R.data = (R.data > 0).astype(np.int8)
    R.eliminate_zeros()
    reach = breadth_first_order(R, s, directed=True, return_predecessors=False)
    inS = np.zeros(n + 2, bool)
    inS[reach] = True
    new = label.copy()
    sw = np.zeros((ny, nx), bool)
    sw[free] = ~inS[:n]
    new[sw] = a
    return new


def solve_labels(D, wr, wd):
    S, ny, nx = D.shape
    big = 10 * SCALE * (D_MAX + 10)
    Di = np.where(np.isfinite(D), np.round(D * SCALE), big).astype(np.int64)
    wri = np.round(wr * SCALE).astype(np.int64)
    wdi = np.round(wd * SCALE).astype(np.int64)
    has = np.isfinite(D).any(axis=0)
    label = np.where(has, np.argmin(Di, axis=0), -1)
    e = energy(Di, wri, wdi, label)
    log = [dict(cycle=0, energy=e)]
    try:
        from scipy.sparse.csgraph import maximum_flow  # noqa: F401
        method = 'alpha-expansion (scipy.sparse.csgraph.maximum_flow, Dinic)'
    except ImportError:
        method = 'ICM from the best data term, three sweeps'
    if method.startswith('ICM'):
        for sweep_i in range(3):
            cost = Di.astype(np.float64).copy()
            for dy, dx, w in ((0, 1, wri), (0, -1, wri), (1, 0, wdi), (-1, 0, wdi)):
                nb = np.full((ny, nx), -2)
                ww = np.zeros((ny, nx))
                if dx == 1:
                    nb[:, :-1] = label[:, 1:]; ww[:, :-1] = w
                elif dx == -1:
                    nb[:, 1:] = label[:, :-1]; ww[:, 1:] = w
                elif dy == 1:
                    nb[:-1] = label[1:]; ww[:-1] = w
                else:
                    nb[1:] = label[:-1]; ww[1:] = w
                for s in range(S):
                    cost[s] += ww * ((nb != s) & (nb >= 0))
            label = np.where(has, np.argmin(cost, axis=0), -1)
            log.append(dict(cycle=sweep_i + 1, energy=energy(Di, wri, wdi, label)))
        return label, method, log
    order = np.argsort(-(Di < big).sum(axis=(1, 2)), kind='stable')
    for cycle in range(1, 6):
        changed = False
        for a in order:
            if not (Di[a] < big).any():
                continue
            new = expand(Di, wri, wdi, label, int(a), big)
            if new is None:
                continue
            en = energy(Di, wri, wdi, new)
            if en > e:
                raise SystemExit(f'expansion raised the energy ({e} -> {en}): the graph is wrong')
            if en < e:
                label, e, changed = new, en, True
        log.append(dict(cycle=cycle, energy=e))
        print(f'  cycle {cycle}: energy {e}', flush=True)
        if not changed:
            break
    return label, method, log


def ranked_lists(D, label, keep, cover):
    """Per block, the stations to colour it from in order: its label, the other candidates by data
    cost, then stations that saw some of it, most first."""
    key = np.where(keep, D, np.inf)
    key = np.minimum(key, np.where(~keep & (cover > 0), 100 + (1 - cover), np.inf))
    lab = np.where(label >= 0, label, 0)
    np.put_along_axis(key, lab[None], -1.0, 0)
    order = np.argsort(key, axis=0, kind='stable')[:RANKED]
    fin = np.isfinite(np.take_along_axis(key, order, 0))
    out = np.where(fin, order, -1).astype(np.int16)
    out[:, label < 0] = -1
    return np.moveaxis(out, 0, -1)


def texel_labels(ranked, visbits, valid, rb):
    """Each texel's station: the first in its block's ranking that saw that texel."""
    H, Wd = valid.shape
    br0, br1, bc0, bc1 = rb
    lab = np.full((H, Wd), -1, np.int16)
    R0, R1 = br0 * B.BLOCK, min(br1 * B.BLOCK, H)
    C0, C1 = bc0 * B.BLOCK, min(bc1 * B.BLOCK, Wd)
    for r0 in range(R0, R1, CHUNK):
        r1 = min(r0 + CHUNK, R1)
        rows = np.arange(r0, r1)
        cols = np.arange(C0, C1)
        rk = ranked[(rows // B.BLOCK)[:, None], (cols // B.BLOCK)[None, :]]
        vis = B.unpack_bits(visbits[:, r0:r1], Wd)[:, :, C0:C1]
        out = np.full((r1 - r0, C1 - C0), -1, np.int16)
        for k in range(rk.shape[-1]):
            s = rk[..., k]
            sv = np.where(s >= 0, s, 0)
            seen = np.take_along_axis(vis, sv[None].astype(np.int64), 0)[0]
            out = np.where((s >= 0) & (out < 0) & seen, s, out)
        out[~valid[r0:r1, C0:C1]] = -1
        lab[r0:r1, C0:C1] = out
    return lab


# ---------------------------------------------------------------- 4. depth

def best_three(ranked, keep):
    nby, nbx, K = ranked.shape
    top = np.full((nby, nbx, 3), -1, np.int16)
    slot = np.zeros((nby, nbx), np.int64)
    ii, jj = np.meshgrid(np.arange(nby), np.arange(nbx), indexing='ij')
    for k in range(K):
        s = ranked[..., k].astype(np.int64)
        kept = (s >= 0) & keep[np.where(s >= 0, s, 0), ii, jj]
        put = kept & (slot < 3)
        top[ii[put], jj[put], slot[put]] = s[put]
        slot += put
    return top


def sweep_station(grid, pano, blk_bi, blk_bj, depths):
    """Raw luminance of blocks' 64 texel centres at each swept depth: (n, D, 64) uint8."""
    depth = grid.depth
    H, Wd = depth.shape
    ti = np.repeat(np.arange(B.BLOCK), B.BLOCK)
    tj = np.tile(np.arange(B.BLOCK), B.BLOCK)
    r = np.clip(B.BLOCK * blk_bi[:, None] + ti[None], 0, H - 1).ravel()
    c = np.clip(B.BLOCK * blk_bj[:, None] + tj[None], 0, Wd - 1).ravel()
    d0 = depth[r, c]
    out = np.empty((len(blk_bi), len(depths), B.BLOCK * B.BLOCK), np.uint8)
    for di, dz in enumerate(depths):
        L = pano.lum(grid.points(r, c, d0 + dz), corrected=False)
        out[:, di] = np.clip(np.round(L), 0, 255).astype(np.uint8).reshape(len(blk_bi), -1)
    return out, r, c


def sweep(grid, sts, ranked, keep, stats, rb):
    depth, valid = grid.depth, grid.valid
    H, Wd = depth.shape
    nby, nbx = B.blocks_shape(H, Wd)
    br0, br1, bc0, bc1 = rb
    lum = stats['rgb'] @ B.LUMA
    var = np.maximum(stats['lum2'] - lum ** 2, 0)
    top = best_three(ranked, keep)
    lab0 = np.where(top[..., 0] >= 0, top[..., 0], 0).astype(np.int64)
    tex_std = np.sqrt(np.take_along_axis(var, lab0[None], 0)[0])
    todo = (top[..., 1] >= 0) & (tex_std >= TEXTURE_STD)
    mask = np.zeros((nby, nbx), bool)
    mask[br0:br1, bc0:bc1] = True
    todo &= mask
    cost = np.full((nby, nbx, len(DEPTHS)), np.nan, np.float32)
    bi_all, bj_all = np.nonzero(todo)
    passes = max(1, int(np.ceil(len(bi_all) / PASS_BLOCKS)))
    edges = np.quantile(bj_all, np.linspace(0, 1, passes + 1)) if len(bj_all) else [0, 0]
    for p in range(passes):
        sel = (bj_all >= edges[p]) & ((bj_all < edges[p + 1]) if p < passes - 1 else (bj_all <= edges[p + 1]))
        bi, bj = bi_all[sel], bj_all[sel]
        nb = len(bi)
        if nb == 0:
            continue
        t0 = time.time()
        tops = top[bi, bj]
        samples = np.zeros((nb, 3, len(DEPTHS), B.BLOCK * B.BLOCK), np.uint8)
        okm = np.zeros((nb, 3, B.BLOCK * B.BLOCK), bool)
        need = [int(s) for s in np.unique(tops[tops >= 0])]
        with ThreadPoolExecutor(B.threads()) as pool:
            for s in need:
                B.wait_while_quiet()
                blk, rank = np.nonzero(tops == s)
                pano = B.Pano(sts[s])
                pano.lum16()
                parts = np.array_split(np.arange(len(blk)), max(1, int(np.ceil(len(blk) / 2000))))

                def work(ix):
                    out, r, c = sweep_station(grid, pano, bi[blk[ix]], bj[blk[ix]], DEPTHS)
                    seen = ((stats['visbits'][s, r, c >> 3] >> (7 - (c & 7))) & 1).astype(bool) & valid[r, c]
                    samples[blk[ix], rank[ix]] = out
                    okm[blk[ix], rank[ix]] = seen.reshape(len(ix), -1)
                list(pool.map(work, parts))
                pano.close()
        for k0 in range(0, nb, 2000):
            k1 = min(k0 + 2000, nb)
            x = samples[k0:k1].astype(np.float32)                 # (b, 3, D, n)
            have = tops[k0:k1] >= 0                               # (b, 3)
            ok = okm[k0:k1] & have[..., None]
            allok = ok.sum(axis=1) == have.sum(axis=1)[:, None]  # texels every used station saw
            w = (ok & allok[:, None, :]).astype(np.float32)
            mu = (x[:, :, K0] * w).sum(-1) / np.maximum(w.sum(-1), 1)
            xn = x / np.maximum(mu, 1.0)[:, :, None, None]
            wn = w[:, :, None, :]
            cnt = np.maximum(wn.sum(axis=1), 1)
            m = (xn * wn).sum(axis=1) / cnt
            v = (((xn - m[:, None]) ** 2) * wn).sum(axis=1) / cnt
            a = allok.astype(np.float32)[:, None, :]
            disagree = (v * a).sum(-1) / np.maximum(a.sum(-1), 1)
            tm = (xn[:, :, K0] * w).sum(-1) / np.maximum(w.sum(-1), 1)
            tv = (((xn[:, :, K0] - tm[..., None]) ** 2) * w).sum(-1) / np.maximum(w.sum(-1), 1)
            tex = np.nanmean(np.where(have, tv, np.nan), axis=1)
            cost[bi[k0:k1], bj[k0:k1]] = disagree / np.maximum(tex, 1e-6)[:, None]
        print(f'  depth pass {p + 1}/{passes}: {nb} blocks, {len(need)} stations, {time.time() - t0:.1f} s', flush=True)
    return cost, todo


def depth_field(cost, todo):
    """The chosen depth offset per block. Where the sweep has a clear minimum, it is located between
    the 2 mm steps by a parabola through its neighbours; those measurements, weighted by how clear
    they are, are fitted with a membrane (DEPTH_SMOOTH between neighbouring blocks, drawn weakly to
    the wall's median), so the offset varies smoothly over the relief: a jump between neighbouring
    blocks would warp the photograph between them."""
    from scipy.sparse import coo_matrix, diags
    from scipy.sparse.linalg import spsolve
    nby, nbx, nd = cost.shape
    c = np.where(np.isfinite(cost), cost, np.inf)
    kmin = np.argmin(c, axis=-1)
    cmin = np.nanmin(cost, axis=-1)
    cmed = np.nanmedian(cost, axis=-1)
    contrast = np.where(todo, (cmed - cmin) / np.maximum(cmed, 1e-6), 0)
    reliable = todo & (contrast >= 0.2) & (cmin <= 0.6)
    if not reliable.any():
        return np.zeros((nby, nbx), np.float32), reliable, contrast, 0.0
    k = np.clip(kmin, 1, nd - 2)
    cl = np.take_along_axis(c, (k - 1)[..., None], -1)[..., 0]
    c0 = np.take_along_axis(c, k[..., None], -1)[..., 0]
    cr = np.take_along_axis(c, (k + 1)[..., None], -1)[..., 0]
    curv = cl - 2 * c0 + cr
    off = np.where((curv > 1e-9) & np.isfinite(curv) & (kmin == k), 0.5 * (cl - cr) / np.maximum(curv, 1e-9), 0.0)
    step = float(DEPTHS[1] - DEPTHS[0])
    meas = DEPTHS[kmin] + np.clip(off, -0.5, 0.5) * step
    w = np.where(reliable, np.clip(contrast / 0.5, 0, 1), 0.0)
    base = float(np.median(meas[reliable]))
    n = nby * nbx
    idx = np.arange(n).reshape(nby, nbx)
    a = np.concatenate([idx[:, :-1].ravel(), idx[:-1].ravel()])
    b = np.concatenate([idx[:, 1:].ravel(), idx[1:].ravel()])
    L = coo_matrix((np.full(len(a), -DEPTH_SMOOTH), (a, b)), shape=(n, n))
    L = L + L.T
    deg = -np.asarray(L.sum(axis=1)).ravel()
    eps = 1e-3
    M = (L + diags(deg + w.ravel() + eps)).tocsc()
    rhs = w.ravel() * meas.ravel() + eps * base
    delta = spsolve(M, rhs).reshape(nby, nbx)
    return delta.astype(np.float32), reliable, contrast, base


# ---------------------------------------------------------------- main

def main():
    args = parse()
    B.below_normal_priority()
    B.use_data(args.data)
    t0 = time.time()
    wall = args.wall
    grid = B.Grid(wall)
    depth, valid = grid.depth, grid.valid
    H, Wd = depth.shape
    sts = B.P.stations()
    rb = region_blocks(args, grid)
    print(f'{wall}: {H} x {Wd} texels, blocks {rb}', flush=True)
    if args.stats_cache and os.path.exists(args.stats_cache):
        z = np.load(args.stats_cache)
        stats = {k: z[k] for k in z.files}
    else:
        stats = statistics(grid, sts, rb)
        if args.stats_cache:
            np.savez(args.stats_cache, **stats)
    t1 = time.time()
    cand = candidates(stats)
    wr, wd = potts_weights(grid, np.isfinite(cand['D']).any(axis=0))
    label, method, log = solve_labels(cand['D'], wr, wd)
    ranked = ranked_lists(cand['D'], label, cand['keep'], stats['cover'])
    tlab = texel_labels(ranked, stats['visbits'], valid, rb)
    t2 = time.time()
    cost, todo = sweep(grid, sts, ranked, cand['keep'], stats, rb)
    delta, reliable, contrast, base = depth_field(cost, todo)
    t3 = time.time()
    os.makedirs(args.out, exist_ok=True)
    ids = [s['id'] for s in sts]
    np.savez_compressed(os.path.join(args.out, f'labels-{wall}.npz'),
                        stations=np.array(ids), label=label.astype(np.int16), ranked=ranked, texel_label=tlab,
                        delta=delta, reliable=reliable, todo=todo, sweep_cost=cost.astype(np.float16),
                        cover=stats['cover'].astype(np.float16), rgb=stats['rgb'].astype(np.float32), lum2=stats['lum2'].astype(np.float32),
                        lap=stats['lap'], foot=np.where(np.isfinite(stats['foot']), stats['foot'], 0).astype(np.float32),
                        visbits=stats['visbits'], glare=cand['glare'], occl=cand['occl'], keep=cand['keep'], glare_changed=cand['glare_changed'],
                        D=np.where(np.isfinite(cand['D']), cand['D'], -1).astype(np.float32),
                        region=np.array(rb), depths=DEPTHS)
    has = label >= 0
    share = {ids[s]: round(float((label[has] == s).mean()), 4) for s in np.unique(label[has])}
    share = dict(sorted(share.items(), key=lambda kv: -kv[1]))
    lab_d = np.take_along_axis(np.where(np.isfinite(cand['D']), cand['D'], 0), np.where(has, label, 0)[None], 0)[0]
    seams = int((label[:, :-1] != label[:, 1:])[has[:, :-1] & has[:, 1:]].sum() + (label[:-1] != label[1:])[has[:-1] & has[1:]].sum())
    report = dict(wall=wall, blocks=[int(x) for x in label.shape], region_blocks=[int(x) for x in rb], method=method, energy=log,
                  params=dict(cover_min=COVER_MIN, glare_mad=GLARE_MAD, potts=POTTS, potts_edge=POTTS_EDGE, edge_step_m=EDGE_STEP, score_sigma=SCORE_SIGMA, glare_w=GLARE_W, glare_free=GLARE_FREE, depth_smooth=DEPTH_SMOOTH,
                              foot_ref_mm=FOOT_REF_MM, d_max=D_MAX, depths_m=[float(x) for x in DEPTHS], texture_std=TEXTURE_STD),
                  labelled_blocks=int(has.sum()), label_share=share,
                  candidates_per_block_median=float(np.median(cand['keep'].sum(axis=0)[has])) if has.any() else 0,
                  glare_rejections=int(cand['glare'].sum()), occluder_rejections=int(cand['occl'].sum()),
                  blocks_where_glare_changed_the_choice=int((cand['glare_changed'] & has).sum()),
                  label_data_cost_median=float(np.median(lab_d[has])) if has.any() else 0,
                  label_data_cost_p90=float(np.percentile(lab_d[has], 90)) if has.any() else 0,
                  seams=seams, texels_labelled=int((tlab >= 0).sum()), texels_valid=int(valid.sum()),
                  sweep=dict(blocks=int(todo.sum()), reliable=int(reliable.sum()), base_m=round(float(base), 4),
                             delta_mm_percentiles={p: round(float(np.percentile(delta[todo], p) * 1000), 1) for p in (5, 25, 50, 75, 95)} if todo.any() else {}),
                  seconds=dict(statistics=round(t1 - t0, 1), labels=round(t2 - t1, 1), depth=round(t3 - t2, 1)), peak_mb=B.peak_mb())
    B.save_json(os.path.join(args.out, f'labels-{wall}.json'), report)
    print(json.dumps({k: report[k] for k in ('labelled_blocks', 'glare_rejections', 'occluder_rejections', 'blocks_where_glare_changed_the_choice',
                                             'label_data_cost_median', 'seams', 'sweep', 'seconds', 'peak_mb')}), flush=True)


if __name__ == '__main__':
    main()

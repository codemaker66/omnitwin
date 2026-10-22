"""The walls' photographs at 2 mm a texel, for the detail tiles the planner streams where it is looked at closely.

The same best-view photograph as the atlas (project-walls.py --labels), sampled every 2 mm instead of every 2.5 mm:
each texel takes its colour from the station label-views.py chose for its 40 mm block, feathered over one block at
the seams, with the same global colour adjustment and the same local Poisson blend. Those corrections live on the
5 mm grid (an offset per station at every block corner, a membrane per texel), so they are recomputed here exactly
as project-walls.py computes them (the seams' colours from the same 2.5 mm sub-samples) and each 2 mm sample takes
those of the 5 mm texel it falls in, as each of the fine orthophoto's four sub-samples does. Only where a texel is
sampled changes. Sampled at the scanned relief, as the atlas is (the depths label-views.py records are for
measuring).

The detail is laid out in the planner's own frame, the atlas's (hall-atlas.ts wallAtlasUv): u along the wall from
its left end, t = 6.72 m (WALL_ATLAS_V_MAX) less the height, both in metres, mapped onto the orthophoto as
pack-atlas.py's Lanczos reduction maps the atlas (its scale differs from 200 px/m by 0.02% on the long walls), so a
detail texel shows what the atlas texel under it shows, only sharper. Then pack-atlas.py's patches (movable
equipment replaced by panelling copied from the same wall, the end door's leaves) and its fill, both in metres.

The image covers the detail tiles' grid (pack-detail.py): PITCH (0.992 m, 496 texels) a tile, plus GUTTER texels
round the edge; beyond the wall's edges a texel repeats the edge, as the atlas clamps.

Work is done in column chunks of at most CHUNK_TILES tiles, so the window wall's float accumulator stays near 170 MB
and the process under 1.2 GB; each panorama is decoded once per chunk it reaches.

Usage (in the work directory): python3 $SURVEY/project-detail.py <window|door|end|fire> [--data DIR] [--out proj]
    [--labels DIR]
Writes proj/detail-<wall>.npy (uint8 sRGB rows x columns x 3) and proj/detail-<wall>.json."""
import argparse
import importlib.util
import json
import os
import sys
import time
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bestview as B  # noqa: E402

_spec = importlib.util.spec_from_file_location('project_walls', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'project-walls.py'))
PW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PW)

# The detail grid (hall-detail.ts reads the same numbers from detail/index.json and checks them).
TEXEL = 0.002            # metres a detail texel
TILE = 512               # texels a tile, gutters included
GUTTER = 8               # texels repeated from the neighbouring tiles on each side
UNIQUE = TILE - 2 * GUTTER
PITCH = UNIQUE * TEXEL   # 0.992 m
CHUNK_TILES = 8          # tile columns a chunk of work

# The atlas's frame (hall-atlas.ts, pack-atlas.py).
L, W = 21.135, 10.59
SIZE = 4096
PPM = (SIZE / 2) / W
V_MIN, V_MAX = -0.02, 6.72
ROW = int(np.ceil((V_MAX - V_MIN) * PPM))
SRC_PPM = 200.0
SRC_TOP = 7.0
LENGTH = {'window': L, 'door': L, 'end': W, 'fire': W}

# pack-atlas.py's patches, in metres: (wall, dst u0, u1, v0, v1, mode, arg); 'shift' copies from u + arg, 'mirror'
# reflects about u = arg.
door_u = lambda scan_x: L / 2 - 8.795 + scan_x  # noqa: E731
DOOR_END, DOOR_FIRE = door_u(-0.025), door_u(17.665)
PATCHES = [
    ('window', 0.0, 0.8, 0.0, 1.6, 'mirror', L / 2),
    ('door', 0.0, 0.75, 0.0, 1.54, 'shift', 2.72),
    ('door', DOOR_END - 0.54, DOOR_END + 0.54, 0.0, 2.35, 'shift', DOOR_FIRE - DOOR_END),
    ('end', 10.12, 10.59, 0.3, 1.48, 'shift', -1.06),
    ('fire', 3.15, 3.58, 0.0, 1.48, 'mirror', 5.332),
    ('fire', 9.6, 10.59, 0.0, 1.72, 'shift', -3.18),
]
PATCH_FEATHER = 0.05     # metres: pack-atlas.py feathers its patches over 10 texels of 5 mm
FILL_REACH = 0.2         # metres: pack-atlas.py grows colour 40 texels of 5 mm into what no station saw
BAND = 128               # detail rows sampled at a time


def tile_grid(wall):
    """Columns and rows of detail tiles over a wall."""
    return int(np.ceil(LENGTH[wall] / PITCH - 1e-9)), int(np.ceil((V_MAX - V_MIN) / PITCH - 1e-9))


def atlas_scale(wall):
    """5 mm orthophoto texels per metre of the atlas's frame, along u and down t, as pack-atlas.py's resize maps
    them: the crop of round(L * 200) columns (rows 56..1404) onto ceil(L * PPM) columns (ROW rows)."""
    w_src = int(round(LENGTH[wall] * SRC_PPM))
    w_dst = int(np.ceil(LENGTH[wall] * PPM))
    r_top = int(round((SRC_TOP - V_MAX) * SRC_PPM))
    r_bot = int(round((SRC_TOP - V_MIN) * SRC_PPM))
    return PPM * w_src / w_dst, PPM * (r_bot - r_top) / ROW, r_top


def detail_to_grid(wall, i, j, H, Wd):
    """For detail texels at rows i and columns j (the image's, gutters included): the 5 mm texel each falls in
    (r, c) and its offset from that texel's centre (fr down, fc along u, in texels, within +-0.5)."""
    k_u, k_v, r_top = atlas_scale(wall)
    u = np.clip((np.asarray(j, np.float64) - GUTTER + 0.5) * TEXEL, 0.0, LENGTH[wall])
    t = np.clip((np.asarray(i, np.float64) - GUTTER + 0.5) * TEXEL, 0.0, V_MAX - V_MIN)
    c5 = u * k_u - 0.5
    r5 = r_top + t * k_v - 0.5
    c = np.clip(np.rint(c5), 0, Wd - 1).astype(np.int64)
    r = np.clip(np.rint(r5), 0, H - 1).astype(np.int64)
    return r, np.clip(r5 - r, -0.5, 0.5).astype(np.float32), c, np.clip(c5 - c, -0.5, 0.5).astype(np.float32)


class Fields:
    """What project-walls.py --labels decides on the 5 mm grid, recomputed: the labels, each station's feather weight
    (box_feather of its labelled texels, where it saw them), the per-station corner offsets of the global adjustment,
    and per texel the summed weight Wt and the correction the local Poisson blend and the feather's seam terms add
    after the weighted mean (corr), so a sample's colour is sum_s w_s (C_s + g_s) / Wt + corr."""

    def __init__(self, wall, labels_dir):
        t0 = time.time()
        lb = np.load(os.path.join(labels_dir, f'labels-{wall}.npz'))
        self.ids = [str(x) for x in lb['stations']]
        sts = {s['id']: s for s in B.P.stations()}
        self.stations = sts
        label = lb['label'].astype(np.int64)
        tl = lb['texel_label'].astype(np.int16)
        self.tl = tl
        self.visbits = lb['visbits']
        grid = B.Grid(wall)
        self.grid = grid
        H, Wd = grid.depth.shape
        self.H, self.Wd = H, Wd
        flat = PW.block_flatness(grid, lb, label)
        offsets, self.gsum = PW.global_adjustment(label, lb['rgb'], lb['cover'].astype(np.float32), flat, model='offset')
        self.offsets = {s: PW.filled_offsets(g) for s, g in offsets.items()}
        self.used = [int(s) for s in np.unique(tl[tl >= 0])]
        nbl = PW.seam_neighbours(tl)
        seam = nbl >= 0
        slot = np.full((H, Wd), -1, np.int32)
        ns = int(seam.sum())
        slot[seam] = np.arange(ns, dtype=np.int32)
        own_c = np.full((ns, 3), np.nan, np.float32)
        other_c = np.full((ns, 3), np.nan, np.float32)
        Wt = np.zeros((H, Wd), np.float32)
        own_w = np.zeros((H, Wd), np.float32)
        self.boxes = {}
        sampled = 0
        for s in self.used:
            B.wait_while_quiet()
            omega, (y0, y1, x0, x1) = self.omega(s)
            self.boxes[s] = (y0, y1, x0, x1)
            Wt[y0:y1, x0:x1] += omega
            ry, rx = np.nonzero(omega > 0)
            R, C = ry + y0, rx + x0
            mine = tl[R, C] == s
            own_w[R[mine], C[mine]] = omega[ry[mine], rx[mine]]
            # the seams' colours, from the fine orthophoto's own four sub-samples (project-walls.py station_band)
            sl = slot[R, C]
            need = (sl >= 0) & (mine | (nbl[R, C] == s))
            if not need.any():
                continue
            pano = B.Pano(sts[self.ids[s]])
            Rn, Cn = R[need], C[need]
            D4 = np.empty((len(Rn), 4, 3), np.float32)
            for k, (fr, fc) in enumerate(PW.SUBS2):
                d = B.sub_depth(grid.depth, grid.valid, Rn, Cn, np.float32(fr), np.float32(fc))
                D4[:, k] = pano.rgb(grid.points(Rn, Cn, d, fr, fc))
            pano.close()
            sampled += 4 * len(Rn)
            g = self.offsets.get(s)
            col = (D4 + PW.corners_to_texels(g, Rn, Cn)[:, None, :]).mean(axis=1) if g is not None else D4.mean(axis=1)
            sn = sl[need]
            m = mine[need]
            own_c[sn[m]] = col[m]
            o = nbl[Rn, Cn] == s
            other_c[sn[o]] = col[o]
        # the local Poisson blend and the feather's seam terms, as project-walls.py best_view
        from scipy import ndimage
        ok_j = np.isfinite(own_c[:, 0]) & np.isfinite(other_c[:, 0])
        sy, sx = np.nonzero(seam)
        sign = np.where(tl[sy, sx] < nbl[sy, sx], 1.0, -1.0).astype(np.float32)
        has_j = np.zeros((H, Wd), bool)
        has_j[sy[ok_j], sx[ok_j]] = True
        gm = ndimage.gaussian_filter(has_j.astype(np.float32), PW.SEAM_SIGMA)
        Js = np.zeros((H, Wd, 3), np.float32)
        sgn = np.zeros((H, Wd), np.float32)
        sgn[sy, sx] = sign
        for ch in range(3):
            J = np.zeros((H, Wd), np.float32)
            J[sy[ok_j], sx[ok_j]] = (other_c[ok_j, ch] - own_c[ok_j, ch]) * sign[ok_j]
            Js[..., ch] = np.where(has_j, ndimage.gaussian_filter(J, PW.SEAM_SIGMA) / np.maximum(gm, 1e-6) * sgn, 0)
        del gm, J, own_c, other_c, slot, sgn
        p, self.nfree = PW.membrane_strips(tl, grid.valid, has_j, Js / 2)
        feathered = (Wt - own_w) > 1e-6
        ni, nj = ndimage.distance_transform_edt(~has_j, return_distances=False, return_indices=True)
        fy, fx = np.nonzero(feathered)
        near = Js[ni[fy, fx], nj[fy, fx]]
        same_side = tl[ni[fy, fx], nj[fy, fx]] == tl[fy, fx]
        del ni, nj, Js
        corr = own_w[..., None] * p
        del p
        corr[fy, fx] += (Wt - own_w)[fy, fx, None] * np.where(same_side[:, None], -near / 2, near / 2)
        corr /= np.maximum(Wt, 1e-6)[..., None]
        self.corr = corr
        self.Wt = Wt
        self.covered = (Wt > 0) & grid.valid
        self.seconds = round(time.time() - t0, 1)
        self.seam_samples = sampled

    def omega(self, s):
        """Station s's feather weight over its labelled texels' box (one block beyond), where it saw them."""
        ind = self.tl == s
        rr, cc = np.nonzero(ind)
        y0, y1 = max(rr.min() - PW.FEATHER, 0), min(rr.max() + PW.FEATHER + 1, self.H)
        x0, x1 = max(cc.min() - PW.FEATHER, 0), min(cc.max() + PW.FEATHER + 1, self.Wd)
        vis = B.unpack_bits(self.visbits[s, y0:y1], self.Wd)[:, x0:x1] & self.grid.valid[y0:y1, x0:x1]
        return PW.box_feather(ind[y0:y1, x0:x1]) * vis, (y0, y1, x0, x1)


def sample_detail(wall, F, rows, cols):
    """The detail image (rows x cols, uint8 sRGB) and where it has colour, column chunk by column chunk."""
    H, Wd = F.H, F.Wd
    out = np.zeros((rows, cols, 3), np.uint8)
    have = np.zeros((rows, cols), bool)
    r_all, fr_all, _, _ = detail_to_grid(wall, np.arange(rows), np.zeros(1, np.int64), H, Wd)
    chunk = CHUNK_TILES * UNIQUE
    samples = 0
    decodes = 0
    for j0 in range(0, cols, chunk):
        j1 = min(j0 + chunk, cols)
        _, _, c_all, fc_all = detail_to_grid(wall, np.zeros(1, np.int64), np.arange(j0, j1), H, Wd)
        cmin, cmax = int(c_all.min()), int(c_all.max())
        acc = np.zeros((rows, j1 - j0, 3), np.float32)
        for s in F.used:
            y0, y1, x0, x1 = F.boxes[s]
            if x1 <= cmin or x0 > cmax:
                continue
            B.wait_while_quiet()
            colsel = np.nonzero((c_all >= x0) & (c_all < x1))[0]
            rowsel = np.nonzero((r_all >= y0) & (r_all < y1))[0]
            if not len(colsel) or not len(rowsel):
                continue
            omega, _ = F.omega(s)
            om = omega[(r_all[rowsel] - y0)[:, None], (c_all[colsel] - x0)[None, :]]
            del omega
            if not (om > 0).any():
                continue
            pano = B.Pano(F.stations[F.ids[s]])
            decodes += 1
            g = F.offsets.get(s)
            for b0 in range(0, len(rowsel), BAND):
                b1 = min(b0 + BAND, len(rowsel))
                by, bx = np.nonzero(om[b0:b1] > 0)
                if not len(by):
                    continue
                ri = rowsel[b0 + by]
                cj = colsel[bx]
                R, FR = r_all[ri], fr_all[ri]
                C, FC = c_all[cj], fc_all[cj]
                d = B.sub_depth(F.grid.depth, F.grid.valid, R, C, FR, FC)
                col = pano.rgb(F.grid.points(R, C, d, FR, FC))
                if g is not None:
                    col += PW.corners_to_texels(g, R, C)
                acc[ri, cj] += col * om[b0 + by, bx][:, None]
                samples += len(R)
            pano.close()
            del om
        R = r_all[:, None]
        C = c_all[None, :]
        cov = F.covered[R, C]
        val = acc / np.maximum(F.Wt[R, C], 1e-6)[..., None] + F.corr[R, C]
        out[:, j0:j1] = np.where(cov[..., None], np.round(np.clip(val, 0, 255)), 0).astype(np.uint8)
        have[:, j0:j1] = cov
        del acc, val, cov
        print(f'  columns {j0}-{j1}: {samples} samples, {decodes} panoramas decoded, peak {B.peak_mb()} MB', flush=True)
    return out, have, samples, decodes


def fill_sparse(img, valid, passes):
    """pack-atlas.py's fill_sparse on uint8: grows colour 4-neighbour by 4-neighbour into texels without it,
    visiting only those; the rest takes the mean."""
    H, Wd = valid.shape
    valid = valid.copy()
    for _ in range(passes):
        ys, xs = np.nonzero(~valid)
        if not len(ys):
            break
        acc = np.zeros((len(ys), 3), np.float32)
        cnt = np.zeros(len(ys), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = ys - dy, xs - dx
            ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < Wd)
            ny, nx = np.clip(ny, 0, H - 1), np.clip(nx, 0, Wd - 1)
            sv = ok & valid[ny, nx]
            acc += img[ny, nx].astype(np.float32) * sv[:, None]
            cnt += sv
        grow = cnt > 0
        img[ys[grow], xs[grow]] = np.round(acc[grow] / cnt[grow][:, None]).astype(np.uint8)
        valid[ys[grow], xs[grow]] = True
    if not valid.all():
        img[~valid] = np.round(img[valid].reshape(-1, 3).mean(axis=0)).astype(np.uint8)
    return img


def px(u, v):
    """Edge column and row of the detail image at (u, v) metres."""
    return int(round(u / TEXEL)) + GUTTER, int(round((V_MAX - v) / TEXEL)) + GUTTER


def patch(img, u0, u1, v0, v1, mode, arg, length):
    """pack-atlas.py's patch at 2 mm: the region copied (shifted or mirrored) from the same wall, feathered over
    PATCH_FEATHER except along the wall's ends and the floor."""
    c0, r1 = px(u0, v0)
    c1, r0 = px(u1, v1)
    if mode == 'shift':
        s0 = int(round((u0 + arg) / TEXEL)) + GUTTER
        src = img[r0:r1, s0:s0 + (c1 - c0)].astype(np.float32)
    else:
        m0 = int(round((2 * arg - u1) / TEXEL)) + GUTTER
        src = img[r0:r1, m0:m0 + (c1 - c0)][:, ::-1].astype(np.float32)
    h, w = src.shape[:2]
    feather = PATCH_FEATHER / TEXEL
    ramp = lambda n: np.clip(np.arange(n) / feather, 0, 1)  # noqa: E731
    wx = np.ones(w)
    wy = np.ones(h)
    if u0 > 0.01:
        wx = np.minimum(wx, ramp(w))
    if u1 < length - 0.01:
        wx = np.minimum(wx, ramp(w)[::-1])
    wy = np.minimum(wy, ramp(h))
    if v0 > 0.01:
        wy = np.minimum(wy, ramp(h)[::-1])
    alpha = np.minimum.outer(wy, wx)[..., None]
    dst = img[r0:r1, c0:c0 + w].astype(np.float32)
    img[r0:r1, c0:c0 + w] = np.round(dst * (1 - alpha) + src * alpha).astype(np.uint8)


def main():
    a = argparse.ArgumentParser()
    a.add_argument('wall', choices=list(LENGTH))
    a.add_argument('--data', default='data')
    a.add_argument('--out', default='proj')
    a.add_argument('--labels', default=None, help='directory of labels-<wall>.npz (default: --out)')
    args = a.parse_args()
    warnings.filterwarnings('ignore', category=RuntimeWarning)
    B.below_normal_priority()
    B.use_data(args.data)
    t0 = time.time()
    wall = args.wall
    F = Fields(wall, args.labels or args.out)
    t1 = time.time()
    print(f'{wall}: fields in {t1 - t0:.1f} s, {len(F.used)} stations, peak {B.peak_mb()} MB', flush=True)
    ncols, nrows = tile_grid(wall)
    rows, cols = nrows * UNIQUE + 2 * GUTTER, ncols * UNIQUE + 2 * GUTTER
    img, have, samples, decodes = sample_detail(wall, F, rows, cols)
    t2 = time.time()
    uncovered = int((~have).sum())
    img = fill_sparse(img, have, int(round(FILL_REACH / TEXEL)))
    for p in PATCHES:
        if p[0] == wall:
            patch(img, *p[1:], LENGTH[wall])
    np.save(os.path.join(args.out, f'detail-{wall}.npy'), img)
    k_u, k_v, r_top = atlas_scale(wall)
    rep = dict(wall=wall, texel_m=TEXEL, tile=TILE, gutter=GUTTER, pitch_m=PITCH, columns=ncols, rows=nrows,
               image=[rows, cols], atlas_scale=dict(k_u=k_u, k_v=k_v, r_top=r_top), stations_used=len(F.used),
               samples=int(samples), seam_samples=int(F.seam_samples), panoramas_decoded=decodes,
               uncovered_texels=uncovered, poisson_free_texels=int(F.nfree), global_adjustment=F.gsum,
               seconds=dict(fields=round(t1 - t0, 1), sample=round(t2 - t1, 1), total=round(time.time() - t0, 1)),
               peak_mb=B.peak_mb())
    with open(os.path.join(args.out, f'detail-{wall}.json'), 'w') as f:
        json.dump(rep, f, indent=1)
    print(json.dumps({k: rep[k] for k in ('wall', 'image', 'samples', 'panoramas_decoded', 'uncovered_texels', 'seconds', 'peak_mb')}), flush=True)


if __name__ == '__main__':
    main()

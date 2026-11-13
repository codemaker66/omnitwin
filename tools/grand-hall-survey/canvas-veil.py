"""Measures the varnish veil on a wall's portrait canvases and writes the correction pack-atlas.py and project-detail.py
apply (canvasveil.py says how). Run after project-walls.py --labels for the wall.

For each canvas in canvasveil.CANVASES: the reference station is the one that labels most of the canvas's texels;
every station that saw at least SEEN_MIN of them (label-views.py's visibility, labels-<wall>.npz visbits) is sampled
once a 5 mm texel (exposure-corrected, at the scanned relief, as label-views.py samples) over the canvas and MARGIN
beyond it; the composite is the wall's own 5 mm orthophoto (proj/<view>.npz, linear). One panorama is held at a time.

Usage (in the work directory): python3 $SURVEY/canvas-veil.py <window|door|end|fire> [--data DIR] [--out proj]
Writes proj/canvas-<wall>.npz (each canvas's box on the wall's 5 mm grid, its extent there and its fields a, b) and
proj/canvas-<wall>.json (the reference, the views, their registration, the veil and the canvas before and after). A
wall without canvases gets neither, and pack-atlas.py and project-detail.py then change nothing on it."""
import argparse
import os
import sys
import time

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bestview as B  # noqa: E402
import canvasveil as CV  # noqa: E402


def stats(lin):
    L = B.to_srgb(np.clip(lin, 0, 1)) @ B.LUMA
    return dict(p10=round(float(np.percentile(L, 10)), 1), median=round(float(np.median(L)), 1))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('wall', choices=list(B.WALLS))
    a.add_argument('--data', default='data')
    a.add_argument('--out', default='proj')
    args = a.parse_args()
    B.below_normal_priority()
    B.use_data(args.data)
    wall = args.wall
    canvases = CV.boxes(wall)
    if not canvases:
        print(f'{wall}: no canvases', flush=True)
        return
    t0 = time.time()
    grid = B.Grid(wall)
    H, Wd = grid.depth.shape
    lb = np.load(os.path.join(args.out, f'labels-{wall}.npz'))
    ids = [str(x) for x in lb['stations']]
    sts = {s['id']: s for s in B.P.stations()}
    tl = lb['texel_label']
    visbits = lb['visbits']
    comp_all = np.concatenate([np.load(os.path.join(args.out, f"{v['name']}.npz"))['rgb'] for v in B.wall_tiles(wall)], axis=1)
    M = int(round(CV.MARGIN / CV.PITCH))
    params = {k: getattr(CV, k) for k in ('INSET', 'RAMP_LEVEL', 'LEVEL_MM', 'LOW_MM', 'GATE_MM', 'GATE_LIFT', 'GATE_SOFT', 'FEATURE', 'COLOUR_MM',
                                          'REG_MM', 'REG_MAX', 'QUANTILE', 'GLARE_FREE', 'VIEWS_MIN', 'SEEN_MIN', 'MARGIN')}
    report = dict(wall=wall, params=params, canvases={})
    arrays, names = {}, []
    for name, box, veil_on in canvases:
        r0, r1, c0, c1 = CV.box_texels(grid, box)
        h = r1 - r0
        lab = tl[r0:r1, c0:c1]
        counts = np.bincount(lab[lab >= 0].ravel().astype(np.int64), minlength=len(ids))
        ref_s = int(np.argmax(counts))
        # the stations that saw the canvas: label-views' own visibility over its texels
        vis = B.unpack_bits(visbits[:, r0:r1], Wd)[:, :, c0:c1] & grid.valid[None, r0:r1, c0:c1]
        seen = vis.reshape(len(ids), -1).mean(axis=1) / max(float(grid.valid[r0:r1, c0:c1].mean()), 1e-9)
        use = sorted(set([s for s in range(len(ids)) if seen[s] >= CV.SEEN_MIN] + [ref_s]))
        # texels: the canvas and MARGIN beyond, clamped to the wall; any the mesh does not cover take their nearest
        rr = np.clip(np.arange(r0 - M, r1 + M), 0, H - 1)
        cc = np.clip(np.arange(c0 - M, c1 + M), 0, Wd - 1)
        RR, CC = np.meshgrid(rr, cc, indexing='ij')
        ok = grid.valid[RR, CC]
        if not ok.all():
            _, (iy, ix) = ndimage.distance_transform_edt(~ok, return_indices=True)
            RR, CC = RR[iy, ix], CC[iy, ix]
        pts = grid.points(RR.ravel(), CC.ravel(), grid.depth[RR.ravel(), CC.ravel()])
        views = np.empty((len(use), RR.shape[0], RR.shape[1], 3), np.float32)
        for i, s in enumerate(use):
            B.wait_while_quiet()
            pano = B.Pano(sts[ids[s]])
            views[i] = B.to_linear(pano.rgb(pts)).reshape(RR.shape[0], RR.shape[1], 3)
            pano.close()
        comp = comp_all[r0:r1, c0:c1].astype(np.float32)
        fa, fb, rep = CV.field(views, comp, use.index(ref_s), M, veil_on=veil_on)
        entry = dict(box_m=list(box), box_texels=[r0, r1, c0, c1], veil_taken_off=bool(veil_on), reference=ids[ref_s],
                     reference_share=round(float(counts.max() / max(counts.sum(), 1)), 3), views=len(use),
                     registration_mm={ids[s]: [float(x) for x in rep['shifts_mm'][i]] for i, s in enumerate(use)},
                     registration_peak={ids[s]: round(float(rep['peaks'][i]), 3) for i, s in enumerate(use)})
        if fa is None:
            entry['not_applied'] = rep['reason']
            report['canvases'][name] = entry
            print(f'{wall} {name}: not applied, {rep["reason"]}', flush=True)
            continue
        after = np.clip(fa[..., None] * comp + fb, 0, 1)
        half = h // 2
        for part, sl in (('upper', slice(0, half)), ('lower', slice(half, h)), ('whole', slice(0, h))):
            entry[part] = dict(before=stats(comp[sl]), after=stats(after[sl]), photograph=stats(rep['ref_low'][sl]),
                               veil_share_of_photograph=round(float(np.median(rep['veil'][sl] / np.maximum(rep['ref_low'][sl] @ B.LUMA, 1e-6))), 3),
                               veiled_texels=round(float((rep['gate'][sl] > 0.5).mean()), 3))
        report['canvases'][name] = entry
        names.append(name)
        arrays[f'{name}.box'] = np.array([r0, r1, c0, c1], np.int32)
        arrays[f'{name}.extent'] = np.array(CV.extent(grid, box), np.float64)
        arrays[f'{name}.a'] = fa
        arrays[f'{name}.b'] = fb
        print(f'{wall} {name}: reference {ids[ref_s]} ({entry["reference_share"]}), {len(use)} views; lower canvas before '
              f'{entry["lower"]["before"]}, after {entry["lower"]["after"]}; upper before {entry["upper"]["before"]}, '
              f'after {entry["upper"]["after"]}', flush=True)
    np.savez_compressed(os.path.join(args.out, f'canvas-{wall}.npz'), names=np.array(names), **arrays)
    report['seconds'] = round(time.time() - t0, 1)
    report['peak_mb'] = B.peak_mb()
    B.save_json(os.path.join(args.out, f'canvas-{wall}.json'), report)


if __name__ == '__main__':
    main()

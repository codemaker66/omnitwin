"""The texels to which one build gives a station that is neither an earlier build's nor a reference build's, cut
out cluster by cluster to be looked at: the half of a comparison that a pair of eyes does.

    python -X utf8 unlike_reference_crops.py <reference_work> <first_work> <second_work> <out_dir> [--size 48] [--zoom 6] [--per-sheet 5] [--names "a|b|c"]

The three work folders are builds of one room config from the same inputs, with the same stations (the labels and
walls steps have run in all three). The texels are those to which the second build gives a station that is
neither the first build's nor the reference's: what compare_builds.py --apart-from <reference_work> <first_work>
<second_work> calls unlike_the_reference, and labels_diff.py --apart-from calls `new`. A cluster is those of them
that lie in one connected region of the set grown by 8 texels each way, so that texels a few apart are cut
together. A cluster is not compare_builds' unit: its own patches are the set's connected patches, not grown.

For each cluster it cuts a window, --size texels square at least and wide enough for the whole cluster with 8
texels to spare, out of each build's wall photograph as the atlas step fills it (wallviews.filled), and a key: the
cluster's texels black, and grey the texels the second build gave back the reference's station (changed between
the first and second build, and the reference's in the second). Strips of reference | first | second | key, each
enlarged --zoom times without smoothing, go --per-sheet to a sheet (sheet-01.jpg, ...), the clusters ordered by how
much their luminance changed from the first build to the second, summed over their texels. --names captions the
three builds (default "reference|first|second"). clusters.json holds, cluster by cluster in that order: the wall,
its texels, how many of them lie under a photo patch of the config (never seen), where its middle is (u and v in
the wall's metres), the change from the first build to the second in sRGB levels (summed over its texels, the
most on one texel, and the texels changed by more than 6), and the stations the first and the second build gave
its texels.

Read-only on the three work folders."""
import json
import os
import sys

import wallviews as wv
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

GROW = 8                                                  # texels: a cluster is a connected region of the set grown this far


def flag(args, name, default):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    return default


def main(argv):
    args = list(argv)
    size, zoom, per = int(flag(args, '--size', 48)), int(flag(args, '--zoom', 6)), int(flag(args, '--per-sheet', 5))
    names = flag(args, '--names', 'reference|first|second').split('|')
    if len(names) != 3:
        raise SystemExit('--names takes three captions, as "a|b|c"')
    reference, first, second, out = [os.path.abspath(a) for a in args[:4]]
    room, B, _ = wv.setup(second)
    os.makedirs(out, exist_ok=True)
    rows, cuts = [], []
    for name in wv.walls_of(second):
        z = [np.load(os.path.join(w, 'proj', f'labels-{name}.npz')) for w in (reference, first, second)]
        if not [str(x) for x in z[0]['stations']] == [str(x) for x in z[1]['stations']] == [str(x) for x in z[2]['stations']]:
            raise SystemExit(f'{name}: the three builds do not have the same stations')          # a station is compared by its number
        L0, L1, L2 = (x['texel_label'].astype(np.int64) for x in z)
        unlike = (L2 >= 0) & (L2 != L1) & (L2 != L0)
        back = (L2 != L1) & (L2 == L0)
        if not unlike.any():
            continue
        grid = B.Grid(name)
        lin = [wv.filled(w, name, B.P) for w in (reference, first, second)]
        img = [np.clip(B.P.linear_to_srgb(x), 0, 255).astype(np.uint8) for x in lin]
        d = np.abs(wv.levels(lin[2]) - wv.levels(lin[1]))
        lab, k = ndimage.label(ndimage.binary_dilation(unlike, structure=np.ones((3, 3)), iterations=GROW), structure=np.ones((3, 3)))
        H, W = unlike.shape
        covered = wv.under_a_patch(room, grid, name)
        for i in range(1, k + 1):
            rr, cc = np.nonzero(unlike & (lab == i))
            ww, hh = int(min(W, max(size, cc.max() - cc.min() + 2 * GROW + 1))), int(min(H, max(size, rr.max() - rr.min() + 2 * GROW + 1)))
            c0 = int(np.clip((cc.min() + cc.max()) // 2 - ww // 2, 0, W - ww))
            r0 = int(np.clip((rr.min() + rr.max()) // 2 - hh // 2, 0, H - hh))
            key = np.full((hh, ww, 3), 255, np.uint8)
            key[back[r0:r0 + hh, c0:c0 + ww]] = 170
            key[rr - r0, cc - c0] = 0
            rows.append(dict(wall=name, texels=int(len(rr)), under_a_patch=int(covered[rr, cc].sum()),
                             u=round(float(grid.ucol[(cc.min() + cc.max()) // 2]), 2), v=round(float(grid.vrow[(rr.min() + rr.max()) // 2]), 2),
                             sum_change=round(float(d[rr, cc].sum()), 1), max_change=round(float(d[rr, cc].max()), 1), over_6=int((d[rr, cc] > 6).sum()),
                             stations_first=sorted({int(s) for s in L1[rr, cc]}), stations_second=sorted({int(s) for s in L2[rr, cc]})))
            cuts.append([x[r0:r0 + hh, c0:c0 + ww] for x in img] + [key])
    order = sorted(range(len(rows)), key=lambda i: -rows[i]['sum_change'])    # a stable sort: ties keep the walls' order
    for n, i in enumerate(order):
        rows[i]['rank'] = n + 1
    sheets = [order[a:a + per] for a in range(0, len(order), per)]
    for s, group in enumerate(sheets):
        strips = []
        for i in group:
            r, c = rows[i], cuts[i]
            hh, ww = c[0].shape[:2]
            strip = Image.new('RGB', (4 * ww * zoom + 30, hh * zoom + 20), (255, 255, 255))
            ImageDraw.Draw(strip).text((4, 3), f"#{r['rank']} {r['wall']} u {r['u']} v {r['v']}: {r['texels']} new texels, change sum {r['sum_change']},"
                                       f" max {r['max_change']} levels   | {names[0]} | {names[1]} | {names[2]} | key (black new, grey back)", fill=(0, 0, 0))
            for j, p in enumerate(c):
                strip.paste(Image.fromarray(np.ascontiguousarray(p)).resize((ww * zoom, hh * zoom), Image.NEAREST), (j * (ww * zoom + 10), 20))
            strips.append(strip)
        sheet = Image.new('RGB', (max(p.width for p in strips), sum(p.height for p in strips) + 6 * len(strips)), (255, 255, 255))
        y = 0
        for p in strips:
            sheet.paste(p, (0, y))
            y += p.height + 6
        sheet.save(os.path.join(out, f'sheet-{s + 1:02d}.jpg'), quality=92)
    with open(os.path.join(out, 'clusters.json'), 'w', encoding='utf-8') as f:
        json.dump([rows[i] for i in order], f, indent=1)
    print('clusters', len(rows), '| texels', sum(r['texels'] for r in rows), '| under a patch', sum(r['under_a_patch'] for r in rows), '| sheets', len(sheets))
    for i in order:
        r = rows[i]
        print(f"#{r['rank']:2d} {r['wall']:18s} u {r['u']:5.2f} v {r['v']:5.2f} | {r['texels']:3d} texels ({r['under_a_patch']} patched) | sum {r['sum_change']:7.1f}"
              f" max {r['max_change']:5.1f} over6 {r['over_6']:3d} | {r['stations_first']} -> {r['stations_second']}")


if __name__ == '__main__':
    main(sys.argv[1:])

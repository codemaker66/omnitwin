"""Where a patch's feathered seams lie: on wall, on a thing that stood before it, or on a place no station saw.

    python -X utf8 patch_seams.py <work> <out.json> [--crops <dir>]

A `patch` edit puts a likeness over part of a wall, and the atlas step feathers it inward over
survey.atlas.featherTexels, so the outer band of every patch still shows what lies beneath it. Beneath a band there
should be wall: the wall as the stations saw it, or an earlier patch. Where the elevation still holds a thing that
stood before the wall there (an open door's leaf, a sideboard's top edge), the thing's picture shows through the
seam; and where no station coloured the wall there, the atlas step's fill of the place does.

This replays the atlas step's order on a finished build (a wall's own patches in config order, then the copies from
other walls, each with the atlas step's own patch function) and reports, for every patch and each of its feathered
edges (the top always, a side unless it is the wall's end, the bottom unless it is the floor):
  beneath  texels of the band where, when the patch was applied, the wall's own photograph still showed and stood
           more than 6 cm before the likeness placed over it, by the positions the corners step left
           (out-walls/*.fixed.f32, its `behind` edits applied), the most by which one does, and the box of the
           wall they lie in.
  shows    texels of the band where, with every patch applied, more than a twentieth of the finished picture is
           still such a photograph's, and the greatest share. A later patch that covers the band takes it off this
           count; one that only feathers across it leaves what its own weight leaves.
  colour   the mean difference in sRGB levels, and its 95th percentile, between the likeness and what lay beneath
           the band when the patch was applied, where the walls step has run.
  unseen   texels of the band beneath which, when the patch was applied, more than half of the picture was the
           atlas step's fill of a place on the wall that no station coloured (the wall behind a thing that a
           `behind` edit moved back, where no station saw past it). The fill is drawn from whatever lies round
           the place, or is the wall's mean colour: it is no likeness of the wall. Counted where the walls step
           has run for every wall the patches touch, and outside the openings' faces.
  fill shows   texels of the band where, with every patch applied, more than a twentieth of the finished picture
           is still such fill.
  in an opening   texels of the band that lie in the face of an opening (a window, an arch, a door that stood
           open: the corners step's own mask of them). The elevation holds there what lies beyond, or nothing,
           and the atlas fills it; a door drawn shut by a patch has its own edges feathered into that fill. It
           is not counted as fill: this says how much of a seam it is, and the crop shows what it looks like.
The last line counts the texels of all the walls where such a photograph still shows through a patch, and the
texels under a patch where such fill does.

The 6 cm is the corners step's own margin for a `behind` edit, measured here from the likeness and not from the
wall beside the edit: a moulding that stands further out than the likeness laid over it counts, and a thing less
than 6 cm before the wall does not. An opening beneath a band lies behind the wall and counts neither as a thing
nor as fill; where the likeness itself is of an opening there is nothing to measure from; and a thing a copy takes
from a place no patch covers is not known to be one, though the fill it takes is counted wherever it lands. So the
counts say where to look, and --crops writes what to look at: for each patch, what lay beneath it beside the patch
as blended, a texel of the photograph to a pixel, with 20 cm of the wall round it.

Read-only on the work folder. A report: it refuses nothing."""
import json
import os
import sys

import wallviews as wv  # noqa: F401 - puts tools/surveyed-rooms on the path and asks for one BLAS thread, as beside this file
import numpy as np

NOTHING = -9.0          # stands in for "no surface here" (an opening, a hole) in the depth images
PROUD = 0.06            # metres before the likeness: the corners step's own margin (corners.BEHIND_PROUD)
SHOWS = 0.05            # the share of a finished texel's picture above which the photograph beneath counts as showing


def bands(u0, u1, v0, length, h, w, feather):
    """The feathered edges of a patch of h x w texels, each as the slices of its band within the patch: where the
    atlas step's patch() gives the likeness less than its whole weight."""
    out = {'top': (slice(0, min(feather, h)), slice(None))}
    if u0 > 0.01:
        out['left'] = (slice(None), slice(0, min(feather, w)))
    if u1 < length - 0.01:
        out['right'] = (slice(None), slice(max(w - feather, 0), w))
    if v0 > 0.01:
        out['bottom'] = (slice(max(h - feather, 0), h), slice(None))
    return out


def replay(raw, patches, ppm, top, feather, patch, blank=None):
    """The seams of `patches`, applied in the order given, over the walls' depths `raw` (wall id -> metres before
    the wall's plane, a texel of the elevation each, NOTHING where it holds no surface). A patch is (wall id, the
    wall's length, u0, u1, v0, v1, mode, arg) as the atlas step takes it, a copy's arg being (source wall id, source
    u, mirrored). `patch` is the atlas step's patch(). `blank` (wall id -> whether no station coloured the texel, so
    that the atlas step fills it) adds the fill's counts. Returns the patches' rows (each edge's texels, beneath,
    most_m, at, shows and most_share, and with `blank` unseen and fill_shows, as the module's docstring describes
    them; rect is the patch's texels and cut its bands within them); wall by wall, the share of each finished
    texel's picture that is a thing's; and, with `blank`, the share of each texel under a patch that is fill (None
    without it)."""
    stands = {i: d.astype(np.float32)[..., None].copy() for i, d in raw.items()}   # where the picture now shown stands
    carried = {i: np.zeros(d.shape + (1,), np.float32) for i, d in raw.items()}    # a thing's share of the likenesses laid so far
    poured = {i: np.zeros(d.shape + (1,), np.float32) for i, d in raw.items()}     # fill's share of them
    own = {i: np.ones(d.shape, np.float32) for i, d in raw.items()}                # the share that is still the wall's own photograph
    thing = {i: np.zeros(d.shape, bool) for i, d in raw.items()}                   # whether that photograph shows a thing there
    patched = {i: np.zeros(d.shape, bool) for i, d in raw.items()}                 # under some patch

    def share(i):
        return carried[i] + (own[i] * thing[i])[..., None]

    def fill(i):
        return poured[i] + (own[i] * blank[i])[..., None]

    rows = []
    for n, (wid, length, u0, u1, v0, v1, mode, arg) in enumerate(patches):
        src = arg[0] if mode == 'copy' else wid
        c0, c1 = int(round(u0 * ppm)), int(round(u1 * ppm))
        r0, r1 = int(round((top - v1) * ppm)), int(round((top - v0) * ppm))
        rect = (slice(r0, r1), slice(c0, c1))
        # the likeness as placed, without its feather: where it stands, and what share of it is already a thing's
        placed = patch(stands[wid].copy(), u0, u1, v0, v1, mode, arg, length, 0, ppm, top,
                       source=stands[src] if mode == 'copy' else None)[rect][..., 0]
        brought = patch(share(wid), u0, u1, v0, v1, mode, arg, length, 0, ppm, top,
                        source=share(src) if mode == 'copy' else None)[rect][..., 0]
        # the atlas step's own weights for this patch: what it makes of ones laid over zeros
        a = patch(np.zeros_like(stands[wid]), u0, u1, v0, v1, 'copy', (None, u0, False), length, feather, ppm, top,
                  source=np.ones_like(stands[wid]))[rect][..., 0]
        mine = raw[wid][rect]
        proud = (placed > NOTHING + 1) & (mine - placed > PROUD)        # no surface beneath is far behind; none in the likeness, nothing to measure from
        beneath = proud & (own[wid][rect] > 0.5)
        if blank is not None:                                           # the fill likewise: its share of what lies beneath, and of the likeness
            under = fill(wid)[rect][..., 0]
            drawn = patch(fill(wid), u0, u1, v0, v1, mode, arg, length, 0, ppm, top,
                          source=fill(src) if mode == 'copy' else None)[rect][..., 0]
        cut = bands(u0, u1, v0, length, r1 - r0, c1 - c0, feather)
        edges = {}
        for edge, sel in cut.items():
            b = beneath[sel]
            edges[edge] = dict(texels=int(b.size), beneath=int(b.sum()),
                               most_m=round(float((mine - placed)[sel][b].max()), 3) if b.any() else 0.0)
            if b.any():                                             # where they lie, in the wall's own metres
                rr, cc = np.nonzero(b)
                us, vs = (np.arange(c0, c1)[sel[1]][cc] + 0.5) / ppm, top - (np.arange(r0, r1)[sel[0]][rr] + 0.5) / ppm
                edges[edge]['at'] = dict(u=[round(float(us.min()), 3), round(float(us.max()), 3)],
                                         v=[round(float(vs.min()), 3), round(float(vs.max()), 3)])
            if blank is not None:
                edges[edge]['unseen'] = int((under[sel] > 0.5).sum())
        thing[wid][rect] |= proud
        carried[wid][rect] = (a * brought + (1 - a) * carried[wid][rect][..., 0])[..., None]
        if blank is not None:
            poured[wid][rect] = (a * drawn + (1 - a) * poured[wid][rect][..., 0])[..., None]
        own[wid][rect] *= 1 - a
        stands[wid][rect] = placed[..., None]
        patched[wid][rect] = True
        rows.append(dict(patch=n, wall=wid, u=[round(float(u0), 4), round(float(u1), 4)], v=[v0, v1], mode=mode, source=src,
                         edges=edges, rect=rect, cut=cut))
    left = {i: share(i)[..., 0] for i in raw}                       # with every patch applied
    spilt = {i: fill(i)[..., 0] * patched[i] for i in raw} if blank is not None else None
    for row in rows:
        for edge, sel in row['cut'].items():
            t = left[row['wall']][row['rect']][sel]
            row['edges'][edge].update(shows=int((t > SHOWS).sum()), most_share=round(float(t.max()), 2) if t.size else 0.0)
            if spilt is not None:
                row['edges'][edge]['fill_shows'] = int((spilt[row['wall']][row['rect']][sel] > SHOWS).sum())
    return rows, left, spilt


def wall_depth(room, wall):
    """The wall's depth before its plane after the corners step, a texel of the elevation each (its tiles side by
    side, the top row first), NOTHING where the elevation holds no surface."""
    tiles = []
    for v in sorted(room.tiles(wall), key=lambda v: v['tile']):
        w, h = v['pixels']
        tiles.append(np.fromfile(os.path.join('out-walls', v['name'] + '.fixed.f32'), dtype=np.float32).reshape(h, w, 4)[::-1])
    P = np.concatenate(tiles, 1)
    return np.where(P[..., 3] > 0.5, room.depth(wall, P), NOTHING).astype(np.float32)


def main(argv):
    args, crops = list(argv), None
    if '--crops' in args:
        i = args.index('--crops')
        crops = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2:
        raise SystemExit(__doc__)
    work, out_path = (os.path.abspath(a) for a in args)
    from roombuild import atlas, corners, legacy  # noqa: PLC0415 - after the BLAS threads are set
    from roombuild.context import Room  # noqa: PLC0415
    os.chdir(work)                                                  # a build's files are read by their own relative names
    room = Room(os.path.join(work, 'room.json'), work)
    views = room.survey['wallViews']
    ppm, top = float(views['ppm']), views['heightRange'][1]
    feather = int(room.survey['atlas'].get('featherTexels', 10))
    listed = room.patches('photo')
    listed = [p for p in listed if p[5] != 'copy'] + [p for p in listed if p[5] == 'copy']       # the atlas step's order
    walls = {}
    for p in listed:
        walls[p[0]['id']] = p[0]
        if p[5] == 'copy':
            walls[p[6][0]['id']] = p[6][0]
    patches = [(p[0]['id'], p[0]['length'], p[1], p[2], p[3], p[4], p[5], (p[6][0]['id'], p[6][1], p[6][2]) if p[5] == 'copy' else p[6])
               for p in listed]
    raw = {i: wall_depth(room, w) for i, w in walls.items()}
    faces = {i: corners.open_mask(room, w, raw[i].shape, ppm, top) for i, w in walls.items()}     # the openings' faces, as the corners step blanks them (B7)
    photo, blank = {}, {}
    to_srgb, pack = legacy.project().linear_to_srgb, legacy.pack_atlas_functions()
    for i, w in walls.items():
        try:
            _, coloured, scale = atlas._load(room, w, to_srgb)      # the texels the atlas step takes as coloured: it fills the rest
            photo[i] = atlas._prepare(room, w, [], feather, ppm, top, pack, to_srgb)     # filled, as the atlas step holds it before its patches
        except FileNotFoundError:
            continue                                                # the walls step has not run for this wall: no colours
        H, W = raw[i].shape
        if coloured.shape == (H * scale, W * scale):                # an elevation texel none of whose photograph texels is coloured, outside the openings
            blank[i] = ~coloured.reshape(H, scale, W, scale).any(axis=(1, 3)) & ~faces[i]
    rows, left, spilt = replay(raw, patches, ppm, top, feather, atlas.patch, blank=blank if len(blank) == len(walls) else None)
    if crops:
        from PIL import Image  # noqa: PLC0415
        os.makedirs(crops, exist_ok=True)
    for row, (wid, length, u0, u1, v0, v1, mode, arg) in zip(rows, patches):
        src = row['source']
        rect = row.pop('rect')
        for edge, sel in row.pop('cut').items():
            row['edges'][edge]['in_an_opening'] = int(faces[wid][rect][sel].sum())
        if wid in photo and src in photo and photo[wid][1] == photo[src][1]:
            img, scale = photo[wid]                                 # photograph texels to an elevation texel: 2 for the 2.5 mm orthophoto
            source = photo[src][0] if mode == 'copy' else None
            R0, R1, C0, C1 = rect[0].start * scale, rect[0].stop * scale, rect[1].start * scale, rect[1].stop * scale
            m = int(round(0.2 * ppm)) * scale
            y0, y1, x0, x1 = max(R0 - m, 0), min(R1 + m, img.shape[0]), max(C0 - m, 0), min(C1 + m, img.shape[1])
            under, round_it = img[R0:R1, C0:C1].copy(), img[y0:y1, x0:x1].copy()
            likeness = atlas.patch(img.copy(), u0, u1, v0, v1, mode, arg, length, 0, ppm * scale, top, source=source)[R0:R1, C0:C1]
            img = atlas.patch(img, u0, u1, v0, v1, mode, arg, length, feather * scale, ppm * scale, top, source=source)
            photo[wid] = (img, scale)
            for edge, sel in bands(u0, u1, v0, length, R1 - R0, C1 - C0, feather * scale).items():
                d = np.abs(likeness[sel] - under[sel]).mean(axis=-1)
                row['edges'][edge].update(colour_mean=round(float(d.mean()), 1), colour_p95=round(float(np.percentile(d, 95)), 1))
            if crops:
                pair = np.concatenate([round_it, np.full((round_it.shape[0], 8, 3), 255.0, np.float32), img[y0:y1, x0:x1]], axis=1)
                row['crop'] = f"{row['patch']:02d}-{wid}-u{u0:.2f}-{u1:.2f}-v{v0:.2f}-{v1:.2f}.png"
                Image.fromarray(np.clip(pair, 0, 255).astype(np.uint8)).save(os.path.join(crops, row['crop']))
        print(f"{row['patch']} {wid} u {u0:.3f}..{u1:.3f} v {v0}..{v1} {mode} from {src}: " + '; '.join(
            f"{edge} beneath {e['beneath']}/{e['texels']} (most {e['most_m']} m"
            + (f", u {e['at']['u'][0]}..{e['at']['u'][1]} v {e['at']['v'][0]}..{e['at']['v'][1]}" if 'at' in e else '')
            + f"), shows {e['shows']} (most {e['most_share']})"
            + (f", colour {e['colour_mean']} (p95 {e['colour_p95']})" if 'colour_mean' in e else '')
            + (f", unseen {e['unseen']}, fill shows {e['fill_shows']}" if 'unseen' in e else '')
            + (f", in an opening {e['in_an_opening']}" if e['in_an_opening'] else '') for edge, e in row['edges'].items()), flush=True)
    showing = int(sum((t > SHOWS).sum() for t in left.values()))
    fill_showing = int(sum((t > SHOWS).sum() for t in spilt.values())) if spilt is not None else None
    print(f"{len(rows)} patches on {len({p[0] for p in patches})} walls; texels where the photograph of a thing that stood before the wall "
          f"still shows through a patch: {showing}; "
          + ('the fill was not counted (the walls step has not run for every wall these patches touch)' if spilt is None else
             f"texels under a patch where the fill of a place no station coloured still shows: {fill_showing}"))
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(dict(work=os.path.basename(work), feather_texels=feather, proud_over_m=PROUD, shows_over=SHOWS, showing=showing,
                       fill_showing=fill_showing, patches=rows), f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])

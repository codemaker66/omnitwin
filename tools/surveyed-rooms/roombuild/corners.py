"""Removes the neighbouring walls' fittings from each wall's corners: fix-corners.py driven by a
room config.

Per row, a proud run that starts within REACH of a corner and ends before CLEAR is a fin of the
adjacent wall: its texels move back onto this wall (the row's depth just beyond it, the median over
REF), are re-projected there, and the corrected positions are saved for the relief step
(out-walls/<view>.fixed.f32). Every tile's .fixed.f32 is written and every npz re-saved, as the
old script does. The body is fix-corners.py's; the gates the Grand Hall never opens:
  B5  a wall shorter than 2 x REF[1] gets no fin search (.fixed.f32 = its positions);
  B6  no fin search at a reflex corner (the outline steps out there: no adjacent wall in view);
  B7  methodRevision >= 2: REF and CLEAR statistics ignore texels inside window and arch
      openings and open doors, so a pier beside a bay is not pushed back to the bay's depth;
  B4  a wall that is not axis-aligned measures depth by dot product and moves fins along its normal.
"""
import warnings

import numpy as np

from . import legacy

REACH, CLEAR, REF = 0.35, 0.42, (0.45, 0.55)


def open_mask(room, wall, shape, ppm, top):
    """Texels inside the face outline of the wall's window and arch openings and open doors."""
    H, Wd = shape
    rows = top - (np.arange(H) + 0.5) / ppm
    cols = (np.arange(Wd) + 0.5) / ppm
    V, U = rows[:, None], cols[None, :]
    mask = np.zeros(shape, bool)
    for o in room.openings_on(wall):
        if o['kind'] in ('window', 'arch') or o.get('stateInScan') == 'open':
            c, half = room.opening_centre(o), o['width'] / 2
            head = o['head']
            if o['headShape'] == 'semicircular':
                topv = head + np.sqrt(np.maximum(0.0, half * half - (U - c) ** 2))
            elif o['headShape'] == 'segmental':
                rise = o['headRise']
                radius = (rise * rise + half * half) / (2 * rise)
                topv = head + rise - radius + np.sqrt(np.maximum(0.0, radius * radius - (U - c) ** 2))
            else:
                topv = head
            mask |= (np.abs(U - c) <= half) & (V >= o['sill']) & (V <= topv)
    return mask


def run(room):
    pj = legacy.use_occluders(room.occluder_tuples())
    PPM = float(room.survey['wallViews']['ppm'])
    TOP = room.survey['wallViews']['heightRange'][1]
    kw = room.projection('walls')
    for wall in room.order:
        tiles = sorted(room.tiles(wall), key=lambda v: v['tile'])
        aligned = room.aligned(wall)
        buffers = []
        for v in tiles:
            w, h = v['pixels']
            P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1].copy()
            buffers.append(P)
        P = np.concatenate(buffers, 1)
        valid = P[..., 3] > 0.5
        D = np.where(valid, room.depth(wall, P), np.nan)
        H, Wd = D.shape
        width = int(round(wall['length'] * PPM))
        fin = np.zeros(D.shape, bool)
        target = np.full(D.shape, np.nan, np.float32)
        short = wall['length'] < 2 * REF[1]                                   # B5
        reflex = dict(zip(('left', 'right'), room.ends_reflex(wall)))          # B6
        stats = D
        if room.revision >= 2:                                                  # B7
            stats = np.where(open_mask(room, wall, D.shape, PPM, TOP), np.nan, D)
        for end in ('left', 'right'):
            if short or reflex[end]:
                print(wall['name'], end, 'no fin search:', 'short wall' if short else 'reflex corner')
                continue
            cols = np.arange(0, int(REF[1] * PPM)) if end == 'left' else width - 1 - np.arange(0, int(REF[1] * PPM))
            s = (np.arange(len(cols)) + 0.5) / PPM
            Dc = D[:, cols]
            Ds = stats[:, cols] if stats is not D else Dc
            with warnings.catch_warnings():
                if stats is not D:
                    warnings.simplefilter('ignore', RuntimeWarning)          # rows wholly in an opening
                ref = np.nanmedian(Ds[:, (s >= REF[0]) & (s <= REF[1])], axis=1)
                near = Dc[:, s <= REACH]
                at_clear = np.nanmedian(Ds[:, (s >= CLEAR - 0.02) & (s <= CLEAR)], axis=1)
                # A row whose reference is NaN (B7: all in an opening) compares False: no fin.
                is_fin_row = (np.nanmax(near, axis=1) > ref + 0.15) & (at_clear < ref + 0.08)
            zone = (s <= CLEAR)[None, :] & is_fin_row[:, None] & (Dc > ref[:, None] + 0.06)
            rows_idx, zcols = np.nonzero(zone)
            fin[rows_idx, cols[zcols]] = True
            target[rows_idx, cols[zcols]] = ref[rows_idx]
            print(wall['name'], end, 'fin rows', int(is_fin_row.sum()), 'texels', int(zone.sum()))
        # Move fin texels back onto the wall: same position along the wall and up it.
        idx = np.nonzero(fin & valid)
        pts = P[idx][:, :3].astype(np.float64)
        if aligned is not None:
            axis, plane, sign = aligned
            pts[:, axis] = plane + sign * target[idx]
        else:                                                                     # B4
            pts += room.normal3(wall) * (target[idx] - D[idx]).astype(np.float64)[:, None]
        nrm = np.tile(room.normal3(wall), (len(pts), 1))
        if len(pts):
            rgb, ws = pj.project(pts, nrm, room.stations(), **kw)
        # Write corrected positions per tile and patch the projected colours.
        offset = 0
        for t, v in enumerate(tiles):
            w, h = v['pixels']
            sl = slice(offset, offset + w)
            tile_fin = fin[:, sl] & valid[:, sl]
            Pt = P[:, sl].copy()
            r, c = np.nonzero(tile_fin)
            if aligned is not None:
                Pt[r, c, axis] = plane + sign * target[:, sl][r, c]
            else:
                shift = (target[:, sl][r, c] - D[:, sl][r, c])[:, None] * room.normal3(wall)[:, :3]
                Pt[r, c, :3] = (Pt[r, c, :3] + shift).astype(np.float32)
            Pt[::-1].astype(np.float32).tofile(f"out-walls/{v['name']}.fixed.f32")
            npz = dict(np.load(f"proj/{v['name']}.npz"))
            if len(r):
                # project() returned colours in idx order; pick this tile's.
                lookup = {k: i for i, k in enumerate(np.ravel_multi_index(idx, D.shape))}
                order = np.array([lookup[k] for k in np.ravel_multi_index((r, c + offset), D.shape)])
                npz['rgb'][r, c] = rgb[order]
                npz['weight'][r, c] = ws[order]
            np.savez_compressed(f"proj/{v['name']}.npz", **npz)
            offset += w
        print(wall['name'], 'reprojected', len(pts), flush=True)

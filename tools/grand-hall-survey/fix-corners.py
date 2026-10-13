"""Removes the neighbouring walls' fittings from each wall's corners.

Each wall's orthographic view reaches 1.2 m into the room, so near a corner
it catches the sides of the adjacent wall's boards and doorcases standing
out from that wall: thin fins far proud of this wall. Per row, a proud run
that starts within 0.35 m of the corner and ends before 0.42 m is such a fin:
its texels move back onto this wall (the row's depth just beyond it), are
re-projected there from the panoramas, and the corrected positions are saved
for wall-depth.py (out-walls/<view>.fixed.f32).
Usage (in the work directory): python3 $SURVEY/fix-corners.py"""
import os
import json, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import load_views, project, stations

L, W = 21.135, 10.59
XC, YC = 8.795, -4.963
PLANES = {'window': (1, YC - W / 2, 1.0), 'door': (1, YC + W / 2, -1.0), 'end': (0, XC - L / 2, 1.0), 'fire': (0, XC + L / 2, -1.0)}
NORMALS = {'window': (0, 1, 0), 'door': (0, -1, 0), 'end': (1, 0, 0), 'fire': (-1, 0, 0)}
PPM = 200.0
REACH, CLEAR, REF = 0.35, 0.42, (0.45, 0.55)

views = load_views('views-walls.json')
for wall in ['window', 'door', 'end', 'fire']:
    tiles = sorted([v for v in views if v['wall'] == wall], key=lambda v: v['tile'])
    axis, plane, sign = PLANES[wall]
    buffers = []
    for v in tiles:
        w, h = v['pixels']
        P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1].copy()
        buffers.append(P)
    P = np.concatenate(buffers, 1)
    valid = P[..., 3] > 0.5
    D = np.where(valid, (P[..., axis] - plane) * sign, np.nan)
    H, Wd = D.shape
    width = int(round((L if wall in ('window', 'door') else W) * PPM))
    fin = np.zeros(D.shape, bool)
    target = np.full(D.shape, np.nan, np.float32)
    for end in ('left', 'right'):
        cols = np.arange(0, int(REF[1] * PPM)) if end == 'left' else width - 1 - np.arange(0, int(REF[1] * PPM))
        s = (np.arange(len(cols)) + 0.5) / PPM
        Dc = D[:, cols]
        ref = np.nanmedian(Dc[:, (s >= REF[0]) & (s <= REF[1])], axis=1)
        near = Dc[:, s <= REACH]
        at_clear = np.nanmedian(Dc[:, (s >= CLEAR - 0.02) & (s <= CLEAR)], axis=1)
        is_fin_row = (np.nanmax(near, axis=1) > ref + 0.15) & (at_clear < ref + 0.08)
        zone = (s <= CLEAR)[None, :] & is_fin_row[:, None] & (Dc > ref[:, None] + 0.06)
        rows_idx, zcols = np.nonzero(zone)
        fin[rows_idx, cols[zcols]] = True
        target[rows_idx, cols[zcols]] = ref[rows_idx]
        print(wall, end, 'fin rows', int(is_fin_row.sum()), 'texels', int(zone.sum()))
    # Move fin texels back onto the wall: same position along the wall and up it.
    idx = np.nonzero(fin & valid)
    pts = P[idx][:, :3].astype(np.float64)
    pts[:, axis] = plane + sign * target[idx]
    nrm = np.tile(np.array([NORMALS[wall]], float), (len(pts), 1))
    if len(pts):
        rgb, ws = project(pts, nrm, stations())
    # Write corrected positions per tile and patch the projected colours.
    offset = 0
    for t, v in enumerate(tiles):
        w, h = v['pixels']
        sl = slice(offset, offset + w)
        tile_fin = fin[:, sl] & valid[:, sl]
        Pt = P[:, sl].copy()
        r, c = np.nonzero(tile_fin)
        Pt[r, c, axis] = plane + sign * target[:, sl][r, c]
        Pt[::-1].astype(np.float32).tofile(f"out-walls/{v['name']}.fixed.f32")
        npz = dict(np.load(f"proj/{v['name']}.npz"))
        if len(r):
            sel = np.isin(np.ravel_multi_index(idx, D.shape), np.ravel_multi_index((r, c + offset), D.shape))
            # project() returned colours in idx order; pick this tile's.
            lookup = {k: i for i, k in enumerate(np.ravel_multi_index(idx, D.shape))}
            order = np.array([lookup[k] for k in np.ravel_multi_index((r, c + offset), D.shape)])
            npz['rgb'][r, c] = rgb[order]
            npz['weight'][r, c] = ws[order]
        np.savez_compressed(f"proj/{v['name']}.npz", **npz)
        offset += w
    print(wall, 'reprojected', len(pts), flush=True)

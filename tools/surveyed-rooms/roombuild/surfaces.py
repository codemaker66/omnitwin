"""Projection onto the walls, the ceiling, the domes and the floor: project-walls.py,
project-ceiling.py, project-dome.py and project-floor.py driven by a room config.

Each function is the old script's statements with its Grand Hall literals replaced by config
values. The projection itself is tools/grand-hall-survey/project.py, imported (legacy.project()).
Where the arithmetic changed shape, the change is an IEEE identity, so the Grand Hall's arrays are
the old ones bit for bit:
  - E57 from planner through the quarter-turn table: for the Grand Hall (turn 2)
    X = cx + (-x) == cx - x and Y = cy + z == z + cy;
  - the dome's normals: -(NR * cos) == (-NR) * cos;
  - the floor grid: x0 == -L / 2 and z1 == W / 2 exactly (2 * nearest(a) == nearest(2a)).
Run in the work directory (step.py does).
"""
import json
import subprocess
import time

import numpy as np

import roomlib

from . import legacy


def project_wall(room, name):
    """project-walls.py <name>: every elevation tile of one wall."""
    pj = legacy.use_occluders(room.occluder_tuples())
    wall = room.by_name[name]
    views = room.tiles(wall)
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
    nrm = np.tile(room.normal3(wall), (len(pts), 1))
    rgb, ws = pj.project(pts, nrm, room.stations(), **room.projection('walls'))
    offset = 0
    for (v, valid), p in zip(tiles, pts_all):
        w, h = v['pixels']
        img = np.zeros((h, w, 3), np.float32)
        img[valid] = rgb[offset:offset + len(p)]
        weight = np.zeros((h, w), np.float32)
        weight[valid] = ws[offset:offset + len(p)]
        offset += len(p)
        np.savez_compressed(f"proj/{v['name']}.npz", rgb=img, weight=weight, valid=valid)
    print(name, 'texels', len(pts), 'uncovered', int((ws == 0).sum()), round(time.time() - t0, 1), 's', flush=True)


def project_ceiling(room):
    """project-ceiling.py: the view up at the ceiling (columns planner +x, rows from planner +z)."""
    pj = legacy.use_occluders(room.occluder_tuples())
    v = room.ceiling_view()
    w, h = v['pixels']
    P = np.fromfile(f"out-walls/{v['name']}.position.f32", dtype=np.float32).reshape(h, w, 4)[::-1]
    valid = P[..., 3] > 0.5
    pts = P[valid][:, :3].astype(np.float64)
    nrm = np.tile(np.array([[0, 0, -1.0]]), (len(pts), 1))
    t0 = time.time()
    rgb, ws = pj.project(pts, nrm, room.stations(), **room.projection('ceiling'))
    img = np.zeros((h, w, 3), np.float32); img[valid] = rgb
    wt = np.zeros((h, w), np.float32); wt[valid] = ws
    np.savez_compressed('proj/ceiling.npz', rgb=img, weight=wt, valid=valid)
    pj.save_rgb('proj/ceiling.png', img.reshape(-1, 3), w, h)
    print('ceiling', len(pts), 'uncovered', int((valid & (wt == 0)).sum()), round(time.time() - t0, 1), 's', flush=True)


def dome_geometry(room, dome):
    """project-dome.py's texels: points and inward normals (H x W, flattened), unrolled by angle
    (columns, planner angle from +x towards +z) and arc length along the profile (rows, from the
    foot). Returns pts, nrm, W, H, total arc."""
    FLOOR = room.cfg['transform']['floorZ']
    DOME_C = tuple(dome['axisE57']) if 'axisE57' in dome else roomlib.to_e57(room.cfg, *dome['centre'])
    foot, sc, sr, band = dome['footRadius'], dome['sphereCentre'], dome['sphereRadius'], dome['bandTopRadius']
    crown_r, plate_r, plate_h, crown_h = dome['crownRadius'], dome['plateRadius'], dome['plateHeight'], dome['crownHeight']
    ceiling = room.cfg['ceiling']['height']
    photo = room.survey['domePhoto']
    steps = photo['profileSteps']

    def height(r):
        if r >= foot: return ceiling
        if r <= band: return min(sc + np.sqrt(max(0, sr*sr - r*r)), crown_h)
        top = sc + np.sqrt(max(0, sr*sr - band*band)); t = (r - band) / (foot - band)
        return ceiling + (top - ceiling) * np.sqrt(max(0, 1 - t*t))
    prof = [(foot - (foot - crown_r) * i / steps, 0) for i in range(steps + 1)]
    prof = [(r, height(r)) for r, _ in prof]
    prof += [(plate_r + 0.12, crown_h), (plate_r + 0.02, crown_h - 0.04), (plate_r, plate_h + 0.02), (plate_r - 0.04, plate_h), (0.0, plate_h)]
    prof = np.array(prof)
    seg = np.hypot(np.diff(prof[:, 0]), np.diff(prof[:, 1]))
    S = np.concatenate([[0], np.cumsum(seg)])
    total = S[-1]
    W, H = photo['size']
    s_rows = (np.arange(H) + 0.5) / H * total            # row 0 = foot
    r_rows = np.interp(s_rows, S, prof[:, 0])
    h_rows = np.interp(s_rows, S, prof[:, 1])
    # inward normal per row from the profile slope
    dr = np.gradient(np.interp(s_rows, S, prof[:, 0])); dh = np.gradient(np.interp(s_rows, S, prof[:, 1]))
    ln = np.hypot(dr, dh) + 1e-9
    nr = -dh / ln; nh = dr / ln
    flip = nh > 0; nr[flip] *= -1; nh[flip] *= -1
    theta = (np.arange(W) + 0.5) / W * 2 * np.pi          # planner angle from +x toward +z
    TH, R = np.meshgrid(theta, r_rows)
    _, Hh = np.meshgrid(theta, h_rows)
    _, NR = np.meshgrid(theta, nr)
    _, NH = np.meshgrid(theta, nh)
    # planner (R cos, R sin) about the measured axis -> E57 (the Grand Hall: X = C - R cos, Y = C + R sin)
    dX, dY = room.to_e57_np(R * np.cos(TH), R * np.sin(TH))
    X = DOME_C[0] + dX
    Y = DOME_C[1] + dY
    Z = Hh + FLOOR
    pts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    nX, nY = room.to_e57_np(NR * np.cos(TH), NR * np.sin(TH))
    nrm = np.stack([nX, nY, NH], -1).reshape(-1, 3)
    return pts, nrm, W, H, total


def project_dome(room, dome_id):
    """project-dome.py for one dome: texels moved onto the scanned surface along their normals
    (surface-offset.mjs), then projected."""
    pj = legacy.use_occluders(room.occluder_tuples())
    dome = next(d for d in room.cfg['ceiling']['domes'] if d['id'] == dome_id)
    pts, nrm, W, H, total = dome_geometry(room, dome)
    front, back = room.survey['domePhoto']['surfaceOffset']
    np.concatenate([pts, nrm], 1).astype(np.float32).tofile(f'proj/{dome_id}-texels.f32')
    subprocess.run(['node', legacy.survey_path('surface-offset.mjs'), f'proj/{dome_id}-texels.f32', f'proj/{dome_id}-offset.f32', repr(front), repr(back)], check=True)
    off = np.fromfile(f'proj/{dome_id}-offset.f32', dtype=np.float32).astype(np.float64)
    print('offsets: hit', int(np.isfinite(off).sum()), 'of', len(off), 'p5/50/95', np.nanpercentile(off, [5, 50, 95]).round(3), flush=True)
    off = np.where(np.isfinite(off), off, 0.0)
    np.save(f'proj/{dome_id}-offset.npy', off.reshape(H, W).astype(np.float32))
    pts = pts + nrm * off[:, None]
    t0 = time.time()
    rgb, ws = pj.project(pts, nrm, room.stations(), **room.projection('dome'))
    np.savez_compressed(f'proj/{dome_id}.npz', rgb=rgb.reshape(H, W, 3).astype(np.float32), weight=ws.reshape(H, W).astype(np.float32))
    pj.save_rgb(f'proj/{dome_id}.png', rgb, W, H)
    print(dome_id, len(pts), 'uncovered', int((ws == 0).sum()), 'arc', round(total, 3), round(time.time() - t0, 1), 's', flush=True)


def floor_grid(room):
    """project-floor.py's texels: the outline's bounding box looking down, columns planner +x,
    rows from planner +z. Returns pts (N x 3, E57), w, h, ppm."""
    t = room.cfg['transform']
    cx, cy = t['centre']
    FLOOR = t['floorZ']
    ppm = float(room.survey['floorPhoto']['ppm'])
    x0, x1, z0, z1 = room.bbox()
    w, h = int(round((x1 - x0) * ppm)), int(round((z1 - z0) * ppm))
    x = x0 + (np.arange(w) + 0.5) / ppm
    z = z1 - (np.arange(h) + 0.5) / ppm
    Xp, Zp = np.meshgrid(x, z)
    dX, dY = room.to_e57_np(Xp, Zp)
    pts = np.stack([cx + dX, cy + dY, np.full_like(Xp, FLOOR)], -1).reshape(-1, 3)
    return pts, w, h, ppm


def project_floor(room):
    """project-floor.py at the config's floorPhoto.ppm (no file-name suffix), and
    proj/floor-patches.json: the stations whose tripod patch is too strong to trust."""
    pj = legacy.use_occluders(room.occluder_tuples())
    pts, w, h, ppm = floor_grid(room)
    nrm = np.tile(np.array([[0, 0, 1.0]]), (len(pts), 1))
    t0 = time.time()
    stations = room.stations()
    rgb, ws = pj.project(pts, nrm, stations, **room.projection('floor'))
    np.savez_compressed('proj/floor.npz', rgb=rgb.reshape(h, w, 3).astype(np.float32), weight=ws.reshape(h, w).astype(np.float32))
    pj.save_rgb('proj/floor.png', rgb, w, h)
    print('floor', len(pts), 'uncovered', int((ws == 0).sum()), round(time.time() - t0, 1), 's', flush=True)
    patches = []
    for s in stations:
        radius = pj.nadir_patch_radius(s['id'], room.lod)
        if radius > 0:
            X, Y, Z = s['t']
            x, y, z = roomlib.to_planner(room.cfg, X, Y, Z)
            patches.append(dict(id=s['id'], x=round(x, 3), z=round(z, 3), height=round(y, 3), radius_deg=radius))
    with open('proj/floor-patches.json', 'w') as f:
        json.dump(patches, f, indent=1)
    print('strong tripod patches', ' '.join(f"{p['id']} {p['radius_deg']:g}" for p in patches), flush=True)

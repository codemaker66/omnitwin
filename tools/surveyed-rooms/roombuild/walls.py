"""The walls' photographs by the Grand Hall's best-view method, for any room: label-views.py,
project-walls.py --labels, canvas-veil.py, project-detail.py and pack-detail.py, run as they stand.

Nothing of the method is copied here. Each step points the Grand Hall modules' globals at the
room's values (roombuild/legacy.py: wall frames, views, stations, occluders, the atlas's frame, the
detail grid, patches, canvases) and runs the script's own main(), one process per wall, as build.sh
does. Run in the work directory (step.py does).

The one path the Grand Hall never takes is a photo patch copied from another wall (gate B20) at
2 mm: project-detail.py patches a wall from itself, so copies() applies those patches after every
wall's detail is written, as the atlas step applies them after every wall's own edits.

The method works in texels of the walls' elevations: a block is 8 x 8 of them, seams feather over 8
and blend over 24. At the Grand Hall's 200 px/m those are 40 mm, 40 mm and 120 mm.
"""
import json
import math
import os

import numpy as np

from . import legacy


def refuse_unlabelled(room, name, bestview):
    """Stops the build at a wall no station labels, saying which. project-walls.py levels and colours a
    wall from its labelled blocks: with none it ends in its own statistics (an IndexError), and a
    strip of the atlas with no photograph would be drawn as a blank wall. The label step's own
    report (proj/labels-<name>.json) says how many blocks it labelled; a wall not yet labelled is
    project-walls.py's to refuse."""
    path = os.path.join('proj', f'labels-{name}.json')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as f:
        report = json.load(f)
    if report['labelled_blocks'] > 0:
        return
    raise SystemExit(
        f"wall {name}: no station labels any block of it, so there is nothing to photograph it from "
        f"({report['texels_valid']} of its texels were rendered; {len(room.station_ids())} stations tried). "
        f"A station labels a block it sees within {bestview.MAX_DIST:g} m, at more than "
        f"{math.degrees(math.asin(bestview.COS_MIN)):.0f} degrees to the wall's face, with nothing in its depth map "
        "in front. Give the room a station that sees this wall, join the wall to a neighbour that is seen, or "
        "leave it out of survey.wallViews.order (it then gets no elevation, and the room cannot publish a record "
        "until the web's reader takes a wall without one).")


def labels(room, name):
    """label-views.py <name>: proj/labels-<name>.npz and .json. Stops at a wall no station labels."""
    bestview = legacy.best_view(room)
    legacy.run_main(legacy.label_views(), name)
    refuse_unlabelled(room, name, bestview)


def photographs(room, name):
    """project-walls.py <name> --labels: proj/<view>.fine.npz, proj/<view>.npz, proj/composite-<name>.json."""
    bestview = legacy.best_view(room)
    refuse_unlabelled(room, name, bestview)
    legacy.run_main(legacy.project_walls(room), name, '--labels')


def canvases(room, name):
    """canvas-veil.py <name>: proj/canvas-<name>.npz and .json for the wall's `canvas` edits."""
    legacy.canvasveil(room)
    legacy.run_main(legacy.canvas_veil(), name)


def detail(room, name):
    """project-detail.py <name>: proj/detail-<name>.npy and .json."""
    legacy.run_main(legacy.project_detail(room), name)


def copies(room):
    """Gate B20 at 2 mm: each photo patch copied from another wall, in config order, on the
    detail images project-detail.py wrote (px, the feather and the rounding are its patch()'s)."""
    todo = [p for p in room.patches('photo') if p[5] == 'copy']
    if not todo:
        return
    pd = legacy.project_detail(room)
    for wall, u0, u1, v0, v1, _, arg in todo:
        source_wall, source_u, mirror = arg
        path = f"proj/detail-{wall['name']}.npy"
        img = np.load(path)
        source = np.load(f"proj/detail-{source_wall['name']}.npy", mmap_mode='r')
        c0, r1 = pd.px(u0, v0)
        c1, r0 = pd.px(u1, v1)
        s0 = int(round(source_u / pd.TEXEL)) + pd.GUTTER
        src = np.asarray(source[r0:r1, s0:s0 + (c1 - c0)], np.float32)
        if mirror:
            src = src[:, ::-1]
        h, w = src.shape[:2]
        feather = pd.PATCH_FEATHER / pd.TEXEL
        ramp = lambda n: np.clip(np.arange(n) / feather, 0, 1)  # noqa: E731
        wx = np.ones(w)
        wy = np.ones(h)
        if u0 > 0.01:
            wx = np.minimum(wx, ramp(w))
        if u1 < wall['length'] - 0.01:
            wx = np.minimum(wx, ramp(w)[::-1])
        wy = np.minimum(wy, ramp(h))
        if v0 > 0.01:
            wy = np.minimum(wy, ramp(h)[::-1])
        alpha = np.minimum.outer(wy, wx)[..., None]
        dst = img[r0:r1, c0:c0 + w].astype(np.float32)
        img[r0:r1, c0:c0 + w] = np.round(dst * (1 - alpha) + src * alpha).astype(np.uint8)
        np.save(path, img)
        print('detail', wall['name'], 'patch copied from', source_wall['name'], flush=True)


def pack_detail(room):
    """pack-detail.py --atlas proj: proj/detail/<wall id>/<column>_<row>.webp and proj/detail/index.json,
    after the patches copied from other walls."""
    copies(room)
    legacy.run_main(legacy.pack_detail(room), '--atlas', 'proj')

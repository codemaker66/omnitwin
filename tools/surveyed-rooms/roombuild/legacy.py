"""The Grand Hall survey's own code (tools/grand-hall-survey), used as it stands.

project.py evaluates DATA = <cwd>/data when it is imported, so a step imports it only after
changing into the work directory: step.py runs with cwd = the work directory. The projection's
hot path (project, _station_samples, depth_lookup, the nadir weights, sample_pano) runs as the
same objects; blocked_by_chandelier reads the module global CHANDELIERS at call time, so
use_occluders() points it at a room's occluders without editing the file.

The walls' best-view method (bestview.py, label-views.py, project-walls.py --labels, canvas-veil.py,
project-detail.py, pack-detail.py) is reused the same way: best_view(), canvasveil(),
project_detail() and pack_detail() point the modules' own globals at a room's values, and
run_main() then runs the script's main() as build.sh runs the script. Each global named here must
exist in the module (point() refuses otherwise), so a renamed literal stops the build instead of
being ignored. prove-build-identity.py --static shows that the Grand Hall's config gives every one
of them the value the script was written with.
"""
import ast
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
SURVEY = os.path.normpath(os.path.join(ROOMS, "..", "grand-hall-survey"))
DEPTH_ENV = "SURVEYED_ROOMS_TEST_DEPTH_SIZE"


def survey_path(name):
    """A file in tools/grand-hall-survey."""
    return os.path.join(SURVEY, name)


def _on_path():
    if SURVEY not in sys.path:
        sys.path.insert(0, SURVEY)


def depth_override():
    """The test-only depth-map size (SURVEYED_ROOMS_TEST_DEPTH_SIZE), or None. The driver records
    it in the ledger and refuses it together with --publish."""
    value = os.environ.get(DEPTH_ENV)
    return int(value) if value else None


def project():
    """tools/grand-hall-survey/project.py, imported once (cwd must be the work directory)."""
    _on_path()
    import project as module  # noqa: PLC0415 - imported late on purpose (DATA = <cwd>/data)
    size = depth_override()
    if size is not None:
        module.DEPTH_SIZE = size
    return module


def load(name, filename):
    """A Grand Hall script loaded by path as a module (its __main__ block does not run)."""
    if name in sys.modules:
        return sys.modules[name]
    project()                      # the scripts import project from their own folder
    spec = importlib.util.spec_from_file_location(name, survey_path(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def window_relief():
    return load("gh_window_relief", "window-relief.py")


def wall_depth():
    return load("gh_wall_depth", "wall-depth.py")


def fetch_inputs():
    return load("gh_fetch_inputs", "fetch_inputs.py")


def use_occluders(occluders):
    """Points project.blocked_by_chandelier at these ((cx, cy), r, (z0, z1)) cylinders."""
    module = project()
    if not hasattr(module, "CHANDELIERS"):
        raise RuntimeError("project.py no longer has CHANDELIERS: the occluder hook is gone")
    module.CHANDELIERS = [((cx, cy), r, (z0, z1)) for (cx, cy), r, (z0, z1) in occluders]
    return module


def point(module, **values):
    """Sets a Grand Hall module's globals to a room's values; each must already be there."""
    for name, value in values.items():
        if not hasattr(module, name):
            raise RuntimeError(f"{os.path.basename(module.__file__)} no longer has {name}: the room hook is gone")
        setattr(module, name, value)
    return module


def run_main(module, *argv):
    """Runs a loaded script's main() with these arguments, as build.sh runs the script."""
    saved = sys.argv
    sys.argv = [module.__file__, *argv]
    try:
        module.main()
    finally:
        sys.argv = saved


def best_view_values(room):
    """What best_view() sets, by module: project.py's and bestview.py's globals."""
    wv = room.survey['wallViews']
    kw = room.projection('walls')
    values = dict(WALLS=room.wall_frames(), SRC_PPM=float(wv['ppm']), SRC_TOP=wv['heightRange'][1],
                  FLOOR=room.cfg['transform']['floorZ'],
                  # gate B25: 0.0 for a room without the key, which is bestview.py's own value (no margin)
                  OCCLUDER_MARGIN=room.occluder_margin())
    if 'cos_min' in kw:
        values['COS_MIN'] = kw['cos_min']
    if 'max_dist' in kw:
        values['MAX_DIST'] = kw['max_dist']
    return dict(project=dict(VIEWS=os.path.join(room.work, 'views'), STATION_IDS=frozenset(room.station_ids())),
                bestview=values)


def best_view(room):
    """bestview.py pointed at a room: its occluders, views, stations, wall frames, the top of its
    elevations, its floor and the walls' visibility limits. label-views.py, project-walls.py,
    canvas-veil.py and project-detail.py all read the room through this module."""
    pj = use_occluders(room.occluder_tuples())
    values = best_view_values(room)
    point(pj, **values['project'])
    import bestview as module  # noqa: PLC0415 - after project (DATA = <cwd>/data)
    if module.P is not pj:
        raise RuntimeError("bestview.py imported another project module")
    return point(module, **values['bestview'])


def label_views():
    return load("gh_label_views", "label-views.py")


def project_walls(room):
    """project-walls.py with the room's wall names (its argument parser reads NORMALS)."""
    return point(load("gh_project_walls", "project-walls.py"),
                 NORMALS={w['name']: tuple(room.normal3(w)[0]) for w in room.order})


def canvasveil_values(room):
    return dict(CANVASES=room.canvases(), PITCH=1.0 / float(room.survey['wallViews']['ppm']))


def canvasveil(room):
    """canvasveil.py with the room's canvases (its `canvas` edits) and the walls' texel."""
    best_view(room)
    import canvasveil as module  # noqa: PLC0415
    return point(module, **canvasveil_values(room))


def canvas_veil():
    return load("gh_canvas_veil", "canvas-veil.py")


def detail_grid(room):
    """The detail tiles' grid (survey.detail) as project-detail.py and pack-detail.py hold it."""
    d = room.survey['detail']
    unique = d['tile'] - 2 * d['gutter']
    return dict(TEXEL=d['texel'], TILE=d['tile'], GUTTER=d['gutter'], UNIQUE=unique, PITCH=unique * d['texel'])


def atlas_frame(room):
    """The atlas's layout, and its frame as the detail scripts hold it: scale, heights, strip
    height and the walls' lengths by survey name."""
    from . import atlas as atlas_step  # noqa: PLC0415 - atlas imports this module
    lay = atlas_step.layout(room)
    return lay, dict(PPM=lay['ppm'], V_MIN=lay['vRange'][0], V_MAX=lay['vRange'][1], ROW=lay['row'],
                     LENGTH={w['name']: w['length'] for w in room.order})


def project_detail_values(room):
    from . import atlas as atlas_step  # noqa: PLC0415
    ppm = float(room.survey['wallViews']['ppm'])
    feather = room.survey['atlas'].get('featherTexels', 10)
    _, frame = atlas_frame(room)
    return dict(detail_grid(room), **frame, SRC_PPM=ppm, SRC_TOP=room.survey['wallViews']['heightRange'][1],
                PATCHES=[(p[0]['name'], *p[1:]) for p in room.patches('photo') if p[5] != 'copy'],
                # featherTexels 0 (hard seams in the atlas): the script's ramp divides by the feather
                PATCH_FEATHER=feather / ppm if feather > 0 else 1e-9,
                FILL_REACH=atlas_step.FILL_PASSES / ppm,
                # B23: the atlas crops such a wall's tiles whole, so the detail maps onto that many columns
                SRC_COLUMNS=room.narrow_walls())


def project_detail(room):
    """project-detail.py pointed at a room: the detail grid, the atlas's frame, the walls' lengths
    and each wall's own photo patches (a patch copied from another wall is roombuild/walls.py's)."""
    canvasveil(room)
    return point(load("gh_project_detail", "project-detail.py"), **project_detail_values(room))


def pack_detail_values(room):
    lay, frame = atlas_frame(room)
    clear = {w['name'] for w in room.order
             if any(o['kind'] == 'window' and o['glazing'] == 'clear' for o in room.openings_on(w))}
    return dict(detail_grid(room), **frame, QUALITY=room.survey['detail'].get('quality', 86),
                NAME={w['name']: w['id'] for w in room.order}, ATLAS=room.survey['outputs']['walls'][0]['file'],
                GLASS_STRIPS={s['wall']['name']: (s['x'], s['y']) for s in lay['strips'] if s['wall']['name'] in clear})


def pack_detail(room):
    """pack-detail.py pointed at a room. Only walls with clear glazing leave out their all-glass
    tiles (the planner shows the city through clear glass); the other classes keep every tile."""
    return point(load("gh_pack_detail", "pack-detail.py"), **pack_detail_values(room))


def pack_atlas_functions():
    """pack-atlas.py's own fill and fill_sparse. The script runs its whole build when imported, so
    the two functions are taken from its source and run as written."""
    import numpy as np  # noqa: PLC0415
    return old_function(survey_path("pack-atlas.py"), ["fill", "fill_sparse"], {"np": np})


def old_function(path, names, namespace):
    """The named top-level functions and assignments of an old script, executed in `namespace`
    (which supplies np, Image and the like). Statements are taken from the script's own source,
    so the caller runs the old code itself."""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), path)
    wanted = set(names)
    body = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in wanted:
            body.append(node)
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in wanted for t in node.targets):
            body.append(node)
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Tuple) and any(isinstance(e, ast.Name) and e.id in wanted for e in t.elts) for t in node.targets):
            body.append(node)
    found = {n.name for n in body if isinstance(n, ast.FunctionDef)}
    for n in body:
        if isinstance(n, ast.Assign):
            for t in n.targets:
                found |= {t.id} if isinstance(t, ast.Name) else {e.id for e in getattr(t, "elts", []) if isinstance(e, ast.Name)}
    missing = wanted - found
    if missing:
        raise KeyError(f"{os.path.basename(path)} has no {sorted(missing)}")
    exec(compile(ast.Module(body, []), path, "exec"), namespace)  # noqa: S102 - the repo's own code
    return namespace

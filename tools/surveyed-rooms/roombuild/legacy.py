"""The Grand Hall survey's own code (tools/grand-hall-survey), used as it stands.

project.py evaluates DATA = <cwd>/data when it is imported, so a step imports it only after
changing into the work directory: step.py runs with cwd = the work directory. The projection's
hot path (project, _station_samples, depth_lookup, the nadir weights, sample_pano) runs as the
same objects; blocked_by_chandelier reads the module global CHANDELIERS at call time, so
use_occluders() points it at a room's occluders without editing the file.
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


def old_function(path, names, namespace):
    """Tests only: the named top-level functions and assignments of an old script, executed in
    `namespace` (which supplies np, Image and the like). Statements are taken from the script's
    own source, so the test runs the old code itself."""
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

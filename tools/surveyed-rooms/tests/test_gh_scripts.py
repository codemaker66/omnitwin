"""T2: the mini Grand Hall. The old scripts (tools/grand-hall-survey, run as build.sh runs them)
and the new steps (roombuild/step.py with grand-hall.room.json) run on the same synthetic inputs
at the real views' sizes, and every intermediate and output must be identical (np.array_equal
and SHA-256, through prove-build-identity.py).

Inputs: 3 stations in the hall and one outside it, 64^2 distance cubemaps of the hall's box
(SURVEYED_ROOMS_TEST_DEPTH_SIZE), 256 x 128 lossless panoramas, the 12 wall tiles with pilasters,
fins in every corner and the config's openings carved (open doors unseen, curtains and glass in
the windows), projected npz files with unseen texels, a ceiling tile valid on every 32nd row.

Stages, each under two minutes, run in order (a later test runs the earlier stages it needs):
  1 project: the end wall, the ceiling, the dome's texels (surface-offset.mjs is not run: both
    builds stop there), and the floor at 30 px/m in a second pair of trees
  2 windows   3 corners   4 atlas   5 wall depth and the GHR1 file   6 ceiling and dome
  7 floor     8 the whole trees
Scratch: SURVEYED_ROOMS_TEST_SCRATCH (default: the system temp folder).
The GHR1 comparison needs a node install with meshoptimizer: SURVEYED_ROOMS_NODE_ROOT (default: the
checkout these tools are in); it is skipped, with the reason, when there is none.
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
sys.path.insert(0, ROOMS)
sys.path.insert(0, HERE)
import synth  # noqa: E402
from roombuild import legacy  # noqa: E402
from roombuild import relief as relief_step  # noqa: E402
from roombuild.context import Room  # noqa: E402

SCRATCH = os.environ.get("SURVEYED_ROOMS_TEST_SCRATCH", os.path.join(tempfile.gettempdir(), "surveyed-rooms-tests"))
T2 = os.path.join(SCRATCH, "t2")
BASE, OLD, NEW = (os.path.join(T2, n) for n in ("base", "old", "new"))
EXTRA = os.path.join(T2, "base-overhead")
OLD30, NEW30 = os.path.join(T2, "old-floor30"), os.path.join(T2, "new-floor30")
SHIM = os.path.join(T2, "old-relief-mesh")
GH_CONFIG = os.path.join(ROOMS, "grand-hall.room.json")
RUN_OLD = os.path.join(HERE, "run_old.py")
STEP_PY = os.path.join(ROOMS, "roombuild", "step.py")
DRIVER = os.path.join(ROOMS, "build-room.py")
NODE_ROOT = os.environ.get("SURVEYED_ROOMS_NODE_ROOT", os.path.dirname(os.path.dirname(ROOMS)))
ENV = dict(os.environ, SURVEYED_ROOMS_TEST_DEPTH_SIZE="64", SURVEYED_ROOMS_NODE_ROOT=NODE_ROOT)
TIMES = {}


def _pbi():
    spec = importlib.util.spec_from_file_location("prove_build_identity", os.path.join(ROOMS, "prove-build-identity.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PBI = _pbi()


def node_ready():
    return os.path.isdir(os.path.join(NODE_ROOT, "packages", "reconstruction-foundry", "node_modules", "meshoptimizer"))


def run(argv, cwd, expect_ok=True):
    t0 = time.time()
    result = subprocess.run(argv, cwd=cwd, env=ENV, capture_output=True, text=True, encoding="utf-8", errors="replace")
    TIMES[" ".join(os.path.basename(a) for a in argv[-4:])] = round(time.time() - t0, 1)
    if expect_ok and result.returncode != 0:
        raise AssertionError(f"{argv} in {cwd} failed ({result.returncode}):\n{result.stdout[-3000:]}\n{result.stderr[-3000:]}")
    return result


def old(script, *args, cwd=OLD, expect_ok=True):
    return run([sys.executable, "-X", "utf8", RUN_OLD, legacy.survey_path(script), *args], cwd, expect_ok)


def new(step, *args, cwd=NEW, expect_ok=True):
    return run([sys.executable, "-X", "utf8", STEP_PY, step, "room.json", *args], cwd, expect_ok)


def differences(rels, old_root=OLD, new_root=NEW, mapping=None):
    out = []
    for rel in rels:
        other = (mapping or {}).get(rel, rel)
        a, b = os.path.join(old_root, rel), os.path.join(new_root, other)
        if not os.path.exists(a) or not os.path.exists(b):
            out.append(f"{rel}: missing ({os.path.exists(a)}, {os.path.exists(b)})")
            continue
        detail = PBI.compare_file(rel, a, b)
        if detail:
            out.append(f"{rel}: {detail}")
    return out


def marker(stage):
    return os.path.join(T2, f"stage-{stage}.done")


def prepare():
    shutil.rmtree(T2, ignore_errors=True)
    os.makedirs(T2)
    with open(GH_CONFIG, encoding="utf-8") as f:
        room = json.load(f)
    rng = np.random.default_rng(20261018)
    synth.write_gh_inputs(os.path.join(BASE, "data"))
    synth.write_gh_walls(room, BASE, rng)
    synth.write_gh_ceiling_tile(room, BASE)
    os.makedirs(os.path.join(EXTRA, "proj"))
    synth.write_gh_overhead_and_floor(EXTRA, rng)
    # The new tree is prepared by the driver (room.json, views/, build/) before the data arrive:
    # the synthetic manifest holds 4 of the config's 49 stations, which check_room would refuse.
    run([sys.executable, "-X", "utf8", DRIVER, GH_CONFIG, NEW, "--to", "check"], ROOMS)
    shutil.copytree(BASE, OLD)
    os.makedirs(os.path.join(OLD, "relief"))          # build.sh: mkdir -p proj relief
    shutil.copytree(BASE, NEW, dirs_exist_ok=True)
    os.makedirs(SHIM)
    shutil.copyfile(legacy.survey_path("relief-mesh.mjs"), os.path.join(SHIM, "relief-mesh.mjs"))
    with open(os.path.join(SHIM, "modules.mjs"), "w", encoding="utf-8", newline="\n") as f:
        f.write('// Test shim: relief-mesh.mjs resolves meshoptimizer from SURVEYED_ROOMS_NODE_ROOT, as nodemods.mjs does.\n'
                'import { createRequire } from "node:module";\nimport { join } from "node:path";\nimport { pathToFileURL } from "node:url";\n'
                'const foundry = createRequire(pathToFileURL(join(process.env.SURVEYED_ROOMS_NODE_ROOT, "packages", "reconstruction-foundry", "package.json")));\n'
                'export const meshoptimizer = () => import(pathToFileURL(foundry.resolve("meshoptimizer")).href);\n')


STAGES = {}


def stage(n):
    def wrap(fn):
        STAGES[n] = fn
        return fn
    return wrap


def ensure(n):
    if not os.path.exists(marker(0)):
        prepare()
        open(marker(0), "w").close()
    for k in range(1, n + 1):
        if not os.path.exists(marker(k)):
            STAGES[k]()
            open(marker(k), "w").close()


@stage(1)
def stage_project():
    old("project-walls.py", "end"); new("project-wall", "end")
    old("project-ceiling.py"); new("project-ceiling")
    # surface-offset.mjs needs three-mesh-bvh from this worktree's node_modules: both builds stop
    # there, after writing the dome's texels.
    old("project-dome.py", expect_ok=False); new("project-dome", "dome", expect_ok=False)
    # The floor at 30 px/m, in a second pair of trees: the old script takes the scale as its
    # argument (and names its files floor-30.*); the new one reads floorPhoto.ppm.
    for tree in (OLD30, NEW30):
        os.makedirs(os.path.join(tree, "proj"), exist_ok=True)
        shutil.copytree(os.path.join(BASE, "data"), os.path.join(tree, "data"), dirs_exist_ok=True)
    with open(GH_CONFIG, encoding="utf-8") as f:
        variant = json.load(f)
    variant["survey"]["floorPhoto"]["ppm"] = 30
    with open(os.path.join(NEW30, "room.json"), "w", encoding="utf-8") as f:
        json.dump(variant, f)
    old("project-floor.py", "30", cwd=OLD30); new("project-floor", cwd=NEW30)


@stage(2)
def stage_windows():
    old("window-relief.py"); new("windows")


@stage(3)
def stage_corners():
    old("fix-corners.py"); new("corners")


@stage(4)
def stage_atlas():
    old("pack-atlas.py"); new("atlas")


@stage(5)
def stage_relief():
    os.makedirs(os.path.join(OLD, "relief"), exist_ok=True)       # build.sh: mkdir -p proj relief
    old("wall-depth.py", "window", "door", "end", "fire"); new("wall-depth")
    if node_ready():
        run(["node", os.path.join(SHIM, "relief-mesh.mjs"), "proj/walls-relief.bin"], OLD)
        room = Room(GH_CONFIG, NEW)
        with open(os.path.join(NEW, "build", "relief-walls.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(relief_step.walls_job(room), f, indent=1)
        run(["node", os.path.join(ROOMS, "relief-mesh-room.mjs"), "build/relief-walls.json"], NEW)


@stage(6)
def stage_overhead():
    for tree in (OLD, NEW):
        for name in ("ceiling.npz", "dome.npz"):
            shutil.copyfile(os.path.join(EXTRA, "proj", name), os.path.join(tree, "proj", name))
    old("pack-overhead.py", "proj"); new("overhead", "proj")


@stage(7)
def stage_floor():
    for tree in (OLD, NEW):
        for name in ("floor.npz", "floor-patches.json"):
            shutil.copyfile(os.path.join(EXTRA, "proj", name), os.path.join(tree, "proj", name))
    old("flatten-floor.py", "proj/floor.npz", "proj/floor-flat.npz", "120"); new("flatten-floor", "proj/floor.npz", "proj/floor-flat.npz", "120")
    old("pack-floor.py", "proj/floor-flat.npz", "proj"); new("pack-floor", "proj/floor-flat.npz", "proj")


class MiniGrandHall(unittest.TestCase):
    def assertSame(self, rels, **kw):
        bad = differences(rels, **kw)
        self.assertEqual(bad, [], "\n".join(bad))

    def test_1_projection(self):
        ensure(1)
        self.assertSame(["proj/wall-end-0.npz", "proj/wall-end-1.npz", "proj/ceiling.npz", "proj/ceiling.png", "proj/dome-texels.f32"])
        weight = np.load(os.path.join(NEW, "proj", "wall-end-0.npz"))["weight"]
        self.assertGreater(int((weight > 0).sum()), 100000, "the end wall was barely seen: the test would prove little")
        self.assertSame(["proj/floor-30.npz", "proj/floor-30.png", "proj/floor-patches.json"], old_root=OLD30, new_root=NEW30,
                        mapping={"proj/floor-30.npz": "proj/floor.npz", "proj/floor-30.png": "proj/floor.png"})

    def test_2_windows(self):
        ensure(2)
        self.assertSame(["proj/window-glass.npy", "proj/window-layered.npy"])
        glass = np.load(os.path.join(NEW, "proj", "window-glass.npy"))
        self.assertGreater(int(glass.sum()), 10000, "no glass found: the colour test was not exercised")

    def test_3_corners(self):
        ensure(3)
        with open(os.path.join(NEW, "views", "views-walls.json"), encoding="utf-8") as f:
            views = [v["name"] for v in json.load(f)]
        self.assertSame([f"out-walls/{n}.fixed.f32" for n in views] + [f"proj/{n}.npz" for n in views])
        fixed = np.fromfile(os.path.join(NEW, "out-walls", "wall-end-0.fixed.f32"), np.float32)
        position = np.fromfile(os.path.join(NEW, "out-walls", "wall-end-0.position.f32"), np.float32)
        self.assertFalse(np.array_equal(fixed, position), "no fin was moved: the corner fix was not exercised")

    def test_4_atlas(self):
        ensure(4)
        self.assertSame(["proj/walls-4096.png", "proj/walls-4096.webp", "proj/walls-2048.webp"])

    def test_5_relief(self):
        ensure(5)
        self.assertSame([f"relief/{w}.{e}" for w in ("window", "door", "end", "fire") for e in ("f32", "json")])
        if not node_ready():
            self.skipTest(f"no meshoptimizer under {NODE_ROOT}: the GHR1 bytes were not compared")
        self.assertSame(["proj/walls-relief.bin"])
        ghr1 = PBI.load_path("ghr1", os.path.join(HERE, "ghr1.py"))
        with open(os.path.join(NEW, "proj", "walls-relief.bin"), "rb") as f:
            entries = ghr1.parse(f.read(), known_ids={"window", "end", "door", "fireplace"})
        self.assertEqual([e["id"] for e in entries], ["window", "end", "door", "fireplace"])

    def test_6_overhead(self):
        ensure(6)
        self.assertSame([f"proj/{n}" for n in ("ceiling-3072.webp", "ceiling-1536.webp", "dome-4096.webp", "dome-2048.webp")])

    def test_7_floor(self):
        ensure(7)
        self.assertSame(["proj/floor-flat.npz", "proj/floor-2560.webp", "proj/floor-1280.webp"])

    def test_8_whole_trees(self):
        ensure(7)
        rows = PBI.compare_trees(OLD, NEW)
        bad = [r for r in rows if r[1] not in ("identical", "extra")]
        self.assertEqual(bad, [], "\n".join(map(str, bad)))
        compared = [r for r in rows if r[1] == "identical"]
        self.assertGreater(len(compared), 60)

    @classmethod
    def tearDownClass(cls):
        if TIMES:
            print("\n  seconds per run: " + ", ".join(f"{k} {v}" for k, v in TIMES.items()), file=sys.stderr)


if __name__ == "__main__":
    unittest.main()

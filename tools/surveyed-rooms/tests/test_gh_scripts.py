"""T2: the mini Grand Hall. The old scripts (tools/grand-hall-survey, run as build.sh runs them)
and the new steps (roombuild/step.py with grand-hall.room.json) run on the same synthetic inputs
at the real views' sizes, and every intermediate and output must be identical (np.array_equal
and SHA-256, through prove-build-identity.py; the walls' run reports less their timings and memory).

Inputs: 5 stations in the hall and one outside it, 64^2 distance cubemaps of the hall's box
(SURVEYED_ROOMS_TEST_DEPTH_SIZE), 2048 x 1024 lossless panoramas with a grain, the 12 wall tiles
with pilasters, fins in every corner and the config's openings carved (open doors unseen, curtains
and glass in the windows), blended npz files with unseen texels for the walls the test does not
label, a ceiling tile valid on every 32nd row.

Stages, run in build.sh's order (a later test runs the earlier stages it needs). The end wall goes
through the whole best-view method; the other three walls keep their synthetic blend, so the atlas
packs both kinds of orthophoto, and their 2 mm images are synthetic:
  1 corners (all twelve tiles, positions only)
  2 labels of the end wall                       3 its photographs, and its portrait's canvas
  4 ceiling, the dome's texels (surface-offset.mjs is not run: both builds stop there), and the
    floor at 30 px/m in a second pair of trees
  5 windows   6 atlas, with and without --alpha-from   7 wall depth and the GHR1 file
  8 ceiling and dome   9 floor   10 the atlas again with a canvas's field (a stand-in: the mini
  hall's own measurement makes none)   11 the end wall at 2 mm and the detail tiles   12 the whole trees
The labels, the photographs and the 2 mm image take a few minutes each on four threads.
Scratch: SURVEYED_ROOMS_TEST_SCRATCH (default: the system temp folder).
SURVEYED_ROOMS_OLD_SCRIPTS names another folder of old scripts (default: this checkout's
tools/grand-hall-survey): an export of another commit's (`git archive <commit>
tools/grand-hall-survey`) sets this checkout's steps, and its seams in those scripts, against that
commit's scripts as they stood.
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
from PIL import Image

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
PINNED = os.path.join(T2, "published")
OLD30, NEW30 = os.path.join(T2, "old-floor30"), os.path.join(T2, "new-floor30")
SHIM = os.path.join(T2, "old-relief-mesh")
GH_CONFIG = os.path.join(ROOMS, "grand-hall.room.json")
RUN_OLD = os.path.join(HERE, "run_old.py")
STEP_PY = os.path.join(ROOMS, "roombuild", "step.py")
DRIVER = os.path.join(ROOMS, "build-room.py")
NODE_ROOT = os.environ.get("SURVEYED_ROOMS_NODE_ROOT", os.path.dirname(os.path.dirname(ROOMS)))
OLD_SCRIPTS = os.environ.get("SURVEYED_ROOMS_OLD_SCRIPTS", legacy.SURVEY)
ENV = dict(os.environ, SURVEYED_ROOMS_TEST_DEPTH_SIZE="64", SURVEYED_ROOMS_NODE_ROOT=NODE_ROOT)
ATLAS_FILES = ["proj/walls-4096.png", "proj/walls-4096.webp", "proj/walls-2048.webp"]
LAST = 11
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
    return run([sys.executable, "-X", "utf8", RUN_OLD, os.path.join(OLD_SCRIPTS, script), *args], cwd, expect_ok)


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


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def prepare():
    shutil.rmtree(T2, ignore_errors=True)
    os.makedirs(T2)
    room = load_json(GH_CONFIG)
    rng = np.random.default_rng(20261018)
    synth.write_gh_inputs(os.path.join(BASE, "data"))
    synth.write_gh_walls(room, BASE, rng)
    synth.write_gh_ceiling_tile(room, BASE)
    os.makedirs(os.path.join(EXTRA, "proj"))
    synth.write_gh_overhead_and_floor(EXTRA, rng)
    synth.write_gh_detail(room, os.path.join(EXTRA, "proj"), ("window", "door", "fire"), rng)
    synth.write_gh_canvas_field(os.path.join(EXTRA, "proj", "canvas-end.npz"))
    # The new tree is prepared by the driver (room.json, views/, build/) before the data arrive:
    # the synthetic manifest holds 6 of the config's 49 stations, which check_room would refuse.
    run([sys.executable, "-X", "utf8", DRIVER, GH_CONFIG, NEW, "--to", "check"], ROOMS)
    shutil.copytree(BASE, OLD)
    os.makedirs(os.path.join(OLD, "relief"))          # build.sh: mkdir -p proj relief
    shutil.copytree(BASE, NEW, dirs_exist_ok=True)
    os.makedirs(SHIM)
    shutil.copyfile(os.path.join(OLD_SCRIPTS, "relief-mesh.mjs"), os.path.join(SHIM, "relief-mesh.mjs"))
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
def stage_corners():
    old("fix-corners.py", "--positions-only"); new("corners")


@stage(2)
def stage_labels():
    old("label-views.py", "end"); new("labels", "end")


@stage(3)
def stage_photographs():
    old("project-walls.py", "end", "--labels"); new("wall-photo", "end")
    old("canvas-veil.py", "end"); new("canvases", "end")


@stage(4)
def stage_project():
    old("project-ceiling.py"); new("project-ceiling")
    # surface-offset.mjs needs three-mesh-bvh from this worktree's node_modules: both builds stop
    # there, after writing the dome's texels.
    old("project-dome.py", expect_ok=False); new("project-dome", "dome", expect_ok=False)
    # The floor at 30 px/m, in a second pair of trees: the old script takes the scale as its
    # argument (and names its files floor-30.*); the new one reads floorPhoto.ppm.
    for tree in (OLD30, NEW30):
        os.makedirs(os.path.join(tree, "proj"), exist_ok=True)
        shutil.copytree(os.path.join(BASE, "data"), os.path.join(tree, "data"), dirs_exist_ok=True)
    variant = load_json(GH_CONFIG)
    variant["survey"]["floorPhoto"]["ppm"] = 30
    with open(os.path.join(NEW30, "room.json"), "w", encoding="utf-8") as f:
        json.dump(variant, f)
    old("project-floor.py", "30", cwd=OLD30); new("project-floor", cwd=NEW30)


@stage(5)
def stage_windows():
    old("window-relief.py"); new("windows")


def keep_plain():
    """Copies both trees' atlases to proj/plain before a variant overwrites them."""
    for tree in (OLD, NEW):
        os.makedirs(os.path.join(tree, "proj", "plain"), exist_ok=True)
        for rel in ATLAS_FILES:
            shutil.copyfile(os.path.join(tree, rel), os.path.join(tree, "proj", "plain", os.path.basename(rel)))


def set_aside(folder):
    """Moves both trees' atlases (a variant's) to proj/<folder> and puts the plain ones back."""
    for tree in (OLD, NEW):
        os.makedirs(os.path.join(tree, "proj", folder), exist_ok=True)
        for rel in ATLAS_FILES:
            name = os.path.basename(rel)
            os.replace(os.path.join(tree, rel), os.path.join(tree, "proj", folder, name))
            os.replace(os.path.join(tree, "proj", "plain", name), os.path.join(tree, rel))
        os.rmdir(os.path.join(tree, "proj", "plain"))


@stage(6)
def stage_atlas():
    old("pack-atlas.py"); new("atlas")
    # A "published" atlas with another alpha (the old tree's own colour, a rectangle of glass), then
    # both again with --alpha-from it; those atlases are set aside in proj/pinned, and the trees
    # keep the plain ones for the detail tiles.
    os.makedirs(PINNED, exist_ok=True)
    rgba = np.asarray(Image.open(os.path.join(OLD, "proj", "walls-4096.png")).convert("RGBA")).copy()
    rgba[..., 3] = 255
    rgba[300:900, 500:1500, 3] = 128
    Image.fromarray(rgba, "RGBA").save(os.path.join(PINNED, "walls-4096.webp"), lossless=True)
    keep_plain()
    old("pack-atlas.py", "--alpha-from", PINNED); new("atlas", "--alpha-from", PINNED)
    set_aside("pinned")


@stage(7)
def stage_relief():
    os.makedirs(os.path.join(OLD, "relief"), exist_ok=True)       # build.sh: mkdir -p proj relief
    old("wall-depth.py", "window", "door", "end", "fire"); new("wall-depth")
    if node_ready():
        run(["node", os.path.join(SHIM, "relief-mesh.mjs"), "proj/walls-relief.bin"], OLD)
        room = Room(GH_CONFIG, NEW)
        with open(os.path.join(NEW, "build", "relief-walls.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(relief_step.walls_job(room), f, indent=1)
        run(["node", os.path.join(ROOMS, "relief-mesh-room.mjs"), "build/relief-walls.json"], NEW)


@stage(8)
def stage_overhead():
    for tree in (OLD, NEW):
        for name in ("ceiling.npz", "dome.npz"):
            shutil.copyfile(os.path.join(EXTRA, "proj", name), os.path.join(tree, "proj", name))
    old("pack-overhead.py", "proj"); new("overhead", "proj")


@stage(9)
def stage_floor():
    for tree in (OLD, NEW):
        for name in ("floor.npz", "floor-patches.json"):
            shutil.copyfile(os.path.join(EXTRA, "proj", name), os.path.join(tree, "proj", name))
    old("flatten-floor.py", "proj/floor.npz", "proj/floor-flat.npz", "120"); new("flatten-floor", "proj/floor.npz", "proj/floor-flat.npz", "120")
    old("pack-floor.py", "proj/floor-flat.npz", "proj"); new("pack-floor", "proj/floor-flat.npz", "proj")


@stage(10)
def stage_canvas():
    if not os.path.exists(os.path.join(EXTRA, "proj", "canvas-end.npz")):       # a scratch folder prepared before this stage existed
        synth.write_gh_canvas_field(os.path.join(EXTRA, "proj", "canvas-end.npz"))
    for tree in (OLD, NEW):
        shutil.copyfile(os.path.join(EXTRA, "proj", "canvas-end.npz"), os.path.join(tree, "proj", "canvas-end.npz"))
    keep_plain()
    old("pack-atlas.py"); new("atlas")
    set_aside("with-canvas")                      # the trees keep the plain atlases; the 2 mm image takes the field in stage 11


@stage(11)
def stage_detail():
    old("project-detail.py", "end"); new("detail", "end")
    for tree in (OLD, NEW):
        for name in ("window", "door", "fire"):
            shutil.copyfile(os.path.join(EXTRA, "proj", f"detail-{name}.npy"), os.path.join(tree, "proj", f"detail-{name}.npy"))
    old("pack-detail.py", "--atlas", "proj"); new("pack-detail")


class MiniGrandHall(unittest.TestCase):
    def assertSame(self, rels, **kw):
        bad = differences(rels, **kw)
        self.assertEqual(bad, [], "\n".join(bad))

    def test_01_corners(self):
        ensure(1)
        views = [v["name"] for v in load_json(os.path.join(NEW, "views", "views-walls.json"))]
        self.assertSame([f"out-walls/{n}.fixed.f32" for n in views])
        fixed = np.fromfile(os.path.join(NEW, "out-walls", "wall-end-0.fixed.f32"), np.float32)
        position = np.fromfile(os.path.join(NEW, "out-walls", "wall-end-0.position.f32"), np.float32)
        self.assertFalse(np.array_equal(fixed, position), "no fin was moved: the corner fix was not exercised")

    def test_02_labels(self):
        ensure(2)
        self.assertSame(["proj/labels-end.npz", "proj/labels-end.json"])
        lb = np.load(os.path.join(NEW, "proj", "labels-end.npz"))
        report = load_json(os.path.join(NEW, "proj", "labels-end.json"))
        used = np.unique(lb["label"][lb["label"] >= 0])
        self.assertGreaterEqual(len(used), 3, "fewer than three stations label the wall: no seams to level")
        self.assertGreater(report["seams"], 200)
        self.assertGreater(report["sweep"]["blocks"], 1000, "the depth sweep was barely exercised")
        self.assertIn("alpha-expansion", report["method"])
        self.assertGreater(report["texels_labelled"], 0.5 * report["texels_valid"])       # 64-texel depth maps hide the rest

    def test_03_photographs(self):
        ensure(3)
        self.assertSame([f"proj/wall-end-{t}{ext}" for t in (0, 1) for ext in (".fine.npz", ".npz")] + ["proj/composite-end.json"])
        report = load_json(os.path.join(NEW, "proj", "composite-end.json"))
        self.assertGreaterEqual(report["stations_used"], 3)
        self.assertGreater(report["global_adjustment"]["seam_equations"], 100, "the seams' colour adjustment was barely exercised")
        self.assertGreater(report["poisson_free_texels"], 10000, "the seams' membrane was barely exercised")
        fine = np.load(os.path.join(NEW, "proj", "wall-end-0.fine.npz"))
        self.assertGreater(float(fine["valid"].mean()), 0.5)                         # 64-texel depth maps hide the rest
        # the canvas: both measure it and both decline (through 64-texel depth maps only one station
        # sees it whole); stage 10 exercises the field's application
        self.assertSame(["proj/canvas-end.json"])
        self.assertIn("end-portrait", load_json(os.path.join(NEW, "proj", "canvas-end.json"))["canvases"])

    def test_04_projection(self):
        ensure(4)
        self.assertSame(["proj/ceiling.npz", "proj/ceiling.png", "proj/dome-texels.f32"])
        self.assertSame(["proj/floor-30.npz", "proj/floor-30.png", "proj/floor-patches.json"], old_root=OLD30, new_root=NEW30,
                        mapping={"proj/floor-30.npz": "proj/floor.npz", "proj/floor-30.png": "proj/floor.png"})

    def test_05_windows(self):
        ensure(5)
        self.assertSame(["proj/window-glass.npy", "proj/window-layered.npy"])
        glass = np.load(os.path.join(NEW, "proj", "window-glass.npy"))
        self.assertGreater(int(glass.sum()), 10000, "no glass found: the colour test was not exercised")

    def test_06_atlas(self):
        ensure(6)
        self.assertSame(ATLAS_FILES)
        self.assertSame([f"proj/pinned/{os.path.basename(rel)}" for rel in ATLAS_FILES])
        plain = np.asarray(Image.open(os.path.join(NEW, "proj", "walls-4096.png")))
        pinned = np.asarray(Image.open(os.path.join(NEW, "proj", "pinned", "walls-4096.png")))
        self.assertTrue(np.array_equal(plain[..., :3], pinned[..., :3]), "--alpha-from changed the colour")
        self.assertEqual(int((pinned[..., 3] == 128).sum()), 600 * 1000, "--alpha-from did not take the published alpha")
        self.assertGreater(int((plain[..., 3] < 192).sum()), 10000, "the window wall's glass is not in the alpha")

    def test_07_relief(self):
        ensure(7)
        self.assertSame([f"relief/{w}.{e}" for w in ("window", "door", "end", "fire") for e in ("f32", "json")])
        if not node_ready():
            self.skipTest(f"no meshoptimizer under {NODE_ROOT}: the GHR1 bytes were not compared")
        self.assertSame(["proj/walls-relief.bin"])
        ghr1 = PBI.load_path("ghr1", os.path.join(HERE, "ghr1.py"))
        with open(os.path.join(NEW, "proj", "walls-relief.bin"), "rb") as f:
            entries = ghr1.parse(f.read(), known_ids={"window", "end", "door", "fireplace"})
        self.assertEqual([e["id"] for e in entries], ["window", "end", "door", "fireplace"])

    def test_08_overhead(self):
        ensure(8)
        self.assertSame([f"proj/{n}" for n in ("ceiling-3072.webp", "ceiling-1536.webp", "dome-4096.webp", "dome-2048.webp")])

    def test_09_floor(self):
        ensure(9)
        self.assertSame(["proj/floor-flat.npz", "proj/floor-2560.webp", "proj/floor-1280.webp"])

    def test_10_canvas_in_the_atlas(self):
        ensure(10)
        self.assertSame([f"proj/with-canvas/{os.path.basename(rel)}" for rel in ATLAS_FILES])
        before = np.asarray(Image.open(os.path.join(NEW, "proj", "walls-4096.png"))).astype(int)
        after = np.asarray(Image.open(os.path.join(NEW, "proj", "with-canvas", "walls-4096.png"))).astype(int)
        changed = np.abs(after - before).max(axis=-1) > 0
        self.assertGreater(int(changed.sum()), 50000, "the canvas's field changed nothing")
        ys, xs = np.nonzero(changed)
        self.assertGreaterEqual(int(ys.min()), 2 * 1304)                              # the end wall's strip only: rows 2608 on,
        self.assertLess(int(xs.max()), 2048)                                           # columns 0 to 2047

    def test_11_detail(self):
        ensure(11)
        self.assertSame(["proj/detail-end.npy", "proj/detail-end.json"])
        index = load_json(os.path.join(NEW, "proj", "detail", "index.json"))
        tiles = [f"proj/detail/{wall}/{t['column']}_{t['row']}.webp" for wall, w in index["walls"].items() for t in w["tiles"]]
        self.assertSame(["proj/detail/index.json"] + tiles)
        self.assertEqual(list(index["walls"]), ["window", "door", "end", "fireplace"])
        self.assertEqual(index["tiles"], len(tiles))
        grid = {wall: (w["columns"], w["rows"]) for wall, w in index["walls"].items()}
        self.assertEqual(grid, {"window": (22, 7), "door": (22, 7), "end": (11, 7), "fireplace": (11, 7)})
        detail = np.load(os.path.join(NEW, "proj", "detail-end.npy"), mmap_mode="r")
        self.assertEqual(detail.shape, (7 * 496 + 16, 11 * 496 + 16, 3))

    def test_12_whole_trees(self):
        ensure(LAST)
        rows = PBI.compare_trees(OLD, NEW)
        bad = [r for r in rows if r[1] not in ("identical", "extra")]
        self.assertEqual(bad, [], "\n".join(map(str, bad)))
        compared = [r for r in rows if r[1] == "identical"]
        self.assertGreater(len(compared), 500)

    @classmethod
    def tearDownClass(cls):
        if TIMES:
            print("\n  seconds per run: " + ", ".join(f"{k} {v}" for k, v in TIMES.items()), file=sys.stderr)


if __name__ == "__main__":
    unittest.main()

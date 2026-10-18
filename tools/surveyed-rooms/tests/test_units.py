"""T1: the new steps' functions against the old scripts' own, on random and synthetic arrays.

Old functions are taken from the old scripts' source (legacy.old_function) or imported
(window-relief.py, wall-depth.py), so each comparison runs the old code itself. Everything must be
bit for bit equal. The GHR1 comparison runs the old relief-mesh.mjs (copied byte for byte beside
a shim modules.mjs) against relief-mesh-room.mjs; it needs a node install with meshoptimizer
(SURVEYED_ROOMS_NODE_ROOT, default: the checkout these tools are in) and is skipped without one.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
sys.path.insert(0, ROOMS)
sys.path.insert(0, HERE)
import ghr1  # noqa: E402
import roomlib  # noqa: E402
import synth  # noqa: E402
from roombuild import atlas, corners, floor, legacy, overhead, relief, windows  # noqa: E402
from roombuild.context import Room  # noqa: E402

SCRATCH = os.environ.get("SURVEYED_ROOMS_TEST_SCRATCH", os.path.join(tempfile.gettempdir(), "surveyed-rooms-tests"))
T1 = os.path.join(SCRATCH, "t1")
NODE_ROOT = os.environ.get("SURVEYED_ROOMS_NODE_ROOT", os.path.dirname(os.path.dirname(ROOMS)))
GH = Room(os.path.join(ROOMS, "grand-hall.room.json"), work=ROOMS)
SALOON = Room(os.path.join(ROOMS, "saloon.room.json"), work=ROOMS)


def old(script, names, **extra):
    ns = dict(np=np, Image=Image, ImageFilter=ImageFilter, os=os, json=json, **extra)
    return legacy.old_function(legacy.survey_path(script), names, ns)


def same(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return a.shape == b.shape and a.dtype == b.dtype and np.ascontiguousarray(a).tobytes() == np.ascontiguousarray(b).tobytes()


def node_ready():
    return os.path.isdir(os.path.join(NODE_ROOT, "packages", "reconstruction-foundry", "node_modules", "meshoptimizer"))


class Atlas(unittest.TestCase):
    def test_fill_and_patches_match_pack_atlas(self):
        pa = old("pack-atlas.py", ["SRC_PPM", "SRC_TOP", "fill", "px", "patch"])
        rng = np.random.default_rng(1)
        img = (rng.random((1410, 4228, 3)) * 255).astype(np.float32)
        valid = rng.random((1410, 4228)) > 0.01
        valid[:, 100:140] = False
        a, b = pa["fill"](img, valid), atlas.fill(img, valid)
        self.assertTrue(same(a, b))
        for wall, u0, u1, v0, v1, mode, arg in GH.patches("photo"):
            x, y = a.copy(), a.copy()
            x = pa["patch"](x, u0, u1, v0, v1, mode, arg, wall["length"])
            y = atlas.patch(y, u0, u1, v0, v1, mode, arg, wall["length"], 10, 200.0, 7.0)
            self.assertTrue(same(x, y), f"patch on {wall['id']} {mode}")
            self.assertFalse(same(x, a), "the patch changed nothing")

    def test_copy_patch_takes_the_other_wall(self):
        rng = np.random.default_rng(2)
        target = np.zeros((400, 600, 3), np.float32)
        source = (rng.random((400, 600, 3)) * 255).astype(np.float32)
        for mirror in (False, True):
            out = atlas.patch(target.copy(), 0.0, 1.0, 0.0, 1.0, "copy", (None, 1.5, mirror), 3.0, 0, 200.0, 2.0, source=source)
            want = source[200:400, 300:500]
            self.assertTrue(np.array_equal(out[200:400, 0:200], want[:, ::-1] if mirror else want))

    def test_overhead_fill_matches_pack_overhead(self):
        po = old("pack-overhead.py", ["fill"])
        rng = np.random.default_rng(3)
        img = rng.random((300, 500, 3)).astype(np.float32)
        valid = rng.random((300, 500)) > 0.3
        self.assertTrue(same(po["fill"](img, valid), overhead.fill(img, valid)))

    def test_shelf_packing_of_the_saloon(self):
        lay = atlas.layout(SALOON)
        self.assertEqual((lay["width"], lay["height"], lay["row"], lay["packing"]), (4096, 2304, 1111, "next-fit"))
        self.assertEqual(len(lay["strips"]), 12)
        boxes = [(s["x"], s["y"], s["x"] + s["w"], s["y"] + lay["row"]) for s in lay["strips"]]
        for i, a in enumerate(boxes):
            self.assertTrue(a[2] <= 4096 and a[3] <= 2304)
            for b in boxes[i + 1:]:
                self.assertFalse(a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3], f"{a} overlaps {b}")
        for s in lay["strips"]:
            self.assertEqual(s["w"], int(np.ceil(s["wall"]["length"] * 200)))

    def test_gutters_repeat_the_edges(self):
        lay = dict(row=4, strips=[dict(x=0, y=0, w=3), dict(x=5, y=0, w=2), dict(x=0, y=6, w=4)])
        rgb = np.zeros((12, 10, 3), np.float32)
        alpha = np.zeros((12, 10), np.float32)
        rgb[0:4, 0:3] = 1; rgb[0:4, 5:7] = 2; rgb[6:10, 0:4] = 3
        atlas._fill_gutters(rgb, alpha, lay)
        self.assertTrue((rgb[0:4, 3, 0] == 1).all() and (rgb[0:4, 4, 0] == 2).all() and (rgb[0:4, 7:, 0] == 2).all())
        self.assertTrue((rgb[4, :, 0] == rgb[3, :, 0]).all() and (rgb[5, :, 0] == rgb[6, :, 0]).all())
        self.assertTrue((rgb[6:10, 4:, 0] == 3).all())


class Relief(unittest.TestCase):
    def setUp(self):
        self.wd = old("wall-depth.py", ["PPM", "TOP", "px", "patch", "CORNER_ZONE", "INTRUSION", "clear_corner_intrusions", "fill", "denoise"])
        rng = np.random.default_rng(4)
        D = (rng.normal(size=(1410, 2118)) * 0.05).astype(np.float32)
        D[rng.random(D.shape) < 0.01] = np.nan
        D[200:400, 10:150] = 0.85            # a neighbour's bench end-on in the left corner zone
        D[600:700, 2000:2100] = 0.95
        self.D = D

    def test_fill_and_denoise_are_wall_depths_own(self):
        wd = legacy.wall_depth()
        filled = wd.fill(self.D)
        self.assertTrue(same(self.wd["fill"](self.D), filled))
        keep = np.zeros(self.D.shape, bool); keep[:, :500] = True
        self.assertTrue(same(self.wd["denoise"](filled, keep), relief.denoise_range(filled, keep, -1.2, 1.2)))

    def test_corner_intrusions_match(self):
        filled = np.clip(self.wd["fill"](self.D), -1.0, 0.9)
        a = self.wd["clear_corner_intrusions"](filled.copy(), 10.59)
        b = relief.clear_corner_intrusions(filled.copy(), 10.59, 200.0)
        self.assertTrue(same(a, b))
        self.assertFalse(same(a, filled))
        left_kept = relief.clear_corner_intrusions(filled.copy(), 10.59, 200.0, skip=(True, False))
        self.assertTrue(same(left_kept[:, :180], filled[:, :180]))           # B9: that end untouched
        short = relief.clear_corner_intrusions(filled.copy(), 10.59, 200.0, short=True)
        self.assertTrue((short[200:400, 10:150] == 0).all())                  # B8: reference 0

    def test_patches_and_recess_match(self):
        filled = self.wd["fill"](self.D)
        D = np.concatenate([filled, filled], 1)[:, :4228]
        for wall, u0, u1, v0, v1, mode, arg in GH.patches("relief"):
            x, y = D.copy(), D.copy()
            self.wd["patch"](x, u0, u1, v0, v1, mode, arg)
            relief.patch(y, u0, u1, v0, v1, mode, arg, 200.0, 7.0)
            self.assertTrue(same(x, y), f"relief patch on {wall['id']}")
        (wall, u0, u1, v0, v1, depth), = GH.recesses("relief")
        self.assertEqual([self.wd["px"](u0, v0), self.wd["px"](u1, v1)], [relief.px(u0, v0, 200.0, 7.0), relief.px(u1, v1, 200.0, 7.0)])


class Floor(unittest.TestCase):
    def test_blurs_match_flatten_floor(self):
        ff = old("flatten-floor.py", ["gauss1d", "blur", "masked_blur"])
        rng = np.random.default_rng(5)
        a = rng.random((127, 254, 3))
        m = (rng.random((127, 254)) > 0.2).astype(np.float64)
        for s in (0.7, 3.0, 9.5):
            self.assertTrue(same(ff["gauss1d"](s), floor.gauss1d(s)))
            self.assertTrue(same(ff["blur"](a, s), floor.blur(a, s)))
            self.assertTrue(same(ff["blur"](m, s), floor.blur(m, s)))
            self.assertTrue(same(ff["masked_blur"](a, m, s), floor.masked_blur(a, m, s)))

    def test_flatten_and_pack_floor_match_the_scripts(self):
        work = os.path.join(T1, "floor")
        shutil.rmtree(work, ignore_errors=True)
        for side in ("old", "new"):
            os.makedirs(os.path.join(work, side, "proj"))
        rng = np.random.default_rng(6)
        h, w = 127, 254
        rgb = (0.3 + 0.1 * rng.random((h, w, 3))).astype(np.float32)
        weight = (rng.random((h, w)) > 0.05).astype(np.float32)
        for side in ("old", "new"):
            np.savez_compressed(os.path.join(work, side, "proj", "floor.npz"), rgb=rgb, weight=weight)
            with open(os.path.join(work, side, "proj", "floor-patches.json"), "w") as f:
                json.dump([dict(id="scan_001", x=-2.0, z=1.0, height=1.5, radius_deg=12.0)], f, indent=1)
        cmd = [sys.executable, "-X", "utf8", os.path.join(HERE, "run_old.py")]
        subprocess.run(cmd + [legacy.survey_path("flatten-floor.py"), "proj/floor.npz", "proj/floor-flat.npz", "12"], cwd=os.path.join(work, "old"), check=True, capture_output=True)
        subprocess.run(cmd + [legacy.survey_path("pack-floor.py"), "proj/floor-flat.npz", "proj"], cwd=os.path.join(work, "old"), check=True, capture_output=True)
        here = os.getcwd()
        os.chdir(os.path.join(work, "new"))
        try:
            floor.flatten(GH, "proj/floor.npz", "proj/floor-flat.npz", 12.0)
            floor.pack(GH, "proj/floor-flat.npz", "proj")
        finally:
            os.chdir(here)
        a, b = np.load(os.path.join(work, "old", "proj", "floor-flat.npz")), np.load(os.path.join(work, "new", "proj", "floor-flat.npz"))
        self.assertTrue(same(a["rgb"], b["rgb"]) and same(a["weight"], b["weight"]))
        self.assertFalse(same(a["rgb"], rgb), "flatten changed nothing")
        for name in ("floor-2560.webp", "floor-1280.webp"):
            with open(os.path.join(work, "old", "proj", name), "rb") as f1, open(os.path.join(work, "new", "proj", name), "rb") as f2:
                self.assertEqual(f1.read(), f2.read(), name)


class Projection(unittest.TestCase):
    """project.project with use_occluders(config) is the untouched module: identical for the Grand
    Hall's occluders; a ray through a Saloon electrolier is blocked."""

    def test_grand_hall_occluders_change_nothing(self):
        data = os.path.join(T1, "proj", "data")
        shutil.rmtree(os.path.dirname(data), ignore_errors=True)
        synth.write_gh_inputs(data, depth_size=32, pano=(128, 64))
        pj = legacy.project()
        saved = (pj.DATA, pj.DEPTH_SIZE, list(pj.CHANDELIERS))
        try:
            pj.DATA, pj.DEPTH_SIZE = data, 32
            rng = np.random.default_rng(7)
            pts = np.stack([np.full(3000, -1.7725), rng.uniform(-10.2, 0.3, 3000), rng.uniform(0.1, 6.6, 3000)], -1)
            nrm = np.tile(np.array([[1.0, 0.0, 0.0]]), (3000, 1))
            stations_old = pj.stations()
            rgb1, w1 = pj.project(pts, nrm, stations_old)
            legacy.use_occluders(GH.occluder_tuples())
            stations_new = GH.stations(os.path.join(data, "manifest.json"))
            rgb2, w2 = pj.project(pts, nrm, stations_new, **GH.projection("walls"))
            self.assertTrue(same(rgb1, rgb2) and same(w1, w2))
            self.assertGreater(int((w1 > 0).sum()), 300)
        finally:
            pj.DATA, pj.DEPTH_SIZE, pj.CHANDELIERS = saved[0], saved[1], saved[2]

    def test_a_ray_through_an_electrolier_is_blocked(self):
        pj = legacy.project()
        saved = list(pj.CHANDELIERS)
        try:
            legacy.use_occluders(SALOON.occluder_tuples())
            (cx, cy), r, (z0, z1) = SALOON.occluder_tuples()[0]
            S = np.array([cx - 2.0, cy, 4.0])
            P = np.array([[cx + 2.0, cy, 4.2], [cx + 2.0, cy, 2.0], [cx + 2.0, cy + 2.5, 4.2]])
            self.assertEqual(pj.blocked_by_chandelier(S, P).tolist(), [True, False, False])
            # Below the body. (An exactly horizontal segment, |vz| <= 1e-9, counts as inside every
            # cylinder's height span in project.py: a quirk of the old code, kept, never met in data.)
            S_low = np.array([cx - 2.0, cy, 2.0])
            self.assertEqual(pj.blocked_by_chandelier(S_low, np.array([[cx + 2.0, cy, 2.1]])).tolist(), [False])
        finally:
            pj.CHANDELIERS = saved


class Windows(unittest.TestCase):
    def test_tops_match_window_relief(self):
        wr = legacy.window_relief()
        U = np.linspace(0, 4, 401)[None, :]
        for shape, kind in (("semicircular", "arched-window"), ("square", "window")):
            self.assertTrue(same(np.broadcast_to(wr.top_at(kind, 2.0, 2.7, 3.76, U), U.shape),
                                 np.broadcast_to(windows._top(shape, 2.0, 2.7, 3.76, None, U), U.shape)))
        seg = windows._top("segmental", 2.0, 2.0, 3.0, 0.4, np.array([1.0, 2.0, 3.0]))
        self.assertTrue(np.allclose(seg, [3.0, 3.4, 3.0]))
        for u in (1.2, 2.0, 2.7):
            self.assertAlmostEqual(roomlib.outline_top("segmental", 2.0, 2.0, 3.0, u, 0.4), float(windows._top("segmental", 2.0, 2.0, 3.0, 0.4, np.array(u))))

    def test_two_planes_and_bars(self):
        glass = SALOON.openings["window-centre"]["glass"]
        V = np.array([[1.4], [3.4], [3.5], [3.53], [5.0]])
        self.assertEqual(windows.plane_depths(glass, V)[:, 0].tolist(), [-0.546, -0.546, -0.546, -0.596, -0.596])
        self.assertEqual(windows.bar_rows(glass, V)[:, 0].tolist(), [False, False, True, False, False])


class Geometry(unittest.TestCase):
    def test_saloon_walls(self):
        for w in SALOON.walls:
            self.assertIsNotNone(SALOON.aligned(w), w["id"])
            self.assertLessEqual(len(SALOON.relief_id(w)), 12)
        reflex = {w["id"]: SALOON.ends_reflex(w) for w in SALOON.walls}
        self.assertEqual(reflex["window-front-end"], (True, False))
        self.assertEqual(reflex["window-front-return"], (False, True))
        self.assertEqual(reflex["front"], (False, False))
        self.assertEqual(sum(a + b for a, b in reflex.values()), 8)

    def test_grand_hall_walls(self):
        self.assertEqual([GH.ends_reflex(w) for w in GH.walls], [(False, False)] * 4)
        self.assertEqual([w["name"] for w in GH.order], ["window", "door", "end", "fire"])

    def test_open_mask_covers_bays_and_open_doors(self):
        wall = SALOON.wmap["front"]
        mask = corners.open_mask(SALOON, wall, (1130, 1402), 200.0, 5.6)
        self.assertTrue(mask[1100, int(1.434 * 200)])              # in the open lobby door
        self.assertFalse(mask[1100, int(4.0 * 200)])               # panelling (the store door is closed anyway)

    def test_old_function_refuses_missing_names(self):
        with self.assertRaises(KeyError):
            old("pack-atlas.py", ["fill", "no_such_function"])


class Inputs(unittest.TestCase):
    """The inputs step against a twin on disk (file://): fetch_inputs.py's own fetch and hashes."""

    def setUp(self):
        import hashlib
        self.base = os.path.join(T1, "inputs")
        shutil.rmtree(self.base, ignore_errors=True)
        twin, self.work = os.path.join(self.base, "twin"), os.path.join(self.base, "work")
        files = {"mesh/dollhouse.glb": b"glTF fake mesh", "tiles/scan_000/equirect_8192.webp": b"pano 0",
                 "tiles/scan_001/equirect_8192.webp": b"pano 1"}
        for rel, data in files.items():
            os.makedirs(os.path.dirname(os.path.join(twin, rel)), exist_ok=True)
            with open(os.path.join(twin, rel), "wb") as f:
                f.write(data)
        self.hashes = {rel: hashlib.sha256(data).hexdigest() for rel, data in files.items()}
        nodes = [dict(id=f"scan_00{i}", pose=dict(t=[0, 0, 1.5]), exposure=dict(gain=1.0, wb=[1, 1, 1])) for i in range(3)]
        with open(os.path.join(twin, "manifest.json"), "w") as f:
            json.dump(dict(nodes=nodes, mesh=dict(path="mesh/dollhouse.glb"), contentHashes=self.hashes), f)
        with open(os.path.join(ROOMS, "grand-hall.room.json"), encoding="utf-8") as f:
            room = json.load(f)
        room["stations"] = room["stations"][:2]
        room["source"]["meshSha256"] = self.hashes["mesh/dollhouse.glb"]
        os.makedirs(self.work)
        with open(os.path.join(self.work, "room.json"), "w", encoding="utf-8") as f:
            json.dump(room, f)
        self.url = "file:///" + twin.replace(os.sep, "/").lstrip("/")

    def step(self):
        return subprocess.run([sys.executable, "-X", "utf8", os.path.join(ROOMS, "roombuild", "step.py"), "inputs", "room.json", self.url],
                              cwd=self.work, capture_output=True, text=True)

    def test_fetches_and_checks_every_file(self):
        r = self.step()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.count("ok "), 3)
        for name in ("manifest.json", "dollhouse.glb", "pano8k/scan_000_8192.webp", "pano8k/scan_001_8192.webp"):
            self.assertTrue(os.path.exists(os.path.join(self.work, "data", name)), name)
        self.assertFalse(os.path.exists(os.path.join(self.work, "data", "pano8k", "scan_002_8192.webp")))

    def test_refuses_a_file_that_is_not_the_manifests(self):
        os.makedirs(os.path.join(self.work, "data", "pano8k"))
        with open(os.path.join(self.work, "data", "pano8k", "scan_001_8192.webp"), "wb") as f:
            f.write(b"something else")
        r = self.step()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("HASH MISMATCH tiles/scan_001/equirect_8192.webp", r.stdout)


class ReliefMesh(unittest.TestCase):
    """The old relief-mesh.mjs and relief-mesh-room.mjs on the same synthetic depth maps."""

    @classmethod
    def setUpClass(cls):
        if not node_ready():
            raise unittest.SkipTest(f"no meshoptimizer under {NODE_ROOT}")
        cls.work = os.path.join(T1, "mesh")
        shutil.rmtree(cls.work, ignore_errors=True)
        os.makedirs(os.path.join(cls.work, "relief"))
        os.makedirs(os.path.join(cls.work, "proj"))
        os.makedirs(os.path.join(cls.work, "shim"))
        shutil.copyfile(legacy.survey_path("relief-mesh.mjs"), os.path.join(cls.work, "shim", "relief-mesh.mjs"))
        with open(os.path.join(cls.work, "shim", "modules.mjs"), "w", encoding="utf-8", newline="\n") as f:
            f.write('import { createRequire } from "node:module";\nimport { join } from "node:path";\nimport { pathToFileURL } from "node:url";\n'
                    'const foundry = createRequire(pathToFileURL(join(process.env.SURVEYED_ROOMS_NODE_ROOT, "packages", "reconstruction-foundry", "package.json")));\n'
                    'export const meshoptimizer = () => import(pathToFileURL(foundry.resolve("meshoptimizer")).href);\n')
        rng = np.random.default_rng(8)
        for name, width in (("window", 420), ("end", 300), ("door", 420), ("fire", 300)):
            yy, xx = np.mgrid[0:700, 0:width]
            D = (0.05 * np.sin(xx / 13.0) * (yy % 97 < 60) + 0.002 * rng.normal(size=(700, width))).astype(np.float32)
            D[100:300, 50:120] = -0.6
            D.tofile(os.path.join(cls.work, "relief", f"{name}.f32"))
            with open(os.path.join(cls.work, "relief", f"{name}.json"), "w") as f:
                json.dump({"width": width, "height": 700, "ppm": 100.0, "top": 7.0, "length": width / 100}, f)
        cls.env = dict(os.environ, SURVEYED_ROOMS_NODE_ROOT=NODE_ROOT)

    def node(self, *args, check=True):
        return subprocess.run(["node", *args], cwd=self.work, env=self.env, capture_output=True, text=True, check=check)

    def test_walls_identical_to_relief_mesh(self):
        self.node(os.path.join(self.work, "shim", "relief-mesh.mjs"), "proj/old.bin")
        job = relief.walls_job(GH)
        job["out"] = "proj/new.bin"
        with open(os.path.join(self.work, "job.json"), "w") as f:
            json.dump(job, f)
        self.node(os.path.join(ROOMS, "relief-mesh-room.mjs"), "job.json")
        with open(os.path.join(self.work, "proj", "old.bin"), "rb") as f1, open(os.path.join(self.work, "proj", "new.bin"), "rb") as f2:
            a, b = f1.read(), f2.read()
        self.assertEqual(a, b)
        entries = ghr1.parse(b, known_ids={"window", "end", "door", "fireplace"})
        self.assertEqual([e["id"] for e in entries], ["window", "end", "door", "fireplace"])
        for e in entries:
            # Counter-clockwise seen from the room: the signed (u, v) area is the whole wall's.
            u0, u1, v0, v1 = e["ranges"][:4]
            self.assertAlmostEqual(ghr1.triangle_normals(e)[:, 2].sum() / 2 / ((u1 - u0) * (v1 - v0)), 1.0, places=3)

    def test_offset_entry_and_long_ids(self):
        job = dict(out="proj/offset.bin", error=0.005, entries=[dict(id="ceiling", file="relief/end", u0=-3.0, vRange=[0, 7.0], dRange=[-1, 0.9])])
        with open(os.path.join(self.work, "offset.json"), "w") as f:
            json.dump(job, f)
        self.node(os.path.join(ROOMS, "relief-mesh-room.mjs"), "offset.json")
        with open(os.path.join(self.work, "proj", "offset.bin"), "rb") as f:
            (entry,) = ghr1.parse(f.read())
        self.assertAlmostEqual(entry["ranges"][0], -3.0, places=6)
        self.assertAlmostEqual(entry["ranges"][1], 0.0, places=6)
        self.assertGreaterEqual(entry["positions"][:, 0].min(), -3.0 - 1e-6)
        job["entries"][0]["id"] = "fireplace-front-return"
        with open(os.path.join(self.work, "long.json"), "w") as f:
            json.dump(job, f)
        result = self.node(os.path.join(ROOMS, "relief-mesh-room.mjs"), "long.json", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1-12 ASCII", result.stderr)


if __name__ == "__main__":
    unittest.main()

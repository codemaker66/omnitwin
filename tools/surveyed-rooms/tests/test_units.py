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
from unittest import mock

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
    def test_fills_are_pack_atlas_own_and_patches_match(self):
        pa = old("pack-atlas.py", ["SRC_PPM", "SRC_TOP", "fill", "fill_sparse", "px", "patch"])
        own = legacy.pack_atlas_functions()
        rng = np.random.default_rng(1)
        img = (rng.random((1410, 4228, 3)) * 255).astype(np.float32)
        valid = rng.random((1410, 4228)) > 0.01
        valid[:, 100:140] = False
        a = pa["fill"](img, valid)
        self.assertTrue(same(a, own["fill"](img, valid, atlas.FILL_PASSES)))
        self.assertTrue(same(pa["fill_sparse"](img, valid, 80), own["fill_sparse"](img, valid, 2 * atlas.FILL_PASSES)))
        self.assertFalse(same(a, img), "the fill changed nothing")
        for wall, u0, u1, v0, v1, mode, arg in GH.patches("photo"):
            x, y = a.copy(), a.copy()
            x = pa["patch"](x, u0, u1, v0, v1, mode, arg, wall["length"])
            y = atlas.patch(y, u0, u1, v0, v1, mode, arg, wall["length"], 10, 200.0, 7.0)
            self.assertTrue(same(x, y), f"patch on {wall['id']} {mode}")
            self.assertFalse(same(x, a), "the patch changed nothing")
        # at the 2.5 mm orthophoto's scale, as pack-atlas.py calls it (feather and ppm doubled), on the shorter walls
        fine = (rng.random((2820, 4236, 3)) * 255).astype(np.float32)
        for wall, u0, u1, v0, v1, mode, arg in GH.patches("photo"):
            if wall["length"] < 15:
                x = pa["patch"](fine.copy(), u0, u1, v0, v1, mode, arg, wall["length"], feather=20, ppm=400.0)
                y = atlas.patch(fine.copy(), u0, u1, v0, v1, mode, arg, wall["length"], 20, 400.0, 7.0)
                self.assertTrue(same(x, y), f"2.5 mm patch on {wall['id']} {mode}")
                self.assertFalse(same(x, fine), "the patch changed nothing")

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


class MarginViews(unittest.TestCase):
    """Gate B25's own functions (bestview.py, label-views.py) on small arrays: how far a ray passes from its nearest
    occluder, and which station a texel takes when none of its block's ranked stations saw it clear."""

    @classmethod
    def setUpClass(cls):
        legacy.project()
        import bestview  # noqa: PLC0415 - after project.py, as the steps import it
        cls.B = bestview
        blas = {k: os.environ.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}
        cls.lv = legacy.label_views()               # sets one BLAS thread for its own process: not this one's children
        for k, v in blas.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def margin(self, metres):
        return mock.patch.object(self.B, "OCCLUDER_MARGIN", metres)

    def test_clearance_says_what_the_gate_says(self):
        B = self.B
        rng = np.random.default_rng(452)
        size = 64
        cube = rng.uniform(0.5, 6.0, (6, size, size)).astype(np.float32)
        cube[0, 20:30, 20:40] = 0.8
        cube[2, 40:44, 10:60] = 1.1
        v = rng.normal(size=(20000, 3))
        dist, cos = rng.uniform(0.6, 6.0, 20000), rng.uniform(0.2, 1.0, 20000)
        for metres in (0.01, 0.03, 0.05, 0.2):
            with self.margin(metres):
                clear = B.clear_of_occluders(B.occluder_cube(cube), v, dist, cos)
                away = B.occluder_clearance(cube, v, dist, cos)
            self.assertEqual(away.dtype, np.float32)
            self.assertGreater(int(clear.sum()), 200, metres)
            self.assertGreater(int((~clear).sum()), 200, metres)
            # clear of the margin exactly where the nearest occluder stands farther off than the margin
            self.assertTrue(np.array_equal(clear, away > np.float32(metres)), metres)
        with self.margin(0.05):                                     # points on the only surface there is: no occluder
            flat = B.occluder_clearance(np.full((6, size, size), 3.0, np.float32), v, np.full(20000, 3.0), np.ones(20000))
        self.assertTrue(np.all(np.isinf(flat)))

    def test_clearance_is_the_distance_from_the_occluders_outline(self):
        B = self.B
        size = 64
        cube = np.full((6, size, size), 3.0, np.float32)
        cube[0, :, :30] = 2.0                                       # an occluder 2 m off over one face's columns 0 to 29
        dirs = synth.cube_directions(size)[0, 32, 30:50]            # rays through row 32, 1 to 20 texels beyond its edge
        self.assertEqual(B.cube_texel(np.broadcast_to(np.arange(size, dtype=np.float32), (6, size, size)), dirs).tolist(),
                         list(range(30, 50)))
        dist, cos = np.full(20, 3.0), np.ones(20)                   # the wall behind, seen head-on
        with self.margin(0.05):
            away = B.occluder_clearance(cube, dirs, dist, cos)
        texels = np.arange(1, 21)
        expected = 2.0 * texels * B.texel_angle(size)[32, 30:50]    # its distance x texels from the ray x the texel's angle
        self.assertTrue(np.allclose(away[:16], expected[:16], rtol=1e-6, atol=0))
        self.assertTrue(np.all(np.diff(away[:16]) > 0))             # the farther from the outline, the more clearance
        self.assertTrue(np.all(np.isinf(away[16:])))                # beyond MARGIN_TEXELS nothing is looked for
        self.assertEqual(B.MARGIN_TEXELS, 16)
        # Where the margin is capped. Sixteen 1/32 rad texels span half the surface's distance: 0.4 m at an occluder
        # 0.8 m off, less than a margin of 0.5 m; beyond them the nearest surface is the wall, 3 m off (1.5 m).
        cube[0, :, :30] = 0.8
        with self.margin(0.5):
            self.assertEqual(B.margin_capped(B.occluder_cube(cube), dirs).tolist(), [True] * 16 + [False] * 4)
        with self.margin(0.05):                                     # 0.4 m is far more than 50 mm
            self.assertFalse(B.margin_capped(B.occluder_cube(cube), dirs).any())
        self.assertFalse(B.margin_capped(np.full((6, size, size), np.inf, np.float32), dirs).any())    # no surface within the margin

    def test_a_clear_view_is_taken_from_any_station_in_the_blocks_order(self):
        lv, B = self.lv, self.B
        S, n = 9, 2 * B.BLOCK
        self.assertGreater(S, lv.RANKED)
        D = np.tile((0.1 * np.arange(S)).reshape(S, 1, 1), (1, 1, 2))        # one row of two blocks; station 0 the best, 8 the worst
        keep = np.ones((S, 1, 2), bool)
        keep[8] = False                                              # station 8: not a candidate, ranked after them by its cover
        keep[:, 0, 1] = False                                        # the second block: no station passed for a candidate
        cover = np.full((S, 1, 2), 0.97, np.float32)
        cover[:, 0, 1] = 0.0
        cover[3, 0, 1], cover[7, 0, 1] = 0.02, 0.05                  # two stations saw a little of it clear, station 7 the more
        label = np.array([[0, -1]])                                  # so it has no label, and ranked_lists gives it no list
        ranked = lv.ranked_lists(D, label, keep, cover)
        order = lv.whole_order(D, label, keep, cover)
        self.assertEqual(ranked[0, 0].tolist(), [0, 1, 2, 3, 4, 5])
        self.assertTrue(np.all(ranked[0, 1] == -1))
        self.assertEqual(order[0, 0].tolist(), list(range(S)))       # every station, the ranking first
        self.assertEqual(order[0, 1].tolist(), [7, 3] + [-1] * (S - 2))     # without a label: by how much each saw, most first
        self.assertEqual(order.dtype, np.int16)
        clear = np.zeros((S, B.BLOCK, n), bool)
        clear[:, :, :2] = True                                       # columns 0 and 1: every station
        clear[6:, :, 2:4] = True                                     # columns 2 and 3: stations 6, 7 and 8, none of them ranked
        clear[8, :, 4:6] = True                                      # columns 4 and 5: station 8 alone
        second = B.BLOCK                                             # the block without a label begins at this column
        clear[3, :, second:second + 5] = True                        # its columns 0 to 4: station 3
        clear[7, :, second + 2:second + 7] = True                    # its columns 2 to 6: station 7, which saw more of the block
        bits = B.pack_bits(clear)
        valid = np.ones((B.BLOCK, n), bool)
        tlab = lv.texel_labels(ranked, bits, valid, (0, 1, 0, 2))
        self.assertEqual(sorted(np.unique(tlab).tolist()), [-1, 0])
        self.assertTrue(np.all(tlab[:, second:] == -1))              # the ranking alone leaves the whole second block without a station
        out, outside = lv.clear_views(order, tlab, bits)
        self.assertTrue(np.all(out[:, :2] == 0) and np.all(out[:, 2:4] == 6) and np.all(out[:, 4:6] == 8))
        self.assertTrue(np.all(out[:, 6:second] == -1))              # no station saw the first block's other columns
        # The block without a label: a texel a station saw clear takes it all the same, and where two did, the one
        # that saw more of the block. (label-views.py's main() cannot make such a block today: while candidates()
        # keeps the station that covers a block best, a block without a label has no clear texel. This is the guard
        # for the day that changes.) What no station saw clear stays as it was.
        self.assertTrue(np.all(out[:, second:second + 2] == 3) and np.all(out[:, second + 2:second + 7] == 7))
        self.assertTrue(np.all(out[:, second + 7:] == -1))
        self.assertEqual(outside, 4 * B.BLOCK + 7 * B.BLOCK)
        self.assertTrue(np.array_equal(tlab, lv.texel_labels(ranked, bits, valid, (0, 1, 0, 2))))   # the input is not written to

    def test_a_doubtful_view_is_the_first_of_the_blocks_sequence_that_saw_the_texel(self):
        """T-739. A texel that stations saw, and none clear, takes the first station of its block's sequence that
        saw it: the block's own stations first, never the station that merely passes farthest from the occluder
        (the rule this replaced, which the Saloon's real walls did not bear out)."""
        lv, B = self.lv, self.B
        H = W = B.BLOCK
        S = 4
        seen, clear = np.zeros((S, H, W), bool), np.zeros((S, H, W), bool)
        away = np.zeros((S, H, W), np.float32)
        sequence = np.array([[[2, 0, 1, -1, 2, 3, -1]]], np.int16)   # the block's own station is 2; 3 comes last, 2 twice
        seen[:, 0, 0] = True; away[:, 0, 0] = (0.035, 0.045, 0.010, 0.049)   # the block's own saw it: taken, though 3 passes farthest
        seen[(1, 3), 0, 1] = True; away[(1, 3), 0, 1] = (0.020, 0.049)       # its own did not see it: the next of the sequence that did
        seen[3, 0, 2] = True; away[3, 0, 2] = 0.004                  # only the last of the sequence saw it
        seen[(0, 1), 0, 3] = True; clear[1, 0, 3] = True            # station 1 saw it clear, and it has that label
        seen[(0, 2), 0, 4] = True; clear[2, 0, 4] = True            # a station saw it clear: no doubtful view, whatever its label
        tlab = np.full((H, W), -1, np.int16)
        tlab[0, 3] = 1
        grid = mock.Mock(depth=np.zeros((H, W), np.float32), n=np.array([0.0, 0.0, 1.0]),
                         points=lambda r, c, d: np.stack([r, c, d], -1).astype(np.float64))
        stations = [dict(id=k, t=np.zeros(3)) for k in range(S)]

        def clearance(cube, v, dist, cos):                           # `cube` is the station (load_depth below); v is (row, column, 0)
            return away[cube, v[:, 0].astype(int), v[:, 1].astype(int)]

        stats = dict(visbits=B.pack_bits(clear), seenbits=B.pack_bits(seen))
        with mock.patch.object(lv.P, "load_depth", lambda sid: sid), mock.patch.object(B, "occluder_clearance", clearance):
            out, bits, given = lv.doubtful_views(grid, stations, tlab, stats, sequence)
        self.assertEqual(out[0, :6].tolist(), [2, 1, 3, 1, -1, -1])
        self.assertTrue(np.all(out[1:] == -1))
        self.assertTrue(np.allclose(given, [0.010, 0.020, 0.004]))  # reported for each view given; it decides nothing
        self.assertEqual(given.dtype, np.float32)
        used = B.unpack_bits(bits, W)
        self.assertTrue(np.all(clear <= used))
        self.assertEqual(sorted(zip(*(a.tolist() for a in np.nonzero(used & ~clear)))), [(1, 0, 1), (2, 0, 0), (3, 0, 2)])   # station, row, column
        self.assertTrue(np.array_equal(stats["visbits"], B.pack_bits(clear)))     # the clear views are not written to

    def test_the_sequence_for_a_doubtful_view_is_the_ranking_then_every_station_by_what_it_saw(self):
        """T-739. Per block: its ranked stations (a block without a label borrows the nearest labelled block's),
        then every station that saw any of the block at all, most first, so that a texel a station saw always
        finds a view; none that saw nothing of it."""
        lv, B = self.lv, self.B
        S, n = 9, 3 * B.BLOCK
        ranked = np.full((1, 3, lv.RANKED), -1, np.int16)
        ranked[0, 0] = [4, 1, 0, 2, 3, 5]
        ranked[0, 2] = [7, 8, -1, -1, -1, -1]
        label = np.array([[4, -1, 7]])                               # the middle block has no label: it borrows a neighbour's ranking
        seen = np.zeros((S, B.BLOCK, n), bool)
        seen[6, :, :5] = True                                        # block 0: station 6 saw five columns of it,
        seen[8, :, :2] = True                                        # station 8 two,
        seen[4, :, :1] = True                                        # its own station one (it stands in both halves),
        seen[2, :, :2] = True                                        # and station 2 two as well: of equals, the earlier station
        seen[3, :, B.BLOCK:B.BLOCK + 3] = True                       # block 1: station 3 alone
        seq = lv.doubtful_sequence(ranked, label, B.pack_bits(seen), n)
        self.assertEqual(seq.shape, (1, 3, lv.RANKED + S))
        self.assertEqual(seq.dtype, np.int16)
        self.assertEqual(seq[0, 0].tolist(), [4, 1, 0, 2, 3, 5] + [6, 2, 8, 4] + [-1] * 5)
        self.assertIn(seq[0, 1, :lv.RANKED].tolist(), ([4, 1, 0, 2, 3, 5], [7, 8, -1, -1, -1, -1]))   # the nearest labelled block's
        self.assertEqual(seq[0, 1, lv.RANKED:].tolist(), [3] + [-1] * 8)
        self.assertEqual(seq[0, 2].tolist(), [7, 8] + [-1] * 13)     # nobody saw any of it at all: the ranking alone
        # More stations than the ranking holds saw the block: every one of them is in the sequence.
        many = np.zeros((S, B.BLOCK, n), bool)
        for s in range(S):
            many[s, :, :s] = True                                    # station s saw s columns of block 0; station 0 none
        self.assertGreater(S - 1, lv.RANKED)
        seq = lv.doubtful_sequence(ranked, label, B.pack_bits(many), n)
        self.assertEqual(seq[0, 0, lv.RANKED:].tolist(), [8, 7, 6, 5, 4, 3, 2, 1, -1])

    def test_a_statistics_cache_is_good_for_its_own_margin_alone(self):
        lv = self.lv
        bits = np.zeros((1, 1, 1), np.uint8)
        plain = dict(visbits=bits)                                                # made without a margin: none of its arrays
        made_at_50 = dict(visbits=bits, seenbits=bits, occluder_margin=np.float64(0.05))
        unrecorded = dict(visbits=bits, seenbits=bits)                            # the margin's arrays, from before it was recorded
        with self.margin(0.0):
            lv.same_margin("X:/elsewhere/stats.npz", plain)
            with self.assertRaisesRegex(SystemExit, r"stats\.npz: these statistics were made with an occluder margin of 0\.05 m; this run's is 0 m"):
                lv.same_margin("X:/elsewhere/stats.npz", made_at_50)
            with self.assertRaisesRegex(SystemExit, "an occluder margin they do not record; this run's is 0 m"):
                lv.same_margin("X:/elsewhere/stats.npz", unrecorded)
        with self.margin(0.05):
            lv.same_margin("X:/elsewhere/stats.npz", made_at_50)
            with self.assertRaisesRegex(SystemExit, r"an occluder margin of 0 m; this run's is 0\.05 m\. Remove the file"):
                lv.same_margin("X:/elsewhere/stats.npz", plain)                   # no margin's arrays, and a margin is set
            with self.assertRaisesRegex(SystemExit, "do not record"):
                lv.same_margin("X:/elsewhere/stats.npz", unrecorded)
        with self.margin(0.08):
            with self.assertRaisesRegex(SystemExit, r"an occluder margin of 0\.05 m; this run's is 0\.08 m"):
                lv.same_margin("X:/elsewhere/stats.npz", made_at_50)


class WallMeasure(unittest.TestCase):
    """measure/walls/wallviews.py: the measure the wall scripts share, on a small wall. A texel is set against the
    clean texels within reach on its own surface, and against nothing else."""

    @classmethod
    def setUpClass(cls):
        import importlib.util  # noqa: PLC0415
        blas = {k: os.environ.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}
        spec = importlib.util.spec_from_file_location("wallviews", os.path.join(ROOMS, "measure", "walls", "wallviews.py"))
        cls.wv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.wv)
        for k, v in blas.items():                                   # it asks for one BLAS thread for its own runs: not this process's
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def test_a_texel_is_set_against_its_clean_neighbours_on_its_own_surface(self):
        wv = self.wv
        H = W = 3 * wv.REACH
        L = np.full((H, W), 100.0, np.float32)
        depth = np.zeros((H, W), np.float32)
        depth[:, W // 2:] = 0.05                                    # a thing 5 cm proud over the right half
        L[:, W // 2:] = 40.0                                        # and darker
        clean = np.ones((H, W), bool)
        mid = H // 2
        clean[mid, :] = False                                       # the row under test is not its own surroundings
        r = np.array([mid, mid, mid])
        c = np.array([W // 2 - 1, W // 2, 2])                       # the last plaster column, the thing's first, and one near the wall's end
        ref, count = wv.surroundings(L, clean, depth, r, c)
        self.assertEqual(ref.tolist(), [100.0, 40.0, 100.0])        # each against its own surface, though the other is a texel away
        self.assertEqual(ref.dtype, np.float32)
        rows = 2 * wv.REACH                                         # the rows within reach, less the texel's own
        self.assertEqual(count.tolist(), [rows * (wv.REACH + 1), rows * (wv.REACH + 1), rows * (2 + wv.REACH + 1)])
        # A neighbour that is not clean, or lies another surface away, never counts; a texel with none is not judged.
        ref, count = wv.surroundings(L, np.zeros((H, W), bool), depth, r, c)
        self.assertTrue(np.all(np.isnan(ref)) and np.all(count == 0))
        depth[mid, 5] = 0.02                                        # a texel alone on its own level: nothing within 10 mm of it
        ref, count = wv.surroundings(L, clean, depth, np.array([mid]), np.array([5]))
        self.assertEqual(count.tolist(), [0])
        self.assertLess(wv.NEAR_DEPTH, 0.02)

    def test_luminance_is_in_srgb_levels(self):
        wv = self.wv
        rgb = np.array([[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.2140, 0.2140, 0.2140]]], np.float32)
        out = wv.levels(rgb)
        self.assertEqual(out.shape, (1, 3))
        self.assertTrue(np.allclose(out[0], [0.0, 255.0, 127.5], atol=0.3))   # linear 0.214 is sRGB's mid grey
        bits = np.zeros((2, 1, 1), np.uint8)
        bits[1, 0, 0] = 0b01000000                                  # station 1 saw column 1
        self.assertEqual(wv.bit(bits, np.array([0, 1, 1]), np.array([0, 0, 0]), np.array([1, 1, 0])).tolist(), [False, True, False])

    def test_two_builds_are_counted_as_pairs_with_an_exact_sign_test(self):
        wv = self.wv
        self.assertEqual(wv.sign_test(0, 0), 1.0)                   # nothing changed: no evidence either way
        self.assertEqual(wv.sign_test(5, 5), 1.0)                   # as many each way
        self.assertEqual(wv.sign_test(0, 5), 2 / 32)                # all five one way: both tails of (1/2)^5
        self.assertEqual(wv.sign_test(9, 1), 2 * (1 + 10) / 1024)   # C(10, 0) + C(10, 1) of 2^10, both tails
        self.assertEqual(wv.sign_test(1, 9), wv.sign_test(9, 1))    # which build is called worse does not change it
        self.assertLess(wv.sign_test(841, 367), 1e-30)              # the Saloon's second build, its dark texels: not chance
        self.assertTrue(0.3 < wv.sign_test(6000, 6100) < 0.4)       # a large near-even split says nothing, and is exact all the same
        among = np.array([True, True, True, True, False])
        worse = np.array([True, False, False, False, True])         # the last is not among the texels counted
        better = np.array([False, True, True, False, False])
        self.assertEqual(wv.paired_counts(worse, better, among), dict(worse=1, better=2, unchanged=1, p_exact=1.0))


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

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

    @staticmethod
    def old_order(D, keep, cover, label):
        """One block's order in the first form of the first step (whole_order, now gone), by the key ranked_lists
        uses: the label, the other candidates by data cost, then the other stations by how much of the block they
        saw clear; a block without a label, every station by how much of it it saw clear. D, keep and cover are the
        block's (stations,) arrays. Here only to show that a test tells the two rules apart."""
        if label < 0:
            key = np.where(cover > 0, -cover, np.inf)
        else:
            key = np.minimum(np.where(keep, D, np.inf), np.where(~keep & (cover > 0), 100 + (1 - cover), np.inf))
            key[label] = -1.0
        return [int(s) for s in np.argsort(key, kind="stable") if np.isfinite(key[s])]

    def first_step(self, D, keep, label, seen, clear):
        """The labels' chain on (stations, H, W) views: ranked_lists (clear cover from `clear`), texel_labels,
        block_sequence and clear_views. Returns the ranking, the sequence, the ranking's texel labels and the step's."""
        lv, B = self.lv, self.B
        S, H, W = clear.shape
        nby, nbx = label.shape
        cover = np.moveaxis(B.block_sum(np.moveaxis(clear, 0, -1).astype(np.float32), nby, nbx), -1, 0) / B.BLOCK ** 2
        ranked = lv.ranked_lists(D, label, keep, cover)
        tlab = lv.texel_labels(ranked, B.pack_bits(clear), np.ones((H, W), bool), (0, nby, 0, nbx))
        sequence = lv.block_sequence(ranked, label, B.pack_bits(seen), W)
        out, _ = lv.clear_views(sequence, tlab, B.pack_bits(clear))
        return ranked, sequence, tlab, out

    def doubtful(self, tlab, seen, clear, sequence):
        """doubtful_views on (stations, H, W) views, every view's clearance 0 (it is reported and decides nothing).
        Returns the texel labels and the bits to colour from, unpacked."""
        lv, B = self.lv, self.B
        S, H, W = seen.shape
        grid = mock.Mock(depth=np.zeros((H, W), np.float32), n=np.array([0.0, 0.0, 1.0]),
                         points=lambda r, c, d: np.stack([r, c, d], -1).astype(np.float64))
        stats = dict(visbits=B.pack_bits(clear), seenbits=B.pack_bits(seen))
        with mock.patch.object(lv.P, "load_depth", lambda sid: sid), \
                mock.patch.object(B, "occluder_clearance", lambda cube, v, dist, cos: np.zeros(len(v), np.float32)):
            out, bits, _ = lv.doubtful_views(grid, [dict(id=k, t=np.zeros(3)) for k in range(S)], tlab, stats, sequence)
        return out, B.unpack_bits(bits, W)

    def ranked_six(self, S=8):
        """One block and S stations. Stations 0 to 5 are candidates (station s: data cost 0.1 s) that saw the whole
        block, all of it clear but texel (0, 0), which they saw within a margin: they are its ranking, and (0, 0)
        asks the block's sequence. The other stations saw nothing yet."""
        n = self.B.BLOCK
        D = (0.1 * np.arange(S)).reshape(S, 1, 1)
        keep = np.zeros((S, 1, 1), bool)
        keep[:6] = True
        seen = np.zeros((S, n, n), bool)
        seen[:6] = True
        clear = seen.copy()
        clear[:6, 0, 0] = False
        return D, keep, np.array([[0]]), seen, clear

    def random_wall(self, seed):
        """Three rows of four blocks and seven stations, each seeing a random share of each block at all and about
        60% of that clear; one block no station saw. keep stands in for candidates() (a clear cover of 0.4 or more),
        the label is the kept station of least data cost, and two blocks a station saw clear are left without one."""
        rng = np.random.default_rng(seed)
        S, nby, nbx, n = 7, 3, 4, self.B.BLOCK
        share = rng.choice([0.0, 0.2, 0.6, 1.0], size=(S, nby, nbx))
        share[:, 1, 2] = 0.0
        seen = rng.random((S, nby * n, nbx * n)) < np.kron(share, np.ones((n, n)))
        clear = seen & (rng.random(seen.shape) < 0.6)
        cover = np.moveaxis(self.B.block_sum(np.moveaxis(clear, 0, -1).astype(np.float32), nby, nbx), -1, 0) / n ** 2
        keep = cover >= 0.4
        D = rng.uniform(0.0, 2.0, (S, nby, nbx))
        label = np.where(keep.any(axis=0), np.argmin(np.where(keep, D, np.inf), axis=0), -1)
        label[0, 1] = label[2, 3] = -1
        return D, keep, label, seen, clear

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

    def test_a_clear_view_is_taken_from_the_first_station_of_the_blocks_sequence_that_has_one(self):
        """T-739. One sequence serves both steps. A texel none of its block's ranked stations saw clear takes the
        first station of the block's sequence that saw it clear, and beyond the ranking the sequence goes by how
        much of the block a station saw at all, not by its data cost or by how much it saw clear: on the Saloon's
        walls, of two clear views from outside a ranking, that one lay nearer its surroundings."""
        lv, B = self.lv, self.B
        S, n = 9, 2 * B.BLOCK
        self.assertGreater(S, lv.RANKED)
        D = np.tile((0.1 * np.arange(S)).reshape(S, 1, 1), (1, 1, 2))        # one row of two blocks; station 0 the best, 8 the worst
        keep = np.ones((S, 1, 2), bool)
        keep[:, 0, 1] = False                                        # the second block: no station passed for a candidate
        cover = np.full((S, 1, 2), 0.97, np.float32)
        cover[:, 0, 1] = 0.0
        cover[3, 0, 1], cover[7, 0, 1] = 5 / 8, 7 / 8                # what stations 3 and 7 saw of it clear (below)
        label = np.array([[0, -1]])                                  # so it has no label, and ranked_lists gives it no list
        ranked = lv.ranked_lists(D, label, keep, cover)
        self.assertEqual(ranked[0, 0].tolist(), [0, 1, 2, 3, 4, 5])
        self.assertTrue(np.all(ranked[0, 1] == -1))
        clear = np.zeros((S, B.BLOCK, n), bool)
        clear[:, :, :2] = True                                       # columns 0 and 1: every station
        clear[6:, :, 2:4] = True                                     # columns 2 and 3: stations 6, 7 and 8, none of them ranked
        clear[8, :, 4:6] = True                                      # columns 4 and 5: station 8 alone
        second = B.BLOCK                                             # the block without a label begins at this column
        clear[3, :, second:second + 5] = True                        # its columns 0 to 4: station 3
        clear[7, :, second + 2:second + 7] = True                    # its columns 2 to 6: station 7
        seen = clear.copy()
        seen[8, :, 6:8] = True                                       # station 8 saw the rest of the first block too, within a margin
        seen[3, :, second:second + 8] = True                         # and station 3 the whole of the second
        bits = B.pack_bits(clear)
        sequence = lv.block_sequence(ranked, label, B.pack_bits(seen), n)
        # The first block: its ranking, then every station by how much of the block it saw at all. Station 8 saw all
        # of it; 6 and 7 four columns each, the earlier first; the ranked six two columns each.
        self.assertEqual(sequence[0, 0].tolist(), [0, 1, 2, 3, 4, 5] + [8, 6, 7, 0, 1, 2, 3, 4, 5])
        # The second has no ranking and borrows its neighbour's; then the two stations that saw any of it.
        self.assertEqual(sequence[0, 1].tolist(), [0, 1, 2, 3, 4, 5] + [3, 7] + [-1] * (S - 2))
        self.assertEqual(sequence.dtype, np.int16)
        valid = np.ones((B.BLOCK, n), bool)
        tlab = lv.texel_labels(ranked, bits, valid, (0, 1, 0, 2))
        self.assertEqual(sorted(np.unique(tlab).tolist()), [-1, 0])
        self.assertTrue(np.all(tlab[:, second:] == -1))              # the ranking alone leaves the whole second block without a station
        out, outside = lv.clear_views(sequence, tlab, bits)
        # Columns 2 and 3: three stations outside the ranking saw them clear. The one that saw most of the block at
        # all is taken (8), not the one with the least data cost (6), which the first form of this step took: its
        # order went on past the ranked six with the block's other candidates by data cost.
        self.assertTrue(np.all(out[:, :2] == 0) and np.all(out[:, 2:4] == 8) and np.all(out[:, 4:6] == 8))
        self.assertTrue(np.all(out[:, 6:second] == -1))              # no station saw the first block's other columns clear
        # The block without a label: a texel a station saw clear takes one all the same, a station of the borrowed
        # ranking first (3 stands in it), then the sequence's other half. What no station saw clear stays as it was.
        # The first form of this step ordered such a block by how much of it each station saw clear, so it gave
        # columns 2 to 4 station 7 (seven columns clear, against station 3's five); now the borrowed ranking leads.
        self.assertTrue(np.all(out[:, second:second + 5] == 3) and np.all(out[:, second + 5:second + 7] == 7))
        old = [self.old_order(D[:, 0, b], keep[:, 0, b], cover[:, 0, b], label[0, b]) for b in (0, 1)]
        self.assertEqual(old[0], list(range(S)))                     # the label, then every other candidate by data cost
        self.assertEqual(old[1], [7, 3])                             # without a label: by clear cover, most first
        self.assertEqual(next(s for s in old[0] if clear[s, 0, 2]), 6)
        self.assertEqual(next(s for s in old[1] if clear[s, 0, second + 2]), 7)
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

    def test_the_blocks_sequence_is_the_ranking_then_every_station_by_what_it_saw(self):
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
        seq = lv.block_sequence(ranked, label, B.pack_bits(seen), n)
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
        seq = lv.block_sequence(ranked, label, B.pack_bits(many), n)
        self.assertEqual(seq[0, 0, lv.RANKED:].tolist(), [8, 7, 6, 5, 4, 3, 2, 1, -1])
        # The middle block is as near to block 0 as to block 2, and which ranking it borrows is SciPy's choice
        # (block_sequence's docstring): not pinned here, so either is accepted above.

    def test_past_the_ranking_a_clear_view_goes_by_what_a_station_saw_at_all_not_by_data_cost(self):
        """T-739, (1). A seventh candidate (station 6, data cost 0.6) and a station that is no candidate (7) both saw
        texel (0, 0) clear. The first form of this step asked the block's remaining candidates by data cost and took
        6; the one sequence asks by how much of the block each saw at all and takes 7, which saw all of it."""
        lv, B = self.lv, self.B
        for six_saw in (3, 62):     # 6 saw 3 texels (keep is given, as in the review's case), or 62: a candidate by COVER_MIN
            D, keep, label, seen, clear = self.ranked_six()
            keep[6] = True
            seen[6].flat[:six_saw] = clear[6].flat[:six_saw] = True      # texels (0, 0) onwards, all of them clear
            seen[7] = True                                               # 7 saw the whole block at all,
            clear[7, 0, :6] = True                                       # and about a tenth of it clear (6 of 64)
            ranked, sequence, tlab, out = self.first_step(D, keep, label, seen, clear)
            self.assertEqual(ranked[0, 0].tolist(), [0, 1, 2, 3, 4, 5])
            self.assertEqual(sequence[0, 0].tolist(), [0, 1, 2, 3, 4, 5] + [0, 1, 2, 3, 4, 5, 7, 6], six_saw)
            self.assertEqual(tlab[0, 0], -1)                             # no ranked station saw it clear
            self.assertEqual(out[0, 0], 7, six_saw)
            cover = clear.reshape(len(clear), -1).mean(axis=1)
            old = self.old_order(D[:, 0, 0], keep[:, 0, 0], cover, 0)
            self.assertEqual(old, list(range(8)))
            self.assertEqual(next(s for s in old if clear[s, 0, 0]), 6, six_saw)      # the old order took 6
            self.assertTrue(np.all(out.ravel()[1:] == tlab.ravel()[1:]))              # the rest kept its ranked station

    def test_past_the_ranking_a_clear_view_goes_by_what_a_station_saw_at_all_not_by_what_it_saw_clear(self):
        """T-739, (2). Two stations that are no candidates saw texel (0, 0) clear. Station 6 saw more of the block
        clear (20 texels against 5), station 7 more of it at all (64 against 20): 7 is taken; the old order, by
        clear cover, took 6."""
        D, keep, label, seen, clear = self.ranked_six()
        seen[6].flat[:20] = clear[6].flat[:20] = True
        seen[7] = True
        clear[7, 0, :5] = True
        _, sequence, _, out = self.first_step(D, keep, label, seen, clear)
        self.assertEqual(sequence[0, 0, self.lv.RANKED:].tolist(), [0, 1, 2, 3, 4, 5, 7, 6])
        self.assertEqual(out[0, 0], 7)
        cover = clear.reshape(len(clear), -1).mean(axis=1)
        old = self.old_order(D[:, 0, 0], keep[:, 0, 0], cover, 0)
        self.assertEqual(old, [0, 1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(next(s for s in old if clear[s, 0, 0]), 6)

    def test_a_texel_a_ranked_station_saw_only_within_a_margin_takes_the_clear_view_of_another(self):
        """T-739, (3). Station 0 leads the block's sequence and saw texel (0, 0), but within a margin; station 7,
        outside the ranking, saw it clear. clear_views gives it 7 (asking for a clear view, not for any view), and
        doubtful_views then leaves it alone: it gives a doubtful view only where no station saw the texel clear."""
        D, keep, label, seen, clear = self.ranked_six()
        seen[7, 0, :2] = True
        clear[7, 0, 0] = True                                        # 7 saw (0, 0) clear and (0, 1) within a margin,
        clear[:6, 0, 1] = False                                      # as did the ranked six: no station saw (0, 1) clear
        _, sequence, tlab, out = self.first_step(D, keep, label, seen, clear)
        self.assertEqual(sequence[0, 0, 0], 0)
        self.assertTrue(seen[0, 0, 0])                               # the first of the sequence saw it at all ...
        self.assertEqual(out[0, :2].tolist(), [7, -1])               # ... yet the clear view is taken
        final, used = self.doubtful(out, seen, clear, sequence)
        self.assertEqual(final[0, :2].tolist(), [7, 0])              # (0, 0) is left alone; (0, 1) takes a doubtful view
        self.assertTrue(np.array_equal(final[1:], out[1:]) and np.array_equal(final[0, 2:], out[0, 2:]))
        self.assertEqual(sorted(zip(*(a.tolist() for a in np.nonzero(used & ~clear)))), [(0, 0, 1)])   # station, row, column

    def test_of_stations_that_saw_as_much_of_the_block_the_earlier_is_asked_first(self):
        """T-739, (4). Stations 6 and 7, no candidates, saw 32 texels of the block each at all, and both saw texel
        (0, 0) clear: the earlier station, 6, is taken, though 7 saw far more of the block clear (32 against 1),
        which the old order went by."""
        D, keep, label, seen, clear = self.ranked_six()
        seen[6, :4, :] = True                                        # rows 0 to 3,
        seen[7, :, :4] = True                                        # columns 0 to 3: both hold (0, 0)
        clear[6, 0, 0] = True
        clear[7, :, :4] = True
        _, sequence, _, out = self.first_step(D, keep, label, seen, clear)
        self.assertEqual(sequence[0, 0, self.lv.RANKED:].tolist(), [0, 1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(out[0, 0], 6)
        cover = clear.reshape(len(clear), -1).mean(axis=1)
        self.assertEqual(self.old_order(D[:, 0, 0], keep[:, 0, 0], cover, 0)[6:], [7, 6])

    def test_a_ranked_station_asked_again_in_the_second_half_changes_no_view(self):
        """T-739, (5). A ranked station that saw much of its block stands in both halves of the sequence; asking it
        again changes nothing, because the first place counts. (In a labelled block clear_views finds no clear view
        among the ranked stations at all, since a texel comes to it only when none saw it clear; but in a block
        without a label the borrowed stations were never asked by texel_labels and can give one, so there, as in
        doubtful_views, the first place is what keeps the repeat from mattering.) Checked on random walls against
        the same sequences with every repeated station struck from the second half."""
        lv = self.lv
        R = lv.RANKED
        for seed in (5, 6, 7):
            D, keep, label, seen, clear = self.random_wall(seed)
            _, sequence, tlab, out = self.first_step(D, keep, label, seen, clear)
            again = (sequence[..., R:, None] == sequence[..., None, :R]).any(-1) & (sequence[..., R:] >= 0)
            self.assertGreater(int(again.sum()), 0, seed)            # ranked stations do stand in both halves
            struck = sequence.copy()
            struck[..., R:][again] = -1
            out_struck, _ = lv.clear_views(struck, tlab, self.B.pack_bits(clear))
            self.assertTrue(np.array_equal(out, out_struck), seed)
            self.assertGreater(int(((tlab < 0) & (out >= 0)).sum()), 0, seed)        # the step gave views
            final, used = self.doubtful(out, seen, clear, sequence)
            final_struck, used_struck = self.doubtful(out, seen, clear, struck)
            self.assertTrue(np.array_equal(final, final_struck) and np.array_equal(used, used_struck), seed)
            self.assertGreater(int(((out < 0) & (final >= 0)).sum()), 0, seed)       # so did the doubtful step

    def test_every_texel_a_station_saw_clear_takes_a_clear_view(self):
        """T-739, (6). With no guard of its own: after the ranking and clear_views, a texel has a station exactly
        where some station saw it clear, on random walls with blocks that have no label, and on one where no block
        has a label. A block without a label is served because it borrows the nearest labelled block's ranking, and
        because the sequence's second half lists every station that saw any of the block, which every station that
        saw a texel of it clear did."""
        lv, B = self.lv, self.B
        for seed in (1, 2, 3, 4):
            D, keep, label, seen, clear = self.random_wall(seed)
            for labels in (label, np.full_like(label, -1)):
                _, sequence, tlab, out = self.first_step(D, keep, labels, seen, clear)
                served = np.kron((sequence >= 0).any(axis=-1), np.ones((B.BLOCK, B.BLOCK))).astype(bool)
                any_clear = clear.any(axis=0)
                self.assertTrue(np.all(served[any_clear]), seed)                         # the sequence serves every such block
                self.assertTrue(np.array_equal(out >= 0, any_clear & served), seed)
                r, c = np.nonzero(out >= 0)
                self.assertTrue(np.all(clear[out[r, c], r, c]), seed)                    # each from a station that saw it clear
                none = np.kron(labels < 0, np.ones((B.BLOCK, B.BLOCK))).astype(bool)
                self.assertGreater(int((none & any_clear).sum()), 0, seed)
                self.assertTrue(np.all(out[none & any_clear] >= 0), seed)               # blocks without a label among them

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

    def test_a_clean_texel_is_not_its_own_surroundings(self):
        # A changed texel is never among the clean ones, so it never votes on its own surroundings. A clean texel
        # judged as a control must be judged the same way, or the control flatters itself (found in review).
        wv = self.wv
        H = W = 2 * wv.REACH + 1
        mid = wv.REACH
        L = np.full((H, W), 100.0, np.float32)
        L[mid, mid] = 10.0                                          # one clean texel far darker than the wall round it
        depth = np.zeros((H, W), np.float32)
        ref, count = wv.surroundings(L, np.ones((H, W), bool), depth, np.array([mid]), np.array([mid]))
        self.assertEqual((float(ref[0]), int(count[0])), (100.0, H * W - 1))
        clean = np.zeros((H, W), bool)
        clean[mid, mid - 1:mid + 2] = True                          # the texel and one clean neighbour on each side
        L[mid, mid - 1], L[mid, mid + 1] = 0.0, 100.0
        ref, count = wv.surroundings(L, clean, depth, np.array([mid]), np.array([mid]))
        self.assertEqual((float(ref[0]), int(count[0])), (50.0, 2))  # of 0 and 100; with itself it would be its own 10

    def test_two_builds_are_counted_as_pairs_with_an_exact_sign_test(self):
        from fractions import Fraction  # noqa: PLC0415
        from math import comb  # noqa: PLC0415
        wv = self.wv

        def exact(worse, better):                                   # the definition, in fractions: twice the smaller tail of a fair coin
            n, k = worse + better, min(worse, better)
            return float(min(Fraction(1), Fraction(2 * sum(comb(n, i) for i in range(k + 1)), 2 ** n)))

        self.assertEqual(wv.sign_test(0, 0), 1.0)                   # nothing changed: no evidence either way
        self.assertEqual(wv.sign_test(5, 5), 1.0)                   # as many each way
        self.assertEqual(wv.sign_test(0, 5), 2 / 32)                # all five one way: both tails of (1/2)^5
        self.assertEqual(wv.sign_test(9, 1), 2 * (1 + 10) / 1024)   # C(10, 0) + C(10, 1) of 2^10, both tails
        self.assertEqual(wv.sign_test(1, 9), wv.sign_test(9, 1))    # which build is called worse does not change it
        # Exact to the float, far out in a tail and near an even split: a normal curve is out by ten times in the first.
        for worse, better in ((841, 367), (300, 330), (2, 61), (33, 30)):
            self.assertEqual(wv.sign_test(worse, better), exact(worse, better), (worse, better))
        self.assertTrue(2e-43 < wv.sign_test(841, 367) < 4e-43)     # the Saloon's second build, its dark texels: not chance
        self.assertTrue(0.3 < wv.sign_test(6000, 6100) < 0.4)       # twelve thousand pairs neither overflow nor take long
        self.assertEqual(wv.sign_test(0, 1200), 0.0)                # under the smallest float: nought, and no error
        # A count straight from numpy: its integers wrap round where Python's grow, and gave a p below nought.
        self.assertEqual(wv.sign_test(np.int64(30), np.int64(33)), exact(30, 33))
        self.assertEqual(wv.sign_test(np.array([5]).sum(), np.int32(70)), exact(5, 70))
        among = np.array([True] * 8 + [False] * 2)
        worse = np.array([True] * 6 + [False] * 2 + [True, False])  # the ninth is worse, and is not among the texels counted
        better = np.array([False] * 9 + [True])                     # nor is the tenth, which is better
        self.assertEqual(wv.paired_counts(worse, better, among), dict(worse=6, better=0, unchanged=2, p_exact=2 / 64, p_worse=1 / 64))
        better[6] = True                                            # one of the eight turns better
        self.assertEqual(wv.paired_counts(worse, better, among),
                         dict(worse=6, better=1, unchanged=1, p_exact=2 * (1 + 7) / 128, p_worse=(1 + 7) / 128))

    def test_is_it_worse_is_one_sided_and_a_family_of_tests_is_corrected(self):
        from fractions import Fraction  # noqa: PLC0415
        from math import comb  # noqa: PLC0415
        wv = self.wv

        def tail(worse, better):                                    # the definition: at least `worse` heads of a fair coin
            n = worse + better
            return float(Fraction(sum(comb(n, i) for i in range(worse, n + 1)), 2 ** n))

        self.assertEqual(wv.sign_test_worse(0, 0), 1.0)
        self.assertEqual(wv.sign_test_worse(8, 1), 10 / 512)        # C(9, 8) + C(9, 9) of 2^9
        self.assertEqual(wv.sign_test_worse(1, 8), 1 - 1 / 512)     # the better build is not called worse
        self.assertEqual(wv.sign_test_worse(5, 5), tail(5, 5))      # an even split: a little over a half, not 1
        for worse, better in ((841, 367), (30, 33), (0, 7), (7, 0), (13, 4)):
            self.assertEqual(wv.sign_test_worse(worse, better), tail(worse, better), (worse, better))
            if worse > better:                                      # where it is the worse, the two-sided p is twice the one-sided
                self.assertEqual(wv.sign_test(worse, better), min(1.0, 2 * tail(worse, better)), (worse, better))
        self.assertEqual(wv.sign_test_worse(np.int64(30), np.int64(33)), tail(30, 33))     # numpy's integers, as in sign_test
        # Holm: the smallest p times the number of tests, the next times one fewer, never below the one before, each
        # in its own place.
        self.assertEqual(wv.holm([]), [])
        self.assertEqual(wv.holm([0.03]), [0.03])
        self.assertEqual(wv.holm([0.04, 0.01, 0.03]), [0.06, 0.03, 0.06])       # 0.01 x 3; 0.03 x 2; 0.04 x 1, raised to 0.06
        self.assertEqual(wv.holm([0.5, 0.9, 0.001]), [1.0, 1.0, 0.003])         # capped at 1
        raw = [0.039] + [0.5] * 23                                  # one wall of eight, on one judgement of three, at 0.039
        self.assertGreater(wv.holm(raw)[0], 0.9)                    # is no finding among twenty-four tests

    def test_is_it_worse_against_the_control_s_own_share(self):
        # Guards sign_test_worse_against, with which compare_builds reads a wall's patches against its control's own
        # split (SG6): the exact binomial tail, at least `worse` of `worse + better` turning worse each with the
        # control's share of worse, against its definition in fractions; at an even share, or where the control has
        # no changed pair, it is sign_test_worse itself.
        from fractions import Fraction  # noqa: PLC0415
        from math import comb  # noqa: PLC0415
        wv = self.wv

        def tail(worse, better, control_worse, control_better):     # the definition
            q = Fraction(control_worse, control_worse + control_better) if control_worse + control_better else Fraction(1, 2)
            n = worse + better
            return float(sum(comb(n, i) * q ** i * (1 - q) ** (n - i) for i in range(worse, n + 1)))

        f = wv.sign_test_worse_against
        for case in ((8, 1, 61, 183), (8, 1, 183, 61), (13, 4, 88, 122), (0, 7, 3, 9), (7, 0, 3, 9), (30, 33, 311, 473), (1, 0, 1, 20000)):
            self.assertEqual(f(*case), tail(*case), case)
        # The review's case: fireplace-front-end, off, 8 patches worse and 1 better against a control of 61/183 (a
        # share of 0.25): about 1.1e-4, where an even split gives 10/512.
        self.assertTrue(1.0e-4 < f(8, 1, 61, 183) < 1.1e-4)
        for worse, better in ((8, 1), (0, 0), (5, 5), (13, 4), (1, 8), (0, 3)):
            self.assertEqual(f(worse, better, 0, 0), wv.sign_test_worse(worse, better), (worse, better))
            self.assertEqual(f(worse, better, 7, 7), wv.sign_test_worse(worse, better), (worse, better))
        self.assertEqual((f(1, 3, 0, 9), f(0, 3, 0, 9), f(4, 0, 9, 0)), (0.0, 1.0, 1.0))     # a control all one way
        self.assertEqual(f(np.int64(8), np.int64(1), np.int64(61), np.int64(183)), tail(8, 1, 61, 183))   # numpy's integers

    def test_the_chance_that_a_family_of_raw_tests_names_some_wall(self):
        # Guards chance_of_reaching and chance_of_any, behind the records' chance that the per-wall tests, taken
        # raw at 0.05, name some wall by chance alone (TM4): a sign test on 5 patches or fewer cannot reach 0.05;
        # on 6 only all six one way does, either way; a family's chance is one less the product of each one's
        # chance of not reaching it, which for few patches is far below 1 - 0.95^k.
        from fractions import Fraction  # noqa: PLC0415
        from math import comb  # noqa: PLC0415
        wv = self.wv
        self.assertEqual([wv.chance_of_reaching(n) for n in range(6)], [0.0] * 6)
        self.assertEqual(wv.chance_of_reaching(6), 2 / 64)
        self.assertEqual(wv.chance_of_reaching(np.int64(6)), 2 / 64)            # a count straight from numpy
        for n in (9, 17, 38):                                       # against the definition, in fractions
            want = Fraction(sum(comb(n, w) for w in range(n + 1) if wv.sign_test(w, n - w) < 0.05), 2 ** n)
            self.assertEqual(wv.chance_of_reaching(n), float(want), n)
            self.assertLess(wv.chance_of_reaching(n), 0.05)         # the exact test is conservative
        self.assertEqual(wv.chance_of_any([]), 0.0)
        self.assertEqual(wv.chance_of_any([6, 6]), 1 - (1 - 2 / 64) ** 2)
        self.assertEqual(wv.chance_of_any([5, 0, 3]), 0.0)
        saloon = [4, 9, 26, 0, 9, 12, 1, 1, 1, 4, 9, 17, 2, 4, 11, 2, 4, 11, 1, 0, 3, 5, 21, 38]    # the first build against the third
        self.assertTrue(0.27 < wv.chance_of_any(saloon) < 0.28 < 0.70 < 1 - 0.95 ** 24)

    def test_a_patch_is_one_unit_whatever_is_left_out_of_it(self):
        wv = self.wv
        mask = np.zeros((40, 74), bool)
        for k in range(10):                                         # ten patches of 3 x 5 texels, two columns apart
            mask[10:13, 2 + 7 * k:7 + 7 * k] = True
        lab, n = wv.patch_image(mask)
        self.assertEqual(n, 10)
        corner = np.zeros((3, 3), bool)
        corner[0, 0] = corner[1, 1] = True
        self.assertEqual(wv.patch_image(corner)[1], 1)              # texels that touch at a corner are one patch
        r, c = np.nonzero(mask)
        patch = lab[r, c]
        k, i = (c - 2) // 7, (r - 10) * 5 + (c - 2) % 7             # which patch a texel is in, and which of its fifteen it is
        every, none = np.ones(len(r), bool), np.zeros(len(r), bool)
        ten = dict(patches=10, worse=10, better=0, unchanged=0, p_exact=2 / 1024, p_worse=1 / 1024)
        self.assertEqual(wv.patch_counts(patch, every, none, every), ten)          # every texel turned worse
        # Each patch's middle column is left out (not judged): still ten patches, not twenty halves. Found in review:
        # patches made of the counted texels alone gave twenty units and a p a thousand times smaller.
        judged = (c - 2) % 7 != 2
        self.assertEqual(int(judged.sum()), 10 * 12)
        self.assertEqual(wv.patch_counts(patch, every, none, judged), ten)
        self.assertEqual(wv.patch_counts(patch, every, none, k < 3), dict(patches=3, worse=3, better=0, unchanged=0, p_exact=2 / 8, p_worse=1 / 8))
        self.assertEqual(wv.patch_counts(patch, every, none, none), dict(patches=0, worse=0, better=0, unchanged=0, p_exact=1.0, p_worse=1.0))
        # A patch is worse where more of its texels turned worse than better: 8 against 7 is worse, 7 against 8 better,
        # 7 against 7 with one as it was is neither.
        worse = np.where(k == 0, i < 8, np.where(k <= 2, i < 7, True))
        better = np.where(k == 0, i >= 8, np.where(k == 1, i >= 7, np.where(k == 2, (i >= 7) & (i < 14), False)))
        self.assertEqual(wv.patch_counts(patch, worse, better, every), dict(patches=10, worse=8, better=1, unchanged=1, p_exact=2 * (1 + 9) / 512, p_worse=(1 + 9) / 512))


class CompareBuilds(unittest.TestCase):
    """measure/walls/compare_builds.py: its per-wall computation (compare_wall) and its bar (wall_tests), on tiny
    made-up walls. Each wall starts as grey plaster at 100 levels on one surface, every texel on station 0 in both
    builds, seen clear by it and coloured in both photographs; each test changes what it needs. And
    labels_diff.py's check of a build's labels against the forecast written before it (against_forecast)."""

    @classmethod
    def setUpClass(cls):
        import importlib.util  # noqa: PLC0415
        walls = os.path.join(ROOMS, "measure", "walls")
        blas = {k: os.environ.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}
        spec = importlib.util.spec_from_file_location("wallviews", os.path.join(walls, "wallviews.py"))
        cls.wv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.wv)
        before = sys.modules.get("wallviews")
        sys.modules["wallviews"] = cls.wv                           # compare_builds imports it by name, as it does beside it
        try:
            spec = importlib.util.spec_from_file_location("compare_builds", os.path.join(walls, "compare_builds.py"))
            cls.cb = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.cb)                         # reads no argument and no file: that is all main()'s
            spec = importlib.util.spec_from_file_location("labels_diff", os.path.join(walls, "labels_diff.py"))
            cls.ld = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.ld)                         # likewise
        finally:
            if before is None:
                sys.modules.pop("wallviews", None)
            else:
                sys.modules["wallviews"] = before
        for k, v in blas.items():                                   # wallviews asks for one BLAS thread for its own runs: not this process's
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    @staticmethod
    def wall(H, W, stations=3):
        return dict(old=np.zeros((H, W), np.int32), new=np.zeros((H, W), np.int32),
                    clear1=np.ones((stations, H, W), bool), clear2=np.ones((stations, H, W), bool),
                    L1=np.full((H, W), 100.0, np.float32), L2=np.full((H, W), 100.0, np.float32),
                    ok1=np.ones((H, W), bool), ok2=np.ones((H, W), bool), valid=np.ones((H, W), bool),
                    depth=np.zeros((H, W), np.float32), covered=np.zeros((H, W), bool), reference=None, filled1=None)

    @staticmethod
    def copy(w):
        return {k: v.copy() if isinstance(v, np.ndarray) else v for k, v in w.items()}

    def compare(self, w):
        H, W = w["old"].shape
        return self.cb.compare_wall("made-up", w["old"], w["new"], np.packbits(w["clear2"], axis=-1), np.packbits(w["clear1"], axis=-1),
                                    w["L1"], w["L2"], w["ok1"], w["ok2"], w["valid"], w["depth"], w["covered"],
                                    0.005 * np.arange(W), 3.0 - 0.005 * np.arange(H), np.random.default_rng(7), w["reference"], w["filled1"])

    def test_a_changed_patch_is_one_unit_where_its_middle_cannot_be_judged(self):
        # Guards 37266a83 through the whole computation: patches made of the counted texels alone cut this patch in
        # two at its middle column (two units, and a p too small). By patch it is one patch of every texel whose
        # label differs; by own patch, one patch of every texel of its class, judged or not.
        one = dict(worse=1, better=0, unchanged=0, p_exact=1.0, p_worse=0.5)
        for how in ("under a photo patch", "not coloured in the first build"):
            with self.subTest(how):
                w = self.wall(48, 48)
                w["new"][20:23, 20:25] = 1                          # one patch of 3 x 5 texels takes station 1
                w["L2"][20:23, 20:25] = 40.0                        # and every texel of it turns dark
                if how == "under a photo patch":
                    w["covered"][20:23, 22] = True
                else:
                    w["ok1"][20:23, 22] = False
                row, masks = self.compare(w)
                part = row["left_to_be_seen"]
                self.assertEqual(part["texels"], 12)                # the middle column is not judged
                self.assertFalse(masks["left_to_be_seen"][:, 22].any())
                self.assertEqual(part["paired"]["dark"], dict(worse=12, better=0, unchanged=0, p_exact=2 / 4096, p_worse=1 / 4096))
                for unit in ("paired_by_patch", "paired_by_own_patch"):
                    self.assertEqual(part[unit]["patches"], 1, unit)
                    self.assertEqual(part[unit]["dark"], one, unit)

    def test_a_class_s_own_patches_do_not_move_with_another_class(self):
        # Guards the own patch, the unit of a test stated in advance on one class (SG4): the connected patches of
        # every texel of that class, judged or not. Two blobs of doubtful-to-clear texels a column apart are two own
        # patches whether or not the column between them changes station as another class (clear to clear), which
        # joins them into one patch of all the changed texels; on the Saloon the same texels gave 8 or 42 units by
        # what else changed. A column of the class itself that cannot be judged (under a photo patch) does join
        # them: it is kept in its component.
        alone = self.wall(40, 48)
        blobs = np.zeros((40, 48), bool)
        blobs[18:21, 20:23] = blobs[18:21, 24:27] = True
        gap = np.zeros((40, 48), bool)
        gap[18:21, 23] = True
        alone["new"][blobs] = 1
        alone["L2"][blobs] = 40.0                                   # every texel of both blobs turns dark
        alone["clear1"][0][blobs] = False                           # the first build's station saw them doubtfully: doubtful to clear

        def units(w):
            row, masks = self.compare(w)
            self.assertTrue(np.array_equal(masks["doubtful_to_clear"], blobs))      # the same judged texels every time
            part = row["doubtful_to_clear"]
            return part["paired_by_own_patch"], part["paired_by_patch"]

        own, shared = units(alone)
        two = dict(worse=2, better=0, unchanged=0, p_exact=0.5, p_worse=0.25)
        self.assertEqual((own["patches"], own["dark"]), (2, two))
        self.assertEqual(shared["patches"], 2)
        beside = self.copy(alone)
        beside["new"][gap] = 2                                      # clear to clear: both builds' stations saw it clear
        own_beside, shared_beside = units(beside)
        self.assertEqual(own_beside, own)                           # the own unit and every verdict by it: unchanged
        self.assertEqual(shared_beside["patches"], 1)               # the shared unit moves with the other class
        hidden = self.copy(alone)
        hidden["new"][gap] = 1
        hidden["clear1"][0][gap] = False                            # the class's own, doubtful to clear
        hidden["covered"][gap] = True                               # and not to be seen: not judged
        own_hidden, _ = units(hidden)
        self.assertEqual((own_hidden["patches"], own_hidden["dark"]), (1, dict(worse=1, better=0, unchanged=0, p_exact=1.0, p_worse=0.5)))
        # Pooled over walls, the own patches are summed as the patches are, and printed beside them with p_worse.
        rows = [self.compare(w)[0] for w in (alone, beside)]
        pooled = self.cb.pairs_over_the_walls(rows, "doubtful_to_clear", "paired_by_own_patch")
        self.assertEqual(self.cb.total(rows, "doubtful_to_clear", "paired_by_own_patch", "patches"), 4)
        self.assertEqual(pooled["dark"], dict(worse=4, better=0, unchanged=0, p_exact=2 / 16, p_worse=1 / 16))

    def test_a_control_texel_is_not_among_its_own_surroundings(self):
        # Guards the control through the whole computation (found in review, 37266a83): a clean texel judged as a
        # control is set against its clean neighbours without itself, as a changed texel is. Control texel T has
        # exactly FEW clean neighbours on its own surface, all beyond the control's reach, half at 40 levels and
        # half at 100 (median 70); T is 100 in the first build and 40 in the second, so it turns dark (40 < 0.85 x
        # 70) and is off in both. Among its own surroundings it would make their median 100 and then 40, and be
        # neither. Every other control texel is plaster at 100 on the other surface.
        wv = self.wv
        R, few = wv.REACH, wv.FEW
        self.assertEqual(few % 2, 0)
        H, W = 2 * R + 2, 2 * R + few // 2 + 10
        w = self.wall(H, W)
        w["depth"][:] = 0.05                                        # the plaster
        c0, t = 5, 5 + R
        w["new"][R, c0] = 1                                         # the one changed texel, judged, on the plaster
        w["depth"][R, t] = 0.0                                      # T, at the edge of the control's reach of it
        w["depth"][R:R + 2, t + 1:t + 1 + few // 2] = 0.0           # T's surface: FEW texels, out of that reach
        w["L1"][R, t + 1:t + 1 + few // 2] = w["L2"][R, t + 1:t + 1 + few // 2] = 40.0
        w["L2"][R, t] = 40.0
        control = self.compare(w)[0]["clean_texels_beside"]
        self.assertGreater(control["texels"], 1)
        self.assertEqual((control["dark"], control["off"]), (1, 1))     # T alone, in the second build
        self.assertEqual(control["paired"]["dark"], dict(worse=1, better=0, unchanged=control["texels"] - 1, p_exact=1.0, p_worse=0.5))
        self.assertEqual((control["paired"]["off"]["worse"], control["paired"]["off"]["better"]), (0, 0))   # off in both builds
        w["L2"][R, t] = 100.0                                       # T as it was: then no control texel is dark
        self.assertEqual(self.compare(w)[0]["clean_texels_beside"]["dark"], 0)

    def test_the_changed_texels_split_into_their_classes(self):
        # Guards the split by what the change did (SG7): a view the first build's station saw doubtfully or clear,
        # to one the second build's station saw doubtfully or clear; a former hole judged against the first build's
        # photograph as the atlas fills it, in all_left_to_be_seen and never in left_to_be_seen; a texel the second
        # build left without a station in no class; a former hole under a photo patch counted in all, not seen.
        H, W = 40, 90
        w = self.wall(H, W)
        expect = {}
        for kind, c0 in (("doubtful_to_clear", 10), ("doubtful_to_doubtful", 20), ("clear_to_clear", 30), ("clear_to_doubtful", 40), ("former_holes", 50)):
            m = np.zeros((H, W), bool)
            m[18:20, c0:c0 + 2] = True
            expect[kind] = m
            w["new"][m] = 1
            w["L2"][m] = 40.0                                       # each turns dark in the second build
        w["clear1"][0][expect["doubtful_to_clear"] | expect["doubtful_to_doubtful"]] = False     # the first build's station saw them doubtfully
        w["clear2"][1][expect["doubtful_to_doubtful"] | expect["clear_to_doubtful"]] = False     # the second build's did
        hidden = np.zeros((H, W), bool)
        hidden[18:20, 60:62] = True                                 # a former hole under a photo patch
        w["new"][hidden] = 1
        w["covered"][hidden] = True
        holes = expect["former_holes"] | hidden
        w["old"][holes] = -1                                        # the first build left them without a station
        w["ok1"][holes] = False                                     # and coloured nothing there
        w["L1"][holes] = 0.0                                        # what its photograph holds there is not what it shows
        w["filled1"] = np.full((H, W), 100.0, np.float32)           # the atlas fills them from the plaster round them
        w["new"][18, 70] = -1                                       # a texel the second build left without a station
        w["ok2"][18, 70] = False
        row, masks = self.compare(w)
        kept = expect["doubtful_to_clear"] | expect["doubtful_to_doubtful"] | expect["clear_to_clear"] | expect["clear_to_doubtful"]
        four = dict(worse=4, better=0, unchanged=0, p_exact=2 / 16, p_worse=1 / 16)
        for kind, m in expect.items():
            self.assertTrue(np.array_equal(masks[kind], m), kind)
            self.assertEqual(row[kind]["texels"], 4, kind)
            self.assertEqual(row[kind]["paired"]["dark"], four, kind)     # a former hole too: against the fill, not the empty photograph
            self.assertEqual((row[kind]["paired_by_patch"]["patches"], row[kind]["paired_by_own_patch"]["patches"]), (1, 1), kind)
        self.assertTrue(np.array_equal(masks["left_to_be_seen"], kept))
        self.assertTrue(np.array_equal(masks["all_left_to_be_seen"], kept | expect["former_holes"]))
        self.assertTrue(np.array_equal(masks["changed"], kept | holes))   # the texel without a station is not compared
        self.assertEqual((row["station_changed"], row["left_to_be_seen"]["texels"], row["all_left_to_be_seen"]["texels"]), (16, 16, 20))
        self.assertEqual({k: row["former_holes"][k] for k in ("in_all", "under_a_patch", "took_a_clear_view")},
                         dict(in_all=8, under_a_patch=4, took_a_clear_view=8))
        w["filled1"] = None                                         # without the fill a former hole is refused, not read from the empty photograph
        with self.assertRaisesRegex(ValueError, "former hole"):
            self.compare(w)

    def test_the_bar_is_holm_over_the_walls_and_judgements(self):
        # Guards the bar (wall_tests): the family is every judgement of every wall with a judged changed texel left
        # to be seen, and no other; Holm's correction runs over that family; a wall fails only where more of its
        # patches turned worse AND Holm p is under 0.05. The one-sided p at the control's own share is reported
        # beside it and decides nothing (SG6).
        wv, cb = self.wv, self.cb

        def counts(worse, better, unchanged):
            return dict(worse=worse, better=better, unchanged=unchanged, p_exact=wv.sign_test(worse, better), p_worse=wv.sign_test_worse(worse, better))

        def row(wall, splits, control=None, texels=10):
            judged = dict(texels=texels, paired_by_patch=dict(patches=12, **{k: counts(*splits.get(k, (1, 1, 10))) for k in cb.JUDGEMENTS})) if texels else dict(texels=0)
            return dict(wall=wall, all_left_to_be_seen=judged,
                        clean_texels_beside=dict(paired={k: counts(*(control or {}).get(k, (0, 0, 100))) for k in cb.JUDGEMENTS}))

        rows = [row("a", dict(dark=(12, 0, 0))),                    # every patch worse: p 2/4096
                row("b", dict(off=(0, 12, 0))),                     # every patch better: as small a p, and no failure
                row("c", dict(off=(8, 1, 3)), control=dict(off=(61, 183, 3299))),     # raw p 0.039; its control leans better
                row("d", {}, texels=0)]                             # nothing judged: not in the family
        rows += [row(f"e{i}", {}) for i in range(4)]
        tests = cb.wall_tests(rows)
        self.assertEqual(len(tests), 7 * 3)
        self.assertNotIn("d", {x["wall"] for x in tests})
        by = {(x["wall"], x["judgement"]): x for x in tests}
        p = 2 / 4096
        self.assertEqual((by["a", "dark"]["p_holm"], by["b", "off"]["p_holm"]), (21 * p, 21 * p))   # the smallest two: x 21, and x 20 raised to it
        self.assertEqual((by["c", "off"]["p_exact"], by["c", "off"]["p_holm"]), (20 / 512, 19 * 20 / 512))
        self.assertEqual(by["e0", "dark"]["p_holm"], 1.0)
        self.assertEqual([(x["wall"], x["judgement"]) for x in tests if x["fails"]], [("a", "dark")])
        c = by["c", "off"]
        self.assertEqual((c["control_share_worse"], c["p_worse"]), (0.25, wv.sign_test_worse(8, 1)))
        self.assertEqual(c["p_worse_at_control_share"], wv.sign_test_worse_against(8, 1, 61, 183))
        self.assertLess(c["p_worse_at_control_share"], 0.05 / 21)  # it would pass Holm's first step, and does not make c fail
        a = by["a", "dark"]
        self.assertEqual((a["control_share_worse"], a["p_worse_at_control_share"]), (0.5, a["p_worse"]))     # no control pair: an even share

    def test_apart_from_isolates_the_texels_on_neither_build_s_station(self):
        # Guards --apart-from (SG3): comparing a third build (old) with a fourth (new), the first as the reference,
        # unlike_the_reference is exactly the texels the fourth gives a station that is neither the third's nor the
        # first's, and as_the_reference those it gives the first's. Neither holds a texel that did not change, nor
        # one the fourth left without a station; one under a photo patch is counted in all, not left to be seen.
        H, W = 30, 130                                              # not square: rows and columns cannot be swapped unseen
        w = self.wall(H, W)
        first = np.zeros((H, W), np.int32)
        groups = dict(back=(2, 0, 0), back_from_a_third_station=(1, 2, 2), new=(2, 1, 0), new_where_the_third_was_the_first=(0, 1, 0),
                      hole_back=(-1, 0, 0), hole_new=(-1, 2, 0), the_first_had_a_hole=(0, 1, -1), lost=(0, -1, 0),
                      unchanged_unlike_the_first=(1, 1, 0), new_under_a_photo_patch=(2, 1, 0))     # (third's, fourth's, first's)
        at = {}
        for k, (name, (third, fourth, first_s)) in enumerate(groups.items()):
            m = np.zeros((H, W), bool)
            m[14:16, 5 + 12 * k:7 + 12 * k] = True
            at[name] = m
            w["old"][m], w["new"][m], first[m] = third, fourth, first_s
        w["ok2"][at["lost"]] = False
        w["ok1"][at["hole_back"] | at["hole_new"]] = False
        w["covered"][at["new_under_a_photo_patch"]] = True
        w["filled1"] = np.full((H, W), 100.0, np.float32)
        w["reference"] = first
        row, masks = self.compare(w)

        def union(*names):
            return np.logical_or.reduce([at[n] for n in names])

        unlike = union("new", "new_where_the_third_was_the_first", "hole_new", "the_first_had_a_hole", "new_under_a_photo_patch")
        like = union("back", "back_from_a_third_station", "hole_back")
        old, new = w["old"], w["new"]
        self.assertTrue(np.array_equal(unlike, (new >= 0) & (new != old) & (new != first)))      # the groups are the definition
        self.assertTrue(np.array_equal(like, (new >= 0) & (new != old) & (new == first)))
        self.assertTrue(np.array_equal(masks["unlike_the_reference_in_all"], unlike))
        self.assertTrue(np.array_equal(masks["as_the_reference_in_all"], like))
        self.assertTrue(np.array_equal(masks["unlike_the_reference"], unlike & ~at["new_under_a_photo_patch"]))
        self.assertTrue(np.array_equal(masks["as_the_reference"], like))
        self.assertEqual((row["as_the_reference_in_all"], row["unlike_the_reference_in_all"]), (12, 20))
        self.assertEqual((row["as_the_reference"]["texels"], row["unlike_the_reference"]["texels"]), (12, 16))
        self.assertEqual(row["unlike_the_reference"]["paired_by_own_patch"]["patches"], 4)    # its own patches: one a group judged

    def test_apart_from_s_own_patches_are_its_own_texels_judged_or_not(self):
        # Guards the unit of the test stated before the Saloon's fourth build (TM3): unlike_the_reference's own
        # patches are the connected patches of every changed texel whose station is the reference's neither, judged
        # or not, and of nothing else. Two blobs of such texels, a column apart, are joined at one texel. Where that
        # texel went back to the reference's station they are two own patches (numbered by all the changed texels
        # they would be one); where it is of their own kind but under a photo patch, not judged, they are one
        # (numbered by the judged texels alone they would be two). By patch, every texel whose label differs, they
        # are one either way.
        H, W = 30, 60
        blobs, joint = np.zeros((H, W), bool), np.zeros((H, W), bool)
        blobs[14:17, 20:23] = blobs[14:17, 24:27] = True
        joint[15, 23] = True                                        # touches both blobs; nothing else does
        base = self.wall(H, W)                                      # the third build (old) and the reference: station 0 everywhere
        base["reference"] = np.zeros((H, W), np.int32)
        base["new"][blobs] = 1                                      # the fourth build: neither the third's station nor the first's
        base["L2"][blobs] = 40.0                                    # and every texel of both blobs turns dark
        back = self.copy(base)
        back["old"][joint] = 2                                      # the third build had another station there
        back["new"][joint] = 0                                      # and the fourth went back to the reference's
        hidden = self.copy(base)
        hidden["new"][joint] = 1                                    # of the blobs' own kind
        hidden["covered"][joint] = True                             # under a photo patch: not judged
        one = dict(worse=1, better=0, unchanged=0, p_exact=1.0, p_worse=0.5)
        two = dict(worse=2, better=0, unchanged=0, p_exact=0.5, p_worse=0.25)
        for name, w, own, in_all, like in (("joined by a texel back on the reference's station", back, two, 18, 1),
                                           ("joined by an unjudged texel of their own kind", hidden, one, 19, 0)):
            with self.subTest(name):
                row, masks = self.compare(w)
                part = row["unlike_the_reference"]
                self.assertTrue(np.array_equal(masks["unlike_the_reference"], blobs))       # the same 18 judged texels each time
                self.assertEqual((row["unlike_the_reference_in_all"], row["as_the_reference_in_all"]), (in_all, like))
                self.assertEqual(part["paired_by_own_patch"]["patches"], own["worse"])
                for key in self.cb.JUDGEMENTS:                      # dark, off and farther: every texel of both blobs turned worse
                    self.assertEqual(part["paired_by_own_patch"][key], own, key)
                    self.assertEqual(part["paired_by_patch"][key], one, key)
                self.assertEqual(part["paired_by_patch"]["patches"], 1)

    def test_labels_diff_checks_every_count_a_forecast_names(self):
        # Guards labels_diff.py --expect (TM6), with which a build's labels are checked against the forecast written
        # before it was made: every total and every per-wall count the forecast names is compared, so a build whose
        # totals match while a wall's count does not is refused, and so is a count the build does not make.
        rows = [dict(wall="front", differ=3, doubtful_to_clear=2, hole_to_clear=1, unexplained=0),
                dict(wall="rear", differ=1, doubtful_to_clear=1, hole_to_clear=0, unexplained=0)]
        total = dict(differ=4, doubtful_to_clear=3, hole_to_clear=1, unexplained=0)
        forecast = dict(total=dict(differ=4, doubtful_to_clear=3, hole_to_clear=1),
                        walls=dict(front=dict(differ=3, doubtful_to_clear=2), rear=dict(hole_to_clear=0)))
        self.assertEqual(self.ld.against_forecast(total, rows, forecast), [])
        # The same totals, and the texels on the wrong walls: one each way.
        moved = dict(forecast, walls=dict(front=dict(doubtful_to_clear=1), rear=dict(doubtful_to_clear=2)))
        self.assertEqual(self.ld.against_forecast(total, rows, moved),
                         ["front doubtful_to_clear: expected 1, found 2", "rear doubtful_to_clear: expected 2, found 1"])
        # A count the build does not make, and a wall it does not have, are differences, not matches.
        absent = dict(total=dict(clear_to_doubtful=0), walls=dict(window=dict(differ=0)))
        self.assertEqual(self.ld.against_forecast(total, rows, absent),
                         ["total clear_to_doubtful: expected 0, found None", "window differ: expected 0, found None"])

    def test_labels_diff_compares_every_array_of_a_wall_s_photographs(self):
        # Guards labels_diff.py --photographs: every file the walls step wrote for the wall (its tiles and their
        # 2.5 mm .fine files, never another wall's whose name begins with this one's), and every array in them, by
        # dtype, shape and bytes, so that the same bytes read as another dtype or shape are not the same array.
        import tempfile  # noqa: PLC0415
        rgb = np.arange(24, dtype=np.float32).reshape(2, 4, 3)
        arrays = {"wall-w-0.npz": dict(rgb=rgb, weight=np.ones((2, 4), np.float32), valid=np.ones((2, 4), bool)),
                  "wall-w-0.fine.npz": dict(rgb8=np.zeros((4, 8, 3), np.uint8), valid=np.ones((4, 8), bool)),
                  "wall-w-front-0.npz": dict(rgb=rgb)}                  # another wall, which must not be counted
        with tempfile.TemporaryDirectory() as root:
            works = [os.path.join(root, k) for k in ("a", "b")]
            for work in works:
                os.makedirs(os.path.join(work, "proj"))
                for name, content in arrays.items():
                    np.savez(os.path.join(work, "proj", name), **content)
            self.assertEqual(self.ld.same_photographs(*works, "w"), dict(files=2, arrays=5, identical=5, differ=[]))
            np.savez(os.path.join(works[1], "proj", "wall-w-front-0.npz"), rgb=rgb + 1)
            self.assertEqual(self.ld.same_photographs(*works, "w")["identical"], 5)
            np.savez(os.path.join(works[1], "proj", "wall-w-0.npz"), **dict(arrays["wall-w-0.npz"], rgb=rgb.view(np.int32)))
            self.assertEqual(self.ld.same_photographs(*works, "w")["differ"], ["wall-w-0.npz: rgb"])     # the same bytes, another dtype
            np.savez(os.path.join(works[1], "proj", "wall-w-1.npz"), rgb=rgb)
            got = self.ld.same_photographs(*works, "w")
            self.assertEqual((got["files"], got["identical"]), (3, 4))
            self.assertEqual(got["differ"], ["wall-w-1.npz: in one build only", "wall-w-0.npz: rgb"])


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

"""T4: the gates neither the Grand Hall (T2) nor the analytic room (T3) opens, each on a small
synthetic room built for it (seconds each).

- B10 glass classes, as pure functions: a plane change placed 8 cm off in the config (either way)
  leaves no hole in the mask, and the scan check finds the true change and reports the
  disagreement; a box in front of the glass is never glass; the old one-plane test is kept for
  one plane; and window-relief's own tolerance test would have holed the band.
- The windows step end to end on a 6 x 4 m room: a frosted-lower bay (box in front, plane change
  placed off), a sheer bay (the scan sees the sheer, so its depth is ignored) and, on another
  wall, a clear window with a segmental head (B11): its mask stays under the segmental arc and
  rises above the springing. Then stale masks are removed and the atlas and relief refuse a
  build/glass.json made from other config facts.
- B4: a chamfered corner's wall, not axis-aligned in E57, through the corners step: the fin is
  found and moved back onto the wall along its normal, nothing else moves, and it is re-projected.
- B24: two texels the renderer placed off their own centres (a surface seen edge-on) stop the
  labels as before; with survey.wallViews.strayTexels the corners step leaves them out and the
  wall is labelled and coloured; more of them than allowed, or a grid in the wrong place, still
  stop the build.
- B19: the floor refills roll along the boards towards the middle, for boards along z (rows) and
  along x (columns).
- The ceiling relief (B16): a hole beyond the fill's reach takes the reference height, an odd
  size is padded, and the exact spacing is recorded.
Scratch: SURVEYED_ROOMS_TEST_SCRATCH (default: the system temp folder).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
sys.path.insert(0, ROOMS)
sys.path.insert(0, HERE)
import roomlib  # noqa: E402
import synth  # noqa: E402
from roombuild import floor, legacy, relief, windows  # noqa: E402
from roombuild.context import Room  # noqa: E402

SCRATCH = os.environ.get("SURVEYED_ROOMS_TEST_SCRATCH", os.path.join(tempfile.gettempdir(), "surveyed-rooms-tests"))
T4 = os.path.join(SCRATCH, "t4")
STEP_PY = os.path.join(ROOMS, "roombuild", "step.py")
ENV = dict({k: v for k, v in os.environ.items() if k != "SURVEYED_ROOMS_NODE_ROOT"}, SURVEYED_ROOMS_TEST_DEPTH_SIZE="32")
CENTRE = (10.0, 20.0)
PPM = 100
TOP = 3.1
RECT = [[3.0, 2.0], [3.0, -2.0], [-3.0, -2.0], [-3.0, 2.0]]


# --- a small room config and its survey files ---------------------------------------------------------

def config(vertices, ids, openings=(), edits=(), boards="z", refill=True, ceiling_ppm=100):
    gh = roomlib.load(os.path.join(ROOMS, "grand-hall.room.json"))
    survey = {
        "methodRevision": 2,
        "publish": {"folder": "packages/web/public/rooms/t4/survey", "revision": 1},
        "projection": {k: gh["survey"]["projection"][k] for k in ("walls", "ceiling", "floor")},
        "wallViews": {"ppm": PPM, "heightRange": [-0.05, TOP], "eyeInset": 1.2, "near": 0.0, "far": 2.0, "tileMaxLength": 6.0,
                      "modes": ["position"]},
        "ceilingView": {"name": "ceiling-pos", "ppm": ceiling_ppm, "eyeHeight": 1.0, "near": 1.8, "far": 2.6, "modes": ["position"]},
        "floorPhoto": {"ppm": 20, "refill": {"shift": 0.5, "innerFraction": 0.75, "easeDeg": 4}},
        "atlas": {"size": 2048, "height": 768, "ppm": {"pixels": 100, "span": 1}, "vRange": [-0.02, 3.02]},
        "relief": {"container": "GHR1", "ppm": 50, "vRange": [0, 3.0], "depthRange": [-0.8, 0.5], "simplifyError": 0.005,
                   "holdFloor": 0.04, "holdCeiling": 2.96},
        "ceilingRelief": {"container": "GHR1", "id": "ceiling", "ppm": ceiling_ppm / 2, "heightRange": [2.9, 3.3]},
        "outputs": {"walls": [{"file": "walls-2048.webp", "size": [2048, 768]}], "relief": "walls-relief.bin",
                    "ceilingRelief": "ceiling-relief.bin"},
    }
    if not refill:
        survey["floorPhoto"].pop("refill")
    return {
        "schemaVersion": 1, "slug": "t4-room", "name": "T4 room", "venue": "test",
        "source": {"kind": "matterport-e57-twin", "captureId": "t4", "captured": "2026-01-01", "twin": "https://example.invalid/twin",
                   "manifest": "manifest.json", "mesh": "mesh/dollhouse.glb",
                   "panoramas": {"path": "tiles/scan_{index:03d}/equirect_8192.webp", "size": 8192},
                   "frame": {"name": "e57", "units": "m", "up": "+Z"}},
        "transform": {"centre": list(CENTRE), "floorZ": 0.0, "quarterTurns": 1},
        "stations": [{"id": "scan_100", "role": "room"}, {"id": "scan_101", "role": "room"}],
        "walls": {"vertices": vertices, "segments": [{"id": s, "kind": "solid", "height": 3.0} for s in ids]},
        "openings": list(openings),
        "ceiling": {"kind": "flat", "height": 3.0},
        "floor": {"kind": "strip-boards", "boardsRun": boards, "levels": [{"id": "main", "height": 0}]},
        "freeStanding": [], "fittings": [], "edits": list(edits), "occluders": [],
        "survey": survey,
        "provenance": {"measuredBy": "tests/test_gates.py", "method": "synthetic", "date": "2026-10-18", "residuals": []},
    }


def write_room(work, cfg):
    shutil.rmtree(work, ignore_errors=True)
    for d in ("views", "out-walls", "proj", "build", "relief"):
        os.makedirs(os.path.join(work, d))
    with open(os.path.join(work, "room.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(cfg, f, indent=1)
    with open(os.path.join(work, "views", "views-walls.json"), "wb") as f:
        f.write(roomlib.wall_views_bytes(cfg))
    with open(os.path.join(work, "views", "views-ceiling.json"), "wb") as f:
        f.write(roomlib.ceiling_view_bytes(cfg))
    return Room(os.path.join(work, "room.json"), work)


def wall_grid(room, wall):
    """(U, V) over the wall's concatenated tiles, and the tiles."""
    tiles = sorted(room.tiles(wall), key=lambda v: v["tile"])
    width = sum(v["pixels"][0] for v in tiles)
    h = tiles[0]["pixels"][1]
    U, V = np.meshgrid((np.arange(width) + 0.5) / PPM, TOP - (np.arange(h) + 0.5) / PPM)
    return U, V, tiles


def write_wall(room, work, wall, depth, colour=None):
    """out-walls/<tile>.position.f32 (as render.mjs writes them: rows from the bottom) and
    proj/<tile>.npz for depth(U, V) -> (d in front of the face, valid) and colour(U, V) -> linear rgb."""
    U, V, tiles = wall_grid(room, wall)
    d, valid = depth(U, V)
    rgb = colour(U, V) if colour else np.full(U.shape + (3,), 0.4)
    (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]
    P = np.zeros(U.shape + (4,), np.float32)
    P[..., 0] = cX + U * uX + d * nX
    P[..., 1] = cY + U * uY + d * nY
    P[..., 2] = room.cfg["transform"]["floorZ"] + V
    P[..., 3] = valid
    P[~valid, :3] = 0
    offset = 0
    for v in tiles:
        w = v["pixels"][0]
        sl = slice(offset, offset + w)
        P[:, sl][::-1].tofile(os.path.join(work, "out-walls", f"{v['name']}.position.f32"))
        np.savez_compressed(os.path.join(work, "proj", f"{v['name']}.npz"), rgb=rgb[:, sl].astype(np.float32),
                            weight=valid[:, sl].astype(np.float32), valid=valid[:, sl])
        offset += w
    return U, V, P


def flat(U, V):
    return np.zeros(U.shape), np.ones(U.shape, bool)


def step(work, name, *args, depth=None):
    env = ENV if depth is None else dict(ENV, SURVEYED_ROOMS_TEST_DEPTH_SIZE=str(depth))
    r = subprocess.run([sys.executable, "-X", "utf8", STEP_PY, name, "room.json", *args], cwd=work, env=env,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise AssertionError(f"step {name} failed:\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
    return r


def in_dir(path, fn, *args):
    here = os.getcwd()
    os.chdir(path)
    try:
        return fn(*args)
    finally:
        os.chdir(here)


# --- B10 as pure functions -----------------------------------------------------------------------------

def bay(split_true, box=True, planes=(0.5, 0.55), below=1.6, glazing="stained-backlit"):
    """A glazed outline 1.0 wide (u 0.5..1.5, sill 0.9, semicircular head from 1.95) whose glass is
    at planes[0] below split_true and planes[1] above, with an optional box 0.25 m behind the face
    in front of it (u 0.75..0.95, v 0.9..1.2). Returns what geometric_glass and measure_planes take."""
    o = dict(id="bay", kind="window", headShape="semicircular", width=1.2, sill=0.8, head=1.9, glazing=glazing,
             glass=dict(width=1.0, sill=0.9, head=1.95, headShape="semicircular",
                        planes=[dict(depth=planes[0], below=below), dict(depth=planes[1])]))
    H, W = int(TOP * PPM), 200
    V = (TOP - (np.arange(H) + 0.5) / PPM)[:, None]
    U = ((np.arange(W) + 0.5) / PPM)[None, :]
    D = np.where(V < split_true, -planes[0], -planes[1]) * np.ones((1, W))
    if box:
        D = np.where((U >= 0.75) & (U <= 0.95) & (V >= 0.9) & (V <= 1.2), -0.25, D)
    wr = legacy.window_relief()
    Dm = wr.median(D, 9, *windows.RANGE)
    return o, D, Dm, V, U, wr


class GeometricGlass(unittest.TestCase):
    def outline_core(self, ginside, n=8):
        core = ginside.copy()
        for dy in range(-n, n + 1):
            for dx in range(-n, n + 1):
                core &= np.roll(ginside, (dy, dx), (0, 1))
        return core

    def test_a_misplaced_plane_change_leaves_no_hole_and_is_reported(self):
        for split_true in (1.52, 1.68):                        # the config says 1.6
            o, D, Dm, V, U, wr = bay(split_true)
            g, pd, ginside, bars = windows.geometric_glass(o, D, Dm, V, U, 1.0, wr.morph)
            band = (V >= min(split_true, 1.6) + 0.005) & (V <= max(split_true, 1.6) - 0.005)
            core = self.outline_core(ginside) & band
            self.assertGreater(int(core.sum()), 300)
            self.assertTrue(g[core].all(), f"holes in the band between {split_true} and 1.6")
            # window-relief's own test against each row's plane only, the old B10 rule, holes it
            # (lower glass under the upper plane, or upper glass under the lower, sits ~0.05 off).
            old = ginside & (np.isnan(D) | (np.abs(Dm - pd) < windows.GLASS_TOL))
            if split_true < 1.6:
                self.assertFalse(old[core].all(), "the band was not a hole for the old rule either: the test proves nothing")
            check = windows.measure_planes(o["glass"], D, V, ginside, bars)
            (split,) = check["splits"]
            self.assertLessEqual(split["range"][0], split_true + 0.011)
            self.assertGreaterEqual(split["range"][1], split_true - 0.011)
            self.assertEqual(len(check["disagreements"]), 1, check)
            self.assertIn("plane 0 -> 1", check["disagreements"][0])
            self.assertEqual([p["measured"] for p in check["planes"]], [0.5, 0.55])

    def test_a_right_config_is_not_reported(self):
        o, D, Dm, V, U, wr = bay(1.6)
        g, pd, ginside, bars = windows.geometric_glass(o, D, Dm, V, U, 1.0, wr.morph)
        self.assertEqual(windows.measure_planes(o["glass"], D, V, ginside, bars)["disagreements"], [])

    def test_a_plane_too_deep_in_the_config_is_reported(self):
        o, D, Dm, V, U, wr = bay(1.6)
        o["glass"]["planes"][1]["depth"] = 0.59                  # the scan's upper glass is at 0.55
        g, pd, ginside, bars = windows.geometric_glass(o, D, Dm, V, U, 1.0, wr.morph)
        lines = windows.measure_planes(o["glass"], D, V, ginside, bars)["disagreements"]
        self.assertEqual(lines, ["plane 1 is 0.550 deep in the scan, 0.59 in the config"])

    def test_the_box_in_front_is_never_glass(self):
        o, D, Dm, V, U, wr = bay(1.6)
        g, *_ = windows.geometric_glass(o, D, Dm, V, U, 1.0, wr.morph)
        # The box less the 9 x 9 median's reach (4 texels) from its edges, where the median still
        # sees the glass around it: window-relief's method, kept.
        box = (U >= 0.75 + 0.045) & (U <= 0.95 - 0.045) & (V >= 0.9) & (V <= 1.2 - 0.045)
        self.assertGreater(int(box.sum()), 200)
        self.assertEqual(int((g & box).sum()), 0)

    def test_one_plane_keeps_the_old_test(self):
        rng = np.random.default_rng(3)
        D = rng.uniform(-0.7, 0.1, (60, 80))
        D[rng.random(D.shape) < 0.05] = np.nan
        Dm = legacy.window_relief().median(D, 9, *windows.RANGE)
        planes = [dict(depth=0.5)]
        pd = np.full((60, 1), -0.5)
        old = np.isnan(D) | (np.abs(Dm - pd) < windows.GLASS_TOL)
        self.assertTrue(np.array_equal(windows.on_glass(D, Dm, planes), old))

    def test_sheer_ignores_the_scan(self):
        o, D, Dm, V, U, wr = bay(1.6, glazing="sheer")
        o["glass"]["bars"] = [[1.4, 1.45]]
        D = np.full(D.shape, -0.1)                                # the scan sees the sheer
        g, pd, ginside, bars = windows.geometric_glass(o, D, wr.median(D, 9, *windows.RANGE), V, U, 1.0, wr.morph)
        core = self.outline_core(ginside & ~bars, 4)
        self.assertTrue(g[core].all())
        self.assertFalse(g[np.broadcast_to(bars, g.shape)].any())


# --- the windows step end to end (B10 classes, B11, stale masks, the glass record) ----------------------

def windows_room():
    openings = [
        dict(id="frosted", wall="window", kind="window", headShape="semicircular", centre=1.5, width=1.2, sill=0.8, head=1.9,
             glazing="frosted-lower", dressing="none", stateInScan="closed",
             glass=dict(width=1.0, sill=0.9, head=1.95, headShape="semicircular", frostedBelow=1.3,
                        planes=[dict(depth=0.5, below=1.6), dict(depth=0.55)])),
        dict(id="sheer", wall="window", kind="window", headShape="semicircular", centre=4.5, width=1.2, sill=0.8, head=1.9,
             glazing="sheer", dressing="sheer", stateInScan="closed",
             glass=dict(width=1.0, sill=0.9, head=1.95, headShape="semicircular", planes=[dict(depth=0.5)], bars=[[1.4, 1.45]])),
        dict(id="segmental", wall="rear", kind="window", headShape="segmental", headRise=0.3, centre=2.0, width=1.2, sill=0.8,
             head=1.9, glazing="clear", dressing="curtains", stateInScan="closed"),
    ]
    return config(RECT, ["front", "window", "rear", "fire"], openings)


SPLIT_TRUE = 1.52      # the frosted bay's glass changes plane here; its config says 1.6


def window_wall(U, V):
    d = np.zeros(U.shape)
    for c, true_split in ((1.5, SPLIT_TRUE), (4.5, None)):
        du = U - c
        face = (np.abs(du) <= 0.6) & (V >= 0.8) & (V <= 1.9 + np.sqrt(np.maximum(0.0, 0.36 - du ** 2)))
        if true_split is None:
            d[face] = -0.1                                      # the sheer hangs 0.1 behind the face
        else:
            d[face] = np.where(V < true_split, -0.5, -0.55)[face]
            box = (du >= -0.15) & (du <= 0.05) & (V >= 0.9) & (V <= 1.2)
            d[face & box] = -0.25
    return d, np.ones(U.shape, bool)


def rear_wall(U, V):
    """A clear window under a segmental head (centre 2.0, width 1.2, springing 1.9, rise 0.3): the
    whole rectangle up to 2.2 is deep and blue, so only the config's outline can bound the mask."""
    d = np.zeros(U.shape)
    rect = (np.abs(U - 2.0) <= 0.6) & (V >= 0.8) & (V <= 2.2)
    d[rect] = -0.5
    return d, np.ones(U.shape, bool)


def rear_colour(U, V):
    rgb = np.empty(U.shape + (3,))
    rgb[:] = (0.45, 0.35, 0.25)
    rect = (np.abs(U - 2.0) <= 0.6) & (V >= 0.8) & (V <= 2.2)
    rgb[rect] = (0.15, 0.25, 0.6)
    return rgb


class WindowsStep(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = os.path.join(T4, "windows")
        cls.room = write_room(cls.work, windows_room())
        for wall in cls.room.walls:
            write_wall(cls.room, cls.work, wall, {"window": window_wall, "rear": rear_wall}.get(wall["id"], flat),
                       rear_colour if wall["id"] == "rear" else None)
        with open(os.path.join(cls.work, "proj", "front-glass.npy"), "wb") as f:     # stale, from an earlier config
            np.save(f, np.ones((3, 3), bool))
        cls.log = step(cls.work, "windows").stdout
        with open(os.path.join(cls.work, "build", "glass.json"), encoding="utf-8") as f:
            cls.record = json.load(f)

    def mask(self, name):
        return np.load(os.path.join(self.work, "proj", f"{name}-glass.npy"))

    def test_gates(self):
        got = {(r["gate"], r["where"]) for r in self.room.ledger()}
        self.assertTrue({("B10", "opening frosted"), ("B10", "opening sheer"), ("B11", "opening segmental")} <= got, got)

    def test_frosted_lower_bay(self):
        g = self.mask("window")
        U, V, _ = wall_grid(self.room, self.room.wmap["window"])
        du = U - 1.5
        band = (np.abs(du) <= 0.4) & (V >= SPLIT_TRUE + 0.01) & (V <= 1.59)
        box = (du >= -0.12) & (du <= 0.02) & (V >= 0.9) & (V <= 1.17)
        self.assertTrue(g[band].all(), "holes where the config's plane change is off")
        self.assertFalse(g[box].any(), "the box in front of the glass was taken for glass")
        r = self.record["openings"]["frosted"]
        self.assertEqual((r["glazing"], r["method"], r["frostedBelow"]), ("frosted-lower", "outline", 1.3))
        (split,) = r["scan"]["splits"]
        self.assertLessEqual(split["range"][0], SPLIT_TRUE + 0.011)
        self.assertGreaterEqual(split["range"][1], SPLIT_TRUE - 0.011)
        self.assertEqual(len(self.record["disagreements"]), 1)
        self.assertTrue(self.record["disagreements"][0].startswith("frosted: plane 0 -> 1"))
        self.assertIn("WARNING frosted:", self.log)
        layered = np.load(os.path.join(self.work, "proj", "window-layered.npy"))
        self.assertTrue(np.allclose(layered[band & (np.abs(du) <= 0.3)], -0.5, atol=1e-3), "the config's plane is the layer's")

    def test_sheer_bay(self):
        g = self.mask("window")
        U, V, _ = wall_grid(self.room, self.room.wmap["window"])
        du = U - 4.5
        inner = (np.abs(du) <= 0.4) & (V >= 1.0) & (V <= 2.1) & ~((V >= 1.37) & (V <= 1.48))
        bar = (np.abs(du) <= 0.4) & (V >= 1.405) & (V <= 1.445)
        self.assertTrue(g[inner].all())
        self.assertFalse(g[bar].any())
        self.assertNotIn("scan", self.record["openings"]["sheer"])

    def test_clear_segmental_head(self):
        g = self.mask("rear")
        U, V, _ = wall_grid(self.room, self.room.wmap["rear"])
        top = windows._top("segmental", 2.0, 1.2, 1.9, 0.3, U)
        self.assertAlmostEqual(float(top[0, 200]), roomlib.outline_top("segmental", 2.0, 1.2, 1.9, float(U[0, 200]), 0.3))
        self.assertEqual(int((g & (V > top + 1.0 / PPM)).sum()), 0, "glass above the segmental arc")
        self.assertGreater(int((g & (V > 2.0)).sum()), 500, "no glass above the springing")
        r = self.record["openings"]["segmental"]
        self.assertEqual((r["glazing"], r["method"]), ("clear", "colour"))

    def test_stale_mask_removed(self):
        self.assertFalse(os.path.exists(os.path.join(self.work, "proj", "front-glass.npy")))
        self.assertIn("removed stale proj/front-glass.npy", self.log)
        self.assertEqual(sorted(self.record["walls"]), ["rear", "window"])

    def test_atlas_and_relief_refuse_masks_from_other_facts(self):
        self.assertEqual(in_dir(self.work, windows.glass_walls, self.room), {"window", "rear"})
        changed = json.loads(json.dumps(self.room.cfg))
        changed["openings"][0]["glass"]["planes"][1]["depth"] = 0.56
        changed["openings"][0]["note"] = "notes alone change nothing"
        path = os.path.join(self.work, "changed.room.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(changed, f)
        with self.assertRaises(SystemExit) as caught:
            in_dir(self.work, windows.glass_walls, Room(path, self.work))
        self.assertIn("changed since the windows step", str(caught.exception))
        changed["openings"][0]["glass"]["planes"][1]["depth"] = 0.55
        with open(path, "w", encoding="utf-8") as f:
            json.dump(changed, f)
        self.assertEqual(in_dir(self.work, windows.glass_walls, Room(path, self.work)), {"window", "rear"})


# --- B4: a wall that is not axis-aligned through the corners step ------------------------------------------

CHAMFER = [[3.0, 2.0], [3.0, -0.5], [1.0, -2.0], [-3.0, -2.0], [-3.0, 2.0]]
FIN = dict(s=(0.1, 0.25), v=(1.0, 2.0), d=0.3)


def chamfer_wall(U, V):
    d = np.zeros(U.shape)
    d[(U >= FIN["s"][0]) & (U <= FIN["s"][1]) & (V >= FIN["v"][0]) & (V <= FIN["v"][1])] = FIN["d"]
    return d, np.ones(U.shape, bool)


class NotAxisAligned(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = os.path.join(T4, "chamfer")
        cfg = config(CHAMFER, ["front", "chamfer", "window", "rear", "fire"])
        cls.room = write_room(cls.work, cfg)
        assert roomlib.signed_area(CHAMFER) > 0
        cls.wall = cls.room.wmap["chamfer"]
        cls.U = cls.V = cls.P = None
        for wall in cls.room.walls:
            out = write_wall(cls.room, cls.work, wall, chamfer_wall if wall is cls.wall else flat)
            if wall is cls.wall:
                cls.U, cls.V, cls.P = out
        stations = [dict(id="scan_100", t=[CENTRE[0] - 0.0, CENTRE[1] - 0.0, 1.5], gain=1.0),
                    dict(id="scan_101", t=[CENTRE[0] - 1.0, CENTRE[1] + 1.0, 1.5], gain=1.0)]
        data = os.path.join(cls.work, "data")
        box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 3.0, CENTRE[1] + 3.0, 0.0, 3.0)
        synth.write_manifest(data, stations)
        synth.write_depth_maps(data, stations, 32, lambda o, d: synth.box_distance(o, d, box))
        synth.write_panoramas(data, stations, 128, 64, synth.gh_sky)
        cls.log = step(cls.work, "corners").stdout

    def test_gate_open(self):
        self.assertIsNone(self.room.aligned(self.wall))
        self.assertIn(("B4", "wall chamfer"), {(r["gate"], r["where"]) for r in self.room.ledger()})

    def test_fin_moved_back_along_the_normal(self):
        (v,) = self.room.tiles(self.wall)
        w, h = v["pixels"]
        fixed = np.fromfile(os.path.join(self.work, "out-walls", f"{v['name']}.fixed.f32"), np.float32).reshape(h, w, 4)[::-1]
        fin = (self.U >= FIN["s"][0]) & (self.U <= FIN["s"][1]) & (self.V >= FIN["v"][0]) & (self.V <= FIN["v"][1])
        moved = np.any(fixed != self.P, axis=-1)
        self.assertGreater(int(fin.sum()), 1000)
        self.assertTrue(np.array_equal(moved, fin), f"moved {int(moved.sum())} texels, the fin has {int(fin.sum())}")
        (cX, cY), (uX, uY), (nX, nY) = self.wall["cornerE57"], self.wall["uE57"], self.wall["normalE57"]
        depth = (fixed[..., 0] - cX) * nX + (fixed[..., 1] - cY) * nY
        along = (fixed[..., 0] - cX) * uX + (fixed[..., 1] - cY) * uY
        self.assertLess(float(np.abs(depth[fin]).max()), 1e-5)                    # back on the face
        self.assertLess(float(np.abs(along[fin] - self.U[fin]).max()), 1e-5)      # same place along it
        self.assertTrue(np.array_equal(fixed[fin][:, 2], self.P[fin][:, 2]))       # and up it
        self.assertIn("chamfer left fin rows 100", self.log)

    def test_labelled_and_coloured_from_the_moved_positions(self):
        """The best-view method on a wall that is not axis-aligned: its frame comes from the wall's
        own u and normal, and the fin's texels are labelled and coloured where the corners step put them."""
        step(self.work, "labels", "chamfer")
        step(self.work, "wall-photo", "chamfer")
        (v,) = self.room.tiles(self.wall)
        fin = (self.U >= FIN["s"][0]) & (self.U <= FIN["s"][1]) & (self.V >= FIN["v"][0]) & (self.V <= FIN["v"][1])
        labels = np.load(os.path.join(self.work, "proj", "labels-chamfer.npz"))
        self.assertGreater(float((labels["texel_label"][fin] >= 0).mean()), 0.9)
        npz = np.load(os.path.join(self.work, "proj", f"{v['name']}.npz"))
        self.assertGreater(float((npz["weight"][fin] > 0).mean()), 0.9)           # coloured from the panoramas
        self.assertFalse(np.allclose(npz["rgb"][fin], 0.4))
        fine = np.load(os.path.join(self.work, "proj", f"{v['name']}.fine.npz"))
        self.assertEqual(fine["rgb8"].shape[:2], (2 * fin.shape[0], 2 * fin.shape[1]))
        self.assertGreater(float(fine["valid"][::2, ::2][fin].mean()), 0.9)


# --- a wall no station sees -----------------------------------------------------------------------------------------

class UnseenWall(unittest.TestCase):
    """A wall no station sees is labelled nowhere. The build stops there and says which wall:
    project-walls.py levels and colours labelled blocks, and with none it ends in its own
    statistics (an IndexError on the 95th percentile of nothing)."""

    @classmethod
    def setUpClass(cls):
        cls.work = os.path.join(T4, "unseen")
        cls.room = write_room(cls.work, config(RECT, ["screened", "window", "rear", "fire"]))
        for wall in cls.room.walls:
            write_wall(cls.room, cls.work, wall, flat)
        stations = [dict(id="scan_100", t=[CENTRE[0] - 0.0, CENTRE[1] - 0.0, 1.5], gain=1.0),
                    dict(id="scan_101", t=[CENTRE[0] - 1.0, CENTRE[1] + 1.0, 1.5], gain=1.0)]
        data = os.path.join(cls.work, "data")
        # The room is 4 m by 6 m in E57 x and y. In every station's depth map something stands a metre
        # in front of the first wall, across the whole room: nothing of that wall is seen.
        box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 2.0, CENTRE[1] + 3.0, 0.0, 3.0)
        synth.write_manifest(data, stations)
        synth.write_depth_maps(data, stations, 32, lambda o, d: synth.box_distance(o, d, box))
        synth.write_panoramas(data, stations, 128, 64, synth.gh_sky)
        step(cls.work, "corners")

    def run_step(self, name, *args):
        return subprocess.run([sys.executable, "-X", "utf8", STEP_PY, name, "room.json", *args], cwd=self.work, env=ENV,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    def refused(self, r):
        said = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, said[-3000:])
        self.assertIn("wall screened: no station labels any block of it", said)
        self.assertIn("2 stations tried", said)
        self.assertNotIn("Traceback", said)
        self.assertNotIn("B25", said)                           # no occluder margin here: the stop does not speak of one

    def test_1_the_labels_step_stops_at_the_wall_by_name(self):
        self.refused(self.run_step("labels", "screened"))
        with open(os.path.join(self.work, "proj", "labels-screened.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["labelled_blocks"], 0)       # the report stays, for whoever looks

    def test_2_the_photographs_stop_at_it_too(self):
        """As after a labels step by tools older than this refusal: the report is there, with nothing labelled."""
        if not os.path.exists(os.path.join(self.work, "proj", "labels-screened.json")):
            self.run_step("labels", "screened")
        self.refused(self.run_step("wall-photo", "screened"))

    def test_3_a_wall_that_is_seen_is_labelled_and_coloured_as_ever(self):
        step(self.work, "labels", "rear")
        step(self.work, "wall-photo", "rear")
        with open(os.path.join(self.work, "proj", "labels-rear.json"), encoding="utf-8") as f:
            self.assertGreater(json.load(f)["labelled_blocks"], 0)


# --- B23: tiles narrower than the wall's rounded length ------------------------------------------------------------

NARROW = [[6.021, 3.503], [6.021, -3.503], [-6.021, -3.503], [-6.021, 3.503]]
NARROW_FIN = dict(s=(0.1, 0.25), v=(1.0, 2.0), d=0.3)          # s: metres from the wall's right end


class NarrowTiles(unittest.TestCase):
    """Each tile's width is rounded on its own, so a wall's tiles can be narrower than its rounded
    length: 7.006 m in two tiles is 2 x 350 = 700 columns against round(700.6) = 701 (the Saloon's
    fireplace wall is 1556 against 1557), and 12.042 m in three is 3 x 401 = 1203 against 1204.
    The Grand Hall's scripts index from the rounded length, which lies inside its tiles; here the
    wall ends at its tiles' last column, through the corners, the relief, the atlas and the detail."""

    @classmethod
    def setUpClass(cls):
        cls.work = os.path.join(T4, "narrow")
        cfg = config(NARROW, ["east", "south", "west", "north"])
        cfg["survey"]["detail"] = {"texel": 0.005, "tile": 256, "gutter": 8}
        cfg["survey"]["outputs"]["detail"] = "detail"
        cls.room = write_room(cls.work, cfg)
        cls.grids = {}
        for wall in cls.room.walls:
            cls.grids[wall["id"]] = cls.write_true_tiles(wall)
        stations = [dict(id="scan_100", t=[CENTRE[0] - 1.0, CENTRE[1] - 2.0, 1.5], gain=1.0),
                    dict(id="scan_101", t=[CENTRE[0] + 1.0, CENTRE[1] + 2.5, 1.5], gain=1.0)]
        data = os.path.join(cls.work, "data")
        box = (CENTRE[0] - 3.503, CENTRE[0] + 3.503, CENTRE[1] - 6.021, CENTRE[1] + 6.021, 0.0, 3.0)
        synth.write_manifest(data, stations)
        synth.write_depth_maps(data, stations, 32, lambda o, d: synth.box_distance(o, d, box))
        synth.write_panoramas(data, stations, 256, 128, synth.gh_sky)
        cls.log = step(cls.work, "corners").stdout

    @classmethod
    def write_true_tiles(cls, wall):
        """Position tiles with every texel at its tile's own centre (the tile's width over its
        pixels, as render.mjs draws it), a fin near the right end, and a blended npz per tile."""
        (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]
        us, fins = [], []
        for v in sorted(cls.room.tiles(wall), key=lambda v: v["tile"]):
            w, h = v["pixels"]
            U, V = np.meshgrid(v["u0"] + (np.arange(w) + 0.5) * v["size"][0] / w, TOP - (np.arange(h) + 0.5) * v["size"][1] / h)
            s = wall["length"] - U
            fin = (s >= NARROW_FIN["s"][0]) & (s <= NARROW_FIN["s"][1]) & (V >= NARROW_FIN["v"][0]) & (V <= NARROW_FIN["v"][1])
            d = np.where(fin, NARROW_FIN["d"], 0.0)
            P = np.zeros((h, w, 4), np.float32)
            P[..., 0] = cX + U * uX + d * nX
            P[..., 1] = cY + U * uY + d * nY
            P[..., 2] = V
            P[..., 3] = 1
            P[::-1].tofile(os.path.join(cls.work, "out-walls", f"{v['name']}.position.f32"))
            np.savez_compressed(os.path.join(cls.work, "proj", f"{v['name']}.npz"), rgb=np.full((h, w, 3), 0.4, np.float32),
                                weight=np.ones((h, w), np.float32), valid=np.ones((h, w), bool))
            us.append(U[0])
            fins.append(fin)
        return np.concatenate(us), np.concatenate(fins, 1)

    def fixed(self, wall):
        tiles = []
        for v in sorted(self.room.tiles(wall), key=lambda v: v["tile"]):
            w, h = v["pixels"]
            tiles.append(np.fromfile(os.path.join(self.work, "out-walls", f"{v['name']}.fixed.f32"), np.float32).reshape(h, w, 4)[::-1])
        return np.concatenate(tiles, 1)

    def test_1_gate_and_columns(self):
        columns = {w["id"]: (self.room.tile_columns(w), self.room.rounded_columns(w)) for w in self.room.order}
        self.assertEqual(columns, {"east": (700, 701), "south": (1203, 1204), "west": (700, 701), "north": (1203, 1204)})
        self.assertEqual(sorted(r["where"] for r in self.room.ledger() if r["gate"] == "B23"),
                         ["wall east", "wall north", "wall south", "wall west"])
        self.assertEqual(self.room.narrow_walls(), {"east": 700, "south": 1203, "west": 700, "north": 1203})
        gh = Room(os.path.join(ROOMS, "grand-hall.room.json"), ROOMS)
        self.assertEqual(gh.narrow_walls(), {})
        self.assertEqual([(gh.tile_columns(w), gh.rounded_columns(w)) for w in gh.order], [(4228, 4227), (4228, 4227), (2118, 2118), (2118, 2118)])

    def test_2_corners_reach_the_last_column(self):
        """The right end's fin search starts at the tiles' last column (the rounded length would
        index one past it: IndexError), and moves the fin back."""
        for wall in self.room.order:
            _, fin = self.grids[wall["id"]]
            fixed = self.fixed(wall)
            self.assertEqual(fixed.shape[1], self.room.tile_columns(wall))
            depth = self.room.depth(wall, fixed)
            self.assertGreater(int(fin.sum()), 1000)
            self.assertGreater(float((np.abs(depth[fin]) < 1e-4).mean()), 0.9, f"{wall['id']}: the right end's fin was not moved back")
            self.assertLess(float(np.abs(depth[~fin]).max()), 1e-4, f"{wall['id']}: texels beyond the fin moved")
            self.assertIn(f"{wall['name']} right fin rows 100", self.log)

    def test_3_relief_and_atlas_take_the_tiles_whole(self):
        step(self.work, "windows")
        step(self.work, "wall-depth")
        for wall in self.room.order:
            with open(os.path.join(self.work, "relief", f"{wall['name']}.json"), encoding="utf-8") as f:
                meta = json.load(f)
            cols = self.room.tile_columns(wall)
            self.assertEqual(meta["width"], cols // 2)       # an odd count drops its last column, as the Grand Hall's 4227 does
            D2 = np.fromfile(os.path.join(self.work, "relief", f"{wall['name']}.f32"), np.float32).reshape(meta["height"], meta["width"])
            self.assertLess(float(np.abs(D2[80:220]).max()), 0.13)
        step(self.work, "atlas")
        with open(os.path.join(self.work, "build", "atlas.json"), encoding="utf-8") as f:
            strips = {s["wall"]: s for s in json.load(f)["strips"]}
        png = np.asarray(Image.open(os.path.join(self.work, "proj", "walls-2048.png")))
        for name, s in strips.items():
            strip = png[s["y"]:s["y"] + s["h"], s["x"]:s["x"] + s["w"], :3].astype(int)
            self.assertEqual(s["w"], int(np.ceil(self.room.wmap[name]["length"] * 100)))
            self.assertLess(int(np.abs(strip - strip[0, 0]).max()), 2, f"{name}: the strip is not the wall's one colour to its last column")
            self.assertGreater(int(strip.min()), 100)

    def test_4_labels_photographs_and_detail_on_a_narrow_wall(self):
        step(self.work, "labels", "east")
        step(self.work, "wall-photo", "east")
        step(self.work, "detail", "east")
        fine = [np.load(os.path.join(self.work, "proj", f"wall-east-{t}.fine.npz")) for t in (0, 1)]
        self.assertEqual(sum(f["rgb8"].shape[1] for f in fine), 2 * 700)
        valid = np.concatenate([f["valid"] for f in fine], 1)
        self.assertGreater(float(valid.mean()), 0.3)         # two stations and 32-texel depth maps see about half of it
        with open(os.path.join(self.work, "proj", "detail-east.json"), encoding="utf-8") as f:
            report = json.load(f)
        self.assertEqual(report["atlas_scale"]["k_u"], 100.0 * 700 / 701, "the detail does not map onto the atlas's crop of the tiles")
        self.assertEqual(report["image"], [3 * 240 + 16, 6 * 240 + 16])
        step(self.work, "windows")
        step(self.work, "atlas")                             # the same wall again, from its half-texel orthophoto
        with open(os.path.join(self.work, "build", "atlas.json"), encoding="utf-8") as f:
            s = next(s for s in json.load(f)["strips"] if s["wall"] == "east")
        png = np.asarray(Image.open(os.path.join(self.work, "proj", "walls-2048.png")))
        self.assertGreater(int(png[s["y"] + 50:s["y"] + 250, s["x"] + s["w"] - 3:s["x"] + s["w"], :3].min()), 10, "the strip's last columns are empty")
        self.assertEqual(s["w"], 701)


# --- B24: texels the renderer placed off their own centres ------------------------------------------------------------

STRAYS = [(250, 6, 2.45), (250, 7, 5.82)]        # (row from the top, column, metres behind the camera) on the east wall
STRAY_OFF = (0.0018, 0.0036)                     # along the wall and down it: the Saloon's worst texel, 1.75 / 3.63 mm


class StrayTexels(unittest.TestCase):
    """render.mjs draws a surface seen edge-on as a sliver under a texel high and can extrapolate
    along it: the point it writes lies metres off the view's slab and millimetres off the texel.
    The Saloon's fireplace wall has two (the floor, below v = 0): 0.7 / 1.6 mm and 1.75 / 3.63 mm
    off their centres, 2.45 m and 5.82 m behind the camera, where every other covered texel of the
    room is within 0.19 mm. The labels place each texel at its centre and refuse the tile
    (bestview.Grid). With survey.wallViews.strayTexels the corners step leaves such texels out of
    the tile, up to that many; without it, or with more of them, the build stops as before."""

    @classmethod
    def make(cls, name, allowed, shift=0.0, data=False):
        work = os.path.join(T4, name)
        cfg = config(RECT, ["east", "south", "west", "north"])
        if allowed:
            cfg["survey"]["wallViews"]["strayTexels"] = allowed
        room = write_room(work, cfg)
        wall = room.wmap["east"]
        clean = None
        for w in room.walls:
            _, _, P = write_wall(room, work, w, flat)
            if w is wall:
                clean = P
        (v,) = room.tiles(wall)
        (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]
        inset = cfg["survey"]["wallViews"]["eyeInset"]
        P = clean.copy()
        if shift:                                                # the whole grid in the wrong place
            P[..., 0] += np.float32(shift * uX)
            P[..., 1] += np.float32(shift * uY)
        for r, c, behind in STRAYS:
            u = (c + 0.5) / PPM - STRAY_OFF[0]
            P[r, c, 0] = cX + u * uX + (inset + behind) * nX
            P[r, c, 1] = cY + u * uY + (inset + behind) * nY
            P[r, c, 2] = TOP - (r + 0.5) / PPM - STRAY_OFF[1]
        P[::-1].tofile(os.path.join(work, "out-walls", f"{v['name']}.position.f32"))
        if data:
            stations = [dict(id="scan_100", t=[CENTRE[0] - 0.0, CENTRE[1] - 0.0, 1.5], gain=1.0),
                        dict(id="scan_101", t=[CENTRE[0] - 1.0, CENTRE[1] + 1.0, 1.5], gain=1.0)]
            box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 3.0, CENTRE[1] + 3.0, 0.0, 3.0)
            synth.write_manifest(os.path.join(work, "data"), stations)
            synth.write_depth_maps(os.path.join(work, "data"), stations, 32, lambda o, d: synth.box_distance(o, d, box))
            synth.write_panoramas(os.path.join(work, "data"), stations, 128, 64, synth.gh_sky)
        return work, room, v, clean

    def fixed(self, work, v):
        w, h = v["pixels"]
        return np.fromfile(os.path.join(work, "out-walls", f"{v['name']}.fixed.f32"), np.float32).reshape(h, w, 4)[::-1]

    def test_1_without_the_allowance_the_labels_refuse_the_tile(self):
        work, room, v, _ = self.make("stray-closed", 0)
        self.assertNotIn("B24", {r["gate"] for r in room.ledger()})
        self.assertNotIn("stray", step(work, "corners").stdout)
        self.assertFalse(os.path.exists(os.path.join(work, "build", "stray-texels.json")))
        with self.assertRaisesRegex(AssertionError, r"wall-east-0\.fixed\.f32: positions are off their texel centres by 0\.0018 / 0\.0036 m"):
            step(work, "labels", "east")

    def test_2_allowed_strays_are_left_out_and_the_wall_is_labelled_and_coloured(self):
        work, room, v, clean = self.make("stray-open", 4, data=True)
        self.assertIn(("B24", "wall views", "up to 4 a tile"), {(r["gate"], r["where"], r["note"]) for r in room.ledger()})
        log = step(work, "corners").stdout
        self.assertRegex(log, r"east wall-east-0 stray texels left out 2 off their centres by up to 1\.(79|80)\d / 3\.(59|60)\d mm")
        self.assertIn("east moved 0", log)                       # the strays took no part in the fin search
        fixed = self.fixed(work, v)
        stray = np.zeros(fixed.shape[:2], bool)
        for r, c, _ in STRAYS:
            stray[r, c] = True
        self.assertTrue(np.all(fixed[stray] == 0))               # uncovered, as where the mesh has a hole
        self.assertTrue(np.array_equal(fixed[~stray], clean[~stray]))
        with open(os.path.join(work, "build", "stray-texels.json"), encoding="utf-8") as f:
            record = json.load(f)
        self.assertEqual((record["allowedPerTile"], record["leftOut"]), (4, 2))
        (tile,) = [t for t in record["tiles"] if t["texels"]]
        self.assertEqual((tile["tile"], tile["covered"]), ("wall-east-0", fixed.shape[0] * fixed.shape[1]))
        self.assertEqual([(t["row"], t["column"], t["slabDepth"]) for t in tile["texels"]], [(250, 6, -2.45), (250, 7, -5.82)])
        step(work, "labels", "east")                             # the old code stops here: the tile is refused
        step(work, "wall-photo", "east")
        with open(os.path.join(work, "proj", "labels-east.json"), encoding="utf-8") as f:
            report = json.load(f)
        self.assertEqual(report["texels_valid"], fixed.shape[0] * fixed.shape[1] - 2)
        labels = np.load(os.path.join(work, "proj", "labels-east.npz"))
        self.assertTrue(np.all(labels["texel_label"][stray] == -1))
        self.assertGreater(float((labels["texel_label"] >= 0).mean()), 0.3)
        npz = np.load(os.path.join(work, "proj", f"{v['name']}.npz"))
        self.assertTrue(np.all(npz["weight"][stray] == 0))
        self.assertGreater(float((npz["weight"] > 0).mean()), 0.3)
        fine = np.load(os.path.join(work, "proj", f"{v['name']}.fine.npz"))
        self.assertFalse(np.repeat(np.repeat(stray, 2, 0), 2, 1)[fine["valid"]].any())

    def test_3_more_strays_than_allowed_stop_the_corners(self):
        work, _, _, _ = self.make("stray-many", 1)
        with self.assertRaisesRegex(AssertionError, r"wall-east-0\.position\.f32: 2 covered texels lie off their centres \(by up to 0\.0018 / 0\.0036 m\); "
                                                    r"survey\.wallViews\.strayTexels allows 1 a tile"):
            step(work, "corners")
        self.assertFalse(os.path.exists(os.path.join(work, "out-walls", "wall-east-0.fixed.f32")))

    def test_4_a_grid_in_the_wrong_place_still_stops_the_build(self):
        work, _, v, _ = self.make("stray-shifted", 4, shift=0.002)
        w, h = v["pixels"]
        with self.assertRaisesRegex(AssertionError, rf"wall-east-0\.position\.f32: {w * h} covered texels lie off their centres"):
            step(work, "corners")


# --- B25: the occluders' margin ---------------------------------------------------------------------------------

PROUD = dict(u=(2.5, 3.5), v=(1.7, 2.3), d=0.3)   # the box as the mesh draws it, on the south wall (6 m)
PROUD_SHORT = 0.06                                # the mesh draws it this much smaller, every side, than the panoramas show it
PROUD_MARGIN = 0.08                               # survey.projection.walls.occluderMargin for it
PROUD_DEPTH = 256                                 # cubemap texels: 8 to 12 mm at the box
PROUD_STATIONS = (("scan_100", 2.0, 1.2), ("scan_101", 4.0, 1.2), ("scan_102", 3.0, 3.2))   # id, u along the wall, metres off it


def slab_distance(origin, dirs, lo, hi):
    """Distance along unit dirs (..., 3) from origin (outside the cuboid lo..hi) to the cuboid; inf where missed."""
    with np.errstate(divide="ignore", invalid="ignore"):
        t0 = (np.asarray(lo) - origin) / dirs
        t1 = (np.asarray(hi) - origin) / dirs
    enter = np.minimum(t0, t1).max(axis=-1)
    leave = np.maximum(t0, t1).min(axis=-1)
    return np.where((leave >= enter) & (leave > 0), np.maximum(enter, 0.0), np.inf)


def proud_room(name, margin, thing, short, stations, depth, pano=(2048, 1024)):
    """A T4 room with `thing` (u, v, d: as the mesh draws it) standing proud of its south wall, which the panoramas
    show `short` larger on every side; its south wall labelled and photographed with
    survey.projection.walls.occluderMargin = margin (0: without the key). Returns the room, the wall's grid (U, V)
    and its points in E57, the stations' positions, the thing as the panoramas show it (a cuboid in E57), the
    labels and their report, and the photograph's luminance and coverage."""
    work = os.path.join(T4, name)
    cfg = config(RECT, ["east", "south", "west", "north"])
    cfg["stations"] = [{"id": sid, "role": "room"} for sid, _, _ in stations]
    if margin:
        cfg["survey"]["projection"]["walls"] = dict(cfg["survey"]["projection"]["walls"], occluderMargin=margin)
    room = write_room(work, cfg)
    wall = room.wmap["south"]
    (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]

    def e57(u, off, z):
        return np.array([cX + u * uX + off * nX, cY + u * uY + off * nY, z])

    def cuboid(grow):
        pts = np.array([e57(u, d, v) for u in (thing["u"][0] - grow, thing["u"][1] + grow)
                        for v in (thing["v"][0] - grow, thing["v"][1] + grow) for d in (-0.5, thing["d"])])
        return pts.min(axis=0), pts.max(axis=0)

    def relief(U, V):
        inside = (U >= thing["u"][0]) & (U <= thing["u"][1]) & (V >= thing["v"][0]) & (V <= thing["v"][1])
        return np.where(inside, thing["d"], 0.0), np.ones(U.shape, bool)

    U = V = points = None
    for w in room.walls:
        out = write_wall(room, work, w, relief if w is wall else flat)
        if w is wall:
            U, V, points = out
    at = [dict(id=sid, t=list(e57(u, off, 1.5)), gain=1.0) for sid, u, off in stations]
    box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 3.0, CENTRE[1] + 3.0, 0.0, 3.0)
    mesh, real = cuboid(0.0), cuboid(short)
    data = os.path.join(work, "data")
    synth.write_manifest(data, at)
    synth.write_depth_maps(data, at, depth,
                           lambda o, d: np.minimum(synth.box_distance(o, d, box), slab_distance(o, d, *mesh)))

    def colour(s, dirs):
        o = np.asarray(s["t"], float)
        grain = np.random.default_rng(20261116 + int(s["id"][5:])).random(dirs.shape[:2]) - 0.5
        plaster = np.array([0.50, 0.47, 0.42]) * (1 + 0.08 * grain[..., None])
        hit = slab_distance(o, dirs, *real) < synth.box_distance(o, dirs, box)
        return np.where(hit[..., None], np.array([0.03, 0.02, 0.015]), plaster)

    synth.write_panoramas(data, at, *pano, colour)
    step(work, "labels", "south", depth=depth)
    step(work, "wall-photo", "south", depth=depth)
    (v,) = room.tiles(wall)
    npz = np.load(os.path.join(work, "proj", f"{v['name']}.npz"))
    labels = np.load(os.path.join(work, "proj", "labels-south.npz"))
    with open(os.path.join(work, "proj", "labels-south.json"), encoding="utf-8") as f:
        report = json.load(f)
    return dict(room=room, U=U, V=V, points=points[..., :3].astype(np.float64), stations=[np.asarray(s["t"], float) for s in at],
                real=real, labels=labels, report=report, lum=npz["rgb"] @ np.array([0.2126, 0.7152, 0.0722]), coloured=npz["weight"] > 0)


class OccluderMargin(unittest.TestCase):
    """A box stands 0.3 m proud of a plain wall. The mesh (the position tiles and the distance cubemaps) draws it
    smaller on every side than the panoramas show it, as the scan's mesh draws the Saloon's pediments (0.3 m proud,
    2 to 3 cm short: a rim up to a 4 cm block wide on its 5 mm grid). Here the grid is 1 cm and the box 6 cm short,
    so the rim is a block wide too. Two stations 1.2 m off the wall, either side of the box, and one 3.2 m off,
    facing it. Along the edge of the zone the box hides from a near station, that station's panorama still shows
    the box's dark edge on wall the mesh says it sees. One station a block prints it: outlines of the box in the
    plain wall, a third of a metre above it and half a metre beside it. With
    survey.projection.walls.occluderMargin the labels leave a station's view out within the margin of the box's
    outline, and another station's clean view takes its place."""

    @classmethod
    def build(cls, name, margin):
        c = proud_room(name, margin, PROUD, PROUD_SHORT, PROUD_STATIONS, PROUD_DEPTH)
        U, V = c["U"], c["V"]
        # plain wall that some station truly sees: more than 20 cm from the mesh's outline of the box (the far
        # station's view of the real box hides the wall up to 15 cm above it)
        du = np.maximum(np.maximum(PROUD["u"][0] - U, U - PROUD["u"][1]), 0)
        dv = np.maximum(np.maximum(PROUD["v"][0] - V, V - PROUD["v"][1]), 0)
        plain = (np.hypot(du, dv) > 0.20) & (V > 0.2) & (V < 2.9)
        ghost = plain & c["coloured"] & (c["lum"] < 0.25)         # the box's dark picture (0.02) on plaster (0.47)
        return dict(c, ghost=ghost, plain=plain)

    @classmethod
    def setUpClass(cls):
        cls.closed = cls.build("margin-closed", 0)
        cls.open = cls.build("margin-open", PROUD_MARGIN)

    def test_1_gate(self):
        self.assertNotIn("B25", {r["gate"] for r in self.closed["room"].ledger()})
        self.assertEqual(self.closed["room"].occluder_margin(), 0.0)
        self.assertIn(("B25", "walls", "80 mm"), {(r["gate"], r["where"], r["note"]) for r in self.open["room"].ledger()})
        self.assertEqual(legacy.best_view_values(self.open["room"])["bestview"]["OCCLUDER_MARGIN"], PROUD_MARGIN)
        gh = Room(os.path.join(ROOMS, "grand-hall.room.json"), ROOMS)
        self.assertEqual(legacy.best_view_values(gh)["bestview"]["OCCLUDER_MARGIN"], 0.0)
        self.assertNotIn("B25", {r["gate"] for r in gh.ledger()})

    def test_2_without_the_margin_the_box_is_outlined_in_the_plain_wall(self):
        c = self.closed
        self.assertGreater(int(c["ghost"].sum()), 300, "the fault did not occur: the test proves nothing")
        self.assertGreater(float(c["V"][c["ghost"]].max()), PROUD["v"][1] + 0.15)      # far above the box
        self.assertNotIn("seenbits", c["labels"].files)                                 # the files are as before
        self.assertNotIn("clearbits", c["labels"].files)
        self.assertNotIn("occluder_margin", c["report"])

    def test_3_with_the_margin_the_plain_wall_is_clean_and_nothing_becomes_a_hole(self):
        c, o = self.closed, self.open
        self.assertEqual(int(o["ghost"].sum()), 0, f"{int(o['ghost'].sum())} dark texels left in the plain wall")
        self.assertGreaterEqual(int((o["coloured"] & o["plain"]).sum()), int((c["coloured"] & c["plain"]).sum()))
        self.assertGreaterEqual(int(o["coloured"].sum()), int(c["coloured"].sum()))    # the doubtful views fill what is left
        margin = o["report"]["occluder_margin"]
        self.assertEqual((margin["metres"], margin["cubemap_texels_at_most"]), (PROUD_MARGIN, 16))
        lb = o["labels"]
        seen, clear, used = lb["seenbits"], lb["clearbits"], lb["visbits"]
        self.assertTrue(np.all(clear & ~seen == 0))                                     # clear views are views
        self.assertTrue(np.all(clear & ~used == 0) and np.all(used & ~seen == 0))      # used = clear + the doubtful views given
        given = int(np.unpackbits(used & ~clear).sum())
        self.assertEqual(given, margin["texels_given_a_doubtful_view"])
        self.assertEqual(int((lb["texel_label"] >= 0).sum()), margin["texels_labelled_clear"] + given)
        # every texel some station saw at all has a station (nothing the old labels coloured is lost)
        self.assertEqual(int((lb["texel_label"] >= 0).sum()), int(np.unpackbits(np.bitwise_or.reduce(seen, axis=0)).sum()))
        taken = int(np.unpackbits(seen & ~clear).sum())
        self.assertGreater(taken, 1000)                                                 # the margin took views out
        self.assertLess(given, taken / 4)                                               # and few texels had no other
        self.assertEqual(margin["views_left_out"], taken)
        self.assertLessEqual(margin["views_left_out_where_the_margin_was_capped"], taken)
        self.assertEqual(margin["texels_given_a_clear_view_from_outside_the_ranking"], 0)   # three stations: a block ranks them all
        # a doubtful view is taken only where no station has a clear one
        self.assertEqual(given, int(np.unpackbits(np.bitwise_or.reduce(seen, axis=0) & ~np.bitwise_or.reduce(clear, axis=0)).sum()))
        near = margin["doubtful_view_clearance_mm"]
        self.assertTrue(0 < near["least"] <= near["median"] <= near["greatest"] <= PROUD_MARGIN * 1000 + 0.05, near)

    def test_4_the_margin_is_the_walls_alone(self):
        cfg = json.loads(json.dumps(self.open["room"].cfg))
        cfg["survey"]["projection"]["ceiling"]["occluderMargin"] = PROUD_MARGIN
        work = os.path.join(T4, "margin-ceiling")
        room = write_room(work, cfg)
        self.assertTrue(any("survey.projection.ceiling.occluderMargin" in p for p in room.build_problems()))
        import check_room  # noqa: PLC0415
        schema = roomlib.load(os.path.join(ROOMS, "room.schema.json"))
        errors = check_room.validate(cfg["survey"]["projection"], schema["$defs"]["survey"]["properties"]["projection"], schema)
        self.assertEqual([path for path, _ in errors], ["$.ceiling"], errors)
        self.assertEqual(check_room.validate(self.open["room"].cfg["survey"]["projection"],
                                             schema["$defs"]["survey"]["properties"]["projection"], schema), [])

    def test_5_a_doubtful_view_is_the_first_of_the_blocks_sequence_and_not_the_farthest(self):
        """Where the rules for a doubtful view part, end to end. In this room the view that passes farthest from
        the box's outline is another station's than the first of the block's sequence on some hundreds of doubtful
        texels. So labels made with the farthest view (the rule this replaced), or a main() that hands
        doubtful_views another sequence, fail here; the pier's room below labels identically under either rule
        and cannot tell. The committed measuring script works both out from the labels' own arrays
        (measure/walls/doubtful_rules.py: its `sequence` rule is the first station of label-views.py's
        block_sequence that saw the texel), which also runs that script on every change."""
        script = os.path.join(ROOMS, "measure", "walls", "doubtful_rules.py")
        out = os.path.join(T4, "margin-open-rules.json")
        r = subprocess.run([sys.executable, "-X", "utf8", script, os.path.join(T4, "margin-open"), out, "--depth-size", str(PROUD_DEPTH)],
                           cwd=os.path.dirname(script), env=ENV, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, (r.stdout or "")[-1500:] + (r.stderr or "")[-1500:])
        with open(out, encoding="utf-8") as f:
            rules = json.load(f)
        given = self.open["report"]["occluder_margin"]["texels_given_a_doubtful_view"]
        self.assertGreater(given, 1000)
        self.assertEqual(rules["walls"]["south"]["doubtful_texels"], given)
        self.assertEqual(rules["sequence_differs_from_the_builds_own_labels"], 0,
                         "a doubtful texel's label is not the first station of its block's sequence that saw it")
        self.assertGreater(rules["the_farthest_view_is_another_station_than_the_sequences"], 300,
                           "the farthest view and the sequence agree in this room: the test proves nothing")


PIER = dict(u=(2.29, 3.07), v=(-0.5, 3.5), d=0.2)  # as the mesh draws it: the wall's whole height, each flank three columns into a block
PIER_SHORT = 0.03                                 # the panoramas show it this much wider at each flank
PIER_MARGIN = 0.03
PIER_DEPTH = 512                                  # cubemap texels: 4 to 5 mm at the pier from the near stations
PIER_STATIONS = (("scan_100", 2.95, 1.2), ("scan_101", 2.84, 1.3), ("scan_102", 2.73, 1.1), ("scan_103", 2.63, 1.25),
                 ("scan_104", 2.52, 1.15), ("scan_105", 2.41, 1.2),              # six in front of the pier, a little over a metre off
                 ("scan_106", 3.10, 3.4), ("scan_107", 2.26, 3.4))               # two 3.4 m off, each facing the wall beside a flank


class OccluderMarginManyStations(unittest.TestCase):
    """More stations than a block ranks (label-views.py's RANKED, 6), and a pier that stands 0.2 m proud over the
    wall's whole height, which the mesh draws 3 cm narrow at each flank. Six stations stand in front of the pier, a
    little over a metre off, and two 3.4 m off, each facing the plain wall beside a flank. The block at a flank
    holds three columns of the pier's face and five of the wall beside it. All six near stations see the face
    clear, so they are the block's candidates and, being the sharpest, its whole ranking; the far station, which
    alone sees the wall beside the pier clear, comes seventh. The near station by the flank sees that wall too, past
    the pier's edge and within its margin, and its panorama shows the pier there. Labels that ask only the six
    ranked stations print that station's picture of the pier on the plain wall, 1 to 2 cm from the pier itself:
    the outline the margin exists to remove, in the band the box's test above leaves out. With every station
    asked, in the block's one sequence (its ranked stations, then the others by how much of the block they saw at
    all, ties to the earlier station), those texels take a far station's clear view, the first of the sequence
    that saw them clear. A doubtful view is left for the texels no station sees clear, and it is the first of the
    same sequence that saw the texel at all, not the one that passes farthest from the pier's edge: on the
    Saloon's walls the farthest view showed the edge as often and put far more texels in another station's
    picture. Both steps ask one sequence because it is the simpler code and the closest to the first build, not
    because the Saloon's walls showed the first step's own order worse: of the 209 texels whose clear view had
    changed station, the lean was one wall's, and it does not fail after Holm's correction over the 24 tests
    (p 0.94); the study cannot tell the two orders apart (T-739; the README has the numbers). This room cannot
    tell them apart either: each texel here that only stations beyond its block's ranking see clear is seen clear
    by one of them alone (test_1), so any order past the ranking gives it the same view. The order among those
    stations, and main()'s handing of the one sequence to both steps, are held by unit tests
    (test_units.MarginViews), not here. Nor can this room tell the rules for a doubtful view apart: it labels
    identically under the farthest view (every array of its labels file; none of its 672 doubtful texels lies on
    the plain wall), so test_3's 0 is the first step's and the margin's doing. The box's room above is where
    those rules part (OccluderMargin.test_5).

    What this world can prove is asserted here and no threshold is loosened: no doubtful texel that any station
    saw clear, and no plain texel left that shows the pier (exactly 0). That a margin of 0 changes nothing is
    proved elsewhere: test_gh_scripts holds the hall's steps to its scripts as written, and when this rule was
    settled the labels of a synthetic room and of the Grand Hall's real END wall were compared byte for byte at a
    margin of 0 (runs, not tests; the README has the account). What this world cannot prove is which doubtful
    view is the better one. On the review's own synthetic wall (a pediment 0.3 m proud and a pilaster 0.15 m proud, the mesh
    2 cm short, 7 stations, 50 mm; not this pier), the texels whose label's panorama shows a box were 99 without a
    margin, 211 with the first step missing, 51 with the farthest view and 113 with this rule. So by that count
    this rule is worse than the farthest view there, and worse than no margin: 69 of the 113 show the box without
    a margin too, from the same station, and the other 44 lie in blocks that the margin ranks differently (a
    station's cover of a block is its clear cover). Of the 99 without a margin, 69 are carried over, 8 are cured
    and 22 show the box from another station; 22 more are new. With the margin the labels' glare test rejects 31
    views in 25 blocks of that wall, which has no glare, and none without; 41 of the 44 lie in those blocks, but
    so do 449 of the wall's 499 doubtful texels, so that says nothing of the cause by itself.
    That count was the bar for the second step when it was
    written, and it is retired for it: a synthetic panorama is drawn from the true geometry with one exposure and
    exact poses, where another station's picture costs nothing, and the Saloon's photographs said otherwise."""

    @classmethod
    def build(cls, name, margin):
        c = proud_room(name, margin, PIER, PIER_SHORT, PIER_STATIONS, PIER_DEPTH, pano=(1024, 512))
        U, V, tl = c["U"], c["V"], c["labels"]["texel_label"]
        beside = np.maximum(np.maximum(PIER["u"][0] - U, U - PIER["u"][1]), 0)     # metres from the mesh's outline of the pier
        plain = (beside > PIER_SHORT) & (V > 0) & (V < 3.0)                        # wall the pier does not cover, inside the room
        # where each station's panorama shows the pier: it stands between the station and the texel
        shows = []
        for o in c["stations"]:
            ray = c["points"] - o
            dist = np.linalg.norm(ray, axis=-1)
            shows.append(slab_distance(o, ray / dist[..., None], *c["real"]) < dist - 1e-3)
        ghost = (tl >= 0) & plain & np.take_along_axis(np.array(shows), np.maximum(tl, 0)[None].astype(np.int64), 0)[0]
        return dict(c, ghost=ghost, band=beside <= 0.20, tl=tl)

    @classmethod
    def setUpClass(cls):
        cls.closed = cls.build("margin-pier-closed", 0)
        cls.open = cls.build("margin-pier-open", PIER_MARGIN)
        lb = cls.open["labels"]
        width = cls.open["U"].shape[1]
        cls.clear = np.unpackbits(lb["clearbits"], axis=-1, count=width).astype(bool)
        cls.seen = np.unpackbits(lb["seenbits"], axis=-1, count=width).astype(bool)
        cls.used = np.unpackbits(lb["visbits"], axis=-1, count=width).astype(bool)
        tl = cls.open["tl"]
        ii, jj = np.indices(tl.shape)
        cls.ranked = np.moveaxis(lb["ranked"][ii // 8, jj // 8], -1, 0).astype(np.int64)      # (RANKED, H, W): each texel's block's ranking
        cls.own = np.take_along_axis(cls.clear, np.maximum(tl, 0)[None].astype(np.int64), 0)[0] & (tl >= 0)   # labelled by a clear view

    def test_1_texels_only_a_station_outside_the_ranking_sees_clear_take_its_view(self):
        o, tl = self.open, self.open["tl"]
        self.assertGreater(len(PIER_STATIONS), len(self.ranked))
        ranked_clear = (np.take_along_axis(self.clear, np.maximum(self.ranked, 0), 0) & (self.ranked >= 0)).any(axis=0)
        beyond = self.clear.any(axis=0) & ~ranked_clear
        self.assertGreater(int(beyond.sum()), 1000, "no texel is clear only to a station outside its block's ranking: the test proves nothing")
        self.assertTrue(np.all(beyond <= o["band"]))                                    # all beside the pier
        self.assertTrue(np.all(self.clear[:, beyond].sum(axis=0) == 1))                 # each clear to one station: no order past the ranking can differ here
        self.assertTrue(np.all(self.own[beyond]), f"{int((~self.own[beyond]).sum())} of {int(beyond.sum())} such texels did not take a clear view")
        self.assertFalse((self.ranked == tl[None])[:, beyond].any())                    # and from outside the ranking
        self.assertEqual(o["report"]["occluder_margin"]["texels_given_a_clear_view_from_outside_the_ranking"], int(beyond.sum()))

    def test_2_a_doubtful_view_is_given_only_where_no_station_sees_clear(self):
        o, tl = self.open, self.open["tl"]
        margin = o["report"]["occluder_margin"]
        doubtful = (tl >= 0) & ~self.own
        self.assertGreater(int(doubtful.sum()), 100)
        self.assertEqual(int((doubtful & self.clear.any(axis=0)).sum()), 0, "a texel some station saw clear took a doubtful view")
        self.assertTrue(np.array_equal(doubtful, self.seen.any(axis=0) & ~self.clear.any(axis=0)))
        self.assertTrue(np.array_equal(tl >= 0, self.seen.any(axis=0)))                 # no hole where a station saw the texel, none filled where none did
        self.assertEqual(margin["texels_given_a_doubtful_view"], int(doubtful.sum()))
        self.assertEqual(margin["texels_labelled_clear"], int(self.own.sum()))
        # visbits: the clear views and, for each doubtful texel, the one view given
        self.assertTrue(np.array_equal(self.used & ~self.clear, (np.arange(len(PIER_STATIONS))[:, None, None] == tl[None]) & doubtful[None]))
        self.assertTrue(np.all(self.used <= self.seen))
        near = margin["doubtful_view_clearance_mm"]
        self.assertTrue(0 < near["least"] <= near["median"] <= near["greatest"] <= PIER_MARGIN * 1000 + 0.05, near)
        self.assertEqual(margin["views_left_out"], int((self.seen & ~self.clear).sum()))

    def test_3_the_pier_is_not_printed_beside_itself(self):
        c, o = self.closed, self.open
        without = int((c["ghost"] & c["band"]).sum())
        self.assertGreater(without, 1000, "the fault did not occur without the margin: the test proves nothing")
        self.assertEqual(int((c["ghost"] & ~c["band"]).sum()), 0)                       # here the outlines all lie within 20 cm of the pier
        left = int(o["ghost"].sum())
        self.assertEqual(left, 0, f"{left} texels of plain wall still take a view that shows the pier ({without} without the margin)")

    def test_4_the_photographs_take_labels_from_outside_the_ranking(self):
        o = self.open
        self.assertTrue(np.all(o["coloured"][o["tl"] >= 0]))                            # every labelled texel is coloured
        self.assertGreaterEqual(int(o["coloured"].sum()), int(self.closed["coloured"].sum()))
        with open(os.path.join(T4, "margin-pier-open", "proj", "composite-south.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["stations_used"], len(np.unique(o["tl"][o["tl"] >= 0])))


class MarginLeavesAWallUnlabelled(unittest.TestCase):
    """A screen stands 0.3 m in front of the south wall, with a gap of 8 cm. Two stations face the gap and see a
    strip of the wall through it, every texel of it past a screen's edge and within 8 cm of that edge. Without a
    margin the strip is labelled, and the wall has blocks to photograph it from. With a margin of 8 cm none of
    those views counts towards a label: the wall has no labelled block, and the build stops as it does at a wall
    no station sees. There the cause may be the margin and not the stations, so the stop says that the margin is
    set, and how many texels the stations did see."""

    GAP = (2.96, 3.04)

    @classmethod
    def build(cls, name, margin):
        work = os.path.join(T4, name)
        cfg = config(RECT, ["east", "south", "west", "north"])
        if margin:
            cfg["survey"]["projection"]["walls"] = dict(cfg["survey"]["projection"]["walls"], occluderMargin=margin)
        room = write_room(work, cfg)
        for w in room.walls:
            write_wall(room, work, w, flat)
        wall = room.wmap["south"]
        (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]

        def e57(u, off, z):
            return np.array([cX + u * uX + off * nX, cY + u * uY + off * nY, z])

        def panel(u0, u1):
            pts = np.array([e57(u, off, z) for u in (u0, u1) for off in (0.29, 0.30) for z in (-0.5, 3.5)])
            return pts.min(axis=0), pts.max(axis=0)

        panels = [panel(-0.5, cls.GAP[0]), panel(cls.GAP[1], 6.5)]
        stations = [dict(id="scan_100", t=list(e57(3.0, 1.5, 1.5)), gain=1.0), dict(id="scan_101", t=list(e57(3.0, 2.5, 1.5)), gain=1.0)]
        box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 3.0, CENTRE[1] + 3.0, 0.0, 3.0)
        data = os.path.join(work, "data")
        synth.write_manifest(data, stations)
        synth.write_depth_maps(data, stations, PROUD_DEPTH, lambda o, d: np.minimum(
            synth.box_distance(o, d, box), np.minimum(slab_distance(o, d, *panels[0]), slab_distance(o, d, *panels[1]))))
        synth.write_panoramas(data, stations, 128, 64, synth.gh_sky)
        return work

    def report(self, work):
        with open(os.path.join(work, "proj", "labels-south.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_1_without_a_margin_the_strip_labels_the_wall(self):
        work = self.build("margin-gap-closed", 0)
        step(work, "labels", "south", depth=PROUD_DEPTH)
        report = self.report(work)
        self.assertGreater(report["labelled_blocks"], 20)
        self.assertGreater(report["texels_labelled"], 1500)

    def test_2_with_the_margin_the_stop_says_what_the_margin_left_out(self):
        work = self.build("margin-gap-open", PROUD_MARGIN)
        with self.assertRaises(AssertionError) as stopped:
            step(work, "labels", "south", depth=PROUD_DEPTH)
        said = str(stopped.exception)
        report = self.report(work)                                  # the report stays, for whoever looks
        given = report["occluder_margin"]["texels_given_a_doubtful_view"]
        self.assertEqual((report["labelled_blocks"], report["occluder_margin"]["texels_labelled_clear"]), (0, 0))
        self.assertGreater(given, 1500)                             # the stations saw the strip all the same
        self.assertEqual(report["texels_labelled"], given)
        self.assertIn("wall south: no station labels any block of it", said)
        self.assertIn("survey.projection.walls.occluderMargin (gate B25): a view that passes within 80 mm of anything nearer "
                      f"does not count towards a label, and {given} of this wall's texels were seen only in such views", said)
        self.assertIn("a smaller margin would label the wall", said)
        self.assertNotIn("Traceback", said)
        with self.assertRaises(AssertionError) as again:            # the photographs stop at it too, saying the same
            step(work, "wall-photo", "south", depth=PROUD_DEPTH)
        self.assertIn(f"and {given} of this wall's texels were seen only in such views", str(again.exception))


# --- B26: the wall behind what stood before it --------------------------------------------------------------------

LEAF = dict(u=(2.5, 3.1), v=(0.6, 2.2), d=0.5)    # a board 0.5 m before the south wall (6 m), as the elevation and the depth maps hold it
LEAF_STATIONS = (("scan_100", 2.8, 1.6), ("scan_101", 0.8, 1.0), ("scan_102", 4.8, 1.0))   # id, u along the wall, metres off it
LEAF_DADO = dict(top=1.0, d=0.05)                 # below `top` the wall itself stands `d` before its face, its whole length
LEAF_DEPTH = 256                                  # cubemap texels
LEAF_BOARD = np.array([0.03, 0.02, 0.015])        # the board's picture: darker than anything on the wall


def wall_pattern(u, v):
    """The wall's own picture (linear RGB): slow bands along it and up it, nowhere near as dark as the board."""
    return np.stack([0.30 + 0.12 * np.sin(2 * np.pi * u / 0.37), 0.28 + 0.12 * np.sin(2 * np.pi * v / 0.29), 0.22 + 0.0 * u], axis=-1)


class Behind(unittest.TestCase):
    """A board stands half a metre before a patterned wall, as the lobby door's open leaf stands before the Saloon's
    first lettered board. The elevation holds the board, so there the wall's photograph is the board's and its
    relief a lump half a metre proud; a patch can cover a dado with another dado, but not lettering with lettering.
    With a `behind` edit the corners step moves the region's texels back to where the wall is (each row's depth from
    the strip of wall just beyond the region, or one depth for all), and the wall is then photographed from the two
    stations that see past the board, while the one that faces the board no longer counts there."""

    @classmethod
    def build(cls, name, edit, through=True):
        work = os.path.join(T4, name)
        cfg = config(RECT, ["east", "south", "west", "north"], edits=[edit] if edit else [])
        cfg["stations"] = [{"id": sid, "role": "room"} for sid, _, _ in LEAF_STATIONS]
        room = write_room(work, cfg)
        wall = room.wmap["south"]
        (cX, cY), (uX, uY), (nX, nY) = wall["cornerE57"], wall["uE57"], wall["normalE57"]
        corner, along, normal = np.array([cX, cY, 0.0]), np.array([uX, uY, 0.0]), np.array([nX, nY, 0.0])

        def e57(u, off, z):
            return corner + u * along + off * normal + np.array([0.0, 0.0, z])

        def cuboid(us, vs, d0, d1):
            pts = np.array([e57(u, d, v) for u in us for v in vs for d in (d0, d1)])
            return pts.min(axis=0), pts.max(axis=0)

        board = cuboid(LEAF["u"], LEAF["v"], LEAF["d"] - 0.04, LEAF["d"])
        dado = cuboid((0.0, wall["length"]), (0.0, LEAF_DADO["top"]), -0.5, LEAF_DADO["d"])

        def relief(U, V):
            own = np.where(V < LEAF_DADO["top"], LEAF_DADO["d"], 0.0)
            on_board = (U >= LEAF["u"][0]) & (U <= LEAF["u"][1]) & (V >= LEAF["v"][0]) & (V <= LEAF["v"][1])
            return np.where(on_board, LEAF["d"], own), np.ones(U.shape, bool)

        U = V = None
        for w in room.walls:
            out = write_wall(room, work, w, relief if w is wall else flat)
            if w is wall:
                U, V, _ = out
        stations = [dict(id=sid, t=list(e57(u, off, 1.5)), gain=1.0) for sid, u, off in LEAF_STATIONS]
        box = (CENTRE[0] - 2.0, CENTRE[0] + 2.0, CENTRE[1] - 3.0, CENTRE[1] + 3.0, 0.0, 3.0)
        data = os.path.join(work, "data")
        synth.write_manifest(data, stations)
        synth.write_depth_maps(data, stations, LEAF_DEPTH, lambda o, d: np.minimum(
            np.minimum(synth.box_distance(o, d, box), slab_distance(o, d, *dado)), slab_distance(o, d, *board)))

        def colour(s, dirs):
            o = np.asarray(s["t"], float)
            t = np.minimum(synth.box_distance(o, dirs, box), slab_distance(o, dirs, *dado))
            rel = o + dirs * t[..., None] - corner
            on_wall = rel @ normal < LEAF_DADO["d"] + 1e-6            # the south wall's face or its dado, not the rest of the room
            scene = np.where(on_wall[..., None], wall_pattern(rel @ along, rel[..., 2]), np.array([0.45, 0.45, 0.45]))
            return np.where((slab_distance(o, dirs, *board) < t)[..., None], LEAF_BOARD, scene)

        synth.write_panoramas(data, stations, 2048, 1024, colour)
        log = step(work, "corners").stdout
        (v,) = room.tiles(wall)
        w, h = v["pixels"]
        fixed = np.fromfile(os.path.join(work, "out-walls", f"{v['name']}.fixed.f32"), np.float32).reshape(h, w, 4)[::-1]
        out = dict(room=room, U=U, V=V, log=log, depth=(fixed[..., 0] - cX) * nX + (fixed[..., 1] - cY) * nY,
                   along=(fixed[..., 0] - cX) * uX + (fixed[..., 1] - cY) * uY, up=fixed[..., 2])
        if through:
            step(work, "labels", "south", depth=LEAF_DEPTH)
            step(work, "wall-photo", "south", depth=LEAF_DEPTH)
            npz = np.load(os.path.join(work, "proj", f"{v['name']}.npz"))
            labels = np.load(os.path.join(work, "proj", "labels-south.npz"))
            out.update(rgb=npz["rgb"], coloured=npz["weight"] > 0, station=np.array([str(s) for s in labels["stations"]]),
                       texel_label=labels["texel_label"])
        return out

    @classmethod
    def setUpClass(cls):
        region = dict(type="behind", wall="south", u=list(LEAF["u"]), v=list(LEAF["v"]))
        cls.region = region
        cls.closed = cls.build("behind-closed", None)
        cls.open = cls.build("behind-open", dict(region, like="right", note="a board before the wall"))
        cls.constant = cls.build("behind-depth", dict(region, depth=0.0), through=False)
        U, V = cls.closed["U"], cls.closed["V"]
        cls.on_board = (U >= LEAF["u"][0]) & (U <= LEAF["u"][1]) & (V >= LEAF["v"][0]) & (V <= LEAF["v"][1])
        # well inside the region: clear of its edges, and of the dado's ledge, by 5 cm
        cls.inside = ((U > LEAF["u"][0] + 0.05) & (U < LEAF["u"][1] - 0.05) & (V > LEAF["v"][0] + 0.05) & (V < LEAF["v"][1] - 0.05)
                      & (np.abs(V - LEAF_DADO["top"]) > 0.05))
        cls.own = np.where(V < LEAF_DADO["top"], LEAF_DADO["d"], 0.0)

    def test_1_gate(self):
        self.assertNotIn("B26", {r["gate"] for r in self.closed["room"].ledger()})
        rows = [(r["where"], r["note"]) for r in self.open["room"].ledger() if r["gate"] == "B26"]
        self.assertEqual(rows, [("wall south", "u 2.500..3.100, v 0.6..2.2, each row's depth from the wall beyond its right")])
        rows = [(r["where"], r["note"]) for r in self.constant["room"].ledger() if r["gate"] == "B26"]
        self.assertEqual(rows, [("wall south", "u 2.500..3.100, v 0.6..2.2, at 0 m before the face")])
        gh = Room(os.path.join(ROOMS, "grand-hall.room.json"), ROOMS)
        self.assertNotIn("B26", {r["gate"] for r in gh.ledger()})

    def test_2_without_the_edit_the_wall_wears_the_board(self):
        c = self.closed
        self.assertTrue(np.allclose(c["depth"][self.on_board], LEAF["d"], atol=1e-5))            # the lump, half a metre proud
        lum = c["rgb"] @ np.array([0.2126, 0.7152, 0.0722])
        self.assertGreater(float(c["coloured"][self.inside].mean()), 0.99)
        self.assertLess(float(lum[self.inside].max()), 0.06, "the fault did not occur: the test proves nothing")

    def test_3_the_corners_step_puts_the_wall_back_row_by_row(self):
        o, c = self.open, self.closed
        self.assertLess(float(np.abs(o["depth"] - self.own)[self.on_board].max()), 1e-5)          # each row at its own depth: dado and face
        outside = ~self.on_board
        self.assertTrue(np.array_equal(o["depth"][outside], c["depth"][outside]))                 # nothing else moved
        for key in ("along", "up"):                                                               # same place along the wall and up it
            self.assertLess(float(np.abs(o[key] - c[key]).max()), 1e-5, key)
        self.assertRegex(o["log"], r"south behind u 2\.500\.\.3\.100 v 0\.6\.\.2\.2: moved back \d+ texels")
        moved = int(re.search(r"south behind .*moved back (\d+) texels", o["log"]).group(1))
        self.assertEqual(moved, int(self.on_board.sum()))
        self.assertLess(float(np.abs(self.constant["depth"][self.on_board]).max()), 1e-5)         # one depth for all: the face
        self.assertTrue(np.array_equal(self.constant["depth"][outside], c["depth"][outside]))

    def test_4_the_wall_behind_is_photographed_from_the_stations_that_see_past(self):
        o = self.open
        want = wall_pattern(o["U"], o["V"])
        self.assertGreater(float(o["coloured"][self.inside].mean()), 0.99)
        error = np.abs(o["rgb"] - want)[self.inside & o["coloured"]]
        self.assertLess(float(error.mean()), 0.02, "the wall's own bands are not what was photographed")
        self.assertLess(float(np.percentile(error, 99)), 0.06)
        lum = o["rgb"] @ np.array([0.2126, 0.7152, 0.0722])
        self.assertGreater(float(lum[self.inside & o["coloured"]].min()), 0.10)                    # nothing of the board is left
        used = set(o["station"][np.unique(o["texel_label"][self.inside & (o["texel_label"] >= 0)])])
        self.assertTrue(used and used <= {"scan_101", "scan_102"}, used)                          # never the one that faces the board
        # and the wall beside the region is as it was
        beside = ~self.on_board & self.closed["coloured"] & o["coloured"] & (np.abs(o["U"] - 2.8) > 0.6)
        self.assertLess(float(np.abs(o["rgb"] - self.closed["rgb"])[beside].mean()), 0.01)

    def test_5_the_checker_holds_the_edit_to_one_depth_and_a_strip_inside_the_wall(self):
        import check_room  # noqa: PLC0415
        schema = roomlib.load(os.path.join(ROOMS, "room.schema.json"))

        def errors(**change):
            cfg = json.loads(json.dumps(self.open["room"].cfg))
            edit = cfg["edits"][0]
            for key, value in change.items():
                if value is None:
                    edit.pop(key, None)
                else:
                    edit[key] = value
            return "\n".join(check_room.check(cfg, schema, None).errors)

        self.assertEqual(errors(), "")
        self.assertEqual(errors(like=None, depth=0.02), "")
        self.assertIn("takes `like` or `depth`, not both", errors(depth=0.0))
        self.assertIn("takes `like` or `depth`", errors(like=None))
        self.assertIn("the strip of wall beyond its right", errors(u=[5.5, 5.95]))                # 5 cm of wall left: the strip is 10
        self.assertIn("the strip of wall beyond its left", errors(like="left", u=[0.05, 0.6]))
        self.assertIn("schema", errors(like="above"))


# --- B26 in the corners step alone: which texels move, and to what depth --------------------------------------------
# The walls' position tiles are written directly and only the corners step runs (seconds): no depth maps, no labels.

BEHIND_RECT = dict(u=[2.4, 3.2], v=[0.5, 2.3])          # the edit's rectangle on the south wall: wider and taller than the board
BEHIND_BOARD = dict(u=(2.5, 3.1), v=(0.6, 2.2), d=0.5)  # what stood before the wall
BEHIND_RIGHT = (3.2, 3.3, 0.02)     # the 10 cm of wall just beyond the rectangle's right: 2 cm before the face, the face past it
BEHIND_LEFT = (2.3, 2.4, -0.01)     # the 10 cm just beyond its left: 1 cm behind the face
BEHIND_KEEP = dict(u=(2.41, 2.47), d=0.06)   # a moulding 4 cm before its rows' depth (0.02), in the board's rows: wall, it stays
BEHIND_MOVE = dict(u=(3.13, 3.19), d=0.10)   # one 8 cm before it: it moves
BEHIND_LUMP = dict(u=(2.6, 2.8), v=(1.0, 1.5), d=0.3)   # on the north wall, inside the rectangle's u and v: no edit names it
BEHIND_DOOR = dict(id="door", wall="south", kind="door", headShape="square", centre=3.7, width=1.0, sill=0, head=2.0,
                   glazing="none", stateInScan="open")  # its face, u 3.2..4.2, holds the right strip's lower rows
BEHIND_BAY = dict(id="bay", wall="north", kind="window", headShape="square", centre=3.7, width=1.0, sill=1.0, head=1.6,
                  glazing="none", dressing="none", stateInScan="closed")


def box(U, V, us, vs=(-1.0, 9.0)):
    return (U > us[0]) & (U < us[1]) & (V > vs[0]) & (V < vs[1])


def behind_south(U, V, lump=None):
    """The south wall for the corners-only cases (metres before its face). The strips just beyond the rectangle
    differ left and right, and the right one differs from the wall past it, so the side and the width of the strip
    both change the depth a row takes (a metre-wide strip on the right holds 90 cm of face). In the board's rows
    two mouldings flank the board: one 4 cm before the depth its rows take (it is the wall and stays), one 8 cm."""
    d = np.zeros(U.shape)
    for u0, u1, depth in (BEHIND_LEFT, BEHIND_RIGHT):
        d[box(U, V, (u0, u1))] = depth
    rows = BEHIND_BOARD["v"]
    d[box(U, V, BEHIND_KEEP["u"], rows)] = BEHIND_KEEP["d"]
    d[box(U, V, BEHIND_MOVE["u"], rows)] = BEHIND_MOVE["d"]
    d[box(U, V, BEHIND_BOARD["u"], rows)] = BEHIND_BOARD["d"]
    if lump:
        d[box(U, V, lump["u"], lump["v"])] = lump["d"]
    return d, np.ones(U.shape, bool)


def behind_north(U, V):
    d = np.zeros(U.shape)
    d[box(U, V, BEHIND_LUMP["u"], BEHIND_LUMP["v"])] = BEHIND_LUMP["d"]
    return d, np.ones(U.shape, bool)


def corners_only(name, edits, reliefs, openings=()):
    """Writes the T4 room with these edits and openings, each wall's position tiles from reliefs[wall id] (a plain
    face where none is given), and runs the corners step. Returns the room, the step's log and, per wall, the
    positions written and the corrected positions (both with rows from the top)."""
    work = os.path.join(T4, name)
    room = write_room(work, config(RECT, ["east", "south", "west", "north"], openings, edits))
    walls = {}
    for w in room.walls:
        U, V, P = write_wall(room, work, w, reliefs.get(w["id"], flat))
        walls[w["id"]] = dict(U=U, V=V, P=P)
    log = step(work, "corners").stdout
    for w in room.walls:
        tiles = sorted(room.tiles(w), key=lambda v: v["tile"])
        walls[w["id"]]["fixed"] = np.concatenate(
            [np.fromfile(os.path.join(work, "out-walls", f"{v['name']}.fixed.f32"), np.float32)
             .reshape(v["pixels"][1], v["pixels"][0], 4)[::-1] for v in tiles], 1)
    return dict(room=room, log=log, walls=walls, cfg=room.cfg)


def depth_before(room, wall_id, points):
    """Metres before the wall's face (along its normal, which points into the room) of E57 points."""
    w = room.wmap[wall_id]
    rel = points[..., :2].astype(np.float64) - np.array(w["cornerE57"])
    return rel @ np.array(w["normalE57"], float)


class BehindCorners(unittest.TestCase):
    """What the corners step moves for a `behind` edit and where it puts it, on walls whose position tiles are
    written directly. The rectangle is wider and taller than the board in it, and holds two mouldings beside the
    board: only texels more than 6 cm before their row's depth move (the board, and the moulding 8 cm before), and
    the one 4 cm before stays. The rows take their depth from the strip of wall on the named side, 10 cm wide; or
    one given depth, before the face. The edit moves nothing on any other wall, though the north wall holds a lump
    inside the same u and v range. Two edits on one wall each read the wall as scanned. Beside an open door the
    rows whose strip lies in the door's face (B7) take the nearest rows' depth, beside a window a depth
    interpolated between the rows below and above it, and a rectangle may run down to the floor."""

    @classmethod
    def setUpClass(cls):
        rect = dict(type="behind", wall="south", u=list(BEHIND_RECT["u"]), v=list(BEHIND_RECT["v"]))
        reliefs = dict(south=behind_south, north=behind_north)
        cls.like = corners_only("behind-like", [dict(rect, like="right")], reliefs)
        cls.depth = corners_only("behind-depth-plus", [dict(rect, depth=0.02)], reliefs)
        # A second edit over the board's upper right corner and above the rectangle, where a lump stands proud.
        cls.second = dict(u=[2.9, 3.6], v=[1.5, 2.6], depth=0.05)
        cls.lump2 = dict(u=(3.35, 3.55), v=(2.35, 2.55), d=0.3)
        cls.two = corners_only("behind-two", [dict(rect, like="right"), dict(type="behind", wall="south", **cls.second)],
                               dict(south=lambda U, V: behind_south(U, V, cls.lump2)))

        def doorway(U, V):
            """The open door's face (u 3.2..4.2, up to 2.0) shows the passage 0.6 m behind the wall; above its head the
            right strip is 2 cm before the face; a leaf stands before the wall left of the door, from below the floor's
            line in the elevation (its bottom 5 cm) to 2.2 m."""
            d = np.zeros(U.shape)
            d[box(U, V, (3.2, 3.3), (2.0, 9.0))] = 0.02
            d[box(U, V, (3.2, 4.2), (0.0, 2.0))] = -0.6
            d[box(U, V, (2.5, 3.1), (-1.0, 2.2))] = 0.5
            return d, np.ones(U.shape, bool)

        def window(U, V):
            """The window's face (u 3.2..4.2, v 1.0..1.6) shows the outside 0.5 m behind the wall; the right strip is the
            face below it and 6 cm before the face above it; a board stands before the wall left of the window."""
            d = np.zeros(U.shape)
            d[box(U, V, (3.2, 3.3), (1.6, 9.0))] = 0.06
            d[box(U, V, (3.2, 4.2), (1.0, 1.6))] = -0.5
            d[box(U, V, (2.5, 3.1), (0.8, 1.8))] = 0.5
            return d, np.ones(U.shape, bool)

        cls.openings = corners_only(
            "behind-openings",
            [dict(type="behind", wall="south", u=[2.4, 3.2], v=[0.0, 2.4], like="right"),
             dict(type="behind", wall="north", u=[2.4, 3.2], v=[0.7, 1.9], like="right")],
            dict(south=doorway, north=window), openings=[BEHIND_DOOR, BEHIND_BAY])

    def south(self, build):
        s = build["walls"]["south"]
        return s["U"], s["V"], s["P"], s["fixed"], depth_before(build["room"], "south", s["fixed"])

    def moved_back(self, build, wall):
        return [int(n) for n in re.findall(rf"^{wall} behind .*: moved back (\d+) texels", build["log"], re.M)]

    def test_1_only_what_stands_more_than_6cm_before_its_rows_depth_moves(self):
        U, V, P, fixed, _ = self.south(self.like)
        board = box(U, V, BEHIND_BOARD["u"], BEHIND_BOARD["v"])
        goes = box(U, V, BEHIND_MOVE["u"], BEHIND_BOARD["v"])
        keep = box(U, V, BEHIND_KEEP["u"], BEHIND_BOARD["v"])
        moved = np.any(fixed != P, axis=-1)
        self.assertTrue(np.array_equal(fixed[keep], P[keep]), "the moulding 4 cm before its rows' depth was moved")
        self.assertTrue(np.array_equal(moved, board | goes),
                        f"moved {int(moved.sum())} texels, the board and the moulding 8 cm before hold {int((board | goes).sum())}")
        self.assertEqual(self.moved_back(self.like, "south"), [int((board | goes).sum())])

    def test_2_each_row_takes_the_depth_of_the_10cm_strip_on_the_named_side(self):
        U, V, P, fixed, depth = self.south(self.like)
        moved = box(U, V, BEHIND_BOARD["u"], BEHIND_BOARD["v"]) | box(U, V, BEHIND_MOVE["u"], BEHIND_BOARD["v"])
        # the right strip's 2 cm; the left strip would give -1 cm, a strip a metre wide on the right the face's 0
        self.assertLess(float(np.abs(depth[moved] - BEHIND_RIGHT[2]).max()), 1e-5)
        self.assertTrue(np.array_equal(fixed[moved][:, 2], P[moved][:, 2]))                   # same height
        along = (fixed[..., :2].astype(np.float64) - np.array(self.like["room"].wmap["south"]["cornerE57"])) \
            @ np.array(self.like["room"].wmap["south"]["uE57"], float)
        self.assertLess(float(np.abs(along[moved] - U[moved]).max()), 1e-5)                   # and the same place along it

    def test_3_a_given_depth_is_before_the_face(self):
        """depth 0.02 puts the rows 2 cm before the face, into the room (0.0 would not show the sign)."""
        wall = self.depth["room"].wmap["south"]
        into = (np.array(CENTRE) - np.array(wall["cornerE57"])) @ np.array(wall["normalE57"], float)
        self.assertGreater(into, 0, "the wall's normal does not point into the room: the test proves nothing")
        U, V, P, fixed, depth = self.south(self.depth)
        moved = box(U, V, BEHIND_BOARD["u"], BEHIND_BOARD["v"]) | box(U, V, BEHIND_MOVE["u"], BEHIND_BOARD["v"])
        self.assertLess(float(np.abs(depth[moved] - 0.02).max()), 1e-5)
        self.assertTrue(np.array_equal(np.any(fixed != P, axis=-1), moved))                  # and the 6 cm counts from it
        self.assertEqual(self.moved_back(self.depth, "south"), [int(moved.sum())])

    def test_4_no_other_wall_moves(self):
        """The north wall holds a lump 0.3 m proud inside the rectangle's u and v range: the edit names the south wall."""
        north = self.like["walls"]["north"]
        lump = box(north["U"], north["V"], BEHIND_LUMP["u"], BEHIND_LUMP["v"])
        self.assertGreater(float(depth_before(self.like["room"], "north", north["P"])[lump].min()), 0.29)
        for build in (self.like, self.depth, self.two):
            for wid, w in build["walls"].items():
                if wid != "south":
                    self.assertTrue(np.array_equal(w["fixed"], w["P"]), f"{wid}: its .fixed.f32 is not its .position.f32")

    def test_5_two_edits_each_read_the_wall_as_scanned(self):
        """Where the second edit (depth 0.05) overlaps the first (like right: 0.02), the board, which it moves too, takes
        its depth: it read the board where it was scanned, not where the first edit put it (5 cm is not 6 cm before
        0.05). The moulding 8 cm before the first edit's depth is not 6 cm before the second's: it keeps the first's.
        And the second moves a lump above the first's rectangle."""
        U, V, P, fixed, depth = self.south(self.two)
        u0, u1 = self.second["u"]
        v0, v1 = self.second["v"]
        second = (U >= u0) & (U <= u1) & (V >= v0) & (V <= v1)
        board = box(U, V, BEHIND_BOARD["u"], BEHIND_BOARD["v"])
        goes = box(U, V, BEHIND_MOVE["u"], BEHIND_BOARD["v"])
        lump = box(U, V, self.lump2["u"], self.lump2["v"])
        self.assertTrue((board & second).any() and (board & ~second).any() and (goes & second).any())
        self.assertLess(float(np.abs(depth[board & second] - 0.05).max()), 1e-5)
        self.assertLess(float(np.abs(depth[(board & ~second) | goes] - BEHIND_RIGHT[2]).max()), 1e-5)
        self.assertLess(float(np.abs(depth[lump] - 0.05).max()), 1e-5)
        self.assertTrue(np.array_equal(np.any(fixed != P, axis=-1), board | goes | lump))
        self.assertEqual(self.moved_back(self.two, "south"), [int((board | goes).sum()), int(((board & second) | lump).sum())])

    def test_6_beside_an_open_door_and_down_to_the_floor(self):
        """The rectangle runs from the floor to 2.4 m beside an open door whose face (to 2.0 m) holds its strip's lower
        rows: B7 blanks them, so those 200 rows take the depth of the nearest rows that have one (the strip above the
        door's head, 2 cm before the face), not the passage's, and the log counts them. The leaf's lowest row, the
        first above the floor, moves; its rows below the floor's line in the elevation are not the rectangle's, and
        stay."""
        s = self.openings["walls"]["south"]
        U, V, P, fixed = s["U"], s["V"], s["P"], s["fixed"]
        depth = depth_before(self.openings["room"], "south", fixed)
        leaf = box(U, V, (2.5, 3.1), (0.0, 2.2))
        below = box(U, V, (2.5, 3.1), (-1.0, 0.0))
        self.assertEqual(int(below.sum()), 5 * 60)
        self.assertTrue(np.array_equal(np.any(fixed != P, axis=-1), leaf))
        self.assertLess(float(np.abs(depth[leaf] - 0.02).max()), 1e-5)
        lowest = V == V[V > 0].min()
        self.assertAlmostEqual(float(V[lowest][0]), 0.005, places=9)
        self.assertEqual(int((leaf & lowest).sum()), 60)
        self.assertRegex(self.openings["log"],
                         rf"south behind u 2\.400\.\.3\.200 v 0\.0\.\.2\.4: moved back {int(leaf.sum())} texels \(200 rows took the nearest rows' depth\)")

    def test_7_beside_a_window_rows_take_a_depth_interpolated_between_the_rows_below_and_above(self):
        """The window's face (v 1.0..1.6) holds the strip's rows between the face below it (0) and 6 cm before the face
        above it: B7 blanks those 60 rows, and each takes a depth on the line between the nearest rows either side."""
        n = self.openings["walls"]["north"]
        U, V, P, fixed = n["U"], n["V"], n["P"], n["fixed"]
        depth = depth_before(self.openings["room"], "north", fixed)
        board = box(U, V, (2.5, 3.1), (0.8, 1.8))
        self.assertTrue(np.array_equal(np.any(fixed != P, axis=-1), board))
        want = np.interp(V, [0.995, 1.605], [0.0, 0.06])           # the nearest rows below and above the window's face
        self.assertLess(float(np.abs(depth[board] - want[board]).max()), 1e-5)
        self.assertGreater(float(np.ptp(want[board & (V > 1.0) & (V < 1.6)])), 0.05)
        self.assertRegex(self.openings["log"], r"north behind u 2\.400\.\.3\.200 v 0\.7\.\.1\.9: moved back \d+ texels \(60 rows took")


# --- B19: the floor refills' roll direction -------------------------------------------------------------------

class FloorRefills(unittest.TestCase):
    def flatten(self, boards, refill):
        work = os.path.join(T4, f"floor-{boards}-{refill}")
        edits = [dict(type="floor-refill", centre=[1.2, 1.0], radius=0.4), dict(type="floor-refill", centre=[-1.2, -1.0], radius=0.4)]
        room = write_room(work, config(RECT, ["front", "window", "rear", "fire"], edits=edits, boards=boards, refill=refill))
        yy, xx = np.mgrid[0:80, 0:120]
        rgb = np.stack([0.3 + 0.05 * np.sin(xx / 3.1) + 0.04 * np.cos(yy / 2.3), 0.25 + 0.03 * np.sin((xx + 2 * yy) / 4.7),
                        0.2 + 0.02 * np.cos(xx / 5.3 - yy / 3.9)], -1).astype(np.float32)
        np.savez_compressed(os.path.join(work, "proj", "floor.npz"), rgb=rgb, weight=np.ones((80, 120), np.float32))
        with open(os.path.join(work, "proj", "floor-patches.json"), "w") as f:
            json.dump([], f)
        floor.flatten(room, os.path.join(work, "proj", "floor.npz"), os.path.join(work, "proj", "floor-flat.npz"), 20.0)
        return np.load(os.path.join(work, "proj", "floor-flat.npz"))["rgb"]

    def test_refills_roll_towards_the_middle_along_the_boards(self):
        X, Z = np.meshgrid(-3.0 + (np.arange(120) + 0.5) / 20, 2.0 - (np.arange(80) + 0.5) / 20)
        shift = 10                                                    # 0.5 m at 20 px/m
        for boards in ("z", "x"):
            refilled, plain = self.flatten(boards, True), self.flatten(boards, False)
            for cx, cz in ((1.2, 1.0), (-1.2, -1.0)):
                inner = np.hypot(X - cx, Z - cz) < 0.3 - 0.02
                if boards == "z":       # rows run from +z: towards the middle is down the image for cz > 0
                    want = np.roll(plain, -shift if cz > 0 else shift, axis=0)
                    other = np.roll(plain, -shift if cx < 0 else shift, axis=1)
                else:
                    want = np.roll(plain, -shift if cx < 0 else shift, axis=1)
                    other = np.roll(plain, -shift if cz > 0 else shift, axis=0)
                self.assertTrue(np.array_equal(refilled[inner], want[inner]), f"boards along {boards}, disc ({cx}, {cz})")
                self.assertFalse(np.allclose(refilled[inner], other[inner]))
            self.assertTrue(np.array_equal(refilled[0, :10], plain[0, :10]), "a texel outside the discs moved")


# --- B16: the ceiling relief's fill, padding and spacing -------------------------------------------------------

class CeilingRelief(unittest.TestCase):
    def test_hole_odd_size_and_spacing(self):
        work = os.path.join(T4, "ceiling")
        room = write_room(work, config(RECT, ["front", "window", "rear", "fire"], ceiling_ppm=100.5))
        v = room.ceiling_view()
        w, h = v["pixels"]
        self.assertEqual((w, h), (603, 402))
        x = -3.0 + (np.arange(w) + 0.5) * 6.0 / w
        z = 2.0 - (np.arange(h) + 0.5) * 4.0 / h
        X, Z = np.meshgrid(x, z)
        E = np.stack(room.to_e57_np(X, Z), -1) + np.array(CENTRE)
        P = np.zeros((h, w, 4), np.float32)
        P[..., :2] = E
        P[..., 2] = 3.0 + 0.1 * ((X > 0.5) & (X < 2.5) & (Z > 1.0) & (Z < 1.8))   # a 0.1 m recess, off centre
        P[..., 3] = 1.0
        hole = np.hypot(X + 1.0, Z + 0.5) < 1.0                                       # unseen, 0.4 m beyond the reach
        P[hole] = 0
        P[::-1].tofile(os.path.join(work, "out-walls", f"{v['name']}.position.f32"))
        in_dir(work, relief.ceiling, room)
        with open(os.path.join(work, "relief", "ceiling.json"), encoding="utf-8") as f:
            meta = json.load(f)
        self.assertEqual((meta["width"], meta["height"]), (302, 201))
        self.assertEqual((meta["ppmU"], meta["ppmV"]), (603 / 12, 402 / 8))
        self.assertGreater(meta["unfilledInside"], 0)
        D = np.fromfile(os.path.join(work, "relief", "ceiling.f32"), np.float32).reshape(201, 302)
        cx, cz = (-1.0 + 3.0) * meta["ppmU"], (2.0 + 0.5) * meta["ppmV"]
        self.assertEqual(float(D[int(cz), int(cx)]), 0.0, "the hole's centre is not the reference height")
        rx, rz = int((1.5 + 3.0) * meta["ppmU"]), int((2.0 - 1.4) * meta["ppmV"])
        self.assertAlmostEqual(float(D[rz, rx]), -0.1, places=3)                      # the recess, where it is
        self.assertAlmostEqual(float(D[rz, int((-1.5 + 3.0) * meta["ppmU"])]), 0.0, places=3)


if __name__ == "__main__":
    unittest.main()

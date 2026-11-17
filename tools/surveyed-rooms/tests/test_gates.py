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


def step(work, name, *args):
    r = subprocess.run([sys.executable, "-X", "utf8", STEP_PY, name, "room.json", *args], cwd=work, env=ENV,
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

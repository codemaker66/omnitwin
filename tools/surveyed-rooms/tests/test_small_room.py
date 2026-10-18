"""T3: a small analytic room built by the new driver end to end, checked against ground truth.

tests/scene.py ray-casts the room in place of the dollhouse mesh and the panoramas: the position
tiles (as render.mjs draws them), 128^2 distance cubemaps and 1024 x 512 panoramas of three
stations (one with gain 1.2, its panorama divided by it). Then build-room.py runs from `project`
to `publish` (no --publish) and the checks are:
  - the ledger opens exactly the expected gates at the expected walls and ends;
  - projected wall colour = albedo within 0.01 (linear) wherever seen, away from edges;
  - the glass mask against the analytic glazed outline less its bar and less the box standing in
    front of the glass (IoU > 0.97, none of the box's texels), the layered glass depth -0.5 or
    -0.55 by row within 1 mm, and the windows step's scan check: the plane change found at 1.6 m
    and both planes' depths, no disagreement;
  - the ceiling relief, decoded from its GHR1 file: heights within 5 mm (plus quantisation) of the
    analytic 3.0 m field and the 3.15 m coffer, which is off centre in x and z, so a mirrored or
    flipped relief fails; and the ceiling photo shows the coffer where it is, not mirrored;
  - no texel takes the colour of the lamp painted only in the panoramas (an occluder);
  - atlas strips do not overlap, gutters repeat their strips' edges, an unpatched strip equals its
    wall resampled; the mirror and cross-wall copy patches remove both posters, in the photo and
    the relief; the open door is a 0.3 m recess in the relief;
  - both GHR1 files parse (tests/ghr1.py) with the config's ids;
  - a quarter-turn-2 rectangle variant opens no gate.
Needs node with meshoptimizer: the checkout these tools are in, or SURVEYED_ROOMS_NODE_ROOT.
Scratch: SURVEYED_ROOMS_TEST_SCRATCH (default: the system temp folder).
"""
import copy
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
import ghr1  # noqa: E402
import roomlib  # noqa: E402
import scene  # noqa: E402
import synth  # noqa: E402
from roombuild import atlas  # noqa: E402
from roombuild.context import Room  # noqa: E402

SCRATCH = os.environ.get("SURVEYED_ROOMS_TEST_SCRATCH", os.path.join(tempfile.gettempdir(), "surveyed-rooms-tests"))
T3 = os.path.join(SCRATCH, "t3")
WORK = os.path.join(T3, "work")
TRUTH = os.path.join(T3, "truth")
CONFIG = os.path.join(T3, "test-room.room.json")
NODE_ROOT = os.environ.get("SURVEYED_ROOMS_NODE_ROOT", os.path.dirname(os.path.dirname(ROOMS)))
ENV = dict(os.environ, SURVEYED_ROOMS_TEST_DEPTH_SIZE="128")       # SURVEYED_ROOMS_NODE_ROOT passes through
STATIONS = [dict(id="scan_100", p=(1.5, -0.8), gain=1.0), dict(id="scan_101", p=(-1.5, 0.8), gain=1.2),
            dict(id="scan_102", p=(0.0, 1.2), gain=0.95)]


def e57(x, z):
    return [scene.CENTRE[0] - z, scene.CENTRE[1] - x]


def config():
    gh = roomlib.load(os.path.join(ROOMS, "grand-hall.room.json"))
    rect = lambda x0, x1, z0, z1: [[x1, z1], [x1, z0], [x0, z0], [x0, z1]]  # noqa: E731
    return {
        "schemaVersion": 1, "slug": "test-room", "name": "Test room", "venue": "test",
        "source": {"kind": "matterport-e57-twin", "captureId": "test-capture", "captured": "2026-01-01",
                   "twin": "https://example.invalid/twin", "manifest": "manifest.json", "mesh": "mesh/dollhouse.glb",
                   "panoramas": {"path": "tiles/scan_{index:03d}/equirect_8192.webp", "size": 8192},
                   "frame": {"name": "e57", "units": "m", "up": "+Z"}},
        "transform": {"centre": list(scene.CENTRE), "floorZ": 0.0, "quarterTurns": 1},
        "stations": [{"id": s["id"], "role": "room"} for s in STATIONS],
        "walls": {"vertices": scene.VERTICES, "segments": [{"id": s, "kind": "solid", "height": scene.HEIGHT} for s in scene.SEGMENTS]},
        "openings": [
            {"id": "window", "wall": "window", "kind": "window", "headShape": "semicircular", "centre": 1.8, "width": 1.2,
             "sill": 0.8, "head": 1.9, "glazing": "stained-backlit", "dressing": "none", "stateInScan": "closed",
             "glass": {"width": 1.0, "sill": 0.9, "head": 1.95, "headShape": "semicircular",
                       "planes": [{"depth": 0.5, "below": 1.6}, {"depth": 0.55}], "bars": [[1.55, 1.6]]}},
            {"id": "door", "wall": "front", "kind": "door", "headShape": "square", "centre": 1.8, "width": 0.9, "sill": 0,
             "head": 2.1, "glazing": "none", "stateInScan": "open"}],
        "ceiling": {"kind": "coffered", "height": 3.0, "regions": [
            {"id": f"coffer-{i}", "kind": "recess", "outline": rect(*c), "height": scene.COFFER_TOP}
            for i, c in enumerate(scene.COFFERS)]},
        "floor": {"kind": "strip-boards", "boardsRun": "z", "levels": [{"id": "main", "height": 0}]},
        "freeStanding": [],
        "fittings": [{"id": "lamp", "kind": "pendant", "style": "test-lamp", "position": [0.8, 1.5, 0.3], "lowest": 0.5,
                      "radius": 0.25, "suspension": 3.0}],
        "edits": [
            {"type": "patch", "wall": "rear", "u": [0.55, 1.05], "v": [0.0, 1.6], "mode": "mirror", "about": 1.8, "applies": ["photo", "relief"]},
            {"type": "patch", "wall": "fire-r-end", "u": [0.25, 0.75], "v": [0.0, 1.3], "mode": "copy",
             "from": {"wall": "fire-f-end", "u": 0.25}, "applies": ["photo", "relief"]},
            {"type": "recess", "wall": "front", "u": [{"opening": "door", "offset": -0.45}, {"opening": "door", "offset": 0.45}],
             "v": [0.0, 2.1], "depth": 0.3, "applies": ["relief"]},
            {"type": "floor-refill", "centre": [0.0, 0.0], "radius": 0.4}],
        "occluders": [{"id": "lamp-body", "shape": "vertical-cylinder", "centreE57": e57(scene.LAMP["x"], scene.LAMP["z"]),
                       "radius": 0.27, "zE57": [0.45, 2.55], "fitting": "lamp"}],
        "survey": {
            "methodRevision": 2,
            "publish": {"folder": "packages/web/public/rooms/test-room/survey-2026-01-01", "revision": 1},
            "projection": {k: gh["survey"]["projection"][k] for k in ("walls", "ceiling", "floor")},
            "wallViews": {"ppm": 100, "heightRange": [-0.05, 3.1], "eyeInset": 1.2, "near": 0.0, "far": 2.0, "tileMaxLength": 6.0, "modes": ["position"]},
            "ceilingView": {"name": "ceiling-pos", "ppm": 100, "eyeHeight": 1.0, "near": 1.8, "far": 2.6, "modes": ["position"]},
            "floorPhoto": {"ppm": 60, "refill": {"shift": 0.5, "innerFraction": 0.75, "easeDeg": 4}},
            "atlas": {"size": 2048, "height": 768, "ppm": {"pixels": 100, "span": 1}, "vRange": [-0.02, 3.02], "featherTexels": 10, "gutter": 8},
            "relief": {"container": "GHR1", "ppm": 50, "vRange": [0, 3.0], "depthRange": [-0.8, 0.5], "simplifyError": 0.005,
                       "holdFloor": 0.04, "holdCeiling": 2.96},
            "ceilingRelief": {"container": "GHR1", "id": "ceiling", "ppm": 50, "heightRange": [2.9, 3.3], "simplifyError": 0.002},
            "outputs": {"walls": [{"file": "walls-2048.webp", "size": [2048, 768]}, {"file": "walls-1024.webp", "size": [1024, 384]}],
                        "relief": "walls-relief.bin", "ceiling": [{"file": "ceiling-600.webp", "size": [600, 400]}],
                        "ceilingRelief": "ceiling-relief.bin", "floor": [{"file": "floor-360.webp", "size": [360, 240]}],
                        "manifest": "survey.json"}},
        "provenance": {"measuredBy": "tests/scene.py", "method": "synthetic", "date": "2026-10-18", "residuals": []},
    }


def floor_albedo(P):
    """Boards along z, 0.1 m wide: texture for the floor's nadir test."""
    stripe = np.sin(2 * np.pi * P[:, 0] / 0.1)
    return np.stack([0.35 + 0.06 * stripe, 0.25 + 0.04 * stripe, np.full(len(P), 0.15)], -1)


def node_ready():
    return os.path.isdir(os.path.join(NODE_ROOT, "packages", "reconstruction-foundry", "node_modules", "meshoptimizer"))


def driver(*args):
    r = subprocess.run([sys.executable, "-X", "utf8", os.path.join(ROOMS, "build-room.py"), CONFIG, WORK, *args],
                       cwd=ROOMS, env=ENV, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise AssertionError(f"build-room.py {args} failed:\n{r.stdout[-4000:]}\n{r.stderr[-4000:]}")
    return r


def build():
    shutil.rmtree(T3, ignore_errors=True)
    os.makedirs(TRUTH)
    with open(CONFIG, "w", encoding="utf-8", newline="\n") as f:
        json.dump(config(), f, indent=1)
    floor_rect = next(r for r, n in zip(*scene.SCENE) if n == "floor")
    floor_rect.albedo = floor_albedo
    stations = [dict(id=s["id"], t=[*e57(*s["p"]), 1.5], gain=s["gain"]) for s in STATIONS]
    data = os.path.join(WORK, "data")
    synth.write_manifest(data, stations)
    synth.write_depth_maps(data, stations, 128, scene.distance)
    synth.write_panoramas(data, stations, 1024, 512, scene.panorama_colour)
    driver("--to", "check")
    os.makedirs(os.path.join(WORK, "out-walls"))
    with open(os.path.join(WORK, "views", "views-walls.json"), encoding="utf-8") as f:
        views = json.load(f)
    with open(os.path.join(WORK, "views", "views-ceiling.json"), encoding="utf-8") as f:
        views += json.load(f)
    for v in views:
        P, albedo, which = scene.render_view(v)
        P.tofile(os.path.join(WORK, "out-walls", f"{v['name']}.position.f32"))
        np.savez_compressed(os.path.join(TRUTH, f"{v['name']}.npz"), albedo=albedo[::-1], which=which[::-1])
    log = driver("--from", "project", "--to", "publish")
    with open(os.path.join(T3, "build.log"), "w", encoding="utf-8") as f:
        f.write(log.stdout + log.stderr)


def uniform(a, r):
    """Texels whose (2r+1)^2 neighbourhood holds the same value as the texel (a: h x w x k)."""
    out = np.ones(a.shape[:2], bool)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out &= (np.roll(a, (dy, dx), (0, 1)) == a).all(axis=-1)
    out[:r] = out[-r:] = False
    out[:, :r] = out[:, -r:] = False
    return out


class SmallRoom(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not node_ready():
            raise unittest.SkipTest(f"no meshoptimizer under {NODE_ROOT}: the relief step cannot run")
        if not os.path.exists(os.path.join(WORK, "build", "survey.json")):
            build()
        cls.room = Room(CONFIG, WORK)
        with open(os.path.join(WORK, "build", "atlas.json"), encoding="utf-8") as f:
            cls.atlas = json.load(f)
        cls.png = np.asarray(Image.open(os.path.join(WORK, "proj", "walls-2048.png")))

    def wall_texels(self, name):
        tiles = sorted(self.room.tiles(self.room.by_name[name]), key=lambda v: v["tile"])
        npz = [np.load(os.path.join(WORK, "proj", f"{v['name']}.npz")) for v in tiles]
        truth = [np.load(os.path.join(TRUTH, f"{v['name']}.npz")) for v in tiles]
        return (np.concatenate([t["rgb"] for t in npz], 1), np.concatenate([t["weight"] for t in npz], 1),
                np.concatenate([t["albedo"] for t in truth], 1), np.concatenate([t["which"] for t in truth], 1))

    def test_ledger(self):
        got = sorted((r["gate"], r["where"]) for r in self.room.ledger())
        reflex = [("win-f-end", "left"), ("win-f-ret", "right"), ("win-r-ret", "left"), ("win-r-end", "right"),
                  ("fire-r-end", "left"), ("fire-r-ret", "right"), ("fire-f-ret", "left"), ("fire-f-end", "right")]
        want = [(g, f"wall {w} {e} end") for w, e in reflex for g in ("B6", "B9")]
        want += [("B5", f"wall {w}") for w in ("win-f-ret", "win-r-ret", "fire-r-ret", "fire-f-ret")]
        want += [("B8", f"wall {w}") for w in ("win-f-end", "win-f-ret", "win-r-ret", "win-r-end", "fire-r-end", "fire-r-ret", "fire-f-ret", "fire-f-end")]
        want += [("B7", "room"), ("B10", "opening window"), ("B14", "atlas"), ("B16", "ceiling"), ("B18", "floor"), ("B19", "floor"),
                 ("B20", "wall fire-r-end")]
        borrowed = [("B22", "relief")] if os.environ.get("SURVEYED_ROOMS_NODE_ROOT") else []
        self.assertEqual(got, sorted(want + borrowed))
        with open(os.path.join(WORK, "build", "ledger.json"), encoding="utf-8") as f:
            built = sorted((r["gate"], r["where"]) for r in json.load(f))
        self.assertEqual(built, sorted(want + [("B21", "projection")] + borrowed))

    def test_quarter_turn_2_rectangle_opens_no_gate(self):
        gh = roomlib.load(os.path.join(ROOMS, "grand-hall.room.json"))
        variant = copy.deepcopy(gh)
        variant["walls"]["vertices"] = [[3.0, -2.0], [-3.0, -2.0], [-3.0, 2.0], [3.0, 2.0]]
        path = os.path.join(T3, "rectangle.room.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(variant, f)
        saved = {k: os.environ.pop(k, None) for k in ("SURVEYED_ROOMS_TEST_DEPTH_SIZE", "SURVEYED_ROOMS_NODE_ROOT")}
        try:
            self.assertEqual(Room(path, T3).ledger(), [])
        finally:
            os.environ.update({k: v for k, v in saved.items() if v is not None})

    def test_wall_colour_is_the_albedo(self):
        worst = {}
        for name in scene.SEGMENTS:
            rgb, weight, albedo, which = self.wall_texels(name)
            ok = (weight > 0) & uniform(albedo, 4) & uniform(which[..., None], 4) & (which >= 0)
            if ok.sum() < 50:
                continue
            err = np.abs(rgb[ok] - albedo[ok]).max(axis=1)
            worst[name] = (int(ok.sum()), float(np.percentile(err, 99)), float(err.max()))
        print("\n  colour error per wall (texels, p99, max):", {k: (n, round(p, 4), round(m, 4)) for k, (n, p, m) in worst.items()}, file=sys.stderr)
        self.assertGreaterEqual(len(worst), 8, worst)
        for name, (n, p99, mx) in worst.items():
            self.assertLess(p99, 0.01, f"{name}: 99th percentile colour error {p99:.4f} over {n} texels (max {mx:.4f})")

    def test_lamp_never_coloured_in(self):
        lamp = np.array(scene.ALBEDO["lamp"])
        for name in sorted(os.listdir(os.path.join(WORK, "proj"))):
            if name.endswith(".npz") and name != "floor-flat.npz":
                rgb = np.load(os.path.join(WORK, "proj", name))["rgb"].reshape(-1, 3)
                greenish = (rgb[:, 1] > 0.3) & (rgb[:, 0] < 0.2) & (rgb[:, 2] < 0.2)
                self.assertEqual(int(greenish.sum()), 0, f"{name}: texels coloured by the lamp")
                self.assertGreater(float(np.abs(rgb - lamp).max(axis=1).min()), 0.05, name)

    def test_glass_mask_and_layers(self):
        glass = np.load(os.path.join(WORK, "proj", "window-glass.npy"))
        layered = np.load(os.path.join(WORK, "proj", "window-layered.npy"))
        H, W = glass.shape
        v = 3.1 - (np.arange(H) + 0.5) / 100
        u = (np.arange(W) + 0.5) / 100
        U, V = np.meshgrid(u, v)
        X = U - 1.8                                  # the window wall's u = planner x + 1.8
        box = (X >= scene.BOX["x"][0]) & (X <= scene.BOX["x"][1]) & (V >= scene.BOX["y"][0]) & (V <= scene.BOX["y"][1])
        outline = scene.glass_outline(X, V)
        truth = outline & ~box
        iou = (glass & truth).sum() / (glass | truth).sum()
        box_core = (X >= scene.BOX["x"][0] + 0.03) & (X <= scene.BOX["x"][1] - 0.03) & (V >= scene.BOX["y"][0]) & (V <= scene.BOX["y"][1] - 0.03)
        print(f"\n  glass IoU {iou:.4f} ({int(glass.sum())} texels, truth {int(truth.sum())}); "
              f"box texels in the mask {int((glass & box).sum())} of {int((outline & box).sum())}", file=sys.stderr)
        self.assertGreater(int((outline & box_core).sum()), 300)
        self.assertEqual(int((glass & box_core).sum()), 0, "the box in front of the glass was taken for glass")
        self.assertGreater(iou, 0.97, f"glass IoU {iou:.4f}")
        core = truth.copy()
        for dy in range(-12, 13):
            for dx in range(-12, 13):
                core &= np.roll(truth, (dy, dx), (0, 1))
        want = np.where(V < 1.6, -0.5, -0.55)
        self.assertGreater(int(core.sum()), 1000)
        self.assertLess(float(np.abs(layered[core] - want[core]).max()), 0.001)
        with open(os.path.join(WORK, "build", "glass.json"), encoding="utf-8") as f:
            record = json.load(f)
        report = record["openings"]["window"]
        self.assertEqual((report["glazing"], report["method"]), ("stained-backlit", "outline"))
        # The scan check: the plane change found at the scene's 1.6 m, both planes at their depths.
        (split,) = report["scan"]["splits"]
        self.assertLessEqual(split["range"][0], 1.6 + 0.011)
        self.assertGreaterEqual(split["range"][1], 1.6 - 0.011)
        self.assertEqual([round(p["measured"], 3) for p in report["scan"]["planes"]], [0.5, 0.55])
        self.assertEqual(record["disagreements"], [])

    def test_ceiling_relief(self):
        with open(os.path.join(WORK, "proj", "ceiling-relief.bin"), "rb") as f:
            (entry,) = ghr1.parse(f.read(), known_ids={"ceiling"})
        # Sample the decoded surface (barycentric, in u = x, v = z) on a 5 cm grid, away from the
        # coffers' edges, against the analytic heights: the simplified mesh of a flat field keeps
        # little but its corners, so vertices alone would test nothing inside a coffer.
        gx, gz = np.meshgrid(np.arange(-2.975, 3.0, 0.05), np.arange(-1.975, 2.0, 0.05))
        sx, sz = gx.ravel(), gz.ravel()
        coffer = np.zeros(len(sx), bool)
        edge = np.zeros(len(sx), bool)
        for x0, x1, z0, z1 in scene.COFFERS:
            coffer |= (sx >= x0) & (sx <= x1) & (sz >= z0) & (sz <= z1)
            near = (sx >= x0 - 0.04) & (sx <= x1 + 0.04) & (sz >= z0 - 0.04) & (sz <= z1 + 0.04)
            edge |= near & ~((sx >= x0 + 0.04) & (sx <= x1 - 0.04) & (sz >= z0 + 0.04) & (sz <= z1 - 0.04))
        p = entry["positions"]
        a, b, c = (p[entry["indices"][:, k]] for k in range(3))
        y = np.full(len(sx), np.nan)
        for i in range(len(sx)):
            v0, v1 = b[:, :2] - a[:, :2], c[:, :2] - a[:, :2]
            w = np.array([sx[i], sz[i]]) - a[:, :2]
            den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
            with np.errstate(divide="ignore", invalid="ignore"):
                l1 = (w[:, 0] * v1[:, 1] - v1[:, 0] * w[:, 1]) / den
                l2 = (v0[:, 0] * w[:, 1] - w[:, 0] * v0[:, 1]) / den
            inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l1 + l2 <= 1 + 1e-9) & (np.abs(den) > 1e-12)
            if inside.any():
                t = int(np.argmax(inside))
                y[i] = 3.0 - (a[t, 2] + l1[t] * (b[t, 2] - a[t, 2]) + l2[t] * (c[t, 2] - a[t, 2]))
        self.assertFalse(np.isnan(y).any(), "the ceiling mesh has holes")
        want = np.where(coffer, scene.COFFER_TOP, scene.HEIGHT)
        quantum = (entry["ranges"][5] - entry["ranges"][4]) / 65535
        err = np.abs(y - want)[~edge]
        print(f"\n  ceiling relief: {len(p)} vertices; {int((~edge).sum())} samples, max height error {err.max() * 1000:.2f} mm "
              f"({int((coffer & ~edge).sum())} inside coffers)", file=sys.stderr)
        self.assertLess(float(err.max()), 0.005 + quantum, f"ceiling height error {err.max():.4f}")
        self.assertGreater(int((coffer & ~edge).sum()), 500)
        self.assertAlmostEqual(entry["ranges"][0], -3.0, places=5)
        self.assertAlmostEqual(entry["ranges"][1], 3.0, places=5)
        self.assertAlmostEqual(float(ghr1.triangle_normals(entry)[:, 2].sum() / 2 / (6.0 * 4.0)), 1.0, places=3)
        with open(os.path.join(WORK, "relief", "ceiling.json"), encoding="utf-8") as f:
            meta = json.load(f)
        self.assertEqual(meta["unfilledInside"], 0)
        self.assertAlmostEqual(meta["ppmU"], meta["width"] / 6.0, places=9)    # 600 texels over 6 m, halved

    def test_ceiling_photo_shows_the_coffer_where_it_is(self):
        """ceiling-600.webp: columns along planner +x, rows from planner +z (100 px/m here). The
        off-centre coffer is bluer than the ceiling; its mirror images in x and in z are not."""
        img = np.asarray(Image.open(os.path.join(WORK, "proj", "ceiling-600.webp")).convert("RGB"), float)
        x0, x1, z0, z1 = scene.COFFERS[0]

        def blueness(xa, xb, za, zb):
            cols = slice(int(round((xa + 3.0) * 100)), int(round((xb + 3.0) * 100)))
            rows = slice(int(round((2.0 - zb) * 100)), int(round((2.0 - za) * 100)))
            patch = img[rows, cols]
            return float((patch[..., 2] - patch[..., 0]).mean())

        inset = 0.15
        here = blueness(x0 + inset, x1 - inset, z0 + inset, z1 - inset)
        mirror_x = blueness(-x1 + inset, -x0 - inset, z0 + inset, z1 - inset)
        mirror_z = blueness(x0 + inset, x1 - inset, -z1 + inset, -z0 - inset)
        print(f"\n  ceiling photo blue - red: coffer {here:.1f}, mirrored in x {mirror_x:.1f}, in z {mirror_z:.1f}", file=sys.stderr)
        self.assertGreater(here, 20)
        self.assertLess(mirror_x, 0)
        self.assertLess(mirror_z, 0)

    def test_walls_relief_file(self):
        with open(os.path.join(WORK, "proj", "walls-relief.bin"), "rb") as f:
            entries = ghr1.parse(f.read(), known_ids=set(scene.SEGMENTS))
        self.assertEqual([e["id"] for e in entries], scene.SEGMENTS)

    def relief(self, name):
        with open(os.path.join(WORK, "relief", f"{name}.json"), encoding="utf-8") as f:
            meta = json.load(f)
        D = np.fromfile(os.path.join(WORK, "relief", f"{name}.f32"), np.float32).reshape(meta["height"], meta["width"])
        return D, meta

    def test_relief_edits(self):
        D, meta = self.relief("front")
        ppm, top = meta["ppm"], meta["top"]
        self.assertTrue(np.allclose(D[int((top - 2.0) * ppm):int((top - 0.1) * ppm), int(1.4 * ppm):int(2.2 * ppm)], -0.3))
        D, meta = self.relief("rear")              # the poster (u 0.6-1.0, v 0.5-1.5) mirrored away
        region = D[int((top - 1.45) * ppm):int((top - 0.55) * ppm), int(0.65 * ppm):int(0.95 * ppm)]
        self.assertLess(float(np.abs(region).max()), 0.01)
        D, meta = self.relief("fire-r-end")        # the second poster (u 0.3-0.7, v 0.4-1.2) copied over
        region = D[int((top - 1.15) * ppm):int((top - 0.45) * ppm), int(0.35 * ppm):int(0.65 * ppm)]
        self.assertLess(float(np.abs(region).max()), 0.01)

    def strip(self, name):
        s = next(s for s in self.atlas["strips"] if s["wall"] == name)
        return s, self.png[s["y"]:s["y"] + s["h"], s["x"]:s["x"] + s["w"]]

    def test_atlas_layout_and_gutters(self):
        strips = self.atlas["strips"]
        self.assertEqual((self.atlas["width"], self.atlas["height"], self.atlas["packing"]), (2048, 768, "next-fit"))
        for i, a in enumerate(strips):
            self.assertLessEqual(a["x"] + a["w"], 2048)
            for b in strips[i + 1:]:
                self.assertFalse(a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"])
        for y in sorted({s["y"] for s in strips}):
            row = sorted((s for s in strips if s["y"] == y), key=lambda s: s["x"])
            for a, b in zip(row, row[1:]):
                gap0, gap1 = a["x"] + a["w"], b["x"]
                mid = (gap0 + gap1) // 2
                band = self.png[y:y + a["h"]]
                self.assertTrue((band[:, gap0:mid] == band[:, gap0 - 1:gap0]).all())
                self.assertTrue((band[:, mid:gap1] == band[:, gap1:gap1 + 1]).all())

    def test_unpatched_strip_is_the_resampled_wall(self):
        from roombuild import legacy
        wall = self.room.by_name["front"]
        tiles = sorted(self.room.tiles(wall), key=lambda v: v["tile"])
        d = [np.load(os.path.join(WORK, "proj", f"{v['name']}.npz")) for v in tiles]
        img = legacy.project().linear_to_srgb(np.concatenate([x["rgb"] for x in d], 1)).astype(np.float32)
        valid = np.concatenate([x["valid"] for x in d], 1) & (np.concatenate([x["weight"] for x in d], 1) > 0)
        img = atlas.fill(img, valid)
        s, region = self.strip("front")
        crop = img[int(round((3.1 - 3.02) * 100)):int(round((3.1 + 0.02) * 100)), :int(round(wall["length"] * 100))]
        want = np.asarray(Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).resize((s["w"], s["h"]), Image.LANCZOS))
        self.assertTrue(np.array_equal(region[..., :3], want))

    def test_posters_patched_out_of_the_photo(self):
        def srgb(c):
            return synth.srgb8(np.array(c, float)).astype(float)
        s, region = self.strip("rear")
        patch = region[int((3.02 - 1.45) * 100):int((3.02 - 0.55) * 100), int(0.65 * 100):int(0.95 * 100), :3].astype(float)
        self.assertLess(float(np.abs(patch - srgb(scene.ALBEDO["rear"])).max()), 8, "the rear poster survived")
        s, region = self.strip("fire-r-end")
        patch = region[int((3.02 - 1.15) * 100):int((3.02 - 0.45) * 100), int(0.35 * 100):int(0.65 * 100), :3].astype(float)
        self.assertLess(float(np.abs(patch - srgb(scene.ALBEDO["fire-f-end"])).max()), 8, "the second poster survived")

    def test_survey_record(self):
        with open(os.path.join(WORK, "build", "survey.json"), encoding="utf-8") as f:
            record = json.load(f)
        self.assertEqual(len(record["walls"]), 12)
        self.assertEqual(record["methodRevision"], 2)
        self.assertEqual(sorted(record["files"]), sorted(["walls-2048.webp", "walls-1024.webp", "walls-relief.bin", "ceiling-600.webp",
                                                          "ceiling-relief.bin", "floor-360.webp"]))
        self.assertEqual(record["ceiling"]["relief"]["id"], "ceiling")


if __name__ == "__main__":
    unittest.main()

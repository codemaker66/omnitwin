import argparse, contextlib, io, json, os, shutil, stat, subprocess, tempfile, unittest
from dataclasses import replace
import numpy as np
from relight import __main__ as M, config, reference, sunbounce, windows
from tests.test_artifacts import host_env
from tests.test_reference import model as small_model, sky_basis
from tests.test_windows import HEAD_ON, RECT, RES, grid


def args(**kw):
    base = {"out": None, "skins": None, "skin_light": None, "skin_package": None, "package": None, "vectors": None}
    return argparse.Namespace(**{**base, **kw})


def _writable_then_retry(function, path, _exc):
    """rmtree's onexc: git marks its object files read-only, which Windows will not delete until they are writable."""
    os.chmod(path, stat.S_IWRITE)
    function(path)


class CommittedCodeOnly(unittest.TestCase):
    """Ruling P1: a package is built and checked only from committed code; records and check refuse, writing nothing,
    while tools/relight has any uncommitted change, and the manifest's tool is the HEAD commit."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, onexc=_writable_then_retry)
        self.repo = os.path.join(self.dir, "repo")
        os.makedirs(os.path.join(self.repo, "tools", "relight"))
        self.git("init", "-q")
        self.write("tools/relight/a.py", "a = 1\n")
        self.write("README.md", "x\n")
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "c")
        self.cfg = config.Config(paths={"repo": self.repo, "out": os.path.join(self.dir, "out"), "work": os.path.join(self.dir, "work"),
                                        "evidence": os.path.join(self.dir, "evidence")}, room={})

    def git(self, *a):
        return subprocess.run(["git", "-C", self.repo, *a], check=True, capture_output=True, text=True).stdout.strip()

    def write(self, rel, text):
        with open(os.path.join(self.repo, *rel.split("/")), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

    def committed(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            return M._committed_tool(self.cfg), out.getvalue()

    def test_clean_code_gives_the_head_commit_and_its_committer_time(self):
        self.write("README.md", "changed outside tools/relight\n")
        got, _out = self.committed()
        self.assertEqual(got, (self.git("rev-parse", "HEAD"), self.git("log", "-1", "--format=%cI")))

    def test_any_uncommitted_change_in_tools_relight_refuses(self):
        for change in (lambda: self.write("tools/relight/a.py", "a = 2\n"), lambda: self.git("add", "tools/relight/a.py"),
                       lambda: self.write("tools/relight/new.py", "b = 1\n")):
            change()
            got, out = self.committed()
            self.assertIsNone(got)
            self.assertIn("FAIL: tools/relight has uncommitted changes", out)

    def test_records_and_check_write_nothing_from_uncommitted_code(self):
        self.write("tools/relight/new.py", "b = 1\n")
        for command in (M.cmd_records, M.cmd_check):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(command(self.cfg, args()), 1)
        self.assertEqual(sorted(os.listdir(self.dir)), ["repo"])


class ChecksFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg = config.Config(paths={"evidence": self.dir, "repo": "D:/claude/real-hall/repo"}, room={})

    def test_the_checks_go_through_the_evidence_writer_which_records_the_host(self):
        results = {key: {"pass": True} for key in ("capturedIdentity", "proofRegression", "transfer", "determinism", "skyBounceCheck")}
        results["wallFaceRate"] = {"splats": 200000, "marched": 9, "wallFace": 1, "floor": {"points": 88831, "marched": 5, "wallFace": 1}}
        for package, name, env in ((None, "checks.json", {}), ("D:/x/relight/v2/", "checks-v2.json", {"pod": "pod7"})):
            with host_env(**env):
                path = M._write_checks(self.cfg, package, results, "abc123")
            self.assertEqual(path, os.path.join(self.dir, name))
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f), {**results, "checkedWith": "abc123", "host": "pod:pod7" if env else "pc"})
        self.assertEqual(sorted(os.listdir(self.dir)), ["checks-v2.json", "checks.json"])

    def test_vectors_go_to_the_fixture_only_for_the_default_package(self):
        fixture = os.path.join("D:/claude/real-hall/repo", "packages", "web", "src", "lib", "relight", "__fixtures__", "relight-vectors.json")
        self.assertEqual(M._vectors_path(self.cfg, args()), fixture)
        self.assertIsNone(M._vectors_path(self.cfg, args(package="D:/x/relight/v2")))
        self.assertEqual(M._vectors_path(self.cfg, args(package="D:/x/relight/v2", vectors="D:/y/v.json")), "D:/y/v.json")


class VectorParts(unittest.TestCase):
    def test_the_wall_face_pairs_are_marched_room_rays_put_on_the_room_side_between_unlike_cells(self):
        occ = grid()
        occ[40:60, 32, :] = 0.5                            # the embrasure's first row, behind the wall face (see test_windows)
        vols = windows.volumes_from_occupancy(occ, np.array([0.0, -0.99, 0.0]), RES, {"W": RECT}, 0.0, x_bearing=14.3)
        P = np.array([[1.5, 3.0, 1.5], [0.9, 3.0, 1.5], [1.5, -0.1, 1.5], [5.0, 3.0, 1.5]])
        self.assertEqual(M._straddles(vols, P, HEAD_ON).tolist(), [True, False, False, False])
        rate = windows.wall_face_rate(vols, {"W": np.full(360, -90.0)}, np.ones(101), P, HEAD_ON)
        self.assertEqual(rate["wallFace"], int(M._straddles(vols, P, HEAD_ON).sum()))
        occ[40:60, 33, :] = 0.5                            # the room-side row too: the cells agree
        same = windows.volumes_from_occupancy(occ, np.array([0.0, -0.99, 0.0]), RES, {"W": RECT}, 0.0, x_bearing=14.3)
        self.assertEqual(M._straddles(same, P, HEAD_ON).tolist(), [False] * 4)

    def test_a_direction_on_a_gate_is_not_clear(self):
        vol = windows.volumes_from_occupancy(grid(), np.array([0.0, -1.0, 0.0]), RES, {"W": RECT}, 0.0, x_bearing=14.3)
        s = windows.sun_vector(104.3, 10.0, 14.3)
        az, el = windows.sun_az_el(np.asarray(s, np.float32), 14.3)
        self.assertTrue(M._gates_clear(vol, {"W": np.full(360, 5.0)}, s))
        self.assertFalse(M._gates_clear(vol, {"W": np.full(360, el)}, s))
        self.assertFalse(M._gates_clear(vol, {"W": np.full(360, el + 5e-7)}, s))

    def test_the_fold_is_the_first_vector_probe_whose_eight_basis_corners_all_weigh(self):
        rng = np.random.default_rng(2)
        sky = sky_basis()
        sky = replace(sky, basis=rng.normal(0, 1, (2, 8, 3, 6)).astype(np.float16),
                      table=sunbounce.Table(coeffs=np.ones((2, 2, 1, 2), np.float32), az0=100.0, el0=4.0, step=4.0))
        m = replace(small_model(3, 0.5), sky=sky)          # 0.5 m probes; probe 13 sits at (0.5, 0.5, 0.5), a 1 m cell's centre
        coefficients, rgb = np.array([0.7, -0.2]), np.array([1.0, 2.0, 0.5])
        fold = M._fold(m, [0, 13, 26], coefficients, rgb, lambda b: b.hex())
        self.assertEqual(fold["probe"], 13)                 # probe 0 sits on a 1 m node: one corner weighs everything
        self.assertEqual(fold["corners"], [[i, 0.125] for i in range(8)])
        self.assertEqual([b["index"] for b in fold["basis"]], list(range(8)))
        self.assertEqual(bytes.fromhex(fold["basis"][3]["values"]), np.ascontiguousarray(sky.basis[:, 3], "<f2").tobytes())
        expected = reference.to_probes(m, sunbounce.bounce(sky.basis, coefficients) * rgb[None, :, None])[13]
        np.testing.assert_allclose(fold["cube"], expected.ravel(), rtol=0, atol=1e-15)
        self.assertEqual(fold["rgb"], [1.0, 2.0, 0.5])
        with self.assertRaisesRegex(ValueError, "eight 1 m corners"):
            M._fold(m, [0, 26], coefficients, rgb, lambda b: b.hex())

    def test_a_probe_on_a_1_m_node_by_rounding_is_not_the_fold(self):
        """The hall's grids start at z 0.02: the probe at z 4.02 lies on a 1 m node, but (4.02 - 0.02) rounds to
        3.9999999999999996, so four of its corners weigh 1.1e-16 and another float order would pick other corners; the
        fold takes a probe inside its 1 m cell (z 3.52), whose corners weigh 1/8."""
        origin = np.array([0.02, 0.02, 0.02])
        sky = replace(sky_basis(), basis=np.ones((1, 20, 3, 6), np.float16), origin=origin, shape=(2, 2, 5), valid=np.ones(20, bool))
        m = replace(small_model(), probes=np.zeros((90, 9, 3, 6), np.float32), probe_valid=np.ones(90, bool),
                    probe_origin=origin, probe_spacing=0.5, probe_shape=(3, 3, 10), sky=sky)
        node, inside = (1 * 3 + 1) * 10 + 8, (1 * 3 + 1) * 10 + 7          # probes (1, 1, 8) at z 4.02 and (1, 1, 7) at 3.52
        self.assertAlmostEqual(float(reference.probe_points(m)[node][2]), 4.02, places=12)
        fold = M._fold(m, [node, inside], np.array([1.0]), np.ones(3), lambda b: b.hex())
        self.assertEqual(fold["probe"], inside)
        self.assertEqual([w for _i, w in fold["corners"]], [0.125] * 8)


class FloorTexels(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg = config.Config(paths={"work": self.dir, "evidence": self.dir}, room={})

    def put(self, D):
        path = os.path.join(self.dir, "floor-light.npz")
        with open(path, "wb") as f:
            np.savez_compressed(f, D=D, texelToModel=np.eye(4))
        with open(os.path.join(self.dir, "floor-light.json"), "w", encoding="utf-8") as f:
            json.dump({"pass": True, "artifact": M._artifact(path)}, f)

    def floor(self):
        """6 x 8 texels: each window bright at its own texel, the cove dark, three lamps everywhere with their own peaks."""
        D = np.zeros((6, 8, 9), np.float32)
        for w, (r, c) in enumerate(((0, 0), (0, 2), (0, 4), (0, 6), (1, 7))):
            D[:, :, w] = 0.01
            D[r, c, w] = 0.5
        for k, (r, c) in zip((6, 7, 8), ((5, 1), (4, 4), (3, 6))):
            D[:, :, k] = 0.02 * (k - 5)
            D[r, c, k] = 1.0
        return D

    def test_one_texel_per_source_that_lights_the_floor_in_source_order(self):
        D = self.floor()
        self.put(D)
        texels = M._floor_texels(self.cfg)
        self.assertEqual([(t["row"], t["col"]) for t in texels], [(0, 0), (0, 2), (0, 4), (0, 6), (1, 7), (5, 1), (4, 4), (3, 6)])
        self.assertEqual([t["direct"] for t in texels], [[float(v) for v in D[t["row"], t["col"]]] for t in texels])
        self.assertTrue(all(t["direct"][5] == 0.0 for t in texels))      # the cove lights no floor texel

    def test_texels_that_cannot_tell_two_sources_apart_are_refused(self):
        D = self.floor()
        D[..., 7] = D[..., 6]
        self.put(D)
        with self.assertRaisesRegex(ValueError, "do not tell the sources apart"):
            M._floor_texels(self.cfg)


class FakeCommon:
    """The proof's common module as check uses it, for a synthetic hall: its box, the floor height, the sun vector and a
    deterministic stand-in for the solar position whose every sun faces the window wall (compass 85..125, 9..38 up)."""
    X0, X1, Y0, Y1, FLOOR_Z = 0.0, 3.0, 0.0, 2.0, 0.0

    @staticmethod
    def sun_vec_e57(az, el):
        return windows.sun_vector(az, el, 14.3)

    @staticmethod
    def solar_position(year, month, day, hour, minute=0.0):
        k = (month * 31 + day) * 7 + hour * 60 + int(minute)
        return 85.0 + k % 41, 9.0 + (hour * 7 + int(minute)) % 30


SKY_K = 2
RANGES = [(-22.0, 3.0)] * 9


def floor_light():
    """6 x 8 floor texels: each window bright at its own texel, the cove dark, three lamps everywhere with their own peaks."""
    D = np.zeros((6, 8, 9), np.float32)
    for w, (r, c) in enumerate(((0, 0), (0, 2), (0, 4), (0, 6), (1, 7))):
        D[:, :, w] = 0.01
        D[r, c, w] = 0.5
    for k, (r, c) in zip((6, 7, 8), ((5, 1), (4, 4), (3, 6))):
        D[:, :, k] = 0.02 * (k - 5)
        D[r, c, k] = 1.0
    return D


def synthetic_hall(root):
    """A small hall at the wall face y0 = 0 (the room is y > 0): five rectangular windows 0.5 m deep side by side along x,
    a glazing bar's row of half-dense cells just behind the wall face at x 1.2..1.8 (unlike cells there) and a dense jamb
    at x 2.85..3.15 (rays marched but dark); 0.5 m probes and a 1 m sky basis from the origin; twenty patches facing the
    glass; 3,000 finest splats of every class. Writes the package to root/package and the bake's sun-bounce.npz,
    floor-light.npz and npy/splats_pos.npy with their evidence to root/work and root/evidence."""
    from relight import codec, package as PK
    rng = np.random.default_rng(7)
    occ = np.zeros((110, 34, 100), np.float32)
    occ[40:60, 32, :] = 0.5
    occ[95:105, 20:33, :] = 1.0
    outlines = {f"W{i + 1}": (0.3 + 0.6 * i, 0.8 + 0.6 * i, 0.5, 0.3, 2.7, "rect") for i in range(5)}
    vols = windows.volumes_from_occupancy(occ, np.array([0.0, -0.99, 0.0]), 0.03, outlines, 0.0, x_bearing=14.3)
    centres = np.stack([rng.uniform(0.5, 2.9, 20), rng.uniform(1.0, 1.9, 20), rng.uniform(0.5, 2.0, 20)], 1)
    patches = sunbounce.Patches.from_arrays(centres, np.tile([0.0, -1.0, 0.0], (20, 1)), np.full(20, 0.25))
    sky = {"basis": rng.uniform(0.05, 1.0, (SKY_K, 48, 3, 6)).astype(np.float16), "valid": np.ones(48, bool),
           "coeffs": rng.uniform(0.1, 1.0, (12, 30, 5, SKY_K)).astype(np.float32), "patchRays": patches.rays,
           "patchNormal": patches.normals, "patchArea": patches.areas, "floorMean": rng.uniform(0, 0.1, (SKY_K, 3)).astype(np.float32),
           "azimuth0": np.float64(60.0), "elevation0": np.float64(-2.0), "step": np.float64(4.0), "gridOrigin": np.zeros(3),
           "gridShape": np.array([4, 3, 4], np.int64), "gridSpacing": np.float64(1.0)}
    work, evidence = os.path.join(root, "work"), os.path.join(root, "evidence")
    os.makedirs(os.path.join(work, "npy")), os.makedirs(evidence)
    for name, arrays, ev in (("sun-bounce.npz", sky, "sun-bounce-check.json"),
                             ("floor-light.npz", {"D": floor_light(), "texelToModel": np.eye(4)}, "floor-light.json")):
        path = os.path.join(work, name)
        with open(path, "wb") as f:
            np.savez_compressed(f, **arrays)
        with open(os.path.join(evidence, ev), "w", encoding="utf-8") as f:
            json.dump({"pass": True, "artifact": M._artifact(path)}, f)
    from tests.test_package import fit_json, refit_json
    capture = PK.capture_of(fit_json())
    inputs = PK.Inputs(
        room="synthetic", tile_to_model=np.eye(4),
        site={"latitude": 55.8593, "longitude": -4.2491, "north": windows.sun_vector(0, 0, 14.3),
              "east": windows.sun_vector(90, 0, 14.3), "up": [0.0, 0.0, 1.0]},
        capture=capture, lamps=PK.lamps_of(capture, [1.623, 1.0, 0.467], refit_json()), volumes=vols,
        horizons={n: np.full(360, 5.0, np.float32) for n in vols}, fresnel=np.linspace(0.8, 0.92, 101).astype(np.float32),
        probes={"cubes": rng.uniform(0.01, 1.0, (280, 9, 3, 6)).astype(np.float16), "valid": np.ones(280, bool),
                "origin": np.zeros(3), "shape": np.array([8, 5, 7], np.int64), "spacing": np.float64(0.5)},
        sky=sky, floor={"D": floor_light(), "texelToModel": np.eye(4), "texel": 0.05},
        presets={"night": {"sky": 0.0, "sun": None, "house": 1.0, "emit": "lit"},
                 "sunny_morning": {"sky": 0.7, "sun": [2026, 5, 31, 8, 0], "sun_ratio": 16.0, "house": 0.0, "emit": "unlit"},
                 "overcast_noon": {"sky": 1.2, "sun": None, "house": 0.0, "emit": "unlit"}},
        evidence={"sunCheck": {"pass": True}, "skyBounce": {"K": SKY_K}, "refit": {"pass": True}, "artifacts": {}})
    parts = [np.stack([rng.uniform(0.2, 3.1, 2000), rng.uniform(0.3, 1.95, 2000), rng.uniform(0.1, 2.8, 2000)], 1),
             np.stack([rng.uniform(0.35, 3.15, 400), rng.uniform(-0.45, -0.05, 400), rng.uniform(0.4, 2.6, 400)], 1),
             np.stack([rng.uniform(0.2, 3.1, 300), rng.uniform(0.6, 1.95, 300), np.full(300, 0.05)], 1),
             np.stack([rng.uniform(0.2, 3.1, 300), rng.uniform(-0.9, -0.6, 300), rng.uniform(0.4, 2.6, 300)], 1)]
    P = np.concatenate(parts).astype(np.float32)
    cls = np.concatenate([rng.choice([0, 0, 0, 0, 3, 4, 5, 6], 2000), np.ones(400, int), np.zeros(300, int), np.full(300, 2)])
    normals = rng.normal(size=(len(P), 3))
    normals[2400:2700] = [0.0, 0.0, 1.0]
    room = (cls == 0) | (cls == 1)
    reach = np.zeros(len(P), bool)
    reach[room] = windows.sun_reach(vols, np.asarray(P[room], np.float64), 55.8593)
    flags = (cls | np.where(reach, codec.FLAG_SUN, 0) | np.where(np.isin(cls, [3, 6]) & (rng.random(len(P)) < 0.5), codec.FLAG_CH_CENTRE, 0)).astype(np.uint8)
    records = np.frombuffer(codec.pack_records(np.exp2(rng.uniform(-10, 0, (len(P), 9))), normals, flags, RANGES), np.uint8).reshape(-1, 12)
    np.save(os.path.join(work, "npy", "splats_pos.npy"), P)
    fin = {"records": records, "tile": np.zeros(len(P), np.uint8), "pos": P, "rgb": rng.integers(10, 250, (len(P), 3)).astype(np.uint8),
           "chand": np.where(np.isin(cls, [3, 6]), 0, -1).astype(np.int8)}
    tile = PK.Tile("env.sog", "a" * 64, None, records.tobytes())
    PK.write(os.path.join(root, "package"), inputs, [tile], RANGES, tool="t", created_at="c",
             build={"skins": None, "skinLight": None, "skinPackage": None})
    cfg = config.Config(paths={"work": work, "evidence": evidence},
                        room={"site": {"latitude": 55.8593, "longitude": -4.2491, "xBearingDeg": 14.3}})
    return cfg, fin


def vector_issues(v, model):
    """R1b's RelightVectorsSchema (plan R1b Task 4) as far as Python repeats it, with its refinements."""
    issues = []
    want = {"schema", "sources", "encoding", "capture", "site", "sun", "windows", "sampleDepths", "skyBounce", "windowRays",
            "probes", "presetsFromProof", "settings", "splats", "floorTexels"}
    if set(v) != want:
        return [f"keys {sorted(set(v) ^ want)}"]
    vec3 = lambda x: isinstance(x, list) and len(x) == 3 and all(isinstance(a, (int, float)) for a in x)
    check = lambda ok, what: None if ok else issues.append(what)
    check(v["schema"] == "venviewer.relight-vectors.v1" and len(v["sources"]) == 9, "schema or sources")
    check(len(v["encoding"]["sources"]) == 9 and len(v["capture"]["weights"]) == 9 and all(vec3(c) for c in v["capture"]["colours"]), "capture")
    check(all(vec3(v["site"][a]) for a in ("north", "east", "up")) and len(v["sun"]["fresnel"]) == 101, "site or sun")
    check(len(v["windows"]) == 5 and all(len(w["frame"]) == 21 and w["alphaGz"] and len(w["horizon"]) == 360 for w in v["windows"]), "windows")
    check(len(v["sampleDepths"]) == 256 and min(v["sampleDepths"]) >= 0, "sample depths")
    s = v["skyBounce"]
    k = s["k"]
    check(isinstance(k, int) and 1 <= k <= 192 and len(s["floorMean"]) == k and all(len(c["coefficients"]) == k for c in s["cases"]), "sky k")
    check(len(s["size"]) == 2 and all(isinstance(x, int) and x >= 2 for x in s["size"]) and s["step"] > 0, "sky table")
    check(all(vec3(c["dir"]) and len(c["powers"]) == 5 and min(c["powers"]) >= 0 and len(c["corners"]) == 4 for c in s["cases"]), "sky cases")
    check(len(s["nodes"]) >= 1 and all(isinstance(nd["index"], int) and nd["values"] for nd in s["nodes"]), "sky nodes")
    f = s["fold"]
    check(len(f["corners"]) == 8 and all(w > 0 for _i, w in f["corners"]) and len(f["cube"]) == 18 and vec3(f["rgb"]) and f["basis"], "fold")
    entries = [e["index"] for e in v["probes"]["entries"]]
    for name in ("sunny_morning", "moon_test"):
        check([e["index"] for e in s["probeCubes"][name]] == entries, f"probe cubes {name}")
    r = v["windowRays"]
    check(len(r["suns"]) == 9 and len(r["visibility"]) == len(r["points"]) == len(r["steps"]), "rays shape")
    check(all(len(row) == 9 for row in r["visibility"] + r["steps"]), "rays rows")
    check(all(0 <= x <= 1 for row in r["visibility"] for x in row) and all(isinstance(x, int) and 0 <= x <= 147 for row in r["steps"] for x in row), "ray values")
    check(r["wallFace"] and all(0 <= p < len(r["points"]) and 0 <= q < 9 for p, q in r["wallFace"]), "wall-face pairs")
    rate = r["wallFaceRate"]
    check(rate["marched"] > 0 and rate["wallFace"] <= rate["marched"] and rate["floor"]["marched"] > 0, "wall-face rate")
    pr = v["probes"]
    check(len(pr["shape"]) == 3 and pr["spacing"] > 0 and all(isinstance(e["valid"], bool) for e in pr["entries"]), "probes")
    check(set(v["presetsFromProof"]) == {"night", "sunny_morning", "overcast_noon"}, "presets")
    for name, st in v["settings"].items():
        check(len(st["weights"]) == 9 and set(st["lampLevels"]) == {"cove", "ch_end", "ch_centre", "dome"} and st["emitterBoost"] == 1
              and (st["sunDir"] is None or vec3(st["sunDir"])) and (st["moonDir"] is None or vec3(st["moonDir"])), f"setting {name}")
    check(set(v["settings"]) == {"captured", "night", "sunny_morning", "moon_test"}, "settings")
    check(len(v["splats"]) == 64 and all(len(sp["record"]) == 24 and vec3(sp["position"]) and vec3(sp["colour"])
                                         and set(sp["expected"]) == set(v["settings"]) for sp in v["splats"]), "splats")
    check(len(v["floorTexels"]) == 8 and all(len(t["direct"]) == 9 and min(t["direct"]) >= 0 for t in v["floorTexels"]), "floor texels")
    return issues


class SyntheticHall(unittest.TestCase):
    """The check's sky, wall-face and vectors code end to end on a synthetic hall's package (no proof modules, no D:)."""

    @classmethod
    def setUpClass(cls):
        from relight import package as PK
        cls.dir = tempfile.mkdtemp()
        cls.cfg, cls.fin = synthetic_hall(cls.dir)
        cls.pkg = PK.read(os.path.join(cls.dir, "package"))
        cls.model = PK.model_of(cls.pkg)
        cap = reference.Setting.captured(cls.model)
        sunny = replace(cap.with_sky(0.7).with_lamps(0.0), sun_dir=FakeCommon.sun_vec_e57(104.3, 30.0), sun_rgb=np.array([300.0, 250.0, 200.0]))
        cls.settings = {"captured": cap, "night": cap.with_sky(0.0), "sunny_morning": sunny,
                        "moon_test": reference.Setting(weights=np.zeros((9, 3)), sky_level=0.0, sky_colour=np.ones(3),
                                                       lamp_levels={g: 0.0 for g in reference.LAMP_GROUPS}, sun_dir=None,
                                                       sun_rgb=np.zeros(3), moon_dir=FakeCommon.sun_vec_e57(*M.MOON_TEST),
                                                       moon_rgb=sunny.sun_rgb.copy())}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir)

    def test_the_sky_check_holds_the_package_to_the_bake_and_the_two_grids_agree(self):
        from unittest import mock
        with mock.patch.object(M, "SKY_CHECK_SPLATS", 600), mock.patch.object(M, "SKY_CHECK_DIRECTIONS", 3):
            got = M._check_sky(self.cfg, self.pkg, self.model, FakeCommon)
        self.assertEqual(got["arrays"], {"differ": [], "pass": True})
        for body in ("sun", "moon"):
            self.assertEqual((got[body]["directions"], got[body]["zeroDisagreements"]), (3, 0))
        self.assertLess(got["sun"]["p99AbsDlog2"], 1e-9)                    # inside the grids the two lookups are one function
        self.assertTrue(got["pass"])

    def test_the_wall_face_rate_pools_both_directions_for_each_population(self):
        from unittest import mock
        with mock.patch.object(M, "SPLAT_SAMPLE", 500):
            rate = M._wall_face(self.model, FakeCommon, self.fin["pos"], self.settings)
        grid_points = len(np.arange(0.05, 2.95, 0.05)) * len(np.arange(0.05, 1.95, 0.05))   # check-sun's 5 cm floor grid
        self.assertEqual((rate["splats"], rate["floor"]["points"]), (500, grid_points))
        self.assertGreater(rate["marched"], 0)
        self.assertGreater(rate["floor"]["wallFace"], 0)                 # the glazing bar's row makes unlike cells
        self.assertLessEqual(rate["floor"]["wallFace"], rate["floor"]["marched"])

    def test_the_vectors_have_r1bs_shape_and_hold_the_reference_values(self):
        import base64
        from unittest import mock
        from relight import codec, package as PK
        colour = (self.fin["rgb"] / 255.0) ** 2.2
        rate = {"splats": 200000, "marched": 10, "wallFace": 1, "floor": {"points": 88831, "marched": 10, "wallFace": 1}}
        with mock.patch.object(M, "SPLAT_SAMPLE", 500):
            data, info = M._vectors(self.cfg, self.pkg, self.model, self.settings, FakeCommon, self.fin, colour, rate)
        v = json.loads(data)
        self.assertEqual(vector_issues(v, self.model), [])
        self.assertEqual((info["bytes"], info["k"], info["foldCorners"]), (len(data), SKY_K, 8))
        flags = [bytes.fromhex(sp["record"])[11] for sp in v["splats"]]
        classes = {f & codec.CLASS_MASK for f in flags}
        self.assertTrue({0, 1, 2} <= classes and classes & {3, 4} and classes & {5, 6})
        self.assertTrue(any(f & codec.FLAG_SUN for f in flags))
        records = np.frombuffer(b"".join(bytes.fromhex(sp["record"]) for sp in v["splats"]), np.uint8).reshape(-1, 12)
        direct, normals, fl = PK.decode(records, RANGES)
        P, C = np.array([sp["position"] for sp in v["splats"]]), np.array([sp["colour"] for sp in v["splats"]])
        for name, setting in self.settings.items():
            M_, A = reference.multiplier(direct, normals, fl, P, C, self.model, setting)
            np.testing.assert_allclose([sp["expected"][name]["m"] for sp in v["splats"]], M_, rtol=0, atol=1e-12)
            self.assertEqual([sp["expected"][name]["word"] for sp in v["splats"]], codec.pack_multiplier(M_, A).tolist())
        points = np.array(v["windowRays"]["points"])
        for k, s in enumerate(v["windowRays"]["suns"]):
            steps = np.zeros(len(points), np.int32)
            vis = windows.sun_visibility(self.model.volumes, self.model.horizons, self.model.fresnel, points, s, steps=steps)
            self.assertEqual([row[k] for row in v["windowRays"]["steps"]], steps.tolist())
            self.assertEqual([row[k] for row in v["windowRays"]["visibility"]], [float(x) for x in vis])
        S = reference.sky_cubes(self.model, reference.sky_bodies(self.settings["moon_test"]))
        for e in v["skyBounce"]["probeCubes"]["moon_test"]:
            self.assertEqual(base64.b64decode(e["cube"]), np.ascontiguousarray(S[e["index"]], "<f4").tobytes())
        self.assertEqual(v["windowRays"]["wallFaceRate"], rate)
        self.assertEqual(v["windowRays"]["suns"][0], [float(x) for x in self.settings["sunny_morning"].sun_dir])


if __name__ == "__main__":
    unittest.main()

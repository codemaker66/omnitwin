import argparse, contextlib, gc, io, json, os, shutil, stat, subprocess, tempfile, unittest, zipfile
from dataclasses import replace
from types import SimpleNamespace
from unittest import mock
import numpy as np
from relight import __main__ as M, codec, config, package as PK, probes as PR, records as RC, reference, sunbounce, windows
from tests.test_artifacts import host_env
from tests.test_package import fit_json, read_bytes, read_json, refit_json
from tests.test_reference import model as small_model, sky_basis
from tests.test_windows import HEAD_ON, RECT, RES, grid

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def args(**kw):
    base = {"out": None, "skins": None, "skin_light": None, "skin_package": None, "package": None, "vectors": None}
    return argparse.Namespace(**{**base, **kw})


def _writable_then_retry(function, path, _exc):
    """rmtree's onexc: git marks its object files read-only, which Windows will not delete until they are writable."""
    os.chmod(path, stat.S_IWRITE)
    function(path)


class CommittedCodeOnly(unittest.TestCase):
    """Ruling P1: a package is built and checked only from committed code; records and check refuse, writing nothing,
    while tools/relight or the repo's SOG decoder that both run (tools/xgrids-lcc2/scripts/sog-floor-census.py; fix
    round 1, M2) has any uncommitted change, and the manifest's tool is the HEAD commit."""
    REFUSED = "FAIL: tools/relight or tools/xgrids-lcc2/scripts/sog-floor-census.py has uncommitted changes"
    CENSUS = "tools/xgrids-lcc2/scripts/sog-floor-census.py"

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, onexc=_writable_then_retry)
        self.repo = os.path.join(self.dir, "repo")
        os.makedirs(os.path.join(self.repo, "tools", "relight"))
        os.makedirs(os.path.join(self.repo, "tools", "xgrids-lcc2", "scripts"))
        self.git("init", "-q")
        self.write("tools/relight/a.py", "a = 1\n")
        self.write(self.CENSUS, "def decode_tile(path):\n    pass\n")
        self.write("tools/xgrids-lcc2/scripts/other.py", "x = 1\n")
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
        self.write("tools/xgrids-lcc2/scripts/other.py", "x = 2\n")          # beside the decoder, which neither command runs
        got, _out = self.committed()
        self.assertEqual(got, (self.git("rev-parse", "HEAD"), self.git("log", "-1", "--format=%cI")))

    def test_any_uncommitted_change_in_tools_relight_refuses(self):
        for change in (lambda: self.write("tools/relight/a.py", "a = 2\n"), lambda: self.git("add", "tools/relight/a.py"),
                       lambda: self.write("tools/relight/new.py", "b = 1\n")):
            change()
            got, out = self.committed()
            self.assertIsNone(got)
            self.assertIn(self.REFUSED, out)

    def test_an_uncommitted_change_to_the_sog_decoder_refuses(self):
        for change in (lambda: self.write(self.CENSUS, "def decode_tile(path):\n    return None\n"),
                       lambda: self.git("add", self.CENSUS), lambda: self.git("rm", "-q", "--cached", self.CENSUS)):
            change()
            got, out = self.committed()
            self.assertIsNone(got)
            self.assertIn(self.REFUSED, out)
            self.assertIn("sog-floor-census.py", out.splitlines()[-1])

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


OUTLINES = {f"W{i + 1}": (0.3 + 0.6 * i, 0.8 + 0.6 * i, 0.5, 0.3, 2.7, "rect") for i in range(5)}


def straddles_5fe7637e(volumes, P, s):
    """_straddles as commit 5fe7637e computed it, with its own float32 copy of windows._rays' first sample and of
    windows._alpha_at (_cell_alpha); kept to show that fix round 1's version (M3) lists the same rays."""
    def cell_alpha(vol, gx, gy, gz):
        cell = np.stack([gx, np.full(len(gx), gy, np.int64), gz], 1) - vol.offset
        inside = np.all((cell >= 0) & (cell < np.array(vol.alpha.shape)), axis=1)
        out = np.zeros(len(gx), np.uint8)
        out[inside] = vol.alpha[cell[inside, 0], cell[inside, 1], cell[inside, 2]]
        return out

    P32, s32 = np.asarray(P, np.float32), np.asarray(s, np.float32)
    out = np.zeros(len(P32), bool)
    owner = np.full(len(P32), -1)
    names = list(volumes)
    for w, name in enumerate(names):
        owner[(owner < 0) & windows.ray_survives(volumes[name], P32, s32)] = w
    for w, name in enumerate(names):
        vol = volumes[name]
        idx = np.nonzero((owner == w) & (P32[:, 1] > vol.y0))[0]
        if not idx.size:
            continue
        tq = (vol.y0 - P32[idx, 1]) / s32[1]
        Q = P32[idx] + s32 * tq[:, None]
        c = np.floor((Q - vol.grid_lo) / np.float32(vol.res)).astype(np.int64)
        iy0 = int(round((vol.y0 - float(vol.grid_lo[1])) / vol.res))
        unlike = cell_alpha(vol, c[:, 0], iy0 - 1, c[:, 2]) != cell_alpha(vol, c[:, 0], iy0, c[:, 2])
        out[idx] = (c[:, 1] >= iy0) & unlike
    return out


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

    def test_the_wall_face_test_lists_the_rays_commit_5fe7637e_listed(self):
        """Fix round 1, M3: _straddles reads windows._rays' first sample and windows._alpha_at; over five windows with a
        glazing bar and a jamb, 6,000 room points (half of them on the 3 cm grid's planes in x and z) and 40 directions
        it lists exactly the rays the copy in commit 5fe7637e listed."""
        occ = grid((110, 34, 100))
        occ[40:60, 32, :] = 0.5
        occ[95:105, 20:33, :] = 1.0
        vols = windows.volumes_from_occupancy(occ, np.array([0.0, -0.99, 0.0]), RES, OUTLINES, 0.0, x_bearing=14.3)
        rng = np.random.default_rng(3)
        P = np.stack([rng.uniform(0.0, 3.3, 6000), rng.uniform(0.001, 2.0, 6000), rng.uniform(0.0, 3.0, 6000)], 1)
        P[::2, 0] = np.round(P[::2, 0] / RES) * RES
        P[::2, 2] = np.round(P[::2, 2] / RES) * RES
        listed = 0
        for az, el in zip(rng.uniform(75, 135, 40), rng.uniform(1, 65, 40)):
            s = windows.sun_vector(az, el, 14.3)
            got = M._straddles(vols, P, s)
            self.assertTrue(np.array_equal(got, straddles_5fe7637e(vols, P, s)), (az, el))
            listed += int(got.sum())
        self.assertGreater(listed, 100)

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
        with self.assertRaisesRegex(ValueError, r"eight 1 m corners each of weight >= 1e-06"):     # M7: the rule it applies
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

    def test_one_texel_per_source_that_lights_the_floor_in_source_order(self):
        D = floor_light()
        self.put(D)
        texels = M._floor_texels(self.cfg)
        self.assertEqual([(t["row"], t["col"]) for t in texels], [(0, 0), (0, 2), (0, 4), (0, 6), (1, 7), (5, 1), (4, 4), (3, 6)])
        self.assertEqual([t["direct"] for t in texels], [[float(v) for v in D[t["row"], t["col"]]] for t in texels])
        self.assertTrue(all(t["direct"][5] == 0.0 for t in texels))      # the cove lights no floor texel

    def test_texels_that_cannot_tell_two_sources_apart_are_refused(self):
        D = floor_light()
        D[..., 7] = D[..., 6]
        self.put(D)
        with self.assertRaisesRegex(ValueError, "do not tell the sources apart"):
            M._floor_texels(self.cfg)


class Comparisons(unittest.TestCase):
    """Check 1's and check 2's arithmetic on hand-made values."""

    def test_identity_counts_the_shown_splats_within_a_twentieth_of_a_stop_on_every_channel(self):
        Mv = np.array([[1.0, 1.0, 1.0], [1.0, 2 ** 0.049, 1.0], [1.0, 2 ** 0.06, 1.0], [0.0, 1.0, 1.0], [9.0, 9.0, 9.0]])
        got = M._identity(Mv, np.array([1.0, 1.0, 1.0, 1.0, 0.0]))     # the last splat is hidden
        self.assertEqual((got["splats"], got["within"], got["share"]), (4, 2, 0.5))
        self.assertAlmostEqual(got["worstAbsLog2"], 0.06, places=12)      # M = 0 counts outside; its infinity is not the worst
        self.assertFalse(got["pass"])
        self.assertTrue(M._identity(np.ones((1000, 3)), np.ones(1000))["pass"])
        one_out = np.ones((1000, 3)); one_out[0, 2] = 1.1
        self.assertTrue(M._identity(one_out, np.ones(1000))["pass"])     # 99.9% within passes, 99.8% does not
        one_out[1, 0] = 0.5
        self.assertFalse(M._identity(one_out, np.ones(1000))["pass"])

    def test_versus_proof_reads_n_by_4_float16_through_the_clamp(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "night.f16")
            theirs = np.array([[100.0, 0.001, 1.0, 1.0], [8.0, 0.0625, 2.0, 1.0], [0.5, 0.25, 0.75, 1.0], [3.0, 3.0, 3.0, 1.0]])
            theirs.astype("<f2").tofile(path)
            mine = np.array([[8.0, 1 / 16, 1.0], [8.0, 1 / 16, 2.0], [0.5, 0.25, 0.75]])
            got = M._versus_proof(mine, path, np.array([0, 1, 2]), 4)
            self.assertEqual((got["medianAbsDlog2"], got["p95AbsDlog2"], got["nonPositive"]), (0.0, 0.0, 0))
            self.assertAlmostEqual(got["clampedShare"], 2 / 9)                # 100 -> 8 and 0.001 -> 1/16
            with self.assertRaisesRegex(ValueError, "not 5 x 4 float16"):
                M._versus_proof(mine, path, np.array([0, 1, 2]), 5)
            self.assertEqual(M._for_information(mine, path, np.array([0, 1, 2]), 4), got)
            self.assertIn("not 5 x 4 float16", M._for_information(mine, path, np.array([0, 1, 2]), 5)["error"])     # M6
            self.assertIsNone(M._for_information(mine, os.path.join(d, "absent.f16"), np.array([0, 1, 2]), 4))


# ------------------------------------------------------------------------------------------------------ synthetic hall
T_JE = np.array([[0.0, -1.0, 0.0, 5.0], [1.0, 0.0, 0.0, -2.0], [0.0, 0.0, 1.0, 1.0], [0.0, 0.0, 0.0, 1.0]])
TOOL = ("5" * 40, "2026-10-11T00:00:00+01:00")
BUILD = {"skins": None, "skinLight": None, "skinPackage": None, "host": "pc"}
FINEST = ("env.sog", "1_0_0.sog", "1_0_1.sog")
COARSE = ("0_0.sog", "0_1.sog")
POCKET = np.array([2.75, 1.75, 0.75])   # the centre of the 0.5 m probe cell whose eight probes hold no light
SKY_K = 2
SH0_CODEBOOK = [(i / 255.0 - 0.5) / M.SH_C0 for i in range(256)]   # code i decodes to the stored byte i


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


class FakeCommon:
    """The proof's common.py as records and check use it, for the synthetic hall: the served tiles' json frame (T_JE, a
    quarter turn about z and a shift, so a missed json_to_e57 shows), the hall's box and floor, the sun vector, and a
    deterministic stand-in for the solar position whose every sun faces the window wall (compass 85..125, 9..38 up)."""
    X0, X1, Y0, Y1, FLOOR_Z = 0.0, 3.23, 0.0, 2.07, 0.0     # not whole multiples of the grids' spacing, like the hall's
    T_EJ = np.linalg.inv(T_JE)

    @staticmethod
    def json_to_e57(p):
        return (np.asarray(p, np.float64) - T_JE[:3, 3]) @ T_JE[:3, :3]

    @staticmethod
    def e57_to_json(p):
        return np.asarray(p, np.float64) @ T_JE[:3, :3].T + T_JE[:3, 3]

    @staticmethod
    def sun_vec_e57(az, el):
        return windows.sun_vector(az, el, 14.3)

    @staticmethod
    def solar_position(year, month, day, hour, minute=0.0):
        k = (month * 31 + day) * 7 + hour * 60 + int(minute)
        return 85.0 + k % 41, 9.0 + (hour * 7 + int(minute)) % 30


class FakeFit04:
    """04_fit.py's BASES (the fit's order, sun_cap sixth) and direct(store, idx), which reads the tables as 04_fit does."""
    BASES = ["W1", "W2", "W3", "W4", "W5", "sun_cap", "cove", "ch_end", "ch_centre", "dome"]
    SKY_W = np.array([0.15, 0.66, 1.0, 1.21], np.float32)

    @classmethod
    def direct(cls, store, idx):
        Ew = np.asarray(store.E_win[idx], np.float32)
        D = np.empty((Ew.shape[0], len(cls.BASES)), np.float32)
        for wi in range(5):
            D[:, wi] = Ew[:, wi * 4:(wi + 1) * 4] @ cls.SKY_W
        D[:, 5] = store.E_sun_cap[idx]; D[:, 6] = store.E_cove[idx]
        ch = np.asarray(store.E_ch[idx]); D[:, 7] = ch[:, 0]; D[:, 8] = ch[:, 1]; D[:, 9] = store.E_dome[idx]
        return D


def fake_store(work):
    """store.py as records and check use it: Store over <work>/npy's memory-mapped tables, mm, LUT and LUMW."""
    npy = os.path.join(work, "npy")

    def mm(name):
        return np.load(os.path.join(npy, f"{name}.npy"), mmap_mode="r")

    class Store:
        def __init__(self):
            self.pos = mm("splats_pos"); self.rgb = mm("splats_rgb"); self.opa = mm("splats_opa")
            self.cls = mm("geom_cls"); self.n = mm("bases_n"); self.iso = mm("bases_iso")
            self.E_win = mm("bases_E_win"); self.E_ch = mm("bases_E_ch"); self.E_dome = mm("bases_E_dome")
            self.E_cove = mm("bases_E_cove"); self.E_sun_cap = mm("sun_cap_E")
            self.N = self.pos.shape[0]

        def chunks(self, size=500_000):
            for a in range(0, self.N, size):
                yield slice(a, min(self.N, a + size))

        def colour(self, idx):
            return LUT[np.asarray(self.rgb[idx])]

    LUT = srgb_to_linear(np.arange(256) / 255.0).astype(np.float32)
    return SimpleNamespace(Store=Store, mm=mm, LUT=LUT, LUMW=np.array([0.2126, 0.7152, 0.0722], np.float32))


class FakeRelight05:
    """05_relight.py as records and check use it: its presets (and one more the package must leave out), scenario_light,
    the fit's window weights W and lamp weights times colours WC (BASES order), the window cookie read from the work
    folder, the pane haze (embrasure splats over 0.4 m deep, in an empty cookie cell, opacity under 0.5) and the cove
    strip (bright interior splats 2.4 m up within 0.4 m of an end wall)."""
    SCENARIOS = {"night": {"sky": 0.0, "sun": None, "house": 1.0, "emit": "lit", "ext_rgb": (0.03, 0.042, 0.085)},
                 "sunny_morning": {"sky": 0.7, "sky_T": 9000.0, "sun": (2026, 5, 31, 8, 0), "sun_ratio": 16.0, "sun_T": 4900.0,
                                   "house": 0.0, "emit": "unlit"},
                 "overcast_noon": {"sky": 1.2, "sky_T": 6500.0, "sun": None, "house": 0.0, "emit": "unlit"},
                 "comp_house": {"sky": 0.0, "sun": None, "house": 1.0, "emit": "lit"}}

    def __init__(self, work, fit):
        self.work = work
        w, c = np.asarray(fit["weights"], np.float64), np.asarray(fit["colours"], np.float64)
        self.W, self.WC, self.COLS = w.astype(np.float32), (w[:, None] * c).astype(np.float32), c.astype(np.float32)

    def scenario_light(self, sc):
        def shift(T):
            return (np.array([6500.0 / T, 1.0, T / 6500.0]) ** 0.25).astype(np.float32)
        col_sky = (self.COLS[0] * shift(sc.get("sky_T", 6500.0))).astype(np.float32)
        col_sun = (self.COLS[0] * shift(sc.get("sun_T", 6500.0))).astype(np.float32)
        f_sun = sc.get("sun_ratio", 0.0) * sc["sky"] * float(np.mean(self.W[:5])) if sc["sun"] else 0.0
        return col_sky, col_sun, f_sun

    def cookie(self):
        with np.load(os.path.join(self.work, "occ_cookie.npz")) as g:
            return g["occ"], g["occ_lo"], float(g["occ_res"])

    @staticmethod
    def exterior_masks(p, cls, occ, opa=None, lum_of=None):
        g, lo, res = occ
        ijk = np.floor((np.asarray(p, np.float64) - lo) / res).astype(np.int64)
        inb = np.all((ijk >= 0) & (ijk < np.array(g.shape)), 1)
        empty = np.ones(len(p), bool)
        empty[inb] = g[ijk[inb, 0], ijk[inb, 1], ijk[inb, 2]] < 0.3
        pane = (cls == 1) & (p[:, 1] < -0.4) & empty & (np.asarray(opa, np.float32) < 0.5)
        return (cls == 2) | pane, pane

    @staticmethod
    def cove_strip(p, cls, L):
        near = (np.abs(p[:, 0] - FakeCommon.X0) < 0.4) | (np.abs(p[:, 0] - FakeCommon.X1) < 0.4)
        return (cls == 0) & (p[:, 2] > 2.4) & near & (L > 0.28)


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


def write_sog(path, centres_json, rgb, opacity, scales):
    """A SOG v2 tile as the repo's decode_tile reads it: meta.json and 64-pixel-wide RGBA PNGs; the means log-coded to
    16 bits between per-axis mins and maxs, the DC colour through a codebook whose code i decodes to the stored byte i,
    the opacity in sh0's alpha, the scales by a 256-step log codebook, unit quaternions."""
    n, width = len(centres_json), 64
    height = -(-n // width)

    def png(rgba):
        pixels = np.zeros((width * height, 4), np.uint8)
        pixels[:n] = rgba
        buf = io.BytesIO()
        from PIL import Image
        Image.fromarray(pixels.reshape(height, width, 4)).save(buf, format="PNG")
        return buf.getvalue()

    m = np.sign(centres_json) * np.log1p(np.abs(centres_json))
    mins, maxs = m.min(0) - 1e-3, m.max(0) + 1e-3
    q = np.rint((m - mins) / (maxs - mins) * 65535).astype(np.uint32)
    low, high = np.full((n, 4), 255, np.uint8), np.full((n, 4), 255, np.uint8)
    low[:, :3], high[:, :3] = q & 0xFF, q >> 8
    log_scales = np.linspace(np.log(0.002), np.log(0.5), 256)
    sc = np.full((n, 4), 255, np.uint8)
    sc[:, :3] = np.clip(np.rint((np.log(scales) - log_scales[0]) / (log_scales[1] - log_scales[0])), 0, 255)[:, None]
    quats = np.tile(np.array([128, 128, 128, 252], np.uint8), (n, 1))
    sh0 = np.zeros((n, 4), np.uint8)
    sh0[:, :3], sh0[:, 3] = rgb, np.rint(np.asarray(opacity, np.float64) * 255)
    meta = {"version": 2, "count": n, "means": {"files": ["means_l.png", "means_u.png"], "mins": mins.tolist(), "maxs": maxs.tolist()},
            "scales": {"files": ["scales.png"], "codebook": log_scales.tolist()}, "quats": {"files": ["quats.png"]},
            "sh0": {"files": ["sh0.png"], "codebook": SH0_CODEBOOK}}
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("meta.json", json.dumps(meta))
        for name, rgba in (("means_l.png", low), ("means_u.png", high), ("scales.png", sc), ("quats.png", quats), ("sh0.png", sh0)):
            z.writestr(name, png(rgba))


def _put_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _put_artifact(work, evidence, name, evidence_name, arrays, **extra):
    """A work artifact (.npz) and its passing evidence JSON recording its exact path, SHA-256 and size (Task 4c)."""
    path = os.path.join(work, name)
    with open(path, "wb") as f:
        np.savez_compressed(f, **arrays)
    _put_json(os.path.join(evidence, evidence_name), {"pass": True, **extra, "artifact": M._artifact(path)})


def _falloff(P, centre, scale):
    return scale / (1.0 + 4.0 * np.sum((P - np.asarray(centre)) ** 2, 1))


SYNTHETIC_BOX = {"x0": FakeCommon.X0, "x1": FakeCommon.X1, "y0": FakeCommon.Y0, "y1": FakeCommon.Y1, "floorZ": FakeCommon.FLOOR_Z,
                 "ceilingZ": 3.04}
LOOKUP_BOX = {"lo": [FakeCommon.X0 + 0.02, FakeCommon.Y0 + 0.02, FakeCommon.FLOOR_Z + 0.02],
              "hi": [FakeCommon.X1 - 0.02, FakeCommon.Y1 - 0.02, 9.8]}       # store.Probes.lookup's clamp


def build_hall(root):
    """A synthetic hall laid out as the bake's folders under root: work (the per-splat tables of the finest level in a
    shuffled product order, the window cookie, the four artifacts, fit.json and fit_state.npz as Task 4b promotes them,
    the lamp/daylight ratio), evidence (the artifacts' passing evidence, sun-check.json, refit.json), proof-work (the
    proof's ratio and multipliers), splats (three finest tiles and two coarser .sog tiles) and bundle.ts (the bundle
    file serving those five), with the proof's modules as stand-ins (FakeCommon, FakeFit04, fake_store, FakeRelight05).

    The room is y > 0 behind the wall face y0 = 0, with five rectangular windows 0.5 m deep side by side along x, a
    glazing bar's row of half-dense cells just behind the wall face at x 1.2..1.8 and a dense jamb at x 2.85..3.15. The
    finest level: env.sog (exterior, hidden); 1_0_0.sog (the room, its bulbs, fixtures, cove strip and floor); 1_0_1.sog
    (the window side: embrasure splats, twelve of them stored with a zero sRGB byte in one channel, and twelve interior
    splats in POCKET, a probe cell whose eight probes hold no light, with no direct light either). The coarser tiles sit
    on finest splats: 0_0.sog on every fifth of 1_0_0.sog's, 0_1.sog on every fifth of 1_0_1.sog's plus every dark
    embrasure splat and six of the pocket's. The direct light falls off smoothly from each window, chandelier, the
    dome and the cove line. Returns SimpleNamespace(cfg, proof, kind (each finest splat's population), coarse ({tile:
    the finest splat each of its splats sits on}))."""
    rng = np.random.default_rng(7)
    work, evidence, proof_work, splats = (os.path.join(root, d) for d in ("work", "evidence", "proof-work", "splats"))
    for d in (os.path.join(work, "npy"), os.path.join(work, "mult"), evidence, os.path.join(proof_work, "mult"), splats):
        os.makedirs(d)
    occ = np.zeros((110, 34, 100), np.float32)
    occ[40:60, 32, :] = 0.5
    occ[95:105, 20:33, :] = 1.0
    lo = np.array([0.0, -0.99, 0.0])
    with open(os.path.join(work, "occ_cookie.npz"), "wb") as f:
        np.savez_compressed(f, occ=occ, occ_lo=lo, occ_res=np.float64(0.03))
    vols = windows.volumes_from_occupancy(occ, lo, 0.03, OUTLINES, 0.0, x_bearing=14.3)
    arrays = {"fresnel": np.linspace(0.8, 0.92, 101).astype(np.float32)}
    for name, vol in vols.items():
        arrays[f"{name}_alpha"], arrays[f"{name}_frame"] = windows.volume_arrays(vol)
        arrays[f"{name}_horizon"] = np.full(360, 5.0, np.float32)
    _put_artifact(work, evidence, "windows.npz", "windows.json", arrays, windows=list(OUTLINES))
    # Both grids as the bake builds them (probes.coarse_grid and valid_mask, as cmd_probes and cmd_sun_bounce do): 0.5 m
    # and 1 m from the box's low corner, valid inside the box less 2 cm, so their planes on the box's low faces are
    # invalid and a splat beyond the window wall (y < 0) finds no valid probe unless it is read inside the box.
    P05, shape05, origin05 = PR.coarse_grid(SYNTHETIC_BOX, 0.5)                 # 7 x 5 x 7
    cubes = rng.uniform(0.001, 0.05, (len(P05), 9, 3, 6)).astype(np.float16)
    for ix in (5, 6):
        for iy in (3, 4):
            for iz in (1, 2):
                cubes[(ix * shape05[1] + iy) * shape05[2] + iz] = 0.0
    _put_artifact(work, evidence, "probes-coarse.npz", "probes-check.json",
                  {"cubes": cubes, "valid": PR.valid_mask(P05, SYNTHETIC_BOX), "origin": origin05,
                   "shape": np.asarray(shape05, np.int64), "spacing": np.float64(0.5)})
    P1, shape1, origin1 = PR.coarse_grid(SYNTHETIC_BOX, 1.0)                    # 4 x 3 x 4
    centres = np.stack([rng.uniform(0.5, 2.9, 20), rng.uniform(1.0, 1.9, 20), rng.uniform(0.5, 2.0, 20)], 1)
    patches = sunbounce.Patches.from_arrays(centres, np.tile([0.0, -1.0, 0.0], (20, 1)), np.full(20, 0.25))
    sky = {"basis": rng.uniform(2e-4, 4e-3, (SKY_K, len(P1), 3, 6)).astype(np.float16), "valid": PR.valid_mask(P1, SYNTHETIC_BOX),
           "coeffs": rng.uniform(0.1, 1.0, (12, 30, 5, SKY_K)).astype(np.float32), "patchRays": patches.rays,
           "patchNormal": patches.normals, "patchArea": patches.areas, "floorMean": rng.uniform(0, 0.1, (SKY_K, 3)).astype(np.float32),
           "azimuth0": np.float64(60.0), "elevation0": np.float64(-2.0), "step": np.float64(4.0), "gridOrigin": origin1,
           "gridShape": np.asarray(shape1, np.int64), "gridSpacing": np.float64(1.0)}
    draw = {"worstBright": 0.04, "pooledMedian": 0.01}
    _put_artifact(work, evidence, "sun-bounce.npz", "sun-bounce-check.json", sky, K=SKY_K, kRule="the smallest K that passes",
                  result=draw, independentCheck={"result": draw}, strictCheck={"result": draw})
    _put_artifact(work, evidence, "floor-light.npz", "floor-light.json", {"D": floor_light(), "texelToModel": np.eye(4)})
    _put_json(os.path.join(evidence, "sun-check.json"), {"pass": True, "threshold": M.GATE, "directions": [
        {"utc": "2026-05-31T08:00", "az": 104.0, "el": 35.0, "floor": {"iou": 0.97, "meanAbsDiff": 0.01},
         "splats": {"iou": 0.96, "meanAbsDiff": 0.02}}]})
    fit = fit_json()
    _put_json(os.path.join(work, "fit.json"), fit)
    with open(os.path.join(work, "fit_state.npz"), "wb") as f:
        np.savez(f, weights=np.asarray(fit["weights"], np.float32), cols=np.asarray(fit["colours"], np.float32))
    copied = {name: PK.sha256_file(os.path.join(work, name)) for name in ("fit.json", "fit_state.npz")}
    _put_json(os.path.join(evidence, "refit.json"), refit_json(copied))
    for folder in (work, proof_work):
        _put_json(os.path.join(folder, M.LAMP_RATIO), {"lamp_over_daylight_rgb": [1.623, 1.0, 0.467]})

    def uniform(n, lo, hi):
        return np.stack([rng.uniform(lo[i], hi[i], n) for i in range(3)], 1)

    pops = []

    def population(kind, points, tile, cls, normal=None, colour=None):
        n = len(points)
        pops.append({"kind": np.full(n, kind), "P": points, "tile": np.full(n, tile), "cls": np.broadcast_to(cls, (n,)),
                     "n": rng.normal(size=(n, 3)) if normal is None else np.tile(normal, (n, 1)),
                     "rgb": rng.integers(40, 231, (n, 3)) if colour is None else colour})

    population("env", uniform(60, (0.3, -0.95, 0.4), (3.1, -0.6, 2.6)), 0, 2)
    room = uniform(1500, (0.2, 0.6, 0.1), (3.1, 1.95, 2.8))
    room = room[np.linalg.norm(room - POCKET, axis=1) > 0.4]
    population("room", room, 1, rng.choice([0, 0, 0, 0, 0, 0, 3, 4], len(room)))
    cove = np.stack([np.where(rng.random(30) < 0.5, rng.uniform(0.05, 0.3, 30), rng.uniform(2.9, 3.15, 30)),
                     rng.uniform(0.3, 1.9, 30), rng.uniform(2.45, 2.55, 30)], 1)
    population("cove", cove, 1, 0, colour=rng.integers(200, 251, (30, 3)))
    population("floor", uniform(300, (0.2, 0.6, 0.05), (2.9, 1.9, 0.05)), 1, 0, normal=[0.0, 0.0, 1.0])
    population("wall-side", uniform(300, (0.2, 0.05, 0.1), (3.1, 0.5, 2.8)), 2, 0)
    population("embrasure", uniform(400, (0.35, -0.45, 0.4), (3.15, -0.05, 2.6)), 2, 1)
    dark_rgb = rng.integers(40, 231, (12, 3))
    dark_rgb[np.arange(12), np.arange(12) % 3] = 0
    population("dark-embrasure", uniform(12, (0.4, -0.4, 0.5), (2.6, -0.1, 2.5)), 2, 1, colour=dark_rgb)
    population("pocket", POCKET + rng.uniform(-0.05, 0.05, (12, 3)), 2, 0)
    cat = {key: np.concatenate([p[key] for p in pops]) for key in pops[0]}
    order = rng.permutation(len(cat["P"]))
    cat = {key: value[order] for key, value in cat.items()}
    n = len(order)
    P = cat["P"].astype(np.float32)
    Pf = P.astype(np.float64)
    cls = cat["cls"].astype(np.uint8)
    chand = np.full(n, -1, np.int8)
    bulbs = cls == 3
    chand[bulbs] = rng.choice([0, 2], int(bulbs.sum()))
    fixtures = (cat["kind"] == "room") & (cls == 0) & (rng.random(n) < 0.1)
    chand[fixtures] = rng.choice([0, 2], int(fixtures.sum()))
    normals = cat["n"] / np.linalg.norm(cat["n"], axis=1, keepdims=True)
    iso = (rng.random(n) < 0.1) & (cat["kind"] != "floor")
    lit = (cat["kind"] != "pocket").astype(np.float64)
    E_win = np.zeros((n, 20))
    for w in range(5):
        f = _falloff(Pf, [0.55 + 0.6 * w, -0.25, 1.5], 0.08) * lit
        for b, scale in enumerate((1.0, 0.8, 0.6, 0.4)):
            E_win[:, 4 * w + b] = f * scale
    tables = {"splats_pos": P, "splats_rgb": cat["rgb"].astype(np.uint8),
              "splats_opa": rng.uniform(0.2, 1.0, n).astype(np.float16), "splats_tile": cat["tile"].astype(np.uint8),
              "geom_cls": cls, "geom_chand_id": chand, "bases_n": normals.astype(np.float16), "bases_iso": iso,
              "bases_E_win": E_win.astype(np.float16),
              "bases_E_ch": (np.stack([_falloff(Pf, [0.8, 1.2, 2.6], 0.5), _falloff(Pf, [2.0, 1.2, 2.6], 0.6)], 1) * lit[:, None]).astype(np.float32),
              "bases_E_dome": (_falloff(Pf, [1.5, 1.0, 3.0], 0.3) * lit).astype(np.float32),
              "bases_E_cove": ((_falloff(Pf, [0.1, 1.0, 2.6], 0.2) + _falloff(Pf, [2.9, 1.0, 2.6], 0.2)) * lit).astype(np.float32),
              "sun_cap_E": (0.01 * _falloff(Pf, [1.75, -0.25, 1.5], 1.0) * lit).astype(np.float32)}
    for name, a in tables.items():
        np.save(os.path.join(work, "npy", f"{name}.npy"), a)
    scales = rng.uniform(0.005, 0.05, n)
    for t, name in enumerate(FINEST):
        rows = np.nonzero(cat["tile"] == t)[0]
        write_sog(os.path.join(splats, name), FakeCommon.e57_to_json(Pf[rows]), tables["splats_rgb"][rows],
                  tables["splats_opa"][rows], scales[rows])
    dark = np.nonzero(cat["kind"] == "dark-embrasure")[0]
    pocket = np.nonzero(cat["kind"] == "pocket")[0]
    window_side = np.setdiff1d(np.nonzero(cat["tile"] == 2)[0][::5], np.concatenate([dark, pocket]))
    coarse = {"0_0.sog": np.nonzero(cat["tile"] == 1)[0][::5], "0_1.sog": np.concatenate([window_side, dark, pocket[:6]])}
    for name, src in coarse.items():
        write_sog(os.path.join(splats, name), FakeCommon.e57_to_json(Pf[src] + rng.uniform(-1e-4, 1e-4, (len(src), 3))),
                  tables["splats_rgb"][src], tables["splats_opa"][src], scales[src])
    entries = [{"file": name, "bytes": os.path.getsize(os.path.join(splats, name)), "sha256": PK.sha256_file(os.path.join(splats, name)),
                "lodLevel": None if name == "env.sog" else (2 if name in FINEST else 1), "isEnvironment": name == "env.sog"}
               for name in FINEST + COARSE]
    rooms = [{"roomSlug": "elsewhere", "tiles": []}, {"roomSlug": "synthetic", "tiles": entries}]
    with open(os.path.join(root, "bundle.ts"), "w", encoding="utf-8") as f:
        f.write("// GENERATED FILE\nexport const BUNDLES: readonly GeneratedRoomSplatBundle[] =\n  " + json.dumps(rooms, indent=1) + ";\n")
    cfg = config.Config(
        paths={"work": work, "evidence": evidence, "proofWork": proof_work, "splats": splats, "out": os.path.join(root, "package"),
               "bundle": os.path.join(root, "bundle.ts"), "repo": REPO},
        room={"slug": "synthetic", "site": {"latitude": 55.8593, "longitude": -4.2491, "xBearingDeg": 14.3},
              "windows": {name: list(o) for name, o in OUTLINES.items()}, "finestTiles": list(FINEST), "transferNeighbours": 8,
              "floorTexel": 0.05})
    proof = M._Proof(common=FakeCommon, fit04=FakeFit04, relight05=FakeRelight05(work, fit), store=fake_store(work))
    return SimpleNamespace(cfg=cfg, proof=proof, kind=cat["kind"], coarse=coarse)


def write_mult_files(cfg, model, settings, fin, colour, ranges):
    """The proof's multipliers as Task 4b's promote copies them (<work>/mult/<setting>.f16, N x 4 float16 in product
    order, recorded in refit.json's copied): the reference's own values, written as the proof writes values the spec's
    clamp holds (8 as 60, 1/16 as 0.004: the proof clips only to [0, 60]). The original proof's (proofWork/mult,
    information only): night 5% brighter, overcast_noon the same, sunny_morning one row short."""
    n = len(fin["records"])
    refit = read_json(os.path.join(cfg.paths["evidence"], "refit.json"))
    for name in M.PROOF_SETTINGS:
        Mv = M._multipliers(model, settings[name], ranges, fin["records"], fin["pos"], colour)[0]
        theirs = np.concatenate([np.where(Mv >= 8.0, 60.0, np.where(Mv <= 1 / 16, 0.004, Mv)), np.ones((n, 1))], 1).astype("<f2")
        path = os.path.join(cfg.paths["work"], "mult", f"{name}.f16")
        theirs.tofile(path)
        refit["copied"][f"mult/{name}.f16"] = PK.sha256_file(path)
        original = {"night": (theirs.astype(np.float64) * 1.05).astype("<f2"), "overcast_noon": theirs, "sunny_morning": theirs[:-1]}[name]
        original.tofile(os.path.join(cfg.paths["proofWork"], "mult", f"{name}.f16"))
    _put_json(os.path.join(cfg.paths["evidence"], "refit.json"), refit)


@contextlib.contextmanager
def small_check():
    """check's sample sizes for a hall of 3,000 splats: check 5 on 600 splats and 3 directions per body, the wall-face
    rate on 500 splats."""
    with mock.patch.object(M, "SKY_CHECK_SPLATS", 600), mock.patch.object(M, "SKY_CHECK_DIRECTIONS", 3), \
            mock.patch.object(M, "SPLAT_SAMPLE", 500):
        yield


def run_check(cfg, proof, **kw):
    """cmd_check from the committed tool TOOL on the PC: (exit code, what it printed)."""
    out = io.StringIO()
    with small_check(), mock.patch.object(M, "_committed_tool", return_value=TOOL), host_env(), contextlib.redirect_stdout(out):
        rc = M.cmd_check(cfg, args(**kw), proof)
    return rc, out.getvalue()


class SyntheticHall(unittest.TestCase):
    """records and check end to end on a synthetic hall (fix round 1, I2): the repo's SOG decoder on real SOG tiles, the
    bundle file, the hash-checked work artifacts and tables, and the proof's modules as stand-ins. Built once: records,
    then the proof's multiplier files from the package, then check (vectors to a scratch path)."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.hall = build_hall(cls.dir)
        cls.cfg, cls.proof = cls.hall.cfg, cls.hall.proof
        out = io.StringIO()
        with mock.patch.object(M, "_committed_tool", return_value=TOOL), host_env(), contextlib.redirect_stdout(out):
            cls.records_rc = M.cmd_records(cls.cfg, args(), cls.proof)
        cls.records_log = out.getvalue()
        cls.pkg = PK.read(cls.cfg.paths["out"])
        cls.model, cls.ranges = PK.model_of(cls.pkg), cls.pkg.ranges()
        cls.settings = M._check_settings(cls.model, cls.proof)
        cls.fin = M._finest_check_tables(cls.cfg, cls.pkg)
        cls.colour = cls.proof.store.LUT[np.asarray(cls.fin["rgb"])]
        write_mult_files(cls.cfg, cls.model, cls.settings, cls.fin, cls.colour, cls.ranges)
        cls.vectors = os.path.join(cls.dir, "vectors.json")
        cls.check_rc, cls.check_log = run_check(cls.cfg, cls.proof, vectors=cls.vectors)
        cls.checks = read_json(os.path.join(cls.cfg.paths["evidence"], "checks.json"))

    @classmethod
    def tearDownClass(cls):
        cls.fin = None
        gc.collect()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def rows(self, *kinds):
        return np.nonzero(np.isin(self.hall.kind, kinds))[0]

    def copy_package(self, name):
        folder = os.path.join(self.dir, name)
        shutil.copytree(self.cfg.paths["out"], folder)
        return folder

    def test_records_writes_every_served_tile_from_the_finest_light_and_its_transfer(self):
        """The finest tiles hold the finest light's records in each tile's own order; every coarser tile the records
        commit 5fe7637e's transfer gives (a k-d tree per call, the nearest and the blend as two transfers): the shared
        tree and the one query (M4) change no byte."""
        self.assertEqual(self.records_rc, 0, self.records_log)
        m = self.pkg.manifest
        self.assertEqual((m["tool"], m["createdAt"]), TOOL)
        self.assertEqual(m["evidence"]["build"], BUILD)                    # M8: the host that built it
        bundle = M._bundle_tiles(self.cfg)
        self.assertEqual([t["tile"] for t in m["tiles"]], list(FINEST) + sorted(COARSE))
        for t in m["tiles"]:
            self.assertEqual((t["tileSha256"], t["level"]), (bundle[t["tile"]]["sha256"], bundle[t["tile"]]["lodLevel"]))
        vols = M.windows_volumes(self.cfg)[0]
        light = M._finest_light(self.cfg, vols, self.proof)
        ranges = [codec.source_range(light["direct"][:, k]) for k in range(9)]
        self.assertEqual(self.ranges, ranges)
        tile_of = np.load(os.path.join(self.cfg.paths["work"], "npy", "splats_tile.npy"))
        for t, name in enumerate(FINEST):
            rows = np.nonzero(tile_of == t)[0]
            self.assertEqual(self.pkg.records(name).tobytes(),
                             codec.pack_records(light["direct"][rows], light["normals"][rows], light["flags"][rows], ranges))
        census, pos = M._census(self.cfg), np.asarray(self.fin["pos"], np.float64)
        for name in COARSE:
            P, _C, _sigma = M._sog_splats(census, self.proof, os.path.join(self.cfg.paths["splats"], name))
            near = RC.transfer(pos, np.arange(len(pos)), P, k=1)
            self.assertTrue(np.array_equal(near, self.hall.coarse[name]))     # each sits on its finest splat (json frame undone)
            self.assertLess(float(np.abs(P - pos[near]).max()), 1e-3)
            direct = RC.transfer(pos, light["direct"], P, k=8)
            c = light["cls"][near]
            reach = np.zeros(len(P), bool)
            reach[(c == 0) | (c == 1)] = windows.sun_reach(vols, P[(c == 0) | (c == 1)], 55.8593)
            flags = RC.flags_for(c, light["iso"][near], reach, light["chand"][near], (M.CENTRE_CHANDELIER,), light["cove"][near],
                                 light["fixture"][near], light["pane"][near])
            self.assertEqual(self.pkg.records(name).tobytes(), codec.pack_records(direct, light["normals"][near], flags, ranges))

    def test_the_finest_light_takes_the_fits_sources_by_name_and_the_proofs_masks(self):
        vols = M.windows_volumes(self.cfg)[0]
        light = M._finest_light(self.cfg, vols, self.proof)
        st = self.proof.store.Store()
        D = FakeFit04.direct(st, slice(0, st.N))
        np.testing.assert_array_equal(light["direct"], D[:, [0, 1, 2, 3, 4, 6, 7, 8, 9]])     # sun_cap left out by name
        cls, kind = light["flags"] & codec.CLASS_MASK, self.hall.kind
        geom = np.asarray(st.cls)
        self.assertEqual(set(cls[kind == "env"].tolist()), {codec.CLASS_HIDDEN})
        self.assertEqual(set(cls[kind == "cove"].tolist()), {codec.CLASS_COVE})
        fixtures = (geom == 0) & (light["chand"] >= 0) & ~light["cove"] & ~light["pane"]
        self.assertTrue(fixtures.any() and (cls[fixtures] == codec.CLASS_CH_FIXTURE).all())
        pane = light["pane"]
        self.assertTrue(pane.any() and (cls[pane] == codec.CLASS_HIDDEN).all() and (geom[pane] == 1).all())
        centre = (light["flags"] & codec.FLAG_CH_CENTRE) > 0
        self.assertTrue(centre.any() and (light["chand"][centre] == M.CENTRE_CHANDELIER).all())
        room = (geom == 0) | (geom == 1)
        np.testing.assert_array_equal(light["reach"][room], windows.sun_reach(vols, np.asarray(st.pos, np.float64)[room], 55.8593))
        self.assertFalse(light["reach"][~room].any())
        self.assertTrue(((light["flags"] & codec.FLAG_SUN) > 0).any())
        with mock.patch.object(windows, "CHUNK", 97):                       # chunked like the hall's 500,000: the same light
            chunked = M._finest_light(self.cfg, vols, self.proof)
        for key, value in light.items():
            self.assertTrue(np.array_equal(chunked[key], value), key)

    def test_the_package_holds_the_verified_inputs_and_every_input_tables_hash(self):
        """M1: evidence.artifacts names every work file records reads: the four artifacts, the promoted fit, the per-splat
        tables, the window cookie and the lamp/daylight ratio, each with its SHA-256."""
        m, work = self.pkg.manifest, self.cfg.paths["work"]
        names = [name for name, _evidence in M.ARTIFACTS] + ["fit.json", "fit_state.npz", "occ_cookie.npz", M.LAMP_RATIO] + \
            [f"npy/{t}.npy" for t in M.BUILD_TABLES]
        self.assertEqual(sorted(m["evidence"]["artifacts"]), sorted(names))
        for name in names:
            self.assertEqual(m["evidence"]["artifacts"][name], PK.sha256_file(os.path.join(work, *name.split("/"))), name)
        self.assertEqual(m["capture"], PK.capture_of(fit_json()))
        self.assertEqual(m["lamps"]["measuredRatio"], [1.623, 1.0, 0.467])
        self.assertEqual(m["model"]["tileToModel"], [float(v) for v in FakeCommon.T_EJ.ravel()])
        self.assertEqual(m["presetsFromProof"], json.loads(json.dumps({k: FakeRelight05.SCENARIOS[k] for k in M.PROOF_SETTINGS})))
        self.assertEqual(m["site"]["north"], [float(v) for v in windows.sun_vector(0, 0, 14.3)])
        self.assertEqual(m["evidence"]["skyBounce"]["K"], SKY_K)
        self.assertEqual((m["sky"]["k"], m["evidence"]["sunCheck"]["pass"], m["evidence"]["refit"]["pass"]), (SKY_K, True, True))

    def test_records_refuses_a_changed_input_and_writes_nothing(self):
        """M1: the lamp/daylight ratio must be byte for byte the proof's; a work table that changes during the build
        (here after the finest light is read) is refused at the second hashing, before the write."""
        out = os.path.join(self.dir, "refused")
        work = self.cfg.paths["work"]
        ratio, opa = os.path.join(work, M.LAMP_RATIO), os.path.join(work, "npy", "splats_opa.npy")
        kept = read_bytes(ratio)
        try:
            _put_json(ratio, {"lamp_over_daylight_rgb": [1.6, 1.0, 0.47]})
            with self.assertRaisesRegex(ValueError, "is not the proof's measurement"):
                M._build_package(self.cfg, out, *TOOL, BUILD, self.proof)
        finally:
            with open(ratio, "wb") as f:
                f.write(kept)
        self.assertFalse(os.path.exists(out))
        kept, real = read_bytes(opa), M._finest_light

        def then_change(*a, **kw):
            light = real(*a, **kw)
            changed = np.load(opa)
            changed[0] = np.float16(0.123)
            np.save(opa, changed)
            return light

        try:
            with mock.patch.object(M, "_finest_light", then_change), self.assertRaisesRegex(ValueError, "a work table changed"):
                M._build_package(self.cfg, out, *TOOL, BUILD, self.proof)
        finally:
            with open(opa, "wb") as f:
                f.write(kept)
        self.assertFalse(os.path.exists(out))

    def test_every_check_passes_and_writes_its_evidence_and_the_vectors(self):
        self.assertEqual(self.check_rc, 0, self.check_log[-4000:])
        for key in ("capturedIdentity", "proofRegression", "transfer", "determinism", "skyBounceCheck"):
            self.assertTrue(self.checks[key]["pass"], key)
        self.assertEqual((self.checks["checkedWith"], self.checks["host"]), (TOOL[0], "pc"))
        on_disk = read_json(os.path.join(self.cfg.paths["out"], "manifest.json"))
        self.assertEqual({k: on_disk["evidence"][k] for k in PK.CHECK_KEYS}, {k: self.checks[k] for k in PK.CHECK_KEYS})
        self.assertEqual(self.checks["determinism"]["differ"], [])
        self.assertEqual([t["tile"] for t in self.checks["transfer"]["tiles"]], sorted(COARSE))
        self.assertEqual(vector_issues(read_json(self.vectors), self.model), [])

    def test_captured_identity_holds_on_every_tile_the_dark_splats_included(self):
        """C1: an embrasure channel stored as a zero byte, and an interior splat with no captured light, are exactly
        neutral at the captured setting, on the finest tile that holds them and on the coarser tile over them."""
        tiles = {r["tile"]: r for r in self.checks["capturedIdentity"]["tiles"]}
        self.assertEqual(sorted(tiles), sorted(FINEST + COARSE))
        for name, r in tiles.items():
            self.assertEqual((r["share"], r["within"]), (1.0, r["splats"]), name)
            self.assertLessEqual(r["worstAbsLog2"], 1e-12, name)
        dark, pocket = self.rows("dark-embrasure"), self.rows("pocket")
        self.assertTrue((np.asarray(self.fin["rgb"])[dark] == 0).any(1).all())
        direct, _n, flags = PK.decode(self.fin["records"][pocket], self.ranges)
        self.assertTrue((direct == 0).all() and ((flags & codec.CLASS_MASK) == codec.CLASS_INTERIOR).all())
        both = np.concatenate([dark, pocket])
        Mv, _A = M._multipliers(self.model, self.settings["captured"], self.ranges, self.fin["records"][both], self.fin["pos"][both],
                                self.colour[both])
        np.testing.assert_allclose(Mv, 1.0, rtol=0, atol=1e-12)
        P, C, _sigma = M._sog_splats(M._census(self.cfg), self.proof, os.path.join(self.cfg.paths["splats"], "0_1.sog"))
        over = np.isin(self.hall.coarse["0_1.sog"], both)
        self.assertEqual(int(over.sum()), 18)
        Mv, _A = M._multipliers(self.model, self.settings["captured"], self.ranges, self.pkg.records("0_1.sog")[over], P[over], C[over])
        np.testing.assert_allclose(Mv, 1.0, rtol=0, atol=1e-12)

    def test_every_splat_reads_valid_probes_at_its_position_in_the_hall_box(self):
        """Fix round 2: the package carries the proof's lookup box (the hall's box less 2 cm, up to 9.8 m) and every
        splat, the finest and the coarser, the embrasure and the env ones beyond the window wall included, reads valid
        probes there; read on the grid alone (no box) those beyond the wall read none."""
        self.assertEqual(self.pkg.manifest["probes"]["box"], LOOKUP_BOX)
        census = M._census(self.cfg)
        points = [np.asarray(self.fin["pos"], np.float64)] + [
            M._sog_splats(census, self.proof, os.path.join(self.cfg.paths["splats"], name))[0] for name in COARSE]
        for P in points:
            _idx, w = reference.trilinear(self.model, P)
            np.testing.assert_allclose(w.sum(1), 1.0, rtol=0, atol=1e-12)
        P = points[0]
        beyond = P[:, 1] < 0
        self.assertGreater(int(beyond.sum()), 400)
        open_box = replace(self.model, probe_box_lo=np.full(3, -np.inf), probe_box_hi=np.full(3, np.inf))
        self.assertEqual(float(reference.trilinear(open_box, P[beyond])[1].sum()), 0.0)

    def test_the_regression_check_compares_through_the_clamp_and_only_records_the_original_proofs_file(self):
        """Check 2 against the proof's multiplier files: the proof's 60s and 0.004s are compared through the spec's clamp
        (the share it moved is recorded); the original proof's sunny file, one row short, is recorded as an error (M6)."""
        r = self.checks["proofRegression"]
        self.assertTrue(r["pass"])
        rec = self.fin["records"]
        interior = ((rec[:, 11] & codec.CLASS_MASK) == codec.CLASS_INTERIOR) & (np.asarray(self.fin["chand"]) < 0)
        self.assertEqual(r["interiorSplats"], int(interior.sum()))
        for name in M.PROOF_SETTINGS:
            self.assertLess(r[name]["medianAbsDlog2"], 2e-3, name)
            self.assertLess(r[name]["p95AbsDlog2"], 2e-3, name)
        self.assertGreater(r["sunny_morning"]["clampedShare"], 0.0)
        self.assertGreater(r["night"]["clampedShare"], 0.0)
        self.assertIn("not", r["sunny_morning"]["originalProof"]["error"])
        self.assertAlmostEqual(r["night"]["originalProof"]["medianAbsDlog2"], np.log2(1.05), delta=2e-3)
        self.assertLess(r["overcast_noon"]["originalProof"]["medianAbsDlog2"], 2e-3)
        short = os.path.join(self.cfg.paths["proofWork"], "mult", "sunny_morning.f16")
        with self.assertRaisesRegex(ValueError, "x 4 float16"):          # the gated comparison stops on such a file
            M._versus_proof(np.ones((1, 3)), short, np.array([0]), len(rec))

    def test_check_4_rebuilds_on_the_building_host_finds_a_changed_byte_and_refuses_another_host(self):
        """M8: the bytes are compared only on the host that built the package; elsewhere check 4 fails without a rebuild.
        On the building host a package that differs from its rebuild by one byte fails."""
        with host_env(pod="pod7"), mock.patch.object(M, "_build_package", side_effect=AssertionError("rebuilt")):
            got = M._check_determinism(self.cfg, self.pkg, self.proof)
        self.assertEqual({k: got[k] for k in ("pass", "builtOn", "checkedOn")}, {"pass": False, "builtOn": "pc", "checkedOn": "pod:pod7"})
        folder = self.copy_package("one-byte")
        tile = os.path.join(folder, *PK.tile_file("1_0_1.sog").split("/"))
        data = bytearray(read_bytes(tile))
        data[20] ^= 1                                                      # a byte of the compressed records
        with open(tile, "wb") as f:
            f.write(bytes(data))
        with host_env():
            got = M._check_determinism(self.cfg, PK.read(folder), self.proof)
        self.assertEqual((got["pass"], got["differ"], got["manifestIdentical"]), (False, [PK.tile_file("1_0_1.sog")], True))

    def test_check_stops_before_the_rebuild_when_a_population_marches_no_ray(self):
        """M5: no checks file, no manifest evidence, no vectors, and no check 4."""
        folder = self.copy_package("m5")
        before = read_bytes(os.path.join(folder, "manifest.json"))
        vectors = os.path.join(self.dir, "m5-vectors.json")
        none = {"splats": 500, "marched": 7, "wallFace": 1, "floor": {"points": 2242, "marched": 0, "wallFace": 0}}
        with mock.patch.object(M, "_wall_face", return_value=none), \
                mock.patch.object(M, "_check_determinism", side_effect=AssertionError("check 4 ran")):
            rc, out = run_check(self.cfg, self.proof, package=folder, vectors=vectors)
        self.assertEqual(rc, 1)
        self.assertIn("stopped before check 4's rebuild", out)
        self.assertFalse(os.path.exists(os.path.join(self.cfg.paths["evidence"], "checks-m5.json")))
        self.assertEqual(read_bytes(os.path.join(folder, "manifest.json")), before)
        self.assertFalse(os.path.exists(vectors))

    def test_the_vectors_are_written_only_when_every_check_passed(self):
        folder = self.copy_package("gate")
        vectors = os.path.join(self.dir, "gate-vectors.json")
        failing = ({"gate": M.IDENTITY_GATE, "tiles": [], "pass": False}, {"gate": M.TRANSFER_GATE, "tiles": [], "pass": True})
        with mock.patch.object(M, "_check_tiles", return_value=failing), \
                mock.patch.object(M, "_check_determinism", return_value={"pass": True}):
            rc, out = run_check(self.cfg, self.proof, package=folder, vectors=vectors)
        self.assertEqual(rc, 1)
        self.assertIn("vectors: not written (a check failed)", out)
        self.assertFalse(os.path.exists(vectors))
        written = read_json(os.path.join(self.cfg.paths["evidence"], "checks-gate.json"))
        self.assertFalse(written["capturedIdentity"]["pass"])
        self.assertFalse(read_json(os.path.join(folder, "manifest.json"))["evidence"]["capturedIdentity"]["pass"])

    def test_the_shared_tree_one_query_and_one_sky_fold_change_no_value(self):
        """M4: the sky bodies' bounce at the probes computed once per setting, the multipliers in chunks, the finest
        splats' k-d tree shared by every chunk and tile, and one neighbour query per chunk give bit for bit what a
        computation per call gives."""
        P, rec, C = np.asarray(self.fin["pos"], np.float64), self.fin["records"], self.colour
        direct, normals, flags = PK.decode(rec, self.ranges)
        for name in ("sunny_morning", "moon_test"):
            s = self.settings[name]
            each = reference.multiplier(direct, normals, flags, P, C, self.model, s)
            once = reference.multiplier(direct, normals, flags, P, C, self.model, s,
                                        sky_probes=reference.sky_cubes(self.model, reference.sky_bodies(s)))
            with mock.patch.object(M, "MULT_CHUNK", 97):
                chunked = M._multipliers(self.model, s, self.ranges, rec, P, C)
            for got in (once, chunked):
                self.assertTrue(np.array_equal(got[0], each[0]) and np.array_equal(got[1], each[1]), name)
        values = np.random.default_rng(1).normal(size=(len(P), 9))
        dst, _C, _s = M._sog_splats(M._census(self.cfg), self.proof, os.path.join(self.cfg.paths["splats"], "0_1.sog"))
        tree = M._finest_tree(P)
        with mock.patch.object(windows, "CHUNK", 101):
            blend = M._transferred(tree, P, values, dst, 8)
            nearest = M._transferred(tree, P, np.arange(len(P)), dst, 1)
            one_query = M._transferred_nearest(tree, values, dst, 8)
        self.assertTrue(np.array_equal(blend, RC.transfer(P, values, dst, k=8)))
        self.assertTrue(np.array_equal(nearest, RC.transfer(P, np.arange(len(P)), dst, k=1)))
        self.assertTrue(np.array_equal(one_query[0], blend) and np.array_equal(one_query[1], nearest))

    def test_the_sky_check_holds_the_package_to_the_bake_and_the_two_grids_agree(self):
        got = self.checks["skyBounceCheck"]
        self.assertEqual(got["arrays"], {"differ": [], "pass": True})
        for body in ("sun", "moon"):
            self.assertEqual((got[body]["directions"], got[body]["zeroDisagreements"]), (3, 0))
        self.assertLess(got["sun"]["p99AbsDlog2"], 1e-9)                    # inside the grids the two lookups are one function
        self.assertTrue(got["pass"])

    def test_the_wall_face_rate_pools_both_directions_for_each_population(self):
        rate = self.checks["wallFaceRate"]
        grid_points = (len(np.arange(FakeCommon.X0 + 0.05, FakeCommon.X1 - 0.05, 0.05))        # check-sun's 5 cm floor grid
                       * len(np.arange(FakeCommon.Y0 + 0.05, FakeCommon.Y1 - 0.05, 0.05)))
        self.assertEqual((rate["splats"], rate["floor"]["points"]), (500, grid_points))
        self.assertGreater(rate["marched"], 0)
        self.assertGreater(rate["floor"]["wallFace"], 0)                 # the glazing bar's row makes unlike cells
        self.assertLessEqual(rate["floor"]["wallFace"], rate["floor"]["marched"])

    def test_the_vectors_have_r1bs_shape_and_hold_the_reference_values(self):
        import base64
        v = read_json(self.vectors)
        self.assertEqual(vector_issues(v, self.model), [])
        self.assertEqual(v["probes"]["box"], self.pkg.manifest["probes"]["box"])
        self.assertEqual(v["windowRays"]["wallFaceRate"], self.checks["wallFaceRate"])
        flags = [bytes.fromhex(sp["record"])[11] for sp in v["splats"]]
        classes = {f & codec.CLASS_MASK for f in flags}
        self.assertTrue({0, 1, 2} <= classes and classes & {3, 4} and classes & {5, 6})
        self.assertTrue(any(f & codec.FLAG_SUN for f in flags))
        records = np.frombuffer(b"".join(bytes.fromhex(sp["record"]) for sp in v["splats"]), np.uint8).reshape(-1, 12)
        direct, normals, fl = PK.decode(records, self.ranges)
        P, C = np.array([sp["position"] for sp in v["splats"]]), np.array([sp["colour"] for sp in v["splats"]])
        for name in ("captured", "night", "sunny_morning", "moon_test"):
            M_, A = reference.multiplier(direct, normals, fl, P, C, self.model, self.settings[name])
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
        self.assertEqual(v["windowRays"]["suns"][0], [float(x) for x in self.settings["sunny_morning"].sun_dir])


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
    check(vec3(pr["box"]["lo"]) and vec3(pr["box"]["hi"]) and all(a < b for a, b in zip(pr["box"]["lo"], pr["box"]["hi"])), "probe box")
    check(set(v["presetsFromProof"]) == {"night", "sunny_morning", "overcast_noon"}, "presets")
    for name, st in v["settings"].items():
        check(len(st["weights"]) == 9 and set(st["lampLevels"]) == {"cove", "ch_end", "ch_centre", "dome"} and st["emitterBoost"] == 1
              and (st["sunDir"] is None or vec3(st["sunDir"])) and (st["moonDir"] is None or vec3(st["moonDir"])), f"setting {name}")
    check(set(v["settings"]) == {"captured", "night", "sunny_morning", "moon_test"}, "settings")
    check(len(v["splats"]) == 64 and all(len(sp["record"]) == 24 and vec3(sp["position"]) and vec3(sp["colour"])
                                         and set(sp["expected"]) == set(v["settings"]) for sp in v["splats"]), "splats")
    check(len(v["floorTexels"]) == 8 and all(len(t["direct"]) == 9 and min(t["direct"]) >= 0 for t in v["floorTexels"]), "floor texels")
    return issues


if __name__ == "__main__":
    unittest.main()

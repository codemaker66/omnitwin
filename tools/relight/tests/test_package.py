import gzip, io, json, math, os, shutil, tempfile, unittest
import numpy as np
from relight import codec, package as PK, windows
from relight import __main__ as M

SOURCES = list(codec.SOURCES)


def fit_json(gamma=0.999999999):
    """A fit.json as Task 4b's refit writes it (the fit's own base order, sun_cap sixth)."""
    colours = [[1.0, 1.0, 1.0]] * 6 + [[1.61, 1.0, 0.46], [1.62, 1.0, 0.47], [1.63, 1.0, 0.48], [1.27, 1.0, 0.53]]
    colours[0] = [1.0000001, 1.0, 1.0000002]
    return {"bases": ["W1", "W2", "W3", "W4", "W5", "sun_cap", "cove", "ch_end", "ch_centre", "dome"],
            "weights": [51.0, 30.0, 27.0, 34.0, 41.0, 1e-11, 0.81, 2.27, 4.17, 0.15], "colours": colours,
            "sky_weights_capture": [0.15000000596046448, 0.6600000262260437, 1.0, 1.2100000381469727], "gamma": gamma,
            "model": {"name": "refit"}}


def refit_json(copied=None, passed=True):
    return {"pass": passed, "copied": copied or {},
            "gates": {"accept": {"logPerBulb": -2.3, "lampRatio": 1.837, "residualRatio": 1.003, "dataCostProof": 1.0098,
                                 "dataCostRefit": 1.0132},
                      "photo-gate": {"pass": True, "views": {"mp43": {"rRefit": 0.881}}},
                      "sensitivity": {"pass": True, "preferredEnd": None,
                                      "runs": {"refit": {"wCrown": 0.387, "dataCost": 1.0132, "chCentreShare": {"floor": 0.116},
                                                         "photo": {}, "host": "pc"}}},
                      "range-balance": {"balance": -0.296, "limit": 0.563, "pass": True, "host": "pc"}},
            "bulbs": {"wCrown": 0.3871, "sha256": "e" * 64}}


def inputs(k=2, north=None):
    """Synthetic package inputs: five window volumes cut from one occupancy grid, a 3 x 2 x 2 probe grid of 0.5 m, a
    sky basis of k volumes on a 2 x 2 x 2 grid of 1 m from the same origin, a 3 x 4 floor whose cove is dark."""
    rng = np.random.default_rng(11)
    occ = np.zeros((100, 34, 100), np.float32)
    occ[10:20, 32, 10:20] = 0.5
    outlines = {f"W{i + 1}": (0.3 + 0.55 * i, 0.75 + 0.55 * i, 0.5, 0.3, 2.7, "rect") for i in range(5)}
    vols = windows.volumes_from_occupancy(occ, np.array([0.0, -1.0, 0.0]), 0.03, outlines, 0.0, x_bearing=14.3)
    cubes = rng.uniform(0.01, 1.0, (12, 9, 3, 6)).astype(np.float16)
    valid = np.ones(12, bool); valid[5] = False
    sky = {"basis": rng.normal(0, 0.3, (k, 8, 3, 6)).astype(np.float16), "valid": np.ones(8, bool),
           "coeffs": rng.uniform(0, 1, (3, 4, 5, k)).astype(np.float32), "patchRays": rng.uniform(0, 1, (32, 3)).astype(np.float32),
           "patchNormal": np.tile(np.array([0.0, -1.0, 0.0], np.float32), (2, 1)), "patchArea": np.full(2, 0.25, np.float32),
           "floorMean": rng.normal(0, 0.1, (k, 3)).astype(np.float32), "azimuth0": np.float64(24.0), "elevation0": np.float64(-2.0),
           "step": np.float64(4.0), "gridOrigin": np.zeros(3), "gridShape": np.array([2, 2, 2], np.int64), "gridSpacing": np.float64(1.0)}
    D = rng.uniform(0.001, 0.2, (3, 4, 9)).astype(np.float32)
    D[..., 5] = 0.0
    capture = PK.capture_of(fit_json())
    return PK.Inputs(
        room="grand-hall", tile_to_model=np.arange(16, dtype=np.float64).reshape(4, 4) / 7,
        site={"latitude": 55.8593, "longitude": -4.2491,
              "north": windows.sun_vector(0, 0, 14.3) if north is None else north, "east": windows.sun_vector(90, 0, 14.3),
              "up": [0.0, 0.0, 1.0]},
        capture=capture, lamps=PK.lamps_of(capture, [1.623, 1.0, 0.467], refit_json()), volumes=vols,
        horizons={n: np.full(360, 5.5, np.float32) for n in vols}, fresnel=np.linspace(0.5, 0.9, 101).astype(np.float32),
        probes={"cubes": cubes, "valid": valid, "origin": np.zeros(3), "shape": np.array([3, 2, 2], np.int64), "spacing": np.float64(0.5)},
        sky=sky, floor={"D": D, "texelToModel": np.eye(4), "texel": 0.05},
        presets={"night": {"sky": 0.0, "sun": None, "house": 1.0, "emit": "lit"},
                 "sunny_morning": {"sky": 0.7, "sky_T": 9000.0, "sun": [2026, 5, 31, 8, 0], "sun_ratio": 16.0, "sun_T": 4900.0,
                                   "house": 0.0, "emit": "unlit"},
                 "overcast_noon": {"sky": 1.2, "sky_T": 6500.0, "sun": None, "house": 0.0, "emit": "unlit"}},
        evidence={"sunCheck": {"pass": True}, "skyBounce": {"K": k}, "refit": {"pass": True}, "artifacts": {"windows.npz": "a" * 64}})


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def tiles():
    rng = np.random.default_rng(3)
    out = []
    for name, level, n in (("env.sog", None, 5), ("0_0.sog", 1, 7)):
        direct = np.exp2(rng.uniform(-10, 2, (n, 9)))
        normals = rng.normal(size=(n, 3))
        out.append(PK.Tile(name, name[0] * 64, level, codec.pack_records(direct, normals, rng.integers(0, 64, n), [(-22.0, 3.0)] * 9)))
    return out


def write(folder, k=2, **kw):
    return PK.write(folder, inputs(k, **kw), tiles(), [(-22.0, 3.0)] * 9, tool="c0ffee", created_at="2026-10-11T00:00:00+01:00",
                    build={"skins": None, "skinLight": None, "skinPackage": None})


def contract_issues(m):
    """The checks of R1b's RelightManifestSchema that Python can repeat (docs/engineering/relight-package.md)."""
    issues = []
    named = [m["probes"]["file"], m["probes"]["validFile"], *m["floor"]["files"], *(w["volume"] for w in m["windows"]),
             m["sky"]["basis"], m["sky"]["valid"], m["sky"]["table"]["file"], m["sky"]["patches"]["rays"],
             m["sky"]["patches"]["normals"], m["sky"]["patches"]["areas"]]
    listed = set(named) | {t["file"] for t in m["tiles"]}
    issues += [f"unnamed {p}" for p in m["files"] if p not in listed] + [f"unlisted {p}" for p in listed if p not in m["files"]]
    issues += [f"backslash {p}" for p in m["files"] if "\\" in p or p.startswith("/")]
    for t in m["tiles"]:
        f = m["files"].get(t["file"])
        if f is None or (f["sha256"], f["bytes"]) != (t["sha256"], t["bytes"]):
            issues.append(f"tile {t['tile']}")
    if [w["id"] for w in m["windows"]] != ["W1", "W2", "W3", "W4", "W5"]:
        issues.append("window order")
    for name, group in m["lamps"]["groups"].items():
        for c in range(3):
            q = m["capture"]["colours"][group["source"]][c] / m["capture"]["daylightColour"][c]
            if not abs(group["colour"][c] - q) <= 1e-9 * max(1, abs(q)):
                issues.append(f"lamp colour {name}")
    north, east, up = (np.asarray(m["site"][a]) for a in ("north", "east", "up"))
    if not (np.allclose([north @ north, east @ east, up @ up], 1, atol=1e-6) and abs(north @ east) <= 1e-6
            and np.allclose(np.cross(north, east), -up, atol=1e-6)):
        issues.append("site axes")
    t = m["sky"]["table"]
    if not all(isinstance(t[key], int) for key in ("azimuth0", "elevation0", "step")):
        issues.append("table frame not whole")
    if len(m["sky"]["floorMean"]) != m["sky"]["k"] or not 1 <= m["sky"]["k"] <= 192:
        issues.append("sky k")
    if m["capture"]["gamma"] != 1 or m["encoding"]["multiplier"] != {"lo": -4, "hi": 3}:
        issues.append("gamma or multiplier")
    return issues


class Writing(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def test_a_written_package_meets_the_contract_and_reads_back_as_its_inputs(self):
        folder = os.path.join(self.dir, "v1")
        m = write(folder, k=3)
        self.assertEqual(contract_issues(m), [])
        on_disk = read_json(os.path.join(folder, "manifest.json"))
        self.assertEqual(on_disk, json.loads(json.dumps(m)))
        self.assertEqual(sorted(os.path.relpath(os.path.join(r, f), folder).replace("\\", "/")
                                for r, _d, fs in os.walk(folder) for f in fs), sorted([*m["files"], "manifest.json"]))
        self.assertEqual((m["tool"], m["createdAt"], m["sky"]["k"], m["sky"]["table"]["size"]), ("c0ffee", "2026-10-11T00:00:00+01:00", 3, [4, 3]))
        self.assertEqual(m["evidence"]["build"], {"skins": None, "skinLight": None, "skinPackage": None})
        pkg, src = PK.read(folder), inputs(3)
        for t in tiles():
            self.assertEqual(pkg.records(t.name).tobytes(), t.records)
        model = PK.model_of(pkg)
        self.assertEqual(model.probes.tobytes(), src.probes["cubes"].tobytes())
        self.assertEqual(model.probe_valid.tolist(), src.probes["valid"].tolist())
        self.assertEqual((model.probe_shape, model.probe_spacing), ((3, 2, 2), 0.5))
        for name, vol in src.volumes.items():
            back = model.volumes[name]
            self.assertEqual(back.alpha.tobytes(), vol.alpha.tobytes())
            np.testing.assert_array_equal(windows.volume_arrays(back)[1], windows.volume_arrays(vol)[1])
            self.assertEqual(model.horizons[name].tobytes(), src.horizons[name].tobytes())
        self.assertEqual(model.fresnel.tobytes(), src.fresnel.tobytes())
        arrays = PK.sky_arrays(pkg)
        for name, dtype in PK.SKY_ARRAYS.items():
            self.assertEqual((arrays[name].dtype, arrays[name].shape, arrays[name].tobytes()),
                             (np.dtype(dtype), src.sky[name].shape, src.sky[name].tobytes()), name)
        self.assertEqual((model.sky.table.az0, model.sky.table.el0, model.sky.table.step, model.sky.shape), (24.0, -2.0, 4.0, (2, 2, 2)))
        np.testing.assert_array_equal(model.capture_w, [51.0, 30.0, 27.0, 34.0, 41.0, 0.81, 2.27, 4.17, 0.15])

    def test_the_floor_maps_hold_each_source_in_its_channel(self):
        from PIL import Image
        folder = os.path.join(self.dir, "v1")
        m = write(folder)
        D, ranges = inputs().floor["D"], m["encoding"]["floor"]
        maps = [np.asarray(Image.open(io.BytesIO(PK.read(folder).data(p)))) for p in m["floor"]["files"]]
        self.assertEqual([(a.shape, a.dtype) for a in maps], [((3, 4, 4), np.dtype(np.uint8))] * 3)
        for k in range(9):
            np.testing.assert_array_equal(maps[k // 4][..., k % 4], codec.encode_log(D[..., k], *ranges[k]), err_msg=SOURCES[k])
        self.assertEqual(int(maps[2][..., 1:].max()), 0)                  # light-2's last three channels are unused
        self.assertEqual(int(maps[1][..., 1].max()), 0)                   # the dark cove is code 0 everywhere
        self.assertEqual(m["floor"]["size"], [4, 3])

    def test_a_second_write_is_the_same_package_and_compare_finds_any_difference(self):
        a, b = os.path.join(self.dir, "a"), os.path.join(self.dir, "b")
        write(a), write(b)
        self.assertEqual(PK.compare(a, b), {"files": 18, "differ": [], "manifestIdentical": True, "pass": True})
        results = {key: {"pass": True, "n": i} for i, key in enumerate(PK.CHECK_KEYS)}
        PK.write_check_evidence(a, results)                              # check's own keys are left out of the comparison
        self.assertTrue(PK.compare(a, b)["pass"])
        with open(os.path.join(b, "windows", "W2.alpha.gz"), "ab") as f:
            f.write(b"x")
        self.assertEqual(PK.compare(a, b)["differ"], ["windows/W2.alpha.gz"])
        write(b)
        manifest = read_json(os.path.join(b, "manifest.json"))
        manifest["createdAt"] = "2026-10-12T00:00:00+01:00"
        with open(os.path.join(b, "manifest.json"), "wb") as f:
            f.write(PK.dump_manifest(manifest))
        self.assertEqual(PK.compare(a, b)["manifestIdentical"], False)

    def test_check_replaces_its_six_evidence_keys_and_nothing_else(self):
        folder = os.path.join(self.dir, "v1")
        write(folder)
        before = read_json(os.path.join(folder, "manifest.json"))
        for run in (1, 2):
            data = PK.write_check_evidence(folder, {**{key: {"run": run} for key in PK.CHECK_KEYS}, "checkedWith": "not in the manifest"})
            after = json.loads(data)
            self.assertEqual({key: v for key, v in after.items() if key != "evidence"}, {key: v for key, v in before.items() if key != "evidence"})
            self.assertEqual(after["evidence"], {**before["evidence"], **{key: {"run": run} for key in PK.CHECK_KEYS}})
            self.assertEqual(read_bytes(os.path.join(folder, "manifest.json")), data)
        self.assertEqual(sorted(os.listdir(folder)), ["floor", "manifest.json", "probe-valid.bin.gz", "probes.bin.gz", "sky", "tiles", "windows"])

    def test_a_write_replaces_a_package_whole_and_refuses_any_other_folder(self):
        folder = os.path.join(self.dir, "v1")
        write(folder)
        stale = os.path.join(folder, "tiles", "old.relight.gz")
        with open(stale, "wb") as f:
            f.write(b"stale")
        write(folder)
        self.assertFalse(os.path.exists(stale))
        other = os.path.join(self.dir, "splats")
        os.makedirs(other)
        with open(os.path.join(other, "0_0.sog"), "wb") as f:
            f.write(b"tile")
        with self.assertRaisesRegex(ValueError, "no relight package"):
            write(other)
        self.assertEqual(os.listdir(other), ["0_0.sog"])

    def test_the_manifest_refuses_what_r1b_would(self):
        with self.assertRaisesRegex(ValueError, "site.north"):
            write(os.path.join(self.dir, "x"), north=np.array([1.0, 0.0, 0.0]))
        bad = inputs()
        bad.sky["basis"] = np.zeros((193, 8, 3, 6), np.float16)
        bad.sky["coeffs"] = np.zeros((3, 4, 5, 193), np.float32)
        bad.sky["floorMean"] = np.zeros((193, 3), np.float32)
        with self.assertRaisesRegex(ValueError, "outside 1..192"):
            PK.write(os.path.join(self.dir, "y"), bad, tiles(), [(-22.0, 3.0)] * 9, tool="t", created_at="c", build={})
        bad = inputs()
        bad.capture["weights"][0] = float("nan")
        with self.assertRaises(ValueError):                                   # allow_nan=False: a NaN fails the build
            PK.write(os.path.join(self.dir, "z"), bad, tiles(), [(-22.0, 3.0)] * 9, tool="t", created_at="c", build={})
        self.assertFalse(os.path.exists(os.path.join(self.dir, "z")))
        self.assertEqual(PK.K_MAX, M.SUN_KMAX)

    def test_the_package_paths_are_posix_and_its_gzip_deterministic(self):
        self.assertEqual(PK.tile_file("0_5_0_1.sog"), "tiles/0_5_0_1.relight.gz")
        self.assertEqual(PK.window_file("W3"), "windows/W3.alpha.gz")
        self.assertEqual(PK.gz(b"abc"), PK.gz(b"abc"))
        self.assertEqual(gzip.decompress(PK.gz(b"abc")), b"abc")
        self.assertEqual(PK.gz(b"abc")[4:8], b"\0\0\0\0")                    # mtime 0


class Capture(unittest.TestCase):
    def test_the_capture_is_picked_by_name_with_gamma_written_as_one(self):
        cap = PK.capture_of(fit_json())
        self.assertEqual(cap["weights"], [51.0, 30.0, 27.0, 34.0, 41.0, 0.81, 2.27, 4.17, 0.15])   # sun_cap left out by name
        self.assertEqual(cap["daylightColour"], [1.0000001, 1.0, 1.0000002])
        self.assertEqual((cap["gamma"], len(cap["colours"])), (1, 9))
        shuffled = fit_json()
        order = [9, 0, 5, 1, 2, 3, 4, 6, 7, 8]
        for key in ("bases", "weights", "colours"):
            shuffled[key] = [shuffled[key][i] for i in order]
        self.assertEqual(PK.capture_of(shuffled), cap)
        with self.assertRaisesRegex(ValueError, "gamma"):
            PK.capture_of(fit_json(gamma=0.99))

    def test_each_lamp_groups_colour_is_its_capture_colour_over_daylight(self):
        cap = PK.capture_of(fit_json())
        lamps = PK.lamps_of(cap, [1.623, 1.0, 0.467], refit_json())
        for name, source, kind in PK.LAMPS:
            g = lamps["groups"][name]
            self.assertEqual((g["source"], g["type"]), (source, kind))
            self.assertEqual(g["colour"], [cap["colours"][source][c] / cap["daylightColour"][c] for c in range(3)])
        self.assertEqual(lamps["refit"], {"perBulbIntensity": math.exp(-2.3), "lampRatio": 1.837, "wCrown": 0.3871,
                                          "bulbTableSha256": "e" * 64})


class Verified(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.work, self.ev = os.path.join(self.dir, "work"), os.path.join(self.dir, "evidence")
        os.makedirs(self.work), os.makedirs(self.ev)

    def put(self, folder, name, data):
        path = os.path.join(folder, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb" if isinstance(data, bytes) else "w") as f:
            f.write(data if isinstance(data, bytes) else json.dumps(data))
        return path

    def test_an_artifact_is_packaged_only_when_its_passing_evidence_names_its_bytes(self):
        path = self.put(self.work, "sun-bounce.npz", b"basis")
        record = M._artifact(path)
        self.put(self.ev, "e.json", {"pass": True, "artifact": record})
        self.assertEqual(PK.verified(self.work, self.ev, "sun-bounce.npz", "e.json"), (path, record["sha256"]))
        for evidence, message in (({"pass": False, "artifact": record}, "no passing"), ({"pass": True}, "no passing"),
                                  ({"pass": True, "artifact": {**record, "sha256": "0" * 64}}, "is not the artifact"),
                                  ({"pass": True, "artifact": {**record, "bytes": 6}}, "is not the artifact")):
            self.put(self.ev, "e.json", evidence)
            with self.assertRaisesRegex(ValueError, message):
                PK.verified(self.work, self.ev, "sun-bounce.npz", "e.json")

    def test_the_fit_is_the_promoted_refit(self):
        fit = self.put(self.work, "fit.json", fit_json())
        state = self.put(self.work, "fit_state.npz", b"state")
        copied = {"fit.json": PK.sha256_file(fit), "fit_state.npz": PK.sha256_file(state)}
        self.put(self.ev, "refit.json", refit_json(copied))
        got, hashes, _refit = PK.verified_fit(self.work, self.ev)
        self.assertEqual((got["model"]["name"], hashes), ("refit", copied))
        for refit, message in ((refit_json(copied, passed=False), "no passing promote"), (refit_json({}), "no passing promote"),
                               (refit_json({**copied, "fit_state.npz": "1" * 64}), "promote copied")):
            self.put(self.ev, "refit.json", refit)
            with self.assertRaisesRegex(ValueError, message):
                PK.verified_fit(self.work, self.ev)
        proof = self.put(self.work, "fit.json", {**fit_json(), "model": {"name": "proof"}})
        self.put(self.ev, "refit.json", refit_json({**copied, "fit.json": PK.sha256_file(proof)}))
        with self.assertRaisesRegex(ValueError, "not the refit"):
            PK.verified_fit(self.work, self.ev)


if __name__ == "__main__":
    unittest.main()

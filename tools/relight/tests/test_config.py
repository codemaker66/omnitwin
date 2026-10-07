import json, os, tempfile, unittest
from relight import config

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config(unittest.TestCase):
    def write(self, data):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, f); f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def test_loads_the_grand_hall_config(self):
        cfg = config.load(os.path.join(HERE, "config", "grand-hall.json"))
        self.assertEqual(cfg.room["slug"], "grand-hall")
        self.assertEqual(len(cfg.room["windows"]), 5)
        self.assertTrue(cfg.paths["work"].startswith("D:/"))

    def test_refuses_a_missing_key(self):
        with self.assertRaises(ValueError):
            config.load(self.write({"schema": "venviewer.relight-config.v1", "paths": {}, "room": {}}))

    def test_refuses_outputs_on_c(self):
        with open(os.path.join(HERE, "config", "grand-hall.json")) as f:
            data = json.load(f)
        data["paths"]["work"] = "C:/tmp/relight"
        with self.assertRaises(ValueError):
            config.load(self.write(data))


class ProofCli(unittest.TestCase):
    """The CLI around the moved proof scripts: step order, the table split, the lamp colour, sys.argv."""

    def setUp(self):
        from relight import __main__ as cli
        import numpy as np
        self.cli, self.np = cli, np

    def test_steps_run_in_the_proofs_data_order(self):
        s = list(self.cli.PROOF_STEPS)
        self.assertLess(s.index("bases"), s.index("tables"))
        self.assertLess(s.index("tables"), s.index("fresnel"))       # store.Store maps the tables
        self.assertLess(s.index("fresnel"), s.index("fit"))
        self.assertLess(s.index("lamp-colour"), s.index("fit"))
        for later in ("embrasure-room", "embrasure-back"):             # both read the fit's fit_state.npz
            self.assertLess(s.index("fit"), s.index(later))

    def test_no_proof_step_takes_the_gpu_lock(self):
        # the proof runs torch on the CPU only; holding the shared lock would block GPU work for nothing
        self.assertEqual([k for k, (_, gpu) in self.cli.PROOF_STEPS.items() if gpu], [])

    def test_split_tables_writes_every_per_splat_array_and_a_nan_capture_sun(self):
        np, work = self.np, tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, work)
        n = 7
        np.savez(os.path.join(work, "splats.npz"), pos=np.zeros((n, 3), np.float32), counts=np.array([3, 4]))
        np.savez(os.path.join(work, "geom.npz"), chand_id=np.full(n, -1, np.int8), occ=np.zeros((2, 2, 2), np.float16),
                 occ_res=np.array(0.03))
        np.savez(os.path.join(work, "bases.npz"), E_win=np.ones((n, 20), np.float16), ring=np.zeros((14, 3)))
        self.cli.split_tables(config.Config(paths={"work": work}, room={}))
        npy = os.path.join(work, "npy")
        self.assertEqual(sorted(os.listdir(npy)), ["bases_E_win.npy", "geom_chand_id.npy", "splats_pos.npy", "sun_cap_E.npy"])
        self.assertEqual(np.load(os.path.join(npy, "bases_E_win.npy")).dtype, np.float16)
        self.assertEqual(np.load(os.path.join(npy, "geom_chand_id.npy")).dtype, np.int8)
        sun = np.load(os.path.join(npy, "sun_cap_E.npy"))
        self.assertEqual((sun.shape, sun.dtype), ((n,), np.float32))
        self.assertTrue(np.isnan(sun).all())

    def test_lamp_colour_is_the_proofs_measurement_unchanged(self):
        proof, work = tempfile.mkdtemp(), tempfile.mkdtemp()
        for d in (proof, work):
            self.addCleanup(__import__("shutil").rmtree, d)
        src = os.path.join(proof, "lamp_daylight_ratio.json")
        with open(src, "w", encoding="utf-8") as f:
            json.dump({"lamp_over_daylight_rgb": [1.6, 1.0, 0.5], "source": "test"}, f)
        cfg = config.Config(paths={"proofWork": proof, "work": work}, room={})
        self.cli.stage_lamp_colour(cfg)
        with open(src, "rb") as a, open(os.path.join(work, "lamp_daylight_ratio.json"), "rb") as b:
            self.assertEqual(a.read(), b.read())
        with open(src, "w", encoding="utf-8") as f:
            json.dump({"lamp_over_daylight_rgb": [1.6, 1.0]}, f)
        with self.assertRaises(ValueError):
            self.cli.stage_lamp_colour(cfg)
        os.remove(src)
        with self.assertRaises(FileNotFoundError):
            self.cli.stage_lamp_colour(cfg)

    def test_a_proof_script_sees_only_its_own_path_in_argv(self):
        import sys
        from unittest import mock
        proof = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, proof)
        script = os.path.join(proof, "probe.py")
        with open(script, "w", encoding="utf-8") as f:
            f.write("import json, sys\nwith open(sys.argv[0] + '.argv', 'w') as f:\n    json.dump(sys.argv, f)\n")
        argv, path, cwd = sys.argv, list(sys.path), os.getcwd()
        with mock.patch.object(self.cli, "PROOF", proof), \
                mock.patch.dict(self.cli.PROOF_STEPS, {"probe": ("probe.py", False)}), mock.patch.dict(os.environ):
            self.cli.run_proof("probe", os.path.join(HERE, "config", "grand-hall.json"))
        sys.path[:] = path
        with open(script + ".argv", encoding="utf-8") as f:
            self.assertEqual(json.load(f), [script])
        self.assertIs(sys.argv, argv)
        self.assertEqual(os.getcwd(), cwd)


class GatedArtifacts(unittest.TestCase):
    """A command writes its artifact into work/ only after its checks pass; a failing run leaves its arrays under the
    evidence directory, never in work/."""

    def setUp(self):
        from relight import __main__ as cli
        import numpy as np
        self.cli, self.np = cli, np
        root = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, root)
        self.work, self.evidence = os.path.join(root, "work"), os.path.join(root, "evidence")
        os.makedirs(self.work), os.makedirs(self.evidence)
        self.path = os.path.join(self.work, "thing.npz")

    def arrays(self, v):
        return {"a": self.np.full(3, v, self.np.float32), "b": self.np.arange(4)}

    def save(self, passed, v):
        return self.cli._save_npz_if(self.path, passed, self.evidence, **self.arrays(v))

    def test_a_passing_run_writes_the_artifact_and_nothing_else(self):
        self.assertEqual(self.save(True, 1.0), self.path)
        with self.np.load(self.path) as z:
            self.assertEqual((sorted(z.files), z["a"].dtype.name, z["a"].tolist()), (["a", "b"], "float32", [1.0] * 3))
        self.assertEqual(os.listdir(self.work), ["thing.npz"])
        self.assertEqual(os.listdir(self.evidence), [])

    def test_a_failing_run_leaves_no_artifact_in_work_and_keeps_its_arrays_in_the_evidence(self):
        kept = self.save(False, 2.0)
        self.assertEqual(os.listdir(self.work), [])
        self.assertEqual(kept, os.path.join(self.evidence, "thing-FAILED.npz"))
        with self.np.load(kept) as z:
            self.assertEqual(z["a"].tolist(), [2.0] * 3)

    def test_a_failing_run_leaves_the_previous_good_artifact_untouched(self):
        self.save(True, 1.0)
        with open(self.path, "rb") as f:
            before = f.read()
        self.save(False, 9.0)
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(os.listdir(self.work), ["thing.npz"])

    def test_a_passing_run_replaces_the_previous_artifact_without_leaving_a_partial_file(self):
        self.save(True, 1.0)
        self.save(True, 5.0)
        with self.np.load(self.path) as z:
            self.assertEqual(z["a"].tolist(), [5.0] * 3)
        self.assertEqual(os.listdir(self.work), ["thing.npz"])

    def test_a_write_that_fails_half_way_does_not_leave_the_target_or_a_partial_file(self):
        self.save(True, 1.0)
        with open(self.path, "rb") as f:
            before = f.read()
        from unittest import mock

        def disk_full(f, **arrays):
            f.write(b"partial")
            raise OSError("disk full")
        with mock.patch.object(self.np, "savez_compressed", side_effect=disk_full), self.assertRaises(OSError):
            self.cli._save_npz_if(self.path, True, self.evidence, a=self.np.zeros(2))
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(os.listdir(self.work), ["thing.npz"])

    def test_non_finite_numbers_in_the_evidence_become_null(self):
        np = self.np
        out = self.cli._finite({"a": float("inf"), "b": [float("nan"), 1.5, {"c": -np.inf}], "d": np.float32("nan"),
                                "e": np.float64(2.5), "f": np.int64(3), "g": True, "h": "x", "i": None, "j": np.bool_(False)})
        self.assertEqual(out, {"a": None, "b": [None, 1.5, {"c": None}], "d": None, "e": 2.5, "f": 3, "g": True, "h": "x",
                               "i": None, "j": False})
        json.dumps(out, allow_nan=False)                                    # serialises: nothing non-finite is left
        self.assertIsInstance(out["e"], float)
        self.assertIsInstance(out["f"], int)

    def test_a_gate_result_with_an_infinite_error_serialises(self):
        from relight import sunbounce as SB
        result = SB.gate(self.np.array([self.np.inf, 0.1, 0.1]), self.np.array([1.0, 1.0, 1.0]), self.np.full(10, self.np.inf))
        self.assertFalse(result["pass"])
        with self.assertRaises(ValueError):
            json.dumps(result, allow_nan=False)
        json.dumps(self.cli._finite(result), allow_nan=False)

    def test_every_sun_bounce_draw_has_its_own_seed(self):
        c = self.cli
        seeds = [c.SUN_HELD_SEED, c.MOON_HELD_SEED, c.SUN_CHECK_SEED, c.MOON_CHECK_SEED, c.SUN_STRICT_SEED, c.MOON_STRICT_SEED, c.SPLAT_SEED]
        self.assertEqual(len(set(seeds)), len(seeds))


if __name__ == "__main__":
    unittest.main()

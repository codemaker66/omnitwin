import json, math, os, tempfile, unittest
import numpy as np
from relight import housefit as HF

CENTRES = np.array([[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.9, -5.0, 4.82], [15.5, -7.68, 4.28], [15.47, -2.33, 4.3]])
T_JE = np.array([[0.0, -1.0, 0.0, 0.5], [1.0, 0.0, 0.0, 0.25], [0.0, 0.0, 1.0, -2.0], [0.0, 0.0, 0.0, 1.0]])
LAMP_RATIO = np.array([1.623, 1.0, 0.467])
K = HF.FitConstants(groups=6, paint=5, paint_albedo=0.60, huber=0.25, gamma_free=False)
EXCLUDE = "exclude: by eye a brass highlight or glare that triangulated, not a lamp"
LOW = "low: unresolved by eye"
MEDIUM = "medium: a lamp seen by eye, partly hidden, dim or small (the centre chandelier's crown tubes)"
CANDLE_AREAS = (3000.0, 3400.0, 2600.0, 3800.0)     # the centre's four candles in face s09_f2: median 3,200 mm2


def bulb(cid, n, confidence="high", offset=(0.3, 0.0, 0.0)):
    p = CENTRES[cid] + np.asarray(offset, np.float64)
    return {"id": f"c{cid}_b{n:02d}", "chandelier": cid, "position_e57": p.tolist(), "confidence": confidence, "faces": []}


def full_table():
    """Two candles on each end chandelier and four on the centre one, symmetric about each centre, the centre's in one
    face; two crown tubes 0.5 m above the centre's candles (1,280 and 1,600 mm2 in that face, and the second in a face
    without candles); a "medium" lamp on chandelier 1 (a candle: only the centre chandelier has crown tubes); a brass glint
    on chandelier 0 and an unresolved entry on chandelier 3, neither a lamp."""
    out = []
    for c in range(5):
        lamps = 4 if c == 2 else 2
        for n in range(lamps):
            a = 2 * math.pi * n / lamps
            out.append(bulb(c, n, offset=(0.3 * math.cos(a), 0.3 * math.sin(a), 0.1)))
            if c == 2:
                out[-1]["faces"] = [{"face": "s09_f2", "blob_area_mm2": CANDLE_AREAS[n]}]
    out.append(dict(bulb(2, 5, MEDIUM, offset=(0.2, 0.0, 0.6)), faces=[{"face": "s09_f2", "blob_area_mm2": 1280.0}]))
    out.append(dict(bulb(2, 6, MEDIUM, offset=(-0.2, 0.0, 0.6)),
                    faces=[{"face": "s09_f2", "blob_area_mm2": 1600.0}, {"face": "s10_f0", "blob_area_mm2": 900.0}]))
    out.append(bulb(1, 5, MEDIUM, offset=(0.0, 0.3, 0.0)))
    out.append(bulb(0, 7, EXCLUDE))
    out.append(bulb(3, 8, LOW, offset=(0.0, 0.0, 0.2)))
    return {"schema": HF.BULBS_SCHEMA, "frames": {"T_json_from_e57": T_JE.tolist()}, "bulbs": out}


def entry(table, bid):
    return next(b for b in table["bulbs"] if b["id"] == bid)


def write(folder, data):
    path = os.path.join(folder, "bulbs.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return path


class Bulbs(unittest.TestCase):
    def test_the_lamps_are_the_high_and_medium_entries_and_the_crown_tubes_a_kind_of_their_own(self):
        with tempfile.TemporaryDirectory() as d:
            got = HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)
        self.assertEqual(got["counts"], {0: 2, 1: 3, 2: 6, 3: 2, 4: 2})
        self.assertEqual(got["candles"], {0: 2, 1: 3, 2: 4, 3: 2, 4: 2})
        self.assertEqual(got["crowns"], ["c2_b05", "c2_b06"])
        self.assertEqual([got["kinds"][b] for b in ("c1_b05", "c2_b00", "c2_b05")], ["candle", "candle", "crown"])
        self.assertEqual(got["notLamps"], ["c0_b07", "c3_b08"])        # the brass glint and the unresolved entry
        self.assertEqual(sorted(list(got["kinds"]) + got["notLamps"]), got["ids"])
        self.assertEqual(len(got["ids"]), 17)
        self.assertEqual(len(got["sha256"]), 64)
        counts = HF.lamp_counts(got, 0.45)
        self.assertEqual((counts.end_mean, counts.centre_candles, counts.crowns, counts.w_crown), (2.25, 4.0, 2.0, 0.45))
        self.assertAlmostEqual(counts.centre, 4.9, places=14)            # 4 candles + 0.45 x 2 crown tubes
        self.assertAlmostEqual(counts.ratio, 4.9 / 2.25, places=14)
        for w in (-0.1, 1.1, math.nan):
            with self.assertRaises(ValueError):
                HF.lamp_counts(got, w)

    def test_a_table_that_misses_a_chandelier_misplaces_one_or_is_malformed_is_refused(self):
        good = full_table()
        far = full_table(); far["bulbs"][0]["position_e57"] = (CENTRES[0] + [2.0, 0.0, 0.0]).tolist()
        shifted = full_table(); shifted["frames"]["T_json_from_e57"][0][3] += 0.01
        low_crown = full_table(); entry(low_crown, "c2_b05")["position_e57"] = (CENTRES[2] + [0.2, 0.0, 0.05]).tolist()
        unmeasured = full_table()
        for bid in ("c2_b05", "c2_b06"):
            entry(unmeasured, bid)["faces"] = [{"face": "s10_f0", "blob_area_mm2": 900.0}]
        bad = [dict(good, bulbs=[b for b in good["bulbs"] if b["chandelier"] != 4]), far, shifted,
               low_crown, unmeasured, dict(good, bulbs=[b for b in good["bulbs"] if b["id"] not in ("c2_b05", "c2_b06")]),
               dict(good, schema="venviewer.frontier.bulbs.v0"), dict(good, bulbs=good["bulbs"] + [good["bulbs"][0]]),
               dict(good, bulbs=[dict(good["bulbs"][0], confidence="maybe")] + good["bulbs"][1:]),
               dict(good, bulbs=[dict(good["bulbs"][0], id="c1_b00")] + good["bulbs"][1:])]
        with tempfile.TemporaryDirectory() as d:
            for case in bad:
                with self.assertRaises(ValueError):
                    HF.read_bulbs(write(d, case), CENTRES, T_JE)

    def test_the_clipped_cores_compare_the_centre_with_the_ends_face_by_face(self):
        table = full_table()
        table["bulbs"][0]["faces"] = [{"face": "s01_f0", "blob_area_mm2": 1000.0}, {"face": "s02_f0", "blob_area_mm2": 900.0}]
        table["bulbs"][4]["faces"] = [{"face": "s01_f0", "blob_area_mm2": 2000.0}, {"face": "s03_f0", "blob_area_mm2": 5.0}]
        entry(table, "c2_b05")["faces"].append({"face": "s01_f0", "blob_area_mm2": 9000.0})   # a crown tube: left out
        got = HF.blob_balance(table["bulbs"])
        self.assertEqual(got["faces"], 1)                                  # only s01_f0 frames both
        self.assertAlmostEqual(got["medianLog2CentreOverEnd"], 1.0, places=12)

    def test_the_crown_tubes_weigh_their_clipped_cores_against_the_centres_candles_face_by_face(self):
        got = HF.crown_weight(full_table()["bulbs"])
        self.assertEqual((got["pairs"], got["faces"]), (2, 1))           # s10_f0 frames no candle
        self.assertAlmostEqual(got["wCrown"], 0.45, places=12)           # 1,280 and 1,600 over the candles' median 3,200
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)["crownWeight"], got)

    def test_the_centres_candles_are_judged_against_the_ends_with_the_range_taken_out(self):
        def ranged(centre_shift):
            """Six faces, each holding two candles of every chandelier whose clipped area falls as 1 / range (log2 area =
            the face's intercept - log2 range + the chandelier's own shift); the centre's candles 3 m farther away."""
            out = []
            for f in range(6):
                for c, shift in ((0, 0.04), (1, -0.04), (3, 0.02), (4, -0.02), (2, centre_shift)):
                    for n in range(2):
                        d = 4.0 + f + 1.5 * n + (3.0 if c == 2 else 0.25 * c)
                        out.append({"id": f"c{c}_b{10 * f + n:02d}", "chandelier": c, "confidence": "high",
                                    "faces": [{"face": f"s{f:02d}_f0", "distance_m": d,
                                               "blob_area_mm2": 2 ** (11.0 + 0.1 * f - math.log2(d) + shift)}]})
            return out
        self.assertLess(HF.blob_balance(ranged(0.0))["medianLog2CentreOverEnd"], -0.4)   # range alone reads as a dimmer centre
        same = HF.range_balance(ranged(0.0))
        self.assertAlmostEqual(same["slope"], -1.0, delta=0.05)
        self.assertLess(abs(same["balance"]), 0.02)
        self.assertEqual((same["faces"], same["centreUsed"], sorted(same["endSpreads"])), (6, 12, ["0", "1", "3", "4"]))
        self.assertAlmostEqual(same["limit"], 2 * max(abs(v) for v in same["endSpreads"].values()), places=15)
        self.assertTrue(same["pass"])
        dimmer = HF.range_balance(ranged(-1.0))                            # the centre's candles truly half as bright
        self.assertAlmostEqual(dimmer["balance"], -1.0, delta=0.02)
        self.assertEqual((dimmer["pass"], dimmer["endSpreads"]), (False, same["endSpreads"]))
        unjudged = HF.range_balance([b for b in ranged(0.0) if b["chandelier"] != 2])
        self.assertEqual((unjudged["pass"], unjudged["balance"]), (False, None))   # nothing to judge fails, never passes


class Priors(unittest.TestCase):
    def test_the_dome_prior_is_its_emitters_measured_shift_from_the_chandeliers(self):
        colours = {"groups": {"chandelier_emitters_all": {"median_log2_RG_BG": [0.754, -1.169]},
                              "dome_ring_emitters": {"median_log2_RG_BG": [0.404, -0.996]}}}
        p = HF.colour_priors(colours)
        self.assertEqual((p["chandeliers"], p["cove"]), ((0.0, 0.0), (0.0, 0.0)))
        np.testing.assert_allclose(p["dome"], [math.log(2) * -0.350, math.log(2) * 0.173], atol=1e-12)


class Models(unittest.TestCase):
    def test_the_proof_model_is_04_fits_own_parameters(self):
        m = HF.ProofModel(LAMP_RATIO)
        n = HF.n_params(m, K)
        x = np.linspace(-1.0, 1.0, n)
        w, cols, mu, gam = HF.unpack(m, x, K)
        np.testing.assert_allclose(w, np.exp(x[:10]))
        cday = np.exp([x[10], 0.0, x[11]])
        np.testing.assert_allclose(cols[:6], np.tile(cday, (6, 1)))
        np.testing.assert_allclose(cols[6:], np.tile(cday * LAMP_RATIO, (4, 1)))
        self.assertAlmostEqual(float(mu[5, 1]), math.log(0.60), places=15)
        self.assertAlmostEqual(gam, math.exp(x[-1]), places=15)
        self.assertEqual(n, 34)
        lo, hi = HF.bounds_of(m, n, K)
        self.assertEqual((lo[0], hi[9], lo[12], hi[15], lo[-1], hi[-1]), (-25.0, 12.0, -1e-9, 1e-9, -1e-9, 1e-9))
        self.assertEqual(len(m.priors(x)), 11)

    def test_the_refit_shares_one_per_bulb_intensity_and_colours_each_lamp_group(self):
        counts = HF.LampCounts(end_mean=23.25, centre_candles=40.0, crowns=7.0, w_crown=0.4)
        m = HF.RefitModel(LAMP_RATIO, counts, {"chandeliers": (0.0, 0.0), "dome": (-0.24, 0.12), "cove": (0.0, 0.0)})
        n = HF.n_params(m, K)
        x = np.zeros(n); x[8] = math.log(0.05); x[13] = 0.1; x[16] = -0.2
        w, cols, _mu, _gam = HF.unpack(m, x, K)
        self.assertAlmostEqual(w[7], 0.05 * 23.25, places=12)
        self.assertAlmostEqual(w[8], 0.05 * 42.8, places=12)             # 40 candles + 0.4 x 7 crown tubes
        self.assertAlmostEqual(w[8] / w[7], counts.ratio, places=12)
        np.testing.assert_allclose(cols[6], LAMP_RATIO)
        np.testing.assert_allclose(cols[7], LAMP_RATIO * np.exp([0.1, 0.0, 0.0]))
        np.testing.assert_allclose(cols[8], cols[7])
        np.testing.assert_allclose(cols[9], LAMP_RATIO * np.exp([0.0, 0.0, -0.2]))
        self.assertEqual(n, 35)
        p = m.priors(x)
        self.assertEqual(len(p), 13)
        self.assertAlmostEqual(float(p[11]), 0.15 * (0.0 + 0.24) / HF.COLOUR_PRIOR_SIGMA["dome"], places=12)
        lo, hi = HF.bounds_of(m, n, K)
        self.assertEqual((lo[8], hi[8], lo[11], hi[16]), (-25.0, 12.0, -1.0, 1.0))
        self.assertEqual(m.describe(x)["name"], "refit")
        self.assertEqual(m.describe(x)["lampCounts"]["wCrown"], 0.4)


class Solve(unittest.TestCase):
    def test_the_refit_recovers_known_lights_from_flat_albedos(self):
        rng = np.random.default_rng(7)
        m = HF.RefitModel(LAMP_RATIO, HF.LampCounts(end_mean=2.0, centre_candles=3.0, crowns=2.0, w_crown=0.5),
                          {"chandeliers": (0.0, 0.0), "dome": (0.0, 0.0), "cove": (0.0, 0.0)})
        n = HF.n_params(m, K)
        truth = np.zeros(n)
        truth[:5] = math.log(0.5); truth[5] = -20.0; truth[6] = math.log(0.3); truth[7] = math.log(0.2); truth[8] = math.log(0.15)
        albedo = np.array([[0.3, 0.3, 0.3], [0.5, 0.5, 0.5], [0.2, 0.2, 0.2], [0.4, 0.35, 0.3], [0.25, 0.25, 0.25], [0.55, 0.6, 0.65]])
        truth[m.n_log + m.n_col:-1] = np.delete(np.log(albedo).ravel(), K.paint * 3 + 1)
        V = 600
        Dv = rng.uniform(0.0, 1.0, (V, 10)); Dv[:, 5] = 0.0
        Iv = rng.uniform(0.0, 0.1, (V, 10, 3))
        g = np.repeat(np.arange(6), V // 6)
        E, mu, _gam = HF.model_light(m, truth, Dv, Iv, K)
        data = HF.VoxelData(Dv_ok=Dv, Iv_ok=Iv, logC=np.log(E) + mu[g], g_ok=g, wg=np.full(V, 1.0 / math.sqrt(V / 6)))
        sol = HF.solve(m, HF.anchor_albedo(m, HF.initial_x(m, Dv, K), data, K), data, K)
        w_fit = HF.unpack(m, sol.x, K)[0]
        w_true = HF.unpack(m, truth, K)[0]
        lights = [0, 1, 2, 3, 4, 6, 7, 8, 9]                              # sun_cap has no direct light at these voxels
        np.testing.assert_allclose(w_fit[lights], w_true[lights], rtol=0.02)
        self.assertLess(HF.data_cost(m, sol.x, data, K), 1e-6)


class Acceptance(unittest.TestCase):
    @staticmethod
    def report(cost, w_end=1.0, w_centre=2.0, log_phi=-3.0):
        weights = [1.0] * 10; weights[7] = w_end; weights[8] = w_centre
        return {"dataCost": cost, "weights": weights, "logPerBulb": log_phi}

    def test_the_refit_may_cost_two_percent_more_and_must_light_the_centre_by_its_lamps(self):
        counts = HF.LampCounts(end_mean=2.0, centre_candles=3.0, crowns=2.0, w_crown=0.5)   # centre 4: ratio 2
        proof = self.report(1.0)
        self.assertTrue(HF.accept_fit(proof, self.report(1.019), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.021), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.0, w_centre=1.9), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.0, log_phi=-25.0), counts)["pass"])

    def test_the_night_photographs_must_match_no_worse(self):
        def metrics(r43, r45, mae=0.5, chroma=(0.25, 0.2)):
            row = lambda r: {HF.PHOTO_JOB: {"r": r, "mae_affine_stops": mae, "chroma_mae_rg_bg": list(chroma)}}
            return {"mp43_night_end": row(r43), "mp45_night_windows": row(r45)}
        base = metrics(0.881, 0.820)
        self.assertTrue(HF.photo_gate(base, metrics(0.877, 0.83))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.870, 0.83))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.89, 0.83, mae=0.53))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.89, 0.83, chroma=(0.28, 0.2)))["pass"])

    def test_the_crown_tubes_sensitivity_stops_when_the_photographs_clearly_prefer_an_end(self):
        def metrics(r, mae=0.5, chroma=(0.25, 0.2)):
            return {view: {HF.PHOTO_JOB: {"r": r, "mae_affine_stops": mae, "chroma_mae_rg_bg": list(chroma)}} for view in HF.PHOTO_VIEWS}

        def run(w, photo):
            return {"wCrown": w, "dataCost": 1.0, "budget": {g: {"ch_centre": 0.1 + 0.1 * w} for g in ("floor", "ceiling")},
                    "photo": photo}

        def verdict(low, high):
            runs = {HF.DEFAULT_TAG: run(0.45, metrics(0.880)), HF.variant_tag(0.0): run(0.0, low), HF.variant_tag(1.0): run(1.0, high)}
            return HF.crown_sensitivity(runs, metrics(0.882))           # a second render moves r by 0.002
        self.assertEqual([HF.variant_tag(w) for w in HF.CROWN_ENDS], ["refit-wcrown-0", "refit-wcrown-1"])
        self.assertTrue(verdict(metrics(0.880), metrics(0.881))["pass"])                       # within the noise
        better = metrics(0.885, mae=0.48, chroma=(0.23, 0.18))
        got = verdict(metrics(0.880), better)
        self.assertEqual((got["pass"], got["preferredEnd"]), (False, 1.0))                    # w_crown 1 wins every metric
        self.assertEqual(got["runs"]["refit-wcrown-1"]["chCentreShare"], {"floor": 0.2, "ceiling": 0.2})
        self.assertAlmostEqual(got["noise"]["mp43_night_end"]["r"], 0.002, places=12)
        self.assertEqual(got["noise"]["mp45_night_windows"]["mae_affine_stops"], HF.METRIC_ROUNDING)
        self.assertEqual(verdict(better, metrics(0.880))["preferredEnd"], 0.0)
        self.assertTrue(verdict(metrics(0.880), metrics(0.885, mae=0.48, chroma=(0.25, 0.18)))["pass"])   # one metric level


class Outputs(unittest.TestCase):
    def test_every_lamp_is_named_with_its_kind_per_unit_of_its_group_weight_and_the_rest_are_not_lamps(self):
        with tempfile.TemporaryDirectory() as d:
            bulbs = HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)
        counts = HF.lamp_counts(bulbs, 0.45)                               # the centre: 4 + 0.45 x 2 = 4.9 candles of light
        report = {"weights": [1.0] * 7 + [2.25 * 0.5, 4.9 * 0.5, 1.0], "logPerBulb": math.log(0.5)}
        out = HF.bulb_shares(bulbs, counts, report, "a" * 64)
        self.assertEqual((out["schema"], out["wCrown"]), ("venviewer.bulb-intensities.v1", 0.45))
        self.assertEqual(sorted(list(out["bulbs"]) + out["fit"]["notLamps"]), bulbs["ids"])
        self.assertEqual(out["fit"]["notLamps"], ["c0_b07", "c3_b08"])
        self.assertEqual(out["bulbs"]["c0_b00"], {"kind": "candle", "intensity": 1 / 2.25})
        self.assertEqual(out["bulbs"]["c2_b05"]["kind"], "crown")
        self.assertAlmostEqual(out["bulbs"]["c2_b03"]["intensity"], 1 / 4.9, places=15)
        self.assertAlmostEqual(out["bulbs"]["c2_b05"]["intensity"], 0.45 * out["bulbs"]["c2_b03"]["intensity"], places=15)
        centre = [v["intensity"] for bid, v in out["bulbs"].items() if bid.startswith("c2_")]
        self.assertAlmostEqual(sum(centre), 1.0, places=12)                # the centre chandelier's lamps carry its weight
        self.assertAlmostEqual(out["fit"]["groups"]["ch_end"]["chandeliers"]["1"]["share"], 3 / 9, places=15)
        self.assertAlmostEqual(out["fit"]["lampRatio"], 4.9 / 2.25, places=12)
        self.assertEqual(out["fit"]["crownWeightMeasured"]["pairs"], 2)

    def test_two_runs_are_compared_array_by_array_and_byte_by_byte(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            for d in (a, b):
                np.savez(os.path.join(d, "fit_state.npz"), rho=np.ones((2, 3), np.float32))
                with open(os.path.join(d, "fit.json"), "w", encoding="utf-8") as f:
                    f.write('{"a": 1}')
            self.assertEqual(HF.same_run(a, b), [])
            np.savez(os.path.join(b, "fit_state.npz"), rho=np.zeros((2, 3), np.float32))
            with open(os.path.join(b, "extra.json"), "w", encoding="utf-8") as f:
                f.write("{}")
            self.assertEqual(HF.same_run(a, b), ["extra.json", "fit_state.npz"])

    def test_the_proof_fit_is_kept_once_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as work:
            os.makedirs(os.path.join(work, "npy"))
            for name, data in (("fit.json", b'{"weights": [1]}'), ("fit_state.npz", b"npz"), ("npy/E_cap.npy", b"cap"),
                               ("npy/emb_E_back_cap.npy", b"back")):
                with open(os.path.join(work, name), "wb") as f:
                    f.write(data)
            first = HF.snapshot_fit(work)
            self.assertEqual(sorted(first), sorted(HF.FIT_FILES))
            self.assertEqual(HF.snapshot_fit(work), first)                 # again: the same snapshot
            with open(os.path.join(work, "npy", "E_cap.npy"), "wb") as f:
                f.write(b"changed")
            with self.assertRaises(ValueError):
                HF.snapshot_fit(work)
            with open(os.path.join(work, "fit.json"), "w", encoding="utf-8") as f:
                f.write('{"model": {"name": "refit"}}')
            self.assertEqual(HF.snapshot_fit(work), first)                 # the work holds the refit: the snapshot stands


if __name__ == "__main__":
    unittest.main()

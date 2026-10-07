import unittest
import numpy as np
from relight import sunbounce as SB, windows as W

RES = 0.03
LO = np.array([0.0, -1.0, 0.0])                  # grid corner; the wall's inner face is y0 = 0, the glass at -0.5
RECT = (0.3, 2.7, 0.5, 0.3, 2.7, "rect")
FAR = (2.0, 2.7, 0.5, 0.3, 2.7, "rect")          # a window the test's rays do not enter


def sun_toward(az, el, x_bearing=14.3):
    th, e = np.radians(x_bearing - az), np.radians(el)
    return np.array([np.cos(th) * np.cos(e), np.sin(th) * np.cos(e), np.sin(e)])


def window_volumes(*windows):
    """Empty embrasures (test_windows' volume()) in this order, sharing one grid: a dict {name: WindowVolume}."""
    grid = np.zeros((100, 34, 100), np.float32)
    return W.volumes_from_occupancy(grid, LO, RES, {f"W{n + 1}": w for n, w in enumerate(windows)}, 0.0, x_bearing=14.3)


def room_patches():
    """Five 0.25 m2 floor patches: two 3 m and 3.5 m in front of the wall in line with the window for a sun at azimuth
    110 and elevation 30 (their 32 sub-sample rays all enter through RECT and leave through its glass), two far along
    the wall (x = 8: no window takes them), and one facing down (it lights nothing: its cosine is zero)."""
    P = np.array([[1.5, 3.0, 0.0], [1.5, 3.5, 0.0], [8.0, 3.0, 0.0], [8.0, 3.5, 0.0], [1.5, 3.0, 0.0]])
    N = np.array([[0.0, 0.0, 1.0]] * 4 + [[0.0, 0.0, -1.0]])
    return SB.Patches.from_arrays(P, N, np.full(5, 0.25))


def table(rows=3, cols=4, K=2):
    """coeffs[j, i, w, k] = (i + 10 j)(w + 1) + 100 k on a 4-degree grid at (40, -2)."""
    j, i = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    base = (i + 10 * j).astype(np.float64)
    coeffs = np.stack([np.stack([base * (w + 1) + 100 * k for k in range(K)], -1) for w in range(5)], 2)
    return SB.Table(coeffs=coeffs.astype(np.float32), az0=40.0, el0=-2.0, step=4.0)


class Patch(unittest.TestCase):
    def test_the_patches_carry_the_proofs_sixteen_sub_sample_rays_in_float32(self):
        p = SB.Patches.from_arrays(np.array([[1.0, 2.0, 0.0]]), np.array([[0.0, 0.0, 1.0]]), np.array([0.25]))
        self.assertEqual((p.rays.shape, p.rays.dtype, p.normals.dtype, p.areas.dtype), ((16, 3), np.float32, np.float32, np.float32))
        np.testing.assert_array_equal(p.rays, SB.patch_rays(np.array([[1.0, 2.0, 0.0]]), np.array([[0.0, 0.0, 1.0]])).astype(np.float32))
        self.assertEqual(p.areas.tolist(), [0.25])


class Power(unittest.TestCase):
    """P_w(s): the room's power from window w, exact at every evaluation (never interpolated): the proof's patch rays
    marched by the browser twin."""

    def setUp(self):
        self.vols = window_volumes(FAR, RECT, RECT)                 # W2 takes the rays; W3 never sees one (W2 claims them first)
        self.patches = room_patches()
        self.fresnel = np.linspace(0.90, 0.30, 101)
        self.flat, self.high = np.zeros(360), np.full(360, 40.0)
        self.s = sun_toward(110.0, 30.0)
        self.expected = 0.25 * W.fresnel_at(self.fresnel, np.asarray(self.s, np.float32))   # 2 patches x 0.25 m2 x cosine 0.5 x glass

    def power(self, horizons, s=None, gated=True):
        return SB.window_power(self.vols, horizons, self.fresnel, self.patches, self.s if s is None else s, gated=gated)

    def test_power_sums_area_lit_fraction_cosine_and_glass_over_the_patches_the_window_claims(self):
        P = self.power([self.flat] * 3)
        self.assertEqual(P.dtype, np.float64)
        self.assertEqual((P[0], P[2]), (0.0, 0.0))
        self.assertAlmostEqual(P[1], self.expected, places=6)
        self.assertGreater(P[1], 0.09)                              # 0.25 m2 x the glass transmission, 0.383 here

    def test_a_window_below_its_horizon_has_no_power_unless_ungated(self):
        np.testing.assert_array_equal(self.power([self.flat, self.high, self.flat]), np.zeros(3))
        np.testing.assert_array_equal(self.power([self.flat, self.high, self.flat], gated=False), self.power([self.flat] * 3))

    def test_a_sun_behind_the_wall_has_no_power(self):
        for gated in (True, False):
            np.testing.assert_array_equal(self.power([self.flat] * 3, sun_toward(290.0, 30.0), gated), np.zeros(3))

    def test_power_is_taken_at_the_float32_sun(self):
        s = np.asarray(self.s, np.float32).astype(np.float64)        # exactly a float32 sun
        s_up = s + 1e-10                                             # far inside its rounding interval
        self.assertFalse(np.array_equal(s, s_up))
        np.testing.assert_array_equal(self.power([self.flat] * 3, s), self.power([self.flat] * 3, s_up))

    def test_a_dark_patch_set_has_no_power(self):
        far = SB.Patches.from_arrays(np.array([[8.0, 3.0, 0.0]]), np.array([[0.0, 0.0, 1.0]]), np.array([0.25]))
        np.testing.assert_array_equal(SB.window_power(self.vols, [self.flat] * 3, self.fresnel, far, self.s), np.zeros(3))


class RealNodes(unittest.TestCase):
    def test_a_node_is_real_from_a_fraction_of_its_windows_median_non_zero_node_power(self):
        power = np.zeros((2, 5, 2))
        power[0, :, 0] = [0.0, 1.0, 2.0, 3.0, 4.0]
        power[1, 4, 0] = 100.0                                    # non-zero values 1, 2, 3, 4, 100: median 3, threshold 1.5
        real = SB.real_nodes(power, 0.5)
        np.testing.assert_array_equal(real[..., 0], [[False, False, True, True, True], [False, False, False, False, True]])
        np.testing.assert_array_equal(real[..., 1], np.zeros((2, 5), bool))     # a window that never lights has none

    def test_the_default_fraction_is_one_ten_thousandth_of_the_median(self):
        self.assertEqual(SB.REAL_FRACTION, 1e-4)
        power = np.zeros((1, 4, 1))
        power[0, :, 0] = [0.5e-4, 2e-4, 1.0, 3.0]                 # the non-zero median is 0.50010: threshold 5.001e-5
        np.testing.assert_array_equal(SB.real_nodes(power)[0, :, 0], [False, True, True, True])


class Fill(unittest.TestCase):
    def test_a_node_without_real_power_takes_the_nearest_real_node(self):
        real = np.zeros((4, 5), bool)
        real[0, 0] = real[3, 4] = True
        values = np.arange(20.0).reshape(4, 5)
        out = SB.fill_from_nearest(real, values)
        self.assertEqual(out[0, 0], values[0, 0])                 # real nodes keep their own values
        self.assertEqual(out[3, 4], values[3, 4])
        self.assertEqual(out[1, 1], values[0, 0])                 # squared index distance 2 against 13
        self.assertEqual(out[3, 3], values[3, 4])                 # 1 against 18
        self.assertEqual(out[2, 2], values[3, 4])                 # 8 against 5: the far corner is nearer by index distance

    def test_a_tie_goes_to_the_first_real_node_in_row_major_order(self):
        real = np.zeros((3, 3), bool)
        real[0, 1] = real[1, 0] = True                            # (1, 1) is squared distance 1 from both
        values = np.arange(9.0).reshape(3, 3)
        self.assertEqual(SB.fill_from_nearest(real, values)[1, 1], values[0, 1])
        real = np.zeros((3, 3), bool)
        real[2, 1] = real[1, 2] = True                            # (1, 1) is squared distance 1 from both: (1, 2) is first
        self.assertEqual(SB.fill_from_nearest(real, values)[1, 1], values[1, 2])
        real = np.zeros((3, 3), bool)
        real[2, 1] = real[1, 0] = True                            # (1, 1): (1, 0) is first in row-major order again
        self.assertEqual(SB.fill_from_nearest(real, values)[1, 1], values[1, 0])
        real = np.zeros((3, 3), bool)
        real[0, 0] = real[2, 2] = True                            # (1, 1): both at squared distance 2: (0, 0) is first
        self.assertEqual(SB.fill_from_nearest(real, values)[1, 1], values[0, 0])

    def test_values_may_carry_trailing_axes_and_only_the_requested_nodes_are_filled(self):
        real = np.zeros((2, 3), bool)
        real[0, 0] = True
        values = np.arange(12.0).reshape(2, 3, 2)
        where = np.array([[True, True, False], [False, False, False]])
        out = SB.fill_from_nearest(real, values, where)
        np.testing.assert_array_equal(out[0, 1], values[0, 0])    # asked for, filled
        np.testing.assert_array_equal(out[0, 2], values[0, 2])    # not asked for: untouched
        np.testing.assert_array_equal(out[1, 0], values[1, 0])
        self.assertEqual(out.shape, values.shape)

    def test_with_no_real_node_there_is_nothing_to_copy(self):
        with self.assertRaises(ValueError):
            SB.fill_from_nearest(np.zeros((2, 2), bool), np.zeros((2, 2)))


class Bake(unittest.TestCase):
    """Fields that are exactly power x (a mix of two unit volumes): the bake must give back the unit fields."""

    def setUp(self):
        rng = np.random.default_rng(5)
        self.U = rng.random((2, 5, 3, 6)) + 0.5                       # two unit-field volumes over 5 probes
        self.nodes = [(0, 0), (0, 1), (1, 0), (1, 1)]                 # the facing nodes of a 2 x 3 grid; column 2 faces away
        self.needed = np.ones((2, 3), bool)
        a = rng.random((4, 2, 2)) + 0.5                               # node, window, volume
        self.R = np.einsum("nwk,kmcf->nwmcf", a, self.U)              # each node's unit field per window
        self.power = rng.random((4, 2)) + 0.5
        self.power[3, 1] = 0.0                                        # window 2 does not light node (1, 1)
        self.fields = self.power[:, :, None, None, None] * self.R
        self.valid = np.array([True, True, True, True, False])
        self.baked = SB.bake_table(self.fields, self.power, self.nodes, self.needed, self.valid, 2)

    def test_the_real_node_windows_are_those_with_power(self):
        real = self.baked.real
        self.assertEqual(real.shape, (2, 3, 2))
        np.testing.assert_array_equal(real[..., 0], [[True, True, False], [True, True, False]])
        np.testing.assert_array_equal(real[..., 1], [[True, True, False], [True, False, False]])

    def test_a_real_node_window_gives_back_its_unit_field_and_the_model_its_baked_field(self):
        basis, coeffs = self.baked.basis, self.baked.coeffs
        self.assertEqual((basis.dtype, basis.shape, coeffs.dtype, coeffs.shape), (np.float16, (2, 5, 3, 6), np.float32, (2, 3, 2, 2)))
        for n, (j, i) in enumerate(self.nodes):
            for w in range(2):
                if self.baked.real[j, i, w]:
                    unit = SB.bounce(basis, coeffs[j, i, w])
                    np.testing.assert_allclose(unit, self.R[n, w], rtol=3e-3, atol=0)
                    np.testing.assert_allclose(self.power[n, w] * unit, self.fields[n, w], rtol=3e-3, atol=0)

    def test_the_basis_volumes_are_scaled_to_their_largest_value(self):
        np.testing.assert_allclose(np.abs(self.baked.basis.astype(np.float64)).reshape(2, -1).max(1), [1.0, 1.0], rtol=2e-3)

    def test_every_needed_node_without_real_power_copies_the_nearest_real_node_of_its_window(self):
        c = self.baked.coeffs
        np.testing.assert_array_equal(c[1, 1, 1], c[0, 1, 1])         # (1, 1) of window 2: (0, 1) and (1, 0) tie, (0, 1) is first
        np.testing.assert_array_equal(c[0, 2, 0], c[0, 1, 0])         # the node facing away takes its neighbour's
        np.testing.assert_array_equal(c[1, 2, 0], c[1, 1, 0])
        np.testing.assert_array_equal(c[1, 2, 1], c[0, 1, 1])         # window 2: (0, 1) at distance 2 beats (1, 0) at 4

    def test_a_node_that_is_not_needed_stays_zero(self):
        needed = self.needed.copy()
        needed[1, 2] = False
        baked = SB.bake_table(self.fields, self.power, self.nodes, needed, self.valid, 2)
        np.testing.assert_array_equal(baked.coeffs[1, 2], np.zeros((2, 2), np.float32))
        np.testing.assert_array_equal(baked.coeffs[0, 2], self.baked.coeffs[0, 2])


class Mix(unittest.TestCase):
    def test_coefficients_weight_each_window_by_its_exact_power_over_the_four_nodes(self):
        t = table()                                                  # (45, 0) reads x = 1.25, y = 0.5: i + 10 j = 6.25
        P = np.array([1.0, 0.0, 2.0, 0.0, 0.0])
        np.testing.assert_allclose(SB.coefficients(t, P, 45.0, 0.0), [1 * 6.25 + 2 * 18.75, 1 * 106.25 + 2 * 118.75], rtol=0, atol=1e-9)

    def test_a_window_without_power_adds_nothing(self):
        np.testing.assert_array_equal(SB.coefficients(table(), np.zeros(5), 45.0, 0.0), [0.0, 0.0])

    def test_at_a_node_the_model_returns_the_baked_unit_field_times_the_exact_power(self):
        t, P = table(), np.array([0.5, 2.0, 0.0, 1.0, 0.25])
        az, el = 40.0 + 2 * 4.0, -2.0 + 1 * 4.0                      # node (row 1, column 2) exactly
        expected = sum(P[w] * np.asarray(t.coeffs[1, 2, w], np.float64) for w in range(5))
        np.testing.assert_allclose(SB.coefficients(t, P, az, el), expected, rtol=0, atol=1e-9)

    def test_the_bounce_folds_the_basis_volumes(self):
        basis = np.arange(2 * 3 * 3 * 6, dtype=np.float32).reshape(2, 3, 3, 6)
        np.testing.assert_allclose(SB.bounce(basis, np.array([2.0, -1.0])), 2.0 * basis[0] - basis[1], rtol=0, atol=1e-9)

    def test_sun_bounce_takes_the_exact_power_mixes_the_unit_fields_and_folds_at_the_float32_sun(self):
        t, basis = table(), np.arange(2 * 3 * 3 * 6, dtype=np.float32).reshape(2, 3, 3, 6)
        vols, patches, fresnel = window_volumes(FAR, RECT, RECT, RECT, RECT), room_patches(), np.linspace(0.90, 0.30, 101)
        hz = [np.zeros(360)] * 5
        s = sun_toward(110.0, 30.0)
        az, el = W.sun_az_el(np.asarray(s, np.float32), 14.3)
        P = SB.window_power(vols, hz, fresnel, patches, s)
        self.assertTrue(P[1] > 0.0 and P[0] == 0.0)
        np.testing.assert_array_equal(SB.sun_bounce(t, basis, vols, hz, fresnel, patches, 14.3, s), SB.bounce(basis, SB.coefficients(t, P, az, el)))
        np.testing.assert_array_equal(SB.sun_bounce(t, basis, vols, hz, fresnel, patches, 14.3, sun_toward(290.0, 30.0)), np.zeros((3, 3, 6)))


class Gate(unittest.TestCase):
    def test_log2_errors_score_only_where_the_exact_bounce_is_lit(self):
        d = SB.log2_errors(np.array([2.0, 1.0, 0.0, -1.0, 5.0]), np.array([1.0, 1.0, 1.0, 1.0, 0.0]))
        np.testing.assert_array_equal(d, [1.0, 0.0, np.inf, np.inf])

    def test_a_faint_sun_is_reported_but_does_not_decide(self):
        r = SB.gate(np.array([0.1, 0.2, 1.5]), np.array([1.0, 1.0, 0.049]), np.full(100, 0.1))
        self.assertTrue(r["pass"])
        self.assertEqual((r["brightOver"], r["faintOver"]), (0, 1))

    def test_a_sun_at_5_percent_of_the_median_suns_bounce_decides(self):
        self.assertFalse(SB.gate(np.array([0.1, 0.26, 0.1]), np.array([1.0, 0.05, 1.0]), np.full(100, 0.1))["pass"])

    def test_the_pooled_median_must_meet_the_gate(self):
        self.assertFalse(SB.gate(np.array([0.1, 0.1]), np.array([1.0, 1.0]), np.full(100, 0.26))["pass"])

    @staticmethod
    def curve(worst, passes=None):
        """Gate results for K = 1, 2, ...: each K's worst bright direction, and whether its gate passes (default: when
        the worst bright direction is within the gate's 0.25)."""
        return [{"pass": (w <= SB.GATE["median"]) if passes is None else passes[k], "worstBright": w} for k, w in enumerate(worst)]

    def test_k_is_the_smallest_whose_worst_bright_direction_stays_within_the_margin_from_there_up(self):
        # a clean curve: over the margin up to K 3, within it from K 4 on
        self.assertEqual(SB.choose_k(self.curve([0.30, 0.26, 0.22, 0.19, 0.18, 0.17])), (4, "margin"))

    def test_a_dip_under_the_margin_that_rises_again_is_not_taken(self):
        # the run 9 shape: K 2 has the margin, K 3 to 5 do not, K 6 on do. A dip is luck, so the choice is K 6
        worst = [0.30, 0.18, 0.21, 0.22, 0.205, 0.19, 0.17, 0.16]
        self.assertEqual(SB.choose_k(self.curve(worst)), (6, "margin"))

    def test_the_margin_is_a_fifth_under_the_gate_and_exactly_met_counts(self):
        self.assertEqual(SB.MARGIN, 0.20)
        self.assertEqual(SB.choose_k(self.curve([0.2000000001, 0.20, 0.20])), (2, "margin"))

    def test_a_k_whose_gate_fails_is_not_taken_even_with_a_small_worst_bright_direction(self):
        # the pooled median can fail the gate while every bright direction is fine
        self.assertEqual(SB.choose_k(self.curve([0.10, 0.19, 0.19], passes=[False, True, True])), (2, "margin"))
        self.assertEqual(SB.choose_k(self.curve([0.19, 0.19, 0.19], passes=[True, False, True])), (3, "margin"))

    def test_a_curve_that_ends_above_the_margin_has_no_stable_k_and_keeps_the_smallest_passing_k(self):
        worst = [0.40, 0.24, 0.18, 0.17, 0.21]                          # within the margin for K 3 and 4, then above it at the last K
        self.assertEqual(SB.choose_k(self.curve(worst)), (2, "smallestPassing"))

    def test_without_a_passing_k_the_last_is_returned(self):
        self.assertEqual(SB.choose_k(self.curve([0.4, 0.4, 0.4], passes=[False] * 3)), (3, "none"))

    def test_a_sun_already_used_is_recognised_and_a_different_one_is_not(self):
        used = [sun_toward(120.0, 30.0), sun_toward(150.0, 40.0)]
        self.assertTrue(SB.reused(sun_toward(150.0, 40.0), used))
        self.assertFalse(SB.reused(sun_toward(150.0, 40.0001), used))
        self.assertFalse(SB.reused(sun_toward(150.0, 40.0), []))


class Basis(unittest.TestCase):
    def test_the_basis_reproduces_fields_of_its_rank(self):
        rng = np.random.default_rng(1)
        X = (rng.random((12, 3)) @ rng.random((3, 40))).astype(np.float32)
        V, lam = SB.row_eigen(X)
        U, C = SB.basis_volumes(X, V, lam, 3), SB.node_coefficients(V, lam, 3)
        np.testing.assert_allclose(C @ U.T, X, rtol=0, atol=1e-5)
        self.assertLess(float(lam[3]) / float(lam[0]), 1e-10)

    def test_trilinear_weights_renormalise_over_valid_probes_and_clamp_onto_the_grid(self):
        valid = np.ones(8, bool)
        M = SB.trilinear_matrix(np.zeros(3), 1.0, (2, 2, 2), valid, np.array([[0.5, 0.5, 0.5], [0.0, 0.0, 0.0], [-3.0, 0.0, 0.0]]))
        np.testing.assert_allclose(M.toarray(), [np.full(8, 0.125), np.eye(8)[0], np.eye(8)[0]], rtol=0, atol=1e-12)
        valid[0] = False                                             # index (ix * 2 + iy) * 2 + iz = 0
        M = SB.trilinear_matrix(np.zeros(3), 1.0, (2, 2, 2), valid, np.array([[0.5, 0.5, 0.5]]))
        np.testing.assert_allclose(M.toarray()[0], np.r_[0.0, np.full(7, 1.0 / 7.0)], rtol=0, atol=1e-12)

    def test_patch_rays_are_the_proofs_16_samples_in_its_order(self):
        X = SB.patch_rays(np.array([[1.0, 2.0, 0.0]]), np.array([[0.0, 0.0, 1.0]]))
        self.assertEqual(X.shape, (16, 3))                           # normal z: u moves x, v moves y, 2 cm up
        np.testing.assert_allclose(X[:2], [[0.8125, 1.8125, 0.02], [0.8125, 1.9375, 0.02]], rtol=0, atol=1e-12)


if __name__ == "__main__":
    unittest.main()

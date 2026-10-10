import unittest
from dataclasses import replace
import numpy as np
from relight import codec, reference, sunbounce, windows


def model(n_probes_axis=2, spacing=1.0):
    shape = (n_probes_axis,) * 3
    M = int(np.prod(shape))
    cubes = np.zeros((M, 9, 3, 6), np.float32)
    cubes[:, 5] = 0.1                                       # the cove bounces a little everywhere
    return reference.Model(
        capture_w=np.array([1.0, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]),
        capture_c=np.tile([1.0, 1.0, 1.0], (9, 1)),
        daylight_colour=np.array([1.0, 1.0, 1.0]),
        probes=cubes, probe_valid=np.ones(M, bool), probe_origin=np.zeros(3), probe_spacing=spacing, probe_shape=shape,
        volumes={}, fresnel=np.ones(101, np.float32))


def splats(n=4):
    direct = np.zeros((n, 9)); direct[:, 0] = 1.0; direct[:, 5] = 0.5
    normals = np.tile([0.0, 0.0, 1.0], (n, 1))
    flags = np.zeros(n, np.uint8)
    pos = np.full((n, 3), 0.5)
    colour = np.full((n, 3), 0.4)
    return direct, normals, flags, pos, colour


def window_volume():
    """An empty, open window W1: x 0.3..2.7, z 0.3..2.7 at the wall face y0 = 0, its glass 0.5 m out, bearing 14.3."""
    return windows.volumes_from_occupancy(np.zeros((100, 34, 100), np.float32), np.array([0.0, -1.0, 0.0]), 0.03,
                                          {"W1": (0.3, 2.7, 0.5, 0.3, 2.7, "rect")}, 0.0, x_bearing=14.3)["W1"]


def sky_basis(face_value=0.25, valid=None):
    """One basis volume on a 2 x 2 x 2 grid of 1 m from the origin, every probe holding face_value on +z, and a 2 x 2 table
    whose every node weighs it 1 for the one window; one 0.5 m patch 1 m from the wall facing it."""
    basis = np.zeros((1, 8, 3, 6), np.float16); basis[0, :, :, 4] = face_value
    table = sunbounce.Table(coeffs=np.ones((2, 2, 1, 1), np.float32), az0=100.0, el0=4.0, step=4.0)
    patches = sunbounce.Patches.from_arrays(np.array([[1.5, 1.0, 1.5]]), np.array([[0.0, -1.0, 0.0]]), np.array([0.25]))
    return reference.SkyBounce(table=table, basis=basis, origin=np.zeros(3), spacing=1.0, shape=(2, 2, 2),
                               valid=np.ones(8, bool) if valid is None else valid, patches=patches, floor_mean=np.zeros((1, 3), np.float32))


OUT_OF_THE_WALL = np.array([0.0, -np.cos(np.radians(5.7)), np.sin(np.radians(5.7))])   # compass azimuth 104.3, 5.7 degrees up


class CapturedSettingIsNeutral(unittest.TestCase):
    def test_multiplier_is_one_at_the_captured_light(self):
        m = model()
        rgb, alpha = reference.multiplier(*splats(), m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(rgb, 1.0, atol=1e-6))
        self.assertTrue(np.all(alpha == 1.0))


def proof_lookup(pos, origin, shape, valid, spacing, lo, hi):
    """The proof's probe read, verbatim but for the grid spacing and the box (arguments here): store.Probes.lookup clamps
    the position into the hall's box (store.py:60-62: X0 + 0.02 .. X1 - 0.02, Y0 + 0.02 .. Y1 - 0.02, FLOOR_Z + 0.02
    .. 9.8), then 03_bases.trilinear_weights (03_bases.py:78-95, PROBE there): the cell clamped to [0, shape - 2], the
    fraction to [0, 1], the eight corners weighted by validity in float32, renormalised where they sum over 1e-6."""
    q = np.asarray(pos, np.float64).copy()
    q[:, 0] = np.clip(q[:, 0], lo[0], hi[0]); q[:, 1] = np.clip(q[:, 1], lo[1], hi[1])
    q[:, 2] = np.clip(q[:, 2], lo[2], hi[2])
    f = (q - np.array(origin)) / spacing
    i0 = np.floor(f).astype(np.int64)
    i0 = np.clip(i0, 0, np.array(shape) - 2)
    t = np.clip(f - i0, 0, 1)
    idx = np.zeros((len(q), 8), np.int64); w = np.zeros((len(q), 8), np.float32)
    k = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                ii = ((i0[:, 0] + dx) * shape[1] + (i0[:, 1] + dy)) * shape[2] + (i0[:, 2] + dz)
                ww = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                ww = ww * valid[ii]
                idx[:, k] = ii; w[:, k] = ww; k += 1
    s = w.sum(1, keepdims=True)
    w = np.where(s > 1e-6, w / np.maximum(s, 1e-6), 0)
    return idx, w


HALL = {"x0": -0.4, "x1": 1.73, "y0": -1.1, "y1": 0.3, "floorZ": 0.02, "ceilingZ": 1.51}
BOX_LO = np.array([HALL["x0"] + 0.02, HALL["y0"] + 0.02, HALL["floorZ"] + 0.02])
BOX_HI = np.array([HALL["x1"] - 0.02, HALL["y1"] - 0.02, 9.8])


def hall_model(box=True):
    """A probe grid as the bake builds it (probes.coarse_grid and valid_mask: 0.5 m from the hall box's low corner, its
    probes on the box's low faces invalid), every probe's cove cube 0.1, with the proof's lookup box or none."""
    from relight import probes as PR
    P, shape, origin = PR.coarse_grid(HALL, 0.5)
    cubes = np.zeros((len(P), 9, 3, 6), np.float32)
    cubes[:, 5] = 0.1
    extra = {"probe_box_lo": BOX_LO, "probe_box_hi": BOX_HI} if box else {}
    return replace(model(), probes=cubes, probe_valid=PR.valid_mask(P, HALL), probe_origin=origin, probe_spacing=0.5,
                   probe_shape=tuple(int(v) for v in shape), **extra)


class ProbeLookup(unittest.TestCase):
    """Fix round 2: the probes are read as the proof reads them, at the position clamped into the hall's box first."""

    def test_the_lookup_is_the_proofs(self):
        m = hall_model()
        rng = np.random.default_rng(4)
        P = np.stack([rng.uniform(HALL["x0"] - 0.6, HALL["x1"] + 0.6, 4000), rng.uniform(HALL["y0"] - 0.6, HALL["y1"] + 0.6, 4000),
                      rng.uniform(HALL["floorZ"] - 0.4, HALL["ceilingZ"] + 0.8, 4000)], 1)
        P[:200, 1] = HALL["y0"]                                   # on the window wall's face
        idx, w = reference.trilinear(m, P)
        want_idx, want_w = proof_lookup(P, m.probe_origin, m.probe_shape, m.probe_valid.astype(np.float32), 0.5, BOX_LO, BOX_HI)
        self.assertTrue(np.array_equal(idx, want_idx))
        np.testing.assert_allclose(w, want_w, rtol=0, atol=5e-7)  # the proof's weights are float32
        np.testing.assert_allclose(w.sum(1), 1.0, rtol=0, atol=1e-12)   # every position reads valid probes

    def test_a_splat_beyond_the_window_wall_reads_the_probes_inside_the_hall(self):
        """An embrasure splat (y below the box's y0) read without the box falls on the grid's low face, whose probes are
        all invalid, and gets no bounce in any setting; read as the proof reads it, 2 cm inside the hall, it does. A
        splat in the box past the grid's last plane reads that plane either way."""
        P = np.array([[0.6, HALL["y0"] - 0.3, 0.7], [0.6, HALL["y1"] - 0.05, 0.7]])
        _idx, open_w = reference.trilinear(hall_model(box=False), P)
        self.assertEqual(float(open_w[0].sum()), 0.0)                  # the defect: no valid corner
        self.assertAlmostEqual(float(open_w[1].sum()), 1.0, places=12)
        _idx, w = reference.trilinear(hall_model(), P)
        np.testing.assert_allclose(w.sum(1), 1.0, rtol=0, atol=1e-12)
        d, n, f, c = np.zeros((2, 9)), np.tile([0.0, 1.0, 0.0], (2, 1)), np.zeros(2, np.uint8), np.full((2, 3), 0.3)
        m = hall_model()
        captured = reference.Setting.captured(m)
        half_cove = replace(captured, weights=captured.weights * np.where(np.arange(9) == 5, 0.5, 1.0)[:, None])
        M, _ = reference.multiplier(d, n, f, P, c, m, half_cove)
        np.testing.assert_allclose(M, 0.5, rtol=1e-12)            # lit only by the cove's bounce, it follows the cove
        M_open, _ = reference.multiplier(d, n, f, P, c, hall_model(box=False), half_cove)
        self.assertEqual(M_open[0].tolist(), [1.0, 1.0, 1.0])      # without the box: stuck at its captured look


class DarkSplatsAreNeutral(unittest.TestCase):
    """Fix round 1, C1: the captured setting gives M = 1 on every channel, the guards included. The model has no bounce,
    so Ecap = sum w c D is set by each splat's direct light alone, and its daylight colour is the refit's (rBack =
    skyColour / daylight = 1 at the captured light)."""

    def setUp(self):
        m = model()
        self.m = replace(m, probes=np.zeros_like(m.probes), daylight_colour=np.array([1.0000001, 1.0, 1.0000002]))
        self.captured = reference.Setting.captured(self.m)

    def splats(self, cls, ecap, colour):
        """One splat per row of class cls whose captured light is ecap on every channel (W1's direct light), with the
        stored colours given (linear; 0 is an sRGB byte of 0)."""
        n = len(ecap)
        direct = np.zeros((n, 9)); direct[:, 0] = ecap
        return direct, np.tile([0.0, 0.0, 1.0], (n, 1)), np.full(n, cls, np.uint8), np.full((n, 3), 0.5), np.asarray(colour, np.float64)

    def test_an_embrasure_channel_stored_as_zero_is_neutral_in_both_branches(self):
        ecap = [1.3, 1.3, 1e-4, 0.0, 0.3]
        colour = [[0.0, 0.4, 0.3],        # dark red, rho = C' / Ecap = 1e-4 / 1.3 < 0.8
                  [0.0, 0.0, 0.0],        # black
                  [0.0, 0.4, 0.3],        # dark red, rho = 1e-4 / 1e-4 capped at 0.8 (excess 0.2e-4 x rBack)
                  [0.0, 0.2, 0.0],        # no captured light at all: rho 0.8, excess C' (M = rBack)
                  [0.5, 0.5, 0.5]]        # bright, rho = 0.5 / 0.3 capped at 0.8 (excess 0.26 x rBack)
        d, n, f, p, c = self.splats(codec.CLASS_EMBRASURE, ecap, colour)
        Cp, Ep = np.maximum(c, 1e-4), np.maximum(np.asarray(ecap), 1e-4)[:, None]
        capped = Cp / Ep >= 0.8
        self.assertEqual(capped.tolist(), [[False] * 3, [False] * 3, [True] * 3, [True] * 3, [True] * 3])
        M, alpha = reference.multiplier(d, n, f, p, c, self.m, self.captured)
        np.testing.assert_allclose(M, 1.0, rtol=0, atol=1e-12)
        self.assertEqual(alpha.tolist(), [1.0] * 5)

    def test_a_splat_without_captured_light_is_neutral_in_the_interior_rule(self):
        """Ecap below the 1e-4 guard: interior (class 0), a lit fixture (class 6 takes the interior M) and a skin
        (class 7). The rule takes max(E, 1e-4) / max(Ecap, 1e-4), so E = Ecap gives 1 exactly."""
        for cls in (codec.CLASS_INTERIOR, codec.CLASS_CH_FIXTURE, codec.CLASS_SKIN):
            d, n, f, p, c = self.splats(cls, [0.0, 5e-5, 9.9e-5, 1e-4, 0.7], [[0.3, 0.3, 0.3]] * 5)
            M, _alpha = reference.multiplier(d, n, f, p, c, self.m, self.captured)
            np.testing.assert_allclose(M, 1.0, rtol=0, atol=1e-12, err_msg=f"class {cls}")

    def test_the_guards_away_from_the_captured_light(self):
        """Half the sky (E = Ecap / 2, rBack = 1/2): the interior rule reads max(E, 1e-4) / max(Ecap, 1e-4), so it differs
        from E / Ecap only where E < 1e-4 (no light: 1; Ecap 1.5e-4: 1e-4 / 1.5e-4); the embrasure's C' rule gives 1/2 in
        both branches, a channel stored as zero included. With no light at all the embrasure takes the clamp's 1/16."""
        half = self.captured.with_sky(0.5)
        d, n, f, p, c = self.splats(codec.CLASS_INTERIOR, [0.0, 1.5e-4, 1e-2], [[0.3, 0.3, 0.3]] * 3)
        M, _ = reference.multiplier(d, n, f, p, c, self.m, half)
        np.testing.assert_allclose(M[:, 0], [1.0, 1e-4 / 1.5e-4, 0.5], rtol=1e-12)
        d, n, f, p, c = self.splats(codec.CLASS_EMBRASURE, [1.3, 1e-4, 0.0], [[0.0, 0.4, 0.3]] * 3)
        M, _ = reference.multiplier(d, n, f, p, c, self.m, half)
        np.testing.assert_allclose(M, 0.5, rtol=1e-12)
        dark = replace(half.with_sky(0.0), weights=np.zeros((9, 3)))
        M, _ = reference.multiplier(d, n, f, p, c, self.m, dark)
        np.testing.assert_allclose(M, 1 / 16)                         # E = 0 and rBack = 0: the clamp's floor


class Rules(unittest.TestCase):
    def test_night_without_sky_keeps_only_lamp_light(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(0.0))
        # captured: W1 1.0 + cove (0.5 direct + 0.1 bounce) x 0.5 = 1.3; night: 0.3
        self.assertTrue(np.allclose(rgb, 0.3 / 1.3, atol=1e-5))

    def test_multiplier_is_clamped(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(100.0))
        self.assertTrue(np.all(rgb <= 8.0 + 1e-9))

    def test_hidden_splats_have_zero_alpha(self):
        m = model()
        d, n, f, p, c = splats()
        f[1] = codec.CLASS_HIDDEN
        _, alpha = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertEqual(alpha.tolist(), [1.0, 0.0, 1.0, 1.0])

    def test_lit_bulbs_are_boosted_and_unlit_bulbs_reflect(self):
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95                                        # a bright bulb: 1 + (4 - 1) x smoothstep(0.45, 0.9, L) = 4
        on, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(1.0).with_emitter_boost(4.0))
        self.assertTrue(np.allclose(on, 4.0, atol=1e-6))
        neutral, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(neutral, 1.0, atol=1e-6))      # the captured setting leaves bulbs as captured
        off, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(0.0))
        self.assertTrue(np.all(off < 1.0))

    def test_a_lamp_tint_colours_lit_bulbs_and_the_cove(self):
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95
        tints = {g: (1.0, 1.0, 1.0) for g in reference.LAMP_GROUPS}
        tints["ch_end"] = (1.2, 1.0, 0.6)
        lit, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), lamp_tints=tints))
        np.testing.assert_allclose(lit, np.tile([1.2, 1.0, 0.6], (4, 1)), atol=1e-9)

    def test_the_horizon_blocks_the_sun(self):
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.5, 1.0, 1.5]    # enters at z 1.6, leaves the glass at 1.65
        open_m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": np.zeros(360, np.float32)})
        shut_m = replace(open_m, horizons={"W1": np.full(360, 90.0, np.float32)})
        setting = replace(reference.Setting.captured(open_m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3))
        lit, _ = reference.multiplier(d, n, f, p, c, open_m, setting)
        shut, _ = reference.multiplier(d, n, f, p, c, shut_m, setting)
        self.assertTrue(np.all(lit > 1.0 + 1e-3))
        self.assertTrue(np.allclose(shut, 1.0, atol=1e-9))

    def test_the_moon_lights_like_the_sun_through_the_same_window(self):
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.5, 1.0, 1.5]
        m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": np.zeros(360, np.float32)})
        by_sun, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3)))
        by_moon, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        both, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3),
                                                                    moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        np.testing.assert_allclose(by_moon, by_sun, atol=1e-12)
        self.assertTrue(np.all(both > by_sun))

    def test_the_sky_bodies_bounce_through_the_basis_scaled_by_the_exact_window_power(self):
        d, n, f, p, c = splats(1)                          # no sun flag: only the bounce reaches this splat
        horizon = np.zeros(360, np.float32)
        m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": horizon}, sky=sky_basis())
        power = sunbounce.window_power([m.volumes["W1"]], [horizon], m.fresnel, m.sky.patches, np.asarray(OUT_OF_THE_WALL, np.float32))
        self.assertGreater(float(power[0]), 0.2)           # the patch faces the open window: 0.25 m2 x cos 5.7 degrees
        sun = replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.array([1.0, 2.0, 0.5]))
        lit, _ = reference.multiplier(d, n, f, p, c, m, sun)
        np.testing.assert_allclose(lit[0], 1.0 + 0.25 * float(power[0]) * np.array([1.0, 2.0, 0.5]) / 1.3, rtol=1e-9)   # the cove's float32 0.1
        moon = replace(reference.Setting.captured(m), moon_dir=OUT_OF_THE_WALL, moon_rgb=np.array([1.0, 2.0, 0.5]))
        np.testing.assert_allclose(reference.multiplier(d, n, f, p, c, m, moon)[0], lit, rtol=1e-12)
        shut = replace(m, horizons={"W1": np.full(360, 90.0, np.float32)})
        np.testing.assert_allclose(reference.multiplier(d, n, f, p, c, shut, sun)[0], 1.0, atol=1e-12)

    def test_the_basis_reaches_the_probes_trilinearly(self):
        m = replace(model(3, 0.5), sky=sky_basis())        # 0.5 m probes over the 1 m basis grid
        S1 = np.zeros((8, 3, 6)); S1[:, 0, 4] = [0, 0, 0, 0, 1, 1, 1, 1]           # value = x on the basis grid (ix major)
        out = reference.to_probes(m, S1)
        self.assertAlmostEqual(float(out[(1 * 3 + 0) * 3 + 0, 0, 4]), 0.5, places=12)   # probe x 0.5
        self.assertAlmostEqual(float(out[(2 * 3 + 2) * 3 + 2, 0, 4]), 1.0, places=12)   # probe x 1.0
        valid = np.ones(8, bool); valid[4:] = False                                     # the x = 1 plane is invalid
        out = reference.to_probes(replace(m, sky=sky_basis(valid=valid)), S1)
        self.assertEqual(float(out[(1 * 3 + 1) * 3 + 1, 0, 4]), 0.0)                   # only the x = 0 corners remain

    def test_a_covered_splat_is_lit_as_interior_and_hidden_while_its_group_draws(self):
        d, n, f, p, c = splats(2)
        f[1] = codec.cover_flags(np.array([codec.CLASS_INTERIOR], np.uint8), 3)[0]
        m = model(); s = reference.Setting.captured(m)
        M, a = reference.multiplier(d, n, f, p, c, m, s)
        np.testing.assert_allclose(M[1], M[0]); self.assertEqual(a.tolist(), [1.0, 1.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 3))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 2))
        self.assertEqual(a.tolist(), [1.0, 1.0])

    def test_a_toggled_splat_is_hidden_with_its_toggle(self):
        d, n, f, p, c = splats(2)
        f[:] = codec.toggle_flags(np.zeros(2, np.uint8), np.array([0, 2]))
        m = model(); s = reference.Setting.captured(m)
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b10))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b01))
        self.assertEqual(a.tolist(), [1.0, 1.0])


if __name__ == "__main__":
    unittest.main()

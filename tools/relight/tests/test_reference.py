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

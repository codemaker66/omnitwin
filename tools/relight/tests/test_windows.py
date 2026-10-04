import unittest
import numpy as np
from relight import windows

RES = 0.03
LO = np.array([0.0, -1.0, 0.0])          # grid corner; the wall's inner face is y0 = 0, the glass at -0.5
RECT = (0.3, 2.7, 0.5, 0.3, 2.7, "rect")
ARCH = (0.3, 2.7, 0.5, 0.3, 2.7, "arch")
HEAD_ON = np.array([0.0, -1.0, 0.0])


def grid(shape=(100, 34, 100)):
    return np.zeros(shape, np.float32)


def volume(occ=None, window=RECT, quantise=True, name="W"):
    occ = grid() if occ is None else occ
    return windows.volumes_from_occupancy(occ, LO, RES, {name: window}, 0.0, x_bearing=14.3, quantise=quantise)[name]


def unit(*v):
    v = np.asarray(v, np.float64)
    return v / np.linalg.norm(v)


def from_entry(xz, s, y=3.0):
    """The room point at depth y whose ray toward s crosses the wall face y = 0 at (x, z)."""
    s = np.asarray(s, np.float64)
    t = y / -s[1]
    return np.array([xz[0] - s[0] * t, y, xz[1] - s[2] * t])


def sun_toward(az, el, x_bearing=14.3):
    """Unit vector toward the sun at compass azimuth az, elevation el (the proof's common.sun_vec_e57)."""
    th, e = np.radians(x_bearing - az), np.radians(el)
    return np.array([np.cos(th) * np.cos(e), np.sin(th) * np.cos(e), np.sin(e)])


def lit(vol, points, s):
    return windows.march_visibility(vol, np.atleast_2d(points), s)


class Entry(unittest.TestCase):
    def test_an_empty_box_is_lit_only_inside_the_shrunk_outline(self):
        xs = [0.20, 0.34, 0.36, 1.5, 2.64, 2.66]          # the entry is the outline shrunk by 5 cm: 0.35 .. 2.65
        P = np.array([[x, 3.0, 1.5] for x in xs] + [[1.5, 3.0, 0.34], [1.5, 3.0, 0.36]])
        np.testing.assert_array_equal(lit(volume(), P, HEAD_ON), [0, 0, 1, 1, 1, 0, 0, 1])

    def test_an_arch_is_dark_outside_its_head(self):
        P = np.array([[0.45, 3.0, 2.55], [2.55, 3.0, 2.55], [1.5, 3.0, 2.5], [1.5, 3.0, 1.0]])
        np.testing.assert_array_equal(lit(volume(window=ARCH), P, HEAD_ON), [0, 0, 1, 1])

    def test_a_ray_must_leave_through_the_glass_outline(self):
        s = unit(0.6, -0.8, 0.0)                          # drifts 0.375 m sideways from the wall face to the glass
        out = lit(volume(), [from_entry((2.4, 1.5), s), from_entry((2.0, 1.5), s)], s)
        np.testing.assert_array_equal(out, [0, 1])        # leaves at x = 2.775 (outside 2.67) / 2.375

    def test_the_exit_keeps_3_cm_inside_the_jamb(self):
        s = unit(0.6, -0.8, 0.0)                          # leaves the glass 0.375 m along x from where it entered
        entries = [2.285, 2.290, 2.300, 2.310]            # leaves at 2.66, 2.665 (inside 2.67), 2.675, 2.685 (outside)
        out = lit(volume(), [from_entry((x, 1.5), s) for x in entries], s)
        np.testing.assert_array_equal(out, [1, 1, 0, 0])

    def test_the_exit_keeps_3_cm_below_the_head(self):
        s = unit(0.0, -0.8, 0.6)                          # leaves the glass 0.375 m higher than it entered
        out = lit(volume(), [from_entry((1.5, z), s) for z in (2.290, 2.300)], s)
        np.testing.assert_array_equal(out, [1, 0])        # leaves at 2.665 (inside 2.67) / 2.675

    def test_the_exit_keeps_3_cm_inside_the_arch(self):
        s = unit(0.0, -0.8, 0.6)
        head = 1.5 + np.sqrt(1.17 ** 2 - 0.7 ** 2)        # the 3 cm-shrunk semicircle (radius 1.17) at x = 2.2
        out = lit(volume(window=ARCH), [from_entry((2.2, head - 0.375 + d), s) for d in (-0.005, 0.005)], s)
        np.testing.assert_array_equal(out, [1, 0])

    def test_rays_longer_than_the_cap_are_dark(self):
        far, near = unit(0.96, -0.25, 0.0), unit(0.96, -0.27, 0.0)   # 0.57 m deep: 2.26 m / 2.11 m of ray
        self.assertEqual(float(lit(volume(), from_entry((0.4, 1.5), far), far)[0]), 0.0)
        self.assertEqual(float(lit(volume(), from_entry((0.4, 1.5), near), near)[0]), 1.0)

    def test_the_sun_must_face_the_wall(self):
        self.assertEqual(float(lit(volume(), [1.5, 3.0, 1.5], np.array([0.0, 1.0, 0.0]))[0]), 0.0)
        self.assertEqual(float(lit(volume(), [1.5, 3.0, 1.5], unit(1.0, -0.0005, 0.0))[0]), 0.0)


class Embrasure(unittest.TestCase):
    def test_a_point_in_the_embrasure_skips_its_own_cell(self):
        occ = grid()
        occ[50, 26, 50] = 0.99                             # the cell holding (1.51, -0.205, 1.51)
        vol = volume(occ)
        self.assertEqual(float(lit(vol, [1.51, -0.205, 1.51], HEAD_ON)[0]), 1.0)
        self.assertLess(float(lit(vol, [1.51, 3.0, 1.51], HEAD_ON)[0]), 0.05)   # a room ray through it is not spared

    def test_a_point_in_the_embrasure_belongs_within_25_cm_of_the_outline(self):
        s = unit(0.8, -0.6, 0.0)                           # from y = -0.2 it leaves the glass 0.4 m further along x
        out = lit(volume(), [[0.04, -0.2, 1.5], [0.06, -0.2, 1.5]], s)
        np.testing.assert_array_equal(out, [0, 1])         # x0 - 0.25 = 0.05


class March(unittest.TestCase):
    def test_the_march_samples_every_1_5_cm_at_the_nearest_cell(self):
        occ = grid()
        occ[:, 20, :] = 0.5                                # one layer, y = -0.40 .. -0.37
        vol = volume(occ, quantise=False)
        self.assertAlmostEqual(float(lit(vol, [1.5, 3.0, 1.5], HEAD_ON)[0]), 0.5, places=5)    # 2 samples
        steep = np.array([0.0, -0.5, np.sqrt(0.75)])
        self.assertAlmostEqual(float(lit(vol, from_entry((1.5, 0.6), steep), steep)[0]), 0.25, places=5)  # 4

    def test_the_march_samples_every_1_5_cm_to_7_cm_beyond_the_glass(self):
        vols = {"W": volume(window=(0.3, 2.7, 0.505, 0.3, 2.7, "rect"))}
        P = np.array([[1.5, 3.0, 1.5], [1.5, -0.1, 1.5]])        # a room point; a point 10 cm into the embrasure
        steps = np.zeros(2, np.int32)
        windows.sun_visibility(vols, {"W": np.full(360, -90.0)}, np.ones(101), P, HEAD_ON, steps=steps)
        np.testing.assert_array_equal(steps, [39, 29])            # t = 0 .. 0.57 < 0.575; t = 0.045 .. 0.465 < 0.475

    def test_alpha_is_stored_in_steps_of_1_255(self):
        occ = grid()
        occ[:, 20, :] = 0.5
        vol = volume(occ)
        self.assertEqual(int(vol.alpha.max()), 128)
        self.assertAlmostEqual(float(lit(vol, [1.5, 3.0, 1.5], HEAD_ON)[0]), 1 - 128 / 255, places=5)

    def test_the_march_stops_once_the_depth_reaches_6(self):
        occ = grid()
        occ[:, 10:20, :] = 1.0                             # every sample adds 0.5 x -log(0.005) = 2.65
        out = float(lit(volume(occ), [1.5, 3.0, 1.5], HEAD_ON)[0])
        self.assertAlmostEqual(out, float(np.exp(-3 * 0.5 * -np.log(0.005))), delta=1e-6)

    def test_the_march_stops_at_the_first_sample_past_6(self):
        occ = grid()
        occ[:, 10:20, :] = 0.9                             # each sample adds 0.5 x -log(0.1): 6.91 after six, 8.06 after seven
        out = float(lit(volume(occ, quantise=False), [1.5, 3.0, 1.5], HEAD_ON)[0])
        self.assertAlmostEqual(out, 0.1 ** 3, delta=1e-6)

    def test_a_bar_shades_its_own_shadow(self):
        occ = grid()
        occ[45:48, 16:18, :] = 0.99                        # x = 1.35..1.44 at the glass, y = -0.52..-0.46
        vol = volume(occ)
        np.testing.assert_array_less(lit(vol, [1.40, 3.0, 1.5], HEAD_ON), 0.01)
        self.assertEqual(float(lit(vol, [1.0, 3.0, 1.5], HEAD_ON)[0]), 1.0)
        s = unit(0.2, -1.0, 0.0)
        np.testing.assert_array_less(lit(vol, from_entry((1.30, 1.5), s), s), 0.01)   # meets the bar 10 cm on
        self.assertEqual(float(lit(vol, from_entry((2.0, 1.5), s), s)[0]), 1.0)


class Volumes(unittest.TestCase):
    def test_the_box_keeps_every_occupied_cell_a_ray_can_reach(self):
        occ = grid((300, 60, 100))
        kept = [(50, 25, 50), (163, 25, 50)]               # in the embrasure; 2.2 m beyond the jamb
        dropped = [(175, 25, 50), (50, 43, 50)]            # 2.55 m beyond the jamb; 0.3 m into the room
        for c in kept + dropped:
            occ[c] = 0.5
        vol = volume(occ)
        inside = [bool(np.all((np.array(c) >= vol.offset) & (np.array(c) < vol.offset + vol.alpha.shape))) for c in kept + dropped]
        self.assertEqual(inside, [True, True, False, False])
        np.testing.assert_allclose(vol.origin, LO + vol.offset * RES)

    def test_the_frame_round_trips(self):
        occ = grid()
        occ[40:60, 10:20, 30:70] = 0.3
        vol = volume(occ, window=ARCH)
        back = windows.volume_from_arrays("W", *windows.volume_arrays(vol))
        self.assertEqual(back.window, vol.window)
        self.assertEqual((back.y0, back.x_bearing, back.res), (vol.y0, vol.x_bearing, vol.res))
        np.testing.assert_array_equal(back.offset, vol.offset)
        P = np.stack([np.linspace(0.2, 2.8, 50), np.full(50, 3.0), np.linspace(0.5, 2.5, 50)], 1)
        s = unit(0.3, -1.0, 0.4)
        np.testing.assert_array_equal(lit(back, P, s), lit(vol, P, s))


class Sun(unittest.TestCase):
    def test_rays_belong_to_the_first_window_that_claims_them(self):
        a, b = (0.3, 1.5, 0.5, 0.3, 2.7, "rect"), (1.0, 2.7, 0.5, 0.3, 2.7, "rect")
        vols = windows.volumes_from_occupancy(grid(), LO, RES, {"A": a, "B": b}, 0.0, x_bearing=14.3)
        s = unit(0.6, -0.8, 0.2)                           # 11 degrees up: above both (flat) horizons
        P = from_entry((1.4, 1.5), s)                      # enters both outlines; leaves A's at 1.775 (outside)
        flat, fresnel = {"A": np.zeros(360), "B": np.zeros(360)}, np.ones(101)
        self.assertEqual(float(lit(vols["B"], P, s)[0]), 1.0)
        self.assertEqual(float(windows.sun_visibility(vols, flat, fresnel, np.atleast_2d(P), s)[0]), 0.0)
        swapped = {"B": vols["B"], "A": vols["A"]}
        self.assertEqual(float(windows.sun_visibility(swapped, flat, fresnel, np.atleast_2d(P), s)[0]), 1.0)

    def test_the_per_window_march_gives_each_ray_to_the_window_that_claims_it(self):
        a, b = (0.3, 1.5, 0.5, 0.3, 2.7, "rect"), (1.0, 2.7, 0.5, 0.3, 2.7, "rect")
        vols = windows.volumes_from_occupancy(grid(), LO, RES, {"A": a, "B": b}, 0.0, x_bearing=14.3)
        s = unit(0.6, -0.8, 0.2)                           # leaves the glass 0.375 m along x from where it entered
        P = np.array([from_entry((0.6, 1.5), s),           # enters A's outline only, leaves A's at 0.975: lit through A
                      from_entry((2.2, 1.5), s),           # enters B's only, leaves at 2.575: lit through B
                      from_entry((1.4, 1.5), s),           # enters both, A claims it, leaves A's at 1.775: dark, B never sees it
                      from_entry((5.0, 1.5), s)])          # enters neither
        fresnel = np.full(101, 0.5)
        out = windows.sun_visibility_by_window(vols, fresnel, P, s)
        self.assertEqual((out.shape, out.dtype), ((2, 4), np.float32))
        np.testing.assert_array_equal(out, [[0.5, 0.0, 0.0, 0.0], [0.0, 0.5, 0.0, 0.0]])
        flat = {"A": np.zeros(360), "B": np.zeros(360)}
        np.testing.assert_array_equal(out.sum(0), windows.sun_visibility(vols, flat, fresnel, P, s))    # no horizon: the same rays
        np.testing.assert_array_equal(windows.sun_visibility_by_window(vols, fresnel, P, unit(0.6, 0.8, 0.2)), np.zeros((2, 4), np.float32))
        np.testing.assert_array_equal(windows.sun_visibility_by_window(list(vols.values()), fresnel, P, s), out)   # a list works too

    def test_the_horizon_is_interpolated_at_the_suns_azimuth(self):
        horizon = np.zeros(360)
        horizon[99], horizon[100] = 10.0, 30.0             # 20 degrees at azimuth 99.5
        fresnel = np.linspace(0.0, 1.0, 101)
        vols = {"W": volume()}
        for el, expect_lit in ((19.0, False), (21.0, True)):
            s = sun_toward(99.5, el)
            v = float(windows.sun_visibility(vols, {"W": horizon}, fresnel, np.atleast_2d(from_entry((1.5, 1.0), s)), s)[0])
            self.assertAlmostEqual(v, abs(s[1]) if expect_lit else 0.0, places=5)

    def test_the_glass_transmission_is_interpolated_linearly(self):
        table = (np.arange(101) / 100.0) ** 2
        self.assertAlmostEqual(windows.fresnel_at(table, [0.0, -0.505, 0.0]), 0.25505, places=9)

    def test_sunlit_area_of_an_open_window_facing_the_sun_head_on(self):
        n = int(np.sum((0.015 + RES * np.arange(100) > 0.35) & (0.015 + RES * np.arange(100) < 2.65)))
        area = windows.sunlit_area(volume(), HEAD_ON)
        self.assertAlmostEqual(area, n * n * RES * RES, places=6)
        self.assertLess(abs(area - 2.3 * 2.3), 2 * 2.3 * RES)

LAT = 55.8593
NEEDED_4DEG = 935         # the 4-degree grid's needed nodes, pinned from the code on 4 October (two processes agree)


def sun_positions(dec, ha):
    """Apparent compass azimuth and elevation (degrees) at LAT for declinations and hour angles (degrees), with the
    refraction of the proof's common.solar_position."""
    lat, d, h = np.radians(LAT), np.radians(np.asarray(dec, np.float64)), np.radians(np.asarray(ha, np.float64))
    east = -np.cos(d) * np.sin(h)
    north = np.sin(d) * np.cos(lat) - np.cos(d) * np.cos(h) * np.sin(lat)
    el = np.degrees(np.arcsin(np.sin(d) * np.sin(lat) + np.cos(d) * np.cos(h) * np.cos(lat)))
    up = el > -0.575
    el[up] += 1.02 / np.tan(np.radians(el[up] + 10.3 / (el[up] + 5.11))) / 60.0
    return np.degrees(np.arctan2(east, north)) % 360.0, el


def real_suns(rng, n):
    """Unit vectors toward n random real sun positions at LAT (any declination within the solstices, any hour angle),
    plus n/2 on the two solstice paths, above the horizon."""
    dec = np.concatenate([rng.uniform(-23.44, 23.44, n), np.repeat([23.44, -23.44], n // 4)])
    az, el = sun_positions(dec, rng.uniform(-180.0, 180.0, dec.size))
    return [sun_toward(a, e) for a, e in zip(az, el) if e > 0.0]


def moon_positions(dec, ha, hp):
    """Apparent topocentric compass azimuth and elevation (degrees) at LAT of a moon at geocentric declination dec and
    hour angle ha with horizontal parallax hp (degrees): lowered along its vertical circle by asin(sin hp cos el) (a
    spherical Earth), then refracted as the proof refracts."""
    lat, d, h = np.radians(LAT), np.radians(np.asarray(dec, np.float64)), np.radians(np.asarray(ha, np.float64))
    east = -np.cos(d) * np.sin(h)
    north = np.sin(d) * np.cos(lat) - np.cos(d) * np.cos(h) * np.sin(lat)
    el = np.degrees(np.arcsin(np.sin(d) * np.sin(lat) + np.cos(d) * np.cos(h) * np.cos(lat)))
    el = el - np.degrees(np.arcsin(np.sin(np.radians(hp)) * np.cos(np.radians(el))))
    up = el > -0.575
    el[up] += 1.02 / np.tan(np.radians(el[up] + 10.3 / (el[up] + 5.11))) / 60.0
    return np.degrees(np.arctan2(east, north)) % 360.0, el


def real_moons(rng, n):
    """Unit vectors toward n random real moon positions at LAT (declinations up to the major standstill's 28.72, any
    hour angle, horizontal parallax 0.9..1.025), plus n/2 at the standstill's extremes, above the horizon."""
    dec = np.concatenate([rng.uniform(-28.72, 28.72, n), np.repeat([28.72, -28.72], n // 4)])
    az, el = moon_positions(dec, rng.uniform(-180.0, 180.0, dec.size), rng.uniform(0.9, 1.025, dec.size))
    return [sun_toward(a, e) for a, e in zip(az, el) if e > 0.0]


def bearing_elevation(d, x_bearing=14.3):
    d = np.asarray(d, np.float64)
    return (x_bearing - np.degrees(np.arctan2(d[..., 1], d[..., 0]))), np.degrees(np.arctan2(d[..., 2], np.hypot(d[..., 0], d[..., 1])))


class Reach(unittest.TestCase):
    def test_sun_reach_covers_every_sun_position_the_march_can_use(self):
        rng = np.random.default_rng(11)
        vol = volume(window=ARCH)                        # empty: every ray the geometry admits is lit
        P = np.concatenate([rng.uniform([-4.0, 0.01, -1.0], [7.0, 6.0, 4.0], (1500, 3)),    # the room
                            rng.uniform([-0.5, -0.7, -1.0], [3.5, 0.0, 4.0], (500, 3))])    # embrasure, glass, beyond
        reach = windows.sun_reach({"W": vol}, P, LAT)
        lit_somewhere = np.zeros(len(P), bool)
        for s in real_suns(rng, 600):
            on = lit(vol, P, s) > 0
            lit_somewhere |= on
            self.assertTrue(bool(np.all(reach[on])), f"lit but not flagged toward {s}")
        self.assertGreater(int(lit_somewhere.sum()), 300)

    def test_sun_reach_covers_suns_at_the_edge_of_the_year(self):
        # points 200 m back along suns on the two solstice paths (sunrises refracted): only those suns light them
        vol, X = volume(), np.array([1.5, -0.25, 1.5])                # mid-depth: enters and leaves inside the outline
        az, el = sun_positions(np.repeat([23.44, -23.44], 360), np.tile(np.arange(-180.0, 180.0), 2))
        suns = [s for s in (sun_toward(a, e) for a, e in zip(az, el) if e > 0.0) if s[1] < -0.3]
        P = np.array([X - s * 200.0 for s in suns])
        self.assertGreater(len(suns), 60)
        self.assertTrue(all(float(lit(vol, p, s)[0]) > 0 for p, s in zip(P, suns)))
        np.testing.assert_array_equal(windows.sun_reach({"W": vol}, P, LAT), np.ones(len(P), bool))

    def test_sun_reach_covers_moons_at_the_major_standstill_from_rise_to_transit(self):
        # moons at declination +-28.6 and +-28.72 (2006's standstill), at both ends of the parallax range, every
        # degree of hour angle while up and facing the wall: points 200 m back along each, through a 10 cm deep window
        # that passes even the oblique transits (a deeper one darkens them by the 2.2 m cap)
        vol, X = volume(window=(0.3, 2.7, 0.1, 0.3, 2.7, "rect")), np.array([1.5, -0.05, 1.5])
        dec = np.repeat([28.6, -28.6, 28.72, -28.72], 2 * 360)
        hp = np.tile(np.repeat([0.9, 1.025], 360), 4)
        ha = np.tile(np.arange(-180.0, 180.0), 8)
        az, el = moon_positions(dec, ha, hp)
        moons = [(sun_toward(a, e), h, e) for a, e, h in zip(az, el, ha)]
        moons = [(s, h, e) for s, h, e in moons if e > 0.0 and s[1] < -0.08]     # within the cap: 0.17 m / 0.08 < 2.2 m
        self.assertTrue(any(h == 0.0 for _s, h, _e in moons))                      # transits
        self.assertTrue(any(e < 1.0 for _s, _h, e in moons))                       # just after moonrise
        P = np.array([X - s * 200.0 for s, _h, _e in moons])
        self.assertTrue(all(float(lit(vol, p, s)[0]) > 0 for p, (s, _h, _e) in zip(P, moons)))
        np.testing.assert_array_equal(windows.sun_reach({"W": vol}, P, LAT), np.ones(len(P), bool))

    def test_sun_reach_covers_every_moon_position_the_march_can_use(self):
        rng = np.random.default_rng(17)
        vol = volume(window=ARCH)
        P = np.concatenate([rng.uniform([-4.0, 0.01, -1.0], [7.0, 6.0, 4.0], (1500, 3)),
                            rng.uniform([-0.5, -0.7, -1.0], [3.5, 0.0, 4.0], (500, 3))])
        reach = windows.sun_reach({"W": vol}, P, LAT)
        for s in real_moons(rng, 600):
            on = lit(vol, P, s) > 0
            self.assertTrue(bool(np.all(reach[on])), f"lit but not flagged toward {s}")

    def test_the_opening_box_holds_every_direction_through_the_opening(self):
        rng = np.random.default_rng(3)
        vol = volume(window=ARCH)
        P = np.concatenate([rng.uniform([-3.0, 0.0, -2.0], [6.0, 3.0, 5.0], (200, 3)),
                            rng.uniform([-1.0, -0.9, -1.0], [4.0, -0.52, 4.0], (100, 3))])   # also beyond the glass
        gx, gz = np.meshgrid(np.linspace(vol.x0, vol.x1, 61), np.linspace(vol.sill, vol.top, 61))
        G = np.stack([gx.ravel(), np.full(gx.size, vol.y0 - vol.depth), gz.ravel()], 1)
        az_lo, az_hi, el_lo, el_hi = windows.opening_directions(vol, P)
        for i, p in enumerate(P):
            d = (G - p) * np.sign(p[1] - (vol.y0 - vol.depth))          # oriented toward the wall
            az, el = bearing_elevation(d)
            self.assertTrue(az_lo[i] - 1e-9 <= az.min() and az.max() <= az_hi[i] + 1e-9)
            self.assertTrue(el_lo[i] - 1e-9 <= el.min() and el.max() <= el_hi[i] + 1e-9)
            self.assertLess(el_hi[i] - el.max(), 0.5)                   # and tight

    def test_the_sun_band_test_misses_no_sun_in_a_box(self):
        rng = np.random.default_rng(9)
        a0, e0 = rng.uniform(15.0, 190.0, 400), rng.uniform(-3.0, 70.0, 400)
        a1, e1 = a0 + rng.uniform(0.0, 40.0, 400), e0 + rng.uniform(0.0, 15.0, 400)
        meets = windows.sun_band_meets(a0, a1, e0, e1, LAT)
        lat, band = np.radians(LAT), np.sin(np.radians(23.44))
        for i in range(400):
            az, el = np.meshgrid(np.radians(np.linspace(a0[i], a1[i], 60)), np.radians(np.linspace(max(e0[i], 0.0), e1[i], 60)))
            g = np.cos(el) * np.cos(az) * np.cos(lat) + np.sin(el) * np.sin(lat)
            if e1[i] >= 0.0 and np.any(np.abs(g) <= band):
                self.assertTrue(bool(meets[i]), f"box {a0[i]:.1f}..{a1[i]:.1f} x {e0[i]:.1f}..{e1[i]:.1f}")

    def test_the_band_test_misses_no_moon_in_a_box(self):
        # a box of apparent directions holds a moon when one of them, raised by a parallax of up to 1.025 degrees,
        # lies on a declination circle within the major standstill's 28.72
        rng = np.random.default_rng(19)
        a0, e0 = rng.uniform(15.0, 190.0, 400), rng.uniform(-3.0, 70.0, 400)
        a1, e1 = a0 + rng.uniform(0.0, 40.0, 400), e0 + rng.uniform(0.0, 15.0, 400)
        meets = windows.sun_band_meets(a0, a1, e0, e1, LAT)
        lat, band = np.radians(LAT), np.sin(np.radians(28.72))
        for i in range(400):
            for p in (0.0, 0.5, 1.025):
                az, el = np.meshgrid(np.radians(np.linspace(a0[i], a1[i], 60)), np.radians(np.linspace(max(e0[i], 0.0), e1[i], 60) + p))
                g = np.cos(el) * np.cos(az) * np.cos(lat) + np.sin(el) * np.sin(lat)
                if e1[i] >= 0.0 and np.any(np.abs(g) <= band):
                    self.assertTrue(bool(meets[i]), f"box {a0[i]:.1f}..{a1[i]:.1f} x {e0[i]:.1f}..{e1[i]:.1f}")

    def test_sun_reach_leaves_out_points_no_sun_or_moon_can_reach(self):
        P = np.array([[1.5, 3.0, 1.5],                   # in front of the window: morning sun much of the year
                      [1.5, 2.0, 12.0],                  # far above it: sees the opening only looking down
                      [-30.0, 2.0, 1.5]])                # far along the wall: bearings 18.7..19.0, north of every moonrise
        np.testing.assert_array_equal(windows.sun_reach({"W": volume()}, P, LAT), [True, False, False])

    def test_the_sky_band_at_this_latitude(self):
        # due south a direction's declination is its elevation - 34.14; the box reaches 1.1 degrees lower (0.5 pad +
        # 0.6 refraction) and 1.53 higher (0.5 pad + 1.03 parallax); the band holds declinations within 28.75
        boxes = np.array([[179.9, 180.1, 57.0, 57.1],    # summer noon's sun (57.58)
                          [179.9, 180.1, 59.8, 60.2],    # above every sun; a moon up to 27.6
                          [179.9, 180.1, 10.5, 10.6],    # winter noon's sun (10.70)
                          [179.9, 180.1, 9.0, 9.5],      # below every sun; a moon down to -26.2
                          [29.5, 30.5, 0.0, 5.0],        # north of every sunrise (44.8); the standstill moon rises at 31
                          [49.9, 50.1, 3.0, 4.0],        # a summer morning just after sunrise
                          [160.0, 200.0, 57.5, 57.6],    # wide over noon
                          [179.9, 180.1, 58.65, 58.7],
                          [179.9, 180.1, 64.1, 64.2],    # reaches no lower than declination 28.85: above every moon
                          [179.9, 180.1, 63.8, 63.9],    # reaches 28.55
                          [179.9, 180.1, 3.0, 3.4],      # reaches no higher than -29.21: below every moon
                          [179.9, 180.1, 3.9, 4.0],      # reaches -28.61
                          [20.0, 21.0, 0.0, 2.0]])       # north of every moonrise: declination 30.4 and up
        expected = [True, True, True, True, True, True, True, True, False, True, False, True, False]
        np.testing.assert_array_equal(windows.sun_band_meets(*boxes.T, LAT), expected)

    def test_ray_survives_is_where_the_march_is_lit(self):
        rng = np.random.default_rng(5)
        occ = (rng.random((100, 34, 100)) < 0.05).astype(np.float32)
        vol = volume(occ)
        P = rng.uniform([-1.0, -0.7, 0.0], [4.0, 4.0, 3.0], (3000, 3))
        for s in real_suns(rng, 20):
            np.testing.assert_array_equal(windows.ray_survives(vol, P, s), lit(vol, P, s) > 0)


class CheckGate(unittest.TestCase):
    def test_check_sun_scores_any_lit_union_unrounded_and_bounds_the_march_everywhere(self):
        from relight import __main__ as cli
        rows = [dict(scored=False, iou=0.0, meanAbsDiff=0.0, floatAlphaMaxAbsDiff=0.0),      # nothing lit: not scored
                dict(scored=True, iou=0.84999, meanAbsDiff=0.0, floatAlphaMaxAbsDiff=0.0),   # would round to 0.85
                dict(scored=True, iou=1.0, meanAbsDiff=0.1000001, floatAlphaMaxAbsDiff=0.0),
                dict(scored=False, iou=0.0, meanAbsDiff=0.0, floatAlphaMaxAbsDiff=2e-4),     # the march itself drifts
                dict(scored=True, iou=0.9999, meanAbsDiff=0.0004, floatAlphaMaxAbsDiff=8e-6)]
        self.assertEqual([cli._passes(r) for r in rows], [True, False, False, False, True])
        a = cli._agreement(np.zeros(4, np.float32), np.array([0, 0.5, 0, 0], np.float32), np.zeros(4, np.float32))
        self.assertTrue(a["scored"] and a["lit3d"] == 0 and a["iou"] == 0.0)                 # the twin alone lights


class SunGrid(unittest.TestCase):
    def test_the_4_degree_grid_spans_the_sky_band_and_every_real_sun_and_moon_cell(self):
        # derived by hand: the highest band cell is [62, 66] (the standstill moon transits at 62.89, the cell reaches
        # 1.1 lower) and the northernmost moonrise box edge is at bearing 27.72 (31.03 at the horizon, the box reaching
        # 1.1 below it), so the first cell starts at 24 and the last at 332
        az0, el0, needed = windows.sun_nodes(LAT, 4.0)
        self.assertEqual((az0, el0, needed.shape, int(needed.sum())), (24.0, -2.0, (18, 79), NEEDED_4DEG))
        rng = np.random.default_rng(13)
        for s in real_suns(rng, 400) + real_moons(rng, 400):
            az, el = windows.sun_az_el(s, 14.3)
            corners = windows.sun_corners(az0, el0, 4.0, needed.shape, az, el)
            j, i, _w = corners[0]
            self.assertTrue(0 <= i <= 77 and 0 <= j <= 16, f"sun or moon at {az:.2f}, {el:.2f}")
            self.assertTrue(all(bool(needed[jj, ii]) for jj, ii, _ in corners), f"sun or moon at {az:.2f}, {el:.2f}")

    def test_the_corners_are_bilinear_and_read_the_edge_beyond_the_grid(self):
        table = (np.arange(4)[None, :] + 10.0 * np.arange(3)[:, None])                      # t[j, i] = i + 10 j

        def at(az, el):
            return sum(w * table[j, i] for j, i, w in windows.sun_corners(40.0, -2.0, 4.0, table.shape, az, el))
        self.assertAlmostEqual(at(45.0, 0.0), 6.25, places=12)                               # x = 1.25, y = 0.5
        self.assertEqual(at(52.0, 6.0), 23.0)                                                # the last node itself
        self.assertEqual(at(30.0, 70.0), 20.0)                                               # beyond the grid: its edge
        self.assertEqual([(j, i) for j, i, _w in windows.sun_corners(40.0, -2.0, 4.0, (3, 4), 45.0, 0.0)],
                         [(0, 1), (0, 2), (1, 1), (1, 2)])

    def test_sun_vector_points_at_its_azimuth_and_elevation(self):
        for az, el in ((98.944851, 32.713999), (180.0, 10.0), (60.0, 0.0)):
            s = windows.sun_vector(az, el, 14.3)
            np.testing.assert_allclose(s, sun_toward(az, el), rtol=0, atol=1e-15)
            back_az, back_el = windows.sun_az_el(s, 14.3)
            self.assertAlmostEqual(back_az, az, places=9)
            self.assertAlmostEqual(back_el, el, places=9)


class Tables(unittest.TestCase):
    def test_fresnel_table_has_101_entries_rising_to_normal_incidence(self):
        t = windows.fresnel_table(lambda c: 0.92 * c ** 0.1)
        self.assertEqual(len(t), 101)
        self.assertGreater(t[100], t[10])


if __name__ == "__main__":
    unittest.main()

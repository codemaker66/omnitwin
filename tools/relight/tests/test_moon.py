import unittest
import numpy as np
from relight import moon, windows

LAT = 55.8593


class Published(unittest.TestCase):
    def test_meeus_example_47a(self):
        # Meeus, Astronomical Algorithms, example 47.a: 1992 April 12 at 0h TD (JDE 2448724.5)
        lam, beta, dist = moon.ecliptic(2448724.5)
        self.assertAlmostEqual(float(lam), 133.162655, delta=1e-3)
        self.assertAlmostEqual(float(beta), -3.229126, delta=1e-3)
        self.assertAlmostEqual(float(dist), 368409.7, delta=1.0)
        ra, dec, _dist = moon.equatorial(2448724.5)
        self.assertAlmostEqual(float(ra), 134.688470, delta=2e-3)
        self.assertAlmostEqual(float(dec), 13.768368, delta=2e-3)

    def test_the_new_moon_of_meeus_example_49a_shares_the_suns_apparent_longitude(self):
        # Meeus example 49.a: the New Moon of 1977 February 18 at JDE 2443192.65118; the sun's apparent longitude from
        # Meeus 25's low-accuracy formulae (the proof's NOAA solar model), aberration and the main nutation included
        jde = 2443192.65118
        T = (jde - 2451545.0) / 36525.0
        M = np.radians(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
        C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * np.sin(M) + (0.019993 - 0.000101 * T) * np.sin(2 * M)
             + 0.000289 * np.sin(3 * M))
        sun = 280.46646 + 36000.76983 * T + 0.0003032 * T * T + C - 0.00569 - 0.00478 * np.sin(np.radians(125.04 - 1934.136 * T))
        lam, _beta, _dist = moon.ecliptic(jde)
        dpsi, _deps = moon.nutation(jde)
        self.assertLess(abs((float(lam + dpsi) - sun + 180.0) % 360.0 - 180.0), 0.02)


class Topocentric(unittest.TestCase):
    def test_parallax_lowers_the_moon_by_asin_rho_sin_pi_cos_elevation(self):
        H = np.linspace(-150.0, 150.0, 61)
        dist = np.full(H.shape, 360000.0)
        _az, el_geo = moon.horizontal(H, np.full(H.shape, 10.0), LAT)
        Ht, dt = moon.topocentric(H, np.full(H.shape, 10.0), dist, LAT)
        _az, el_top = moon.horizontal(Ht, dt, LAT)
        sin_pi = moon.EARTH_RADIUS_KM / 360000.0                       # the geocentric radius at 55.86 N is 0.9977
        expected = np.degrees(np.arcsin(0.9977 * sin_pi * np.cos(np.radians(el_top))))
        np.testing.assert_allclose(el_geo - el_top, expected, rtol=0, atol=4e-3)

    def test_horizontal_azimuth_is_a_compass_bearing(self):
        az, el = moon.horizontal(np.array([0.0, 90.0, -90.0]), np.array([0.0, 0.0, 0.0]), LAT)
        np.testing.assert_allclose(az, [180.0, 270.0, 90.0], rtol=0, atol=1e-9)    # south at transit, west, east
        self.assertAlmostEqual(float(el[0]), 90.0 - LAT, places=9)

    def test_julian_day(self):
        self.assertEqual(moon.julian_day(1992, 4, 12), 2448724.5)        # Meeus example 47.a
        self.assertEqual(moon.julian_day(2000, 1, 1, 12.0), 2451545.0)   # J2000.0


class Band(unittest.TestCase):
    def test_over_a_nodal_cycle_the_moon_stays_inside_the_sky_band(self):
        jd = moon.julian_day(2020, 1, 1) + np.arange(0.0, moon.NODAL_CYCLE_DAYS, 1.0 / 24.0)
        _ra, dec, dist = moon.equatorial(jd)
        self.assertLess(float(np.abs(dec).max()), windows.SKY_DECLINATION_MAX)
        self.assertGreater(float(np.abs(dec).max()), 28.5)                # the major standstill of 2024-25 is in the cycle
        self.assertLess(float(np.degrees(np.arcsin(moon.EARTH_RADIUS_KM / dist.min()))), windows.SKY_PARALLAX_MAX)


if __name__ == "__main__":
    unittest.main()

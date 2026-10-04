"""The moon's apparent topocentric position (spec 4.3, amended 3 October: moonlight is a light source like the sun).

J. Meeus, Astronomical Algorithms, 2nd ed. (Willmann-Bell, 1998):
  chapter 47, the main periodic terms of ELP-2000/82 (Tables 47.A and 47.B): geocentric ecliptic longitude, latitude
  and distance, about 10" and 4" from the full theory;
  chapter 22, the mean obliquity (22.2) and the low-accuracy nutation (0.5" in longitude, 0.1" in obliquity);
  chapter 12, the sidereal time at Greenwich (12.4), made apparent with the equation of the equinoxes;
  chapter 40, the topocentric parallax (40.2, 40.3) for a geodetic latitude and height;
  chapter 13, the horizontal coordinates (13.5, 13.6).
Refraction is the proof's (common.solar_position, Saemundsson's formula above -0.575 degrees), so the sun and the moon
share it. Times are UT Julian days; the series takes TD = UT + DELTA_T.
"""
from __future__ import annotations

import numpy as np

DELTA_T = 69.0                  # seconds, TD - UT in the 2020s
NODAL_CYCLE_DAYS = 6798.38      # one revolution of the moon's nodes (18.6 years): every declination extreme recurs
EARTH_RADIUS_KM = 6378.14       # Meeus' equatorial radius (chapter 40)
FLATTENING_RATIO = 0.99664719   # b / a of the Earth (Meeus 40)

# Table 47.A: multiples of D, M, M', F; longitude (1e-6 degree, sine); distance (1e-3 km, cosine)
TABLE_LR = (
    (0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111), (2, 0, 0, 0, 658314, -2955968),
    (0, 0, 2, 0, 213618, -569925), (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
    (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138), (2, 0, 1, 0, 53322, -170733),
    (2, -1, 0, 0, 45758, -204586), (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
    (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321), (0, 0, 1, 2, -12528, 0),
    (0, 0, 1, -2, 10980, 79661), (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
    (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208), (2, 1, 0, 0, -6766, 30824),
    (1, 0, -1, 0, -5163, -8379), (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
    (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650), (2, 0, -3, 0, 3665, 14403),
    (0, 1, -2, 0, -2689, -7003), (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
    (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884), (0, 1, 2, 0, -2120, 5751),
    (0, 2, 0, 0, -2069, 0), (2, -2, -1, 0, 2048, -4950), (2, 0, 1, -2, -1773, 4130),
    (2, 0, 0, 2, -1595, 0), (4, -1, -1, 0, 1215, -3958), (0, 0, 2, 2, -1110, 0),
    (3, 0, -1, 0, -892, 3258), (2, 1, 1, 0, -810, 2616), (4, -1, -2, 0, 759, -1897),
    (0, 2, -1, 0, -713, -2117), (2, 2, -1, 0, -700, 2354), (2, 1, -2, 0, 691, 0),
    (2, -1, 0, -2, 596, 0), (4, 0, 1, 0, 549, -1423), (0, 0, 4, 0, 537, -1117),
    (4, -1, 0, 0, 520, -1571), (1, 0, -2, 0, -487, -1739), (2, 1, 0, -2, -399, 0),
    (0, 0, 2, -2, -381, -4421), (1, 1, 1, 0, 351, 0), (3, 0, -2, 0, -340, 0),
    (4, 0, -3, 0, 330, 0), (2, -1, 2, 0, 327, 0), (0, 2, 1, 0, -323, 1165),
    (1, 1, -1, 0, 299, 0), (2, 0, 3, 0, 294, 0), (2, 0, -1, -2, 0, 8752),
)
# Table 47.B: multiples of D, M, M', F; latitude (1e-6 degree, sine)
TABLE_B = (
    (0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693), (2, 0, 0, -1, 173237),
    (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271), (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198),
    (2, 0, 1, -1, 9266), (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
    (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463), (2, -1, 0, 1, 2211),
    (2, -1, -1, -1, 2065), (0, 1, -1, -1, -1870), (4, 0, -1, -1, 1828), (0, 1, 0, 1, -1794),
    (0, 0, 0, 3, -1749), (0, 1, -1, 1, -1565), (1, 0, 0, 1, -1491), (0, 1, 1, 1, -1475),
    (0, 1, 1, -1, -1410), (0, 1, 0, -1, -1344), (1, 0, 0, -1, -1335), (0, 0, 3, 1, 1107),
    (4, 0, 0, -1, 1021), (4, 0, -1, 1, 833), (0, 0, 1, -3, 777), (4, 0, -2, 1, 671),
    (2, 0, 0, -3, 607), (2, 0, 2, -1, 596), (2, -1, 1, -1, 491), (2, 0, -2, 1, -451),
    (0, 0, 3, -1, 439), (2, 0, 2, 1, 422), (2, 0, -3, -1, 421), (2, 1, -1, 1, -366),
    (2, 1, 0, 1, -351), (4, 0, 0, 1, 331), (2, -1, 1, 1, 315), (2, -2, 0, -1, 302),
    (0, 0, 1, 3, -283), (2, 1, 1, -1, -229), (1, 1, 0, -1, 223), (1, 1, 0, 1, 223),
    (0, 1, -2, -1, -220), (2, 1, -1, -1, -220), (1, 0, 1, 1, -185), (2, -1, -2, -1, 181),
    (0, 1, 2, 1, -177), (4, 0, -2, -1, 176), (4, -1, -1, -1, 166), (1, 0, 1, -1, -164),
    (4, 0, 1, -1, 132), (1, 0, -1, -1, -119), (4, -1, 0, -1, 115), (2, -2, 0, 1, 107),
)


def julian_day(year, month, day, hour=0.0):
    """Meeus 7.1, Gregorian calendar (years after 1582)."""
    if month <= 2:
        year, month = year - 1, month + 12
    a = year // 100
    return int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + hour / 24.0 + 2 - a + a // 4 - 1524.5


def _centuries(jd):
    return (np.asarray(jd, np.float64) - 2451545.0) / 36525.0


def ecliptic(jde):
    """Geocentric ecliptic longitude and latitude (degrees, mean equinox of date) and distance (km) at JDE (Meeus 47:
    the arguments 47.1-47.6, Tables 47.A and 47.B with E and E^2 on the terms in M and 2M, and the additive terms)."""
    T = _centuries(jde)
    Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2 + T ** 3 / 538841.0 - T ** 4 / 65194000.0
    D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2 + T ** 3 / 545868.0 - T ** 4 / 113065000.0
    M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000.0
    Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2 + T ** 3 / 69699.0 - T ** 4 / 14712000.0
    F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T ** 2 - T ** 3 / 3526000.0 + T ** 4 / 863310000.0
    E = 1.0 - 0.002516 * T - 0.0000074 * T ** 2
    A1, A2, A3 = 119.75 + 131.849 * T, 53.09 + 479264.290 * T, 313.45 + 481266.484 * T
    r = np.radians
    sl = sr = sb = 0.0
    for d, m, mp, f, cl, cr in TABLE_LR:
        arg, e = r(d * D + m * M + mp * Mp + f * F), E ** abs(m)
        sl = sl + cl * e * np.sin(arg)
        sr = sr + cr * e * np.cos(arg)
    for d, m, mp, f, cb in TABLE_B:
        sb = sb + cb * E ** abs(m) * np.sin(r(d * D + m * M + mp * Mp + f * F))
    sl = sl + 3958 * np.sin(r(A1)) + 1962 * np.sin(r(Lp - F)) + 318 * np.sin(r(A2))
    sb = sb + (-2235 * np.sin(r(Lp)) + 382 * np.sin(r(A3)) + 175 * np.sin(r(A1 - F)) + 175 * np.sin(r(A1 + F))
               + 127 * np.sin(r(Lp - Mp)) - 115 * np.sin(r(Lp + Mp)))
    return (Lp + sl / 1e6) % 360.0, sb / 1e6, 385000.56 + sr / 1000.0


def nutation(jde):
    """Nutation in longitude and in obliquity (degrees): Meeus 22's low-accuracy terms."""
    T = _centuries(jde)
    om, L, Lm = np.radians(125.04452 - 1934.136261 * T), np.radians(280.4665 + 36000.7698 * T), np.radians(218.3165 + 481267.8813 * T)
    dpsi = -17.20 * np.sin(om) - 1.32 * np.sin(2 * L) - 0.23 * np.sin(2 * Lm) + 0.21 * np.sin(2 * om)
    deps = 9.20 * np.cos(om) + 0.57 * np.cos(2 * L) + 0.10 * np.cos(2 * Lm) - 0.09 * np.cos(2 * om)
    return dpsi / 3600.0, deps / 3600.0


def mean_obliquity(jde):
    """Meeus 22.2, degrees."""
    T = _centuries(jde)
    return 23.4392911 - 0.0130042 * T - 1.64e-7 * T ** 2 + 5.04e-7 * T ** 3


def equatorial(jde):
    """Apparent geocentric right ascension and declination (degrees) and distance (km): the series, nutation added."""
    lam, beta, dist = ecliptic(jde)
    dpsi, deps = nutation(jde)
    eps = np.radians(mean_obliquity(jde) + deps)
    lam, beta = np.radians(lam + dpsi), np.radians(beta)
    ra = np.degrees(np.arctan2(np.sin(lam) * np.cos(eps) - np.tan(beta) * np.sin(eps), np.cos(lam))) % 360.0
    dec = np.degrees(np.arcsin(np.sin(beta) * np.cos(eps) + np.cos(beta) * np.sin(eps) * np.sin(lam)))
    return ra, dec, dist


def sidereal_time(jd_ut, jde):
    """Apparent sidereal time at Greenwich (degrees): Meeus 12.4 plus the equation of the equinoxes."""
    days = np.asarray(jd_ut, np.float64) - 2451545.0
    T = days / 36525.0
    theta = 280.46061837 + 360.98564736629 * days + 0.000387933 * T ** 2 - T ** 3 / 38710000.0
    dpsi, deps = nutation(jde)
    return (theta + dpsi * np.cos(np.radians(mean_obliquity(jde) + deps))) % 360.0


def topocentric(H, dec, dist, latitude, height=0.0):
    """Meeus 40.2-40.3: the hour angle and declination (degrees) seen from geodetic latitude and height (m), from the
    geocentric hour angle H, declination and distance (km)."""
    phi = np.radians(latitude)
    u = np.arctan(FLATTENING_RATIO * np.tan(phi))
    rho_sin = FLATTENING_RATIO * np.sin(u) + height / 6378140.0 * np.sin(phi)
    rho_cos = np.cos(u) + height / 6378140.0 * np.cos(phi)
    sin_pi = EARTH_RADIUS_KM / np.asarray(dist, np.float64)
    h, d = np.radians(H), np.radians(dec)
    dra = np.arctan2(-rho_cos * sin_pi * np.sin(h), np.cos(d) - rho_cos * sin_pi * np.cos(h))
    dt = np.arctan2((np.sin(d) - rho_sin * sin_pi) * np.cos(dra), np.cos(d) - rho_cos * sin_pi * np.cos(h))
    return np.degrees(h - dra), np.degrees(dt)


def horizontal(H, dec, latitude):
    """Meeus 13.5-13.6: compass azimuth (from north, eastward) and elevation (degrees) of hour angle H, declination dec."""
    h, d, phi = np.radians(H), np.radians(dec), np.radians(latitude)
    el = np.degrees(np.arcsin(np.sin(phi) * np.sin(d) + np.cos(phi) * np.cos(d) * np.cos(h)))
    az = (np.degrees(np.arctan2(np.sin(h), np.cos(h) * np.sin(phi) - np.tan(d) * np.cos(phi))) + 180.0) % 360.0
    return az, el


def refract(el):
    """The proof's refraction (common.solar_position): Saemundsson's formula, added above -0.575 degrees."""
    el = np.asarray(el, np.float64)
    with np.errstate(all="ignore"):
        bend = 1.02 / np.tan(np.radians(el + 10.3 / (el + 5.11))) / 60.0
    return np.where(el > -0.575, el + bend, el)


def position(jd_ut, latitude, longitude, height=0.0, delta_t=DELTA_T):
    """The moon's apparent topocentric compass azimuth and elevation (degrees, refraction added) and geocentric
    distance (km) at UT Julian day jd_ut, from geodetic latitude, east longitude (degrees) and height (m)."""
    jde = np.asarray(jd_ut, np.float64) + delta_t / 86400.0
    ra, dec, dist = equatorial(jde)
    H, dec_t = topocentric(sidereal_time(jd_ut, jde) + longitude - ra, dec, dist, latitude, height)
    az, el = horizontal(H, dec_t, latitude)
    return az, refract(el), dist

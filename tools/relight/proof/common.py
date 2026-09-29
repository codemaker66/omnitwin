"""Shared constants and frame transforms for the relight proof (research only, not product code).

Frames
  json  : vendor LCC native frame of the served SOG tiles (metres, z up)
  e57   : E57 LiDAR world frame used by the 24 Sep capture-lighting audit (window wall at y = Y0,
          floor z ~ 0, +x bearing 14.3 deg, window wall outward normal -y = bearing 104.3 deg)
  room  : product/planner frame (manifest: position [4.911651, 2.2253, -8.5714], rotation [-pi/2,0,0])
"""
import json
import os
import numpy as np

import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from relight import config as _config  # noqa: E402

CFG = _config.load(os.environ["RELIGHT_CONFIG"])
ROOT = os.path.dirname(CFG.paths["work"])
WORK = CFG.paths["work"]
SPLATS = CFG.paths["splats"]
CANON = CFG.paths["canonicalFrame"]
AUDIT = CFG.paths["audit"]
REPO = CFG.paths["repo"]

# Same order as the product's RoomSplatScene mount (environment first, then the finest level)
TILES = list(CFG.room["finestTiles"])
MANIFEST_T = np.array(CFG.room["manifestTranslation"])

_canon = json.load(open(CANON))
T_JE = np.array(_canon["T_json_from_e57"], dtype=np.float64)   # json = T_JE @ e57
T_EJ = np.linalg.inv(T_JE)

# Hall box and window wall in the E57 frame (audit e57io.py, window_e57.py, sun_footprint.py)
_h = CFG.room["hallE57"]
X0, X1, Y0, Y1 = _h["x0"], _h["x1"], _h["y0"], _h["y1"]
FLOOR_Z = _h["floorZ"]          # E57 z of the floor (json -2.279 -> e57 ~0.026; 0.22 deg tilt ignored)
CEIL_Z = _h["ceilingZ"]         # flat ceiling (json 4.49)
FACADE_NORMAL_BEARING = 104.3
# name: (x0, x1, glass depth beyond wall plane, sill z, top z (apex for arches), kind)
# glass depths re-measured 29 Sep from the E57 return-density peak in each opening (the glazing
# bars in the splats sit at the same depth): W1 0.85, W2 0.63, W3 0.50, W4 0.63, W5 0.85 m
WINDOWS = {k: tuple(v) for k, v in CFG.room["windows"].items()}


def json_to_e57(p):
    return (p - T_JE[:3, 3]) @ T_JE[:3, :3]          # R^T (p - t)


def e57_to_json(p):
    return p @ T_JE[:3, :3].T + T_JE[:3, 3]


def json_to_room(p):
    return np.stack([p[..., 0] + MANIFEST_T[0], p[..., 2] + MANIFEST_T[1], -p[..., 1] + MANIFEST_T[2]], -1)


def room_to_json(p):
    return np.stack([p[..., 0] - MANIFEST_T[0], -(p[..., 2] - MANIFEST_T[2]), p[..., 1] - MANIFEST_T[1]], -1)


def e57_to_room(p):
    return json_to_room(e57_to_json(p))


def room_to_e57(p):
    return json_to_e57(room_to_json(p))


def sun_vec_e57(az_deg, el_deg):
    """Unit vector toward the sun in the E57 frame (audit e57io.sun_vec_e57)."""
    th = np.radians(14.3 - az_deg)
    el = np.radians(el_deg)
    return np.array([np.cos(th) * np.cos(el), np.sin(th) * np.cos(el), np.sin(el)])


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, None)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def solar_position(year, month, day, hour_utc, minute=0.0, lat=55.8593, lon=-4.2491):
    """NOAA solar position (azimuth from north clockwise, elevation incl. simple refraction), degrees."""
    import math
    def jd(y, m, d):
        if m <= 2:
            y -= 1; m += 12
        a = y // 100; b = 2 - a + a // 4
        return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + b - 1524.5
    t_hours = hour_utc + minute / 60.0
    JD = jd(year, month, day) + t_hours / 24.0
    T = (JD - 2451545.0) / 36525.0
    L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = math.radians(M)
    C = math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + math.sin(3 * Mr) * 0.000289
    true_long = L0 + C
    omega = 125.04 - 1934.136 * T
    lam = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))
    decl = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(lam))))
    y = math.tan(math.radians(eps / 2)) ** 2
    L0r = math.radians(L0)
    eqt = 4 * math.degrees(y * math.sin(2 * L0r) - 2 * e * math.sin(Mr) + 4 * e * y * math.sin(Mr) * math.cos(2 * L0r)
                           - 0.5 * y * y * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    tst = (t_hours * 60 + eqt + 4 * lon) % 1440
    ha = tst / 4 - 180 if tst / 4 >= 0 else tst / 4 + 180
    latr, dr, har = math.radians(lat), math.radians(decl), math.radians(ha)
    cz = math.sin(latr) * math.sin(dr) + math.cos(latr) * math.cos(dr) * math.cos(har)
    zen = math.degrees(math.acos(max(-1, min(1, cz))))
    el = 90 - zen
    az = (math.degrees(math.atan2(math.sin(har), math.cos(har) * math.sin(latr) - math.tan(dr) * math.cos(latr))) + 180) % 360
    if el > -0.575:  # refraction (Saemundsson approx)
        el += 1.02 / math.tan(math.radians(el + 10.3 / (el + 5.11))) / 60
    return az, el


def ensure_dirs():
    for d in ("work", "renders", "crops", "tmp", "scripts"):
        os.makedirs(f"{ROOT}/{d}", exist_ok=True)

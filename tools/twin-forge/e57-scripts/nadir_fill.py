"""Multi-view nadir tripod-hole fill — geometry core.

Each E57 sweep has a blind cone at nadir where the tripod occluded the
scanner, leaving a smeared blob on the floor of the equirect. The floor a
sweep hides is seen cleanly by its neighbours, so we reproject it back.

This module is the PURE geometry the fill stands on — no image I/O, no E57,
no bundle — so it is unit-testable in isolation (see
tests/test_nadir_geometry.py). The raster convention is IDENTICAL to
extract_equirect_v2.world_equirect_band_dirs, and MUST stay identical or a
reprojected pixel lands in the wrong place:

    World frame, Z-up.  row 0 = zenith (+Z), last row = nadir (-Z).
    el = pi/2 - (row + 0.5)/h * pi      az = (col + 0.5)/w * 2*pi
    dir = (cos_el*cos_az, cos_el*sin_az, sin_el)

Every sweep's equirect is world-ORIENTED but centred at that sweep's own
scanner, so reprojecting a world point P into a donor sweep centred at
C_donor is pure translation: the ray is simply (P - C_donor).
"""

from __future__ import annotations

import numpy as np

TWO_PI = 2.0 * np.pi


def equirect_pixel_to_world_dir(row: float, col: float, w: int, h: int) -> np.ndarray:
    """Pixel (row, col) -> unit world direction. Inverse of
    world_dir_to_equirect_pixel; matches world_equirect_band_dirs."""
    el = np.pi / 2.0 - (row + 0.5) / h * np.pi
    az = (col + 0.5) / w * TWO_PI
    cos_el = np.cos(el)
    return np.array(
        [cos_el * np.cos(az), cos_el * np.sin(az), np.sin(el)], dtype=np.float64
    )


def world_dir_to_equirect_pixel(d: np.ndarray, w: int, h: int) -> tuple[float, float]:
    """Unit (or any non-zero) world direction -> continuous (row, col).
    row/col are fractional; the caller samples with interpolation."""
    d = np.asarray(d, dtype=np.float64)
    n = np.linalg.norm(d)
    if n < 1e-12:
        raise ValueError("zero-length direction")
    d = d / n
    el = np.arcsin(np.clip(d[2], -1.0, 1.0))
    az = np.arctan2(d[1], d[0]) % TWO_PI
    row = (np.pi / 2.0 - el) / np.pi * h - 0.5
    col = az / TWO_PI * w - 0.5
    return float(row), float(col)


def ray_floor_intersection(
    C: np.ndarray, d: np.ndarray, z_floor: float
) -> np.ndarray | None:
    """World point where ray (origin C, direction d) meets the plane
    z = z_floor, or None if the ray points up/parallel or the hit is behind
    the origin. Only downward rays (d_z < 0) from above the floor hit."""
    C = np.asarray(C, dtype=np.float64)
    d = np.asarray(d, dtype=np.float64)
    dz = d[2]
    if dz >= 0.0:
        return None
    t = (z_floor - C[2]) / dz
    if t <= 0.0:
        return None
    return C + t * d


def reproject_point_to_pixel(
    P: np.ndarray, C_donor: np.ndarray, w: int, h: int
) -> tuple[float, float]:
    """Pixel in a donor sweep (centred at C_donor) that looks at world point
    P. Pure translation because donor equirects are world-oriented."""
    return world_dir_to_equirect_pixel(np.asarray(P) - np.asarray(C_donor), w, h)


def donor_horizontal_offset(P: np.ndarray, C_donor: np.ndarray) -> float:
    """Horizontal distance from the donor's own ground point to P. If this is
    below the tripod radius, P sits under the donor's OWN blind cone and the
    donor must be rejected."""
    P = np.asarray(P, dtype=np.float64)
    C = np.asarray(C_donor, dtype=np.float64)
    return float(np.hypot(P[0] - C[0], P[1] - C[1]))


def donor_weight(
    P: np.ndarray,
    C_donor: np.ndarray,
    incidence_power: float = 2.0,
    dist_power: float = 2.0,
) -> float:
    """Blend weight for a donor's view of floor point P. Rewards head-on
    (looking straight down, least foreshortened) and near (more texels per
    metre) views; 0 for a horizontal or coincident donor."""
    v = np.asarray(P, dtype=np.float64) - np.asarray(C_donor, dtype=np.float64)
    dist = float(np.linalg.norm(v))
    if dist < 1e-9:
        return 0.0
    overhead = max(0.0, -v[2] / dist)  # 1 = straight down, 0 = horizontal
    return (overhead ** incidence_power) / (dist ** dist_power)

"""RED-first tests for the nadir-fill geometry core (nadir_fill.py).

Pure geometry only — no image I/O, no E57, no bundle. These pin the exact
conventions the fill must obey so a reprojected floor pixel lands where the
viewer will actually sample it:

  * equirect raster convention IDENTICAL to extract_equirect_v2.world_equirect_band_dirs:
    World frame, Z-up; row 0 = zenith (+Z), last row = nadir (-Z);
    az measured from +X toward +Y; dir = (cos_el cos_az, cos_el sin_az, sin_el).
  * each scan's equirect is world-ORIENTED but centred at that scan's scanner,
    so reprojecting a world floor point into a donor scan is pure translation.

Run standalone (no pytest needed):  python tests/test_nadir_geometry.py
Or under pytest if present:          python -m pytest tests/test_nadir_geometry.py
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nadir_fill as nf  # noqa: E402

W, H = 2048, 1024


def _close(a, b, tol=1e-6):
    return np.allclose(np.asarray(a, float), np.asarray(b, float), atol=tol)


def test_pixel_dir_roundtrip_is_identity():
    # A ray -> pixel -> ray round-trip must return the same unit direction.
    for row, col in [(0, 0), (H - 1, 0), (H // 2, W // 2), (300, 1700), (900, 40)]:
        d = nf.equirect_pixel_to_world_dir(row, col, W, H)
        assert _close(np.linalg.norm(d), 1.0, 1e-6), "direction must be unit"
        r2, c2 = nf.world_dir_to_equirect_pixel(d, W, H)
        assert _close(r2, row, 1e-4) and _close(c2, col, 1e-4), (row, col, r2, c2)


def test_zenith_and_nadir_rows_point_up_and_down():
    top = nf.equirect_pixel_to_world_dir(0, W // 2, W, H)
    bot = nf.equirect_pixel_to_world_dir(H - 1, W // 2, W, H)
    assert top[2] > 0.999, "row 0 must look up (+Z zenith)"
    assert bot[2] < -0.999, "last row must look down (-Z nadir/floor)"


def test_ray_hits_floor_straight_down():
    C = np.array([0.0, 0.0, 1.5])  # scanner 1.5 m above the floor
    down = np.array([0.0, 0.0, -1.0])
    P = nf.ray_floor_intersection(C, down, z_floor=0.0)
    assert P is not None and _close(P, [0.0, 0.0, 0.0], 1e-9)


def test_ray_at_45deg_lands_one_height_out():
    C = np.array([0.0, 0.0, 2.0])
    d = np.array([1.0, 0.0, -1.0]) / math.sqrt(2)  # 45 deg below horizon, +X
    P = nf.ray_floor_intersection(C, d, z_floor=0.0)
    assert P is not None and _close(P, [2.0, 0.0, 0.0], 1e-9)


def test_upward_or_parallel_ray_never_hits_floor():
    C = np.array([0.0, 0.0, 1.5])
    assert nf.ray_floor_intersection(C, np.array([0.0, 0.0, 1.0]), 0.0) is None
    assert nf.ray_floor_intersection(C, np.array([1.0, 0.0, 0.0]), 0.0) is None


def test_reproject_floor_point_into_donor_roundtrips_to_its_ray():
    # The floor point A hides is seen by a donor 2 m to the side; reprojecting
    # it must yield the pixel whose ray is exactly donor->point.
    P = np.array([0.0, 0.0, 0.0])
    C_donor = np.array([2.0, 0.0, 1.5])
    row, col = nf.reproject_point_to_pixel(P, C_donor, W, H)
    ray = nf.equirect_pixel_to_world_dir(row, col, W, H)
    expected = (P - C_donor) / np.linalg.norm(P - C_donor)
    assert _close(ray, expected, 1e-4), (ray, expected)


def test_donor_directly_overhead_reprojects_to_nadir_row():
    P = np.array([0.0, 0.0, 0.0])
    C_donor = np.array([0.0, 0.0, 1.5])
    row, _col = nf.reproject_point_to_pixel(P, C_donor, W, H)
    assert row > H - 1.5, "overhead donor sees the point at its nadir row"


def test_horizontal_offset_flags_a_point_under_the_donor_tripod():
    P = np.array([0.0, 0.0, 0.0])
    assert _close(nf.donor_horizontal_offset(P, np.array([0.0, 0.0, 1.5])), 0.0)
    assert _close(nf.donor_horizontal_offset(P, np.array([2.0, 0.0, 1.5])), 2.0)


def test_closer_more_overhead_donor_scores_higher():
    P = np.array([0.0, 0.0, 0.0])
    near_overhead = nf.donor_weight(P, np.array([0.4, 0.0, 1.5]))
    far_oblique = nf.donor_weight(P, np.array([6.0, 0.0, 1.5]))
    assert near_overhead > far_oblique > 0.0


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)

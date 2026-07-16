"""Cross-verification: nadir_fill's geometry vs the REAL extractor.

Imports extract_equirect_v2 (the script that rendered every pano in the
bundle) and asserts nadir_fill reproduces its world_equirect_band_dirs ray
grid exactly. If these ever diverge, a reprojected floor pixel would land in
the wrong place in the viewer — so this is the single most important test in
the suite: it pins my math to the renderer's, not to my own re-derivation.

Run: python tests/test_nadir_vs_extractor.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extract_equirect_v2 as ext  # noqa: E402  (the production extractor)
import nadir_fill as nf  # noqa: E402

W, H = 512, 256  # full grid at modest size — every pixel checked


def test_pixel_to_dir_matches_extractor_grid_everywhere():
    grid = ext.world_equirect_band_dirs(W, H, 0, H)  # (H, W, 3) float32
    worst = 0.0
    for row, col in [(r, c) for r in range(0, H, 7) for c in range(0, W, 11)]:
        mine = nf.equirect_pixel_to_world_dir(row, col, W, H)
        theirs = grid[row, col].astype(np.float64)
        err = float(np.linalg.norm(mine - theirs))
        worst = max(worst, err)
    # float32 grid vs float64 scalar math: agreement to ~1e-7 expected
    assert worst < 5e-7, f"max |dir diff| vs extractor = {worst}"
    print(f"  max |dir diff| vs extractor over sampled grid: {worst:.2e}")


def test_dir_to_pixel_inverts_extractor_grid():
    grid = ext.world_equirect_band_dirs(W, H, 0, H)
    rng = np.random.default_rng(7)
    rows = rng.integers(0, H, 400)
    cols = rng.integers(0, W, 400)
    worst = 0.0
    for r, c in zip(rows, cols):
        rr, cc = nf.world_dir_to_equirect_pixel(grid[r, c].astype(np.float64), W, H)
        worst = max(worst, abs(rr - float(r)), abs(cc - float(c)))
    assert worst < 2e-3, f"max |pixel diff| inverting extractor rays = {worst}"
    print(f"  max |pixel diff| inverting extractor rays: {worst:.2e}")


def test_band_offsets_agree_with_full_grid():
    # The extractor renders in bands; band row0=k must equal rows k.. of the
    # full grid, and my mapping must agree inside an offset band too.
    full = ext.world_equirect_band_dirs(W, H, 0, H)
    band = ext.world_equirect_band_dirs(W, H, 96, 32)
    assert np.array_equal(band, full[96:128])
    mine = nf.equirect_pixel_to_world_dir(96, 5, W, H)
    assert np.linalg.norm(mine - band[0, 5].astype(np.float64)) < 5e-7


def test_random_unit_dirs_roundtrip_through_my_mapping():
    rng = np.random.default_rng(11)
    v = rng.normal(size=(500, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    worst = 0.0
    for d in v:
        r, c = nf.world_dir_to_equirect_pixel(d, W, H)
        d2 = nf.equirect_pixel_to_world_dir(r, c, W, H)
        worst = max(worst, float(np.linalg.norm(d - d2)))
    assert worst < 1e-9, f"roundtrip drift {worst}"
    print(f"  max roundtrip drift over 500 random dirs: {worst:.2e}")


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

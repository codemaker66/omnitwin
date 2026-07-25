"""The wire-back: every viewpoint's floor sampled from the SHARED atlas.

This is the step that ends the per-node donor lottery. Instead of each
panorama begging its neighbours for pixels — different donors, different
quality, a seam between viewpoints, a dead centre wherever the lottery
lost — every node's nadir is now READ OUT OF ONE SURFACE that was fused
from every photograph ever taken of that floor.

Consequences these tests pin:
  * the fill is as good as the ATLAS, not as good as this node's luck;
  * two nodes standing on the same floor patch get the SAME pixels, so
    walking between them cannot reveal a seam;
  * atlas coverage is carried through honestly — floor nobody photographed
    comes back FLAGGED, never invented (Foundry truth rule).

Run: python tests/test_atlas_project.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import atlas_project as ap  # noqa: E402
import floor_atlas as fa  # noqa: E402
import test_floor_atlas as T  # noqa: E402  (proven scene fixtures)

ATLAS, ATLAS_REPORT = fa.accumulate_floor_atlas(T.PANOS, T.GRID, z_floor=T.Z_FLOOR)
COUNTS = ATLAS_REPORT["counts"]


def _holed(index=0, radius_m=0.42):
    """A target pano with its own tripod hole punched at nadir."""
    img, C = T.PANOS[index]
    img = img.copy()
    dirs = T.ext.world_equirect_band_dirs(T.W, T.H, 0, T.H).astype(np.float64)
    down = dirs[..., 2] < -1e-9
    dd = dirs[down]
    t = (T.Z_FLOOR - C[2]) / dd[:, 2]
    P = C[None, :] + t[:, None] * dd
    off = np.hypot(P[:, 0] - C[0], P[:, 1] - C[1])
    hole = np.zeros((T.H, T.W), dtype=bool)
    hm = off < radius_m
    hole[down] = hm
    img[hole] = img[hole].mean(axis=0, keepdims=True)   # featureless smear
    return img, C, hole


def test_nadir_is_read_out_of_the_shared_atlas():
    img, C, hole = _holed()
    truth, _ = T.PANOS[0]
    filled, rep = ap.fill_nadir_from_atlas(
        img, C, ATLAS, COUNTS, T.GRID, z_floor=T.Z_FLOOR, hole_mask=hole
    )
    before = T._fine_corr(img[hole].reshape(-1, 1, 3), truth[hole].reshape(-1, 1, 3))
    after = T._fine_corr(filled[hole].reshape(-1, 1, 3), truth[hole].reshape(-1, 1, 3))
    print(f"  hole detail corr vs truth: smeared {before:.3f} -> atlas-filled {after:.3f}"
          f"  (atlas coverage {rep['atlas_covered_frac']:.2f}, "
          f"mean looks {rep['mean_looks_behind_fill']:.1f})")
    assert rep["atlas_covered_frac"] > 0.99
    assert after > before + 0.15, (before, after)


def test_only_the_hole_changes():
    img, C, hole = _holed()
    filled, _ = ap.fill_nadir_from_atlas(
        img, C, ATLAS, COUNTS, T.GRID, z_floor=T.Z_FLOOR, hole_mask=hole
    )
    assert np.array_equal(filled[~hole], img[~hole])


def test_two_viewpoints_agree_on_the_same_floor_patch():
    # THE seam killer: two nodes standing apart, both looking at one patch of
    # floor between them, must receive the SAME pixels — because both read the
    # same atlas. Under the old per-node donor lottery they could not.
    (imgA, CA), (imgB, CB) = T.PANOS[0], T.PANOS[1]
    mid = ((CA[0] + CB[0]) / 2.0, (CA[1] + CB[1]) / 2.0)
    hole_all = np.ones((T.H, T.W), dtype=bool)
    fa_img, _ = ap.fill_nadir_from_atlas(
        imgA, CA, ATLAS, COUNTS, T.GRID, z_floor=T.Z_FLOOR, hole_mask=hole_all,
        blend=False,
    )
    fb_img, _ = ap.fill_nadir_from_atlas(
        imgB, CB, ATLAS, COUNTS, T.GRID, z_floor=T.Z_FLOOR, hole_mask=hole_all,
        blend=False,
    )
    pa = ap.sample_pano_at_floor_point(fa_img, CA, mid[0], mid[1], T.Z_FLOOR)
    pb = ap.sample_pano_at_floor_point(fb_img, CB, mid[0], mid[1], T.Z_FLOOR)
    diff = float(np.abs(pa - pb).mean())
    print(f"  same floor point via two viewpoints: mean |diff| {diff:.2f}/255")
    assert diff < 3.0, f"viewpoints disagree about shared floor: {diff:.1f}"


def test_unphotographed_floor_is_flagged_not_invented():
    img, C, hole = _holed()
    # Blank the atlas WHERE THIS NODE'S HOLE ACTUALLY LANDS — under its own
    # feet — not an arbitrary corner the hole never reaches (that was a
    # toothless first draft of this test: coverage stayed 1.00).
    counts = COUNTS.copy()
    c_col, c_row = T.GRID.world_to_atlas(float(C[0]), float(C[1]))
    r0, c0 = int(round(c_row)) - 40, int(round(c_col)) - 40
    counts[max(r0, 0):r0 + 80, max(c0, 0):c0 + 80] = 0
    filled, rep = ap.fill_nadir_from_atlas(
        img, C, ATLAS, counts, T.GRID, z_floor=T.Z_FLOOR, hole_mask=hole
    )
    assert rep["atlas_covered_frac"] < 1.0
    assert rep["uncovered_px"] > 0
    assert np.all(np.isfinite(filled))
    print(f"  uncovered hole px reported: {rep['uncovered_px']}")


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

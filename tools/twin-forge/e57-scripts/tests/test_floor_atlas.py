"""The Floor Atlas thesis, stated as tests.

Every fix so far treated the tripod hole as IMAGE REPAIR — patch pixels in
one photograph, accept whatever resolution that photograph has. That is the
ceiling Matterport also sits under, and it is why each attempt plateaued.

The reframe: the floor under any tripod WAS photographed, by a dozen
neighbours, each at a different grazing angle, each landing pixels at
different sub-pixel offsets on the same planks. Many poor looks at a PLANAR
surface fuse into one that is sharper than any of them (classic multi-view
super-resolution; planar => pure homography, no depth ambiguity). So the
fusion target is not another panorama: it is ONE metrically-true orthophoto
of the floor itself, which every viewpoint then samples.

These tests pin the claims that make that worth building:
  1. the grid is metrically exact and invertible (it is a measuring surface)
  2. a fused atlas RESOLVES FINER DETAIL than the best single photograph
  3. fusion is robust: a chair in one view cannot smear the shared floor
  4. it refuses to invent — unobserved floor is reported, never guessed

Run: python tests/test_floor_atlas.py
"""

import os
import sys

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extract_equirect_v2 as ext  # noqa: E402  (production ray convention)
import floor_atlas as fa  # noqa: E402

W, H = 1024, 512          # source pano size — ~9-20 mm ground sampling
Z_FLOOR = 0.0
MM_PX = 5.0               # atlas is FINER than any single view: SR territory
LUMW = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def true_floor(x, y):
    """Ground truth with detail deliberately BELOW single-view sampling:
    plank seams every 8 cm plus 12 mm grain striations. A 9-20 mm sampler
    cannot resolve the grain alone; several shifted samplers can."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    u = (x + y) / np.sqrt(2.0)
    v = (x - y) / np.sqrt(2.0)
    plank = ((np.floor(u / 0.08) % 2) == 0).astype(np.float64) * 18.0
    grain = 26.0 * (0.5 + 0.5 * np.sin(v / 0.012 * 2 * np.pi))   # 12 mm period
    seam = -22.0 * (np.abs((u / 0.08) % 1.0 - 0.5) > 0.47).astype(np.float64)
    base = 170.0 + plank + grain + seam
    return np.stack([base, base * 0.83, base * 0.60], axis=-1).astype(np.float32)


def render_pano(C, gsd_m):
    """Analytic world-oriented equirect of the floor from centre C, BAND
    LIMITED to that view's ground sampling distance before sampling — the
    physically honest way to simulate a camera, and what makes multi-view
    super-resolution meaningful rather than a free lunch."""
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    img = np.full((H, W, 3), 90.0, dtype=np.float32)
    dz = dirs[..., 2]
    down = dz < -1e-9
    dd = dirs[down]
    t = (Z_FLOOR - C[2]) / dd[:, 2]
    P = C[None, :] + t[:, None] * dd
    acc = np.zeros((P.shape[0], 3), dtype=np.float32)
    offs = [(-0.33, -0.33), (0.33, -0.33), (-0.33, 0.33), (0.33, 0.33), (0.0, 0.0)]
    for ox, oy in offs:
        acc += true_floor(P[:, 0] + ox * gsd_m, P[:, 1] + oy * gsd_m)
    img[down] = acc / len(offs)
    return img


# --- scene: five scanners around a shared patch of floor -------------------
CENTRES = [
    np.array([0.00, 0.00, 1.50]),
    np.array([1.30, 0.20, 1.52]),
    np.array([-1.15, 0.95, 1.48]),
    np.array([0.35, -1.40, 1.51]),
    np.array([-0.80, -0.75, 1.49]),
]
PANOS = [(render_pano(C, 0.011 + 0.004 * i), C) for i, C in enumerate(CENTRES)]

GRID = fa.AtlasGrid(origin_xy=(-1.0, -1.0), mm_per_px=MM_PX, width=400, height=400)


def _truth_raster():
    xs, ys = GRID.pixel_centres_world()
    return true_floor(xs, ys)


def _detail(img):
    """High-frequency luminance layer — the thing SR is supposed to win."""
    lum = np.asarray(img, dtype=np.float32) @ LUMW
    return lum - ndimage.gaussian_filter(lum, 2.0)


def _fine_corr(a, b, mask=None):
    da, db = _detail(a).ravel(), _detail(b).ravel()
    if mask is not None:
        m = mask.ravel()
        da, db = da[m], db[m]
    da = da - da.mean()
    db = db - db.mean()
    den = float(np.sqrt((da * da).sum() * (db * db).sum()))
    return float((da * db).sum() / den) if den > 1e-9 else 0.0


def test_grid_is_metrically_exact_and_invertible():
    # The atlas is a measuring surface before it is a picture.
    g = fa.AtlasGrid(origin_xy=(-2.5, 4.0), mm_per_px=4.0, width=300, height=200)
    assert abs(g.metres_per_px - 0.004) < 1e-12
    assert abs(g.width_m - 1.2) < 1e-9 and abs(g.height_m - 0.8) < 1e-9
    for wx, wy in [(-2.5, 4.0), (-2.0, 4.5), (-1.31, 4.79)]:
        c, r = g.world_to_atlas(wx, wy)
        bx, by = g.atlas_to_world(c, r)
        assert abs(bx - wx) < 1e-9 and abs(by - wy) < 1e-9, (wx, wy, bx, by)
    xs, ys = g.pixel_centres_world()
    assert xs.shape == (200, 300) and ys.shape == (200, 300)
    assert abs(xs[0, 0] - (-2.5 + 0.002)) < 1e-9
    assert abs(xs[0, -1] - (-2.5 + 1.2 - 0.002)) < 1e-9


def test_fused_atlas_out_resolves_the_best_single_photograph():
    # THE THESIS. Fusing five grazing looks must beat the best single look at
    # fine detail — otherwise the whole idea is just averaging.
    truth = _truth_raster()
    singles = [
        fa.project_source_to_atlas(img, C, GRID, z_floor=Z_FLOOR)[0]
        for img, C in PANOS
    ]
    best_single = max(_fine_corr(s, truth) for s in singles)
    atlas, report = fa.accumulate_floor_atlas(PANOS, GRID, z_floor=Z_FLOOR)
    fused = _fine_corr(atlas, truth)
    print(f"  fine-detail corr: best single {best_single:.3f} -> fused {fused:.3f}"
          f"  (+{(fused - best_single) * 100:.1f} pts)")
    assert fused > best_single + 0.05, (
        f"fusion did not out-resolve a single view: {fused:.3f} vs {best_single:.3f}"
    )
    assert report["covered_frac"] > 0.98


def test_a_chair_in_one_view_cannot_smear_the_shared_floor():
    # Robustness: one source sees an obstruction over part of the floor. The
    # atlas must reject it, not average it in — this is what makes a SHARED
    # surface safe to build from many captures.
    dirty = [(img.copy(), C) for img, C in PANOS]
    img0, C0 = dirty[0]
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    dz = dirs[..., 2]
    down = dz < -1e-9
    dd = dirs[down]
    t = (Z_FLOOR - C0[2]) / dd[:, 2]
    P = C0[None, :] + t[:, None] * dd
    blob = (np.abs(P[:, 0] - 0.15) < 0.28) & (np.abs(P[:, 1] - 0.05) < 0.28)
    sub = img0[down]
    sub[blob] = np.array([40.0, 45.0, 55.0], dtype=np.float32)   # dark chair
    img0[down] = sub

    truth = _truth_raster()
    atlas, report = fa.accumulate_floor_atlas(dirty, GRID, z_floor=Z_FLOOR)
    cx0, cy0 = GRID.world_to_atlas(0.15 - 0.2, 0.05 - 0.2)
    cx1, cy1 = GRID.world_to_atlas(0.15 + 0.2, 0.05 + 0.2)
    r0, r1 = int(min(cy0, cy1)), int(max(cy0, cy1))
    c0, c1 = int(min(cx0, cx1)), int(max(cx0, cx1))
    patch = atlas[r0:r1, c0:c1]
    tpatch = truth[r0:r1, c0:c1]
    err = float(np.abs(patch.mean(axis=2) - tpatch.mean(axis=2)).mean())
    print(f"  contaminated-region error: {err:.1f}/255 "
          f"(rejected {report['rejected_frac'] * 100:.1f}% of samples)")
    assert err < 12.0, f"the chair leaked into the shared floor: {err:.1f}"


def test_unobserved_floor_is_reported_not_invented():
    # The Foundry rule: never turn missing observations into captured fact.
    # A patch no source can see must come back flagged, not fabricated.
    far = fa.AtlasGrid(origin_xy=(14.0, 14.0), mm_per_px=MM_PX, width=120, height=120)
    atlas, report = fa.accumulate_floor_atlas(PANOS, far, z_floor=Z_FLOOR)
    print(f"  unobserved grid covered_frac: {report['covered_frac']:.3f}")
    assert report["covered_frac"] < 0.02
    assert report["observed"].shape == (120, 120)
    assert not report["observed"].any()


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

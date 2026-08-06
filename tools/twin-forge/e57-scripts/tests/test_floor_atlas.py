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
    assert np.array_equal(report["counts"], report["contributor_counts"])
    assert np.all(report["retained_counts"] <= report["eligible_counts"])
    assert np.all(report["contributor_counts"] <= report["eligible_counts"])
    assert np.any(report["contributor_counts"] < report["eligible_counts"])
    assert report["eligible_sample_count"] == int(report["eligible_counts"].sum())
    assert report["retained_sample_count"] == int(report["retained_counts"].sum())
    assert report["rejected_sample_count"] == (
        report["eligible_sample_count"] - report["retained_sample_count"]
    )


def test_moving_specular_highlights_are_suppressed():
    # Found on the real Grand Hall: the first atlas showed a regular grid of
    # bright discs — the chandeliers' reflections in the polished floor. A
    # highlight moves with the viewpoint, so averaging many views smears each
    # into a disc. Physics gives the fix for free: specular reflection only
    # ever ADDS light, so the darker observations carry the diffuse truth.
    # Each source here gets its own highlight in a different place; the fused
    # floor must show none of them.
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    dz = dirs[..., 2]
    down = dz < -1e-9
    dd = dirs[down]
    glossy = []
    spots = [(-0.4, -0.3), (0.35, -0.15), (-0.1, 0.42), (0.5, 0.3), (-0.45, 0.1)]
    for (img, C), (sx, sy) in zip(PANOS, spots):
        g = img.copy()
        t = (Z_FLOOR - C[2]) / dd[:, 2]
        P = C[None, :] + t[:, None] * dd
        hot = np.hypot(P[:, 0] - sx, P[:, 1] - sy) < 0.22
        sub = g[down]
        sub[hot] = np.minimum(sub[hot] + 95.0, 255.0)      # blown highlight
        g[down] = sub
        glossy.append((g, C))

    truth = _truth_raster()
    atlas, report = fa.accumulate_floor_atlas(glossy, GRID, z_floor=Z_FLOOR)
    worst = 0.0
    for sx, sy in spots:
        c, r = GRID.world_to_atlas(sx, sy)
        r0, r1 = int(r) - 18, int(r) + 18
        c0, c1 = int(c) - 18, int(c) + 18
        if r0 < 0 or c0 < 0 or r1 > GRID.height or c1 > GRID.width:
            continue
        err = float(
            np.abs(atlas[r0:r1, c0:c1].mean(axis=2)
                   - truth[r0:r1, c0:c1].mean(axis=2)).mean()
        )
        worst = max(worst, err)
    print(f"  worst highlight-region error: {worst:.1f}/255 "
          f"(rejected {report['rejected_frac'] * 100:.1f}% of samples)")
    assert worst < 10.0, f"chandelier reflections survived fusion: {worst:.1f}"


def test_per_source_sheen_is_harmonised_when_opted_in():
    # A polished floor can carry a smooth, view-dependent gain ramp.  This is
    # a synthetic mechanism test, not evidence that every real bright patch
    # has this cause.  Explicit harmonisation should remove that ramp without
    # being silently enabled for ordinary runs.
    lit = []
    for i, (img, C) in enumerate(PANOS):
        altered = img.astype(np.float32).copy()
        dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
        down = dirs[..., 2] < -1e-9
        floor_dirs = dirs[down]
        distance = (Z_FLOOR - C[2]) / floor_dirs[:, 2]
        points = C[None, :] + distance[:, None] * floor_dirs
        offset = np.hypot(points[:, 0] - C[0], points[:, 1] - C[1])
        gain = 1.0 + 0.42 * np.clip(offset / 1.6, 0, 1) * (
            0.6 + 0.4 * ((i % 3) / 2)
        )
        floor_pixels = altered[down]
        altered[down] = np.clip(floor_pixels * gain[:, None], 0, 255)
        lit.append((altered, C))

    truth = _truth_raster()
    plain, _ = fa.accumulate_floor_atlas(
        lit, GRID, z_floor=Z_FLOOR, harmonise=False
    )
    fixed, report = fa.accumulate_floor_atlas(
        lit, GRID, z_floor=Z_FLOOR, harmonise=True
    )
    seen = report["counts"] >= 2

    def residual_structure(atlas):
        atlas_low = ndimage.uniform_filter(atlas.mean(axis=2), 25)
        truth_low = ndimage.uniform_filter(truth.mean(axis=2), 25)
        return float((atlas_low - truth_low)[seen].std())

    plain_residual = residual_structure(plain)
    fixed_residual = residual_structure(fixed)
    print(
        "  residual sheen structure: "
        f"unharmonised {plain_residual:.2f} -> harmonised {fixed_residual:.2f}"
    )
    assert fixed_residual < plain_residual * 0.55
    assert report["harmonisation_enabled"] is True
    diagnostics = report["harmonisation_diagnostics"]
    assert len(diagnostics) == len(PANOS)
    assert all(len(item["channels"]) == 3 for item in diagnostics)
    assert all(
        0.65 <= channel["gain_min"] <= channel["gain_max"] <= 1.55
        for item in diagnostics
        for channel in item["channels"]
    )


def test_harmonisation_leaves_unsupported_incidence_bins_exactly_neutral():
    grid = fa.AtlasGrid(origin_xy=(-3.0, -3.0), mm_per_px=50.0,
                        width=120, height=120)
    camera = np.array([0.0, 0.0, 1.5])
    xs, ys = grid.pixel_centres_world()
    distance = np.sqrt(xs * xs + ys * ys + camera[2] ** 2)
    bins = np.clip(
        (camera[2] / distance * fa.N_HARMONISATION_BINS).astype(np.int32),
        0,
        fa.N_HARMONISATION_BINS - 1,
    )
    available = [
        index for index in range(1, fa.N_HARMONISATION_BINS - 1)
        if np.count_nonzero(bins == index) >= 80
        and np.count_nonzero(bins == index + 1) >= 10
    ]
    assert available
    supported_bin = available[0]
    unsupported_bin = supported_bin + 1

    seen = np.zeros((grid.height, grid.width), dtype=bool)
    supported_pixels = np.flatnonzero(bins == supported_bin)[:80]
    unsupported_pixels = np.flatnonzero(bins == unsupported_bin)[:10]
    seen.flat[supported_pixels] = True
    seen.flat[unsupported_pixels] = True
    rgb = np.full((grid.height, grid.width, 3), 100.0, dtype=np.float32)
    consensus = np.full_like(rgb, 150.0)

    corrected, diagnostic = fa._harmonise_to_consensus(
        rgb, seen, consensus, grid, camera, z_floor=0.0
    )
    for channel in diagnostic["channels"]:
        curve = np.asarray(channel["gain_curve"])
        assert channel["supported_bins"] == 1
        assert curve[supported_bin] > 1.0
        assert np.all(curve[np.arange(curve.size) != supported_bin] == 1.0)
    assert np.all(corrected.reshape(-1, 3)[unsupported_pixels] == 100.0)


def test_per_source_height_error_is_aligned_out_when_opted_in():
    # A per-sweep floor-height error creates a coherent radial registration
    # error whose magnitude grows at grazing incidence.  This synthetic test
    # asks the one-parameter alignment model to recover planted z errors.
    rng = np.random.default_rng(5)
    errors = rng.uniform(-0.018, 0.018, size=len(PANOS))
    displaced = [
        (img, np.array([C[0], C[1], C[2] + error]))
        for (img, C), error in zip(PANOS, errors)
    ]

    truth = _truth_raster()
    naive, _ = fa.accumulate_floor_atlas(
        displaced, GRID, z_floor=Z_FLOOR, align=False
    )
    class TransparentOccluder:
        def __init__(self):
            self.floor_z_is_fixed = True
            self.exempt_z_is_fixed = True

        def blocked(self, _origin, points, z_exempt_below):
            self.floor_z_is_fixed &= bool(
                np.allclose(points[:, 2], Z_FLOOR, atol=1e-12)
            )
            self.exempt_z_is_fixed &= bool(
                abs(float(z_exempt_below) - (Z_FLOOR + 0.30)) < 1e-12
            )
            return np.zeros(points.shape[0], dtype=bool)

    occluder = TransparentOccluder()
    fixed, report = fa.accumulate_floor_atlas(
        displaced, GRID, z_floor=Z_FLOOR, align=True, occluder=occluder
    )
    seen = report["counts"] >= 3
    naive_corr = _fine_corr(naive, truth, seen)
    fixed_corr = _fine_corr(fixed, truth, seen)
    estimates = np.asarray(report["align_dz"], dtype=np.float64)
    print(
        "  detail corr with height errors: "
        f"unaligned {naive_corr:.3f} -> aligned {fixed_corr:.3f} "
        f"(recovered dz mm: {[round(v * 1000) for v in estimates]})"
    )
    assert fixed_corr > naive_corr + 0.05, (naive_corr, fixed_corr)
    assert estimates.shape == errors.shape
    # z_floor is adjusted to compensate for the altered camera z, so the
    # compensation has the same sign as the planted camera-height error.
    residual = np.abs(estimates - errors).mean()
    assert residual < 0.012, f"dz estimates off by {residual * 1000:.1f} mm"
    assert occluder.floor_z_is_fixed
    assert occluder.exempt_z_is_fixed
    decisions = report["alignment_estimates"]
    assert len(decisions) == len(PANOS)
    assert all(
        decision["status"] in {"zero_best", "shift_accepted", "ambiguous_peak"}
        for decision in decisions
    ), decisions
    assert any(decision["status"] == "shift_accepted" for decision in decisions)
    assert all(
        decision["accepted"] or decision["dz_m"] == 0.0
        for decision in decisions
    )
    assert all(decision["valid_pixels"] >= 200 for decision in decisions), decisions


def test_alignment_does_not_move_or_degrade_clean_sources():
    truth = _truth_raster()
    baseline, baseline_report = fa.accumulate_floor_atlas(
        PANOS, GRID, z_floor=Z_FLOOR, align=False
    )
    aligned, aligned_report = fa.accumulate_floor_atlas(
        PANOS, GRID, z_floor=Z_FLOOR, align=True
    )
    seen = aligned_report["counts"] >= 3
    baseline_corr = _fine_corr(baseline, truth, seen)
    aligned_corr = _fine_corr(aligned, truth, seen)
    estimates = np.asarray(aligned_report["align_dz"], dtype=np.float64)

    assert np.max(np.abs(estimates)) <= 0.003
    assert aligned_corr >= baseline_corr - 0.002
    assert (
        aligned_report["rejected_frac"]
        <= baseline_report["rejected_frac"] + 0.005
    )


def test_combined_opt_ins_do_not_degrade_clean_sources():
    truth = _truth_raster()
    baseline, _ = fa.accumulate_floor_atlas(PANOS, GRID, z_floor=Z_FLOOR)
    corrected, report = fa.accumulate_floor_atlas(
        PANOS,
        GRID,
        z_floor=Z_FLOOR,
        align=True,
        harmonise=True,
    )
    seen = report["counts"] >= 3
    assert _fine_corr(corrected, truth, seen) >= _fine_corr(
        baseline, truth, seen
    ) - 0.005
    assert np.max(np.abs(report["align_dz"])) <= 0.003


def test_alignment_and_harmonisation_are_opt_in():
    _atlas, report = fa.accumulate_floor_atlas(PANOS, GRID, z_floor=Z_FLOOR)
    assert report["alignment_enabled"] is False
    assert report["harmonisation_enabled"] is False
    assert report["align_dz"] == [0.0] * len(PANOS)
    assert report["harmonisation_diagnostics"] == []


def test_alignment_reference_samples_exact_coarse_centres():
    for mm_per_px, width, height in ((5.0, 40, 30), (12.0, 32, 24)):
        grid = fa.AtlasGrid(
            origin_xy=(-2.0, 3.0),
            mm_per_px=mm_per_px,
            width=width,
            height=height,
        )
        fine_x, fine_y = grid.pixel_centres_world()
        consensus = np.stack([fine_x, fine_y, fine_x + fine_y], axis=2)
        coarse, reference, reference_seen = fa._coarse_alignment_reference(
            consensus, np.ones((height, width), dtype=bool), grid
        )
        coarse_x, coarse_y = coarse.pixel_centres_world()
        assert np.allclose(reference[..., 0], coarse_x, atol=1e-7)
        assert np.allclose(reference[..., 1], coarse_y, atol=1e-7)
        assert np.all(reference_seen)


def test_alignment_refuses_when_zero_candidate_has_no_texture_score():
    flat = np.full((H, W, 3), 128, dtype=np.uint8)
    consensus = np.full((GRID.height, GRID.width, 3), 128, dtype=np.float32)
    decision = fa._estimate_dz(
        flat,
        CENTRES[0],
        GRID,
        Z_FLOOR,
        consensus,
        np.ones((GRID.height, GRID.width), dtype=bool),
        self_blind_m=0.80,
        max_incidence_deg=80.0,
    )
    assert decision["dz_m"] == 0.0
    assert decision["accepted"] is False
    assert decision["status"] == "zero_candidate_unscorable"


def test_lazy_loader_decode_counts_are_bounded_and_explicit():
    small_grid = fa.AtlasGrid(
        origin_xy=(-0.4, -0.4), mm_per_px=10.0, width=80, height=80
    )
    for align, harmonise, expected_calls in (
        (False, False, 2),
        (False, True, 3),
        (True, False, 4),
        (True, True, 5),
    ):
        calls = [0, 0]

        def loader(index):
            def load():
                calls[index] += 1
                return PANOS[index][0]

            return load

        sources = [
            (loader(index), PANOS[index][1])
            for index in range(2)
        ]
        fa.accumulate_floor_atlas(
            sources,
            small_grid,
            z_floor=Z_FLOOR,
            align=align,
            harmonise=harmonise,
        )
        assert calls == [expected_calls, expected_calls], (
            align,
            harmonise,
            calls,
        )


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

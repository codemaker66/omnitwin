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
from floor_polygon import floor_mask  # noqa: E402  (the mask that ships)
from nadir_fill import VoxelOccluder  # noqa: E402  (the occluder that ships)

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


def test_per_source_sheen_is_harmonised_before_fusion():
    # THE DISC BUG, in the lab. On the real Grand Hall the atlas showed a
    # bright disc at every scanner position. Cause: inside a tripod's own
    # blind circle the ONLY contributors are grazing views, and grazing views
    # of polished oak return ceiling reflection, not wood. Outlier rejection
    # cannot help — there is no minority to reject, the whole population at
    # that pixel is bright.
    #
    # The fix is standard photogrammetry that was missing: before fusing,
    # normalise each source against the consensus with a LOW-FREQUENCY gain
    # field. That removes each view's own sheen gradient while leaving its
    # texture untouched. Here each source carries a different smooth sheen
    # ramp; the fused floor must come back flat.
    lit = []
    for i, (img, C) in enumerate(PANOS):
        g = img.astype(np.float32).copy()
        dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
        down = dirs[..., 2] < -1e-9
        dd = dirs[down]
        t = (Z_FLOOR - C[2]) / dd[:, 2]
        P = C[None, :] + t[:, None] * dd
        off = np.hypot(P[:, 0] - C[0], P[:, 1] - C[1])
        ramp = 1.0 + 0.42 * np.clip(off / 1.6, 0, 1) * (0.6 + 0.4 * ((i % 3) / 2))
        sub = g[down]
        g[down] = np.clip(sub * ramp[:, None], 0, 255)
        lit.append((g, C))

    truth = _truth_raster()
    plain, _ = fa.accumulate_floor_atlas(lit, GRID, z_floor=Z_FLOOR, harmonise=False)
    fixed, rep = fa.accumulate_floor_atlas(lit, GRID, z_floor=Z_FLOOR, harmonise=True)
    seen = rep["counts"] >= 2

    def flatness(a):
        lo_a = ndimage.uniform_filter(a.mean(axis=2), 25)
        lo_t = ndimage.uniform_filter(truth.mean(axis=2), 25)
        d = (lo_a - lo_t)[seen]
        return float(d.std())

    f_plain, f_fixed = flatness(plain), flatness(fixed)
    print(f"  residual sheen structure: unharmonised {f_plain:.2f} -> harmonised {f_fixed:.2f}")
    assert f_fixed < f_plain * 0.55, (f_plain, f_fixed)


def test_per_source_height_error_is_aligned_out():
    # THE REAL CAUSE OF THE DISCS, measured on the Grand Hall: at a disc the
    # sources disagree about where the floor IS by up to 36 mm, while on open
    # floor they agree to ~0. Divide those offsets by tan(incidence) and they
    # collapse to one number — every sweep's floor height is out by ~13-15 mm.
    # A grazing ray amplifies that into centimetres of lateral slip, so twenty
    # views land the same plank in twenty places and the average ERASES the
    # texture. It reads as a pale blob, which is why three photometric
    # theories in a row failed: it was never brightness, it is registration.
    #
    # One parameter per sweep fixes it. Here each source is given a deliberate
    # height error; alignment must recover the texture.
    rng = np.random.default_rng(5)
    errs = rng.uniform(-0.018, 0.018, size=len(PANOS))
    bad = [(img, np.array([C[0], C[1], C[2] + e])) for (img, C), e in zip(PANOS, errs)]

    truth = _truth_raster()
    naive, _ = fa.accumulate_floor_atlas(bad, GRID, z_floor=Z_FLOOR, align=False)
    fixed, rep = fa.accumulate_floor_atlas(bad, GRID, z_floor=Z_FLOOR, align=True)
    seen = rep["counts"] >= 3
    c_naive = _fine_corr(naive, truth, seen)
    c_fixed = _fine_corr(fixed, truth, seen)
    est = rep.get("align_dz", [])
    print(f"  detail corr with height errors: unaligned {c_naive:.3f} -> aligned {c_fixed:.3f}"
          f"  (recovered dz mm: {[round(v * 1000) for v in est[:5]]})")
    assert c_fixed > c_naive + 0.05, (c_naive, c_fixed)
    # and the estimates should track the planted errors
    if len(est) == len(errs):
        resid = np.abs(np.array(est) - (-errs)).mean()
        assert resid < 0.012, f"dz estimates off by {resid * 1000:.1f} mm"


def test_a_level_capture_is_left_exactly_alone():
    # The estimator must be able to say "nothing is wrong here".
    #
    # Sub-step refinement was rejected for this reason, and this test is what
    # makes that decision enforceable: fitting a parabola through the peak's
    # neighbours hands back a few tenths of a millimetre at every sweep even
    # when the capture is perfect, and a pipeline that always finds something
    # to correct cannot be trusted when it reports a real 15 mm fault. The
    # quantised search returns the zero rung, so a correction that is not
    # measurably real reads as no correction.
    _, report = fa.accumulate_floor_atlas(PANOS, GRID, z_floor=Z_FLOOR, align=True)
    est = report["align_dz"]
    print(f"  level capture -> dz mm: {[round(v * 1000, 3) for v in est]}")
    assert all(v == 0.0 for v in est), est


def test_alignment_survives_a_mesh_occluder():
    # The path that ships and the path that was tested were not the same one.
    #
    # Every other test here runs with occluder=None, but floor_atlas_build.py
    # always builds a VoxelOccluder when the venue has a mesh — so the real
    # pipeline exercises code no test covered. The specific hazard is the
    # leave-one-out subtraction: the reference is the accumulated sum MINUS
    # this source's contribution, and that only cancels if the contribution was
    # sampled the same way the sum was. Remove an UNOCCLUDED contribution from
    # an accumulator built WITH the occluder and the reference goes negative
    # exactly where the shadow fell, which is worse than no subtraction at all.
    # Nothing about that failure is visible without an occluder in the loop.
    slab = np.array(
        [
            [(-0.35, -0.30, 0.55), (0.45, -0.30, 0.55), (0.45, 0.50, 0.55)],
            [(-0.35, -0.30, 0.55), (0.45, 0.50, 0.55), (-0.35, 0.50, 0.55)],
        ],
        dtype=np.float64,
    )
    occluder = VoxelOccluder.from_triangles(slab, voxel=0.05)

    rng = np.random.default_rng(5)
    errs = rng.uniform(-0.018, 0.018, size=len(PANOS))
    bad = [(img, np.array([C[0], C[1], C[2] + e])) for (img, C), e in zip(PANOS, errs)]

    truth = _truth_raster()
    naive, _ = fa.accumulate_floor_atlas(
        bad, GRID, z_floor=Z_FLOOR, align=False, occluder=occluder
    )
    fixed, rep = fa.accumulate_floor_atlas(
        bad, GRID, z_floor=Z_FLOOR, align=True, occluder=occluder
    )
    seen = rep["counts"] >= 3
    c_naive = _fine_corr(naive, truth, seen)
    c_fixed = _fine_corr(fixed, truth, seen)
    resid = np.abs(np.array(rep["align_dz"]) - (-errs)).mean()
    print(
        f"  under a mesh occluder: {c_naive:.3f} -> {c_fixed:.3f}"
        f"  (residual {resid * 1000:.1f} mm)"
    )
    assert c_fixed > c_naive + 0.05, (c_naive, c_fixed)
    # The injected-error signature of the mismatched subtraction is a residual
    # the size of the fault being corrected, so the bar is the same 12 mm.
    assert resid < 0.012, f"dz estimates off by {resid * 1000:.1f} mm"


WALL_X = (0.28, 0.52)      # a 240 mm wall, standing on the floor
WALL_Y = (-1.30, 1.30)     # spanning the grid, as a real wall does
WALL_H = 1.20


def _box_tris(x0, x1, y0, y1, z0, z1):
    c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    out = []
    for a, b, d, e in [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
                       (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]:
        out += [[c[a], c[b], c[d]], [c[a], c[d], c[e]]]
    return np.array(out, dtype=np.float64)


def _slab_tris(x0, x1, y0, y1, z):
    return np.array([[(x0, y0, z), (x1, y0, z), (x1, y1, z)],
                     [(x0, y0, z), (x1, y1, z), (x0, y1, z)]], dtype=np.float64)


def _render_pano_with_wall(C, gsd_m):
    """render_pano, but the wall occludes the floor and shows its own face.

    The wall must be in the IMAGERY, not only in the mesh. A scene where the
    obstruction exists only in the mesh proves nothing about smear: the mask
    would be removing pixels that already showed clean floor.
    """
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    img = np.full((H, W, 3), 90.0, dtype=np.float32)
    down = dirs[..., 2] < -1e-9
    dd = dirs[down]
    t_floor = (Z_FLOOR - C[2]) / dd[:, 2]
    lo = np.array([WALL_X[0], WALL_Y[0], Z_FLOOR])
    hi = np.array([WALL_X[1], WALL_Y[1], Z_FLOOR + WALL_H])
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (lo[None, :] - C[None, :]) / dd
        t2 = (hi[None, :] - C[None, :]) / dd
    t_near = np.nanmax(np.minimum(t1, t2), axis=1)
    t_far = np.nanmin(np.maximum(t1, t2), axis=1)
    hit_wall = (t_far >= np.maximum(t_near, 0.0)) & (t_near < t_floor)

    P = C[None, :] + t_floor[:, None] * dd
    acc = np.zeros((P.shape[0], 3), dtype=np.float32)
    offs = [(-0.33, -0.33), (0.33, -0.33), (-0.33, 0.33), (0.33, 0.33), (0.0, 0.0)]
    for ox, oy in offs:
        acc += true_floor(P[:, 0] + ox * gsd_m, P[:, 1] + oy * gsd_m)
    col = acc / len(offs)
    Pw = C[None, :] + np.maximum(t_near, 0.0)[:, None] * dd
    lum = 118.0 + 14.0 * np.sin(Pw[:, 2] / 0.05 * 2 * np.pi)   # plaster, banded
    wall = np.stack([lum, lum * 0.97, lum * 0.94], axis=-1).astype(np.float32)
    col[hit_wall] = wall[hit_wall]
    img[down] = col
    return img


def test_the_floor_mask_stops_a_wall_being_fused_as_floor():
    # THE GAP THE MASK CLOSES, and it is not the gap the occluder closes.
    #
    # accumulate_floor_atlas asks every cell of the grid "who saw the floor
    # here", casts a ray to (x, y, z_floor), and fuses whatever panorama pixel
    # lands there. Inside a wall's footprint that pixel is a photograph of
    # plaster — and the atlas is a MEASURING SURFACE, so plaster averaged into
    # it is not a cosmetic blemish, it is a measurement of something that is
    # not there, at a place a planner will put a table.
    #
    # The occluder does not catch this, and the numbers printed below are the
    # evidence rather than the assumption. Its ray test is built for donor
    # VISIBILITY: near_skip/far_skip trim the ends of the segment and
    # z_exempt_below ignores hits under z_floor + 0.3 m, all of which are
    # right for "can this scanner see that floor" and all of which are wrong
    # for "is this cell floor at all". The occluder reasons about the PATH;
    # the mask reasons about the DESTINATION. Neither substitutes for the
    # other, which is why the assertions below pin BOTH directions.
    tris = np.concatenate([
        _slab_tris(-1.4, 1.4, -1.4, 1.4, Z_FLOOR),
        _box_tris(WALL_X[0], WALL_X[1], WALL_Y[0], WALL_Y[1],
                  Z_FLOOR, Z_FLOOR + WALL_H),
    ])
    occluder = VoxelOccluder.from_triangles(tris, voxel=0.05)
    mask = floor_mask(GRID, Z_FLOOR, tris, occluder=occluder)
    panos = [(_render_pano_with_wall(C, 0.011 + 0.004 * i), C)
             for i, C in enumerate(CENTRES)]

    xs, ys = GRID.pixel_centres_world()
    foot = ((xs >= WALL_X[0]) & (xs <= WALL_X[1])
            & (ys >= WALL_Y[0]) & (ys <= WALL_Y[1]))
    truth = _truth_raster()

    def smear(atlas, report):
        """Cells inside the wall's own footprint that the atlas presents as
        observed floor, and how far that 'floor' is from the real thing."""
        bad = report["observed"] & foot
        if not bad.any():
            return 0, 0.0
        err = float(np.abs(atlas[bad].mean(axis=1)
                           - truth[bad].mean(axis=1)).mean())
        return int(bad.sum()), err

    open_atlas, open_rep = fa.accumulate_floor_atlas(
        panos, GRID, z_floor=Z_FLOOR, align=False, occluder=occluder)
    masked_atlas, masked_rep = fa.accumulate_floor_atlas(
        panos, GRID, z_floor=Z_FLOOR, align=False, occluder=occluder,
        floor_mask=mask)

    n_open, e_open = smear(open_atlas, open_rep)
    n_masked, e_masked = smear(masked_atlas, masked_rep)
    total = int(foot.sum())
    print(f"  wall footprint {total} px ({total / foot.size * 100:.1f}% of grid); "
          f"mask keeps {mask.mean() * 100:.1f}% of the grid")
    print(f"  occluder alone : {n_open} px ({n_open / total * 100:.1f}%) fused as "
          f"floor, off truth by {e_open:.1f}/255")
    print(f"  + floor mask   : {n_masked} px ({n_masked / total * 100:.1f}%) fused as "
          f"floor, off truth by {e_masked:.1f}/255")
    print(f"  covered_frac {open_rep['covered_frac']:.3f} -> "
          f"{masked_rep['covered_frac']:.3f}  (floor_covered_frac "
          f"{open_rep['floor_covered_frac']:.3f} -> "
          f"{masked_rep['floor_covered_frac']:.3f}, floor_frac "
          f"{masked_rep['floor_frac']:.3f})")

    # The occluder must be shown to LEAVE the fault, or this test is only
    # proving the occluder works.
    assert n_open > 0.98 * total, (
        f"the occluder already removed the wall footprint ({n_open}/{total}); "
        "this scene no longer isolates what the mask does"
    )
    assert e_open > 20.0, f"the wall is not visibly contaminating the atlas: {e_open:.1f}"
    assert n_masked < 0.01 * total, (
        f"the mask left {n_masked}/{total} wall-footprint cells fused as floor"
    )
    # Scope was trimmed, not lost: coverage OF THE FLOOR must survive. This is
    # why covered_frac was not redefined over the mask — the fall in one and
    # the hold in the other are two different facts and both are reported.
    assert masked_rep["floor_covered_frac"] > 0.85, masked_rep["floor_covered_frac"]
    assert masked_rep["floor_frac"] < 0.95

    # THE THREADING HAZARD, measured directly rather than by proxy.
    # _align_pose_heights builds its reference by SUBTRACTING one source's
    # contribution from the accumulated sum, and that cancels only if the
    # contribution was built exactly the way the sum was. Mask pass 1 but not
    # this sampling and ref_acc goes NEGATIVE along every wall line — a
    # reference that is negative where the mask bit is worse than no
    # leave-one-out at all. So compare the most negative residual with and
    # without the mask: introducing the mask must not make it worse than the
    # floating-point cancellation residue that is already there.
    f = fa._coarse_factor(GRID, fa.ALIGN_COARSE_MM)
    ch, cw = GRID.height // f, GRID.width // f

    def worst_leave_one_out(floor_ok):
        acc, wsum, _la, _ls, _n = fa._accumulate_pass1(
            panos, GRID, Z_FLOOR, [0.0] * len(panos), 0.80, 80.0, occluder,
            floor_ok=floor_ok)
        b_acc = fa._block_sum(acc, f, ch, cw)
        b_w = fa._block_sum(wsum, f, ch, cw)
        worst = 0.0
        for img, C in panos:
            rgb, w = fa._sample_source(
                img, C, GRID, Z_FLOOR, 0.80, 80.0, occluder, floor_ok=floor_ok)
            worst = min(
                worst,
                float((b_acc - fa._block_sum(rgb * w[..., None], f, ch, cw)).min()),
                float((b_w - fa._block_sum(w, f, ch, cw)).min()),
            )
        return worst

    r_open = worst_leave_one_out(None)
    r_masked = worst_leave_one_out(mask)
    print(f"  most negative leave-one-out residual: unmasked {r_open:.3e} -> "
          f"masked {r_masked:.3e}")
    assert r_masked >= r_open - 1e-6, (
        "the floor mask drove the leave-one-out reference negative: "
        f"{r_open:.3e} -> {r_masked:.3e} (the mask is not threaded through "
        "every sampling site)"
    )

    # And the observable consequence. Note the bar is NOT "exactly zero": a
    # level capture returns exactly zero only with no occluder in the loop
    # (test_a_level_capture_is_left_exactly_alone), and measured here the
    # occluder alone already hands out 3 mm on this scene. What the mask must
    # do is stop the WALL from being registered against: the far-side scanner
    # correlates plaster with plaster and buys a large bogus correction.
    dz_open = fa.accumulate_floor_atlas(
        panos, GRID, z_floor=Z_FLOOR, align=True, occluder=occluder,
    )[1]["align_dz"]
    dz_masked = fa.accumulate_floor_atlas(
        panos, GRID, z_floor=Z_FLOOR, align=True, occluder=occluder,
        floor_mask=mask,
    )[1]["align_dz"]
    w_open = max(abs(v) for v in dz_open)
    w_masked = max(abs(v) for v in dz_masked)
    print(f"  level capture, dz mm: unmasked {[round(v * 1000) for v in dz_open]} "
          f"(worst {w_open * 1000:.0f} mm) -> masked "
          f"{[round(v * 1000) for v in dz_masked]} (worst {w_masked * 1000:.0f} mm)")
    assert w_masked < w_open, (
        f"masking did not reduce the wall-induced correction: "
        f"{w_open * 1000:.0f} mm -> {w_masked * 1000:.0f} mm"
    )
    # 12 mm is this suite's standing bar for a correction that is not real.
    assert w_masked < 0.012, f"invented {w_masked * 1000:.0f} mm on a level capture"


def test_the_floor_mask_parameter_is_inert_when_absent():
    # NON-NEGOTIABLE: adding the parameter must not move a single bit of an
    # existing build. Not "close", not "within tolerance" — identical bytes,
    # because a fusion pipeline that quietly shifts under a refactor cannot be
    # compared against its own history, and every measurement this module has
    # ever published was taken before the parameter existed.
    #
    # Checked on the occluder path too: that is where the mask threads through
    # the most call sites (pass 1, the leave-one-out reference, the alignment
    # rungs, pass 2) and therefore where an accidental default would land.
    import hashlib

    def digest(a):
        return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()

    slab = np.array(
        [
            [(-0.35, -0.30, 0.55), (0.45, -0.30, 0.55), (0.45, 0.50, 0.55)],
            [(-0.35, -0.30, 0.55), (0.45, 0.50, 0.55), (-0.35, 0.50, 0.55)],
        ],
        dtype=np.float64,
    )
    occluder = VoxelOccluder.from_triangles(slab, voxel=0.05)
    all_floor = np.ones((GRID.height, GRID.width), dtype=bool)

    for name, kw in [
        ("align=False", dict(align=False)),
        ("align=True", dict(align=True)),
        ("align=False + occluder", dict(align=False, occluder=occluder)),
        ("align=True + occluder", dict(align=True, occluder=occluder)),
    ]:
        absent, r_absent = fa.accumulate_floor_atlas(
            PANOS, GRID, z_floor=Z_FLOOR, **kw)
        explicit, _ = fa.accumulate_floor_atlas(
            PANOS, GRID, z_floor=Z_FLOOR, floor_mask=None, **kw)
        # An all-True mask is the identity element: if it is not, the mask is
        # doing something beyond gating and the whole parameter is unsound.
        everything, r_every = fa.accumulate_floor_atlas(
            PANOS, GRID, z_floor=Z_FLOOR, floor_mask=all_floor, **kw)
        d = digest(absent)
        print(f"  {name:24s} sha256[:16] {d[:16]}  none={digest(explicit) == d}"
              f"  all-True={digest(everything) == d}")
        assert digest(explicit) == d, f"floor_mask=None changed the atlas ({name})"
        assert digest(everything) == d, f"an all-True mask changed the atlas ({name})"
        assert np.array_equal(r_absent["counts"], r_every["counts"])
        assert r_absent["align_dz"] == r_every["align_dz"]
        assert r_absent["floor_frac"] == 1.0

    bad = np.ones((GRID.height + 1, GRID.width), dtype=bool)
    try:
        fa.accumulate_floor_atlas(PANOS, GRID, z_floor=Z_FLOOR, floor_mask=bad)
    except ValueError as exc:
        print(f"  wrong-shaped mask refused: {exc}")
    else:
        raise AssertionError("a mask of the wrong shape was silently accepted")


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

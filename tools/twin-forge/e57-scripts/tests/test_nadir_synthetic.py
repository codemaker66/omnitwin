"""End-to-end proof of the nadir fill on a synthetic scene with EXACT ground
truth.

We render world-oriented equirects analytically from a procedural parquet
floor (using the REAL extractor's ray grid, so the raster convention is the
production one), punch a tripod-smear hole in each, then ask the fill to
reconstruct the target's hidden floor from its neighbours. Because the
un-holed render exists, correctness is measurable pixel-for-pixel — something
real captures can never give us.

Deliberate cruelties baked into the scene:
  * donors carry exposure gains 0.90x / 1.12x / 1.03x (the real JPGs are
    unharmonized — uExposure is applied at runtime) → the fill must
    photometrically match them to the target or the seam test fails;
  * donor D stands 0.65 m from the target, so its OWN tripod cone overlaps
    the target's hole → cone rejection must engage or smear leaks in;
  * every donor has its own hole → naive sampling would copy smear.

Run: python tests/test_nadir_synthetic.py [--dump <dir>]  (dump saves PNGs)
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extract_equirect_v2 as ext  # noqa: E402
import nadir_fill as nf  # noqa: E402

W, H = 1024, 512
Z_FLOOR = 0.0
HOLE_R = 0.55  # metres of floor hidden by the tripod smear
TRIPOD_R = 0.45


def parquet(x, y):
    """Deterministic procedural parquet: herringbone stripe field + grain.
    Vectorized; returns float32 RGB in 0..255."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    tile = 0.6
    flip = ((np.floor(x / tile) + np.floor(y / tile)) % 2).astype(bool)
    u = np.where(flip, x + y, x - y) / np.sqrt(2.0)
    plank = ((np.floor(u / 0.09) % 2) == 0).astype(np.float64)
    grain = 0.5 + 0.5 * np.sin(u * 55.0) * np.sin((x - y) * 23.0)
    base = 168.0 + plank * 26.0 + grain * 14.0
    r = base * 1.00
    g = base * 0.82
    b = base * 0.58
    return np.stack([r, g, b], axis=-1).astype(np.float32)


def render_pano(C, gain=1.0, hole_r=None, boxes=None, pads=None):
    """Analytic world-oriented equirect of the infinite parquet floor seen
    from scanner centre C. Above the horizon: a flat wall tone (must never
    be sampled by the fill). hole_r punches the tripod smear (blob of the
    local mean colour, like the real scanner artifact). boxes are WORLD-TRUE
    axis-aligned occluders (bmin, bmax, color): a ray hitting one before the
    floor shows the box — donors honestly cannot see the floor behind it.
    pads are CAPTURE ARTIFACTS (cx, cy, r, color) painted onto the floor —
    the chromatic tripod-pad blobs the detector must learn to catch."""
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    img = np.full((H, W, 3), 90.0, dtype=np.float32)  # wall tone
    dz = dirs[..., 2]
    down = dz < -1e-9
    dd = dirs[down]
    t = (Z_FLOOR - C[2]) / dd[:, 2]
    P = C[None, :] + t[:, None] * dd
    img[down] = parquet(P[:, 0], P[:, 1])
    if boxes:
        for bmin, bmax, color in boxes:
            bmin = np.asarray(bmin, dtype=np.float64)
            bmax = np.asarray(bmax, dtype=np.float64)
            with np.errstate(divide="ignore", invalid="ignore"):
                t1 = (bmin[None, :] - C[None, :]) / dd
                t2 = (bmax[None, :] - C[None, :]) / dd
            t_near = np.nanmax(np.minimum(t1, t2), axis=1)
            t_far = np.nanmin(np.maximum(t1, t2), axis=1)
            hit = (t_near <= t_far) & (t_far > 0) & (np.maximum(t_near, 0) < t)
            sub = img[down]
            sub[hit] = np.asarray(color, dtype=np.float32)
            img[down] = sub
    hole_mask = np.zeros((H, W), dtype=bool)
    if hole_r is not None:
        off = np.hypot(P[:, 0] - C[0], P[:, 1] - C[1])
        hm = np.zeros(int(down.sum()), dtype=bool)
        hm[off < hole_r] = True
        hole_mask[down] = hm
        img[hole_mask] = img[hole_mask].mean(axis=0, keepdims=True)
    if pads:
        sub = img[down]
        for cx, cy, r, color in pads:
            pm = np.hypot(P[:, 0] - cx, P[:, 1] - cy) < r
            sub[pm] = np.asarray(color, dtype=np.float32)
        img[down] = sub
    img = np.clip(img * gain, 0, 255)
    return img.astype(np.float32), hole_mask


C_A = np.array([0.0, 0.0, 1.50])
C_B = np.array([1.80, 0.30, 1.52])
C_C = np.array([-1.50, 1.20, 1.48])
C_D = np.array([0.60, 0.00, 1.50])  # so close its own cone overlaps A's hole

GT_A, _ = render_pano(C_A, gain=1.0, hole_r=None)
IMG_A, MASK_A = render_pano(C_A, gain=1.0, hole_r=HOLE_R)
IMG_B, _mb = render_pano(C_B, gain=0.90, hole_r=HOLE_R)
IMG_C, _mc = render_pano(C_C, gain=1.12, hole_r=HOLE_R)
IMG_D, _md = render_pano(C_D, gain=1.03, hole_r=HOLE_R)
DONORS = [(IMG_B, C_B), (IMG_C, C_C), (IMG_D, C_D)]


def run_fill(composite_mode="best", grain_match=True):
    return nf.fill_nadir_hole(
        IMG_A,
        C_A,
        DONORS,
        z_floor=Z_FLOOR,
        hole_mask_eq=MASK_A,
        tripod_radius=TRIPOD_R,
        view_size=640,
        half_fov_deg=58.0,
        composite_mode=composite_mode,
        grain_match=grain_match,
    )


_CACHE = {}


def filled_and_report(composite_mode="best", grain_match=True):
    key = (composite_mode, grain_match)
    if key not in _CACHE:
        _CACHE[key] = run_fill(composite_mode, grain_match)
    return _CACHE[key]


def _view_masks(size=640, half_fov=58.0):
    """Hole + surrounding ring masks in gnomonic view space."""
    from scipy.ndimage import binary_dilation

    dirs = nf.gnomonic_nadir_dirs(size, half_fov)
    rows, cols = nf.dirs_to_pixels(dirs.reshape(-1, 3), W, H)
    hole = (
        nf.sample_equirect(MASK_A[..., None].astype(np.float32) * 255.0, rows, cols)
        .reshape(size, size, 1)[..., 0]
        > 127
    )
    ring = binary_dilation(hole, iterations=10) & ~binary_dilation(hole, iterations=2)
    return dirs, hole, ring


def _detail_std(view, mask, sigma=2.5):
    """Std of the high-frequency luminance layer — the 'grain contrast'."""
    from scipy.ndimage import gaussian_filter

    lp = gaussian_filter(view, (sigma, sigma, 0))
    lum = (view - lp) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return float(lum[mask].std())


def _psnr(a, b):
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return 99.0 if mse == 0 else 10.0 * np.log10(255.0**2 / mse)


def test_vectorized_pixel_mapping_matches_scalar():
    rng = np.random.default_rng(3)
    d = rng.normal(size=(64, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    rows, cols = nf.dirs_to_pixels(d, W, H)
    for i in range(64):
        r, c = nf.world_dir_to_equirect_pixel(d[i], W, H)
        assert abs(rows[i] - r) < 1e-9 and abs(cols[i] - c) < 1e-9


def test_fill_reconstructs_hidden_floor():
    filled, report = filled_and_report()
    psnr = _psnr(filled[MASK_A], GT_A[MASK_A])
    corr = float(
        np.corrcoef(
            filled[MASK_A].astype(np.float64).ravel(),
            GT_A[MASK_A].astype(np.float64).ravel(),
        )[0, 1]
    )
    print(f"  hole PSNR vs ground truth: {psnr:.1f} dB, corr {corr:.4f}")
    assert psnr > 26.0, f"hole PSNR {psnr:.1f} dB too low"
    assert corr > 0.95, f"hole correlation {corr:.3f} too low"


def test_fill_leaves_everything_outside_the_hole_untouched():
    filled, _ = filled_and_report()
    outside = ~MASK_A
    assert np.array_equal(filled[outside], IMG_A[outside]), (
        "fill must be surgical: only hole pixels may change"
    )


def test_seam_is_invisible_boundary_step_below_half_percent():
    # Luminance step across the hole boundary must match the ground truth's
    # own step (the texture continues); excess step = a visible ring.
    from scipy.ndimage import binary_dilation, binary_erosion

    filled, _ = filled_and_report()
    inner = MASK_A & ~binary_erosion(MASK_A, iterations=3)
    outer = binary_dilation(MASK_A, iterations=3) & ~MASK_A

    def lum(img, m):
        v = img[m].astype(np.float64)
        return float((v @ [0.2126, 0.7152, 0.0722]).mean())

    step_filled = lum(filled, inner) - lum(filled, outer)
    step_gt = lum(GT_A, inner) - lum(GT_A, outer)
    excess = abs(step_filled - step_gt)
    print(f"  boundary luminance excess step: {excess:.3f} / 255 "
          f"({excess / 255 * 100:.3f}%)")
    assert excess < 1.28, f"seam step {excess:.2f} (>0.5% of 255)"


def test_donor_own_cone_rejection_engaged():
    _, report = filled_and_report()
    assert report["cone_rejected_px"] > 0, (
        "donor D's own tripod cone overlaps the hole; rejection must engage"
    )
    print(f"  cone-rejected donor samples: {report['cone_rejected_px']}")


def test_full_donor_coverage_no_synthesis_needed_here():
    _, report = filled_and_report()
    assert report["synthesized_px"] == 0, report
    assert report["hole_px_eq"] == int(MASK_A.sum())


def test_smear_detection_finds_the_hole_without_being_told():
    # Detection runs on the gnomonic nadir view; compare in that space.
    dirs = nf.gnomonic_nadir_dirs(640, 58.0)
    view = nf.render_view(IMG_A, dirs)
    detected = nf.detect_smear_view(view)
    rows, cols = nf.dirs_to_pixels(dirs.reshape(-1, 3), W, H)
    truth = (
        nf.sample_equirect(MASK_A[..., None].astype(np.float32) * 255.0, rows, cols)
        .reshape(640, 640, 1)[..., 0]
        > 127
    )
    inter = float(np.logical_and(detected, truth).sum())
    union = float(np.logical_or(detected, truth).sum())
    iou = inter / union
    print(f"  smear-detection IoU vs true mask: {iou:.3f}")
    assert iou > 0.70, f"detection IoU {iou:.2f}"


def test_grain_contrast_matches_ring_no_ghost_disc():
    # THE ghost-disc test, measured on DELIVERED pixels: re-render the
    # filled equirect (the resample the viewer actually performs) and
    # require the hole's fine-grain contrast to sit at ring parity —
    # neither flat (ghost disc) nor over-crisped (halo of sharpening).
    filled, report = filled_and_report()
    dirs, hole, ring = _view_masks()
    fv = nf.render_view(filled, dirs)
    gv = nf.render_view(GT_A, dirs)
    ratio_filled = _detail_std(fv, hole) / max(_detail_std(fv, ring), 1e-6)
    ratio_gt = _detail_std(gv, hole) / max(_detail_std(gv, ring), 1e-6)
    print(f"  grain hole/ring ratio: filled {ratio_filled:.3f} vs truth {ratio_gt:.3f}"
          f" (gain {report.get('grain_gain')}, residual pass "
          f"{report.get('grain_residual_gain')})")
    assert ratio_filled >= 0.85, f"ghost disc: grain ratio {ratio_filled:.3f} < 0.85"
    assert ratio_filled <= 1.25, f"over-crisped: grain ratio {ratio_filled:.3f} > 1.25"
    assert ratio_filled >= 0.80 * ratio_gt, (ratio_filled, ratio_gt)


def test_best_donor_compositing_beats_averaging_on_grain():
    # The mechanism test, isolated from grain matching (grain_match=False
    # for both): averaging decorrelated donors softens grain; best-donor
    # compositing must preserve measurably more of it.
    filled_best, _ = filled_and_report("best", grain_match=False)
    filled_avg, _ = filled_and_report("average", grain_match=False)
    dirs, hole, _ring = _view_masks()
    best = _detail_std(nf.render_view(filled_best, dirs), hole)
    avg = _detail_std(nf.render_view(filled_avg, dirs), hole)
    print(f"  raw hole grain contrast: best {best:.3f} vs average {avg:.3f}")
    assert best > avg * 1.05, (best, avg)


OCC_BOX = (
    np.array([0.95, -0.15, 0.0]),
    np.array([1.15, 0.35, 0.85]),
    np.array([70.0, 60.0, 55.0]),
)
PADS = [
    (0.66, 0.12, 0.09, (168.0, 88.0, 150.0)),
    (-0.60, -0.34, 0.08, (150.0, 80.0, 140.0)),
]


def _box_tris(box):
    """12 triangles of an axis-aligned box (for the voxelizer)."""
    bmin, bmax, _ = box
    x0, y0, z0 = bmin
    x1, y1, z1 = bmax
    v = np.array(
        [
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        ]
    )
    quads = [
        (0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
        (2, 3, 7, 6), (1, 2, 6, 5), (0, 3, 7, 4),
    ]
    tris = []
    for a, b, c, d in quads:
        tris.append([v[a], v[b], v[c]])
        tris.append([v[a], v[c], v[d]])
    return np.array(tris)


def _floor_points_of_mask(mask, C):
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    dd = dirs[mask]
    t = (Z_FLOOR - C[2]) / dd[:, 2]
    return C[None, :] + t[:, None] * dd


def test_mesh_occlusion_rejects_blind_donor():
    # A low cabinet stands between donor B and part of the hole. B's pano
    # HONESTLY shows the cabinet along those rays — sampling it without a
    # visibility test paints cabinet colour onto the floor. With the voxel
    # occluder, B's blind samples are rejected and other donors take over.
    boxes = [OCC_BOX]
    gt, _ = render_pano(C_A, hole_r=None, boxes=boxes)
    tgt, mask = render_pano(C_A, hole_r=HOLE_R, boxes=boxes)
    donors = [
        (render_pano(C_B, gain=0.90, hole_r=HOLE_R, boxes=boxes)[0], C_B),
        (render_pano(C_C, gain=1.12, hole_r=HOLE_R, boxes=boxes)[0], C_C),
        (render_pano(C_D, gain=1.03, hole_r=HOLE_R, boxes=boxes)[0], C_D),
    ]
    occ = nf.VoxelOccluder.from_triangles(_box_tris(OCC_BOX), voxel=0.05)
    P = _floor_points_of_mask(mask, C_A)
    zone_flat = occ.blocked(C_B, P)
    assert int(zone_flat.sum()) > 200, "test rig: B must be blocked somewhere"
    zone_eq = np.zeros((H, W), dtype=bool)
    zone_eq[mask] = zone_flat

    common = dict(
        z_floor=Z_FLOOR, hole_mask_eq=mask, tripod_radius=TRIPOD_R,
        view_size=640, half_fov_deg=58.0,
    )
    f_no, _ = nf.fill_nadir_hole(tgt, C_A, donors, occluder=None, **common)
    f_oc, rep = nf.fill_nadir_hole(tgt, C_A, donors, occluder=occ, **common)
    err_no = float(np.abs(f_no[zone_eq] - gt[zone_eq]).mean())
    err_oc = float(np.abs(f_oc[zone_eq] - gt[zone_eq]).mean())
    print(f"  occluded-zone error: without mesh {err_no:.1f}, with mesh {err_oc:.1f}"
          f" (mesh-occluded samples: {rep.get('mesh_occluded_px')})")
    assert rep.get("mesh_occluded_px", 0) > 0
    assert err_oc < err_no * 0.55, (err_oc, err_no)
    assert err_oc < 12.0, err_oc


def test_chroma_detection_catches_tripod_pads_and_fill_restores():
    # Two purple tripod-pad blobs sit just OUTSIDE the smear — flat enough
    # to pass a variance test, detached from the nadir component, so only
    # chroma awareness can catch them. End-to-end: detection must take them
    # and the fill must put real floor back.
    tgt, _ = render_pano(C_A, hole_r=HOLE_R, pads=PADS)
    filled, _rep = nf.fill_nadir_hole(
        tgt, C_A, DONORS, z_floor=Z_FLOOR, hole_mask_eq=None,
        tripod_radius=TRIPOD_R, view_size=640, half_fov_deg=58.0,
    )
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    dz = dirs[..., 2]
    down = dz < -1e-9
    dd = dirs[down]
    t = (Z_FLOOR - C_A[2]) / dd[:, 2]
    P = C_A[None, :] + t[:, None] * dd
    pad_flat = np.zeros(int(down.sum()), dtype=bool)
    for cx, cy, r, _color in PADS:
        pad_flat |= np.hypot(P[:, 0] - cx, P[:, 1] - cy) < r * 0.9
    pad_eq = np.zeros((H, W), dtype=bool)
    pad_eq[down] = pad_flat
    err_before = float(np.abs(tgt[pad_eq] - GT_A[pad_eq]).mean())
    err_after = float(np.abs(filled[pad_eq] - GT_A[pad_eq]).mean())
    print(f"  pad-region error vs truth: before {err_before:.1f}, after {err_after:.1f}")
    assert err_before > 40.0, "test rig: pads must actually deface the floor"
    assert err_after < 14.0, f"pads survived the fill: err {err_after:.1f}"


def _dump(out_dir):
    from PIL import Image

    os.makedirs(out_dir, exist_ok=True)
    filled, report = filled_and_report()
    dirs = nf.gnomonic_nadir_dirs(640, 58.0)
    for name, img in [
        ("synthetic-1-ground-truth", GT_A),
        ("synthetic-2-tripod-smear", IMG_A),
        ("synthetic-3-filled", filled),
    ]:
        view = nf.render_view(img, dirs)
        Image.fromarray(view.clip(0, 255).astype(np.uint8)).save(
            os.path.join(out_dir, f"{name}.png")
        )
    gt_v = nf.render_view(GT_A, dirs)
    fl_v = nf.render_view(filled, dirs)
    err = np.abs(gt_v - fl_v).mean(axis=-1) * 4.0
    Image.fromarray(err.clip(0, 255).astype(np.uint8)).save(
        os.path.join(out_dir, "synthetic-4-absdiff-x4.png")
    )
    print("report:", report)
    print(f"dumped panels to {out_dir}")


if __name__ == "__main__":
    dump_dir = None
    if "--dump" in sys.argv:
        dump_dir = sys.argv[sys.argv.index("--dump") + 1]
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
    if dump_dir and not failed:
        _dump(dump_dir)
    sys.exit(1 if failed else 0)

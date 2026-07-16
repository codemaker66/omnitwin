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


def render_pano(C, gain=1.0, hole_r=None):
    """Analytic world-oriented equirect of the infinite parquet floor seen
    from scanner centre C. Above the horizon: a flat wall tone (must never
    be sampled by the fill). hole_r punches the tripod smear (blob of the
    local mean colour, like the real scanner artifact)."""
    dirs = ext.world_equirect_band_dirs(W, H, 0, H).astype(np.float64)
    img = np.full((H, W, 3), 90.0, dtype=np.float32)  # wall tone
    dz = dirs[..., 2]
    down = dz < -1e-9
    t = (Z_FLOOR - C[2]) / dz[down]
    P = C[None, :] + t[:, None] * dirs[down]
    img[down] = parquet(P[:, 0], P[:, 1])
    hole_mask = np.zeros((H, W), dtype=bool)
    if hole_r is not None:
        off = np.hypot(P[:, 0] - C[0], P[:, 1] - C[1])
        hm = np.zeros(down.sum(), dtype=bool)
        hm[off < hole_r] = True
        hole_mask[down] = hm
        img[hole_mask] = img[hole_mask].mean(axis=0, keepdims=True)
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


def run_fill():
    return nf.fill_nadir_hole(
        IMG_A,
        C_A,
        DONORS,
        z_floor=Z_FLOOR,
        hole_mask_eq=MASK_A,
        tripod_radius=TRIPOD_R,
        view_size=640,
        half_fov_deg=58.0,
    )


_CACHE = {}


def filled_and_report():
    if "r" not in _CACHE:
        _CACHE["r"] = run_fill()
    return _CACHE["r"]


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

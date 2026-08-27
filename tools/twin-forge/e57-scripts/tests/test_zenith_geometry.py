"""Geometry core for the ZENITH (ceiling) fill, with exact synthetic ground truth.

The mirror of the nadir tripod fill. Each sweep is blind in a cone straight UP
(the scanner's own mount), which on the Grand Hall's coffered ceiling reads as a
grey blob overhead. The floor under a tripod is seen cleanly by NEIGHBOURS, and
so is the ceiling above one — but the donor rule inverts in a way that is easy
to get backwards, which is what these tests exist to pin.

THE MIRROR RULE. For the floor, a donor is rejected when its own GROUND point
lies within the tripod radius of P, because P then sits under that donor's own
blind disc. For the ceiling the same test applies to the donor's own CEILING
point — so a donor standing almost underneath the patch is the WORST possible
witness, not the best. Feasibility measured this directly on the real capture:
the patch at scan_045's zenith renders at texture 3.7 (grey mush); the same
world patch renders 15.0 / 14.0 from scan_009 / scan_000 standing 2.8 m away,
yet only 8.2 from scan_008 standing 0.9 m away, because scan_008's own zenith
cone covers it. Nearness is not the ranking; being OFF to the side is.

Run: python tests/test_zenith_geometry.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nadir_fill as nf  # noqa: E402
import zenith_fill as zf  # noqa: E402

W, H = 1024, 512
Z_CEIL = 7.0        # Grand Hall coffered ceiling
EYE = 1.5           # scanner height
CONE_HALF_DEG = 25.0


def coffer(x, y):
    """Deterministic procedural coffered ceiling: a grid of sunken panels with
    gold lines on the ribs. Vectorized; float32 RGB in 0..255."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    pitch = 1.4
    fx = np.abs(((x / pitch) % 1.0) - 0.5) * 2.0   # 0 centre .. 1 rib
    fy = np.abs(((y / pitch) % 1.0) - 0.5) * 2.0
    rib = np.maximum(fx, fy)
    panel = (rib < 0.78).astype(np.float64)
    gold = ((rib >= 0.78) & (rib < 0.92)).astype(np.float64)
    grain = 0.5 + 0.5 * np.sin(x * 9.0) * np.sin(y * 11.0)
    base = 120.0 + panel * 40.0 + grain * 10.0
    r = base + gold * 70.0
    g = base + gold * 52.0
    b = base * 0.86 + gold * 10.0
    return np.stack([r, g, b], axis=-1).astype(np.float32)


def render_ceiling_pano(C, gain=1.0, cone_half_deg=None):
    """Analytic world-oriented equirect of the infinite coffered ceiling seen
    from scanner centre C. Below the horizon: a flat floor tone that the fill
    must never sample. cone_half_deg punches the scanner's own zenith blind
    cone as a blob of the local mean (the real artifact's shape)."""
    C = np.asarray(C, dtype=np.float64)
    dirs = nf.equirect_grid_dirs(W, H, 0, H)          # (H, W, 3)
    dz = dirs[..., 2]
    up = dz > 1e-6
    t = np.zeros_like(dz)
    np.divide(Z_CEIL - C[2], dz, out=t, where=up)
    px = C[0] + t * dirs[..., 0]
    py = C[1] + t * dirs[..., 1]
    img = np.full((H, W, 3), 60.0, dtype=np.float32)  # below-horizon floor tone
    hit = up & (t > 0)
    img[hit] = coffer(px[hit], py[hit])
    if cone_half_deg is not None:
        # The blind cone: everything within cone_half_deg of straight up is
        # replaced by the mean of the ring just outside it — a featureless blob.
        elev = np.degrees(np.arcsin(np.clip(dz, -1.0, 1.0)))
        inside = elev >= (90.0 - cone_half_deg)
        ring = (elev >= (90.0 - cone_half_deg - 6.0)) & ~inside
        if ring.any():
            img[inside] = img[ring].mean(axis=0)
    return (img * gain).astype(np.float32)


# --- ray/plane geometry -----------------------------------------------------

def test_upward_ray_hits_the_ceiling():
    C = np.array([0.0, 0.0, EYE])
    P = zf.ray_ceiling_intersection(C, np.array([0.0, 0.0, 1.0]), Z_CEIL)
    assert P is not None
    assert np.allclose(P, [0.0, 0.0, Z_CEIL])
    # A 45-degree ray travels its height in the horizontal too.
    d = np.array([1.0, 0.0, 1.0]) / np.sqrt(2.0)
    P2 = zf.ray_ceiling_intersection(C, d, Z_CEIL)
    assert np.allclose(P2, [Z_CEIL - EYE, 0.0, Z_CEIL])
    print("  upward rays meet the ceiling plane exactly")


def test_downward_and_parallel_rays_never_hit():
    C = np.array([0.0, 0.0, EYE])
    assert zf.ray_ceiling_intersection(C, np.array([0.0, 0.0, -1.0]), Z_CEIL) is None
    assert zf.ray_ceiling_intersection(C, np.array([1.0, 0.0, 0.0]), Z_CEIL) is None
    # A scanner ABOVE the plane looking up must not hit it behind itself.
    above = np.array([0.0, 0.0, Z_CEIL + 1.0])
    assert zf.ray_ceiling_intersection(above, np.array([0.0, 0.0, 1.0]), Z_CEIL) is None
    print("  downward, parallel and behind-the-origin rays correctly refused")


def test_reprojection_round_trips_through_a_donor():
    """A ceiling point reprojected into a donor and read back as a direction
    must point at that same world point — the whole fill rests on this."""
    C_d = np.array([2.5, -1.0, EYE])
    P = np.array([0.4, 0.9, Z_CEIL])
    row, col = nf.reproject_point_to_pixel(P, C_d, W, H)
    d = nf.equirect_pixel_to_world_dir(row, col, W, H)
    back = zf.ray_ceiling_intersection(C_d, d, Z_CEIL)
    assert back is not None
    assert np.linalg.norm(back - P) < 5e-3, back - P
    print(f"  reprojection round-trip error {np.linalg.norm(back - P):.2e} m")


# --- THE MIRROR RULE --------------------------------------------------------

def test_zenith_cone_radius_grows_with_height_above_the_scanner():
    r_low = zf.zenith_cone_radius_m(z_ceiling=4.0, z_eye=EYE, half_angle_deg=CONE_HALF_DEG)
    r_high = zf.zenith_cone_radius_m(z_ceiling=7.0, z_eye=EYE, half_angle_deg=CONE_HALF_DEG)
    assert r_high > r_low > 0
    # tan(25 deg) * (7 - 1.5) = 2.565 m
    assert abs(r_high - np.tan(np.radians(CONE_HALF_DEG)) * (7.0 - EYE)) < 1e-9
    print(f"  cone radius {r_low:.2f} m at 4 m, {r_high:.2f} m at 7 m")


def test_donor_directly_underneath_the_patch_is_rejected():
    """The counter-intuitive half: a donor almost below P sees P through its
    OWN blind cone and must be refused, however close it stands."""
    P = np.array([0.0, 0.0, Z_CEIL])
    radius = zf.zenith_cone_radius_m(Z_CEIL, EYE, CONE_HALF_DEG)
    near = np.array([0.3, 0.0, EYE])              # well inside the cone
    assert zf.donor_in_own_zenith_cone(P, near, radius)
    far = np.array([radius + 0.5, 0.0, EYE])      # clear of it
    assert not zf.donor_in_own_zenith_cone(P, far, radius)
    print(f"  donor at 0.30 m rejected, donor at {radius + 0.5:.2f} m accepted")


def test_weight_prefers_the_offset_witness_over_the_near_one():
    """The measured finding, as an executable claim: scan_008 at 0.9 m loses to
    scan_009 at 2.8 m because the near donor is inside its own cone."""
    P = np.array([0.0, 0.0, Z_CEIL])
    radius = zf.zenith_cone_radius_m(Z_CEIL, EYE, CONE_HALF_DEG)
    near = np.array([0.9, 0.0, EYE])
    offset = np.array([2.8, 0.0, EYE])
    w_near = zf.zenith_donor_weight(P, near, cone_radius=radius)
    w_offset = zf.zenith_donor_weight(P, offset, cone_radius=radius)
    assert w_near == 0.0, "a donor inside its own cone must score zero"
    assert w_offset > 0.0
    print(f"  near-donor weight {w_near:.3f} < offset-donor weight {w_offset:.3f}")


def test_among_valid_donors_the_more_overhead_one_still_wins():
    """Outside the cone the ordinary preference returns: less foreshortening
    and less distance is better, exactly as for the floor."""
    P = np.array([0.0, 0.0, Z_CEIL])
    radius = zf.zenith_cone_radius_m(Z_CEIL, EYE, CONE_HALF_DEG)
    steep = np.array([radius + 0.2, 0.0, EYE])   # just outside, looks steeply up
    grazing = np.array([12.0, 0.0, EYE])         # far away, very oblique
    assert zf.zenith_donor_weight(P, steep, cone_radius=radius) > zf.zenith_donor_weight(
        P, grazing, cone_radius=radius
    )
    print("  outside the cone, steeper and nearer still wins")


def test_a_donor_below_the_ceiling_plane_is_required():
    """A 'donor' at or above the ceiling cannot witness its underside."""
    P = np.array([0.0, 0.0, Z_CEIL])
    radius = zf.zenith_cone_radius_m(Z_CEIL, EYE, CONE_HALF_DEG)
    at_ceiling = np.array([3.0, 0.0, Z_CEIL])
    assert zf.zenith_donor_weight(P, at_ceiling, cone_radius=radius) == 0.0
    print("  a donor level with the ceiling scores zero")


# --- honesty about domes ----------------------------------------------------

def test_a_flat_ceiling_is_accepted_as_planar():
    heights = np.full(64, Z_CEIL) + np.random.default_rng(0).normal(0, 0.01, 64)
    assert zf.ceiling_is_planar(heights, tolerance_m=0.15)
    print("  a flat ceiling passes the planarity test")


def test_a_dome_is_refused_rather_than_filled_with_a_wrong_plane():
    """The Grand Hall's 7 m dome rises another 7 m. A planar model is simply
    wrong there, and filling anyway would paste ceiling texture onto a curve."""
    r = np.linspace(0.0, 5.0, 64)
    heights = Z_CEIL + 6.5 * np.sqrt(np.clip(1.0 - (r / 5.0) ** 2, 0.0, 1.0))
    assert not zf.ceiling_is_planar(heights, tolerance_m=0.15)
    print("  a dome is refused by the planarity test")


# --- end-to-end reconstruction ---------------------------------------------

def test_fill_reconstructs_the_hidden_ceiling():
    """The real claim: a sweep blinded overhead, rebuilt from offset donors,
    against EXACT ground truth."""
    C_t = np.array([0.0, 0.0, EYE])
    truth = render_ceiling_pano(C_t)                       # unblinded
    target = render_ceiling_pano(C_t, cone_half_deg=CONE_HALF_DEG)
    donors = [
        (render_ceiling_pano(np.array([3.2, 0.4, EYE])), np.array([3.2, 0.4, EYE])),
        (render_ceiling_pano(np.array([-2.9, 1.1, EYE])), np.array([-2.9, 1.1, EYE])),
        (render_ceiling_pano(np.array([0.6, -3.4, EYE])), np.array([0.6, -3.4, EYE])),
    ]
    filled, report = zf.fill_zenith_hole(
        target, C_t, donors, z_ceiling=Z_CEIL,
        cone_half_deg=CONE_HALF_DEG, eye_height=EYE,
    )
    mask = report["hole_mask_eq"]
    assert mask.sum() > 0, "nothing was identified as blind"
    err = np.abs(filled[mask].astype(np.float64) - truth[mask].astype(np.float64))
    mse = float((err ** 2).mean())
    psnr = 10.0 * np.log10((255.0 ** 2) / max(mse, 1e-9))
    a = filled[mask].astype(np.float64).ravel()
    b = truth[mask].astype(np.float64).ravel()
    corr = float(np.corrcoef(a, b)[0, 1])
    print(f"  zenith PSNR vs ground truth: {psnr:.1f} dB, corr {corr:.4f}, "
          f"{report['filled_px']} px filled, {report['synth_px']} synthesized")
    assert psnr > 24.0, f"reconstruction too poor: {psnr:.1f} dB"
    assert corr > 0.90, f"structure not recovered: {corr:.4f}"


def test_fill_leaves_everything_outside_the_cone_untouched():
    C_t = np.array([0.0, 0.0, EYE])
    target = render_ceiling_pano(C_t, cone_half_deg=CONE_HALF_DEG)
    donors = [(render_ceiling_pano(np.array([3.2, 0.4, EYE])), np.array([3.2, 0.4, EYE]))]
    filled, report = zf.fill_zenith_hole(
        target, C_t, donors, z_ceiling=Z_CEIL,
        cone_half_deg=CONE_HALF_DEG, eye_height=EYE,
    )
    outside = ~report["hole_mask_eq"]
    assert np.array_equal(filled[outside], target[outside]), "pixels outside the cone moved"
    print("  every pixel outside the blind cone is byte-identical")


def test_a_sweep_that_already_sees_its_ceiling_is_left_alone():
    """THE REGRESSION THE PILOT CAUGHT, pinned.

    Not every sweep is blind overhead. Run against the real Reception Room
    (scan_126) the first version filled all 1.16 M cone pixels of a ceiling
    that was already sharp — mouldings, downlights and all — and pasted a
    visible disc over it, flattening a downlight's bloom. A geometric mask
    alone cannot know; the evidence gate compares what the donors show against
    what the target already has, and declines when the target is no worse.
    """
    C_t = np.array([0.0, 0.0, EYE])
    seeing = render_ceiling_pano(C_t)          # NO blind cone: a good capture
    donors = [
        (render_ceiling_pano(np.array([3.2, 0.4, EYE])), np.array([3.2, 0.4, EYE])),
        (render_ceiling_pano(np.array([-2.9, 1.1, EYE])), np.array([-2.9, 1.1, EYE])),
    ]
    filled, report = zf.fill_zenith_hole(
        seeing, C_t, donors, z_ceiling=Z_CEIL,
        cone_half_deg=CONE_HALF_DEG, eye_height=EYE,
    )
    changed = int((filled != seeing).any(axis=2).sum())
    total = int(report["hole_mask_eq"].sum())
    print(f"  already-sharp ceiling: {report['filled_px']} filled, "
          f"{report['kept_target_px']} kept, {changed}/{total} px touched")
    assert report["kept_target_px"] > 0, "the gate never engaged"
    assert changed < total * 0.02, (
        f"a sweep that already sees its ceiling was overwritten: {changed}/{total} px"
    )


def test_no_donor_leaves_the_hole_honestly_reported():
    """With every donor inside its own cone there is no evidence; the fill must
    say so rather than invent ceiling."""
    C_t = np.array([0.0, 0.0, EYE])
    target = render_ceiling_pano(C_t, cone_half_deg=CONE_HALF_DEG)
    donors = [(render_ceiling_pano(np.array([0.2, 0.0, EYE])), np.array([0.2, 0.0, EYE]))]
    filled, report = zf.fill_zenith_hole(
        target, C_t, donors, z_ceiling=Z_CEIL,
        cone_half_deg=CONE_HALF_DEG, eye_height=EYE,
    )
    assert report["donorless_px"] > 0
    assert report["filled_px"] == 0 or report["donorless_px"] >= report["filled_px"]
    print(f"  {report['donorless_px']} px reported donorless, nothing invented")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        print(f"{fn.__name__}:")
        fn()
    print(f"\n{len(fns)}/{len(fns)} zenith geometry tests passed")

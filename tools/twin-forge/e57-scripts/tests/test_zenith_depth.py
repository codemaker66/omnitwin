"""Per-ray depth for the zenith fill, so a DOME can be filled at all.

The planar fill refuses anything that is not one plane, and on this capture
that refusal covers the Grand Hall dome — the most visible ceiling defect in
the building. A dome is not a modelling failure to be special-cased; it is a
surface, and the general way to recover a surface from several photographs is
plane-sweep stereo: march along each blind ray, and at each candidate depth ask
whether the donors AGREE about the colour there. They agree only where the ray
actually meets something.

That single idea replaces the plane, the height solve and the planarity gate at
once, and it handles the soffits and stairwells the planar gates also refused.

The tests build two synthetic ceilings with exact ground truth — a flat one and
a spherical dome — and require the sweep to recover both, to prefer the truth
over a wrong depth, and to report its own confidence so a caller can decline
rather than guess.

Run: python tests/test_zenith_depth.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nadir_fill as nf  # noqa: E402
import zenith_depth as zd  # noqa: E402

W, H = 1024, 512
EYE = 1.5
Z_FLAT = 7.0
CONE_HALF_DEG = 25.0

# A dome springing from the flat ceiling: a hemisphere centred ON the springing
# plane, so it rises its own radius above the coffers — the Trades Hall shape,
# where the Grand Hall's dome climbs metres above a 7 m ceiling.
#
# An earlier fixture put the centre well BELOW the springing plane, which makes
# a cap rising only 0.6 m over a 2.16 m base. That is a saucer, not a dome, and
# it is a feeble test: a plane fits it almost as well as the truth does, so
# passing would have proved little about telling curves from flats.
DOME_CENTRE = np.array([0.0, 0.0, 7.0])
DOME_R = 2.2


def texture(x, y):
    """Deterministic ceiling texture with an APERIODIC component.

    Photo-consistency needs something to correlate, and a blank ceiling is
    ambiguous at every depth — a fact about the world these tests must not
    paper over. But a texture of pure sines is ambiguous in a second, sneakier
    way: it repeats, so a wrong depth can land exactly one period away and
    match perfectly. A first version of this fixture was periodic at about 2 m
    and the sweep duly recovered the FLAT ceiling to only ~1 m, chasing
    aliases. Real ceilings carry unique marks — dirt, casting seams, panels
    that differ — so the hash term below is the realistic case, not a
    convenience.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    a = np.sin(x * 3.1) * np.sin(y * 2.7)
    b = np.sin((x + y) * 7.3)
    # Deterministic value noise: a hash of the cell, smoothly interpolated.
    def _h(i, j):
        s = np.sin(i * 127.1 + j * 311.7) * 43758.5453
        return s - np.floor(s)
    sx, sy = x * 1.7, y * 1.7
    i0, j0 = np.floor(sx), np.floor(sy)
    fx, fy = sx - i0, sy - j0
    ex, ey = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    n = (
        _h(i0, j0) * (1 - ex) * (1 - ey)
        + _h(i0 + 1, j0) * ex * (1 - ey)
        + _h(i0, j0 + 1) * (1 - ex) * ey
        + _h(i0 + 1, j0 + 1) * ex * ey
    )
    base = 130.0 + 30.0 * a + 18.0 * b + 60.0 * n
    return np.stack([base, base * 0.86, base * 0.7], axis=-1).astype(np.float32)


def _sphere_t(C, d):
    """Distance to the DOME along each ray, or inf where the ray misses it.

    Both roots must be considered, and the naive "take the near one" is wrong
    here. A scanner on the floor sits outside the sphere and below it, so the
    near root lands on the sphere's underside BELOW the springing plane — a
    surface that does not exist, the dome being only the cap above z = Z_FLAT.
    Discarding the near root and stopping (as a first version did) renders no
    dome at all, silently, and the scene quietly becomes a flat ceiling.
    """
    oc = np.asarray(C, dtype=np.float64) - DOME_CENTRE
    b = 2.0 * np.einsum("...i,...i->...", d, oc)
    c = float(oc @ oc) - DOME_R * DOME_R
    disc = b * b - 4.0 * c
    out = np.full(d.shape[:-1], np.inf)
    ok = disc >= 0.0
    if not ok.any():
        return out
    sq = np.sqrt(disc[ok])
    best = np.full(sq.shape, np.inf)
    for root in ((-b[ok] - sq) / 2.0, (-b[ok] + sq) / 2.0):
        z = C[2] + root * d[ok][..., 2]
        usable = (root > 1e-6) & (z > Z_FLAT)
        best = np.where(usable, np.minimum(best, root), best)
    out[ok] = best
    return out


def render_pano(C, dome=False, cone_half_deg=None):
    """World-oriented equirect of the ceiling from centre C. With dome=True the
    upper surface is the spherical cap; otherwise a flat plane at Z_FLAT."""
    C = np.asarray(C, dtype=np.float64)
    dirs = nf.equirect_grid_dirs(W, H, 0, H)
    dz = dirs[..., 2]
    up = dz > 1e-6
    img = np.full((H, W, 3), 55.0, dtype=np.float32)

    t_plane = np.full_like(dz, np.inf)
    np.divide(Z_FLAT - C[2], dz, out=t_plane, where=up)
    t_plane = np.where(up & (t_plane > 0), t_plane, np.inf)
    t = t_plane
    if dome:
        # The ceiling has an APERTURE the dome springs from. Without it the
        # flat plane is infinite and always occludes the cap above it, so the
        # "dome" scene renders byte-identical to the flat one — which is
        # exactly what a first version did, silently.
        Pp = C + np.where(np.isfinite(t_plane), t_plane, 0.0)[..., None] * dirs
        through = np.hypot(Pp[..., 0], Pp[..., 1]) < DOME_R
        t_plane = np.where(through, np.inf, t_plane)
        # _sphere_t already restricts itself to the cap above the springing
        # plane, so whichever surface the ray meets FIRST is what it sees.
        t = np.minimum(t_plane, _sphere_t(C, dirs))

    hit = np.isfinite(t)
    P = C + np.where(hit, t, 0.0)[..., None] * dirs
    # Texture parameterised on the surface point, so every sweep that lands on
    # the true surface sees the same colour from every donor.
    img[hit] = texture(P[..., 0][hit], P[..., 1][hit] + P[..., 2][hit] * 0.35)

    if cone_half_deg is not None:
        elev = np.degrees(np.arcsin(np.clip(dz, -1.0, 1.0)))
        inside = elev >= (90.0 - cone_half_deg)
        ring = (elev >= (90.0 - cone_half_deg - 6.0)) & ~inside
        if ring.any():
            img[inside] = img[ring].mean(axis=0)
    return img


def donors_at(offsets, dome):
    return [
        (render_pano(np.array([x, y, EYE]), dome=dome), np.array([x, y, EYE]))
        for x, y in offsets
    ]


OFFSETS = [(3.4, 0.5), (-3.1, 1.2), (0.7, -3.6), (2.6, 2.8)]


# --- the sweep grid ---------------------------------------------------------

def test_cone_grid_covers_the_blind_cone_and_nothing_else():
    dirs, rows, cols = zd.cone_grid(H, W, CONE_HALF_DEG, 48)
    assert dirs.shape[0] == rows.size == cols.size
    elev = np.degrees(np.arcsin(np.clip(dirs[:, 2], -1, 1)))
    assert elev.min() >= 90.0 - CONE_HALF_DEG - 1e-6
    assert dirs[:, 2].min() > 0, "every swept ray must point up"
    print(f"  {dirs.shape[0]} sample rays, all inside the cone")


# --- photo-consistency ------------------------------------------------------

def test_the_true_depth_scores_better_than_a_wrong_one_on_a_flat_ceiling():
    C_t = np.array([0.0, 0.0, EYE])
    donors = donors_at(OFFSETS, dome=False)
    dirs, _, _ = zd.cone_grid(H, W, CONE_HALF_DEG, 32)
    true_t = (Z_FLAT - EYE) / dirs[:, 2]
    good = zd.consistency_at(C_t, dirs, true_t, donors, W, H)
    bad = zd.consistency_at(C_t, dirs, true_t * 1.6, donors, W, H)
    assert np.nanmean(good) > np.nanmean(bad), (np.nanmean(good), np.nanmean(bad))
    print(f"  true depth {np.nanmean(good):.3f} vs wrong depth {np.nanmean(bad):.3f}")


# --- recovering a surface ---------------------------------------------------

def test_sweep_recovers_a_flat_ceiling():
    C_t = np.array([0.0, 0.0, EYE])
    donors = donors_at(OFFSETS, dome=False)
    result = zd.solve_cone_depth(
        (H, W), C_t, donors, cone_half_deg=CONE_HALF_DEG,
        grid=40, near_m=2.0, far_m=14.0, steps=80,
    )
    sel = result.confident
    assert sel.sum() > 100, "almost nothing was resolved"
    err = np.abs(result.depth[sel] - true_depth(C_t, result.dirs, dome=False)[sel])
    assert np.median(err) < 0.15, f"median depth error {np.median(err):.3f} m"
    height = np.abs(result.points[sel][:, 2] - Z_FLAT)
    assert np.median(height) < 0.15, f"median height error {np.median(height):.3f} m"
    print(f"  flat ceiling recovered to {np.median(err) * 100:.1f} cm median "
          f"({sel.sum()} of {sel.size} rays resolved)")


def true_depth(C, dirs, dome=True):
    """Ground-truth distance along each ray to whichever surface it really
    meets — the dome where the cap covers it, the flat ceiling beyond its
    springing. The cone is WIDER than the dome's base (2.56 m of cone against a
    2.16 m cap at this geometry), so a correct sweep is expected to return both
    surfaces; asserting everything lands on the sphere would be asserting a
    falsehood about the scene."""
    t_plane = np.where(dirs[:, 2] > 1e-9, (Z_FLAT - C[2]) / np.maximum(dirs[:, 2], 1e-9), np.inf)
    if not dome:
        # The flat scene has no aperture and no cap. Applying them anyway — as
        # a first version did — scores a correct flat reconstruction against
        # the WRONG scene's truth and reports a metre of error that is entirely
        # the measurement's own.
        return t_plane
    # Same aperture as the renderer: inside the oculus the ray sees the cap.
    Pp = C + np.where(np.isfinite(t_plane), t_plane, 0.0)[:, None] * dirs
    t_plane = np.where(np.hypot(Pp[:, 0], Pp[:, 1]) < DOME_R, np.inf, t_plane)
    return np.minimum(t_plane, _sphere_t(C, dirs))


def test_sweep_recovers_a_DOME_the_planar_fill_could_never_model():
    """The headline: the Grand Hall's shape, from photographs alone."""
    C_t = np.array([0.0, 0.0, EYE])
    donors = donors_at(OFFSETS, dome=True)
    result = zd.solve_cone_depth(
        (H, W), C_t, donors, cone_half_deg=CONE_HALF_DEG,
        grid=40, near_m=2.0, far_m=14.0, steps=90,
    )
    sel = result.confident
    assert sel.sum() > 100, "almost nothing was resolved"
    truth = true_depth(C_t, result.dirs, dome=True)
    err = np.abs(result.depth[sel] - truth[sel])
    assert np.median(err) < 0.30, f"median depth error {np.median(err):.3f} m"

    # And the cap itself must be found, not flattened onto the plane — which is
    # exactly what the planar fill assumed and what smeared the real dome.
    P = result.points[sel]
    on_cap = np.hypot(P[:, 0], P[:, 1]) < 1.6
    assert on_cap.sum() > 20, "no rays resolved inside the cap"
    assert np.median(P[on_cap][:, 2]) > Z_FLAT + 0.5, np.median(P[on_cap][:, 2])
    radial = np.abs(np.linalg.norm(P[on_cap] - DOME_CENTRE, axis=1) - DOME_R)
    assert np.median(radial) < 0.25, f"cap radial error {np.median(radial):.3f} m"
    print(f"  depth recovered to {np.median(err) * 100:.1f} cm median; cap surface to "
          f"{np.median(radial) * 100:.1f} cm, sitting at z={np.median(P[on_cap][:, 2]):.2f} m "
          f"(the plane the planar fill assumed was {Z_FLAT})")


def test_a_blank_ceiling_is_reported_unconfident_rather_than_guessed():
    """Photo-consistency is ambiguous on a featureless surface — every depth
    matches. The sweep must say so instead of inventing a depth."""
    C_t = np.array([0.0, 0.0, EYE])
    flat = np.full((H, W, 3), 150.0, dtype=np.float32)
    donors = [(flat.copy(), np.array([x, y, EYE])) for x, y in OFFSETS]
    result = zd.solve_cone_depth(
        (H, W), C_t, donors, cone_half_deg=CONE_HALF_DEG,
        grid=24, near_m=2.0, far_m=14.0, steps=40,
    )
    assert result.confident.mean() < 0.15, result.confident.mean()
    print(f"  only {result.confident.mean() * 100:.1f}% of a blank ceiling claimed")


def test_two_donors_are_the_minimum_and_one_yields_nothing():
    C_t = np.array([0.0, 0.0, EYE])
    donors = donors_at(OFFSETS[:1], dome=False)
    result = zd.solve_cone_depth(
        (H, W), C_t, donors, cone_half_deg=CONE_HALF_DEG,
        grid=24, near_m=2.0, far_m=14.0, steps=30,
    )
    assert not result.confident.any(), "a single donor cannot corroborate itself"
    print("  one donor resolves nothing — agreement needs someone to agree with")


def test_donors_inside_their_own_blind_cone_are_excluded_from_the_vote():
    """The mirror rule still applies per candidate point: a donor whose own
    zenith cone covers the point sees mush there and must not vote."""
    C_t = np.array([0.0, 0.0, EYE])
    dirs, _, _ = zd.cone_grid(H, W, CONE_HALF_DEG, 16)
    t = (Z_FLAT - EYE) / dirs[:, 2]
    P = C_t + t[:, None] * dirs
    # A donor standing directly under the patch contributes no votes.
    votes = zd.donor_votes(P, np.array([0.0, 0.0, EYE]), cone_half_deg=CONE_HALF_DEG)
    assert votes.mean() < 0.5, votes.mean()
    print(f"  a donor beneath the patch votes on only {votes.mean() * 100:.0f}% of it")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        print(f"{fn.__name__}:")
        fn()
    print(f"\n{len(fns)}/{len(fns)} zenith depth tests passed")

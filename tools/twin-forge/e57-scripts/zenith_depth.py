"""Plane-sweep depth for the zenith cone — the fill that can see a dome.

zenith_fill models the ceiling as ONE PLANE. That is right for the Saloon's
coffers and the Reception Room's panels, and it is why those four sweeps filled
well. It is wrong for the Grand Hall, whose dome rises metres above the flat
ceiling that rings it, and the planar fill's own gates now refuse that node
rather than smear it. Refusing is honest; it is not a fix.

This module removes the assumption instead of special-casing the exception.
For each blind ray, march along it and at every candidate depth ask the donors
whether they AGREE about the colour there. Donors only agree where the ray
actually meets a surface, so the depth that maximises agreement IS the surface
— dome, soffit, stairwell or plane, with no model to choose in advance. It is
plane-sweep stereo, restricted to the cone the scanner could not see.

Three properties this owes the rest of the pipeline:

  * THE MIRROR RULE SURVIVES, per candidate point rather than per donor. A
    donor whose own zenith cone covers the point is blind there too, so it is
    dropped from that point's vote — near donors are still the worst witnesses.
  * AMBIGUITY IS REPORTED, NOT RESOLVED. A blank plaster ceiling is consistent
    at EVERY depth. The sweep returns a confidence built from how sharply the
    best depth beat the rest, and a caller that fills an unconfident ray is
    inventing geometry. `ConeDepth.confident` is the honest subset.
  * IT NEEDS TWO DONORS. One donor agrees with itself at every depth, which is
    not evidence; with fewer than two witnesses nothing is confident.

Cost is bounded by sweeping a COARSE grid over the cone (a few thousand rays,
not a million pixels) and interpolating the surface afterwards, which is how
plane-sweep stereo is normally afforded.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import nadir_fill as nf

__all__ = [
    "cone_grid",
    "donor_votes",
    "consistency_at",
    "solve_cone_depth",
    "ConeDepth",
    "MIN_CONFIDENCE",
    "MIN_ABS_CONSISTENCY",
    "MIN_PATCH_CONTRAST",
    "MIN_VOTERS",
]

# A ray is only believed when its best depth beat the field by this margin, in
# units of the score's own spread across the sweep. A featureless ceiling scores
# flat across every depth, so its margin collapses and it is refused.
MIN_CONFIDENCE = 0.35

# ...AND when that winner is good in ABSOLUTE terms. A margin alone only says
# one candidate beat the others; the best of a uniformly bad field still wins
# one. That is not a hypothetical: where a dome's interior is hidden from an
# oblique donor by the oculus itself, every candidate depth is wrong, and a
# purely relative confidence marked all 1184 swept rays as resolved with a
# median depth error of 0.86 m. Requiring the donors to actually agree
# (mapped NCC 0.8 is a raw NCC of 0.6) keeps the rays that are genuinely
# corroborated and refuses the rest, which is what "cannot be seen" should
# produce.
MIN_ABS_CONSISTENCY = 0.8

# Fewer voters than this is not corroboration.
MIN_VOTERS = 2

# Least contrast, in grey levels, that a patch must carry before its shape is
# treated as structure. Normalising a patch divides out its magnitude, so a
# patch holding nothing but rounding noise becomes a unit vector of noise and
# correlates with other noise at random — measured, that alone claimed 32% of a
# perfectly blank ceiling as confidently resolved. Below about one grey level
# of variation there is no structure to match, only the sensor and the codec.
MIN_PATCH_CONTRAST = 2.0


@dataclass(frozen=True)
class ConeDepth:
    """The recovered surface over the swept cone."""

    #: (N, 3) equirect ray directions that were swept.
    dirs: np.ndarray
    #: (N,) equirect row of each ray in the target.
    rows: np.ndarray
    #: (N,) equirect column of each ray in the target.
    cols: np.ndarray
    #: (N,) distance along each ray to the winning surface point.
    depth: np.ndarray
    #: (N, 3) world points at that depth.
    points: np.ndarray
    #: (N,) 0..1 margin by which the winning depth beat the field.
    confidence: np.ndarray
    #: (N,) how many donors were entitled to vote on that ray.
    voters: np.ndarray
    #: (N,) bool — enough voters AND a decisive winner.
    confident: np.ndarray


def cone_grid(
    h: int, w: int, cone_half_deg: float, grid: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A coarse, even sample of rays covering the blind cone.

    Sampling the equirect's own rows/cols directly would crowd the pole — the
    top row of an equirect is one point smeared across the full width — so the
    grid is built on the tangent plane at zenith and mapped back. Returns
    (dirs, rows, cols) with the rows/cols of the equirect pixel each ray came
    from, so a caller can write results back.
    """
    half = np.tan(np.radians(cone_half_deg))
    lin = np.linspace(-half, half, grid)
    gx, gy = np.meshgrid(lin, lin)
    inside = (gx * gx + gy * gy) <= (half * half + 1e-12)
    dirs = np.stack([gx[inside], gy[inside], np.ones(int(inside.sum()))], axis=-1)
    dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
    rows, cols = nf.dirs_to_pixels(dirs, w, h)
    return dirs, rows, cols


def donor_votes(
    P: np.ndarray, C_donor: np.ndarray, cone_half_deg: float
) -> np.ndarray:
    """Which candidate points may this donor testify about?

    THE MIRROR RULE, per point. A donor is entitled to vote on P only when P is
    above it and outside its own zenith cone — inside that cone the donor is
    blind, and letting it vote would let mush corroborate mush.
    """
    P = np.asarray(P, dtype=np.float64)
    C = np.asarray(C_donor, dtype=np.float64)
    rel = P - C
    up = rel[:, 2] > 0.0
    offs = np.hypot(rel[:, 0], rel[:, 1])
    # The donor's blind radius AT THE HEIGHT OF EACH CANDIDATE POINT.
    radius = np.tan(np.radians(cone_half_deg)) * np.maximum(rel[:, 2], 0.0)
    return up & (offs >= radius)


def _sample_donor(
    donor_img: np.ndarray, P: np.ndarray, C_d: np.ndarray, w: int, h: int
) -> np.ndarray:
    rows, cols = nf.dirs_to_pixels(P - C_d, w, h)
    return nf.sample_equirect(donor_img, rows, cols).astype(np.float64)


def _tangent_basis(dirs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Two unit vectors perpendicular to each ray, for laying a patch on the
    surface. The seed is swapped near the pole so the cross product never
    degenerates on a straight-up ray — which is every ray here."""
    seed = np.tile(np.array([1.0, 0.0, 0.0]), (dirs.shape[0], 1))
    parallel = np.abs(dirs[:, 0]) > 0.9
    seed[parallel] = np.array([0.0, 1.0, 0.0])
    u = np.cross(dirs, seed)
    u /= np.maximum(np.linalg.norm(u, axis=1, keepdims=True), 1e-12)
    v = np.cross(dirs, u)
    v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    return u, v


def consistency_at(
    C_target: np.ndarray,
    dirs: np.ndarray,
    t: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    w: int,
    h: int,
    cone_half_deg: float = 25.0,
    patch_m: float = 0.12,
) -> np.ndarray:
    """How well do the donors agree about the point at depth `t` on each ray?

    A PATCH, not a pixel, and NORMALISED correlation rather than raw spread.
    Both corrections earn their cost:

      * One pixel is weak evidence. Two donors can match on a single sample at
        many wrong depths, so the score has near-ties everywhere and the winner
        is close to arbitrary — measured, a single-pixel score recovered the
        synthetic dome only to ~0.33 m, barely better than the sweep's own grid.
        Sampling a small patch laid ON the candidate surface makes a wrong depth
        disagree in FIVE places at once.
      * These are unharmonized JPEGs from different sweeps, so a donor can be a
        different brightness on the same plaster. Normalising each donor's patch
        to zero mean and unit variance before correlating means the score
        measures STRUCTURE, which is what identifies a surface, and ignores
        exposure, which does not.

    Returns the mean pairwise correlation over donors entitled to vote, mapped
    to 0..1. NaN where fewer than MIN_VOTERS donors could see the point at all —
    an absence of evidence, which must never be read as disagreement.
    """
    C_t = np.asarray(C_target, dtype=np.float64)
    P = C_t + np.asarray(t, dtype=np.float64)[:, None] * dirs
    n = P.shape[0]
    u, v = _tangent_basis(dirs)
    # Centre plus four neighbours on the local tangent plane.
    offsets = [
        np.zeros_like(P),
        u * patch_m, -u * patch_m,
        v * patch_m, -v * patch_m,
    ]

    patches: list[np.ndarray] = []
    allowed_list: list[np.ndarray] = []
    for donor_img, C_d in donors:
        C_d = np.asarray(C_d, dtype=np.float64)
        allowed = donor_votes(P, C_d, cone_half_deg)
        if not allowed.any():
            continue
        cols = [
            _sample_donor(donor_img, P + off, C_d, w, h).mean(axis=1)
            for off in offsets
        ]
        patch = np.stack(cols, axis=1)  # (n, 5)
        # Zero-mean, unit-variance per ray: structure only, exposure ignored.
        patch -= patch.mean(axis=1, keepdims=True)
        norm = np.linalg.norm(patch, axis=1, keepdims=True)
        # Threshold in GREY LEVELS, before normalising. See MIN_PATCH_CONTRAST.
        flat = norm[:, 0] < MIN_PATCH_CONTRAST
        patch = patch / np.maximum(norm, 1e-9)
        patches.append(patch)
        allowed_list.append(allowed & ~flat)

    n_don = len(patches)
    out = np.full(n, np.nan)
    if n_don < MIN_VOTERS:
        return out

    acc = np.zeros(n)
    pairs = np.zeros(n)
    for i in range(n_don):
        for j in range(i + 1, n_don):
            both = allowed_list[i] & allowed_list[j]
            if not both.any():
                continue
            ncc = np.einsum("ij,ij->i", patches[i], patches[j])
            acc += np.where(both, ncc, 0.0)
            pairs += both
    ok = pairs > 0
    if ok.any():
        # NCC runs -1..1; map to 0..1 so "no agreement" is 0, not a negative.
        out[ok] = (acc[ok] / pairs[ok] + 1.0) / 2.0
    return out


def _sweep(
    C_t: np.ndarray,
    dirs: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    inv: np.ndarray,
    w: int,
    h: int,
    cone_half_deg: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Raw sweep: returns (scores over candidates, validity mask)."""
    scores = np.full((inv.size, dirs.shape[0]), np.nan)
    for i, iv in enumerate(inv):
        scores[i] = consistency_at(
            C_t, dirs, np.full(dirs.shape[0], 1.0 / iv), donors, w, h, cone_half_deg
        )
    return scores, np.isfinite(scores)


def solve_cone_depth(
    shape: tuple[int, int],
    C_target: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    cone_half_deg: float = 25.0,
    grid: int = 48,
    near_m: float = 1.0,
    far_m: float = 14.0,
    steps: int = 96,
    cross_check_m: float = 0.35,
) -> ConeDepth:
    """Sweep depth along every cone ray and keep the most photo-consistent.

    Depths are swept in INVERSE distance, the standard choice: a fixed metre
    step wastes most of its samples far away, where a metre barely moves a
    pixel, and starves the near range where it moves many.
    """
    h, w = shape
    dirs, rows, cols = cone_grid(h, w, cone_half_deg, grid)
    n = dirs.shape[0]
    C_t = np.asarray(C_target, dtype=np.float64)

    if len(donors) < MIN_VOTERS:
        zeros = np.zeros(n)
        return ConeDepth(
            dirs=dirs, rows=rows, cols=cols, depth=zeros,
            points=C_t + zeros[:, None] * dirs,
            confidence=zeros, voters=zeros,
            confident=np.zeros(n, dtype=bool),
        )

    inv = np.linspace(1.0 / far_m, 1.0 / near_m, steps)
    scores, valid = _sweep(C_t, dirs, donors, inv, w, h, cone_half_deg)
    any_valid = valid.any(axis=0)
    filled = np.where(valid, scores, -np.inf)
    best_i = np.argmax(filled, axis=0)
    best = filled[best_i, np.arange(n)]

    # Confidence: how far the winner stands above the typical score for that
    # ray, normalised by the spread. A ceiling that matches everywhere (blank
    # plaster) has no spread, so no winner, so no confidence.
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(np.where(valid, scores, np.nan), axis=0)
        std = np.nanstd(np.where(valid, scores, np.nan), axis=0)
    margin = np.where(std > 1e-6, (best - mean) / (std + 1e-9), 0.0)
    confidence = np.clip(margin / 4.0, 0.0, 1.0)
    confidence = np.where(any_valid & np.isfinite(best), confidence, 0.0)

    # Sub-step refinement: fit a parabola through the winning score and its two
    # neighbours and take its vertex. Without it the answer is quantised to the
    # sweep's own step — about 15 cm at 5 m for a 90-step sweep — which is a
    # limit of the search, not of the evidence. Standard practice in stereo.
    step_inv = inv[1] - inv[0] if steps > 1 else 0.0
    inv_best = inv[best_i].astype(np.float64)
    interior = (best_i > 0) & (best_i < steps - 1)
    if interior.any() and step_inv > 0:
        idx = np.nonzero(interior)[0]
        s0 = filled[best_i[idx] - 1, idx]
        s1 = filled[best_i[idx], idx]
        s2 = filled[best_i[idx] + 1, idx]
        denom = s0 - 2.0 * s1 + s2
        # A flat or non-finite neighbourhood has no vertex to find; leave those
        # rays on the grid value rather than dividing by nothing.
        usable = np.isfinite(denom) & (np.abs(denom) > 1e-12) & np.isfinite(s0) & np.isfinite(s2)
        delta = np.zeros(idx.size)
        delta[usable] = 0.5 * (s0[usable] - s2[usable]) / denom[usable]
        delta = np.clip(delta, -0.5, 0.5)
        inv_best[idx] += delta * step_inv

    depth = np.where(any_valid & (inv_best > 1e-9), 1.0 / np.maximum(inv_best, 1e-9), 0.0)
    points = C_t + depth[:, None] * dirs

    voters = np.zeros(n)
    for _img, C_d in donors:
        voters += donor_votes(points, np.asarray(C_d, dtype=np.float64), cone_half_deg)

    confident = (
        any_valid
        & (voters >= MIN_VOTERS)
        & (confidence >= MIN_CONFIDENCE)
        & (best >= MIN_ABS_CONSISTENCY)
    )

    # CROSS-CHECK on disjoint halves of the donors. Neither a relative margin
    # nor an absolute score can catch "consistent but wrong": where a dome's
    # interior is hidden behind its own oculus, donors can agree strongly at a
    # depth that is not the surface, and both gates wave it through. Splitting
    # the witnesses catches it, because two independent subsets fooled by
    # different geometry rarely land on the SAME wrong depth. A ray survives
    # only if the halves independently choose depths within cross_check_m.
    # Leave-one-out, not halves. Splitting four witnesses into two pairs leaves
    # each subset at the bare minimum for any agreement at all, so subsets fail
    # to vote wherever a single donor is ineligible — measured, that threw away
    # five sixths of a FLAT ceiling the full sweep had recovered to 6 cm.
    # Dropping ONE donor keeps every subset strong while still being genuinely
    # independent of that donor's particular geometry.
    if len(donors) >= MIN_VOTERS + 1:
        depths = []
        for subset in (donors[1:], donors[:-1]):
            s_scores, s_valid = _sweep(C_t, dirs, subset, inv, w, h, cone_half_deg)
            s_filled = np.where(s_valid, s_scores, -np.inf)
            s_best_i = np.argmax(s_filled, axis=0)
            s_any = s_valid.any(axis=0)
            depths.append(np.where(s_any, 1.0 / inv[s_best_i], np.nan))
        disagreement = np.abs(depths[0] - depths[1])
        agrees = np.isfinite(disagreement) & (disagreement <= cross_check_m)
        confident &= agrees
    return ConeDepth(
        dirs=dirs, rows=rows, cols=cols, depth=depth, points=points,
        confidence=confidence, voters=voters, confident=confident,
    )

"""Multi-view ZENITH (ceiling) fill — the mirror of nadir_fill.

Every sweep is blind in a cone straight up, where the scanner's own mount sat.
On the Grand Hall's coffered ceiling that reads as a grey blob overhead, beside
the chandelier; it is the counterpart of the tripod smear underfoot, and it has
the same cure. The ceiling a sweep cannot see was photographed by its
NEIGHBOURS, so the fill reprojects their pixels through the ceiling plane
rather than inventing anything.

WHY THIS IS NOT nadir_fill WITH A SIGN FLIPPED. Two things genuinely invert:

  1. The ray test. Only UPWARD rays meet the ceiling, and only from beneath it.

  2. The donor rule, which inverts in the direction that surprises people. For
     the floor the best witness is the nearest neighbour. For the ceiling a
     neighbour standing almost underneath the patch is the WORST witness,
     because the patch then falls inside THAT donor's own zenith cone — it is
     blind there too. Feasibility measured this on the real capture before any
     of this was written: the patch above scan_045 renders at texture 3.7 (grey
     mush) in its own sweep and 15.0 / 14.0 from scan_009 / scan_000 at 2.8 m,
     but only 8.2 from scan_008 at 0.9 m. Being OFF TO THE SIDE is the ranking,
     not being close. `zenith_donor_weight` returns exactly 0 inside the cone so
     a near donor can never win on distance alone.

AND WHERE IT REFUSES TO RUN. A dome is not a plane. The Grand Hall's rises
about 7 m above its 7 m ceiling, and pasting reprojected coffers onto that
curve would be a confident lie. `ceiling_is_planar` is the gate; a caller that
cannot show a flat ceiling should skip the node and say so, exactly as the
nadir batch reverted the spiral stair rather than model it as floor.

The shared primitives — equirect mapping, bilinear sampling, the voxel
occluder, gnomonic views, Poisson boundary blending — are imported from
nadir_fill rather than copied. That module is what 149 published sweeps were
filled with; a second copy of its mapping maths is the last thing this needs.

Plan: docs/handoffs/TWIN-STATUS.md (nadir lane, zenith slice).
"""

from __future__ import annotations

import numpy as np

import nadir_fill as nf

__all__ = [
    "ray_ceiling_intersection",
    "rays_ceiling_intersection",
    "zenith_cone_radius_m",
    "donor_in_own_zenith_cone",
    "zenith_donor_weight",
    "ceiling_is_planar",
    "ceiling_planarity_spread",
    "cone_donor_agreement",
    "MIN_SOLVE_AGREEMENT",
    "MIN_CONE_DONOR_AGREEMENT",
    "zenith_cone_mask",
    "local_detail",
    "fill_zenith_hole",
]


# ---------------------------------------------------------------------------
# Ray / plane geometry
# ---------------------------------------------------------------------------

def ray_ceiling_intersection(
    C: np.ndarray, d: np.ndarray, z_ceiling: float
) -> np.ndarray | None:
    """World point where ray (origin C, direction d) meets the plane
    z = z_ceiling, or None when the ray points down, runs parallel, or would
    only meet the plane behind the origin. Only upward rays from BELOW the
    ceiling hit — the mirror of nadir_fill.ray_floor_intersection."""
    C = np.asarray(C, dtype=np.float64)
    d = np.asarray(d, dtype=np.float64)
    dz = d[2]
    if dz <= 0.0:
        return None
    t = (z_ceiling - C[2]) / dz
    if t <= 0.0:
        return None
    return C + t * d


def rays_ceiling_intersection(
    C: np.ndarray, dirs: np.ndarray, z_ceiling: float
) -> tuple[np.ndarray, np.ndarray]:
    """Bulk twin of the above. Returns (points, valid) where points is
    (..., 3) and valid marks the rays that actually met the ceiling ahead of
    the origin."""
    C = np.asarray(C, dtype=np.float64)
    dirs = np.asarray(dirs, dtype=np.float64)
    dz = dirs[..., 2]
    up = dz > 1e-9
    t = np.zeros_like(dz)
    np.divide(z_ceiling - C[2], dz, out=t, where=up)
    valid = up & (t > 0.0)
    pts = C.reshape((1,) * (dirs.ndim - 1) + (3,)) + t[..., None] * dirs
    return pts, valid


# ---------------------------------------------------------------------------
# The mirror rule
# ---------------------------------------------------------------------------

def zenith_cone_radius_m(
    z_ceiling: float, z_eye: float, half_angle_deg: float
) -> float:
    """Radius of the blind disc a scanner's zenith cone projects on the
    ceiling. Grows with the height of the ceiling above the scanner, which is
    why a tall hall is harder than a low room: the same cone angle blanks a
    much wider patch."""
    rise = float(z_ceiling) - float(z_eye)
    if rise <= 0.0:
        return 0.0
    return float(np.tan(np.radians(half_angle_deg)) * rise)


def donor_in_own_zenith_cone(
    P: np.ndarray, C_donor: np.ndarray, cone_radius: float
) -> bool:
    """Does ceiling point P fall inside THIS donor's own blind cone?

    The horizontal offset between the donor and the patch is the whole test —
    the donor's own ceiling point sits directly above it, so a small offset
    means P is in its blind disc and the donor has nothing to contribute.
    """
    return nf.donor_horizontal_offset(P, C_donor) < float(cone_radius)


def zenith_donor_weight(
    P: np.ndarray,
    C_donor: np.ndarray,
    cone_radius: float = 0.0,
    incidence_power: float = 2.0,
    dist_power: float = 2.0,
) -> float:
    """Blend weight for a donor's view of ceiling point P.

    Zero — not merely small — when the donor is inside its own zenith cone, or
    is not below the ceiling at all. Otherwise the ordinary preference returns:
    reward looking steeply UP (least foreshortened, most texels per metre) and
    being near.
    """
    P = np.asarray(P, dtype=np.float64)
    C = np.asarray(C_donor, dtype=np.float64)
    v = P - C
    dist = float(np.linalg.norm(v))
    if dist < 1e-9:
        return 0.0
    if v[2] <= 0.0:
        return 0.0  # the donor is level with or above the ceiling
    if donor_in_own_zenith_cone(P, C, cone_radius):
        return 0.0  # THE MIRROR RULE
    overhead = max(0.0, v[2] / dist)  # 1 = straight up, 0 = horizontal
    return (overhead ** incidence_power) / (dist ** dist_power)


"""Below this donor-agreement the height solve is not worth a verdict.

A planarity spread is only meaningful if the heights it is built from were
solved confidently. On the batch the refused nodes split cleanly: the ones with
a genuine geometric reason (the dome, the staircase soffit) solved at 0.55-0.90,
while scan_089, scan_111, scan_076 and scan_121 solved at 0.145-0.219 — there
the wedge spread is measuring noise, not a ceiling, and calling it "not planar"
dresses an instrument failure up as a fact about the building. Every node that
filled successfully agreed at 0.373 or better.
"""
MIN_SOLVE_AGREEMENT = 0.35


def ceiling_planarity_spread(heights: np.ndarray) -> float:
    """The spread the planarity gate actually judges: 5th-to-95th percentile of
    the sampled ceiling heights, so one wild wedge solve cannot condemn a flat
    ceiling. NaN when there is nothing usable to measure.

    Exported because a caller must be able to REPORT the number the decision was
    made on. Reporting a different statistic (a full peak-to-peak, say) next to
    a percentile-based verdict produces exactly the confusion it did here: two
    nodes both printed "spread 0.25", one filled and one refused.
    """
    h = np.asarray(heights, dtype=np.float64).ravel()
    if h.size == 0 or not np.all(np.isfinite(h)):
        return float("nan")
    return float(np.percentile(h, 95) - np.percentile(h, 5))


def ceiling_is_planar(
    heights: np.ndarray, tolerance_m: float = 0.15
) -> bool:
    """Is this ceiling flat enough to model as one plane?

    `heights` are sampled ceiling heights across the region a fill would cover.
    A flat ceiling scatters by millimetres; a curved or stepped one sweeps
    metres. The gate is deliberately blunt and deliberately conservative:
    refusing a fill costs a grey blob nobody can fix today, while accepting a
    curve pastes flat coffers onto it and calls the result evidence.

    NOTE ON WHAT A FAILURE MEANS. It means "not one plane" and nothing more
    specific. On this capture the refusals include the Grand Hall's dome, but
    also the staircase (a soffit that follows the flight) and rooms with beams.
    Callers must not report a failure as "a dome" — that is a claim about the
    building, and this function only measured a spread.
    """
    spread = ceiling_planarity_spread(heights)
    if not np.isfinite(spread):
        return False
    return spread <= float(tolerance_m)


# ---------------------------------------------------------------------------
# The blind-cone mask
# ---------------------------------------------------------------------------

def zenith_cone_mask(
    h: int, w: int, cone_half_deg: float, feather_deg: float = 0.0
) -> np.ndarray:
    """Boolean equirect mask of the scanner's zenith blind cone: every pixel
    whose elevation is within cone_half_deg of straight up.

    Geometric, not photometric, and that is on purpose. The flat-region
    detector that finds the tripod smear underfoot is UNRELIABLE overhead — on
    a coffered ceiling the largest low-variance component is usually a real
    panel, and a plain plaster ceiling is legitimately textureless. Detection
    mis-ranked the whole zenith investigation until a donor test settled it, so
    the mask here comes from the instrument's known blind angle instead.
    """
    rows = np.arange(h, dtype=np.float64)
    # Row centres map to elevation +90 at the top row, -90 at the bottom.
    elev = 90.0 - (rows + 0.5) * (180.0 / h)
    inside = elev >= (90.0 - cone_half_deg - feather_deg)
    return np.repeat(inside[:, None], w, axis=1)


"""Cross-donor agreement below which the planar model does not describe what is
actually overhead, and the fill must decline.

Measured on the capture, not chosen by taste. Every node the ring-spread gate
had passed, scored by cone_donor_agreement at its own solved height:

    scan_139   0.970   flat plaster            filled well
    scan_126   0.806   moulded panel           filled well
    scan_134   0.799   flat                    filled well
    scan_059   0.646   Saloon coffers          filled well
    scan_058   0.593   Saloon coffers          filled well
    scan_103   0.310   stairwell: stepped soffit, beam, void behind — NOT a plane
    scan_043  -0.123   the Grand Hall DOME — donors actively anti-correlate

0.55 sits in the gap. It keeps every genuine win and refuses both failures,
including the one a ring-spread gate could never see.
"""
MIN_CONE_DONOR_AGREEMENT = 0.55


def cone_donor_agreement(
    shape: tuple[int, int],
    C_target: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    z_ceiling: float,
    cone_half_deg: float = 25.0,
    samples: int = 1500,
) -> float:
    """Do the donors agree with EACH OTHER about the surface inside the cone?

    THE GATE THAT THE RING-SPREAD ONE SHOULD HAVE BEEN. Sampling ceiling heights
    on the ring just outside the blind cone measures the wrong surface: at
    scan_043 that ring lands on the flat coffered ceiling that SURROUNDS the
    Grand Hall dome, so it reported a planar 6.94 m and the fill smeared 663,539
    px of reprojected coffer across the dome's oculus. The region being filled
    must be the region that is judged.

    The target cannot judge it — the target is blind there, which is the whole
    problem. But the donors are not: reproject the same cone rays into each
    donor through the candidate plane and compare donors PAIRWISE. If the
    surface really is a plane at that height, every donor lands on the same
    physical texture and they correlate. On a dome no single height can make
    them agree, because they are each seeing a different part of a curve.

    Returns the mean pairwise correlation, 0 when it cannot be measured.
    """
    h, w = shape
    if len(donors) < 2:
        return 0.0
    cone = zenith_cone_mask(h, w, cone_half_deg)
    rr, cc = np.nonzero(cone)
    if rr.size == 0:
        return 0.0
    stride = max(1, rr.size // samples)
    rr, cc = rr[::stride], cc[::stride]
    dirs = nf.equirect_grid_dirs(w, h, 0, h)[rr, cc]
    P, valid = rays_ceiling_intersection(C_target, dirs, float(z_ceiling))
    if valid.sum() < 64:
        return 0.0
    Pv = P[np.nonzero(valid)[0]]

    series: list[np.ndarray] = []
    for donor_img, C_d in donors:
        C_d = np.asarray(C_d, dtype=np.float64)
        rel = Pv - C_d
        # A donor blind in the same place contributes nothing but its own hole.
        offs = np.hypot(rel[:, 0], rel[:, 1])
        radius = zenith_cone_radius_m(z_ceiling, float(C_d[2]), cone_half_deg)
        keep = (offs >= radius) & (rel[:, 2] > 0.0)
        if keep.sum() < 64:
            continue
        d_rows, d_cols = nf.dirs_to_pixels(rel, w, h)
        vals = nf.sample_equirect(donor_img, d_rows, d_cols).astype(np.float64).mean(axis=1)
        vals = np.where(keep, vals, np.nan)
        series.append(vals)

    scores: list[float] = []
    for i in range(len(series)):
        for j in range(i + 1, len(series)):
            a, b = series[i], series[j]
            both = np.isfinite(a) & np.isfinite(b)
            if both.sum() < 64:
                continue
            av, bv = a[both], b[both]
            if av.std() < 1e-6 or bv.std() < 1e-6:
                continue
            scores.append(float(np.corrcoef(av, bv)[0, 1]))
    return float(np.mean(scores)) if scores else 0.0


# ---------------------------------------------------------------------------
# The evidence gate
# ---------------------------------------------------------------------------

"""How much more the donors must show before their pixels are taken.

Not a tuned constant: the 2026-07-22 feasibility measured a REAL blind cone at
texture 3.7 against donors' 15.0 and 14.0 for the same world patch — about a
fourfold contrast. Three sits just under that and far above the noise, and the
operating window either side is enormous. Swept on the synthetic pair:

    margin   good ceiling wrongly touched   blind cone correctly filled
      1.25                        5.56 %                        96.5 %
      2.0                         2.80 %                        95.2 %
      3.0                         1.65 %                        94.5 %

Raising the bar more than doubles the precision and costs 2 points of recall,
which is the right trade when the failure mode is overwriting a ceiling the
customer can already see.
"""
ZENITH_EVIDENCE_MARGIN = 3.0


def local_detail(gray: np.ndarray, radius: int = 3) -> np.ndarray:
    """Local high-pass energy: mean |pixel - local mean| over a box window.

    A blind cone is smooth because there is nothing there; real ceiling has
    coffers, mouldings and downlights. This is the same quantity the 2026-07-22
    feasibility measured as "texture 3.7 vs 15.0" when it proved the zenith was
    recoverable, computed here per pixel so the gate can work locally.
    """
    g = np.asarray(gray, dtype=np.float64)
    pad = np.pad(g, radius, mode="edge")
    cs = pad.cumsum(0).cumsum(1)
    cs = np.pad(cs, ((1, 0), (1, 0)), mode="constant")
    k = 2 * radius + 1
    h, w = g.shape
    total = cs[k:k + h, k:k + w] - cs[0:h, k:k + w] - cs[k:k + h, 0:w] + cs[0:h, 0:w]
    mean = total / (k * k)
    dev = np.abs(g - mean)
    pad_d = np.pad(dev, radius, mode="edge")
    cd = pad_d.cumsum(0).cumsum(1)
    cd = np.pad(cd, ((1, 0), (1, 0)), mode="constant")
    tot_d = cd[k:k + h, k:k + w] - cd[0:h, k:k + w] - cd[k:k + h, 0:w] + cd[0:h, 0:w]
    return tot_d / (k * k)


# ---------------------------------------------------------------------------
# The fill
# ---------------------------------------------------------------------------

def fill_zenith_hole(
    target_img: np.ndarray,
    C_target: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    z_ceiling: float,
    cone_half_deg: float = 25.0,
    eye_height: float | None = None,
    hole_mask_eq: np.ndarray | None = None,
    ring_deg: float = 6.0,
    occluder: "nf.VoxelOccluder | None" = None,
    evidence_margin: float = ZENITH_EVIDENCE_MARGIN,
    detail_radius: int = 3,
) -> tuple[np.ndarray, dict]:
    """Fill the target sweep's zenith blind cone from neighbouring sweeps.

    Pipeline, working directly in the equirect (the cone is a horizontal band
    at the top of the image, so unlike the nadir there is nothing to gain from
    a gnomonic detour):
      1. mask: caller-supplied, else the instrument's own blind cone;
      2. every masked pixel's ray -> ceiling point P (z = z_ceiling);
      3. each donor: reject P inside the donor's OWN zenith cone (the mirror
         rule), reject donors not below the ceiling, reject mesh-occluded
         sight lines; reproject P and bilinear-sample;
      4. per-donor exposure gain solved on the ring just outside the cone
         (median target/donor ratio per channel — the JPEGs are unharmonized);
      5. weighted blend of the survivors by zenith_donor_weight;
      6. THE EVIDENCE GATE: keep the blend only where the donors actually show
         MORE than the target already does. Not every sweep is blind overhead —
         the Reception Room's own ceiling comes through sharp, mouldings and
         downlights and all — and a fill applied there replaces good pixels
         with reprojected ones, which the pilot caught as a visible pasted disc
         and a flattened downlight. This is the comparison the 2026-07-22
         feasibility used ("texture 3.7 vs 15.0"), per pixel: it is
         self-calibrating, so a legitimately featureless plaster ceiling scores
         equal on both sides and is correctly left alone, where a flat-region
         detector would have called it a hole;
      7. pixels no donor could witness are left AS THEY WERE and counted in
         `donorless_px` — never synthesized. A grey blob honestly reported
         beats invented ceiling.

    Returns (filled_image, report).
    """
    target = np.asarray(target_img, dtype=np.float32)
    h, w = target.shape[:2]
    C_t = np.asarray(C_target, dtype=np.float64)
    eye = float(C_t[2]) if eye_height is None else float(eye_height)

    if hole_mask_eq is None:
        mask = zenith_cone_mask(h, w, cone_half_deg)
    else:
        mask = np.asarray(hole_mask_eq, dtype=bool)
        if mask.shape != (h, w):
            raise ValueError("hole_mask_eq must match the target's equirect shape")

    ring = zenith_cone_mask(h, w, cone_half_deg, feather_deg=ring_deg) & ~mask

    report: dict = {
        "hole_mask_eq": mask,
        "hole_px": int(mask.sum()),
        "filled_px": 0,
        "donorless_px": 0,
        "synth_px": 0,  # always 0: this fill never invents ceiling
        "donors_used": 0,
        "cone_radius_m": zenith_cone_radius_m(z_ceiling, eye, cone_half_deg),
        "z_ceiling": float(z_ceiling),
    }
    if report["hole_px"] == 0 or not donors:
        report["donorless_px"] = report["hole_px"]
        return target.copy(), report

    rows, cols = np.nonzero(mask)
    # equirect_grid_dirs is the vectorized twin of equirect_pixel_to_world_dir
    # (pinned to it by the nadir suite). Building a million directions through
    # the scalar function costs minutes; this costs milliseconds.
    dirs = nf.equirect_grid_dirs(w, h, 0, h)[rows, cols]
    P, valid = rays_ceiling_intersection(C_t, dirs, z_ceiling)

    cone_radius = report["cone_radius_m"]
    acc = np.zeros((rows.size, 3), dtype=np.float64)
    wsum = np.zeros(rows.size, dtype=np.float64)

    for donor_img, C_donor in donors:
        donor_img = np.asarray(donor_img, dtype=np.float32)
        C_d = np.asarray(C_donor, dtype=np.float64)

        # Per-point mirror-rule rejection, vectorized.
        offs = np.hypot(P[:, 0] - C_d[0], P[:, 1] - C_d[1])
        rel = P - C_d
        dist = np.linalg.norm(rel, axis=1)
        usable = valid & (offs >= cone_radius) & (rel[:, 2] > 0.0) & (dist > 1e-9)
        if not usable.any():
            continue

        # Reproject the usable points into this donor's equirect, in bulk.
        # Donor equirects are world-oriented, so the reprojection is a pure
        # translation and dirs_to_pixels is the whole operation.
        d_rows = np.empty(rows.size, dtype=np.float64)
        d_cols = np.empty(rows.size, dtype=np.float64)
        idx = np.nonzero(usable)[0]
        d_rows[idx], d_cols[idx] = nf.dirs_to_pixels(P[idx] - C_d, w, h)

        if occluder is not None:
            seen = np.array(
                [bool(occluder.visible(C_d, P[i])) for i in idx], dtype=bool
            )
            usable[idx[~seen]] = False
            idx = np.nonzero(usable)[0]
            if idx.size == 0:
                continue

        samples = nf.sample_equirect(donor_img, d_rows[idx], d_cols[idx])

        # Exposure harmonisation on the ring just outside the cone: the sweeps
        # are unharmonized JPEGs, so a donor's ceiling can be a different
        # brightness from the target's own ring around the same cone.
        gain = _ring_gain(target, donor_img, ring, C_t, C_d, z_ceiling, w, h)
        samples = samples * gain

        overhead = rel[idx, 2] / dist[idx]
        weights = (np.clip(overhead, 0.0, 1.0) ** 2) / (dist[idx] ** 2)
        acc[idx] += samples.astype(np.float64) * weights[:, None]
        wsum[idx] += weights
        report["donors_used"] += 1

    got = wsum > 0
    report["donorless_px"] = int((~got).sum())
    if not got.any():
        report["kept_target_px"] = 0
        return target.copy(), report

    candidate = target.copy()
    blended = (acc[got] / wsum[got][:, None]).astype(np.float32)
    candidate[rows[got], cols[got]] = np.clip(blended, 0.0, 255.0)

    # The evidence gate, measured on the cone band only (the rest is identical
    # by construction, so there is nothing to compare there).
    band = int(np.max(rows)) + 1 + detail_radius
    band = min(band, h)
    t_detail = local_detail(target[:band].mean(axis=2), detail_radius)
    c_detail = local_detail(candidate[:band].mean(axis=2), detail_radius)
    in_band = rows < band
    better = np.zeros(rows.size, dtype=bool)
    better[in_band] = (
        c_detail[rows[in_band], cols[in_band]]
        > t_detail[rows[in_band], cols[in_band]] * float(evidence_margin)
    )

    take = got & better
    filled = target.copy()
    if take.any():
        idx = np.nonzero(take)[0]
        filled[rows[idx], cols[idx]] = candidate[rows[idx], cols[idx]]
    report["filled_px"] = int(take.sum())
    report["kept_target_px"] = int((got & ~better).sum())
    return filled, report


def _ring_gain(
    target: np.ndarray,
    donor: np.ndarray,
    ring: np.ndarray,
    C_t: np.ndarray,
    C_d: np.ndarray,
    z_ceiling: float,
    w: int,
    h: int,
    max_samples: int = 4000,
) -> np.ndarray:
    """Per-channel exposure ratio between the target and one donor, measured on
    the ring of ceiling just OUTSIDE the blind cone — the one place both sweeps
    certainly see the same surface. Median, so a chandelier in the ring cannot
    drag the gain. Identity when the ring yields nothing trustworthy."""
    rr, cc = np.nonzero(ring)
    if rr.size == 0:
        return np.ones(3, dtype=np.float64)
    if rr.size > max_samples:
        step = rr.size // max_samples
        rr = rr[::step]
        cc = cc[::step]
    dirs = nf.equirect_grid_dirs(w, h, 0, h)[rr, cc]
    P, valid = rays_ceiling_intersection(C_t, dirs, z_ceiling)
    if not valid.any():
        return np.ones(3, dtype=np.float64)
    idx = np.nonzero(valid)[0]
    d_rows, d_cols = nf.dirs_to_pixels(P[idx] - np.asarray(C_d, dtype=np.float64), w, h)
    donor_vals = nf.sample_equirect(donor, d_rows, d_cols).astype(np.float64)
    target_vals = target[rr[idx], cc[idx]].astype(np.float64)
    ok = (donor_vals > 4.0).all(axis=1) & (target_vals > 4.0).all(axis=1)
    if ok.sum() < 16:
        return np.ones(3, dtype=np.float64)
    ratio = np.median(target_vals[ok] / donor_vals[ok], axis=0)
    return np.clip(ratio, 0.5, 2.0)

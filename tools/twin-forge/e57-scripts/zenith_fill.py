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
    "zenith_cone_mask",
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


def ceiling_is_planar(
    heights: np.ndarray, tolerance_m: float = 0.15
) -> bool:
    """Is this ceiling flat enough to model as one plane?

    `heights` are sampled ceiling heights across the region a fill would cover.
    A flat ceiling scatters by millimetres; a dome sweeps metres. The gate is
    deliberately blunt and deliberately conservative: refusing a fill costs a
    grey blob nobody can fix today, while accepting a dome pastes flat coffers
    onto a curve and calls it evidence.
    """
    h = np.asarray(heights, dtype=np.float64).ravel()
    if h.size == 0:
        return False
    if not np.all(np.isfinite(h)):
        return False
    spread = float(np.percentile(h, 95) - np.percentile(h, 5))
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
      6. pixels no donor could witness are left AS THEY WERE and counted in
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
    dirs = np.stack(
        [
            nf.equirect_pixel_to_world_dir(float(r), float(c), w, h)
            for r, c in zip(rows, cols)
        ]
    )
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

        # Reproject the usable points into this donor's equirect.
        d_rows = np.empty(rows.size, dtype=np.float64)
        d_cols = np.empty(rows.size, dtype=np.float64)
        idx = np.nonzero(usable)[0]
        for i in idx:
            r, c = nf.reproject_point_to_pixel(P[i], C_d, w, h)
            d_rows[i] = r
            d_cols[i] = c

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

    filled = target.copy()
    got = wsum > 0
    if got.any():
        blended = (acc[got] / wsum[got][:, None]).astype(np.float32)
        filled[rows[got], cols[got]] = np.clip(blended, 0.0, 255.0)
    report["filled_px"] = int(got.sum())
    report["donorless_px"] = int((~got).sum())
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
    dirs = np.stack(
        [nf.equirect_pixel_to_world_dir(float(r), float(c), w, h) for r, c in zip(rr, cc)]
    )
    P, valid = rays_ceiling_intersection(C_t, dirs, z_ceiling)
    if not valid.any():
        return np.ones(3, dtype=np.float64)
    idx = np.nonzero(valid)[0]
    d_rows = np.empty(idx.size, dtype=np.float64)
    d_cols = np.empty(idx.size, dtype=np.float64)
    for k, i in enumerate(idx):
        r, c = nf.reproject_point_to_pixel(P[i], C_d, w, h)
        d_rows[k] = r
        d_cols[k] = c
    donor_vals = nf.sample_equirect(donor, d_rows, d_cols).astype(np.float64)
    target_vals = target[rr[idx], cc[idx]].astype(np.float64)
    ok = (donor_vals > 4.0).all(axis=1) & (target_vals > 4.0).all(axis=1)
    if ok.sum() < 16:
        return np.ones(3, dtype=np.float64)
    ratio = np.median(target_vals[ok] / donor_vals[ok], axis=0)
    return np.clip(ratio, 0.5, 2.0)

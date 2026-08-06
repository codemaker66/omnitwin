"""The Floor Atlas — one metrically-true orthophoto of a building's floor,
super-resolved by fusing every scan that ever saw it.

WHY THIS EXISTS (the reframe that ends the patching):
Filling a tripod hole as image repair is capped by the resolution of the
single photograph being repaired — which is exactly why masking fixes,
hysteresis and quilting each plateaued, and it is the same ceiling the
incumbents sit under (their pixels are chained to where the tripod stood;
the hole gets a logo). But the floor under any tripod WAS photographed: by
a dozen neighbours, each grazing it from a different angle, each landing
samples at different sub-pixel phases on the same planks. On a PLANAR
surface that is textbook multi-view super-resolution — pure homography, no
depth ambiguity — so many poor looks fuse into one better than all of them.

The fusion target is therefore not another panorama. It is a single shared
surface in WORLD METRES that every viewpoint can sample:
  * every node's nadir fills from the same atlas — no per-node donor
    lottery, no dead centres, no seams between viewpoints;
  * the atlas is itself a product: a photographic, to-scale floor plan
    (the incumbents ship schematic line drawings);
  * it is the substrate a venue planner actually wants — real layouts on
    real measured floor.

TRUTH DISCIPLINE (Foundry rule: never turn missing observations into
captured fact). Coverage and per-pixel observation counts are returned
alongside the pixels. Unobserved floor comes back FLAGGED, never guessed.
Nothing here is survey truth: it is planning-grade, like the rest of the
twin's disclosure.

Geometry conventions are inherited, not re-derived: rays/pixels follow
nadir_fill (pinned to extract_equirect_v2 by tests/test_nadir_vs_extractor).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import nadir_fill as nf

LUM_W = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


@dataclass(frozen=True)
class AtlasGrid:
    """A metric raster over the floor plane. This is a measuring surface
    before it is a picture: pixel centres are exact world coordinates and
    the mapping is invertible to floating-point precision.

    origin_xy is the world (x, y) of the grid's top-left CORNER; pixel
    (0, 0)'s centre sits half a pixel inside it. Rows advance +y, columns
    advance +x, so the raster is a plan view in the E57 world frame.
    """

    origin_xy: tuple[float, float]
    mm_per_px: float
    width: int
    height: int

    @property
    def metres_per_px(self) -> float:
        return self.mm_per_px / 1000.0

    @property
    def width_m(self) -> float:
        return self.width * self.metres_per_px

    @property
    def height_m(self) -> float:
        return self.height * self.metres_per_px

    def world_to_atlas(self, wx: float, wy: float) -> tuple[float, float]:
        """World metres -> continuous (col, row). Inverse of atlas_to_world."""
        s = self.metres_per_px
        return ((wx - self.origin_xy[0]) / s - 0.5,
                (wy - self.origin_xy[1]) / s - 0.5)

    def atlas_to_world(self, col: float, row: float) -> tuple[float, float]:
        s = self.metres_per_px
        return (self.origin_xy[0] + (col + 0.5) * s,
                self.origin_xy[1] + (row + 0.5) * s)

    def pixel_centres_world(self) -> tuple[np.ndarray, np.ndarray]:
        """(height, width) arrays of the world x and y at every pixel centre."""
        s = self.metres_per_px
        xs = self.origin_xy[0] + (np.arange(self.width) + 0.5) * s
        ys = self.origin_xy[1] + (np.arange(self.height) + 0.5) * s
        return (np.broadcast_to(xs[None, :], (self.height, self.width)).copy(),
                np.broadcast_to(ys[:, None], (self.height, self.width)).copy())


def _sample_source(
    img: np.ndarray,
    C: np.ndarray,
    grid: AtlasGrid,
    z_floor: float,
    self_blind_m: float,
    max_incidence_deg: float,
    occluder=None,
    z_exempt_m: float = 0.30,
) -> tuple[np.ndarray, np.ndarray]:
    """Backward-map one panorama onto the grid.

    Atlas-driven (every atlas pixel asks "who saw me?") rather than
    forward-splatting, so the result has no scatter holes. Returns
    (rgb float32 HxWx3, weight float32 HxW); weight 0 means this source
    contributes nothing there.
    """
    # A source may be a raster OR a zero-arg loader. Lazy loading is what
    # makes the 8192 tier usable: 40 sweeps x ~100 MB cannot all be resident,
    # and the two-pass design would otherwise need them twice over.
    img = np.asarray(img() if callable(img) else img)
    eq_h, eq_w = img.shape[:2]
    C = np.asarray(C, dtype=np.float64)

    xs, ys = grid.pixel_centres_world()
    dx = xs - C[0]
    dy = ys - C[1]
    dz = float(z_floor - C[2])                       # negative: floor is below
    off = np.hypot(dx, dy)                           # horizontal distance
    dist = np.sqrt(off * off + dz * dz)

    # incidence: 1 = straight down (best sampling), 0 = grazing/horizon
    overhead = np.abs(dz) / np.maximum(dist, 1e-9)
    cos_max = np.cos(np.radians(max_incidence_deg))

    # self_blind_m excludes each source's OWN blind disc. It is the
    # measured SMEAR extent (~24-25 deg => ~0.7 m at tripod height), NOT
    # the tripod's physical footprint: at 0.45 m every scan donated its
    # own smear ring to the shared surface, which showed up as a soft
    # disc at every scanner position in the first Grand Hall atlas.
    ok = (dz < -1e-6) & (off > self_blind_m) & (overhead > cos_max)
    if occluder is not None and np.any(ok):
        P = np.stack([xs[ok], ys[ok], np.full(int(ok.sum()), float(z_floor))], axis=1)
        blocked = occluder.blocked(C, P, z_exempt_below=z_floor + z_exempt_m)
        keep = np.zeros_like(ok)
        keep[ok] = ~blocked
        ok = keep

    rgb = np.zeros((grid.height, grid.width, 3), dtype=np.float32)
    wgt = np.zeros((grid.height, grid.width), dtype=np.float32)
    if not np.any(ok):
        return rgb, wgt

    dirs = np.stack([dx[ok], dy[ok], np.full(int(ok.sum()), dz)], axis=1)
    rows, cols = nf.dirs_to_pixels(dirs, eq_w, eq_h)
    rgb[ok] = nf.sample_equirect(img, rows, cols)

    # Weight = sampling quality: head-on beats grazing (cos^2), near beats far
    # (1/d^2). Same currency nadir_fill uses to pick donors, so the atlas and
    # the per-node fill agree about what "a good look" means.
    wgt[ok] = (overhead[ok] ** 2 / np.maximum(dist[ok] ** 2, 1e-6)).astype(np.float32)
    return rgb, wgt


def project_source_to_atlas(
    img: np.ndarray,
    C: np.ndarray,
    grid: AtlasGrid,
    z_floor: float,
    self_blind_m: float = 0.80,
    max_incidence_deg: float = 80.0,
    occluder=None,
) -> tuple[np.ndarray, np.ndarray]:
    """A single photograph, orthorectified onto the grid. This is the
    BASELINE the fused atlas must beat."""
    return _sample_source(
        img, C, grid, z_floor, self_blind_m, max_incidence_deg, occluder
    )


ALIGN_COARSE_MM = 20.0
ALIGN_HP_PX = 9
ALIGN_MIN_OVERLAP_PX = 200


def _coarse_for_alignment(grid: AtlasGrid) -> tuple[int, AtlasGrid]:
    """A decimated copy of the grid to fit δ on.

    δ is ONE number for a whole sweep, so it does not need the atlas's own
    resolution — it needs whatever raster still carries the floor structure the
    sweeps must be made to agree about. Plank seams sit ~80 mm apart, so ~20 mm
    cells keep four samples across a plank while costing 1/16th of the fine
    grid. Going finer is not merely wasteful, it is worse: below a single
    view's ground sampling (9-20 mm on this scene) the high-pass is dominated
    by each view's own resampling ripple, which does not move with δ and so
    flattens the peak — measured, 5 mm cells drove every estimate toward zero.
    """
    f = max(1, int(round(ALIGN_COARSE_MM / grid.mm_per_px))) if grid.mm_per_px else 1
    return f, AtlasGrid(
        origin_xy=grid.origin_xy,
        mm_per_px=grid.mm_per_px * f,
        width=max(grid.width // f, 8),
        height=max(grid.height // f, 8),
    )


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    den = float(np.sqrt(float((a * a).sum()) * float((b * b).sum())))
    return float((a * b).sum() / den) if den > 1e-9 else -2.0


def _estimate_alignment(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    consensus: np.ndarray,
    seen_any: np.ndarray,
    self_blind_m: float,
    max_incidence_deg: float,
    span_m: float = 0.030,
    step_m: float = 0.003,
    refine_span_m: float = 0.008,
    refine_step_m: float = 0.002,
    max_rounds: int = 3,
) -> list[float]:
    """Recover every sweep's floor-height error by making the sweeps agree.

    Why ONE parameter per sweep is the right model: if a sweep's floor sits δ
    off where we assumed, every ray it casts lands short by δ·tan(incidence),
    radially away from that scanner. Overhead views barely move; grazing views
    slip centimetres. That single number therefore explains the whole
    displacement field — measured on the Grand Hall, offsets at a disc divided
    by tan(incidence) collapsed to a common ~13-15 mm.

    SIGN CONVENTION is metrological — error = assumed minus actual. A sweep
    whose floor really lies 11 mm ABOVE the atlas plane reports -0.011, and
    sampling corrects with `z_floor - dz`. Storing the correction under a name
    that says "error" is how the two got confused before.

    Two things make this land, and neither of them is the search itself:

    (1) LEAVE-ONE-OUT. A sweep must not be matched against a consensus it is
        itself part of. With a handful of looks a source carries a large share
        of the mean, so its own contribution plants a spurious peak at δ=0 and
        drags every estimate toward zero; the shrinkage is proportional to that
        share, which is why no amount of iterating removes it. Subtracting the
        source's own weighted contribution costs one array operation and kills
        the bias outright (measured on the five-scanner scene: 5.4 mm mean
        residual with the bias present, 2.5 mm without, before any iteration).

    (2) ITERATION. The pass-1 consensus is blurred by the very misregistration
        being measured, so a single pass against it can only recover part of δ.
        Each round sharpens the reference, which sharpens the next round's
        estimates. It contracts rather than wanders, so we stop as soon as the
        estimates move less than the search step — further rounds only
        re-quantise the same answer.

    Cost is bounded deliberately: one raster load per source per round, on a
    grid 1/16th the atlas's area, with a narrow window after the first round
    and an early exit. Only each source's chosen coarse slice is carried
    between rounds (luminance and weight at 1/16th resolution), so the memory
    bound that lets this scale to a whole building is not given up.

    NO RE-CENTRING, and this was measured rather than assumed. A δ shared by
    every sweep is weakly observable rather than unobservable — each source's
    displacement field is radial about ITS OWN centre, so a common shift does
    not cancel — and a whole capture session really can sit on one mis-levelled
    floor height. Over twelve randomised planted-error draws the mean absolute
    residual is 2.9 mm as written and 4.1 mm if the estimates are forced to zero
    mean, because with a handful of sweeps the true mean error is itself several
    millimetres and re-centring throws that away. The atlas plane is also what
    every node's nadir fill reads back, so the absolute height has to stay
    honest. A caller who knows its nominal plane is trustworthy can subtract the
    mean itself.

    KNOWN RESIDUAL BIAS, disclosed rather than tuned out: on the same draws the
    estimates carry a systematic +2.5 mm common-mode offset (a level scene with
    no planted error at all returns up to +4.3 mm), while the sweep-to-sweep
    part is good to 1.6 mm mean / 3.1 mm worst. Views band-limited at different
    ground sampling do not correlate symmetrically about the true peak, and that
    asymmetry has not been modelled. Subtracting the number would be fitting a
    constant to one scene, so it stands — treat the common mode of `align_dz` as
    accurate to a few millimetres and the SPREAD as the trustworthy part.
    """
    from scipy import ndimage

    f, cg = _coarse_for_alignment(grid)
    shape = (cg.height, cg.width)
    n_src = len(sources)

    def _hp(a: np.ndarray) -> np.ndarray:
        return a - ndimage.uniform_filter(a, ALIGN_HP_PX)

    # Round 0's reference is the fine pass-1 consensus, box-filtered BEFORE it
    # is decimated. The filter is not cosmetic: plain decimation of a 5 mm
    # raster to 20 mm folds the 12 mm grain into a pattern unrelated to the one
    # the coarse-sampled source folds it into, and correlating two differently
    # aliased signals measures nothing but the aliasing.
    lo = ndimage.uniform_filter(consensus.mean(axis=2).astype(np.float64), f)
    ref_hp = _hp(lo[: cg.height * f : f, : cg.width * f : f])
    ref_ok = seen_any[: cg.height * f : f, : cg.width * f : f]

    # Each source's own coarse contribution at its current estimate, kept so
    # the next round can both rebuild the consensus and leave that source out
    # of it. None until round 0 has run — which is what makes round 0 the
    # bootstrap, and the only round without leave-one-out.
    parts: list[tuple[np.ndarray, np.ndarray] | None] = [None] * n_src

    dzs = [0.0] * n_src
    for rnd in range(max_rounds):
        wide = rnd == 0
        span = span_m if wide else refine_span_m
        step = step_m if wide else refine_step_m
        half = int(round(span / step))
        offsets = np.arange(-half, half + 1) * step

        acc = np.zeros(shape, dtype=np.float64)
        wsum = np.zeros(shape, dtype=np.float64)
        if not wide:
            for part in parts:
                if part is None:
                    continue
                lum_c, w_c = part
                acc += lum_c * w_c
                wsum += w_c

        new_dzs = [0.0] * n_src
        for i, (img, C) in enumerate(sources):
            if wide:
                r_hp, r_ok = ref_hp, ref_ok
            else:
                a, ws = acc, wsum
                part = parts[i]
                if part is not None:                       # leave-one-out
                    lum_c, w_c = part
                    a = acc - lum_c * w_c
                    ws = wsum - w_c
                r_ok = ws > 1e-9
                r_hp = _hp(np.where(r_ok, a / np.where(r_ok, ws, 1.0), 0.0))

            raster = img() if callable(img) else img     # load once per round
            centre = dzs[i]
            best_k, best_score = half, -2.0
            best_slice: tuple[np.ndarray, np.ndarray] | None = None
            scores = np.full(offsets.shape, -2.0)
            for k, off in enumerate(offsets):
                rgb, w = _sample_source(
                    raster, C, cg, z_floor - (centre + off),
                    self_blind_m, max_incidence_deg, None,
                )
                lum_c = rgb.mean(axis=2).astype(np.float64)
                m = (w > 0) & r_ok
                if int(m.sum()) < ALIGN_MIN_OVERLAP_PX:
                    continue
                scores[k] = _ncc(_hp(lum_c)[m], r_hp[m])
                # only the running best is retained: keeping the whole δ stack
                # would put |offsets| coarse rasters in flight per source, which
                # is the memory bound this design exists to respect
                if scores[k] > best_score:
                    best_score, best_k = scores[k], k
                    best_slice = (lum_c, w.astype(np.float64))
            del raster

            # Sub-step peak from a parabola through the three samples around
            # the best: agreement varies smoothly with a sub-cell shift, so the
            # search step caps precision only if we decline to interpolate.
            pick = float(offsets[best_k])
            if 0 < best_k < len(offsets) - 1 and best_score > -2.0:
                y0, y1, y2 = scores[best_k - 1], scores[best_k], scores[best_k + 1]
                den = y0 - 2.0 * y1 + y2
                if den < -1e-12:
                    pick += float(np.clip(0.5 * (y0 - y2) / den, -1.0, 1.0)) * step
            new_dzs[i] = centre + pick
            if best_slice is not None:
                parts[i] = best_slice

        moved = max((abs(new_dzs[i] - dzs[i]) for i in range(n_src)), default=0.0)
        dzs = new_dzs
        if moved < step:
            break

    # `offsets` were searched in the same sense they are applied (z_floor - δ),
    # so what comes out is already the error, not the correction
    return dzs


N_BINS = 24


def _harmonise_to_consensus(
    rgb: np.ndarray,
    seen: np.ndarray,
    consensus: np.ndarray,
    grid,
    C: np.ndarray,
    z_floor: float,
) -> np.ndarray:
    """Remove ONE view's own lighting signature before it is fused.

    Every view of a polished floor carries its own sheen: a smooth, spatially
    varying brightening that depends on where that camera stood, strongest
    where the view grazes. It is not texture and it must not be averaged into
    a shared surface — inside a tripod's blind circle EVERY contributor is
    grazing, so the sheen has no minority to be rejected as, and it survives
    as a bright disc (exactly what the first Grand Hall atlas showed).

    The correction is fitted against INCIDENCE ANGLE rather than as a free
    2-D field, because that is what the physics actually depends on: Fresnel
    reflectance climbs as a view grazes. One gain curve per source per channel,
    pooled over the whole floor, is therefore well-estimated from thousands of
    samples and — crucially — CANNOT absorb real texture, since texture is not
    a function of incidence. Clamped, so a genuinely dark floor can never be
    scrubbed into agreement: this equalises illumination, it does not
    manufacture it.
    """
    xs, ys = grid.pixel_centres_world()
    dz = float(z_floor - C[2])
    dist = np.sqrt((xs - C[0]) ** 2 + (ys - C[1]) ** 2 + dz * dz)
    overhead = np.abs(dz) / np.maximum(dist, 1e-9)      # 1 = straight down

    out = rgb.copy()
    idx = np.clip((overhead * N_BINS).astype(np.int32), 0, N_BINS - 1)
    valid = seen & (consensus.sum(axis=2) > 1e-3) & (rgb.sum(axis=2) > 1e-3)
    if not np.any(valid):
        return out

    vi = idx[valid]
    for ch in range(3):
        s = rgb[..., ch][valid]
        r = consensus[..., ch][valid]
        num = np.bincount(vi, weights=r, minlength=N_BINS)
        den = np.bincount(vi, weights=s, minlength=N_BINS)
        n = np.bincount(vi, minlength=N_BINS)
        with np.errstate(divide="ignore", invalid="ignore"):
            curve = np.where(n >= 40, num / np.maximum(den, 1e-6), 1.0)
        curve = np.clip(np.nan_to_num(curve, nan=1.0), 0.65, 1.55)
        # smooth across neighbouring angles: illumination varies gently with
        # incidence, so a jagged curve would be noise, not physics
        k = np.array([0.15, 0.7, 0.15])
        curve = np.convolve(np.pad(curve, 1, mode="edge"), k, mode="valid")
        out[..., ch] = rgb[..., ch] * curve[idx].astype(np.float32)
    out[~seen] = 0.0
    return out


def accumulate_floor_atlas(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    self_blind_m: float = 0.80,
    max_incidence_deg: float = 80.0,
    occluder=None,
    robust_sigma: float = 2.0,
    specular_sigma: float = 0.5,
    min_robust_sources: int = 3,
    harmonise: bool = True,
    align: bool = True,
) -> tuple[np.ndarray, dict]:
    """Fuse many panoramas into one super-resolved orthophoto.

    Memory-bounded throughout (no per-pixel sample stacks — a building-scale
    atlas cannot hold N samples per pixel):
      pass 1     weighted mean colour, and mean and variance of luminance;
      alignment  recover each sweep's floor-height error against that
                 consensus, then re-measure the consensus on the registered
                 geometry (see _estimate_alignment). Skipped entirely when
                 align=False or when no sweep moved;
      pass 2     re-accumulate at the corrected heights, rejecting samples
                 beyond robust_sigma of the mean — a chair, a person or a
                 specular flare in ONE capture cannot smear a surface that
                 many captures agree on.
    Robust rejection only engages where at least min_robust_sources saw the
    pixel; with fewer looks there is no majority to appeal to, so everything
    observed is kept (and the count is reported).

    Super-resolution falls out of the geometry: the grid is finer than any
    single view's ground sampling, and each source lands on it at a different
    sub-pixel phase, so their weighted sum reconstructs detail no single
    source carries. That is also why alignment matters so much more here than
    it would for a coarse mosaic — sub-pixel phase diversity is the whole
    mechanism, and a 15 mm height error turns it into sub-pixel NOISE, which
    averages the texture away instead of resolving it.

    Returns (atlas float32 HxWx3, report). The report carries `observed`
    (bool), `counts` (int per pixel), `covered_frac` and `rejected_frac` —
    unobserved floor is FLAGGED, never invented — plus `align_dz`, one
    floor-height ERROR in metres per source (assumed minus actual; all zeros
    when align=False).
    """
    if not sources:
        raise ValueError("no sources")

    shape = (grid.height, grid.width)

    def consensus_pass(dzs: list[float]):
        """Weighted mean colour, mean/variance of luminance, and look counts.

        Deliberately NOT caching the per-source rasters: at Grand Hall scale
        (2600x1250 px, ~50 sources) that stack is ~2.5 GB. Re-sampling trades
        compute for a hard memory bound, which is what lets this scale to a
        whole building.
        """
        acc = np.zeros(shape + (3,), dtype=np.float64)
        wsum = np.zeros(shape, dtype=np.float64)
        lum_acc = np.zeros(shape, dtype=np.float64)
        lum_sq = np.zeros(shape, dtype=np.float64)
        counts = np.zeros(shape, dtype=np.int32)
        for (img, C), dz in zip(sources, dzs):
            rgb, w = _sample_source(
                img, C, grid, z_floor - dz, self_blind_m, max_incidence_deg,
                occluder,
            )
            counts += w > 0
            acc += rgb * w[..., None]
            wsum += w
            lum = rgb @ LUM_W
            lum_acc += lum * w
            lum_sq += (lum * lum) * w
        safe_w = np.where(wsum > 0, wsum, 1.0)
        mean_lum = lum_acc / safe_w
        var_lum = np.maximum(lum_sq / safe_w - mean_lum * mean_lum, 0.0)
        return (acc, safe_w, counts, mean_lum, np.sqrt(var_lum),
                (acc / safe_w[..., None]).astype(np.float32))

    zeros = [0.0] * len(sources)
    acc, safe_w, counts, mean_lum, sigma, mean_rgb = consensus_pass(zeros)

    # --- alignment pass: recover each sweep's floor-height error ---------
    dzs = zeros
    if align:
        dzs = _estimate_alignment(
            sources, grid, z_floor, mean_rgb, counts > 0,
            self_blind_m, max_incidence_deg,
        )
        if any(dz != 0.0 for dz in dzs):
            # Everything pass 2 leans on — the levelling reference, the outlier
            # gate's mean and its sigma — was measured across MISREGISTERED
            # observations, so it is smeared by exactly the error we just
            # removed. An inflated sigma makes the gate blind and a blurred
            # mean_rgb drags the harmonised colours back toward the smear, so
            # the reference is re-measured on the registered geometry before it
            # is used. Skipped when nothing moved, which keeps `align=False`
            # (and an already-level capture) at its original cost.
            acc, safe_w, counts, mean_lum, sigma, mean_rgb = consensus_pass(dzs)

    observed = counts > 0

    # --- pass 2: robust re-accumulation -----------------------------------
    acc2 = np.zeros(shape + (3,), dtype=np.float64)
    wsum2 = np.zeros(shape, dtype=np.float64)
    # ASYMMETRIC by physics. A specular reflection only ever ADDS light, and
    # it MOVES with the viewpoint — so on a polished floor the bright tail is
    # the chandelier, and the darker observations carry the diffuse truth.
    # (The first real Grand Hall atlas showed a regular grid of bright discs:
    # the hall's chandeliers, smeared by averaging ~20 viewpoints. A symmetric
    # gate cannot remove them; this can.) Dark outliers keep the looser gate —
    # a shadow or an occluder is rarer and less damaging than a blown highlight.
    dark_gate = np.maximum(robust_sigma * sigma, 6.0)
    bright_gate = np.maximum(specular_sigma * sigma, 4.0)
    can_gate = counts >= min_robust_sources
    rejected = 0
    total = 0
    for si, (img, C) in enumerate(sources):
        # dzs[si] is the ERROR in the assumed height, so it is SUBTRACTED to
        # put this sweep's floor where the sweep actually saw it
        rgb, w = _sample_source(
            img, C, grid, z_floor - dzs[si], self_blind_m, max_incidence_deg,
            occluder,
        )
        seen = w > 0
        total += int(seen.sum())
        if harmonise:
            rgb = _harmonise_to_consensus(
                rgb, seen, mean_rgb, grid, C, z_floor
            )
        signed = (rgb @ LUM_W) - mean_lum
        drop = seen & can_gate & (
            (signed > bright_gate) | (-signed > dark_gate)
        )
        rejected += int(drop.sum())
        keep_w = np.where(drop, 0.0, w)
        acc2 += rgb * keep_w[..., None]
        wsum2 += keep_w

    # a pixel whose every sample was rejected falls back to the plain mean:
    # better an averaged observation than a hole we would have to invent
    fallback = observed & (wsum2 <= 0)
    atlas = np.zeros(shape + (3,), dtype=np.float32)
    good = wsum2 > 0
    atlas[good] = (acc2[good] / wsum2[good][..., None]).astype(np.float32)
    if np.any(fallback):
        atlas[fallback] = (
            acc[fallback] / safe_w[fallback][..., None]
        ).astype(np.float32)

    report = {
        "observed": observed,
        "counts": counts,
        # 0.01 mm: the sub-step fit resolves better than the old 0.1 mm
        # rounding, and reporting a measurement coarser than it was made
        # invents a precision floor that is not really there
        "align_dz": [round(float(d), 5) for d in dzs],
        "covered_frac": float(observed.mean()),
        "rejected_frac": (rejected / total) if total else 0.0,
        "mean_looks": float(counts[observed].mean()) if observed.any() else 0.0,
        "max_looks": int(counts.max()),
        "fallback_px": int(fallback.sum()),
        "mm_per_px": grid.mm_per_px,
    }
    return atlas, report

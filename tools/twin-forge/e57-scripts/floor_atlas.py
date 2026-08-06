"""The Floor Atlas — one nominal metric-grid orthophoto of a floor plane,
fused from the supplied world-oriented source images.

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
  * every node's nadir can read from the same atlas rather than selecting a
    different donor image independently;
  * the atlas is itself a product: a photographic, to-scale floor plan
    (the incumbents ship schematic line drawings);
  * it can become a useful planning substrate after its source poses, plane,
    output, and intended use have been reviewed.

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


def _coarse_alignment_reference(
    consensus: np.ndarray,
    seen_any: np.ndarray,
    grid: AtlasGrid,
) -> tuple[AtlasGrid, np.ndarray, np.ndarray]:
    """Sample a fine reference exactly at a coarser grid's pixel centres."""
    from scipy import ndimage

    target_factor = max(1, int(round(24.0 / grid.mm_per_px)))
    largest_factor = max(1, min(grid.width // 8, grid.height // 8))
    factor = min(target_factor, largest_factor)
    coarse = AtlasGrid(
        origin_xy=grid.origin_xy,
        mm_per_px=grid.mm_per_px * factor,
        width=max(1, grid.width // factor),
        height=max(1, grid.height // factor),
    )

    # Coarse pixel (r, c) is centred at fine coordinate
    # ((r + 0.5) * factor - 0.5, (c + 0.5) * factor - 0.5).
    # Sampling from index zero shifts an odd-factor grid by (factor-1)/2
    # fine pixels and produces a false z correction.
    rows = (np.arange(coarse.height, dtype=np.float64) + 0.5) * factor - 0.5
    cols = (np.arange(coarse.width, dtype=np.float64) + 0.5) * factor - 0.5
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    coordinates = np.stack([rr, cc])
    reference = np.stack(
        [
            ndimage.map_coordinates(
                consensus[..., channel], coordinates, order=1, mode="nearest"
            )
            for channel in range(3)
        ],
        axis=2,
    ).astype(np.float32)
    reference_seen = ndimage.map_coordinates(
        seen_any.astype(np.float32), coordinates, order=0, mode="nearest"
    ) > 0.5
    return coarse, reference, reference_seen


def _high_pass_correlation(
    sample: np.ndarray,
    reference: np.ndarray,
    mask: np.ndarray,
) -> float | None:
    from scipy import ndimage

    if int(mask.sum()) < 200:
        return None
    sample_lum = sample.mean(axis=2)
    reference_lum = reference.mean(axis=2)
    mask_float = mask.astype(np.float32)
    local_support = ndimage.uniform_filter(mask_float, 9)
    denominator = np.maximum(local_support, 1e-6)
    sample_smooth = ndimage.uniform_filter(sample_lum * mask_float, 9) / denominator
    reference_smooth = (
        ndimage.uniform_filter(reference_lum * mask_float, 9) / denominator
    )
    sample_hp = sample_lum - sample_smooth
    reference_hp = reference_lum - reference_smooth
    left = sample_hp[mask]
    right = reference_hp[mask]
    left = left - left.mean()
    right = right - right.mean()
    denominator = float(
        np.sqrt((left * left).sum() * (right * right).sum())
    )
    if denominator <= 1e-9:
        return None
    return float((left * right).sum() / denominator)


def _camera_with_z_correction(C: np.ndarray, dz: float) -> np.ndarray:
    """Apply dz to camera height while leaving the physical floor fixed."""
    corrected = np.asarray(C, dtype=np.float64).copy()
    corrected[2] -= dz
    return corrected


def _estimate_dz(
    img,
    C: np.ndarray,
    grid: AtlasGrid,
    z_floor: float,
    consensus: np.ndarray,
    seen_any: np.ndarray,
    self_blind_m: float,
    max_incidence_deg: float,
    occluder=None,
    z_exempt_m: float = 0.30,
    span_m: float = 0.030,
    step_m: float = 0.003,
    min_score_gain: float = 0.002,
    min_peak_margin: float = 0.0005,
) -> dict:
    """Estimate one source's floor-plane z correction from texture agreement."""
    from scipy import ndimage

    coarse, reference, reference_seen = _coarse_alignment_reference(
        consensus, seen_any, grid
    )
    raster = np.asarray(img() if callable(img) else img)
    steps = int(round(span_m / step_m))
    candidate_steps = sorted(range(-steps, steps + 1), key=lambda k: (abs(k), k))
    zero_rgb, zero_weight = _sample_source(
        raster,
        _camera_with_z_correction(C, 0.0),
        coarse,
        z_floor,
        self_blind_m,
        max_incidence_deg,
        occluder,
        z_exempt_m,
    )
    fixed_support = (zero_weight > 0) & reference_seen
    fixed_support = ndimage.binary_erosion(
        fixed_support, iterations=4, border_value=0
    )
    valid_pixels = int(fixed_support.sum())
    refusal = {
        "dz_m": 0.0,
        "zero_score": None,
        "best_score": None,
        "score_gain": None,
        "peak_margin": None,
        "valid_pixels": valid_pixels,
        "boundary_hit": False,
        "accepted": False,
        "status": "insufficient_fixed_support",
    }
    if valid_pixels < 200:
        return refusal

    scores: list[tuple[float, float]] = []

    for candidate in candidate_steps:
        dz = candidate * step_m
        if candidate == 0:
            rgb, weight = zero_rgb, zero_weight
        else:
            corrected_camera = _camera_with_z_correction(C, dz)
            rgb, weight = _sample_source(
                raster,
                corrected_camera,
                coarse,
                z_floor,
                self_blind_m,
                max_incidence_deg,
                occluder,
                z_exempt_m,
            )
        if np.any(fixed_support & (weight <= 0)):
            continue
        score = _high_pass_correlation(rgb, reference, fixed_support)
        if score is None:
            continue
        scores.append((dz, score))

    zero_matches = [score for dz, score in scores if dz == 0.0]
    if not zero_matches:
        refusal["status"] = "zero_candidate_unscorable"
        return refusal
    zero_score = zero_matches[0]
    ranked = sorted(scores, key=lambda item: (-item[1], abs(item[0]), item[0]))
    best_dz, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else None
    score_gain = best_score - zero_score
    peak_margin = best_score - second_score if second_score is not None else None
    boundary_hit = abs(best_dz) >= span_m - step_m * 0.5
    result = {
        **refusal,
        "zero_score": float(zero_score),
        "best_score": float(best_score),
        "score_gain": float(score_gain),
        "peak_margin": float(peak_margin) if peak_margin is not None else None,
        "boundary_hit": bool(boundary_hit),
    }
    if best_dz == 0.0:
        result.update({"accepted": True, "status": "zero_best"})
        return result
    if boundary_hit:
        result["status"] = "best_at_search_boundary"
        return result
    if score_gain < min_score_gain:
        result["status"] = "insufficient_score_gain"
        return result
    if peak_margin is None or peak_margin < min_peak_margin:
        result["status"] = "ambiguous_peak"
        return result
    result.update(
        {"dz_m": float(best_dz), "accepted": True, "status": "shift_accepted"}
    )
    return result


N_HARMONISATION_BINS = 24


def _harmonise_to_consensus(
    rgb: np.ndarray,
    seen: np.ndarray,
    consensus: np.ndarray,
    grid: AtlasGrid,
    C: np.ndarray,
    z_floor: float,
) -> tuple[np.ndarray, dict]:
    """Fit a bounded per-channel gain curve against viewing incidence."""
    xs, ys = grid.pixel_centres_world()
    dz = float(z_floor - C[2])
    distance = np.sqrt((xs - C[0]) ** 2 + (ys - C[1]) ** 2 + dz * dz)
    overhead = np.abs(dz) / np.maximum(distance, 1e-9)
    bin_index = np.clip(
        (overhead * N_HARMONISATION_BINS).astype(np.int32),
        0,
        N_HARMONISATION_BINS - 1,
    )
    valid = seen & (consensus.sum(axis=2) > 1e-3) & (rgb.sum(axis=2) > 1e-3)
    diagnostics = {
        "valid_pixels": int(valid.sum()),
        "channels": [],
    }
    if not np.any(valid):
        diagnostics["channels"] = [
            {
                "channel": channel,
                "supported_bins": 0,
                "bin_counts": [0] * N_HARMONISATION_BINS,
                "gain_min": 1.0,
                "gain_max": 1.0,
                "gain_curve": [1.0] * N_HARMONISATION_BINS,
            }
            for channel in ("r", "g", "b")
        ]
        return rgb, diagnostics

    out = rgb.copy()
    valid_bins = bin_index[valid]
    for channel_index, channel_name in enumerate(("r", "g", "b")):
        sample = rgb[..., channel_index][valid]
        reference = consensus[..., channel_index][valid]
        numerator = np.bincount(
            valid_bins, weights=reference, minlength=N_HARMONISATION_BINS
        )
        denominator = np.bincount(
            valid_bins, weights=sample, minlength=N_HARMONISATION_BINS
        )
        counts = np.bincount(valid_bins, minlength=N_HARMONISATION_BINS)
        supported = counts >= 40
        with np.errstate(divide="ignore", invalid="ignore"):
            curve = np.where(
                supported, numerator / np.maximum(denominator, 1e-6), 1.0
            )
        curve = np.clip(np.nan_to_num(curve, nan=1.0), 0.65, 1.55)
        smoothing_kernel = np.array([0.15, 0.7, 0.15])
        curve = np.convolve(
            np.pad(curve, 1, mode="edge"), smoothing_kernel, mode="valid"
        )
        # Smoothing may borrow evidence into a neighbouring bin that had no
        # support of its own.  That would silently apply an inferred gain to
        # uncalibrated incidence angles.  Keep every unsupported bin neutral.
        curve[~supported] = 1.0
        out[..., channel_index] = (
            rgb[..., channel_index] * curve[bin_index].astype(np.float32)
        )
        diagnostics["channels"].append(
            {
                "channel": channel_name,
                "supported_bins": int(supported.sum()),
                "bin_counts": [int(value) for value in counts],
                "gain_min": float(curve.min()),
                "gain_max": float(curve.max()),
                "gain_curve": [float(value) for value in curve],
            }
        )
    out[~seen] = 0.0
    return out, diagnostics


def _accumulate_statistics(
    sources,
    grid: AtlasGrid,
    z_floor: float,
    dzs: list[float],
    self_blind_m: float,
    max_incidence_deg: float,
    occluder,
    z_exempt_m: float,
    harmonisation_reference: np.ndarray | None = None,
    harmonisation_diagnostics: list[dict] | None = None,
):
    shape = (grid.height, grid.width)
    acc = np.zeros(shape + (3,), dtype=np.float64)
    wsum = np.zeros(shape, dtype=np.float64)
    lum_acc = np.zeros(shape, dtype=np.float64)
    lum_sq = np.zeros(shape, dtype=np.float64)
    counts = np.zeros(shape, dtype=np.int32)
    for (img, C), dz in zip(sources, dzs):
        corrected_camera = _camera_with_z_correction(C, dz)
        rgb, weight = _sample_source(
            img,
            corrected_camera,
            grid,
            z_floor,
            self_blind_m,
            max_incidence_deg,
            occluder,
            z_exempt_m,
        )
        seen = weight > 0
        if harmonisation_reference is not None:
            rgb, diagnostic = _harmonise_to_consensus(
                rgb,
                seen,
                harmonisation_reference,
                grid,
                corrected_camera,
                z_floor,
            )
            if harmonisation_diagnostics is not None:
                harmonisation_diagnostics.append(diagnostic)
        counts += seen
        acc += rgb * weight[..., None]
        wsum += weight
        luminance = rgb @ LUM_W
        lum_acc += luminance * weight
        lum_sq += (luminance * luminance) * weight
    return acc, wsum, lum_acc, lum_sq, counts


def _finish_statistics(acc, wsum, lum_acc, lum_sq, need_mean_rgb: bool):
    safe_w = np.where(wsum > 0, wsum, 1.0)
    mean_rgb = None
    if need_mean_rgb:
        mean_rgb = np.empty(acc.shape, dtype=np.float32)
        np.divide(
            acc,
            safe_w[..., None],
            out=mean_rgb,
            casting="unsafe",
        )
    mean_lum = lum_acc / safe_w
    variance = np.maximum(lum_sq / safe_w - mean_lum * mean_lum, 0.0)
    return mean_rgb, mean_lum, np.sqrt(variance), safe_w


def _leave_one_out_consensus(
    acc: np.ndarray,
    wsum: np.ndarray,
    own_rgb: np.ndarray,
    own_weight: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Remove one source from the global weighted consensus, row-bounded."""
    other_weight = wsum - own_weight
    supported = other_weight > 1e-12
    consensus = np.zeros(acc.shape, dtype=np.float32)
    rows_per_chunk = 128
    for row0 in range(0, acc.shape[0], rows_per_chunk):
        row1 = min(row0 + rows_per_chunk, acc.shape[0])
        row_slice = slice(row0, row1)
        numerator = (
            acc[row_slice]
            - own_rgb[row_slice] * own_weight[row_slice, ..., None]
        )
        np.divide(
            numerator,
            other_weight[row_slice, ..., None],
            out=consensus[row_slice],
            where=supported[row_slice, ..., None],
            casting="unsafe",
        )
    return consensus, supported


def accumulate_floor_atlas(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    self_blind_m: float = 0.80,
    max_incidence_deg: float = 80.0,
    occluder=None,
    z_exempt_m: float = 0.30,
    robust_sigma: float = 2.0,
    specular_sigma: float = 0.5,
    min_robust_sources: int = 3,
    harmonise: bool = False,
    align: bool = False,
) -> tuple[np.ndarray, dict]:
    """Fuse many panoramas into one super-resolved orthophoto.

    Two passes, memory-bounded (no per-pixel sample stacks — a building-scale
    atlas cannot hold N samples per pixel):
      pass 1  weighted mean and variance of luminance per pixel;
      pass 2  re-accumulate, rejecting samples beyond robust_sigma of that
              mean — a chair, a person or a specular flare in ONE capture
              cannot smear a surface that many captures agree on.
    Robust rejection only engages where at least min_robust_sources saw the
    pixel; with fewer looks there is no majority to appeal to, so everything
    observed is kept (and the count is reported).

    Super-resolution falls out of the geometry: the grid is finer than any
    single view's ground sampling, and each source lands on it at a different
    sub-pixel phase, so their weighted sum reconstructs detail no single
    source carries.

    Returns (atlas float32 HxWx3, report). `retained_counts` records samples
    retained by the robust gate. `counts`/`contributor_counts` describe support
    behind the delivered pixel, restoring eligible contributors only where an
    all-rejected pixel falls back to its ungated mean. `eligible_counts`
    preserves pre-rejection geometric support. Unobserved floor is FLAGGED,
    never invented.
    """
    if not sources:
        raise ValueError("no sources")

    # Deliberately NOT caching the per-source rasters: at Grand Hall scale
    # (2600x1250 px, ~50 sources) that stack is ~2.5 GB. Re-sampling in
    # pass 2 trades compute for a hard memory bound, which is what lets this
    # scale to a whole building.
    zero_dzs = [0.0] * len(sources)
    statistics = _accumulate_statistics(
        sources,
        grid,
        z_floor,
        zero_dzs,
        self_blind_m,
        max_incidence_deg,
        occluder,
        z_exempt_m,
    )
    acc, wsum, lum_acc, lum_sq, eligible_counts = statistics

    dzs = zero_dzs
    alignment_estimates = [
        {
            "dz_m": 0.0,
            "zero_score": None,
            "best_score": None,
            "score_gain": None,
            "peak_margin": None,
            "valid_pixels": 0,
            "boundary_hit": False,
            "accepted": False,
            "status": "disabled",
        }
        for _source in sources
    ]
    if align:
        alignment_estimates = []
        for img, C in sources:
            raster = np.asarray(img() if callable(img) else img)
            own_rgb, own_weight = _sample_source(
                raster,
                C,
                grid,
                z_floor,
                self_blind_m,
                max_incidence_deg,
                occluder,
                z_exempt_m,
            )
            consensus, seen_by_another = _leave_one_out_consensus(
                acc, wsum, own_rgb, own_weight
            )
            estimate = _estimate_dz(
                raster,
                C,
                grid,
                z_floor,
                consensus,
                seen_by_another,
                self_blind_m,
                max_incidence_deg,
                occluder,
                z_exempt_m=z_exempt_m,
            )
            alignment_estimates.append(estimate)
            del raster, own_rgb, own_weight, consensus, seen_by_another
        dzs = [float(estimate["dz_m"]) for estimate in alignment_estimates]
        del acc, wsum, lum_acc, lum_sq, eligible_counts, statistics
        statistics = _accumulate_statistics(
            sources,
            grid,
            z_floor,
            dzs,
            self_blind_m,
            max_incidence_deg,
            occluder,
            z_exempt_m,
        )
        acc, wsum, lum_acc, lum_sq, eligible_counts = statistics

    mean_rgb, mean_lum, sigma, safe_w = _finish_statistics(
        acc, wsum, lum_acc, lum_sq, need_mean_rgb=harmonise
    )
    harmonisation_reference = mean_rgb
    harmonisation_diagnostics: list[dict] = []
    if harmonise:
        del mean_lum, sigma, safe_w
        del acc, wsum, lum_acc, lum_sq, eligible_counts, statistics
        statistics = _accumulate_statistics(
            sources,
            grid,
            z_floor,
            dzs,
            self_blind_m,
            max_incidence_deg,
            occluder,
            z_exempt_m,
            harmonisation_reference,
            harmonisation_diagnostics,
        )
        acc, wsum, lum_acc, lum_sq, eligible_counts = statistics
        _unused_rgb, mean_lum, sigma, safe_w = _finish_statistics(
            acc, wsum, lum_acc, lum_sq, need_mean_rgb=False
        )

    # Pass 2 needs the ungated RGB only for an all-rejected fallback. Convert
    # that mean once to the output's float32 precision, then release the much
    # larger float64 accumulator/weight pair before allocating robust buffers.
    del wsum, lum_acc, lum_sq, statistics
    ungated_mean = np.empty(acc.shape, dtype=np.float32)
    np.divide(
        acc,
        safe_w[..., None],
        out=ungated_mean,
        casting="unsafe",
    )
    del acc, safe_w

    observed = eligible_counts > 0
    shape = (grid.height, grid.width)

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
    can_gate = eligible_counts >= min_robust_sources
    retained_counts = np.zeros(shape, dtype=np.int32)
    rejected = 0
    total = 0
    for (img, C), dz in zip(sources, dzs):
        corrected_camera = _camera_with_z_correction(C, dz)
        rgb, w = _sample_source(
            img,
            corrected_camera,
            grid,
            z_floor,
            self_blind_m,
            max_incidence_deg,
            occluder,
            z_exempt_m,
        )
        seen = w > 0
        total += int(seen.sum())
        if harmonisation_reference is not None:
            rgb, _diagnostic = _harmonise_to_consensus(
                rgb,
                seen,
                harmonisation_reference,
                grid,
                corrected_camera,
                z_floor,
            )
        signed = (rgb @ LUM_W) - mean_lum
        drop = seen & can_gate & (
            (signed > bright_gate) | (-signed > dark_gate)
        )
        rejected += int(drop.sum())
        keep_w = np.where(drop, 0.0, w)
        retained_counts += keep_w > 0
        acc2 += rgb * keep_w[..., None]
        wsum2 += keep_w

    # Do not carry the last source raster and full-resolution gate buffers
    # into finalization. At room-scale grids those dead locals otherwise add
    # hundreds of MiB alongside the atlas and robust accumulators.
    del (
        img,
        C,
        dz,
        corrected_camera,
        rgb,
        w,
        seen,
        signed,
        drop,
        keep_w,
        mean_lum,
        sigma,
        dark_gate,
        bright_gate,
        can_gate,
        harmonisation_reference,
        mean_rgb,
    )

    # a pixel whose every sample was rejected falls back to the plain mean:
    # better an averaged observation than a hole we would have to invent
    fallback = observed & (wsum2 <= 0)
    atlas = np.zeros(shape + (3,), dtype=np.float32)
    good = wsum2 > 0
    np.divide(
        acc2,
        wsum2[..., None],
        out=atlas,
        where=good[..., None],
        casting="unsafe",
    )
    contributor_counts = retained_counts.copy()
    if np.any(fallback):
        for row0 in range(0, shape[0], 128):
            row1 = min(row0 + 128, shape[0])
            row_slice = slice(row0, row1)
            np.copyto(
                atlas[row_slice],
                ungated_mean[row_slice],
                where=fallback[row_slice, ..., None],
            )
        contributor_counts[fallback] = eligible_counts[fallback]
    del acc2, wsum2, good, ungated_mean

    contributor_observed = contributor_counts > 0
    eligible_sample_count = int(eligible_counts.sum(dtype=np.uint64))
    retained_sample_count = int(retained_counts.sum(dtype=np.uint64))
    rejected_sample_count = eligible_sample_count - retained_sample_count
    if rejected_sample_count != rejected or eligible_sample_count != total:
        raise RuntimeError("fusion sample accounting changed between passes")

    report = {
        "observed": contributor_observed,
        "counts": contributor_counts,
        "contributor_counts": contributor_counts,
        "retained_counts": retained_counts,
        "eligible_counts": eligible_counts,
        "alignment_enabled": bool(align),
        "harmonisation_enabled": bool(harmonise),
        "harmonisation_diagnostics": harmonisation_diagnostics,
        "align_dz": [float(dz) for dz in dzs],
        "alignment_estimates": alignment_estimates,
        "covered_frac": float(contributor_observed.mean()),
        "eligible_sample_count": eligible_sample_count,
        "retained_sample_count": retained_sample_count,
        "rejected_sample_count": rejected_sample_count,
        "rejected_frac": (
            rejected_sample_count / eligible_sample_count
            if eligible_sample_count
            else 0.0
        ),
        "mean_looks": (
            float(contributor_counts[contributor_observed].mean())
            if contributor_observed.any()
            else 0.0
        ),
        "max_looks": int(contributor_counts.max()),
        "eligible_mean_looks": (
            float(eligible_counts[observed].mean()) if observed.any() else 0.0
        ),
        "eligible_max_looks": int(eligible_counts.max()),
        "fallback_px": int(fallback.sum()),
        "mm_per_px": grid.mm_per_px,
    }
    return atlas, report

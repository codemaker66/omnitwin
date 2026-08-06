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


def _estimate_dz(
    img,
    C: np.ndarray,
    grid: AtlasGrid,
    z_floor: float,
    consensus: np.ndarray,
    seen_any: np.ndarray,
    self_blind_m: float,
    max_incidence_deg: float,
    span_m: float = 0.030,
    step_m: float = 0.003,
) -> float:
    """Recover ONE sweep's floor-height error by matching it to the consensus.

    Returns δ in the sense the disc measurements were quoted in: this sweep's
    floor sits δ BELOW the height the atlas assumed, so sampling it at
    `z_floor - δ` is what registers it. The sign is deliberate — what leaves
    this function and lands in the report is an ERROR, not an internal
    correction term.

    Why one parameter is the right model: if a sweep's floor sits δ below where
    we assumed, every ray it casts lands short by δ·tan(incidence), radially
    away from that scanner. Overhead views barely move; grazing views slip
    centimetres. That single number therefore explains the whole displacement
    field — measured on the Grand Hall, offsets at a disc divided by
    tan(incidence) collapsed to a common ~13-15 mm.

    Fitted by direct search on texture agreement (normalised correlation of the
    high-pass), which is the quantity we actually care about: the δ that makes
    this sweep's planks land on everyone else's.
    """
    from scipy import ndimage

    # Coarse grid: δ is global to the sweep, so there is nothing to buy at full
    # resolution. ~24 mm/px is also about a grazing view's own ground sampling,
    # so the score is read where the sweep genuinely carries information rather
    # than where it is interpolating. The clamp keeps the block reduction below
    # exact: f must divide into the atlas, never run past its edge.
    f = max(1, int(round(24.0 / grid.mm_per_px)))
    f = max(1, min(f, max(grid.height // 8, 1), max(grid.width // 8, 1)))
    ch, cw = grid.height // f, grid.width // f
    cg = AtlasGrid(
        origin_xy=grid.origin_xy,
        mm_per_px=grid.mm_per_px * f,
        width=cw,
        height=ch,
    )

    # AREA-average the reference down, never decimate it. The atlas carries
    # texture finer than a coarse pixel (12 mm grain on a 5 mm grid), and point
    # sampling folds that texture into the reference as high frequencies that
    # belong to no particular place — noise living in exactly the band the
    # search scores, diluting the statistic it maximises. Block-averaging
    # band-limits the reference to the grid it is compared on. This is the
    # load-bearing line: reverting it alone (everything else here unchanged)
    # takes the synthetic floor from 2.6 mm mean residual to 9.4 mm, and the
    # recovered detail from +0.134 correlation to +0.010.
    ref = (consensus[: ch * f, : cw * f].mean(axis=2)
           .reshape(ch, f, cw, f).mean(axis=(1, 3)))
    cov = (seen_any[: ch * f, : cw * f].astype(np.float32)
           .reshape(ch, f, cw, f).mean(axis=(1, 3)))
    ref_ok = cov > 0.999          # whole block observed — no coverage edges
    ref_hp = ref - ndimage.uniform_filter(ref, 9)

    raster = img() if callable(img) else img          # load once, reuse per δ
    n = int(round(span_m / step_m))

    # Every candidate must be scored on the SAME pixels. Both gates that build
    # the mask — the self-blind disc and the incidence cut — move as δ moves,
    # so a per-candidate mask lets a change of SUPPORT decide the argmax
    # instead of texture agreement, and the correlations are then not
    # commensurable. Intersecting over the whole search range settles it once.
    # Holding all 21 candidates is affordable only because they are COARSE: for
    # a Grand Hall atlas that is ~11 MB, where the same 21 at full atlas
    # resolution would be ~270 MB — and one sweep at a time, so it never grows
    # with the sweep count the way a cached full-res stack would.
    layers = []
    support = ref_ok
    for k in range(-n, n + 1):
        rgb, w = _sample_source(
            raster, C, cg, z_floor - k * step_m,
            self_blind_m, max_incidence_deg, None,
        )
        s = rgb.mean(axis=2)
        layers.append(s - ndimage.uniform_filter(s, 9))
        support = support & (w > 0)
    if int(support.sum()) < 200:
        return 0.0

    b = ref_hp[support]
    b = b - b.mean()
    bn = float(np.sqrt((b * b).sum()))
    if bn <= 1e-9:
        return 0.0
    scores = np.full(2 * n + 1, -2.0)
    for j, layer in enumerate(layers):
        a = layer[support]
        a = a - a.mean()
        an = float(np.sqrt((a * a).sum()))
        if an > 1e-9:
            scores[j] = float((a * b).sum()) / (an * bn)
    if not np.any(scores > -2.0):
        # A featureless sweep — bare plaster, a blown-out floor — has no
        # texture to register with. Report no displacement rather than let
        # argmax pick the first bin and dress it up as a measurement.
        return 0.0

    peak = int(np.argmax(scores))
    best = (peak - n) * step_m
    # The step quantises δ to 3 mm, but a correlation peak is smooth, so its
    # vertex lies between samples and three points recover it. The refinement
    # is refused unless the peak is interior AND the curve is locally concave
    # AND the vertex stays inside the bracket: a maximum on the edge means the
    # true δ is outside the search span, and extrapolating there would invent a
    # displacement the data never supported.
    if 0 < peak < 2 * n:
        y0, y1, y2 = scores[peak - 1], scores[peak], scores[peak + 1]
        den = y0 - 2.0 * y1 + y2
        if den < -1e-12:
            shift = 0.5 * (y0 - y2) / den
            if abs(shift) <= 0.5:
                best += shift * step_m
    return best


def _accumulate_pass1(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    dzs: list[float],
    self_blind_m: float,
    max_incidence_deg: float,
    occluder,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Weighted colour, luminance and luminance-square sums over all sources,
    each sampled at its own corrected floor height.

    Separated out because it is run TWICE when alignment is on: once to get a
    consensus good enough to measure the misregistration against, and again on
    the registered geometry, because everything downstream (the robust gate's
    mean and σ, the harmonisation target) is only as sharp as the surface it
    was accumulated from.

    Returns (acc, wsum, lum_acc, lum_sq, counts) — running sums, not means, so
    the caller can subtract one source's contribution back out without a
    second pass over the data.
    """
    shape = (grid.height, grid.width)
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
    return acc, wsum, lum_acc, lum_sq, counts


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
      pass 1  weighted mean and variance of luminance per pixel;
      align   one floor-height error per sweep, measured against the consensus
              of the others, after which pass 1 is re-accumulated on the
              registered geometry (skipped when `align` is off or every sweep
              already agrees);
      pass 2  re-accumulate, rejecting samples beyond robust_sigma of that
              mean — a chair, a person or a specular flare in ONE capture
              cannot smear a surface that many captures agree on.
    Robust rejection only engages where at least min_robust_sources saw the
    pixel; with fewer looks there is no majority to appeal to, so everything
    observed is kept (and the count is reported).

    Registration comes before radiometry on purpose. A misregistered stack
    averages the same plank into several places, so its consensus is a blur —
    and a blurred consensus widens σ (the outlier gate stops discriminating)
    and gives harmonisation a target with no texture in it. Both downstream
    stages are therefore only as good as the alignment they are read off.

    Super-resolution falls out of the geometry: the grid is finer than any
    single view's ground sampling, and each source lands on it at a different
    sub-pixel phase, so their weighted sum reconstructs detail no single
    source carries.

    Returns (atlas float32 HxWx3, report). The report carries `observed`
    (bool), `counts` (int per pixel), `covered_frac` and `rejected_frac` —
    unobserved floor is FLAGGED, never invented. `align_dz` is the per-sweep
    floor-height ERROR in metres, signed so that positive means the sweep's
    floor sat BELOW the assumed z_floor; it is a measurement of the capture,
    reportable as such, not the internal correction (which is its negation).
    """
    if not sources:
        raise ValueError("no sources")

    shape = (grid.height, grid.width)

    # Deliberately NOT caching the per-source rasters: at Grand Hall scale
    # (2600x1250 px, ~50 sources) that stack is ~2.5 GB. Re-sampling instead
    # trades compute for a hard memory bound, which is what lets this scale to
    # a whole building — so every pass below re-samples, none of them hoard.
    acc, wsum, lum_acc, lum_sq, counts = _accumulate_pass1(
        sources, grid, z_floor, [0.0] * len(sources),
        self_blind_m, max_incidence_deg, occluder,
    )

    # --- alignment pass: recover each sweep's floor-height error ---------
    dzs = [0.0] * len(sources)
    if align:
        for i, (img, C) in enumerate(sources):
            # Match each sweep against the consensus of the OTHERS. A sweep
            # included in its own reference is partly correlating with its own
            # misplacement, which drags δ toward zero — hardest exactly where
            # it is the sole witness, since there the consensus IS that sweep.
            # Leaving it out is what turns a shrunken estimate into a metric
            # one (measured: 4.8 mm -> 2.6 mm mean residual). Rebuilding by
            # subtraction costs one re-sample and holds no extra raster.
            #
            # Resolved here rather than inside each callee so a lazily-loaded
            # sweep is decoded ONCE for both the subtraction and the search —
            # at the 8192 tier that load is ~100 MB of JPEG per sweep.
            raster = img() if callable(img) else img
            rgb_i, w_i = _sample_source(
                raster, C, grid, z_floor, self_blind_m, max_incidence_deg,
                occluder,
            )
            w_others = wsum - w_i
            seen_others = (counts - (w_i > 0)) > 0
            ref = np.zeros(shape + (3,), dtype=np.float32)
            if np.any(seen_others):
                # Indexed before differencing: a full-frame float64 temporary
                # is ~80 MB at Grand Hall scale, and this runs per sweep.
                num = acc[seen_others] - (
                    rgb_i[seen_others] * w_i[seen_others][..., None]
                )
                ref[seen_others] = (
                    num / np.maximum(w_others[seen_others], 1e-12)[..., None]
                ).astype(np.float32)
            dzs[i] = _estimate_dz(
                raster, C, grid, z_floor, ref, seen_others,
                self_blind_m, max_incidence_deg,
            )

        if any(d != 0.0 for d in dzs):
            # Pass 1 was accumulated on the UNALIGNED geometry, so its
            # consensus is the very smear we just measured — and pass 2 leans
            # on it twice, as the outlier gate's mean/σ and as the
            # harmonisation reference. A blurred reference makes σ too wide to
            # gate with and hands harmonisation a target that has no texture.
            # Re-accumulate at the recovered heights so both are read off a
            # registered surface.
            acc, wsum, lum_acc, lum_sq, counts = _accumulate_pass1(
                sources, grid, z_floor, dzs,
                self_blind_m, max_incidence_deg, occluder,
            )

    observed = counts > 0
    safe_w = np.where(wsum > 0, wsum, 1.0)
    mean_lum = lum_acc / safe_w
    var_lum = np.maximum(lum_sq / safe_w - mean_lum * mean_lum, 0.0)
    # pass-1 consensus in colour — the reference each view is levelled against
    mean_rgb = (acc / safe_w[..., None]).astype(np.float32)
    sigma = np.sqrt(var_lum)

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
        "align_dz": [round(float(d), 4) for d in dzs],
        "covered_frac": float(observed.mean()),
        "rejected_frac": (rejected / total) if total else 0.0,
        "mean_looks": float(counts[observed].mean()) if observed.any() else 0.0,
        "max_looks": int(counts.max()),
        "fallback_px": int(fallback.sum()),
        "mm_per_px": grid.mm_per_px,
    }
    return atlas, report

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


ALIGN_COARSE_MM = 24.0      # cell size the height fit is scored on
ALIGN_HP_PX = 9             # high-pass kernel, in coarse cells
ALIGN_MIN_OVERLAP_PX = 200  # below this there is no evidence, only noise
UNSCORED = -np.inf          # a rung never scored can never win the argmax


def _shifted_centre(C: np.ndarray, dz: float) -> np.ndarray:
    """A sweep's centre with a height correction applied.

    The correction belongs to the POSE, never to the floor. There is one floor
    and it is shared; what disagrees is where each scanner thinks it stood. Move
    the plane instead and two things quietly break — every occlusion ray gets
    aimed at a target that is no longer on the real floor, and the atlas stops
    being a measuring surface at a known height.
    """
    Ck = np.asarray(C, dtype=np.float64).copy()
    Ck[2] += dz
    return Ck


def _coarse_factor(grid: AtlasGrid, coarse_mm: float) -> int:
    """One decimation factor for the whole alignment fit.

    δ is a single scalar per sweep, so identifying it does not need the atlas's
    own resolution — and a coarser cell averages away the sub-pixel resampling
    ripple that a one-parameter model cannot explain anyway. The clamp keeps the
    block reduction EXACT (f must divide into the grid) and leaves enough cells
    for the high-pass kernel to mean anything.

    The known cost, and the next lever if this is ever pushed further: the
    REFERENCE is area-averaged onto this cell (see _block_sum) but the sweep is
    still point-sampled onto it, one panorama tap per cell. That is harmless
    while a view's ground sampling is near the cell size, as it is at the tier
    these captures fuse at, and it degrades as the source gets finer than the
    cell — measured, the per-sweep residual goes from 2.1 mm with 9-20 mm
    sampling to 7.2 mm with 2.5 mm sampling (still inside the bar, and the atlas
    gets BETTER because a sharper source carries more detail to recover). The
    principled fix is to band-limit the sweep too, which means mip-selecting the
    panorama per pixel, since a cell's footprint runs from several source pixels
    near the scanner to under one at grazing. That is a real piece of work and
    it is not pretended here.
    """
    if grid.mm_per_px <= 0:
        return 1
    f = int(round(coarse_mm / grid.mm_per_px))
    return max(1, min(f, max(grid.height // 8, 1), max(grid.width // 8, 1)))


def _block_sum(a: np.ndarray, f: int, ch: int, cw: int) -> np.ndarray:
    """Total each f x f fine block into one coarse cell.

    Summing rather than sampling every f-th pixel is what keeps the coarse
    reference REGISTERED with the raster fitted to it: a block's centroid is the
    coarse pixel centre, whereas a strided sample sits (f-1)/2 fine pixels off it
    in both axes — at 5 mm pixels and f=5 that is a fixed 10 mm diagonal shift,
    and a search that can only move texture radially has to pay for that constant
    shift with a δ it invents. Summing is also the only reduction that
    band-limits: point-sampling a 5 mm raster onto a 24 mm grid folds the 12 mm
    grain into a pattern belonging nowhere, living in exactly the band the
    correlation scores.

    This is the load-bearing line of the whole alignment, and the only one whose
    value GROWS with the sweep count. Revert it alone and the estimator stops
    measuring and starts inventing: on a perfectly level scene it hands out
    18 mm corrections, and at twenty sweeps it makes the atlas 0.128 of
    correlation WORSE than leaving every pose alone.
    """
    a = a[: ch * f, : cw * f]
    if a.ndim == 2:
        return a.reshape(ch, f, cw, f).sum(axis=(1, 3))
    return a.reshape(ch, f, cw, f, a.shape[2]).sum(axis=(1, 3))


def _fit_pose_dz(
    raster: np.ndarray,
    C: np.ndarray,
    cg: AtlasGrid,
    z_floor: float,
    ref_hp: np.ndarray,
    ref_ok: np.ndarray,
    self_blind_m: float,
    max_incidence_deg: float,
    occluder,
    span_m: float,
    step_m: float,
) -> float:
    """Direct search for the height correction that lands this sweep's planks on
    the reference's, scored by normalised correlation of the high-pass — the
    quantity the atlas is actually judged on, not a proxy for it.

    WHAT THIS SWEEP CAN SEE IS DECIDED ONCE, not re-decided at every candidate.
    Visibility is a property of where the scanner stood; asking the occluder
    again at each δ makes the shadow boundary crawl across the grid as the
    search runs, so the score starts tracking WHICH pixels are being compared
    instead of how well they agree — and a correlation over a moving support is
    not a comparison at all. Measured on a scene where the obstruction is
    present in both the mesh AND the imagery (so a shadowed pixel really does
    show the table top rather than clean floor), re-testing per candidate
    recovers +0.064 of detail at 5.8 mm residual where freezing recovers +0.080
    at 3.4 mm. Freezing also drops the occlusion query from twenty-one per sweep
    to one, which is the difference between a search that is free and a search
    that dominates a building-scale build.

    Beyond that fixed visibility each candidate is simply scored on its own
    overlap. Intersecting the candidates into one common mask was tried and is
    an exact no-op once visibility is frozen — identical to four decimals in
    every condition measured — because at tripod height the remaining gates, the
    self-blind disc and the incidence cut, barely move over a ±30 mm search. The
    simpler form is therefore the honest one, and the minimum-overlap gate is
    what keeps it safe: a candidate too thin to mean anything is left UNSCORED
    rather than allowed to win on a small, flattering patch.

    PIXELS ARE WEIGHTED BY tan²(incidence), because tan(incidence) IS the
    derivative of lateral slip with respect to δ. A pixel viewed from straight
    overhead does not move when the height is wrong, so it carries no evidence
    about the height and must not out-vote the grazing pixels carrying nearly
    all of it. The effect is modest but consistent — 2.1 -> 1.9 mm of residual
    on the test's own scene, 1.7 -> 1.2 mm at twenty sweeps, 3.7 -> 3.4 mm under
    an occluder — and it costs one array of geometry already computed.

    Returns 0.0 rather than a guess when no candidate ever had enough
    independent overlap, or when the sweep carries no texture to register:
    floor nobody else saw must not be handed a confident correction.
    """
    from scipy import ndimage

    n = int(round(span_m / step_m))
    vis = ref_ok
    if occluder is not None:
        _, w0 = _sample_source(
            raster, C, cg, z_floor, self_blind_m, max_incidence_deg, occluder,
        )
        vis = ref_ok & (w0 > 0)

    xs, ys = cg.pixel_centres_world()
    drop = z_floor - float(np.asarray(C, dtype=np.float64)[2])
    dist = np.sqrt((xs - C[0]) ** 2 + (ys - C[1]) ** 2 + drop * drop)
    overhead = abs(drop) / np.maximum(dist, 1e-9)
    jac = (1.0 - overhead ** 2) / np.maximum(overhead ** 2, 1e-12)

    best, best_score = 0.0, UNSCORED
    for k in range(-n, n + 1):
        rgb, w = _sample_source(
            raster, _shifted_centre(C, k * step_m), cg, z_floor,
            self_blind_m, max_incidence_deg, None,
        )
        m = vis & (w > 0)
        if int(m.sum()) < ALIGN_MIN_OVERLAP_PX:
            continue
        wt = jac[m]
        tot = float(wt.sum())
        if tot <= 0.0:
            continue
        wt = wt / tot
        s = rgb.mean(axis=2)
        a = (s - ndimage.uniform_filter(s, ALIGN_HP_PX))[m]
        b = ref_hp[m]
        a = a - float((wt * a).sum())
        b = b - float((wt * b).sum())
        den = float(np.sqrt((wt * a * a).sum() * (wt * b * b).sum()))
        if den <= 1e-12:
            continue
        score = float((wt * a * b).sum()) / den
        if score > best_score:
            best_score, best = score, k * step_m
    # Deliberately NOT refined to sub-step by fitting the peak's two neighbours,
    # and NOT because it is worse: measured, it is slightly better (1.70 against
    # 1.89 mm on the test's own scene, 2.94 against 3.05 mm over four seeds).
    # It is declined because of what it costs to buy those two tenths of a
    # millimetre — on a perfectly level, perfectly posed scene the quantised
    # search returns EXACTLY zero, while the parabola hands every sweep 0.3 mm
    # of displacement that no evidence supports. Against a 12 mm bar that trade
    # is not close: this module's whole discipline is that an unobserved or
    # unmeasurable quantity comes back empty rather than plausible.
    return float(best)


def _align_pose_heights(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    acc: np.ndarray,
    wsum: np.ndarray,
    counts: np.ndarray,
    self_blind_m: float,
    max_incidence_deg: float,
    occluder,
    span_m: float = 0.030,
    step_m: float = 0.003,
) -> list[float]:
    """Recover every sweep's height error against a LEAVE-ONE-OUT consensus.
    Returned values are metres to ADD to each source's recorded centre z.

    Why one parameter is the right model: if a sweep's centre sits δ above where
    its pose claims, every ray it casts lands long by δ·tan(incidence), radially
    away from that scanner. Overhead views barely move; grazing views slip
    centimetres. That single number therefore explains the whole displacement
    field — measured on the Grand Hall, offsets at a disc divided by
    tan(incidence) collapsed to a common ~13-15 mm.

    LEAVE-ONE-OUT because a sweep must not be scored against a consensus it
    helped write. At zero correction it already agrees with its own
    contribution, however wrong its pose is, so the score carries a spurious peak
    at zero and the search is pulled into it. The bias is proportional to the
    share the sweep owns of the mean, so it necessarily shrinks as ~1/N — this
    matters at five sweeps and is negligible at forty.

    Its measured worth is REAL BUT MODEST, and smaller than an earlier draft of
    this comment claimed. Ablated against the self-vote over eight seeds on the
    five-scanner fixture in tests/test_floor_atlas.py (mean detail gap, mean
    residual): open floor +0.0935/3.33 mm -> +0.1010/2.87 mm; with a mesh
    occluder +0.1029/4.38 mm -> +0.1202/3.14 mm. So on open floor the gain sits
    inside the seed-to-seed scatter (sigma ~0.022), while under an occluder it is
    about 2.3x larger and consistently favours the subtraction on residual.
    That is the case worth keeping it for: every sweep's shadow removes a
    different part of the floor, and shadowed floor is thin evidence — exactly
    where a self-vote decides the answer. Re-measure by replacing the four
    ref_* lines below with the un-subtracted block_* sums.

    That subtraction only cancels if the contribution removed was built the same
    way as the sum it is removed from — same occluder, same gates. Sample the
    source unoccluded here and subtract it from an occluded accumulator and the
    reference goes NEGATIVE exactly where the shadow fell, which is worse than
    having no leave-one-out at all.

    Memory stays bounded, which is the constraint that lets this run over a whole
    building: per-source rasters are never stacked, only the ONE source being
    excluded is re-sampled, and it is re-sampled from a raster the search has to
    load anyway, so a lazily-loaded 8192 tier is read once per sweep here.

    WHAT THIS CANNOT MEASURE, stated because `align_dz` leaves the module and a
    number nobody has bounded is worse than no number. The COMMON component of
    the error is only weakly observable. Every sweep's displacement field is
    radial about its own centre, so a shift shared by all of them does not
    cancel entirely — but it is far less constrained than the differences
    between sweeps, and it comes back short: plant a uniform 14 mm on every
    sweep and 56-68% of it is recovered, in the right direction, with the atlas
    still sharpening strongly (+0.12 at five sweeps, +0.21 at twenty). That is
    the case the Grand Hall actually presented, so treat the SPREAD of align_dz
    as the trustworthy part and its mean as a lower bound on a shared error. No
    constant is subtracted to flatter it, and no re-centring is applied: with a
    handful of sweeps the true mean error really can be several millimetres, and
    forcing it to zero would delete signal rather than bias.
    """
    from scipy import ndimage

    f = _coarse_factor(grid, ALIGN_COARSE_MM)
    ch, cw = grid.height // f, grid.width // f
    cg = AtlasGrid(
        origin_xy=grid.origin_xy,
        mm_per_px=grid.mm_per_px * f,
        width=cw,
        height=ch,
    )
    block_acc = _block_sum(acc, f, ch, cw)
    block_w = _block_sum(wsum, f, ch, cw)
    block_n = _block_sum(counts.astype(np.int64), f, ch, cw)

    dzs: list[float] = []
    for img, C in sources:
        raster = img() if callable(img) else img     # load once, reuse per rung
        rgb, w = _sample_source(
            raster, C, grid, z_floor, self_blind_m, max_incidence_deg, occluder,
        )
        # Counted, not thresholded on weight: a cell only THIS source ever saw
        # cancels to a floating-point residue rather than a clean zero, and
        # "did anyone else look here" is an integer question.
        ref_n = block_n - _block_sum((w > 0).astype(np.int64), f, ch, cw)
        ref_ok = ref_n > 0
        ref_w = np.maximum(block_w - _block_sum(w, f, ch, cw), 0.0)
        ref_acc = block_acc - _block_sum(rgb * w[..., None], f, ch, cw)
        safe = np.where(ref_ok & (ref_w > 0), ref_w, 1.0)
        ref = (ref_acc / safe[..., None]).mean(axis=2)
        # Flat-fill the excluded cells before the high-pass. Left at zero they
        # are a cliff edge, and the filter spreads that artificial edge back over
        # cells that ARE valid — manufacturing structure for the search to lock
        # onto exactly where the evidence ran out.
        ref = np.where(ref_ok, ref, ref[ref_ok].mean() if ref_ok.any() else 0.0)
        ref_hp = ref - ndimage.uniform_filter(ref, ALIGN_HP_PX)
        dzs.append(
            _fit_pose_dz(
                raster, C, cg, z_floor, ref_hp, ref_ok,
                self_blind_m, max_incidence_deg, occluder, span_m, step_m,
            )
        )
    return dzs


def _accumulate_pass1(
    sources: list[tuple[np.ndarray, np.ndarray]],
    grid: AtlasGrid,
    z_floor: float,
    dzs: list[float],
    self_blind_m: float,
    max_incidence_deg: float,
    occluder,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Weighted colour, luminance and luminance-square sums over every source,
    each sampled from its own corrected height.

    Split out because it is run TWICE when alignment is on: once to get a
    consensus good enough to MEASURE the misregistration against, and again on
    the registered geometry, because everything downstream — the robust gate's
    mean and σ, the harmonisation target — is only as sharp as the surface it was
    accumulated from. Recover δ and then fuse against the smeared consensus that
    the bad δ produced, and you have fixed the geometry while keeping the
    radiometry the bad geometry caused: an inflated σ that lets outliers through,
    and a blurred levelling target.

    Returns running SUMS, not means, so a caller can subtract one source's
    contribution back out without a second pass over the data.
    """
    shape = (grid.height, grid.width)
    acc = np.zeros(shape + (3,), dtype=np.float64)
    wsum = np.zeros(shape, dtype=np.float64)
    lum_acc = np.zeros(shape, dtype=np.float64)
    lum_sq = np.zeros(shape, dtype=np.float64)
    counts = np.zeros(shape, dtype=np.int32)
    # Deliberately NOT caching the per-source rasters: at Grand Hall scale
    # (2600x1250 px, ~50 sources) that stack is ~2.5 GB. Re-sampling later
    # trades compute for a hard memory bound, which is what lets this scale to
    # a whole building.
    for (img, C), dz in zip(sources, dzs):
        rgb, w = _sample_source(
            img, _shifted_centre(C, dz), grid, z_floor,
            self_blind_m, max_incidence_deg, occluder,
        )
        seen = w > 0
        counts += seen
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
      align   one height correction per SWEEP, fitted against the consensus of
              the others, after which pass 1 is re-measured on the registered
              geometry (skipped entirely when `align` is off, or when every
              sweep already agrees);
      pass 2  re-accumulate, rejecting samples beyond robust_sigma of that
              mean — a chair, a person or a specular flare in ONE capture
              cannot smear a surface that many captures agree on.
    Robust rejection only engages where at least min_robust_sources saw the
    pixel; with fewer looks there is no majority to appeal to, so everything
    observed is kept (and the count is reported).

    Registration comes before radiometry on purpose, because it is prior to it.
    A misregistered stack lands the same plank in several places, so the mean
    ERASES the very texture the fusion exists to sharpen and reports an inflated
    σ for it — which then reads as a pale blob, which is why three photometric
    theories in a row failed on the real Grand Hall discs. It was never
    brightness; it is registration, and a levelling curve fitted to a smeared
    consensus cannot fix a geometric fault.

    Super-resolution falls out of the geometry: the grid is finer than any
    single view's ground sampling, and each source lands on it at a different
    sub-pixel phase, so their weighted sum reconstructs detail no single
    source carries.

    Returns (atlas float32 HxWx3, report). The report carries `observed`
    (bool), `counts` (int per pixel), `covered_frac` and `rejected_frac` —
    unobserved floor is FLAGGED, never invented — and `align_dz`, the metres to
    ADD to each source's recorded centre z, in source order.
    """
    if not sources:
        raise ValueError("no sources")

    shape = (grid.height, grid.width)
    dzs = [0.0] * len(sources)
    acc, wsum, lum_acc, lum_sq, counts = _accumulate_pass1(
        sources, grid, z_floor, dzs, self_blind_m, max_incidence_deg, occluder,
    )

    if align:
        dzs = _align_pose_heights(
            sources, grid, z_floor, acc, wsum, counts,
            self_blind_m, max_incidence_deg, occluder,
        )
        if any(d != 0.0 for d in dzs):
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
            img, _shifted_centre(C, dzs[si]), grid, z_floor,
            self_blind_m, max_incidence_deg, occluder,
        )
        seen = w > 0
        total += int(seen.sum())
        if harmonise:
            # the CORRECTED centre, because the sheen curve is indexed by
            # incidence angle and incidence is measured from where the scanner
            # actually stood, not from where its pose claimed
            rgb = _harmonise_to_consensus(
                rgb, seen, mean_rgb, grid, _shifted_centre(C, dzs[si]), z_floor
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

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

    # coarse grid: δ is global to the sweep, so estimate it cheaply
    f = max(1, int(round(grid.mm_per_px and 24.0 / grid.mm_per_px)) or 1)
    cg = AtlasGrid(
        origin_xy=grid.origin_xy,
        mm_per_px=grid.mm_per_px * f,
        width=max(grid.width // f, 8),
        height=max(grid.height // f, 8),
    )
    ref = consensus[: cg.height * f : f, : cg.width * f : f].mean(axis=2)
    ref_ok = seen_any[: cg.height * f : f, : cg.width * f : f]
    ref_hp = ref - ndimage.uniform_filter(ref, 9)

    raster = img() if callable(img) else img          # load once, reuse per δ
    best, best_score = 0.0, -2.0
    n = int(round(span_m / step_m))
    for k in range(-n, n + 1):
        dz = k * step_m
        rgb, w = _sample_source(
            raster, C, cg, z_floor + dz, self_blind_m, max_incidence_deg, None
        )
        m = (w > 0) & ref_ok
        if int(m.sum()) < 200:
            continue
        s = rgb.mean(axis=2)
        s_hp = s - ndimage.uniform_filter(s, 9)
        a, b = s_hp[m], ref_hp[m]
        a = a - a.mean(); b = b - b.mean()
        den = float(np.sqrt((a * a).sum() * (b * b).sum()))
        score = float((a * b).sum() / den) if den > 1e-9 else -2.0
        if score > best_score:
            best_score, best = score, dz
    return best


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

    Returns (atlas float32 HxWx3, report). The report carries `observed`
    (bool), `counts` (int per pixel), `covered_frac` and `rejected_frac` —
    unobserved floor is FLAGGED, never invented.
    """
    if not sources:
        raise ValueError("no sources")

    shape = (grid.height, grid.width)
    acc = np.zeros(shape + (3,), dtype=np.float64)
    wsum = np.zeros(shape, dtype=np.float64)
    lum_acc = np.zeros(shape, dtype=np.float64)
    lum_sq = np.zeros(shape, dtype=np.float64)
    counts = np.zeros(shape, dtype=np.int32)

    # Deliberately NOT caching the per-source rasters: at Grand Hall scale
    # (2600x1250 px, ~50 sources) that stack is ~2.5 GB. Re-sampling in
    # pass 2 trades compute for a hard memory bound, which is what lets this
    # scale to a whole building.
    for img, C in sources:
        rgb, w = _sample_source(
            img, C, grid, z_floor, self_blind_m, max_incidence_deg,
            occluder,
        )
        seen = w > 0
        counts += seen
        acc += rgb * w[..., None]
        wsum += w
        lum = rgb @ LUM_W
        lum_acc += lum * w
        lum_sq += (lum * lum) * w

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
    # --- alignment pass: recover each sweep's floor-height error ---------
    dzs = [0.0] * len(sources)
    if align:
        seen_any = counts > 0
        for i, (img, C) in enumerate(sources):
            dzs[i] = _estimate_dz(
                img, C, grid, z_floor, mean_rgb, seen_any,
                self_blind_m, max_incidence_deg,
            )

    dark_gate = np.maximum(robust_sigma * sigma, 6.0)
    bright_gate = np.maximum(specular_sigma * sigma, 4.0)
    can_gate = counts >= min_robust_sources
    rejected = 0
    total = 0
    for si, (img, C) in enumerate(sources):
        rgb, w = _sample_source(
            img, C, grid, z_floor + dzs[si], self_blind_m, max_incidence_deg,
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

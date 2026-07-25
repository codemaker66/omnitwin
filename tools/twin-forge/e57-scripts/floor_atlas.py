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
            img, C, grid, z_floor, self_blind_m, max_incidence_deg, occluder
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
    for img, C in sources:
        rgb, w = _sample_source(
            img, C, grid, z_floor, self_blind_m, max_incidence_deg, occluder
        )
        seen = w > 0
        total += int(seen.sum())
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
        "covered_frac": float(observed.mean()),
        "rejected_frac": (rejected / total) if total else 0.0,
        "mean_looks": float(counts[observed].mean()) if observed.any() else 0.0,
        "max_looks": int(counts.max()),
        "fallback_px": int(fallback.sum()),
        "mm_per_px": grid.mm_per_px,
    }
    return atlas, report

"""Provenance for the Floor Atlas — the evidence behind every pixel.

WHY THIS EXISTS. accumulate_floor_atlas already knows, per cell, exactly how
much evidence it had: how many sources landed a sample there, how many of
those it threw away as specular or outlying, how head-on each look was and
how far it travelled. Then it averages all of that into three colour
channels and hands back a picture. A picture is unfalsifiable. A cell fused
from seven head-on looks and a cell scraped from one grazing look are the
same pixels to the eye, and the second one is where the planner will put a
table and where the survey claim will not hold.

So this module renders the CONFIDENCE, not just the colour.

THE HONESTY CONSTRAINT, which governs every choice below. This layer exists
to show what we do NOT know. An encoding that makes thin evidence look
finished is worse than no encoding, because it converts an unanswered
question into a settled one — the same failure the atlas itself refuses when
it flags unobserved floor rather than inpainting it. Three consequences,
each visible in the code:

  * every term is a factor that can only ever REDUCE confidence, and the
    incidence term is applied as a CAP rather than a factor, so no amount of
    look-count can buy its way past a grazing-only view;
  * super-resolution is deliberately NOT credited. Fusing N looks really
    does resolve detail below any single look's sampling — that is the whole
    thesis of floor_atlas — but the recoverable factor depends on sub-pixel
    phase diversity, which this layer does not measure. Crediting an
    unmeasured gain is exactly the move that flatters a bad capture, so the
    reported confidence is a LOWER bound and is documented as one;
  * "observed" and "confident" are different questions and are answered
    separately. A cell whose every sample the robust gate rejected is
    observed (accumulate_floor_atlas falls back to the plain mean there and
    the pixels look perfectly normal) and carries confidence 0.

FRAME AND UNITS. Everything is aligned to an AtlasGrid: array index (row,
col) is that grid's cell, world metres via grid.atlas_to_world. Incidence is
degrees from the floor NORMAL, so 0 is straight down and 90 is the horizon.
Ground sampling is millimetres on the floor per source pixel.

This module deliberately does not import floor_atlas. floor_atlas is where
the accumulation lives and is where the integrator will call in from, so a
dependency in this direction would close a cycle. Any object with a
pixel_centres_world() returning (xs, ys) rasters works as `grid`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# A look count at which the count term stops penalising. Seven is the point
# where floor_atlas's own machinery is fully armed rather than a taste
# judgement: its robust gate needs min_robust_sources (3) before it will
# reject anything at all, and the specular gate compares each sample against
# the weighted MEAN of the others, so it only catches a chandelier while the
# diffuse observations still outnumber the flared ones. Below 3 there is no
# majority to appeal to and nothing can be rejected, which is why a 1-look
# cell is scored at 1/7 rather than on some gentler curve.
FULL_LOOKS = 7

# Alpha ceiling for an OBSERVED cell. Kept below 255 so that "we looked and
# learned almost nothing" never renders identically to "nobody ever looked".
MAX_ALPHA = 235

# Magenta at full opacity: the cartographic no-data convention, chosen
# because it cannot be mistaken for floor, for shadow, or for a hazard ramp
# stop. Channels are (R, G, B, A), all 0-255.
NO_DATA_RGBA = (255, 0, 255, 255)

# Hazard ramp for observed cells, at confidence 0.0 / 0.5 / 1.0. The ramp
# carries the reading; ALPHA carries the magnitude, and at confidence 1 the
# alpha is 0 so the top stop is never actually seen at full strength.
_RAMP = np.array(
    [[214.0, 40.0, 40.0], [232.0, 154.0, 34.0], [240.0, 214.0, 120.0]]
)


@dataclass(frozen=True)
class Provenance:
    """Per-cell evidence for one Floor Atlas, aligned to its AtlasGrid.

    All arrays are (height, width) and share the grid's indexing.

      looks               int32.   Sources whose sample SURVIVED into this
                                   cell's colour. Not "sources that could
                                   see it" — a sample the robust or specular
                                   gate dropped is counted in `rejected`, not
                                   here, because it contributed nothing.
      rejected            int32.   Samples dropped as specular/outlier.
      best_incidence_deg  float32. Degrees from the floor normal of the most
                                   head-on SURVIVING look; 0 = straight down,
                                   90 = the horizon. NaN where no look
                                   survived — including every unobserved cell.
      effective_gsd_mm    float32. Millimetres of floor per source pixel for
                                   the finest surviving look, taken as the
                                   COARSER of that look's radial and
                                   tangential footprints (see look_geometry).
                                   NaN where no look survived.
      observed            bool.    Did any source land a sample here at all,
                                   surviving or not. observed & (looks == 0)
                                   is the fallback case: the atlas shows the
                                   plain mean of observations it disbelieved.

    NaN is used rather than a sentinel number on purpose. Any float sentinel
    (0, -1, 999) is a value some consumer will eventually average, plot or
    compare; NaN propagates and forces the question.

    float32 for the geometry, and the reason is a bound not a taste: at a
    1.5 m tripod height and a metre or two of offset, the 3 mm quantisation
    of floor_atlas's own pose-height search already puts about 0.06 degrees
    of uncertainty on any incidence angle here, while float32 resolves about
    1e-5 degrees at 63 degrees — some four orders finer than the input can
    support. Measured at the Grand Hall grid floor_atlas_build's own example
    bounds imply (2750 x 2250 cells), float64 geometry made a Provenance
    154.7 MB against floor_atlas's own 321.8 MB of accumulators; float32
    makes it 105.2 MB. Precision nobody can supply is not worth 50 MB of a
    building-scale build's peak.
    """

    looks: np.ndarray
    rejected: np.ndarray
    best_incidence_deg: np.ndarray
    effective_gsd_mm: np.ndarray
    observed: np.ndarray

    @property
    def shape(self) -> tuple[int, int]:
        return (int(self.looks.shape[0]), int(self.looks.shape[1]))


def look_geometry(
    grid, C: np.ndarray, z_floor: float, eq_hw: tuple[int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """One source's sampling geometry over the whole grid.

    Returns (incidence_deg, gsd_mm), both (h, w) float32 — see Provenance
    for why float32 is the honest width for these two quantities.

    GROUND SAMPLING, derived rather than assumed. An equirectangular
    panorama of eq_h rows spans pi radians of elevation, so one pixel row
    subtends d_el = pi/eq_h; eq_w columns span 2*pi of azimuth, so one pixel
    column subtends d_az = 2*pi/eq_w. A floor cell at slant range `dist` and
    incidence theta from the normal is therefore covered by a source pixel
    whose footprint on the floor is

        radial     = dist * d_el / cos(theta)      (up the slope of the ray)
        tangential = off  * d_az                   (around the scanner)

    where off = dist * sin(theta) is the horizontal offset. The two are very
    different at the extremes: straight down the tangential footprint
    collapses to nothing (an equirect massively oversamples its poles, which
    is precisely why the tripod hole is a smear rather than a crisp disc),
    while at grazing the radial footprint blows up as 1/cos(theta).

    The reported gsd is the LARGER of the two, because resolution is
    governed by the coarsest axis: a footprint 2 mm across and 40 mm long
    resolves 40 mm detail, not 2 mm. Taking the geometric mean instead
    (sqrt of the product) would report ~9 mm for that same pixel, which is
    the kind of number that makes a grazing capture look like a good one.
    """
    xs, ys = grid.pixel_centres_world()
    C = np.asarray(C, dtype=np.float64)
    drop = float(z_floor - C[2])                    # negative: floor is below
    off = np.hypot(xs - C[0], ys - C[1])
    dist = np.sqrt(off * off + drop * drop)
    cos_inc = np.clip(abs(drop) / np.maximum(dist, 1e-9), 0.0, 1.0)
    incidence_deg = np.degrees(np.arccos(cos_inc))
    eq_h, eq_w = int(eq_hw[0]), int(eq_hw[1])
    d_el = np.pi / max(eq_h, 1)
    d_az = 2.0 * np.pi / max(eq_w, 1)
    radial = dist * d_el / np.maximum(cos_inc, 1e-9)
    tangential = off * d_az
    return (
        incidence_deg.astype(np.float32),
        (1000.0 * np.maximum(radial, tangential)).astype(np.float32),
    )


class ProvenanceAccumulator:
    """Fold one source at a time into a Provenance.

    Memory-bounded exactly the way accumulate_floor_atlas is: four rasters
    total, no per-cell sample stacks. That is not an optimisation, it is the
    constraint that lets provenance be computed for a building-scale atlas at
    all — a Grand-Hall grid at 8 mm/px times 50 sources is millions of cells
    times fifty samples, and nothing here may need to hold that.

    The masks are supplied by the CALLER rather than re-derived here. The
    accumulator must describe the atlas that actually shipped, so the
    authority on "did this source contribute" has to be the same code that
    decided it (floor_atlas._sample_source and the pass-2 robust gate). A
    second copy of the gate logic in this file would be a second opinion, and
    a provenance layer that holds a second opinion is worse than none.
    """

    def __init__(self, height: int, width: int) -> None:
        shape = (int(height), int(width))
        self._looks = np.zeros(shape, dtype=np.int32)
        self._rejected = np.zeros(shape, dtype=np.int32)
        self._best_inc = np.full(shape, np.inf, dtype=np.float32)
        self._best_gsd = np.full(shape, np.inf, dtype=np.float32)

    def add_look(
        self,
        kept: np.ndarray,
        rejected: np.ndarray,
        incidence_deg: np.ndarray,
        gsd_mm: np.ndarray,
    ) -> None:
        """Fold one source, given its masks and its per-cell geometry.

        `kept` and `rejected` must be disjoint: a sample is one or the other.
        Geometry is recorded only where `kept`, so a cell whose every sample
        was rejected reports no geometry at all rather than the geometry of
        looks the atlas refused to use.
        """
        k = np.asarray(kept, dtype=bool)
        r = np.asarray(rejected, dtype=bool)
        if np.any(k & r):
            raise ValueError("a sample cannot be both kept and rejected")
        self._looks += k
        self._rejected += r
        inc = np.asarray(incidence_deg, dtype=np.float32)
        gsd = np.asarray(gsd_mm, dtype=np.float32)
        np.minimum(self._best_inc, np.where(k, inc, np.float32(np.inf)),
                   out=self._best_inc)
        np.minimum(self._best_gsd, np.where(k, gsd, np.float32(np.inf)),
                   out=self._best_gsd)

    def add_source(
        self,
        kept: np.ndarray,
        rejected: np.ndarray,
        grid,
        C: np.ndarray,
        z_floor: float,
        eq_hw: tuple[int, int],
    ) -> None:
        """add_look with the geometry computed from the pose, rather than
        threaded out of floor_atlas._sample_source, which computes the same
        quantities and discards them.

        Recomputing is the cheaper thing to ASK FOR even though it is the
        more expensive thing to DO, and the margin is measured. Per source on
        a 2750 x 2250 cell grid, look_geometry plus the fold costs 21.2% of
        one _sample_source call against 1024x512 panoramas and 16.8% against
        the 8192x4096 tier that actually ships. But a source is sampled many
        times over a full fusion — pass 1, the leave-one-out reference, up to
        twenty-one alignment rungs, a second pass 1, then pass 2 — so
        end-to-end on the five-scanner fixture in tests/test_floor_atlas.py
        the whole provenance layer costs +4.1% of accumulate_floor_atlas with
        alignment on and +8.7% with it off. That buys a diff into floor_atlas
        that adds arrays and changes no existing return signature.
        """
        inc, gsd = look_geometry(grid, C, z_floor, eq_hw)
        self.add_look(kept, rejected, inc, gsd)

    def finish(self) -> Provenance:
        has = self._looks > 0
        return Provenance(
            looks=self._looks.copy(),
            rejected=self._rejected.copy(),
            best_incidence_deg=np.where(has, self._best_inc, np.float32(np.nan)),
            effective_gsd_mm=np.where(has, self._best_gsd, np.float32(np.nan)),
            observed=(self._looks + self._rejected) > 0,
        )


def confidence(
    prov: Provenance, mm_per_px: float, *, full_looks: int = FULL_LOOKS
) -> np.ndarray:
    """A LOWER BOUND on how much of this cell is actually photographed, in
    [0, 1]; NaN where the cell was never observed.

    Four independent things can each ruin a cell, and none is allowed to
    compensate for another — three enter as multiplied factors, the fourth
    as a ceiling:

      count      looks / full_looks, clipped at 1. Linear and harsh: one
                 look scores 1/7, because a single observation admits no
                 cross-check whatsoever — floor_atlas cannot even arm its
                 robust gate below min_robust_sources.
      sampling   mm_per_px / effective_gsd_mm, clipped at 1. This is the
                 honest reading of "is the atlas resolving or interpolating":
                 at 1 the best look sampled the floor at least as finely as
                 the atlas cell, below 1 the cell is finer than anything that
                 was ever measured into it.
      agreement  1 - rejected / (looks + rejected). Heavy rejection means the
                 sources disagreed about what is on this floor; the gate
                 removed the minority but the disagreement is still evidence
                 of something unmodelled (a moved chair, a person, a mirror).
      incidence  cos(best_incidence_deg), applied as a CAP, not a factor —
                 it is already inside the sampling term via 1/cos, and
                 multiplying it in again would double-count. As a cap it does
                 something the sampling term cannot: it puts a hard ceiling
                 that no look count can buy past, because at grazing angles
                 the planar-floor assumption, the specular model and the
                 occlusion test all degrade in ways that ground sampling does
                 not describe.

    Why a LOWER bound, stated plainly: multi-view super-resolution genuinely
    recovers detail below any single look's sampling — that is what
    floor_atlas exists to do — but the recoverable factor depends on the
    sub-pixel phase diversity of the contributing poses, which is not
    measured here. Crediting it would mean flattering the capture with a
    gain nobody computed. The number is therefore conservative by
    construction, and the direction of the error is documented rather than
    hidden.
    """
    looks = prov.looks.astype(np.float64)
    rejected = prov.rejected.astype(np.float64)
    seen = looks + rejected
    with np.errstate(invalid="ignore", divide="ignore"):
        c_count = np.clip(looks / float(max(int(full_looks), 1)), 0.0, 1.0)
        c_sampling = np.clip(
            float(mm_per_px) / prov.effective_gsd_mm, 0.0, 1.0
        )
        c_agreement = np.where(
            seen > 0, 1.0 - rejected / np.maximum(seen, 1.0), 1.0
        )
        c_incidence = np.clip(
            np.cos(np.radians(prov.best_incidence_deg)), 0.0, 1.0
        )
        conf = np.minimum(c_count * c_sampling * c_agreement, c_incidence)
    # No surviving look => no geometry => the products above are NaN. Such a
    # cell is observed (its samples were all rejected) and its confidence is
    # a measured zero, not a missing value.
    conf = np.where(prov.looks > 0, conf, 0.0)
    return np.where(prov.observed, conf, np.nan)


def confidence_rgba(
    prov: Provenance,
    mm_per_px: float,
    *,
    full_looks: int = FULL_LOOKS,
    max_alpha: int = MAX_ALPHA,
) -> np.ndarray:
    """The overlay, uint8 (h, w, 4), to be drawn OVER the atlas.

    What each channel means, in physical terms:

      A   how much of the atlas this overlay hides = 1 - confidence, scaled
          to MAX_ALPHA. The veil is thickest exactly where the pixels
          underneath are least earned, so a poorly covered floor cannot be
          screenshotted as a finished one. Confidence 1 gives alpha 0: a
          fully-evidenced cell is shown unobstructed, which is the only
          reward this encoding hands out.
      RGB a hazard ramp on the same confidence — saturated red at 0, amber
          at 0.5, pale yellow approaching 1 (where alpha has already gone to
          nothing). Hue is redundant with alpha ON PURPOSE, so the reading
          survives screenshots, colour-blind viewers and a viewer that
          composites the layer opaquely.
      all NO_DATA_RGBA (opaque magenta) where observed is False. Never
          transparent, never on the ramp: "nobody looked here" is a
          different statement from "we looked and learned little", and the
          two must not be able to blend into each other. An observed cell
          can reach alpha MAX_ALPHA (235) but never 255, so the no-data
          flag stays strictly the most opaque thing on screen.
    """
    conf = confidence(prov, mm_per_px, full_looks=full_looks)
    h, w = prov.shape
    out = np.empty((h, w, 4), dtype=np.uint8)
    out[...] = np.array(NO_DATA_RGBA, dtype=np.uint8)
    ok = np.isfinite(conf)
    if not np.any(ok):
        return out
    c = np.clip(np.where(ok, conf, 0.0), 0.0, 1.0)
    t = c * (len(_RAMP) - 1)
    i = np.clip(np.floor(t), 0, len(_RAMP) - 2).astype(np.int64)
    f = (t - i)[..., None]
    rgb = _RAMP[i] * (1.0 - f) + _RAMP[i + 1] * f
    alpha = np.rint(float(max_alpha) * (1.0 - c))[..., None]
    rgba = np.rint(np.concatenate([rgb, alpha], axis=-1))
    out[ok] = np.clip(rgba, 0.0, 255.0)[ok].astype(np.uint8)
    return out


def _stats(values: np.ndarray) -> dict | None:
    """Percentiles, or None. None rather than 0 or NaN because a caller that
    formats a report must be forced to say "not measured" instead of
    printing a number that reads as a result."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return None
    p10, p50, p90 = np.percentile(v, [10.0, 50.0, 90.0])
    return {
        "min": float(v.min()),
        "p10": float(p10),
        "median": float(p50),
        "p90": float(p90),
        "max": float(v.max()),
        "n": int(v.size),
    }


def summarise(
    prov: Provenance,
    mask: np.ndarray | None = None,
    *,
    mm_per_px: float | None = None,
    full_looks: int = FULL_LOOKS,
    block_px: int | None = None,
    n_worst: int = 3,
    grid=None,
) -> dict:
    """Inspectable numbers for one atlas: medians, percentiles, worst regions.

    EVERY PERCENTILE IS TAKEN OVER OBSERVED CELLS ONLY, and this is the
    single most load-bearing line in the function. An atlas is cropped to a
    rectangle, but floor is not rectangular and capture coverage certainly
    is not: a room whose grid is mostly unseen would, with the zeros
    included, report a median look count of 0 and be dismissed — or worse,
    with the zeros in an average, report a mean belonging to no cell that
    exists. The two questions are kept separate and both are returned:
    observed_frac says how much of the crop was photographed at all, and the
    percentiles say how well the photographed part was served.

    WORST REGIONS answer a different question again — "where do we go back
    with the tripod" — so they are scored the other way round: unobserved
    cells count as 0 inside a block rather than being skipped, because a
    block that is half unseen IS a bad block. Blocks are ranked ascending by
    that mean score and the worst n_worst are returned, each with its pixel
    bounds and, if `grid` is supplied, its world-metre bounds.

    `mask` restricts everything to a region of interest (one room out of a
    building-wide atlas, say); observed_frac is then the fraction of the
    MASKED cells that were observed.
    """
    looks = prov.looks
    valid = (
        np.ones(prov.shape, dtype=bool) if mask is None
        else np.asarray(mask, dtype=bool)
    )
    sel = prov.observed & valid
    n_valid = int(valid.sum())
    n_obs = int(sel.sum())
    seen = (prov.looks + prov.rejected).astype(np.float64)

    conf = (
        None if mm_per_px is None
        else confidence(prov, mm_per_px, full_looks=full_looks)
    )
    if conf is None:
        # Without an atlas scale the sampling term cannot be formed, so the
        # region score falls back to count-and-angle only. Named in the
        # output, because that score is a weaker (and more generous) reading
        # than confidence and must not be mistaken for it.
        basis = "count_x_incidence"
        with np.errstate(invalid="ignore"):
            score = np.clip(
                looks.astype(np.float64) / float(max(int(full_looks), 1)),
                0.0, 1.0,
            ) * np.clip(np.cos(np.radians(prov.best_incidence_deg)), 0.0, 1.0)
        score = np.where(prov.looks > 0, score, 0.0)
    else:
        basis = "confidence"
        score = np.where(np.isfinite(conf), conf, 0.0)

    out: dict = {
        "cells": n_valid,
        "observed_px": n_obs,
        "observed_frac": (n_obs / n_valid) if n_valid else 0.0,
        # observed, but every single sample was rejected: the atlas fell back
        # to the plain mean of observations it did not believe.
        "no_surviving_look_px": int((sel & (prov.looks == 0)).sum()),
        "looks": _stats(looks[sel].astype(np.float64)),
        "best_incidence_deg": _stats(prov.best_incidence_deg[sel]),
        "effective_gsd_mm": _stats(prov.effective_gsd_mm[sel]),
        "rejected_frac": (
            float(prov.rejected[sel].sum() / max(seen[sel].sum(), 1.0))
            if n_obs else 0.0
        ),
        "confidence": None if conf is None else _stats(conf[sel]),
        "region_score_basis": basis,
    }

    h, w = prov.shape
    if block_px is None:
        block_px = int(max(8, min(h, w) // 8))
    block_px = int(max(1, min(block_px, h, w)))
    rb = np.arange(0, h, block_px)
    cb = np.arange(0, w, block_px)

    def blocks(a):
        return np.add.reduceat(np.add.reduceat(a, rb, axis=0), cb, axis=1)

    b_n = blocks(valid.astype(np.float64))
    b_obs = blocks(sel.astype(np.float64))
    b_score = blocks(np.where(valid, score, 0.0))
    with np.errstate(invalid="ignore", divide="ignore"):
        b_mean = np.where(b_n > 0, b_score / np.maximum(b_n, 1.0), np.nan)
    order = np.argsort(np.where(np.isfinite(b_mean), b_mean, np.inf), axis=None)
    worst: list[dict] = []
    for flat in order:
        bi, bj = np.unravel_index(flat, b_mean.shape)
        if not np.isfinite(b_mean[bi, bj]):
            continue
        r0, c0 = int(rb[bi]), int(cb[bj])
        r1, c1 = int(min(r0 + block_px, h)), int(min(c0 + block_px, w))
        rec = {
            "row0": r0, "row1": r1, "col0": c0, "col1": c1,
            "score": float(b_mean[bi, bj]),
            "observed_frac": float(b_obs[bi, bj] / max(b_n[bi, bj], 1.0)),
        }
        if grid is not None:
            x0, y0 = grid.atlas_to_world(c0, r0)
            x1, y1 = grid.atlas_to_world(c1 - 1, r1 - 1)
            rec["world_xy0"] = [round(float(x0), 3), round(float(y0), 3)]
            rec["world_xy1"] = [round(float(x1), 3), round(float(y1), 3)]
        worst.append(rec)
        if len(worst) >= int(n_worst):
            break
    out["worst_regions"] = worst
    out["block_px"] = block_px
    return out

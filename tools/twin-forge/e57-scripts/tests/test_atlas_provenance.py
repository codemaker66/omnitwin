"""The provenance layer, stated as tests.

The Floor Atlas already KNOWS how much evidence stood behind every pixel —
it counts looks, it drops outliers, it weights by incidence and distance —
and then it throws nearly all of that away and hands back a picture. A
picture is unfalsifiable: a cell fused from seven head-on looks and a cell
scraped from one grazing look at 78 degrees are the same pixels to the eye.

These tests pin the claims that make an inspectable provenance layer worth
having, and — more importantly — pin the ONE way it can fail badly:

  1. the counts are the accumulator's own, not a re-derivation that drifts
  2. floor nobody saw is FLAGGED, never handed a confidence
  3. a cell whose every sample was rejected is observed but NOT confident
  4. geometry is measured: a grazing region reports worse incidence and
     coarser ground sampling than a head-on one
  5. summary percentiles are taken over OBSERVED cells only — a hectare of
     unseen floor must not drag the median toward "great"
  6. the encoding cannot flatter: one grazing look never outranks seven
     head-on ones, and the overlay is MORE opaque where evidence is thinner

Run: python tests/test_atlas_provenance.py
"""

import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, _HERE)

import atlas_provenance as ap  # noqa: E402
import floor_atlas as fa  # noqa: E402
import test_floor_atlas as tfa  # noqa: E402  (the ONE fixture; do not fork it)

EQ_HW = (tfa.H, tfa.W)          # 512 x 1024 source panoramas
SELF_BLIND_M = 0.80             # accumulate_floor_atlas defaults, verbatim
MAX_INCIDENCE_DEG = 80.0


def _prov_for(grid, panos=None, drop_fn=None):
    """Provenance for a grid, gated by floor_atlas's OWN sampler.

    _sample_source is what decides whether a source contributed, so the
    provenance layer is fed from it rather than from a second copy of the
    gate logic that could quietly disagree with the accumulator it claims to
    describe. drop_fn(index, seen) optionally marks samples as rejected, the
    way pass 2's robust gate does.
    """
    panos = tfa.PANOS if panos is None else panos
    acc = ap.ProvenanceAccumulator(grid.height, grid.width)
    for i, (img, C) in enumerate(panos):
        _rgb, w = fa._sample_source(
            img, C, grid, tfa.Z_FLOOR, SELF_BLIND_M, MAX_INCIDENCE_DEG, None
        )
        seen = w > 0
        dropped = np.zeros_like(seen) if drop_fn is None else (drop_fn(i, seen) & seen)
        acc.add_source(seen & ~dropped, dropped, grid, C, tfa.Z_FLOOR, EQ_HW)
    return acc.finish()


def _synthetic(looks, rejected, incidence_deg, gsd_mm):
    """A Provenance built by hand — for testing the ENCODING in isolation
    from any capture, so a flattering formula cannot hide behind a good
    fixture."""
    looks = np.atleast_2d(np.asarray(looks, dtype=np.int32))
    rejected = np.atleast_2d(np.asarray(rejected, dtype=np.int32))
    inc = np.atleast_2d(np.asarray(incidence_deg, dtype=np.float64))
    gsd = np.atleast_2d(np.asarray(gsd_mm, dtype=np.float64))
    observed = (looks + rejected) > 0
    inc = np.where(looks > 0, inc, np.nan)
    gsd = np.where(looks > 0, gsd, np.nan)
    return ap.Provenance(
        looks=looks, rejected=rejected, best_incidence_deg=inc,
        effective_gsd_mm=gsd, observed=observed,
    )


# --- 1. the counts are the accumulator's own -------------------------------


def test_a_cell_seen_by_five_sources_reports_five_looks():
    # The provenance must agree with the atlas it describes, cell for cell.
    # A count that drifts from accumulate_floor_atlas's is worse than none:
    # it would let the viewer claim evidence the pixels never had.
    prov = _prov_for(tfa.GRID)
    # align=False because this fixture is level — test_floor_atlas's
    # test_a_level_capture_is_left_exactly_alone proves every align_dz is
    # exactly 0.0, so the accumulation geometry is identical either way.
    _atlas, report = fa.accumulate_floor_atlas(
        tfa.PANOS, tfa.GRID, z_floor=tfa.Z_FLOOR, align=False
    )
    counts = report["counts"]
    five = counts == 5
    print(f"  cells seen by all 5 sources: {int(five.sum())}"
          f"  (max looks {int(prov.looks.max())}, "
          f"mismatch vs accumulator: {int((prov.looks != counts).sum())} px)")
    assert five.any(), "fixture no longer has any 5-source cells"
    assert np.array_equal(prov.looks, counts), "provenance drifted from the atlas"
    assert (prov.looks[five] == 5).all()
    assert np.array_equal(prov.observed, counts > 0)


# --- 2. unobserved floor is flagged, never scored --------------------------


def test_unobserved_floor_gets_no_confidence():
    # The Foundry rule, applied to the confidence layer: a cell with no
    # observation must not receive a number that can be read as a good one.
    far = fa.AtlasGrid(origin_xy=(14.0, 14.0), mm_per_px=tfa.MM_PX,
                       width=120, height=120)
    prov = _prov_for(far)
    conf = ap.confidence(prov, far.mm_per_px)
    rgba = ap.confidence_rgba(prov, far.mm_per_px)
    summary = ap.summarise(prov, mm_per_px=far.mm_per_px)
    print(f"  unobserved grid: observed_frac {summary['observed_frac']:.3f}, "
          f"confidence finite in {int(np.isfinite(conf).sum())} px, "
          f"looks summary {summary['looks']}")
    assert not prov.observed.any()
    assert np.isnan(conf).all(), "an unseen cell was handed a confidence"
    assert np.isnan(prov.best_incidence_deg).all()
    assert np.isnan(prov.effective_gsd_mm).all()
    assert summary["looks"] is None, "a statistic was invented from no samples"
    assert (rgba[..., 3] == 255).all(), "no-data must not read as transparent"
    assert np.array_equal(rgba[0, 0], np.array(ap.NO_DATA_RGBA, dtype=np.uint8))


# --- 3. every sample rejected is observed but not confident ----------------


def test_all_samples_rejected_is_observed_but_not_confident():
    # accumulate_floor_atlas falls back to the plain mean when a pixel's
    # every sample was gated out. That pixel HAS pixels, so it looks fine;
    # it is in truth built from observations the atlas itself disbelieved.
    prov = _synthetic(looks=[[0]], rejected=[[5]], incidence_deg=[[10.0]],
                      gsd_mm=[[5.0]])
    conf = ap.confidence(prov, 5.0)
    rgba = ap.confidence_rgba(prov, 5.0)
    print(f"  all-rejected cell: observed={bool(prov.observed[0, 0])} "
          f"conf={float(conf[0, 0]):.3f} alpha={int(rgba[0, 0, 3])} "
          f"(no-data alpha {ap.NO_DATA_RGBA[3]})")
    assert prov.observed[0, 0]
    assert conf[0, 0] == 0.0, "a wholly-rejected cell was given confidence"
    assert np.isnan(prov.best_incidence_deg[0, 0]), (
        "geometry was reported for a look that did not survive"
    )
    assert rgba[0, 0, 3] >= 200, "a wholly-rejected cell was left barely veiled"
    assert not np.array_equal(rgba[0, 0], np.array(ap.NO_DATA_RGBA, dtype=np.uint8)), (
        "observed-but-worthless must stay distinguishable from never-seen"
    )


# --- 4. the geometry is measured, not asserted -----------------------------


def test_grazing_region_reports_worse_incidence_and_gsd_than_head_on():
    # One raster spanning both conditions: floor right under the scanner
    # cluster (head-on, short rays) and floor metres away (grazing, long
    # rays). The layer must be able to tell them apart, in degrees and in
    # millimetres on the ground.
    wide = fa.AtlasGrid(origin_xy=(-1.0, -1.0), mm_per_px=tfa.MM_PX,
                        width=1200, height=400)
    prov = _prov_for(wide)
    cols = np.arange(wide.width)
    xs = wide.origin_xy[0] + (cols + 0.5) * wide.metres_per_px
    head_on = np.broadcast_to((np.abs(xs) < 0.5)[None, :], prov.looks.shape)
    grazing = np.broadcast_to((xs > 4.0)[None, :], prov.looks.shape)

    def med(a, m):
        v = a[m & prov.observed]
        v = v[np.isfinite(v)]
        return float(np.median(v))

    inc_near = med(prov.best_incidence_deg, head_on)
    inc_far = med(prov.best_incidence_deg, grazing)
    gsd_near = med(prov.effective_gsd_mm, head_on)
    gsd_far = med(prov.effective_gsd_mm, grazing)
    c = ap.confidence(prov, wide.mm_per_px)
    conf_near, conf_far = med(c, head_on), med(c, grazing)
    print(f"  head-on {inc_near:.1f} deg / {gsd_near:.1f} mm gsd / conf "
          f"{conf_near:.2f}   grazing {inc_far:.1f} deg / {gsd_far:.1f} mm "
          f"gsd / conf {conf_far:.2f}")
    assert inc_far > inc_near + 20.0, (inc_near, inc_far)
    assert gsd_far > gsd_near * 2.0, (gsd_near, gsd_far)
    assert conf_far < conf_near, (conf_near, conf_far)
    # Cross-check against the fixture's own claim: test_floor_atlas documents
    # these 1024x512 panoramas as "~9-20 mm ground sampling". If the formula
    # here disagreed with that, one of the two would be wrong.
    assert 8.0 < gsd_near < 25.0, gsd_near


def test_ground_sampling_uses_the_coarser_axis_of_the_footprint():
    # An equirect pixel's floor footprint is not square. Straight down it is
    # a long thin radial sliver (the tangential axis collapses at the pole);
    # at grazing the radial axis blows up as 1/cos. Reporting the geometric
    # mean of the two — the tempting "average resolution" — would report
    # roughly 39 mm for a pixel that genuinely cannot resolve better than
    # 61 mm, which is precisely the flattering number this layer exists to
    # refuse. So: the COARSER axis, checked here against a finite-difference
    # derivation that shares no algebra with the implementation.
    g = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=1000.0, width=8, height=1)
    C = np.array([0.5, 0.5, 2.0])           # 2 m above the plane, over cell 0
    inc, gsd = ap.look_geometry(g, C, 0.0, EQ_HW)
    d_el = np.pi / EQ_HW[0]
    d_az = 2.0 * np.pi / EQ_HW[1]
    for j in (0, 1, 4, 7):
        off = float(j)                       # cell centres are 1 m apart
        theta = np.arctan2(off, 2.0)
        # radial: where do the pixel's two bounding rays actually land?
        radial = 2.0 * (np.tan(theta + d_el / 2) - np.tan(theta - d_el / 2))
        # tangential: chord of one azimuth pixel at that radius
        tangential = 2.0 * off * np.sin(d_az / 2)
        want = 1000.0 * max(radial, tangential)
        # 1e-4 deg / 1e-3 relative: these arrays are float32 on purpose (see
        # Provenance), which resolves ~1e-5 deg here — still four orders
        # finer than the 0.06 deg the pose quantisation leaves uncertain.
        assert abs(np.degrees(theta) - inc[0, j]) < 1e-4, j
        assert abs(gsd[0, j] - want) < 1e-3 * want, (j, gsd[0, j], want)
    assert inc.dtype == np.float32 and gsd.dtype == np.float32
    geo_mean = 1000.0 * np.sqrt(
        (np.sqrt(20.0) * d_el / (2.0 / np.sqrt(20.0))) * (4.0 * d_az)
    )
    print(f"  2 m up: nadir {gsd[0, 0]:.2f} mm, 4 m out (inc {inc[0, 4]:.1f} deg) "
          f"{gsd[0, 4]:.2f} mm (geometric mean would say {geo_mean:.2f} mm)")
    assert gsd[0, 4] > geo_mean * 1.4, (gsd[0, 4], geo_mean)


def test_geometry_and_observation_come_from_the_accumulator_not_the_encoding():
    # The rejected-sample cases have to be pinned through the ACCUMULATOR,
    # not through a hand-built Provenance, because the accumulator is where
    # the two rules live that keep a rejected sample from flattering a cell:
    #   observed counts every sample, surviving or not (so a wholly-rejected
    #   cell is not silently demoted to "never seen"), while the geometry
    #   minima count only survivors (so a cell cannot advertise the incidence
    #   of a look the atlas threw away).
    xs, ys = tfa.GRID.pixel_centres_world()
    all_rejected = (np.abs(xs + 0.5) < 0.1) & (np.abs(ys) < 0.1)
    best_rejected = (xs > 0.75) & (np.abs(ys) < 0.25)
    base = _prov_for(tfa.GRID)
    prov = _prov_for(
        tfa.GRID,
        drop_fn=lambda i, seen: all_rejected | (best_rejected if i == 0 else False),
    )
    r, c = (int(v) for v in tfa.GRID.world_to_atlas(0.95, 0.0)[::-1])
    conf = ap.confidence(prov, tfa.GRID.mm_per_px)
    print(f"  all-rejected patch ({int(all_rejected.sum())} px): looks "
          f"{int(prov.looks[all_rejected].max())}, observed "
          f"{bool(prov.observed[all_rejected].all())}, conf "
          f"{float(np.nanmax(conf[all_rejected])):.3f}; dropping the best look "
          f"at (0.95, 0.00) m: {base.best_incidence_deg[r, c]:.1f} -> "
          f"{prov.best_incidence_deg[r, c]:.1f} deg")
    assert base.observed[all_rejected].all(), "fixture patch was never observed"
    # observed counts rejected samples...
    assert prov.observed[all_rejected].all(), "a rejected sample erased the cell"
    assert (prov.looks[all_rejected] == 0).all()
    assert np.array_equal(prov.rejected[all_rejected], base.looks[all_rejected])
    # ...but the geometry does not
    assert np.isnan(prov.best_incidence_deg[all_rejected]).all()
    assert np.isnan(prov.effective_gsd_mm[all_rejected]).all()
    assert (conf[all_rejected] == 0.0).all()
    # and losing the best look must make the reported best look WORSE
    fin = np.isfinite(prov.best_incidence_deg) & np.isfinite(base.best_incidence_deg)
    assert (prov.best_incidence_deg[fin] >= base.best_incidence_deg[fin] - 1e-9).all()
    assert prov.best_incidence_deg[r, c] > base.best_incidence_deg[r, c] + 5.0


# --- 5. the summary is taken over observed cells only ----------------------


def test_summary_percentiles_ignore_unobserved_cells():
    # The failure this exists to prevent: a room where most of the floor was
    # never seen reporting a healthy median because the zeros were counted.
    # A statistic over cells that carry no observation is not a measurement
    # of the capture, it is a measurement of the crop.
    # x runs from -1 m to +30 m while the scanners sit inside |x| < 1.4 m, so
    # most of this raster is past floor_atlas's 80-degree incidence cut and
    # was never observed by anything.
    sparse = fa.AtlasGrid(origin_xy=(-1.0, -1.0), mm_per_px=20.0,
                          width=1550, height=100)
    prov = _prov_for(sparse)
    summary = ap.summarise(prov, mm_per_px=sparse.mm_per_px, grid=sparse)
    naive_median = float(np.median(prov.looks))     # the dishonest version
    print(f"  observed_frac {summary['observed_frac']:.3f}: median looks over "
          f"observed = {summary['looks']['median']:.1f}, over ALL cells = "
          f"{naive_median:.1f}")
    assert 0.05 < summary["observed_frac"] < 0.75, summary["observed_frac"]
    assert naive_median == 0.0, "fixture no longer has a large unobserved area"
    assert summary["looks"]["median"] >= 4.0, summary["looks"]
    assert summary["observed_px"] == int(prov.observed.sum())
    # and the same discipline for the angles
    inc = prov.best_incidence_deg[prov.observed]
    assert abs(summary["best_incidence_deg"]["median"]
               - float(np.median(inc[np.isfinite(inc)]))) < 1e-9
    # worst regions must point at the unseen end of the room, not the middle
    worst = summary["worst_regions"][0]
    print(f"  worst region: cols {worst['col0']}-{worst['col1']} "
          f"(world x {worst['world_xy0'][0]:.1f} m), score {worst['score']:.2f}, "
          f"observed_frac {worst['observed_frac']:.2f}")
    assert all(r["observed_frac"] == 0.0 for r in summary["worst_regions"]), (
        summary["worst_regions"]
    )
    assert worst["score"] == 0.0, worst
    # ...and past the scanner cluster, which sits inside |x| < 1.4 m
    assert worst["world_xy0"][0] > 5.0, worst


# --- 6. the encoding cannot flatter ----------------------------------------


def test_one_grazing_look_never_outranks_seven_head_on_looks():
    # THE HONESTY CONSTRAINT. The whole layer is pointless if thin evidence
    # can be made to look good — and a single near-grazing look is the exact
    # case that flatters, because its ray can be SHORT, so a naive
    # distance-only score would rank it above seven distant head-on looks.
    thin = _synthetic(looks=[[1]], rejected=[[0]], incidence_deg=[[78.0]],
                      gsd_mm=[[26.0]])
    thick = _synthetic(looks=[[7]], rejected=[[0]], incidence_deg=[[12.0]],
                       gsd_mm=[[9.0]])
    c_thin = float(ap.confidence(thin, 8.0)[0, 0])
    c_thick = float(ap.confidence(thick, 8.0)[0, 0])
    a_thin = int(ap.confidence_rgba(thin, 8.0)[0, 0, 3])
    a_thick = int(ap.confidence_rgba(thick, 8.0)[0, 0, 3])
    print(f"  1 look @ 78 deg -> conf {c_thin:.3f} (alpha {a_thin});  "
          f"7 looks @ 12 deg -> conf {c_thick:.3f} (alpha {a_thick})")
    assert c_thin < c_thick / 3.0, (c_thin, c_thick)
    assert a_thin > a_thick + 100, (a_thin, a_thick)


def test_confidence_is_monotone_in_every_axis():
    # Monotonicity is what makes the overlay readable: more looks, more
    # head-on, finer sampling and fewer rejections can only ever help. If
    # any axis is non-monotone the picture is a mood, not a measurement.
    n = [_synthetic([[k]], [[0]], [[20.0]], [[10.0]]) for k in range(1, 9)]
    by_looks = [float(ap.confidence(p, 10.0)[0, 0]) for p in n]
    a = [_synthetic([[4]], [[0]], [[d]], [[10.0]]) for d in (5, 20, 40, 60, 75)]
    by_inc = [float(ap.confidence(p, 10.0)[0, 0]) for p in a]
    g = [_synthetic([[4]], [[0]], [[20.0]], [[s]]) for s in (5, 10, 20, 40, 80)]
    by_gsd = [float(ap.confidence(p, 10.0)[0, 0]) for p in g]
    r = [_synthetic([[4]], [[k]], [[20.0]], [[10.0]]) for k in (0, 2, 4, 8)]
    by_rej = [float(ap.confidence(p, 10.0)[0, 0]) for p in r]
    print(f"  looks {[round(v, 2) for v in by_looks]}  incidence "
          f"{[round(v, 2) for v in by_inc]}  gsd {[round(v, 2) for v in by_gsd]}"
          f"  rejects {[round(v, 2) for v in by_rej]}")
    assert all(b >= a_ for a_, b in zip(by_looks, by_looks[1:])), by_looks
    assert by_looks[-1] > by_looks[0]
    assert all(b <= a_ for a_, b in zip(by_inc, by_inc[1:])), by_inc
    assert by_inc[-1] < by_inc[0]
    assert all(b <= a_ for a_, b in zip(by_gsd, by_gsd[1:])), by_gsd
    assert by_gsd[-1] < by_gsd[0]
    assert all(b <= a_ for a_, b in zip(by_rej, by_rej[1:])), by_rej
    assert by_rej[-1] < by_rej[0]


def test_overlay_veils_thin_evidence_and_flags_no_data():
    # The overlay's alpha channel must OBSCURE the atlas exactly where the
    # atlas cannot be trusted. An overlay that fades out over thin evidence
    # is a decoration that makes a bad capture look finished.
    prov = _synthetic(
        looks=[[0, 1, 3, 7]],
        rejected=[[0, 0, 0, 0]],
        incidence_deg=[[0.0, 20.0, 20.0, 20.0]],
        gsd_mm=[[0.0, 8.0, 8.0, 8.0]],
    )
    rgba = ap.confidence_rgba(prov, 8.0)
    alpha = rgba[0, :, 3].astype(int)
    conf = ap.confidence(prov, 8.0)[0]
    print(f"  looks 0/1/3/7 -> alpha {[int(v) for v in alpha]}  conf "
          f"{[('nan' if not np.isfinite(v) else round(float(v), 2)) for v in conf]}")
    assert alpha[0] == ap.NO_DATA_RGBA[3] == 255
    assert alpha[1] > alpha[2] > alpha[3], alpha
    assert alpha[1] < 255, "observed-but-thin must stay distinct from no-data"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)

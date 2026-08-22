"""The Floor Atlas, as a FILE somebody can measure on.

floor_atlas.py proves the fusion. It leaves the result as a numpy array
inside a Python process, which is worth nothing to the production manager
who has to decide whether a 6 m truss fits between two columns.

These tests pin what has to survive the trip to disk:
  1. the pixel<->world mapping round-trips through the sidecars (a picture
     without a georeference is not a measurement, it is a mood board)
  2. a known 1 m span really is 1000/mm_per_px pixels on the exported file
  3. no-data reads as no-data — never as dark floor (the Foundry rule,
     enforced at the last surface before a human sees it)
  4. the encoder is lossless: what decodes is what was fused
  5. the decoration lives in the margin and cannot touch a data pixel

The fusion fixture is imported from tests/test_floor_atlas.py rather than
re-invented, so "the exported file" means the file the real pipeline makes.

Run: python tests/test_atlas_export.py
"""

import json
import os
import sys
import tempfile
import time

import numpy as np
from PIL import Image

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, _HERE)

import atlas_export as ax  # noqa: E402
import floor_atlas as fa  # noqa: E402
import test_floor_atlas as fx  # noqa: E402  (the fusion fixture, not re-invented)

NICE = (0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0)


def _decode(path):
    """Read a PNG back and CLOSE it. Windows will not delete a temp dir with
    a live handle in it, so a leaked PIL fp reads as a mysterious test
    failure two frames away from its cause."""
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"))


def _size(path):
    with Image.open(path) as im:
        return im.size


def _checker(grid, seed=0):
    """A deterministic stand-in atlas with real fine structure."""
    rng = np.random.default_rng(seed)
    xs, ys = grid.pixel_centres_world()
    base = 120.0 + 40.0 * np.sin(xs * 31.0) * np.cos(ys * 27.0)
    rgb = np.stack([base, base * 0.86, base * 0.62], axis=-1)
    rgb = rgb + rng.normal(0.0, 3.0, size=rgb.shape)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def test_a_known_one_metre_span_is_exactly_the_expected_pixel_count():
    # The whole promise in one assertion: metres in, pixels out, no drift.
    for mm in (2.0, 5.0, 8.0, 12.5):
        g = fa.AtlasGrid(origin_xy=(3.25, -7.5), mm_per_px=mm, width=240, height=160)
        with tempfile.TemporaryDirectory() as d:
            res = ax.write_orthophoto(os.path.join(d, "a.png"), _checker(g), g)
            wf = ax.read_world_file(res["world_file_path"])
            c0, r0 = wf.world_to_pixel(3.30, -7.40)
            c1, _ = wf.world_to_pixel(3.30 + 1.0, -7.40)
            _, r1 = wf.world_to_pixel(3.30, -7.40 + 1.0)
            expect = 1000.0 / mm
            print(f"  {mm:>5} mm/px: 1 m spans {c1 - c0:.9f} px "
                  f"(expected {expect:.9f}); y {r1 - r0:.9f} px")
            assert abs((c1 - c0) - expect) < 1e-9, (mm, c1 - c0, expect)
            assert abs((r1 - r0) - expect) < 1e-9, (mm, r1 - r0, expect)


def test_a_real_fused_atlas_exports_and_still_measures_true():
    # End to end on the pipeline's own fixture: fuse, export, decode, and
    # check the file is still the measurement the array was.
    atlas, report = fa.accumulate_floor_atlas(fx.PANOS, fx.GRID, z_floor=fx.Z_FLOOR)
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(
            os.path.join(d, "grand-hall.png"), atlas, fx.GRID,
            mask=report["observed"],
            provenance={"label": "fixture", "sources": len(fx.PANOS),
                        "covered_frac": report["covered_frac"]},
        )
        plate = _decode(res["image_path"])
        wf = ax.read_world_file(res["world_file_path"])
        L, T = res["margin_px"]["left"], res["margin_px"]["top"]
        crop = plate[T:T + fx.GRID.height, L:L + fx.GRID.width].astype(np.float32)

        truth = fx._truth_raster()
        c_mem = fx._fine_corr(atlas, truth, report["observed"])
        c_file = fx._fine_corr(crop, truth, report["observed"])

        # and the georeference finds the right pixel from world metres alone
        wx, wy = fx.GRID.atlas_to_world(137.0, 208.0)
        col, row = wf.world_to_pixel(wx, wy)
        print(f"  fused->file detail corr {c_mem:.4f} -> {c_file:.4f} "
              f"(delta {abs(c_file - c_mem):.5f}); world({wx:.3f},{wy:.3f}) -> "
              f"image px ({col:.6f},{row:.6f})")
        assert abs(c_file - c_mem) < 0.005, (c_mem, c_file)
        assert abs(col - (137.0 + L)) < 1e-6 and abs(row - (208.0 + T)) < 1e-6


def test_margin_decoration_can_never_touch_a_data_pixel():
    # A scale bar that eats three centimetres of floor is a lie with a ruler
    # drawn on it. The data window must be byte-identical with and without
    # the decoration.
    g = fa.AtlasGrid(origin_xy=(-1.0, 2.0), mm_per_px=6.0, width=300, height=180)
    src = _checker(g, seed=3)
    with tempfile.TemporaryDirectory() as d:
        bare = ax.write_orthophoto(os.path.join(d, "bare.png"), src, g, margin_px=0)
        plate = ax.write_orthophoto(os.path.join(d, "plate.png"), src, g)
        a = _decode(bare["image_path"])
        b = _decode(plate["image_path"])
        L, T = plate["margin_px"]["left"], plate["margin_px"]["top"]
        win = b[T:T + g.height, L:L + g.width]
        diff = int(np.abs(a.astype(np.int32) - win.astype(np.int32)).max())
        print(f"  bare {a.shape[1]}x{a.shape[0]} vs plate {b.shape[1]}x{b.shape[0]}"
              f" (margins L{L} T{T}); max data-window delta {diff}")
        assert a.shape == (g.height, g.width, 3)
        assert diff == 0
        assert b.shape[0] > g.height and b.shape[1] > g.width


def test_no_data_cells_are_a_loud_sentinel_and_never_black():
    # "Is that black carpet or did nobody look?" must never be a question a
    # viewer can ask. Dark floor here is genuinely near-black, so the
    # sentinel has to separate from it by more than a squint.
    # The grid is deliberately taller than atlas_export._HATCH_CHUNK and the
    # hole deliberately straddles a chunk boundary: the sentinel is painted in
    # row blocks to bound memory, and a phase that restarts at each block would
    # produce a visible seam that no coarser assertion would catch.
    g = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=5.0, width=200, height=700)
    dark = np.zeros((g.height, g.width, 3), dtype=np.uint8)
    dark[...] = (6, 5, 4)                      # near-black real floor
    mask = np.ones((g.height, g.width), dtype=bool)
    mask[400:660, 30:150] = False              # a hole nobody saw
    assert 400 < ax._HATCH_CHUNK < 660, "the hole must cross a chunk boundary"
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(os.path.join(d, "n.png"), dark, g, mask=mask,
                                  margin_px=0)
        img = _decode(res["image_path"])
        hole = img[400:660, 30:150].reshape(-1, 3)
        floor = img[:300, :].reshape(-1, 3)

        # The hatch must be ONE continuous 45-degree wave. Verified at a chunk
        # size chosen to be coprime-ish with the hatch period: at the default
        # 512 a phase that restarted per block would be INVISIBLE, because
        # 512 is a whole number of 16-px hatch cycles, so a test at the default
        # proves nothing (confirmed by mutation — resetting the row origin
        # survived a check written at 512).
        rr, cc = np.mgrid[400:660, 30:150]
        want = np.where(((((rr + cc) // ax.HATCH_PERIOD_PX) & 1) == 1)[..., None],
                        np.array(ax.NO_DATA_RGB, dtype=np.uint8),
                        np.array(ax.NO_DATA_ALT, dtype=np.uint8))
        old_chunk = ax._HATCH_CHUNK
        try:
            ax._HATCH_CHUNK = 101           # not a multiple of 2*HATCH_PERIOD_PX
            ax.write_orthophoto(os.path.join(d, "n2.png"), dark, g, mask=mask,
                                margin_px=0)
        finally:
            ax._HATCH_CHUNK = old_chunk
        odd = _decode(os.path.join(d, "n2.png"))[400:660, 30:150]
        for tag, got in (("default chunk", img[400:660, 30:150]),
                         ("chunk=101", odd)):
            seam = int(np.abs(got.astype(np.int32) - want.astype(np.int32)).max())
            assert seam == 0, f"hatch phase breaks at a {tag} boundary ({seam})"
        uniq = {tuple(int(v) for v in c) for c in np.unique(hole, axis=0)}
        sep = float(np.abs(hole.astype(np.float64).mean(axis=0)
                           - floor.astype(np.float64).mean(axis=0)).sum())
        print(f"  hole palette {sorted(uniq)}; mean |sentinel-floor| = {sep:.0f}/765;"
              f" no-data px {res['no_data_px']}")
        assert uniq <= {tuple(ax.NO_DATA_RGB), tuple(ax.NO_DATA_ALT)}
        assert len(uniq) == 2, "the sentinel must carry structure, not just hue"
        assert hole.sum(axis=1).min() > 30, "a sentinel pixel must not read as black"
        assert sep > 200.0
        assert res["no_data_px"] == int((~mask).sum())
        assert abs(res["covered_frac"] - float(mask.mean())) < 1e-12


def test_scale_bar_is_computed_from_mm_per_px_not_hardcoded():
    # A bar is only a measurement if it was derived from the sampling.
    seen = []
    for mm in (2.0, 5.0, 8.0, 20.0, 50.0):
        bar = ax.choose_scale_bar(mm, 1200)
        exact = bar["length_m"] * 1000.0 / mm
        seen.append(bar["length_m"])
        print(f"  {mm:>5} mm/px over 1200 px -> bar {bar['length_m']:g} m "
              f"= {bar['length_px']} px (exact {exact:.3f}, "
              f"error {abs(bar['length_px'] - exact) * mm:.2f} mm)")
        assert bar["length_m"] in NICE
        assert abs(bar["length_px"] - exact) <= 0.5
        assert 0.10 * 1200 <= bar["length_px"] <= 0.45 * 1200
    assert len(set(seen)) > 1, "the bar did not react to mm_per_px at all"
    # Degenerate case: a raster too narrow for even the coarsest tick. The
    # bar must be OMITTED, not run off the edge of the sheet — a reader will
    # measure a truncated bar and never know it was truncated.
    tiny = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=0.5, width=60, height=60)
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(os.path.join(d, "t.png"), _checker(tiny), tiny)
        w_img = _size(res["image_path"])[0]
        print(f"  degenerate {tiny.width}px @ {tiny.mm_per_px} mm/px "
              f"({tiny.width_m * 1000:g} mm wide): bar "
              f"{res['scale_bar']['length_m']:g} m = "
              f"{res['scale_bar']['length_px']} px, drawn_at "
              f"{res['scale_bar']['drawn_at_px']}, plate {w_img} px")
        assert res["scale_bar"]["length_px"] > tiny.width
        assert res["scale_bar"]["drawn_at_px"] is None


def test_sidecars_state_the_grid_and_do_not_overstate_coverage():
    g = fa.AtlasGrid(origin_xy=(8.4, -4.5), mm_per_px=8.0, width=320, height=210)
    mask = np.zeros((g.height, g.width), dtype=bool)
    mask[10:190, 20:300] = True
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(os.path.join(d, "r.png"), _checker(g), g,
                                  mask=mask, provenance={"label": "saloon"})
        with open(res["json_path"], "r", encoding="utf8") as fh:
            side = json.load(fh)
        print(f"  sidecar keys {sorted(side)}; covered {side['covered_frac']:.4f} "
              f"vs mask {mask.mean():.4f}")
        assert side["mm_per_px"] == 8.0
        assert tuple(side["origin_xy"]) == (8.4, -4.5)
        assert side["atlas_size_px"] == [320, 210]
        assert abs(side["covered_frac"] - float(mask.mean())) < 1e-12
        assert side["provenance"]["label"] == "saloon"
        assert side["frame"]["z_up"] is True
        # the sidecar must carry the same six numbers as the .pgw
        wf = ax.read_world_file(res["world_file_path"])
        for k in ("a", "d", "b", "e", "c", "f"):
            assert side["world_file"][k] == getattr(wf, k), k


def test_the_printed_bar_measures_the_length_it_claims():
    # choose_scale_bar() being right is not the same claim as the bar on the
    # page being right — between them sit rounding, rectangle inclusivity and
    # anti-aliasing. This measures the INK, then converts the two endpoints
    # through the world file. If the drawn bar and the georeference ever
    # disagree, the plate is a ruler that lies, which is worse than no ruler.
    for mm, w, h in ((5.0, 900, 500), (8.0, 640, 400), (20.0, 1200, 700)):
        g = fa.AtlasGrid(origin_xy=(2.0, -3.0), mm_per_px=mm, width=w, height=h)
        with tempfile.TemporaryDirectory() as d:
            res = ax.write_orthophoto(os.path.join(d, "b.png"), _checker(g), g)
            img = _decode(res["image_path"])
            wf = ax.read_world_file(res["world_file_path"])
            bar = res["scale_bar"]
            x0, y0 = bar["drawn_at_px"]
            row = img[y0 + bar["height_px"] // 2]
            ink = np.flatnonzero(row.astype(np.int32).sum(axis=1) < 200)
            drawn_px = int(ink.max() - ink.min())
            wa, _ = wf.pixel_to_world(float(ink.min()), 0.0)
            wb, _ = wf.pixel_to_world(float(ink.max()), 0.0)
            print(f"  {mm:>5} mm/px: bar claims {bar['length_m']:g} m / "
                  f"{bar['length_px']} px; ink spans {drawn_px} px = "
                  f"{wb - wa:.6f} m (error {(wb - wa - bar['length_m']) * 1000:+.3f} mm)")
            assert int(ink.min()) == x0
            assert drawn_px == bar["length_px"]
            assert abs((wb - wa) - bar["length_m"]) < g.metres_per_px


def test_the_png_decodes_back_to_the_array_it_was_given():
    g = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=5.0, width=256, height=192)
    src = _checker(g, seed=11)
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(os.path.join(d, "x.png"), src, g, margin_px=0)
        back = _decode(res["image_path"])
        # and a float atlas must round, not truncate or wrap
        f = src.astype(np.float32) + 0.4
        res2 = ax.write_orthophoto(os.path.join(d, "y.png"), f, g, margin_px=0)
        back2 = _decode(res2["image_path"])
        print(f"  uint8 round trip max delta "
              f"{int(np.abs(back.astype(int) - src.astype(int)).max())}; "
              f"float+0.4 max delta "
              f"{int(np.abs(back2.astype(int) - src.astype(int)).max())}; "
              f"{res['bytes'] / 1024:.0f} KiB in {res['encode_seconds'] * 1000:.0f} ms")
        assert np.array_equal(back, src)
        assert np.array_equal(back2, src)


def test_the_world_file_round_trips_the_grid_to_floating_point():
    # ESRI world file, six numbers, the lingua franca of every CAD/GIS tool
    # that will ever open this. If it disagrees with AtlasGrid the file is a
    # picture of a floor, not a plan of one.
    worst = 0.0
    for origin, mm, w, h, margin in [
        ((-2.5, 4.0), 4.0, 300, 200, 0),
        ((8.4, -4.5), 8.0, 220, 140, None),
        ((0.0, 0.0), 2.5, 180, 180, 37),
    ]:
        g = fa.AtlasGrid(origin_xy=origin, mm_per_px=mm, width=w, height=h)
        with tempfile.TemporaryDirectory() as d:
            res = ax.write_orthophoto(os.path.join(d, "w.png"), _checker(g), g,
                                      margin_px=margin)
            wf = ax.read_world_file(res["world_file_path"])
            L, T = res["margin_px"]["left"], res["margin_px"]["top"]
            for col, row in [(0, 0), (1, 0), (0, 1), (w - 1, h - 1), (17.5, 99.25)]:
                ex, ey = g.atlas_to_world(col, row)
                gx, gy = wf.pixel_to_world(col + L, row + T)
                worst = max(worst, abs(gx - ex), abs(gy - ey))
                bc, br = wf.world_to_pixel(ex, ey)
                worst = max(worst, abs(bc - L - col) * g.metres_per_px,
                            abs(br - T - row) * g.metres_per_px)
            # the serialisation itself must be lossless, not merely close
            assert wf.a == g.metres_per_px and wf.e == g.metres_per_px
            assert wf.b == 0.0 and wf.d == 0.0
            assert wf.c == origin[0] + (0.5 - L) * g.metres_per_px
            assert wf.f == origin[1] + (0.5 - T) * g.metres_per_px
    print(f"  worst world-file residual over 3 grids: {worst * 1e9:.6f} nm"
          f"  ({worst:.3e} m)")
    assert worst < 1e-9, worst


def test_dpi_hint_records_a_real_plan_scale():
    g = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=5.0, width=200, height=200)
    with tempfile.TemporaryDirectory() as d:
        res = ax.write_orthophoto(os.path.join(d, "p.png"), _checker(g), g,
                                  dpi_hint=300)
        with Image.open(res["image_path"]) as _im:
            got = _im.info.get("dpi")
        print(f"  requested 300 dpi -> stored {got}; plan scale 1:"
              f"{res['plan_scale']:.1f}; paper {res['paper_size_mm'][0]:.0f} x "
              f"{res['paper_size_mm'][1]:.0f} mm")
        assert got is not None and abs(float(got[0]) - 300.0) < 0.5
        assert abs(res["plan_scale"] - 5.0 * 300.0 / 25.4) < 1e-9
        # with no hint the file declares its own TRUE 1:1 metric density
        res0 = ax.write_orthophoto(os.path.join(d, "q.png"), _checker(g), g)
        assert abs(res0["plan_scale"] - 1.0) < 1e-9


def test_zz_room_scale_export_is_practical():
    # 21 m x 10 m (the Grand Hall) at 5 mm/px. Measured, not guessed.
    g = fa.AtlasGrid(origin_xy=(0.0, 0.0), mm_per_px=5.0,
                     width=int(21.0 * 1000 / 5), height=int(10.0 * 1000 / 5))
    xs, ys = g.pixel_centres_world()
    rng = np.random.default_rng(7)
    src = fx.true_floor(xs, ys)
    src = np.clip(src + rng.normal(0.0, 2.5, size=src.shape), 0, 255).astype(np.uint8)
    mask = np.ones((g.height, g.width), dtype=bool)
    mask[600:1100, 3400:3900] = False
    with tempfile.TemporaryDirectory() as d:
        t0 = time.perf_counter()
        res = ax.write_orthophoto(os.path.join(d, "grand-hall.png"), src, g,
                                  mask=mask, provenance={"label": "grand-hall"})
        wall = time.perf_counter() - t0
        mb = res["bytes"] / 1e6
        px = g.width * g.height
        print(f"  {g.width}x{g.height} px ({px / 1e6:.1f} Mpx, "
              f"{g.width_m:g} x {g.height_m:g} m @ {g.mm_per_px:g} mm/px) -> "
              f"{mb:.1f} MB, encode {res['encode_seconds']:.2f} s, "
              f"total {wall:.2f} s")
        assert res["bytes"] > 0
        assert res["encode_seconds"] < 120.0
        assert _size(res["image_path"]) == (
            g.width + res["margin_px"]["left"] + res["margin_px"]["right"],
            g.height + res["margin_px"]["top"] + res["margin_px"]["bottom"])


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

"""The Floor Atlas as a DELIVERABLE — a to-scale photograph of the real
floor that an AV/staging team can open, print and measure on.

floor_atlas.py proves the fusion; it hands back a numpy array. That array is
worth nothing to the production manager deciding whether a 6 m truss clears
two columns. This module is the last twenty metres: raster to file, with the
metric contract intact at the other end.

WHAT MAKES THIS DIFFERENT FROM SAVING A PNG
A picture of a floor is a mood board. A *measurement* of a floor needs three
things a bare PNG cannot carry:

  1. A GEOREFERENCE. Every pixel must be convertible back to world metres by
     someone who has never met this codebase. Two sidecars carry it: a .json
     for humans and our own tooling, and a plain ESRI .pgw world file, which
     is the one format every CAD/GIS package on earth reads without being
     asked. Six numbers, no library, no schema negotiation. `read_world_file`
     reads it back and `tests/test_atlas_export.py` pins the round trip
     against AtlasGrid.atlas_to_world to under a nanometre.

  2. A PRINTED SCALE. A photograph with no scale bar is a picture again the
     moment it is screenshotted into a WhatsApp thread — which is what
     actually happens to these files. The bar is COMPUTED from mm_per_px,
     snapped to a 1-2-5 series, and its exact drawn length is reported, so a
     ruler on paper and the world file cannot disagree. Graticule ticks in
     the margin, labelled in world metres, let someone read a coordinate off
     the edge of a print with no software at all.

  3. AN HONEST NO-DATA CHANNEL. See NO_DATA_RGB below.

THE MARGIN NEVER TOUCHES THE DATA. Every mark this module makes — bar, ticks,
axis rose, provenance block — is drawn strictly outside the raster window, and
a test compares the data window byte-for-byte against the undecorated export.
A scale bar that eats three centimetres of floor is a lie with a ruler drawn
on it. The world file accounts for the margin offset, so the decorated plate
is still the georeferenced product: one file, not two that can drift apart.

WHAT THIS IS NOT: survey truth. It is planning-grade, like the rest of the
twin's disclosure, and the plate says so in print.

MEASURED COST, AND WHERE PNG STOPS BEING THE ANSWER
All figures below were run on this host (Windows 11, Python 3.13.6, Pillow
12.0.0, numpy 2.4.2) on a floor raster carrying realistic sensor noise. They
are quoted so nobody has to guess whether a tier is shippable:

    room, sampling            raster        file    encode   decode
    21x10 m @ 8 mm/px      2625x1250     7.4 MB    0.38 s   0.05 s
    21x10 m @ 5 mm/px      4200x2000    18.3 MB    1.03 s   0.11 s
    21x10 m @ 2 mm/px     10500x5000    99.2 MB    5.67 s   1.84 s
    60x40 m @ 5 mm/px     12000x8000   234.0 MB   11.60 s   1.43 s

A ROOM IS COMFORTABLY PRACTICAL AND NEEDS NO TILING. The Grand Hall at
5 mm/px — the tier this pipeline actually fuses at — is an 18 MB file written
in about a second, which emails, prints and opens anywhere.

A WHOLE STOREY IS NOT, AND TILING IS THE ANSWER THERE. Three separate walls
arrive at once above ~50 Mpx, and only the first is about patience:
  * SIZE: 234 MB for one storey. PNG is lossless and floor grain is noise-like,
    so it does not compress — the noiseless version of the same 8.4 Mpx raster
    is 3.7 MB against 18.3 MB with 2.5 LSB of noise. The grain IS the product,
    so this is not a knob that can be turned down.
  * DECODERS REFUSE. Pillow's own guard, Image.MAX_IMAGE_PIXELS, is 89,478,485
    px; the 12400x8800 plate above (109.1 Mpx) trips DecompressionBombWarning
    on read, and at twice the limit Pillow raises rather than warns. A file our
    own tooling has to be talked into opening is not a deliverable.
  * MEMORY. Peak working set for that export measured 1474 MB, against 419 MB
    for the caller merely holding the atlas — the export roughly triples it
    (quantised copy, plate canvas, encoder buffer).
So: export PER ROOM, which is what floor_atlas_build.py already builds, and
give each room its own world file. Room-sized tiles are the natural unit
anyway — a staging team wants the Saloon, not the building.

compress_level is left at Pillow's default 6 on purpose: measured on the
8.4 Mpx raster, level 1 gives 26.0 MB in 0.70 s and level 9 gives 18.4 MB in
1.42 s against level 6's 18.3 MB in 1.06 s. Level 9 is both SLOWER and very
slightly LARGER here, so there is no knob worth exposing.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# --- the no-data encoding, and why it is this one ---------------------------
#
# THE FAILURE BEING PREVENTED: a viewer looks at a dark region and cannot tell
# whether it is black carpet or floor nobody photographed. That single
# ambiguity converts the Foundry rule ("never turn missing observations into
# captured fact") into a lie at the last surface before a human, after
# floor_atlas.py went to real trouble to keep `observed` honest all the way
# down the pipeline.
#
# The encoding is a 45-degree hatch alternating a saturated magenta with a
# deep plum, and it is loud on purpose. Three independent channels carry the
# signal, because each one survives a different form of abuse:
#   * HUE — no architectural floor finish is magenta, and magenta is the
#     graphics industry's own "missing texture" convention, so it reads as
#     absence to anyone who has ever seen a broken material.
#   * LUMINANCE — the pair straddles the floor's tonal range (relative
#     luminance ~0.29 and ~0.03), so the region stays obviously non-uniform in
#     greyscale, on a monochrome plot, and under any colour-vision deficiency.
#   * STRUCTURE — a periodic 45-degree square wave is something a photograph
#     of a floor cannot produce. This is the channel that survives being
#     screenshotted, JPEG'd, printed and photographed off a wall, which is the
#     real life of these plates.
# The hatch phase is computed in ATLAS pixel indices, not plate indices, so it
# is anchored to the world grid and does not shift when the margin changes.
#
# ALPHA WAS CONSIDERED AND REJECTED. Writing no-data as transparent is the
# tidy GIS answer, but a transparent pixel renders as whatever the viewer's
# background happens to be — which in every dark-themed viewer is black. That
# is precisely the black-carpet confusion being prevented. Opaque and loud
# beats correct-and-invisible. Callers who need a true GIS nodata channel
# should read `mask` from the .json sidecar, which is exact.
#
# NOTHING IS FILLED IN. This marks absence; it never invents floor.
NO_DATA_RGB = (255, 0, 214)
NO_DATA_ALT = (58, 0, 48)
HATCH_PERIOD_PX = 8

# 1-2-5 series: the only bar lengths a human reads without arithmetic.
NICE_M = (0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0)

PAPER_RGB = (244, 242, 238)
INK_RGB = (26, 26, 26)
RULE_RGB = (150, 148, 143)

_DISCLOSURE = "planning-grade orthophoto — not survey truth"


# --- world file ------------------------------------------------------------


@dataclass(frozen=True)
class WorldFile:
    """The six numbers of an ESRI world file, in FILE order.

    The affine is  world_x = a*col + b*row + c ,  world_y = d*col + e*row + f
    where (col, row) index the IMAGE as written — margin included — and c/f
    are the world coordinates of the CENTRE of image pixel (0, 0), not its
    corner. That half-pixel is the single most common way a georeference goes
    quietly wrong by half a cell, so it is stated here rather than assumed.

    Note `e` is POSITIVE, which is unusual and deliberate: AtlasGrid rows
    advance +y (see floor_atlas.AtlasGrid), so world +y runs DOWN the image.
    Flipping the raster to make it "north-up" would break the promise that the
    file decodes back to the array it was given, so the raster is left alone
    and the axis rose is drawn pointing the way the data actually runs.
    """

    a: float
    d: float
    b: float
    e: float
    c: float
    f: float

    def pixel_to_world(self, col: float, row: float) -> tuple[float, float]:
        return (self.a * col + self.b * row + self.c,
                self.d * col + self.e * row + self.f)

    def world_to_pixel(self, wx: float, wy: float) -> tuple[float, float]:
        det = self.a * self.e - self.b * self.d
        if abs(det) < 1e-30:
            raise ValueError("degenerate world file (zero determinant)")
        dx, dy = wx - self.c, wy - self.f
        return ((self.e * dx - self.b * dy) / det,
                (-self.d * dx + self.a * dy) / det)

    def as_dict(self) -> dict:
        return {k: float(getattr(self, k)) for k in ("a", "d", "b", "e", "c", "f")}


def _fmt(v: float) -> str:
    """Shortest text that reads back as the SAME float.

    repr() is used rather than a fixed %.6f because a world file rounded to six
    decimals is only good to a micrometre, and the whole point of this file is
    that the round trip is exact rather than approximately fine.
    """
    return repr(float(v))


def read_world_file(path: str) -> WorldFile:
    """Parse an ESRI world file (.pgw/.jgw/.tfw). Six numbers, one per line."""
    with open(path, "r", encoding="utf8") as fh:
        vals = [float(ln) for ln in fh.read().split() if ln.strip()]
    if len(vals) != 6:
        raise ValueError(f"{path}: expected 6 numbers, got {len(vals)}")
    return WorldFile(*vals)


def world_file_for(grid, left: int = 0, top: int = 0) -> WorldFile:
    """The affine for a plate whose raster sits `left`/`top` pixels in."""
    s = grid.metres_per_px
    return WorldFile(
        a=s, d=0.0, b=0.0, e=s,
        c=grid.origin_xy[0] + (0.5 - left) * s,
        f=grid.origin_xy[1] + (0.5 - top) * s,
    )


def write_world_file(path: str, wf: WorldFile) -> str:
    with open(path, "w", encoding="utf8", newline="\n") as fh:
        for k in ("a", "d", "b", "e", "c", "f"):
            fh.write(_fmt(getattr(wf, k)) + "\n")
    return path


# --- scale bar -------------------------------------------------------------


def choose_scale_bar(mm_per_px: float, span_px: int,
                     target_frac: float = 0.22) -> dict:
    """Pick a printed bar length from the SAMPLING, never from a constant.

    A bar is only a measurement if it was derived from mm_per_px; a hardcoded
    "5 m" bar is decoration that happens to be wrong at every other zoom. The
    length is snapped to the 1-2-5 series so a human reads it without
    arithmetic, kept between 10% and 45% of the span so it is neither a stub
    nor the whole plate, and the drawn PIXEL length is reported alongside so
    the caller can see the rounding it will actually print.
    """
    if mm_per_px <= 0 or span_px <= 0:
        raise ValueError("mm_per_px and span_px must be positive")
    px_per_m = 1000.0 / float(mm_per_px)
    lo, hi = 0.10 * span_px, 0.45 * span_px
    target = target_frac * span_px
    cands = [v for v in NICE_M if lo <= v * px_per_m <= hi]
    if not cands:
        # No nice value fits the window; take the closest and let the clamp
        # show in the reported pixel length rather than inventing a length.
        cands = [min(NICE_M, key=lambda v: abs(v * px_per_m - target))]
    length_m = min(cands, key=lambda v: abs(v * px_per_m - target))
    # 2 m reads best as four 0.5 m ticks; everything else as five.
    divisions = 4 if f"{length_m:g}".lstrip("0.").startswith("2") else 5
    return {
        "length_m": float(length_m),
        "length_px": int(round(length_m * px_per_m)),
        "divisions": divisions,
        "mm_per_px": float(mm_per_px),
    }


# --- plate assembly --------------------------------------------------------


def _to_uint8(atlas: np.ndarray) -> np.ndarray:
    """Quantise once, explicitly. Rounds (banker's, via np.rint) rather than
    truncating: truncation costs half a level of brightness everywhere and
    would make the "decodes back to what it was given" test a lie for any
    float atlas."""
    a = np.asarray(atlas)
    if a.ndim != 3 or a.shape[2] != 3:
        raise ValueError(f"atlas must be HxWx3, got {a.shape}")
    if a.dtype == np.uint8:
        return a.copy()
    return np.clip(np.rint(a.astype(np.float64)), 0.0, 255.0).astype(np.uint8)


_HATCH_CHUNK = 512


def _mark_no_data(rgb: np.ndarray, keep: np.ndarray) -> None:
    """Paint the no-data sentinel over every cell `keep` says is not real.

    The 45-degree square wave is phased on ATLAS pixel indices, so the hatch is
    anchored to the world grid rather than to the plate, and does not shift
    when the margin changes.

    Done in row blocks because the obvious one-liner materialises a full-size
    int32 index array — 384 MB on a 96 Mpx building-scale atlas, allocated
    purely to decide the colour of some decoration, on top of the ~940 MB the
    export already needs. Chunking bounds that temporary to ~24 MB at any
    raster size, and costs nothing measurable.
    """
    h, w = rgb.shape[:2]
    cols = np.arange(w, dtype=np.int32)
    for y0 in range(0, h, _HATCH_CHUNK):
        y1 = min(y0 + _HATCH_CHUNK, h)
        sub = ~keep[y0:y1]
        if not sub.any():
            continue
        rows = np.arange(y0, y1, dtype=np.int32)[:, None]
        hatch = (((rows + cols[None, :]) // HATCH_PERIOD_PX) & 1).astype(bool)
        block = rgb[y0:y1]
        block[sub & hatch] = NO_DATA_RGB
        block[sub & ~hatch] = NO_DATA_ALT


def _resolve_margin(w: int, h: int, margin_px) -> dict:
    if margin_px is not None and int(margin_px) <= 0:
        return {"left": 0, "top": 0, "right": 0, "bottom": 0}
    if margin_px is None:
        m = int(max(56, min(round(0.05 * min(w, h)), 200)))
    else:
        m = int(margin_px)
    # The bottom carries the bar, the provenance block and the axis rose, so
    # it is the only asymmetric edge. Everything else is a quiet frame. The
    # 3.0 factor is what the four provenance lines actually need at the
    # smallest permitted margin — measured by rendering, not guessed.
    return {"left": m, "top": m, "right": m, "bottom": int(round(m * 3.0))}


def _font(size: int):
    try:
        return ImageFont.load_default(size=max(6, int(size)))
    except TypeError:      # Pillow < 10.1: unsized bitmap default
        return ImageFont.load_default()


_TRANSLIT = {0x2014: "-", 0x2013: "-", 0x2012: "-", 0x2010: "-", 0x00b7: "|",
             0x2022: "|", 0x00d7: "x", 0x00b0: "deg", 0x2019: "'", 0x201c: '"',
             0x201d: '"', 0x2026: "..."}


def _ascii(s: str) -> str:
    """Every drawn glyph must be printable ASCII.

    Learned the hard way by LOOKING at the first plate: the em-dash came out
    as a tofu box, because the font Pillow supplies is not guaranteed to carry
    anything outside ASCII and silently substitutes .notdef. A missing glyph in
    a client deliverable is not a typographic quibble — it is the one visual
    detail that says "generated, unchecked". Typographic characters are
    transliterated rather than dropped, then anything still outside the
    printable range is removed, so the plate is legible on whatever font the
    host happens to have.
    """
    out = "".join(_TRANSLIT.get(ord(ch), ch) for ch in str(s))
    return "".join(ch for ch in out if 0x20 <= ord(ch) <= 0x7e)


def _fits(font, s: str, limit: float) -> str:
    """Truncate to a pixel budget so a long label can never run under the
    axis rose or off the plate."""
    try:
        if font.getlength(s) <= limit:
            return s
        while s and font.getlength(s + "...") > limit:
            s = s[:-1]
        return s + "..."
    except AttributeError:                 # bitmap font: no metrics
        return s


def _text(d, xy, s, font, fill=INK_RGB, anchor="la", limit=None) -> None:
    s = _ascii(s)
    if limit is not None:
        s = _fits(font, s, limit)
    try:
        d.text(xy, s, font=font, fill=fill, anchor=anchor)
    except (ValueError, TypeError):        # bitmap fonts reject anchors
        d.text(xy, s, font=font, fill=fill)


def _tick_interval(grid, bar_m: float, max_ticks: int = 12) -> float:
    span = max(grid.width_m, grid.height_m)
    for v in NICE_M:
        if v >= bar_m and span / v <= max_ticks:
            return v
    return max(NICE_M[-1], bar_m)


def _draw_graticule(d, grid, L: int, T: int, interval: float, base: int) -> None:
    """World-metre ticks in the top and left margins.

    This is the part that works with no software at all: someone with a
    printout and a straightedge can read a world coordinate off the edge.
    """
    s = grid.metres_per_px
    ox, oy = grid.origin_xy
    tick = max(4, base // 2)
    fnt = _font(max(7, int(base * 0.8)))
    start = np.ceil(ox / interval) * interval
    x = start
    while x <= ox + grid.width_m + 1e-9:
        col = L + (x - ox) / s
        if L - 1 <= col <= L + grid.width:
            d.line([(col, T - 2 - tick), (col, T - 2)], fill=RULE_RGB, width=1)
            _text(d, (col, T - 4 - tick), f"{x:g}", fnt, INK_RGB, anchor="mb")
        x += interval
    start = np.ceil(oy / interval) * interval
    y = start
    while y <= oy + grid.height_m + 1e-9:
        row = T + (y - oy) / s
        if T - 1 <= row <= T + grid.height:
            d.line([(L - 2 - tick, row), (L - 2, row)], fill=RULE_RGB, width=1)
            _text(d, (max(2, L - 4 - tick), row), f"{y:g}", fnt, INK_RGB,
                  anchor="rm")
        y += interval


def _draw_scale_bar(d, bar: dict, x0: int, y0: int, bar_h: int, base: int,
                    caption: str, limit: float) -> int:
    """Draw the bar and its caption; return the y below everything drawn."""
    n, px = bar["divisions"], bar["length_px"]
    for i in range(n):
        xa = x0 + round(i * px / n)
        xb = x0 + round((i + 1) * px / n)
        d.rectangle([xa, y0, xb, y0 + bar_h],
                    fill=INK_RGB if i % 2 == 0 else PAPER_RGB, outline=INK_RGB)
    fnt = _font(base)
    ly = y0 + bar_h + max(2, base // 4)
    # Labelled at true halves, not at division indices: a 1 m bar drawn in
    # five parts has its midpoint at 0.5 m, and printing "0.4" there because
    # floor(5/2) == 2 is the kind of small wrongness that costs a reader all
    # their trust in the rest of the sheet.
    for frac in (0.0, 0.5, 1.0):
        val = bar["length_m"] * frac
        # The unit rides on the end label rather than sitting beside the bar,
        # so that NOTHING is drawn on the bar's own rows except the bar. That
        # keeps the printed bar machine-measurable — which is what
        # test_the_printed_bar_measures_the_length_it_claims checks, and it is
        # the only check that closes the loop from computed to PRINTED.
        _text(d, (x0 + round(frac * px), ly),
              f"{val:g} m" if frac == 1.0 else f"{val:g}", fnt, INK_RGB,
              anchor="ma")
    cy = ly + int(base * 1.5)
    _text(d, (x0, cy), caption, fnt, INK_RGB, limit=limit)
    return cy + int(base * 1.5)


def _draw_axis_rose(d, cx: int, cy: int, r: int, base: int,
                    north_deg: float | None) -> None:
    """+X and +Y as the RASTER actually runs, not as a plan usually reads.

    Rows advance +y, so world +y points DOWN the page. Drawing a conventional
    north-up rose here would be a 180-degree lie about the data, so the rose
    tells the truth and says which frame it is in. A surveyed bearing, if the
    caller has one, is drawn as a separate N arrow — never inferred.
    """
    fnt = _font(max(7, int(base * 0.85)))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RULE_RGB, width=1)

    def arrow(dx, dy, label, colour, frac=1.0):
        ex, ey = cx + dx * r * frac, cy + dy * r * frac
        d.line([(cx, cy), (ex, ey)], fill=colour, width=max(1, r // 12))
        hx, hy = -dy, dx
        hs = max(3, r // 6)
        d.polygon([(ex, ey),
                   (ex - dx * hs * 2 + hx * hs, ey - dy * hs * 2 + hy * hs),
                   (ex - dx * hs * 2 - hx * hs, ey - dy * hs * 2 - hy * hs)],
                  fill=colour)
        lr = r * frac + hs + max(4, r // 6)
        _text(d, (cx + dx * lr, cy + dy * lr), label, fnt, colour, anchor="mm")

    arrow(1.0, 0.0, "+X", INK_RGB)
    arrow(0.0, 1.0, "+Y", INK_RGB)
    if north_deg is not None:
        th = np.radians(float(north_deg))
        arrow(float(np.cos(th)), float(np.sin(th)), "N", (170, 40, 20), 0.62)


def write_orthophoto(path: str, atlas: np.ndarray, grid, *, mask=None,
                     provenance: dict | None = None, dpi_hint=None,
                     margin_px=None) -> dict:
    """Write the atlas as a measurable, printable file. Returns a report.

    path        .png to write; the .pgw and .json sidecars take its stem.
    atlas       HxWx3, uint8 or float in 0..255, matching `grid`.
    mask        bool HxW, True where the pixel carries REAL observed floor.
                Pass report["observed"] at minimum; AND it with a floor
                polygon to trim to the room. Everything False is marked as
                no-data (see NO_DATA_RGB) and never filled in.
    provenance  free-form dict, copied verbatim into the .json and summarised
                on the plate. Recognised keys: label, sources, capture,
                z_floor, north_deg (bearing of plan north, degrees CCW from
                world +X — supplied only, never inferred).
    dpi_hint    print resolution to stamp into the PNG. Omit and the file
                declares its TRUE 1:1 metric density instead (pixels-per-metre
                = 1000/mm_per_px), i.e. it is self-describing at full scale.
    margin_px   0 for a bare raster (no decoration at all), None for an
                automatic margin, or an explicit width in pixels.
    """
    rgb = _to_uint8(atlas)
    h, w = rgb.shape[:2]
    if (h, w) != (grid.height, grid.width):
        raise ValueError(
            f"atlas {w}x{h} does not match grid {grid.width}x{grid.height}")

    no_data = 0
    covered = 1.0
    if mask is not None:
        m = np.asarray(mask, dtype=bool)
        if m.shape != (h, w):
            raise ValueError(f"mask {m.shape} does not match atlas {(h, w)}")
        covered = float(m.mean())
        no_data = int((~m).sum())
        if no_data:
            _mark_no_data(rgb, m)

    mg = _resolve_margin(w, h, margin_px)
    L, T, R, B = mg["left"], mg["top"], mg["right"], mg["bottom"]
    W, H = w + L + R, h + T + B

    plate = np.empty((H, W, 3), dtype=np.uint8)
    plate[...] = np.array(PAPER_RGB, dtype=np.uint8)
    plate[T:T + h, L:L + w] = rgb
    img = Image.fromarray(plate, mode="RGB")

    prov = dict(provenance or {})
    bar = choose_scale_bar(grid.mm_per_px, w)
    bar["drawn_at_px"] = None
    bar["height_px"] = 0
    eff_dpi = float(dpi_hint) if dpi_hint else 25.4 / float(grid.mm_per_px)
    plan_scale = float(grid.mm_per_px) * eff_dpi / 25.4

    if L and T:
        base = max(9, int(round(L * 0.22)))
        d = ImageDraw.Draw(img)
        # frame drawn on the pixels JUST OUTSIDE the data window
        d.rectangle([L - 1, T - 1, L + w, T + h], outline=RULE_RGB, width=1)
        _draw_graticule(d, grid, L, T, _tick_interval(grid, bar["length_m"]),
                        base)

        # The rose owns the right end of the bottom block; every text line is
        # clipped to what is left, so nothing can ever print underneath it.
        r = int(max(10, min(0.30 * B, 0.9 * L)))
        rose_cx = W - R - r - 4
        text_limit = max(80.0, rose_cx - r - base * 2 - L)

        y_bar = T + h + int(0.13 * B)
        bar_h = max(6, int(0.075 * B))
        scale_note = (f"1:{plan_scale:.0f} at {eff_dpi:g} dpi" if dpi_hint
                      else f"1:1 at full size ({1000.0 / grid.mm_per_px:g} px/m)")
        if bar["length_px"] <= w:
            bar["drawn_at_px"] = [int(L), int(y_bar)]
            bar["height_px"] = int(bar_h)
            cap = (f"scale bar {bar['length_m']:g} m = {bar['length_px']} px  |  "
                   f"1 px = {grid.mm_per_px:g} mm  |  {scale_note}")
            y = _draw_scale_bar(d, bar, L, y_bar, bar_h, base, cap, text_limit)
        else:
            # No 1-2-5 length fits inside the raster, which means the atlas is
            # narrower than the coarsest sensible tick. Print the sampling and
            # omit the bar rather than run one off the edge of the plate: a bar
            # that leaves the sheet is worse than no bar, because a reader will
            # still measure it.
            y = y_bar
            _text(d, (L, y), f"1 px = {grid.mm_per_px:g} mm  |  {scale_note}  |  "
                             f"scale bar omitted (raster narrower than "
                             f"{bar['length_m']:g} m)",
                  _font(base), INK_RGB, limit=text_limit)
            y += int(base * 1.7)

        lines = [
            f"{prov.get('label', 'floor atlas')}  |  "
            f"{grid.width_m:.4g} x {grid.height_m:.4g} m  |  "
            f"{grid.width} x {grid.height} px @ {grid.mm_per_px:g} mm/px"
            + (f"  |  captured {prov['capture']}" if "capture" in prov else ""),
            f"origin (world x, y) = ({grid.origin_xy[0]:.4f}, "
            f"{grid.origin_xy[1]:.4f}) m  |  E57 frame, Z-up"
            + (f"  |  z_floor {float(prov['z_floor']):.4f} m"
               if "z_floor" in prov else ""),
            f"observed floor {covered * 100:.1f}%"
            + (f" from {prov['sources']} sweeps" if "sources" in prov else "")
            + "  |  hatched magenta = NO DATA, not dark floor",
            _DISCLOSURE,
        ]
        for ln in lines:
            if y + base > H - 4:
                break
            _text(d, (L, y), ln, _font(base), INK_RGB, limit=text_limit)
            y += int(base * 1.45)

        _draw_axis_rose(d, rose_cx, T + h + B // 2, r, base,
                        prov.get("north_deg"))

    stem = os.path.splitext(path)[0]
    pgw_path, json_path = stem + ".pgw", stem + ".json"
    wf = world_file_for(grid, L, T)

    ppm = max(1, int(round(1000.0 / float(grid.mm_per_px)))) if not dpi_hint \
        else None
    save_dpi = (float(dpi_hint), float(dpi_hint)) if dpi_hint \
        else (ppm * 0.0254, ppm * 0.0254)
    t0 = time.perf_counter()
    img.save(path, format="PNG", dpi=save_dpi)
    encode_s = time.perf_counter() - t0

    write_world_file(pgw_path, wf)
    report = {
        "image_path": path,
        "world_file_path": pgw_path,
        "json_path": json_path,
        "atlas_size_px": [int(grid.width), int(grid.height)],
        "image_size_px": [int(W), int(H)],
        "margin_px": dict(mg),
        "mm_per_px": float(grid.mm_per_px),
        "origin_xy": [float(grid.origin_xy[0]), float(grid.origin_xy[1])],
        "extent_m": [float(grid.width_m), float(grid.height_m)],
        "covered_frac": covered,
        "no_data_px": no_data,
        "sentinel_rgb": list(NO_DATA_RGB),
        "sentinel_alt_rgb": list(NO_DATA_ALT),
        "hatch_period_px": HATCH_PERIOD_PX,
        "scale_bar": bar,
        "dpi": eff_dpi,
        "plan_scale": plan_scale,
        "paper_size_mm": [W * 25.4 / eff_dpi, H * 25.4 / eff_dpi],
        "frame": {
            "units": "metre",
            "z_up": True,
            "col_axis": "+x",
            "row_axis": "+y (world +y runs DOWN the image)",
            "north": ("supplied: %.3f deg CCW from world +X" % prov["north_deg"]
                      if prov.get("north_deg") is not None
                      else "not surveyed; grid axes only"),
        },
        "world_file": wf.as_dict(),
        "provenance": prov,
        "disclosure": _DISCLOSURE,
        "written_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bytes": os.path.getsize(path),
        "encode_seconds": encode_s,
    }
    with open(json_path, "w", encoding="utf8") as fh:
        json.dump(report, fh, indent=2)
    return report

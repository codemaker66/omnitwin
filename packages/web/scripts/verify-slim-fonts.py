#!/usr/bin/env python3
"""Prove each slim core font renders exactly like the original it was cut from.

    python scripts/verify-slim-fonts.py        (needs fonttools, brotli, uharfbuzz)

For every file in src/styles/fonts/slim/provenance.json, at a spread of variation
settings inside the ranges the site's CSS can reach, it compares the core file
with the original:

  hinting   fpgm and prep byte for byte, and every core character's TrueType
            instructions byte for byte;
  outlines  every core character's outline points at every setting;
  shaping   HarfBuzz output for every ordered pair of core characters at a
            seeded sample of settings: glyph count, clusters, advances, offsets,
            and the outline of each glyph the shaper chose, so kerning, ligatures
            and contextual alternates all agree.

Not run in CI (it needs fonttools, brotli and uharfbuzz); run it whenever
slim-site-fonts.py or the mirrored fonts change.

Exits non-zero on the first difference and prints the worst outline deviation.
"""
from __future__ import annotations

import io
import itertools
import json
import random
import re
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / "src" / "styles" / "fonts"
# Only glyphs are dropped, so every point and advance must match exactly.
TOLERANCE_EM = 0.0
provenance = json.loads((FONTS / "slim" / "provenance.json").read_text("utf8"))


def codepoints(spec: str) -> list[int]:
    cps: list[int] = []
    for token in spec.split(", "):
        match = re.fullmatch(r"U\+([0-9A-F]+)(?:-([0-9A-F]+))?", token)
        assert match is not None, token
        cps.extend(range(int(match.group(1), 16), int(match.group(2) or match.group(1), 16) + 1))
    return cps


CORE = codepoints(provenance["coreCodepoints"])


def settings(axes: dict[str, tuple[float, float, float]], weights: tuple[float, float]) -> list[dict[str, float]]:
    """Variation settings the CSS can reach: wght inside the declared span, opsz
    across its range and at the sizes the site uses, SOFT and WONK at their poles
    and at the values the stylesheet sets."""
    grid: dict[str, list[float]] = {}
    for tag, (lo, _default, hi) in axes.items():
        if tag == "wght":
            low, high = max(lo, weights[0]), min(hi, weights[1])
            grid[tag] = sorted({low, (low + high) / 2, high})
        elif tag == "opsz":
            grid[tag] = sorted({min(max(v, lo), hi) for v in (lo, 14, 24, 40, 72, 144, hi)})
        elif tag == "SOFT":
            grid[tag] = [0, 30, 100]
        elif tag == "WONK":
            grid[tag] = [0, 1]
    return [dict(zip(grid, combo)) for combo in itertools.product(*grid.values())]


def sfnt_bytes(tt: TTFont) -> bytes:
    """HarfBuzz reads sfnt, not woff2: serialise without the wrapper."""
    flavor = tt.flavor
    tt.flavor = None
    out = io.BytesIO()
    tt.save(out)
    tt.flavor = flavor
    return out.getvalue()


def shape(font: hb.Font, text: str, location: dict[str, float]) -> list[tuple[int, int, int, int, int]]:
    font.set_variations(location)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True, "calt": True})
    return [(i.cluster, p.x_advance, p.x_offset, p.y_offset, i.codepoint) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


class Outlines:
    """Outline of a glyph id at a location, cached: the shaped glyphs repeat."""

    def __init__(self, tt: TTFont) -> None:
        self.tt = tt
        self.order = tt.getGlyphOrder()
        self.sets: dict[tuple, object] = {}
        self.seen: dict[tuple, list] = {}

    def of(self, gid: int, location: dict[str, float]):
        key = (gid, tuple(sorted(location.items())))
        if key not in self.seen:
            glyphs = self.sets.setdefault(key[1], self.tt.getGlyphSet(location=location))
            pen = DecomposingRecordingPen(glyphs)
            glyphs[self.order[gid]].draw(pen)
            self.seen[key] = pen.value
        return self.seen[key]


def outline(tt: TTFont, char: int, location: dict[str, float]):
    glyphs = tt.getGlyphSet(location=location)
    pen = DecomposingRecordingPen(glyphs)
    glyphs[tt.getBestCmap()[char]].draw(pen)
    return pen.value


def main() -> int:
    worst_outline = 0.0
    pairs = 0
    for core_name, record in provenance["files"].items():
        original_tt = TTFont(FONTS / "files" / record["from"])
        core_tt = TTFont(FONTS / "slim" / core_name)
        axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in original_tt["fvar"].axes}
        locations = settings(axes, tuple(record["declaredWeights"]))
        present = [c for c in CORE if c in original_tt.getBestCmap()]
        missing = [c for c in present if c not in core_tt.getBestCmap()]
        if missing:
            print(f"FAIL {core_name}: core lacks {[hex(c) for c in missing]}")
            return 1

        for table in ("fpgm", "prep"):
            if table in original_tt and original_tt.getTableData(table) != core_tt.getTableData(table):
                print(f"FAIL {core_name}: {table} differs")
                return 1
        for char in present:
            a = original_tt["glyf"][original_tt.getBestCmap()[char]]
            b = core_tt["glyf"][core_tt.getBestCmap()[char]]
            program_a = a.program.getBytecode() if hasattr(a, "program") else b""
            program_b = b.program.getBytecode() if hasattr(b, "program") else b""
            if program_a != program_b:
                print(f"FAIL {core_name}: hinting program differs for U+{char:04X}")
                return 1

        for location in locations:
            for char in present:
                a, b = outline(original_tt, char, location), outline(core_tt, char, location)
                if [op for op, _ in a] != [op for op, _ in b]:
                    print(f"FAIL {core_name}: outline structure differs for U+{char:04X} at {location}")
                    return 1
                for (_, points_a), (_, points_b) in zip(a, b):
                    for pa, pb in zip(points_a, points_b):
                        deviation = max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1]))
                        worst_outline = max(worst_outline, deviation)
                        if deviation > TOLERANCE_EM:
                            print(f"FAIL {core_name}: U+{char:04X} moves {deviation:.2f} units (upem {original_tt['head'].unitsPerEm}) at {location}")
                            return 1

        original_hb = hb.Font(hb.Face(sfnt_bytes(original_tt)))
        core_hb = hb.Font(hb.Face(sfnt_bytes(core_tt)))
        original_outlines, core_outlines = Outlines(original_tt), Outlines(core_tt)
        rng = random.Random(20261019)
        for location in rng.sample(locations, min(len(locations), 12)):
            for first, second in itertools.product(present, repeat=2):
                text = chr(first) + chr(second)
                ref, got = shape(original_hb, text, location), shape(core_hb, text, location)
                pairs += 1
                if len(ref) != len(got) or any(
                        r[:4] != g[:4] or original_outlines.of(r[4], location) != core_outlines.of(g[4], location)
                        for r, g in zip(ref, got)):
                    print(f"FAIL {core_name}: shaping {text!r} at {location}: {ref} vs {got}")
                    return 1
        print(f"ok   {core_name}: {len(locations)} settings x {len(present)} characters, upem {original_tt['head'].unitsPerEm}, worst outline so far {worst_outline:.2f} units")
    print(f"all slim fonts match their originals ({pairs} pairs shaped, worst outline deviation {worst_outline:.3f} units)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

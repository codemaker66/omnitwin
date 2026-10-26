#!/usr/bin/env python3
"""Derive the slim front-door font layer from the mirrored Google Fonts files.

    python scripts/slim-site-fonts.py          (needs fonttools and brotli)

src/styles/fonts/files/ and site*.css are Google's own bytes and rules, pinned
by self-hosted-font-files.test.ts. They stay exactly as mirrored. This script
reads them and writes, beside them:

  slim/<face>-core.woff2        the same face cut down to the characters the
                                site's copy uses (ASCII plus the punctuation
                                and symbols in CORE_EXTRA);
  site-slim.css                 site.css with every targeted `latin` face split
  site-slim.firefox-windows.css into a `latin-core` face (the cut-down file)
                                and a `latin` face (Google's original file,
                                its unicode-range reduced to the remainder);
  slim/provenance.json          inputs, outputs, hashes, tool versions.

Nothing about the type changes: the browser takes each character from the same
outlines, variation deltas, kerning and hinting as before. Text made only of
core characters downloads the small file; a character outside it (an accented
name, say) also fetches the original, as it always did. The home page was
fetching 432,136 bytes of Latin faces for text that is almost all ASCII.

Only glyphs are dropped; every kept glyph keeps its outline, variation deltas,
kerning and hinting bit for bit (verify-slim-fonts.py checks this). Axes are
not trimmed. The @font-face weight descriptors would let the wght range be cut,
which saves about 19 KB more on the home page, but re-basing a variable font's
default moves points by a unit or two and advances by up to 0.1% of an em, so
it is not a change to make without Blake. The opsz, SOFT and WONK axes are all
reachable (the hero animates SOFT and WONK; optical sizing is automatic).

scripts/verify-slim-fonts.py compares the output against the originals.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont

try:
    import brotli  # noqa: F401  (woff2 needs it; fail early with a clear message)
except ImportError:
    sys.exit("brotli is required to read and write woff2: pip install brotli")

FONTS = Path(__file__).resolve().parent.parent / "src" / "styles" / "fonts"
STYLESHEETS = ["site.css", "site.firefox-windows.css"]
TARGET_FAMILIES = {"Fraunces", "Newsreader", "Geist", "Geist Mono"}

# Beyond printable ASCII (U+0020-007E): every non-ASCII character in the
# Latin range that the site's own copy uses. self-hosted-slim-fonts.test.ts
# scans the source and fails when a new one appears, so add it here and rerun.
CORE_EXTRA = [
    0x00A0, 0x00A3, 0x00A7, 0x00A9, 0x00AB, 0x00B0, 0x00B1, 0x00B2, 0x00B7, 0x00BB, 0x00BD,
    0x00C5, 0x00D7, 0x00D8, 0x00E6, 0x00E9, 0x00F6, 0x00F7,
    0x2009, 0x2010, 0x2013, 0x2014, 0x2015, 0x2018, 0x2019, 0x201A, 0x201B, 0x201C, 0x201D,
    0x201E, 0x201F, 0x2022, 0x2026, 0x2032, 0x2033, 0x2191, 0x2193, 0x2212,
]
CORE = set(range(0x20, 0x7F)) | set(CORE_EXTRA)

FACE = re.compile(r"/\* ([\w-]+) \*/\n@font-face \{\n(.*?)\}\n", re.S)
SOURCE = re.compile(r"url\(\./files/([^)]+)\)")


def parse_ranges(text: str) -> set[int]:
    codepoints: set[int] = set()
    for token in (t.strip() for t in text.split(",")):
        match = re.fullmatch(r"U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?", token)
        if match is None:
            raise ValueError(f"unsupported unicode-range token {token!r}")
        low = int(match.group(1), 16)
        codepoints.update(range(low, int(match.group(2) or match.group(1), 16) + 1))
    return codepoints


def format_ranges(codepoints: set[int]) -> str:
    runs: list[list[int]] = []
    for cp in sorted(codepoints):
        if runs and cp == runs[-1][1] + 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp])
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in runs)


def descriptor(block: str, name: str) -> str:
    match = re.search(rf"^\s*{name}: (.*);$", block, re.M)
    if match is None:
        raise ValueError(f"face has no {name}: {block}")
    return match.group(1)


def weight_span(value: str) -> tuple[float, float]:
    low, _, high = value.partition(" ")
    return float(low), float(high or low)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cut_core(source: Path) -> bytes:
    font = TTFont(source, lazy=False, recalcTimestamp=False)
    if "gvar" in font:
        # fontTools omits glyphs without deltas; the subsetter expects them all.
        variations = dict(font["gvar"].variations)
        for name in font.getGlyphOrder():
            variations.setdefault(name, [])
        font["gvar"].variations = variations
    options = subset.Options()
    options.layout_features = ["*"]
    options.hinting = True
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.legacy_kern = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=CORE)
    subsetter.subset(font)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def main() -> None:
    (FONTS / "slim").mkdir(exist_ok=True)
    produced: dict[str, dict] = {}
    # One core file per source file; record the union of the weights its
    # @font-face rules declare, which the verifier samples.
    spans: dict[str, tuple[float, float]] = {}
    for sheet in STYLESHEETS:
        for match in FACE.finditer((FONTS / sheet).read_text("utf8")):
            block = match.group(2)
            family = descriptor(block, "font-family").strip("'")
            source = SOURCE.search(block)
            if match.group(1) != "latin" or family not in TARGET_FAMILIES or source is None:
                continue
            low, high = weight_span(descriptor(block, "font-weight"))
            known = spans.get(source.group(1))
            spans[source.group(1)] = (low, high) if known is None else (min(known[0], low), max(known[1], high))

    for name, span in sorted(spans.items()):
        out_name = name.replace(".woff2", "") + "-core.woff2"
        data = cut_core(FONTS / "files" / name)
        (FONTS / "slim" / out_name).write_bytes(data)
        original = (FONTS / "files" / name).read_bytes()
        produced[out_name] = {
            "from": name, "sourceSha256": sha256(original), "sourceBytes": len(original),
            "bytes": len(data), "sha256": sha256(data), "declaredWeights": list(span),
        }

    for sheet in STYLESHEETS:
        text = (FONTS / sheet).read_text("utf8")
        newline = text.index("\n")
        body = text[newline + 1:]

        def split(match: re.Match[str]) -> str:
            block = match.group(2)
            family = descriptor(block, "font-family").strip("'")
            source = SOURCE.search(block)
            if match.group(1) != "latin" or family not in TARGET_FAMILIES or source is None:
                return match.group(0)
            original = parse_ranges(descriptor(block, "unicode-range"))
            core = original & CORE
            rest = original - CORE
            core_block = block.replace(f"url(./files/{source.group(1)})", "url(./slim/" + source.group(1).replace(".woff2", "") + "-core.woff2)")
            core_block = re.sub(r"unicode-range: .*;", f"unicode-range: {format_ranges(core)};", core_block)
            rest_block = re.sub(r"unicode-range: .*;", f"unicode-range: {format_ranges(rest)};", block)
            return (f"/* latin-core */\n@font-face {{\n{core_block}}}\n"
                    f"/* latin */\n@font-face {{\n{rest_block}}}\n")

        header = (f"/* Generated by scripts/slim-site-fonts.py from {sheet}; see slim/provenance.json. "
                  "Each targeted latin face is split into latin-core (cut-down file) and latin (Google's original file, remaining range). */")
        slim_name = sheet.replace("site", "site-slim", 1)
        (FONTS / slim_name).write_text(header + "\n" + FACE.sub(split, body), "utf8", newline="\n")

    provenance = {
        "schemaVersion": "venviewer.slim-site-fonts.v1",
        "generator": "packages/web/scripts/slim-site-fonts.py",
        "tools": {"fonttools": fontTools.version},
        "coreCodepoints": format_ranges(CORE),
        "files": produced,
    }
    (FONTS / "slim" / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", "utf8", newline="\n")
    total_before = sum(f["sourceBytes"] for f in produced.values())
    total_after = sum(f["bytes"] for f in produced.values())
    print(f"{len(produced)} core files, {total_before} -> {total_after} bytes")


if __name__ == "__main__":
    main()

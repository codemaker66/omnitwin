"""Cut the hallkeeper sheet's static Newsreader and Inter faces.

pdfkit (through fontkit) cannot take a weight from a WOFF2 variable font, so
the sheet PDF embeds static TrueType instances cut from the same Google Fonts
files the web app self-hosts (packages/web/src/styles/fonts/files; their
provenance.json says where those came from). Each face merges the family's
unicode-range subsets, so a Polish or Vietnamese name prints in the same type
as the rest of its line. The output is committed; run this again only to
change the faces.

    python packages/api/scripts/build-sheet-fonts.py \
        packages/web/src/styles/fonts/files packages/api/assets/fonts

Writes <face>.ttf, coverage.json (the code points each face can set, which
the renderer reads to fall back to Inter) and provenance.json. Needs
fontTools; WOFF2 also needs a brotli decoder, and when the brotli wheel is
missing Node's built-in zlib decodes instead (node must be on PATH).
"""
from __future__ import annotations

import datetime
import hashlib
import json
import subprocess
import sys
import types
from pathlib import Path

try:
    import brotli  # noqa: F401
except ImportError:
    shim = types.ModuleType("brotli")

    def _decompress(data: bytes) -> bytes:
        return subprocess.run(
            ["node", "-e", "process.stdout.write(require('zlib').brotliDecompressSync(require('fs').readFileSync(0)))"],
            input=data, capture_output=True, check=True,
        ).stdout

    shim.decompress = _decompress  # type: ignore[attr-defined]
    shim.error = Exception  # type: ignore[attr-defined]
    sys.modules["brotli"] = shim

import fontTools
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

NEWSREADER = ("latin", "latin-ext", "vietnamese")
INTER = ("latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "greek-ext", "vietnamese")

# face -> (source file stem, unicode-range subsets, axis location)
FACES: dict[str, tuple[str, tuple[str, ...], dict[str, float]]] = {
    "Newsreader-DisplayLight": ("newsreader-normal", NEWSREADER, {"wght": 300, "opsz": 72}),
    "Newsreader-Regular": ("newsreader-normal", NEWSREADER, {"wght": 400, "opsz": 24}),
    "Newsreader-Medium": ("newsreader-normal", NEWSREADER, {"wght": 500, "opsz": 16}),
    "Newsreader-Italic": ("newsreader-italic", NEWSREADER, {"opsz": 16}),
    "Inter-Regular": ("inter-normal", INTER, {"wght": 400}),
    "Inter-Medium": ("inter-normal", INTER, {"wght": 500}),
    "Inter-SemiBold": ("inter-normal", INTER, {"wght": 600}),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def static_instance(path: Path, location: dict[str, float], out: Path) -> Path:
    font = TTFont(path)
    font.flavor = None
    axes = {axis.axisTag for axis in font["fvar"].axes} if "fvar" in font else set()
    pinned = {tag: value for tag, value in location.items() if tag in axes}
    static = instancer.instantiateVariableFont(font, pinned, updateFontNames=False) if axes else font
    static.save(out)
    return out


def ranges(code_points: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for cp in sorted(set(code_points)):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def name_face(font: TTFont, face: str) -> None:
    family, _, style = face.partition("-")
    table = font["name"]
    for name_id in (1, 2, 4, 6, 16, 17):
        table.removeNames(nameID=name_id)
    table.setName(f"{family} Sheet", 1, 3, 1, 0x409)
    table.setName(style, 2, 3, 1, 0x409)
    table.setName(f"{family} Sheet {style}", 4, 3, 1, 0x409)
    table.setName(f"{family}Sheet-{style}", 6, 3, 1, 0x409)


def main() -> None:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    scratch = dst / ".parts"
    scratch.mkdir(exist_ok=True)
    coverage: dict[str, list[list[int]]] = {}
    provenance = {
        "schemaVersion": "venviewer.sheet-fonts.v1",
        "generator": "packages/api/scripts/build-sheet-fonts.py",
        "fontTools": fontTools.version,
        "cutOn": datetime.date.today().isoformat(),
        "licence": "SIL Open Font License 1.1 (newsreader-OFL.txt, inter-OFL.txt)",
        "faces": {},
    }
    try:
        for face, (stem, subsets, location) in FACES.items():
            inputs = [src / f"{stem}-{subset}.woff2" for subset in subsets]
            inputs = [path for path in inputs if path.exists()]
            parts = [static_instance(path, location, scratch / f"{face}-{path.stem}.ttf") for path in inputs]
            merged = Merger().merge([str(part) for part in parts])
            name_face(merged, face)
            out = dst / f"{face}.ttf"
            merged.save(out)
            coverage[face] = ranges(list(merged.getBestCmap().keys()))
            provenance["faces"][face] = {
                "location": location,
                "inputs": {path.name: sha256(path) for path in inputs},
                "output": {"file": out.name, "sha256": sha256(out), "bytes": out.stat().st_size},
            }
            print(face, len(merged.getGlyphOrder()), "glyphs", out.stat().st_size, "bytes")
    finally:
        for part in scratch.iterdir():
            part.unlink()
        scratch.rmdir()
    (dst / "coverage.json").write_text(json.dumps(coverage, separators=(",", ":")) + "\n", encoding="utf-8")
    (dst / "provenance.json").write_text(json.dumps(provenance, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

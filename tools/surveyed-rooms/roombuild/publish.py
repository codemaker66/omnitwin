"""The build's record (build/survey.json) and publishing.

survey.json says what the published files are and where they go, so that a reader needs nothing
but the record to place them: the room (name, venue, ceiling height, measured outline), each wall
in outline order (id, relief id, length, height, kind, its strip in the atlas), the wall atlas and
the ceiling and floor photographs at each published size (largest first) with the planner
rectangle each overhead photograph covers, the reliefs, the detail tiles' grid, count and index,
the glazing per opening and what the scan said about it, the config the files were built from (its
SHA-256), the tools' commit and the meshoptimizer that simplified each GHR1 file, the inputs taken
from another work directory, and every published file's size and hash.

This is schema version 2, the version the web's reader takes
(packages/web/src/components/surveyed-room/survey-record.ts; its Zod schema is the authority).
record_faults() repeats that reader's refusals, so a build finds out before it publishes.

The record always goes to build/; for a room whose survey.outputs.manifest names it, it is
published too. The Grand Hall publishes exactly its nine files and its detail folder, as build.sh
does, so `git diff` on its folder stays empty. The detail folder is replaced whole, as build.sh
replaces it, so a tile a rebuild no longer makes does not linger.

publish() refuses (before copying anything) when the scan disagrees with a window's glass
(build/glass.json), when a relief was meshed with another checkout's meshoptimizer, and, for a
room that publishes its record, when the web's reader would refuse that record.
"""
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import subprocess

from . import atlas as atlas_step
from .legacy import ROOMS

SCHEMA_VERSION = 2
# How the ceiling and floor photographs lie over their extents (roomlib.ceiling_view,
# surfaces.floor_grid): the only way the tools write one, and the only one the reader draws.
OVERHEAD_ORIENTATION = "columns planner +x, rows from planner +z"
DETAIL_INDEX = "index.json"   # the detail tiles' index, inside the detail folder
# The reader's rules (survey-record.ts, relief-container.ts): a published file is a plain name in
# the room's folder, a room or a venue is a slug, a relief id fits GHR1's 12-byte field. Each is
# used with fullmatch, the whole string: a JavaScript `$` (no m flag) is the string's end, but
# Python's also matches before a final newline; and every digit is spelt [0-9], since Python's \d
# takes any script's digits where JavaScript's takes 0-9 only.
FILE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
RELIEF_ID = re.compile(r"[\x21-\x7e]{1,12}")
SHA256 = re.compile(r"[0-9a-f]{64}")
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")   # and a day on the calendar (z.iso.date())
MAX_SAFE_INTEGER = 2 ** 53 - 1   # Zod's .int() takes a safe integer only (Number.isSafeInteger)
# A path on some machine: a drive letter and a slash or backslash, a UNC start, or a leading slash and
# a name. A URL (https://...), a relative name and a lone "/" are not.
MACHINE_PATH = re.compile(r"^(?:[A-Za-z]:[/\\]|\\\\|/[^\s/])")
# And a drive path inside a longer string (a note, a command line, a file URL): one letter that is
# not the end of a word, then ":/" or ":\". A URL's scheme is a word, so "https://" is not one.
DRIVE_PATH_WITHIN = re.compile(r"(?<![A-Za-z])[A-Za-z]:[/\\]")
LINKED_KEYS = ("how", "sha256")   # what survey.json keeps of a build/linked.json entry
WALL_KINDS = ("solid", "partition", "screen", "open")
WALL_LENGTH_TOLERANCE = 0.002   # metres between a wall's length and its outline segment
ATLAS_ROW_TOLERANCE = 1         # texels between atlas.row and vRange x ppm
# The reader's OVERHEAD_EXTENT_TOLERANCE: how far the outline may reach past the rectangle an overhead
# photograph covers. Not slack to tighten: floor_extent() below lays the floor in whole texels, so its
# extent stops up to half a texel (4.17 mm at 120 px/m) short of the outline's box on two sides.
OVERHEAD_EXTENT_TOLERANCE = 0.005
# The reader's HEIGHT_TOLERANCE: a wall above the heights the atlas's strips cover, and a ceiling
# drawn flat (one without a relief) from the tallest wall's top.
HEIGHT_TOLERANCE = 0.005


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def output_files(room):
    """Published file names, in a fixed order."""
    o = room.survey["outputs"]
    names = [f["file"] for f in o["walls"]] + [o["relief"]]
    names += [f["file"] for f in o.get("ceiling", [])]
    names += [f["file"] for d in room.cfg["ceiling"].get("domes", []) for f in o.get("domes", {}).get(d["id"], [])]
    names += [f["file"] for f in o.get("floor", [])]
    if o.get("ceilingRelief"):
        names.append(o["ceilingRelief"])
    return names


def detail_folder(room):
    """The published folder of detail tiles (survey.outputs.detail); its index is index.json."""
    return room.survey["outputs"]["detail"]


def tools_state():
    repo = os.path.dirname(os.path.dirname(ROOMS))
    try:
        commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", repo, "status", "--porcelain", "--", "tools"], capture_output=True, text=True, check=True).stdout.strip()
        return dict(commit=commit, dirty=bool(dirty))
    except (OSError, subprocess.CalledProcessError):
        return dict(commit=None, dirty=None)


def _json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def glass_scan():
    """What the windows step's scan check found (build/glass.json), or None before that step."""
    record = _json("build/glass.json")
    if record is None:
        return None
    return dict(disagreements=record.get("disagreements", []),
                openings={oid: r["scan"] for oid, r in record["openings"].items() if "scan" in r})


def node_records():
    """Which meshoptimizer simplified each GHR1 file (relief-mesh-room.mjs's records)."""
    return {name: rec for name in ("walls", "ceiling") if (rec := _json(f"build/relief-{name}.node.json")) is not None}


def linked_inputs():
    """The inputs taken from another work directory, for the record: each by its name relative to the
    work directory, with how it was linked (and its SHA-256 where build/linked.json has one). The
    tree each came from stays in build/linked.json, which prove-build-identity.py reads: the record
    is published into a public repository and names nothing on the build machine."""
    linked = _json("build/linked.json") or {}
    return {name: {key: entry[key] for key in LINKED_KEYS if key in entry} for name, entry in linked.items()}


def machine_paths(node, where=""):
    """(where, string) for every string key or value in a JSON value that is a path on some machine,
    or holds a drive path somewhere inside it."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from machine_paths(key, f"{where}[key {key!r}]")
            yield from machine_paths(value, f"{where}.{key}" if where else str(key))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from machine_paths(value, f"{where}[{i}]")
    elif isinstance(node, str) and (MACHINE_PATH.match(node) or DRIVE_PATH_WITHIN.search(node)):
        yield where, node


def publish_problems(record):
    out = [f"glass: {line}" for line in (record.get("glassScan") or {}).get("disagreements", [])]
    if "detail" in record and record["detail"] is None:
        out.append("detail: the detail folder's index.json is missing (the detail step has not run)")
    out += [f"relief {name}: meshed with SURVEYED_ROOMS_NODE_ROOT={rec['nodeRoot']}"
            for name, rec in record["tools"]["relief"].items() if rec.get("nodeRoot")]
    return out


def largest_first(images):
    """The file names of one photograph's published sizes (survey.outputs entries), largest first
    by pixel count: a reader takes the first, or with less memory a later one."""
    return [f["file"] for f in sorted(images, key=lambda f: -(f["size"][0] * f["size"][1]))]


def floor_extent(room):
    """The planner rectangle the floor photograph covers. surfaces.floor_grid lays whole texels of
    1 / floorPhoto.ppm from the outline's bounding box's lowest x and highest z, so the photograph
    ends up to half a texel short of or past the box's other two sides (the ceiling's view is
    stretched over the box instead and covers it exactly)."""
    ppm = float(room.survey["floorPhoto"]["ppm"])
    x0, x1, z0, z1 = room.bbox()
    w, h = int(round((x1 - x0) * ppm)), int(round((z1 - z0) * ppm))
    return dict(x=[x0, round(x0 + w / ppm, 6)], z=[round(z1 - h / ppm, 6), z1])


def _segment_length(outline, i):
    (ax, az), (bx, bz) = outline[i], outline[(i + 1) % len(outline)]
    return ((bx - ax) ** 2 + (bz - az) ** 2) ** 0.5


def _overlap(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def is_number(value):
    """z.number(): a finite number. Never a bool: True is an int in Python, and JSON writes it true."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:      # an int past any double, which JSON.parse reads as Infinity
        return False


def is_integer(value):
    """z.number().int(): a safe integer. A whole float counts, since JSON.parse reads 3.0 as 3."""
    return is_number(value) and abs(value) <= MAX_SAFE_INTEGER and float(value).is_integer()


def is_text(value, pattern=None):
    """z.string(), and with a pattern z.string().regex(...): the whole string matches."""
    return isinstance(value, str) and (pattern is None or pattern.fullmatch(value) is not None)


def is_date(value):
    """z.iso.date(): YYYY-MM-DD in ASCII digits, and a day on the calendar (no 2026-02-30, no
    2026-18-11). Year 0000, which Zod takes and Python's calendar does not, is refused too."""
    if not is_text(value, ISO_DATE):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _array(value):
    return isinstance(value, (list, tuple))


def _numbers(value, count):
    """z.tuple of `count` z.number()s."""
    return _array(value) and len(value) == count and all(is_number(v) for v in value)


def _increasing(value):
    """The reader's Increasing: [low, high], two numbers with high > low."""
    return _numbers(value, 2) and value[1] > value[0]


def _texels(value, least):
    return is_integer(value) and value >= least


def shape_faults(record):
    """What survey-record.ts's Zod schema refuses (SurveyRecordShape and the outline's own
    refinement), field by field, with the reader's types: a string is a str matched whole, a number
    is finite and not a bool, a texel is a whole number from 0 and a size or a count from 1. The
    reader runs its cross-checks only on a record whose shapes hold, and so does record_faults."""
    out = []
    if record.get("schemaVersion") != SCHEMA_VERSION:
        out.append(f"schemaVersion is {record.get('schemaVersion')!r}; the reader reads {SCHEMA_VERSION}")
    if not is_text(record.get("slug"), SLUG):
        out.append(f"slug {record.get('slug')!r} is not a room slug (lower-case words joined by '-')")
    revision = record.get("revision")
    if not (is_integer(revision) and revision >= 1):
        out.append(f"revision is {revision!r}; it must be an integer from 1 (survey.publish.revision)")
    if not is_date(record.get("captured")):
        out.append(f"captured {record.get('captured')!r} is not an ISO date on the calendar (YYYY-MM-DD in ASCII digits; source.captured)")

    room = record.get("room")
    if not isinstance(room, dict):
        out.append(f"room is {room!r}, not an object")
    else:
        name = room.get("name")
        if not (is_text(name) and name):
            out.append(f"room.name is {name!r}; it must be a string that is not empty")
        if not is_text(room.get("venue"), SLUG):
            out.append(f"room.venue {room.get('venue')!r} is not a venue slug")
        if not (is_number(room.get("ceilingHeight")) and room["ceilingHeight"] > 0):
            out.append(f"room.ceilingHeight is {room.get('ceilingHeight')!r}; it must be a positive number")
        outline = room.get("outline")
        bad = [i for i, p in enumerate(outline) if not _numbers(p, 2)] if _array(outline) else None
        n = len(outline) if _array(outline) else 0
        if bad is None:
            out.append(f"room.outline is {outline!r}, not a list of vertices")
        elif bad:
            out += [f"room.outline[{i}] is {outline[i]!r}; a vertex is [x, z], two finite numbers" for i in bad]
        elif n < 3:
            out.append(f"room.outline has {n} vertices; a room needs at least 3")
        elif any(_segment_length(outline, i) == 0 for i in range(n)):
            i = next(i for i in range(n) if _segment_length(outline, i) == 0)
            out.append(f"room.outline segment {i} has no length (vertices {i} and {(i + 1) % n} coincide)")
        elif sum(outline[(i + 1) % n][0] * p[1] - p[0] * outline[(i + 1) % n][1] for i, p in enumerate(outline)) <= 0:
            out.append("room.outline is clockwise seen from above; outlines run counter-clockwise (from +x towards -z)")

    atlas = record.get("atlas")
    if not isinstance(atlas, dict):
        out.append(f"atlas is {atlas!r}, not an object")
    else:
        size = atlas.get("size")
        if not (_array(size) and len(size) == 2 and all(_texels(v, 1) for v in size)):
            out.append(f"atlas.size is {size!r}; it must be [width, height], whole texels from 1")
        if not (is_number(atlas.get("ppm")) and atlas["ppm"] > 0):
            out.append(f"atlas.ppm is {atlas.get('ppm')!r}; it must be a positive number")
        if not _increasing(atlas.get("vRange")):
            out.append(f"atlas.vRange is {atlas.get('vRange')!r}; it must be [low, high], two numbers that increase")
        if not _texels(atlas.get("row"), 1):
            out.append(f"atlas.row is {atlas.get('row')!r}; it must be a whole number of texels from 1")
        names = atlas.get("files")
        if not _array(names):
            out.append(f"atlas.files is {names!r}, not a list of file names")
        elif not names:
            out.append("atlas.files names no atlas image")
        else:
            out += [f"atlas.files[{i}] {v!r} is not a plain file name" for i, v in enumerate(names) if not is_text(v, FILE_NAME)]

    walls = record.get("walls")
    if not _array(walls):
        out.append(f"walls is {walls!r}, not a list")
        walls = []
    for i, w in enumerate(walls):
        if not isinstance(w, dict):
            out.append(f"walls[{i}] is {w!r}, not an object")
            continue
        name = f"wall {w.get('id')!r}"
        if not (is_text(w.get("id")) and w["id"]):
            out.append(f"walls[{i}].id is {w.get('id')!r}; it must be a string that is not empty")
        if w.get("kind") not in WALL_KINDS:
            out.append(f"{name}: kind {w.get('kind')!r}")
        if not (is_number(w.get("length")) and w["length"] > 0):
            out.append(f"{name}: length {w.get('length')!r}; it must be a positive number")
        if not (is_number(w.get("height")) and w["height"] > 0):
            out.append(f"{name}: height {w.get('height')!r}; it must be a positive number")
        if w.get("atlas") is None and w.get("reliefId") is None:
            out.append(f"{name} has no strip in the atlas and no relief (an open segment has no elevation): "
                       "the reader needs both for every outline segment")
            continue
        if not is_text(w.get("reliefId"), RELIEF_ID):
            out.append(f"{name}: relief id {w.get('reliefId')!r} is not 1 to 12 printable ASCII characters")
        strip = w.get("atlas")
        if not (_array(strip) and len(strip) == 4 and all(_texels(v, least) for v, least in zip(strip, (0, 0, 1, 1)))):
            out.append(f"walls[{i}].atlas is {strip!r} ({name}); a strip is [x, y, width, height] in whole texels, "
                       "x and y from 0, width and height from 1")

    relief = record.get("relief")
    if not isinstance(relief, dict):
        out.append(f"relief is {relief!r}, not an object")
    else:
        if relief.get("container") != "GHR1":
            out.append(f"relief.container is {relief.get('container')!r}")
        if not is_text(relief.get("file"), FILE_NAME):
            out.append(f"relief.file {relief.get('file')!r} is not a plain file name")
        order = relief.get("order")
        if not _array(order):
            out.append(f"relief.order is {order!r}, not a list of relief ids")
        else:
            out += [f"relief.order[{i}] {v!r} is not 1 to 12 printable ASCII characters" for i, v in enumerate(order) if not is_text(v, RELIEF_ID)]

    for part in ("ceiling", "floor"):
        block = record.get(part)
        if not isinstance(block, dict):
            out.append(f"{part} is {block!r}, not an object")
            continue
        extent = block.get("extent")
        if not isinstance(extent, dict):
            out.append(f"{part}.extent is {extent!r}, not an object")
        else:
            pairs = [axis for axis in ("x", "z") if not _numbers(extent.get(axis), 2)]
            out += [f"{part}.extent.{axis} is {extent.get(axis)!r}; it must be [low, high], two numbers" for axis in pairs]
            if not pairs and not (_increasing(extent["x"]) and _increasing(extent["z"])):
                out.append(f"{part}.extent {extent} does not increase")
        if "orientation" in block and block["orientation"] != OVERHEAD_ORIENTATION:
            out.append(f"{part}.orientation is {block['orientation']!r}")
        names = block.get("files")
        if not _array(names):
            out.append(f"{part}.files is {names!r}, not a list of file names")
        else:
            out += [f"{part}.files[{i}] {v!r} is not a plain file name" for i, v in enumerate(names) if not is_text(v, FILE_NAME)]
    if isinstance(record.get("ceiling"), dict) and "relief" in record["ceiling"]:   # optional: absent, or all of it
        ceiling_relief = record["ceiling"]["relief"]
        if not isinstance(ceiling_relief, dict):
            out.append(f"ceiling.relief is {ceiling_relief!r}, not an object")
        else:
            if not is_text(ceiling_relief.get("file"), FILE_NAME):
                out.append(f"ceiling.relief.file {ceiling_relief.get('file')!r} is not a plain file name")
            if not is_text(ceiling_relief.get("id"), RELIEF_ID):
                out.append(f"ceiling.relief.id {ceiling_relief.get('id')!r} is not 1 to 12 printable ASCII characters")
            if not is_number(ceiling_relief.get("reference")):
                out.append(f"ceiling.relief.reference is {ceiling_relief.get('reference')!r}; it must be a number")
            if not _increasing(ceiling_relief.get("heightRange")):
                out.append(f"ceiling.relief.heightRange is {ceiling_relief.get('heightRange')!r}; it must be [low, high], two numbers that increase")

    files = record.get("files")
    if not isinstance(files, dict):
        out.append(f"files is {files!r}, not an object")
    else:
        for name, entry in files.items():
            if not is_text(name, FILE_NAME):
                out.append(f"files: {name!r} is not a plain file name")
            if not isinstance(entry, dict):
                out.append(f"files: {name!r} is {entry!r}, not an object")
                continue
            if not _texels(entry.get("bytes"), 0):
                out.append(f"files: {name!r} has bytes {entry.get('bytes')!r}; it must be a whole number from 0")
            if not is_text(entry.get("sha256"), SHA256):
                out.append(f"files: {name!r} has sha256 {entry.get('sha256')!r}, not a lower-case hex SHA-256")
    return out


def record_faults(record):
    """What the web's reader would refuse in a record: survey-record.ts's shapes (shape_faults) and,
    on a record whose shapes hold, its cross-checks, as far as a build can get them wrong (an outline
    that crosses itself is check_room's to refuse, and check_room always runs first). The reader
    stays the authority; a fault here stops a room publishing its record. A machine path is refused
    as well, which the reader does not: the record is published into a public repository."""
    if not isinstance(record, dict):
        return [f"the record is not a JSON object ({type(record).__name__})"]
    out = shape_faults(record) or cross_faults(record)
    out += [f"{where} is the absolute path {value!r}: a published record names nothing on the build machine" if MACHINE_PATH.match(value)
            else f"{where} holds an absolute path ({value!r}): a published record names nothing on the build machine"
            for where, value in machine_paths(record)]
    return out


def cross_faults(record):
    """survey-record.ts's crossChecks, on a record whose shapes hold (shape_faults is empty)."""
    out = []
    files, room = record["files"], record["room"]
    outline = room["outline"]
    atlas, walls = record["atlas"], record["walls"]
    span = (atlas["vRange"][1] - atlas["vRange"][0]) * atlas["ppm"]
    if abs(atlas["row"] - span) > ATLAS_ROW_TOLERANCE:
        out.append(f"atlas.row is {atlas['row']} texels, but vRange at {atlas['ppm']} texels per metre is {span:.2f}")
    if len(walls) != len(outline):
        out.append(f"walls: {len(walls)} walls for an outline of {len(outline)} segments")
    for key in ("id", "reliefId"):
        seen = [w[key] for w in walls]
        out += [f"walls: {key} {v!r} is used twice" for v in sorted({v for v in seen if seen.count(v) > 1})]
    for i, w in enumerate(walls):
        name = f"wall {w['id']!r}"
        if i < len(outline) and abs(w["length"] - _segment_length(outline, i)) > WALL_LENGTH_TOLERANCE + 1e-9:
            out.append(f"{name} is {w['length']} m long but outline segment {i} is {_segment_length(outline, i):.4f} m")
        if w["height"] > atlas["vRange"][1] + HEIGHT_TOLERANCE:
            out.append(f"{name} is {w['height']} m high, but the atlas's strips cover heights up to {atlas['vRange'][1]} m "
                       f"(vRange), more than {HEIGHT_TOLERANCE * 1000:g} mm short of it")
        x, y, width, height = w["atlas"]
        if x + width > atlas["size"][0] or y + height > atlas["size"][1]:
            out.append(f"{name}: strip {w['atlas']} leaves the {atlas['size'][0]} x {atlas['size'][1]} atlas")
        if height != atlas["row"]:
            out.append(f"{name}: strip is {height} texels high but the atlas's row is {atlas['row']}")
        if w["length"] * atlas["ppm"] > width + 1e-6:
            out.append(f"{name} ({w['length']} m at {atlas['ppm']} texels per metre) is wider than its {width}-texel strip")
        out += [f"{name}: strip overlaps wall {p['id']!r}'s" for p in walls[:i] if _overlap(p["atlas"], w["atlas"])]
    relief_ids = [w["reliefId"] for w in walls]
    order = record["relief"]["order"]
    if sorted(order) != sorted(relief_ids):
        out.append(f"relief.order {order} must list each wall's relief id exactly once ({relief_ids})")

    lists = [("atlas", atlas["files"]), ("ceiling", record["ceiling"]["files"]), ("floor", record["floor"]["files"])]
    named = [(f"{part}.files", name) for part, names in lists for name in names] + [("relief.file", record["relief"]["file"])]
    if "relief" in record["ceiling"]:
        named.append(("ceiling.relief.file", record["ceiling"]["relief"]["file"]))
    for where, name in named:
        if name not in files:
            out.append(f"{where} names {name!r}, which is missing from files (not built?)")
    for part, names in lists:
        out += [f"{part}.files names {name!r} twice" for name in sorted({n for n in names if names.count(n) > 1})]
        for larger, smaller in zip(names, names[1:]):
            if larger in files and smaller in files and files[smaller]["bytes"] > files[larger]["bytes"]:
                out.append(f"{part}.files must list the largest image first, but {smaller!r} ({files[smaller]['bytes']} bytes) "
                           f"follows {larger!r} ({files[larger]['bytes']} bytes)")
    for part in ("ceiling", "floor"):
        out += overhead_reach_faults(part, record[part]["extent"], outline)
    # A ceiling without a relief is drawn flat at the room's ceiling height, which must then be where
    # the walls end. With a relief it is drawn from its measured heights and the room's is a reference.
    heights = [w["height"] for w in walls]
    if "relief" not in record["ceiling"] and heights and abs(room["ceilingHeight"] - max(heights)) > HEIGHT_TOLERANCE:
        out.append(f"room.ceilingHeight is {room['ceilingHeight']} m, but the tallest wall is {max(heights)} m high and the ceiling "
                   f"has no relief: a flat ceiling must meet the walls' tops to within {HEIGHT_TOLERANCE * 1000:g} mm")
    return out


def overhead_reach_faults(part, extent, outline):
    """The reader's SR1: where the outline reaches more than OVERHEAD_EXTENT_TOLERANCE past the
    rectangle an overhead photograph covers. The floor and a flat ceiling are the outline wearing a
    photograph laid over its extent, so there the photograph's edge would be smeared over the rest.
    An extent that does not increase is a shape fault, and is not looked at here."""
    out = []
    for axis, k in (("x", 0), ("z", 1)):
        low, high = extent[axis]
        if not high > low:
            continue
        least, most = min(p[k] for p in outline), max(p[k] for p in outline)
        if least < low - OVERHEAD_EXTENT_TOLERANCE or most > high + OVERHEAD_EXTENT_TOLERANCE:
            out.append(f"{part}.extent.{axis} covers {low} m to {high} m, but the outline runs from {least} m to {most} m "
                       f"along {axis}, more than {OVERHEAD_EXTENT_TOLERANCE * 1000:g} mm outside it")
    return out


def survey_record(room):
    lay = atlas_step.layout(room)
    rel = room.survey["relief"]
    outputs = room.survey["outputs"]
    x0, x1, z0, z1 = room.bbox()
    files = {}
    for name in output_files(room):
        path = os.path.join("proj", name)
        if os.path.exists(path):
            files[name] = dict(bytes=os.path.getsize(path), sha256=sha256(path))
    # The detail tiles' index lives inside the detail folder, so it is not one of `files` (whose
    # keys are plain names in the room's folder): the detail block carries its size and hash.
    index_path = os.path.join("proj", detail_folder(room), DETAIL_INDEX)
    index = _json(index_path)
    strips = {s["wall"]["id"]: s for s in lay["strips"]}
    walls = []
    for w in room.walls:
        # One per outline segment, in outline order: that is how a reader pairs walls with the
        # outline. An open segment has no elevation, so no strip and no relief (record_faults).
        s = strips.get(w["id"])
        walls.append(dict(id=w["id"], reliefId=room.relief_id(w) if s else None, length=w["length"],
                          height=w["height"], kind=w["segment"]["kind"],
                          atlas=[s["x"], s["y"], s["w"], lay["row"]] if s else None))
    record = dict(
        schemaVersion=SCHEMA_VERSION, slug=room.cfg["slug"], revision=room.survey["publish"].get("revision"),
        captured=room.cfg["source"]["captured"], configSha256=room.sha256, methodRevision=room.revision,
        tools=dict(tools_state(), relief=node_records()),
        linkedInputs=linked_inputs(),
        glassScan=glass_scan(),
        room=dict(name=room.cfg["name"], venue=room.cfg["venue"], ceilingHeight=room.cfg["ceiling"]["height"],
                  outline=[[x, z] for x, z in room.cfg["walls"]["vertices"]]),
        atlas=dict(size=[lay["width"], lay["height"]], ppm=lay["ppm"], vRange=lay["vRange"], row=lay["row"],
                   files=largest_first(outputs["walls"]),
                   alpha="255 - 127 * glass", alphaFrom=(_json("build/atlas.json") or {}).get("alphaFrom"), packing=lay["packing"],
                   writeOrder=[s["wall"]["id"] for s in lay["strips"]]),
        detail=None if index is None else dict(
            folder=detail_folder(room), texelMetres=index["texelMetres"], tileTexels=index["tileTexels"],
            gutterTexels=index["gutterTexels"], tiles=index["tiles"], totalBytes=index["totalBytes"],
            index=dict(file=DETAIL_INDEX, bytes=os.path.getsize(index_path), sha256=sha256(index_path))),
        walls=walls,
        relief=dict(container=rel["container"], file=outputs["relief"], ppm=rel["ppm"],
                    vRange=rel["vRange"], depthRange=rel["depthRange"], simplifyError=rel["simplifyError"],
                    order=[room.relief_id(w) for w in room.relief_order()]),
        ceiling=dict(extent=dict(x=[x0, x1], z=[z0, z1]), orientation=OVERHEAD_ORIENTATION,
                     files=largest_first(outputs.get("ceiling", []))),
        floor=dict(extent=floor_extent(room), orientation=OVERHEAD_ORIENTATION,
                   files=largest_first(outputs.get("floor", []))),
        openings=[dict(id=o["id"], wall=o["wall"], glazing=o["glazing"],
                       planes=o.get("glass", {}).get("planes"), frostedBelow=o.get("glass", {}).get("frostedBelow"))
                  for o in room.cfg["openings"] if o["kind"] == "window" and o["glazing"] != "none"],
        files=files,
    )
    cr = room.survey.get("ceilingRelief")
    if cr:
        record["ceiling"]["relief"] = dict(file=room.survey["outputs"]["ceilingRelief"], id=cr["id"], ppm=cr["ppm"],
                                           reference=room.cfg["ceiling"]["height"], heightRange=cr["heightRange"],
                                           convention="u = planner x, v = planner z, y = reference - depth")
    return record


def reader_faults(room, record):
    """record_faults for a room that publishes its record (survey.outputs.manifest); none for a
    room that does not, since no reader is given its record (the Grand Hall). It judges the record
    as the reader will read it, after JSON (a tuple is then a list, as in the published file)."""
    return record_faults(json.loads(json.dumps(record))) if room.survey["outputs"].get("manifest") else []


def write_record(room):
    record = survey_record(room)
    os.makedirs("build", exist_ok=True)
    with open("build/survey.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=1)
        f.write("\n")
    for fault in reader_faults(room, record):
        print(f"survey.json: the web's reader would refuse this record: {fault}")
    return record


def publish(room, dest):
    """Copies the outputs (and survey.json when the config publishes one) to dest."""
    record = write_record(room)
    problems = publish_problems(record) + [f"survey.json: {fault}" for fault in reader_faults(room, record)]
    if problems:
        raise SystemExit("publish refused (nothing copied):\n" + "\n".join(f"  - {p}" for p in problems))
    os.makedirs(dest, exist_ok=True)
    copied = []
    for name in output_files(room):
        shutil.copyfile(os.path.join("proj", name), os.path.join(dest, name))
        copied.append(name)
    folder = detail_folder(room)
    shutil.rmtree(os.path.join(dest, folder), ignore_errors=True)
    shutil.copytree(os.path.join("proj", folder), os.path.join(dest, folder))
    copied.append(folder + "/" + DETAIL_INDEX)
    manifest = room.survey["outputs"].get("manifest")
    if manifest:
        shutil.copyfile("build/survey.json", os.path.join(dest, manifest))
        copied.append(manifest)
    for name in copied:
        print(sha256(os.path.join(dest, name))[:16], name)
    return record

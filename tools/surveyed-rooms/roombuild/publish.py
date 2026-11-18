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
import hashlib
import json
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
# the room's folder, a room or a venue is a slug, a relief id fits GHR1's 12-byte field.
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RELIEF_ID = re.compile(r"^[\x21-\x7e]{1,12}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
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


def record_faults(record):
    """What the web's reader would refuse in a record: survey-record.ts's shapes and cross-checks,
    as far as a build can get them wrong (an outline that crosses itself is check_room's to
    refuse). The reader stays the authority; a fault here stops a room publishing its record."""
    out = []
    files = record.get("files") or {}
    if record.get("schemaVersion") != SCHEMA_VERSION:
        out.append(f"schemaVersion is {record.get('schemaVersion')!r}; the reader reads {SCHEMA_VERSION}")
    if not SLUG.match(str(record.get("slug"))):
        out.append(f"slug {record.get('slug')!r} is not a room slug")
    revision = record.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        out.append(f"revision is {revision!r}; it must be an integer from 1 (survey.publish.revision)")
    if not ISO_DATE.match(str(record.get("captured"))):
        out.append(f"captured {record.get('captured')!r} is not an ISO date")
    room = record.get("room") or {}
    if not room.get("name"):
        out.append("room.name is empty")
    if not SLUG.match(str(room.get("venue"))):
        out.append(f"room.venue {room.get('venue')!r} is not a venue slug")
    if not (isinstance(room.get("ceilingHeight"), (int, float)) and room["ceilingHeight"] > 0):
        out.append(f"room.ceilingHeight is {room.get('ceilingHeight')!r}")
    outline = room.get("outline") or []
    if len(outline) < 3:
        out.append(f"room.outline has {len(outline)} vertices; a room needs at least 3")
    elif sum(outline[(i + 1) % len(outline)][0] * p[1] - p[0] * outline[(i + 1) % len(outline)][1] for i, p in enumerate(outline)) <= 0:
        out.append("room.outline is clockwise seen from above; outlines run counter-clockwise (from +x towards -z)")

    atlas, walls = record["atlas"], record["walls"]
    span = (atlas["vRange"][1] - atlas["vRange"][0]) * atlas["ppm"]
    if abs(atlas["row"] - span) > ATLAS_ROW_TOLERANCE:
        out.append(f"atlas.row is {atlas['row']} texels, but vRange at {atlas['ppm']} texels per metre is {span:.2f}")
    if not atlas.get("files"):
        out.append("atlas.files names no atlas image")
    if len(outline) >= 3 and len(walls) != len(outline):
        out.append(f"walls: {len(walls)} walls for an outline of {len(outline)} segments")
    for key in ("id", "reliefId"):
        seen = [w[key] for w in walls if w[key] is not None]
        out += [f"walls: {key} {v!r} is used twice" for v in sorted({v for v in seen if seen.count(v) > 1})]
    for i, w in enumerate(walls):
        name = f"wall {w['id']!r}"
        if w.get("kind") not in WALL_KINDS:
            out.append(f"{name}: kind {w.get('kind')!r}")
        if not (isinstance(w.get("height"), (int, float)) and w["height"] > 0):
            out.append(f"{name}: height {w.get('height')!r}")
        if i < len(outline) and len(outline) >= 3 and abs(w["length"] - _segment_length(outline, i)) > WALL_LENGTH_TOLERANCE + 1e-9:
            out.append(f"{name} is {w['length']} m long but outline segment {i} is {_segment_length(outline, i):.4f} m")
        if w["atlas"] is None or w["reliefId"] is None:
            out.append(f"{name} has no strip in the atlas and no relief (an open segment has no elevation): "
                       "the reader needs both for every outline segment")
            continue
        if isinstance(w.get("height"), (int, float)) and w["height"] > atlas["vRange"][1] + HEIGHT_TOLERANCE:
            out.append(f"{name} is {w['height']} m high, but the atlas's strips cover heights up to {atlas['vRange'][1]} m "
                       f"(vRange), more than {HEIGHT_TOLERANCE * 1000:g} mm short of it")
        if not RELIEF_ID.match(w["reliefId"]):
            out.append(f"{name}: relief id {w['reliefId']!r} is not 1 to 12 printable ASCII characters")
        x, y, width, height = w["atlas"]
        if x + width > atlas["size"][0] or y + height > atlas["size"][1]:
            out.append(f"{name}: strip {w['atlas']} leaves the {atlas['size'][0]} x {atlas['size'][1]} atlas")
        if height != atlas["row"]:
            out.append(f"{name}: strip is {height} texels high but the atlas's row is {atlas['row']}")
        if w["length"] * atlas["ppm"] > width + 1e-6:
            out.append(f"{name} ({w['length']} m at {atlas['ppm']} texels per metre) is wider than its {width}-texel strip")
        out += [f"{name}: strip overlaps wall {p['id']!r}'s" for p in walls[:i] if p["atlas"] is not None and _overlap(p["atlas"], w["atlas"])]
    relief_ids = [w["reliefId"] for w in walls if w["reliefId"] is not None]
    order = record["relief"]["order"]
    if sorted(order) != sorted(relief_ids):
        out.append(f"relief.order {order} must list each wall's relief id exactly once ({relief_ids})")
    if record["relief"].get("container") != "GHR1":
        out.append(f"relief.container is {record['relief'].get('container')!r}")

    lists = [("atlas", atlas.get("files") or []), ("ceiling", record["ceiling"]["files"]), ("floor", record["floor"]["files"])]
    named = [(f"{part}.files", name) for part, names in lists for name in names] + [("relief.file", record["relief"]["file"])]
    if record["ceiling"].get("relief"):
        named.append(("ceiling.relief.file", record["ceiling"]["relief"]["file"]))
    for where, name in named:
        if name not in files:
            out.append(f"{where} names {name!r}, which is missing from files (not built?)")
    for name, entry in files.items():
        if not FILE_NAME.match(name):
            out.append(f"files: {name!r} is not a plain file name")
        if not SHA256.match(str(entry.get("sha256"))):
            out.append(f"files: {name!r} has no SHA-256")
    for part, names in lists:
        out += [f"{part}.files names {name!r} twice" for name in sorted({n for n in names if names.count(n) > 1})]
        for larger, smaller in zip(names, names[1:]):
            if larger in files and smaller in files and files[smaller]["bytes"] > files[larger]["bytes"]:
                out.append(f"{part}.files must list the largest image first, but {smaller!r} ({files[smaller]['bytes']} bytes) "
                           f"follows {larger!r} ({files[larger]['bytes']} bytes)")
    reach = dict(x=[p[0] for p in outline], z=[p[1] for p in outline]) if len(outline) >= 3 else None
    for part in ("ceiling", "floor"):
        extent = record[part]["extent"]
        if not (extent["x"][1] > extent["x"][0] and extent["z"][1] > extent["z"][0]):
            out.append(f"{part}.extent {extent} does not increase")
        elif reach is not None:
            # The floor and a flat ceiling are the outline wearing a photograph laid over its extent:
            # where the outline reaches past it, the photograph's edge is smeared over the rest.
            for axis in ("x", "z"):
                low, high = extent[axis]
                least, most = min(reach[axis]), max(reach[axis])
                if least < low - OVERHEAD_EXTENT_TOLERANCE or most > high + OVERHEAD_EXTENT_TOLERANCE:
                    out.append(f"{part}.extent.{axis} covers {low} m to {high} m, but the outline runs from {least} m to {most} m "
                               f"along {axis}, more than {OVERHEAD_EXTENT_TOLERANCE * 1000:g} mm outside it")
        if record[part].get("orientation", OVERHEAD_ORIENTATION) != OVERHEAD_ORIENTATION:
            out.append(f"{part}.orientation is {record[part]['orientation']!r}")
    # A ceiling without a relief is drawn flat at the room's ceiling height, which must then be where
    # the walls end. With a relief it is drawn from its measured heights and the room's is a reference.
    heights = [w["height"] for w in walls if isinstance(w.get("height"), (int, float))]
    if not record["ceiling"].get("relief") and heights and isinstance(room.get("ceilingHeight"), (int, float)) \
            and abs(room["ceilingHeight"] - max(heights)) > HEIGHT_TOLERANCE:
        out.append(f"room.ceilingHeight is {room['ceilingHeight']} m, but the tallest wall is {max(heights)} m high and the ceiling "
                   f"has no relief: a flat ceiling must meet the walls' tops to within {HEIGHT_TOLERANCE * 1000:g} mm")
    out += [f"{where} is the absolute path {value!r}: a published record names nothing on the build machine" if MACHINE_PATH.match(value)
            else f"{where} holds an absolute path ({value!r}): a published record names nothing on the build machine"
            for where, value in machine_paths(record)]
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
    room that does not, since no reader is given its record (the Grand Hall)."""
    return record_faults(record) if room.survey["outputs"].get("manifest") else []


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

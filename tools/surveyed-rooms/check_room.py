"""Checks a surveyed-room config: against room.schema.json, then for geometric sense.

Usage: python -X utf8 -I check_room.py <room.json> [--manifest <twin manifest.json>]

Schema: a built-in validator for the subset of JSON Schema that room.schema.json uses (it
refuses any other keyword, so the schema stays inside it); when the `jsonschema` package can be
imported (not under -I), the schema is also checked with its Draft 2020-12 validator.
Geometry: a closed, simple outline running counter-clockwise with positive area; unique ids;
openings inside their walls and not overlapping; edits inside their walls, with their sources;
fittings, occluders, columns, domes and ceiling or floor regions inside the outline; survey
views covering the walls. With --manifest, every station must exist, lie inside the outline
(role room) or in its opening's doorway (role doorway), and the mesh hash must match.
Exit status 1 if anything is wrong; warnings do not fail.
"""
import argparse
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 1e-6               # metres: numerical slack for "inside the wall"
DOORWAY_REACH = 2.0      # a doorway station may stand this far beyond its wall's face
DOORWAY_SLACK = 0.1      # and this far past the opening's jambs
ON_WALL = 0.05           # an opening's centreE57 must lie this close to its wall's face
ANCHOR_LIMIT = 0.05      # a survey anchor may sit this far from its corner


# ---------------------------------------------------------------------------
# A small JSON Schema validator for the subset room.schema.json uses.
# ---------------------------------------------------------------------------

ANNOTATIONS = {"$schema", "$id", "$defs", "$comment", "title", "description", "default", "examples"}
KEYWORDS = {"type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "enum",
            "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "minLength", "$ref",
            "anyOf", "oneOf"}


def _is_type(value, name):
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return isinstance(value, bool)
    if name == "null":
        return value is None
    if isinstance(value, bool):
        return False
    if name == "integer":
        return isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    if name == "number":
        return isinstance(value, (int, float))
    raise ValueError(f"unknown type {name}")


def _json_equal(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_json_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_json_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def validate(value, schema, root, path="$"):
    """Errors (path, message) of `value` against `schema`."""
    unknown = set(schema) - KEYWORDS - ANNOTATIONS
    if unknown:
        raise ValueError(f"schema at {path} uses unsupported keywords {sorted(unknown)}")
    errors = []
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            raise ValueError(f"unsupported $ref {ref}")
        errors += validate(value, root["$defs"][ref[len("#/$defs/"):]], root, path)
    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is_type(value, n) for n in names):
            return errors + [(path, f"expected {' or '.join(names)}, got {json.dumps(value)[:60]}")]
    if "const" in schema and not _json_equal(value, schema["const"]):
        errors.append((path, f"must be {json.dumps(schema['const'])}"))
    if "enum" in schema and not any(_json_equal(value, e) for e in schema["enum"]):
        errors.append((path, f"{json.dumps(value)[:60]} is not one of {schema['enum']}"))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append((path, f"{value} < minimum {schema['minimum']}"))
        if "maximum" in schema and value > schema["maximum"]:
            errors.append((path, f"{value} > maximum {schema['maximum']}"))
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append((path, f"{value} must exceed {schema['exclusiveMinimum']}"))
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            errors.append((path, f"{value} must be below {schema['exclusiveMaximum']}"))
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append((path, f"shorter than {schema['minLength']}"))
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append((path, f"{value!r} does not match {schema['pattern']}"))
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append((path, f"fewer than {schema['minItems']} items"))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append((path, f"more than {schema['maxItems']} items"))
        if "items" in schema:
            for i, item in enumerate(value):
                errors += validate(item, schema["items"], root, f"{path}[{i}]")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append((path, f"missing {key}"))
        for key, item in value.items():
            if key in props:
                errors += validate(item, props[key], root, f"{path}.{key}")
            elif "additionalProperties" in schema:
                extra = schema["additionalProperties"]
                if extra is False:
                    errors.append((path, f"unexpected property {key}"))
                elif isinstance(extra, dict):
                    errors += validate(item, extra, root, f"{path}.{key}")
    if "anyOf" in schema:
        results = [validate(value, s, root, path) for s in schema["anyOf"]]
        if all(results):
            errors.append((path, "matches none of anyOf: " + "; ".join(r[0][1] for r in results)))
    if "oneOf" in schema:
        results = [validate(value, s, root, path) for s in schema["oneOf"]]
        passed = sum(1 for r in results if not r)
        if passed != 1:
            detail = "; ".join(r[0][1] for r in results if r) if passed == 0 else f"{passed} branches match"
            errors.append((path, f"must match exactly one of oneOf ({detail})"))
    return errors


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def _segments_cross(p, q, r, s):
    """Whether closed segments pq and rs share a point."""
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(v) < 1e-12 else (1 if v > 0 else -1)

    def on(a, b, c):
        return min(a[0], b[0]) - 1e-12 <= c[0] <= max(a[0], b[0]) + 1e-12 and min(a[1], b[1]) - 1e-12 <= c[1] <= max(a[1], b[1]) + 1e-12

    o1, o2, o3, o4 = orient(p, q, r), orient(p, q, s), orient(r, s, p), orient(r, s, q)
    if o1 != o2 and o3 != o4:
        return True
    return (o1 == 0 and on(p, q, r)) or (o2 == 0 and on(p, q, s)) or (o3 == 0 and on(r, s, p)) or (o4 == 0 and on(r, s, q))


class Report:
    def __init__(self):
        self.errors, self.warnings, self.facts = [], [], []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def fact(self, msg):
        self.facts.append(msg)


def check_unique(rep, label, items, key="id"):
    seen = set()
    for item in items:
        if item[key] in seen:
            rep.error(f"{label}: duplicate id {item[key]}")
        seen.add(item[key])
    return seen


def check_outline(rep, room):
    verts = room["walls"]["vertices"]
    segs = room["walls"]["segments"]
    n = len(verts)
    if len(segs) != n:
        rep.error(f"walls: {n} vertices but {len(segs)} segments (segment i runs from vertex i to i + 1, the last closes the outline)")
        return False
    for i in range(n):
        a, b = verts[i], verts[(i + 1) % n]
        if math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6:
            rep.error(f"walls: segment {segs[i]['id']} has no length (vertices {i} and {(i + 1) % n} coincide)")
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            if _segments_cross(verts[i], verts[(i + 1) % n], verts[j], verts[(j + 1) % n]):
                rep.error(f"walls: segments {segs[i]['id']} and {segs[j]['id']} cross or touch: the outline is not simple")
    for i in range(n):
        a, b, c = verts[i - 1], verts[i], verts[(i + 1) % n]
        u = (b[0] - a[0], b[1] - a[1])
        v = (c[0] - b[0], c[1] - b[1])
        cross = u[0] * v[1] - u[1] * v[0]
        dot = u[0] * v[0] + u[1] * v[1]
        if abs(cross) < 1e-12 and dot < 0:
            rep.error(f"walls: the outline doubles back at vertex {i}")
    area = roomlib.signed_area(verts)
    if area <= 0:
        rep.error(f"walls: signed area {area:.3f} m2; the outline must run counter-clockwise seen from above (from +x towards -z)")
    perimeter = sum(math.hypot(verts[(i + 1) % n][0] - verts[i][0], verts[(i + 1) % n][1] - verts[i][1]) for i in range(n))
    rep.fact(f"outline: {n} walls, area {abs(area):.3f} m2, perimeter {perimeter:.3f} m")
    return area > 0 and not rep.errors


def inside(room, x, z):
    return roomlib.point_in_polygon(room["walls"]["vertices"], x, z)


def check_openings(rep, room, wmap):
    openings = {o["id"]: o for o in room["openings"]}
    spans = {}
    for o in room["openings"]:
        w = wmap.get(o["wall"])
        if w is None:
            rep.error(f"opening {o['id']}: no wall {o['wall']}")
            continue
        if ("centre" in o) == ("centreE57" in o):
            rep.error(f"opening {o['id']}: give exactly one of centre and centreE57")
            continue
        off = roomlib.opening_offset(room, o, wmap)
        if abs(off) > ON_WALL:
            rep.error(f"opening {o['id']}: centreE57 lies {off:+.3f} m off its wall's face (limit {ON_WALL} m)")
        c = roomlib.opening_centre(room, o, wmap)
        u0, u1 = c - o["width"] / 2, c + o["width"] / 2
        top = roomlib.opening_top(o)
        if u0 < -TOL or u1 > w["length"] + TOL:
            rep.error(f"opening {o['id']}: u {u0:.3f}..{u1:.3f} runs outside wall {w['id']} (0..{w['length']:.3f})")
        if not o["sill"] < o["head"] <= top:
            rep.error(f"opening {o['id']}: sill {o['sill']} must lie below head {o['head']}")
        if top > w["height"] + TOL:
            rep.error(f"opening {o['id']}: top {top:.3f} is above wall {w['id']}'s height {w['height']}")
        if o["headShape"] == "segmental" and "headRise" not in o:
            rep.error(f"opening {o['id']}: a segmental head needs headRise")
        if o["headShape"] != "segmental" and "headRise" in o:
            rep.error(f"opening {o['id']}: headRise applies only to a segmental head")
        if o["kind"] == "window" and o["glazing"] == "none":
            rep.warn(f"opening {o['id']}: a window with glazing none")
        if o["kind"] == "arch" and o["glazing"] != "none":
            rep.warn(f"opening {o['id']}: an open arch with glazing {o['glazing']}")
        reveal = o.get("reveal", {})
        if "sashHalfWidth" in reveal and "sashInset" in reveal:
            rep.error(f"opening {o['id']}: give sashHalfWidth or sashInset, not both")
        if reveal.get("sashHalfWidth", 0) > o["width"] / 2 + TOL:
            rep.error(f"opening {o['id']}: sash half-width {reveal['sashHalfWidth']} exceeds half the opening")
        if reveal.get("sashInset", 0) >= o["width"] / 2:
            rep.error(f"opening {o['id']}: sash inset {reveal['sashInset']} closes the opening")
        twin = reveal.get("glassDepthFrom")
        if twin is not None and (twin not in openings or twin == o["id"]):
            rep.error(f"opening {o['id']}: glassDepthFrom {twin} is not another opening")
        spans.setdefault(o["wall"], []).append((u0, u1, o["id"]))
        rep.fact(f"opening {o['id']:<17} {o['wall']:<10} u {u0:7.3f}..{u1:7.3f}  v {o['sill']:.3f}..{top:.3f}  {o['kind']}/{o['headShape']}/{o['glazing']}")
    for wall, items in spans.items():
        items.sort()
        for (a0, a1, a), (b0, b1, b) in zip(items, items[1:]):
            if b0 < a1 - TOL:
                rep.error(f"openings {a} and {b} overlap on wall {wall}")
    return openings


def check_edits(rep, room, wmap, openings):
    for k, e in enumerate(room["edits"]):
        label = f"edit {k} ({e['type']})"
        if e["type"] == "floor-refill":
            if not inside(room, *e["centre"]):
                rep.error(f"{label}: centre {e['centre']} is outside the outline")
            continue
        w = wmap.get(e["wall"])
        if w is None:
            rep.error(f"{label}: no wall {e['wall']}")
            continue
        try:
            u0, u1 = (roomlib.resolve_u(room, r, openings, wmap) for r in e["u"])
        except KeyError as missing:
            rep.error(f"{label}: unknown opening {missing}")
            continue
        v0, v1 = e["v"]
        if not (-TOL <= u0 < u1 <= w["length"] + TOL):
            rep.error(f"{label}: u {u0:.3f}..{u1:.3f} is not inside wall {w['id']} (0..{w['length']:.3f})")
        if not (-TOL <= v0 < v1 <= w["height"] + TOL):
            rep.error(f"{label}: v {v0}..{v1} is not inside wall {w['id']} (0..{w['height']})")
        if e["type"] == "patch":
            if e["mode"] == "shift":
                if "by" not in e or "about" in e:
                    rep.error(f"{label}: a shift patch takes `by`, not `about`")
                    continue
                try:
                    by = roomlib.resolve_shift(room, e["by"], openings, wmap)
                except KeyError as missing:
                    rep.error(f"{label}: unknown opening {missing}")
                    continue
                s0, s1 = u0 + by, u1 + by
            else:
                if "about" not in e or "by" in e:
                    rep.error(f"{label}: a mirror patch takes `about`, not `by`")
                    continue
                s0, s1 = 2 * e["about"] - u1, 2 * e["about"] - u0
            if s0 < -TOL or s1 > w["length"] + TOL:
                rep.error(f"{label}: its source u {s0:.3f}..{s1:.3f} runs outside wall {w['id']}")
            elif max(u0, s0) < min(u1, s1) - TOL:
                rep.warn(f"{label}: its source overlaps the area it covers")
            rep.fact(f"{label} {w['id']:<10} u {u0:7.3f}..{u1:7.3f} from {s0:7.3f}..{s1:7.3f}  v {v0}..{v1}")
        else:
            if e.get("leafPlane", 0) > e["depth"] + TOL:
                rep.error(f"{label}: leafPlane {e['leafPlane']} lies behind the recess ({e['depth']})")
            rep.fact(f"{label} {w['id']:<10} u {u0:7.3f}..{u1:7.3f}  v {v0}..{v1}  depth {e['depth']}")


def check_stations(rep, room, wmap, openings, manifest):
    if manifest is None:
        rep.warn("stations: not placed (no --manifest)")
        return
    nodes = {n["id"]: n for n in manifest["nodes"]}
    roles = {}
    for s in room["stations"]:
        roles[s["role"]] = roles.get(s["role"], 0) + 1
        node = nodes.get(s["id"])
        if node is None:
            rep.error(f"station {s['id']}: not in the manifest")
            continue
        X, Y, Z = node["pose"]["t"]
        x, y, z = roomlib.to_planner(room, X, Y, Z)
        if not 1.0 <= y <= 2.0:
            rep.warn(f"station {s['id']}: lens {y:.3f} m above this room's floor (a tripod stands 1.4-1.6 m)")
        if s["role"] == "room":
            if not inside(room, x, z):
                d = roomlib.distance_to_outline(room["walls"]["vertices"], x, z)
                rep.error(f"station {s['id']}: at ({x:.3f}, {z:.3f}), {d:.3f} m outside the outline")
            if "opening" in s:
                rep.warn(f"station {s['id']}: a room station names an opening")
        elif s["role"] == "doorway":
            o = openings.get(s.get("opening"))
            if o is None:
                rep.error(f"station {s['id']}: a doorway station must name an opening in this room")
                continue
            w = wmap[o["wall"]]
            cX, cY = w["cornerE57"]
            u = (X - cX) * w["uE57"][0] + (Y - cY) * w["uE57"][1]
            depth = -((X - cX) * w["normalE57"][0] + (Y - cY) * w["normalE57"][1])   # + beyond the face
            c = roomlib.opening_centre(room, o, wmap)
            half = o["width"] / 2
            if abs(u - c) > half + DOORWAY_SLACK or not -ON_WALL <= depth <= DOORWAY_REACH:
                rep.error(f"station {s['id']}: {u - c:+.3f} m along and {depth:.3f} m beyond opening {o['id']}, "
                          f"not in its doorway (half-width {half:.3f} + {DOORWAY_SLACK}, reach {DOORWAY_REACH} m)")
            else:
                rep.fact(f"station {s['id']}: doorway {o['id']}, {u - c:+.3f} m along, {depth:.3f} m beyond the face")
        else:
            if not s.get("note"):
                rep.error(f"station {s['id']}: an outside station needs a note saying why it is kept")
    rep.fact("stations: " + ", ".join(f"{n} {r}" for r, n in sorted(roles.items())))
    mesh = room["source"].get("mesh")
    want = room["source"].get("meshSha256")
    have = manifest.get("contentHashes", {}).get(mesh)
    if want and have and want != have:
        rep.error(f"source: meshSha256 {want[:12]} differs from the manifest's {have[:12]} for {mesh}")
    elif want and have:
        rep.fact(f"source: mesh hash matches the manifest ({want[:16]})")


def check_room_contents(rep, room, wmap):
    verts = room["walls"]["vertices"]
    top = max(w["height"] for w in wmap.values())
    ceiling = room["ceiling"]
    roof = max([ceiling["height"]] + [r["height"] for r in ceiling.get("regions", [])]
               + [d.get("crownHeight", 0) for d in ceiling.get("domes", [])])
    if top > max(ceiling["height"], max([r["height"] for r in ceiling.get("regions", [])], default=0)) + TOL:
        rep.warn(f"walls: a wall rises to {top} m, above every ceiling field")
    for r in ceiling.get("regions", []):
        if not all(inside(room, *p) or roomlib.distance_to_outline(verts, *p) < TOL for p in r["outline"]):
            rep.error(f"ceiling region {r['id']}: outline leaves the room")
    for d in ceiling.get("domes", []):
        if not inside(room, *d["centre"]):
            rep.error(f"dome {d['id']}: centre outside the outline")
        elif roomlib.distance_to_outline(verts, *d["centre"]) < d["footRadius"]:
            rep.error(f"dome {d['id']}: its foot ring (r {d['footRadius']}) crosses a wall")
        if "plateHeight" in d and "crownHeight" in d and d["plateHeight"] > d["crownHeight"]:
            rep.error(f"dome {d['id']}: plate above the crown")
        if d.get("crownHeight", math.inf) < ceiling["height"]:
            rep.error(f"dome {d['id']}: crown below the ceiling")
        if "axisE57" in d:
            ax, az = roomlib.to_planner(room, *d["axisE57"])
            rep.fact(f"dome {d['id']}: measured axis {math.hypot(ax - d['centre'][0], az - d['centre'][1]) * 1000:.1f} mm from the drawn centre")
    for lvl in room["floor"]["levels"]:
        for p in lvl.get("outline", []):
            if not (inside(room, *p) or roomlib.distance_to_outline(verts, *p) < TOL):
                rep.error(f"floor level {lvl['id']}: outline leaves the room")
    for c in room["freeStanding"]:
        a = math.radians(c.get("rotationDeg", 0.0))
        hx, hz = c["size"][0] / 2, c["size"][1] / 2
        corners = [(c["centre"][0] + sx * hx * math.cos(a) - sz * hz * math.sin(a),
                    c["centre"][1] + sx * hx * math.sin(a) + sz * hz * math.cos(a)) for sx in (-1, 1) for sz in (-1, 1)]
        if not all(inside(room, *p) for p in corners):
            rep.error(f"free-standing {c['id']}: footprint leaves the room")
    for f in room["fittings"]:
        x, y, z = f["position"]
        if not inside(room, x, z):
            rep.error(f"fitting {f['id']}: outside the outline")
        if not f["lowest"] < y:
            rep.error(f"fitting {f['id']}: lowest point {f['lowest']} not below its body ({y})")
        if "suspension" in f and not y <= f["suspension"] <= roof + TOL:
            rep.error(f"fitting {f['id']}: suspension {f['suspension']} not between its body ({y}) and the highest ceiling ({roof})")
        if "radius" in f and roomlib.distance_to_outline(verts, x, z) < f["radius"]:
            rep.warn(f"fitting {f['id']}: its reach touches a wall")
    fitting_ids = {f["id"] for f in room["fittings"]}
    for oc in room["occluders"]:
        x, z = roomlib.to_planner(room, *oc["centreE57"])
        z0, z1 = oc["zE57"]
        if not inside(room, x, z):
            rep.error(f"occluder {oc['id']}: outside the outline")
        if not z0 < z1 or z0 < room["transform"]["floorZ"]:
            rep.error(f"occluder {oc['id']}: Z span {z0}..{z1} is empty or below the floor")
        if "fitting" in oc and oc["fitting"] not in fitting_ids:
            rep.error(f"occluder {oc['id']}: no fitting {oc['fitting']}")
    levels = room["walls"].get("elevation", {}).get("levels", {})
    for name, h in levels.items():
        if not 0 <= h <= top + TOL:
            rep.error(f"elevation level {name}: {h} is outside the walls' height")
    for light in room.get("concealedLights", []):
        if light["walls"] != "all":
            for wid in light["walls"]:
                if wid not in wmap:
                    rep.error(f"concealed light {light['id']}: no wall {wid}")
        if "level" in light and levels.get(light["level"]) not in (None, light["height"]):
            rep.error(f"concealed light {light['id']}: height {light['height']} differs from level {light['level']} ({levels[light['level']]})")
    if room.get("site", {}).get("daylightChannel") == "windows" and not any(
            o["kind"] == "window" and o["glazing"] in ("clear", "frosted-lower", "sheer") for o in room["openings"]):
        rep.warn("site: daylight through windows, but no window lets daylight in")


def check_survey(rep, room, wmap):
    survey = room["survey"]
    wv = survey["wallViews"]
    order = wv.get("order", [])
    for wid in order:
        if wid not in wmap:
            rep.error(f"survey.wallViews.order: no wall {wid}")
    if order and len(set(order)) != len(order):
        rep.error("survey.wallViews.order: a wall is listed twice")
    missing = [w for w in wmap if order and w not in order and wmap[w]["segment"]["kind"] != "open"]
    if missing:
        rep.warn(f"survey.wallViews.order leaves out {missing}: they get no elevation")
    for w in wmap.values():
        if not w["tiles"] and "tileMaxLength" not in wv:
            rep.error(f"wall {w['id']}: no tile count (survey.tiles or wallViews.tileMaxLength)")
        dx = w["anchorE57"][0] - w["cornerE57"][0]
        dy = w["anchorE57"][1] - w["cornerE57"][1]
        d = math.hypot(dx, dy)
        if d > ANCHOR_LIMIT:
            rep.error(f"wall {w['id']}: survey anchor {d:.4f} m from its corner (limit {ANCHOR_LIMIT} m)")
        elif d > 0:
            along = dx * w["uE57"][0] + dy * w["uE57"][1]
            into = dx * w["normalE57"][0] + dy * w["normalE57"][1]
            rep.fact(f"wall {w['id']}: survey anchor {along * 1000:+.1f} mm along, {into * 1000:+.1f} mm into the room from its corner")
    h0, h1 = wv["heightRange"]
    tallest = max(w["height"] for w in wmap.values())
    if h0 > 0 or h1 < tallest:
        rep.error(f"survey.wallViews.heightRange {h0}..{h1} does not cover the walls (0..{tallest})")
    if not wv["near"] <= wv["eyeInset"] < wv["far"]:
        rep.error("survey.wallViews: the wall face must lie between near and far (near <= eyeInset < far)")
    cv = survey.get("ceilingView")
    if cv:
        ceiling = room["ceiling"]
        lowest = min([ceiling["height"]] + [r["height"] for r in ceiling.get("regions", [])])
        highest = max([ceiling["height"]] + [r["height"] for r in ceiling.get("regions", [])]
                      + [d.get("crownHeight", 0) for d in ceiling.get("domes", [])])
        see_from, see_to = cv["eyeHeight"] + cv["near"], cv["eyeHeight"] + cv["far"]
        if not see_from <= lowest or not see_to >= highest:
            rep.error(f"survey.ceilingView sees {see_from:.3f}..{see_to:.3f} m above the floor, "
                      f"not the whole ceiling ({lowest}..{highest} m)")
    atlas = survey.get("atlas")
    if atlas:
        ppm = atlas["ppm"]["pixels"] / atlas["ppm"]["span"]
        row = math.ceil((atlas["vRange"][1] - atlas["vRange"][0]) * ppm)
        for p in atlas["placement"]:
            w = wmap.get(p["wall"])
            if w is None:
                rep.error(f"survey.atlas: no wall {p['wall']}")
                continue
            if p["column"] + math.ceil(w["length"] * ppm) > atlas["size"] or (p["row"] + 1) * row > atlas["size"]:
                rep.error(f"survey.atlas: wall {p['wall']} does not fit at column {p['column']}, row {p['row']}")
        rep.fact(f"survey.atlas: {ppm:.3f} px/m, strips {row} px high")
    relief = survey.get("relief")
    if relief:
        for wid in relief.get("order", []):
            if wid not in wmap:
                rep.error(f"survey.relief.order: no wall {wid}")
    if not rep.errors:
        views = roomlib.wall_views(room)
        rep.fact(f"survey: {len(views)} wall tiles, {sum(v['pixels'][0] * v['pixels'][1] for v in views) / 1e6:.1f} Mpx")


def check(room, schema, manifest):
    rep = Report()
    try:
        problems = validate(room, schema, schema)
    except ValueError as exc:
        rep.error(f"schema: {exc}")
        return rep
    for path, msg in problems:
        rep.error(f"schema {path}: {msg}")
    try:
        import jsonschema  # noqa: PLC0415 - optional second opinion, absent under -I
    except ImportError:
        rep.fact("schema: built-in validator (jsonschema not importable)")
    else:
        jsonschema.Draft202012Validator.check_schema(schema)
        validator = jsonschema.Draft202012Validator(schema)
        for e in sorted(validator.iter_errors(room), key=lambda e: list(map(str, e.absolute_path))):
            rep.error(f"jsonschema {'/'.join(map(str, e.absolute_path))}: {e.message[:120]}")
        from importlib.metadata import version  # noqa: PLC0415
        rep.fact(f"schema: built-in validator and jsonschema {version('jsonschema')} (Draft 2020-12)")
    if rep.errors:
        return rep          # the geometry assumes a well-formed config
    for label, items in [("segments", room["walls"]["segments"]), ("openings", room["openings"]),
                         ("stations", room["stations"]), ("fittings", room["fittings"]),
                         ("occluders", room["occluders"]), ("freeStanding", room["freeStanding"]),
                         ("concealedLights", room.get("concealedLights", [])),
                         ("floor levels", room["floor"]["levels"]), ("domes", room["ceiling"].get("domes", [])),
                         ("ceiling regions", room["ceiling"].get("regions", []))]:
        check_unique(rep, label, items)
    if not check_outline(rep, room):
        return rep
    wmap = roomlib.wall_map(room)
    for w in wmap.values():
        rep.fact(f"wall {w['id']:<10} {w['length']:7.3f} m x {w['height']} m  {w['segment']['kind']}")
    openings = check_openings(rep, room, wmap)
    check_edits(rep, room, wmap, openings)
    check_stations(rep, room, wmap, openings, manifest)
    check_room_contents(rep, room, wmap)
    check_survey(rep, room, wmap)
    return rep


def main():
    ap = argparse.ArgumentParser(description="Validate a surveyed-room config.")
    ap.add_argument("room", help="<slug>.room.json")
    ap.add_argument("--manifest", help="the twin's manifest.json, to place the stations")
    ap.add_argument("--schema", default=os.path.join(HERE, "room.schema.json"))
    ap.add_argument("--quiet", action="store_true", help="print only problems")
    args = ap.parse_args()
    room = roomlib.load(args.room)
    schema = roomlib.load(args.schema)
    manifest = roomlib.load(args.manifest) if args.manifest else None
    rep = check(room, schema, manifest)
    if not args.quiet:
        for line in rep.facts:
            print("  " + line)
    for line in rep.warnings:
        print("WARNING " + line)
    for line in rep.errors:
        print("ERROR " + line)
    print(f"{os.path.basename(args.room)}: {'FAILED' if rep.errors else 'OK'} "
          f"({len(rep.errors)} errors, {len(rep.warnings)} warnings)")
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()

"""Proves grand-hall.room.json carries today's Grand Hall exactly.

1. Views: the config's views-walls.json and views-ceiling.json against the committed files
   (git HEAD, LF) and the checked-out copies (CRLF on Windows), by SHA-256; and the old
   generator, tools/grand-hall-survey/wall-views.py, rerun into the scratch folder, against
   the same bytes.
2. Values: every Grand Hall constant the config carries, read from the scripts and web modules
   that hold it today, compared with == (exact doubles, no tolerance).
3. Diagnostics: what changes without the survey anchors or the explicit tile counts.

Usage: python -X utf8 -I prove-grand-hall.py --scratch <dir> [--repo <worktree>]
Reads only; writes nothing outside <dir>. Exit status 1 on any mismatch.
"""
import argparse
import ast
import builtins
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SAFE_BUILTINS = {name: getattr(builtins, name)
                 for name in ("dict", "int", "float", "round", "len", "range", "list", "tuple", "abs", "max", "min", "zip")}
NP_SHIM = types.SimpleNamespace(ceil=math.ceil, sqrt=math.sqrt, radians=math.radians, tan=math.tan, pi=math.pi)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def py_constants(path):
    """Top-level assignments of a survey script, each evaluated on its own with only plain
    builtins (no open, no imports): the ones that build arrays or read files fail and are
    skipped; the constants survive."""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), path)
    ns = {"__builtins__": SAFE_BUILTINS, "np": NP_SHIM, "sys": types.SimpleNamespace(argv=["prove"])}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            try:
                exec(compile(ast.Module([node], []), path, "exec"), ns)  # noqa: S102 - the repo's own constants
            except Exception:  # noqa: BLE001 - array and file statements are expected to fail
                pass
    return ns


def text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def ts_number(src, name):
    m = re.search(rf"\b{re.escape(name)}\s*[:=]\s*(-?[0-9.]+)", src)
    if m is None:
        raise KeyError(name)
    return float(m.group(1))


class Ledger:
    def __init__(self):
        self.rows = []

    def same(self, label, source, config):
        ok = self._equal(source, config)
        self.rows.append((ok, label, source, config))
        return ok

    @staticmethod
    def _equal(a, b):
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            return len(a) == len(b) and all(Ledger._equal(x, y) for x, y in zip(a, b))
        if isinstance(a, dict) and isinstance(b, dict):
            return a.keys() == b.keys() and all(Ledger._equal(a[k], b[k]) for k in a)
        return a == b

    def print(self):
        for ok, label, source, config in self.rows:
            s = source if isinstance(source, str) else json.dumps(source)
            c = config if isinstance(config, str) else json.dumps(config)
            detail = s if ok else f"source {s} | config {c}"
            print(f"  {'ok  ' if ok else 'DIFF'} {label:<62} {detail[:120]}")
        bad = sum(1 for r in self.rows if not r[0])
        print(f"  {len(self.rows)} comparisons, {bad} differ")
        return bad == 0


def prove_views(room, repo, scratch):
    print("Views (SHA-256)")
    survey_dir = os.path.join(repo, "tools", "grand-hall-survey")
    ok = True
    outputs = [("views-walls.json", roomlib.wall_views_bytes(room)), ("views-ceiling.json", roomlib.ceiling_view_bytes(room))]
    for name, new in outputs:
        blob = subprocess.run(["git", "-C", repo, "show", f"HEAD:tools/grand-hall-survey/{name}"],
                              capture_output=True, check=True).stdout
        with open(os.path.join(survey_dir, name), "rb") as f:
            checkout = f.read()
        same_blob = new == blob
        same_checkout = new == checkout or new.replace(b"\n", b"\r\n") == checkout
        ok &= same_blob and same_checkout
        print(f"  {name}: {'IDENTICAL' if same_blob else 'DIFFERENT'} to the committed bytes; "
              f"{'identical' if same_checkout else 'DIFFERENT'} to the checkout once line ends match")
        for label, digest in [("config -> room-views (LF)", sha(new)), ("committed, git HEAD blob", sha(blob)),
                              ("checked out, as on disk", sha(checkout)),
                              ("checked out, CRLF -> LF", sha(checkout.replace(b"\r\n", b"\n"))),
                              ("config -> room-views, LF -> CRLF", sha(new.replace(b"\n", b"\r\n")))]:
            print(f"    {digest}  {label}")
        with open(os.path.join(scratch, name), "wb") as f:
            f.write(new)
    # The old generator, rerun: it writes beside __file__, so __file__ points into the scratch folder.
    old_dir = os.path.join(scratch, "old-generator")
    os.makedirs(old_dir, exist_ok=True)
    path = os.path.join(survey_dir, "wall-views.py")
    exec(compile(text(path), path, "exec"), {"__file__": os.path.join(old_dir, "wall-views.py"), "__name__": "__main__"})  # noqa: S102
    with open(os.path.join(old_dir, "views-walls.json"), "rb") as f:
        old = f.read()
    old_lf = old.replace(b"\r\n", b"\n")
    same_old = old_lf == outputs[0][1]
    ok &= same_old
    ends = "CRLF" if b"\r\n" in old else "LF"
    print(f"  old wall-views.py, rerun: {sha(old)} as written here ({ends}); {sha(old_lf)} with LF: "
          f"{'IDENTICAL' if same_old else 'DIFFERENT'} to the config's")
    return ok


def prove_values(room, repo):
    print("Values (exact ==)")
    led = Ledger()
    gh = os.path.join(repo, "tools", "grand-hall-survey")
    web = os.path.join(repo, "packages", "web", "src", "components", "grand-hall")
    wmap = roomlib.wall_map(room)
    openings = {o["id"]: o for o in room["openings"]}
    t = room["transform"]
    seg = {s["id"]: s for s in room["walls"]["segments"]}
    alias = {"fire": "fireplace"}
    views = room["survey"]["wallViews"]
    proj = room["survey"]["projection"]
    atlas = room["survey"]["atlas"]
    rel = room["survey"]["relief"]
    dome = room["ceiling"]["domes"][0]
    lattice = room["ceiling"]["lattice"]

    # --- hall-spec.ts -------------------------------------------------------
    spec = text(os.path.join(web, "hall-spec.ts"))
    L, W, Hh = ts_number(spec, "HALL_LENGTH"), ts_number(spec, "HALL_WIDTH"), ts_number(spec, "HALL_HEIGHT")
    hl, hw = L / 2, W / 2
    m = re.search(r"centre: \[(-?[0-9.]+), (-?[0-9.]+)\] as const,\s*/\*\*[^*]*\*/\s*floor: (-?[0-9.]+)", spec)
    centre, floor = [float(m.group(1)), float(m.group(2))], float(m.group(3))
    led.same("hall-spec HALL_SURVEY.centre", centre, t["centre"])
    led.same("hall-spec HALL_SURVEY.floor", floor, t["floorZ"])
    X, Y, Z = 17.83, -10.0, 3.0
    led.same("hall-spec fromSurvey(X, Y, Z) = config transform", [centre[0] - X, Z - floor, Y - centre[1]],
             list(roomlib.to_planner(room, X, Y, Z)))
    env = {"HALL_LENGTH": L, "HALL_WIDTH": W, "HALL_HALF_LENGTH": hl, "HALL_HALF_WIDTH": hw}
    walls_re = r'\{ id: "(\w+)", length: (HALL_\w+), origin: \[([^\]]+)\], tangent: \[([^\]]+)\], normal: \[([^\]]+)\] \}'
    for wall in re.finditer(walls_re, spec):
        wid = wall.group(1)
        w = wmap[wid]

        def vec(s):
            out = []
            for part in s.split(","):
                part = part.strip()
                sign = -1 if part.startswith("-") else 1
                out.append(sign * env[part.lstrip("-")] if part.lstrip("-") in env else float(part))
            return out
        origin, tangent, normal = vec(wall.group(3)), vec(wall.group(4)), vec(wall.group(5))
        led.same(f"hall-spec HALL_WALLS {wid}: length", env[wall.group(2)], w["length"])
        led.same(f"hall-spec HALL_WALLS {wid}: origin, tangent, normal (x, z)",
                 [origin[0], origin[2], tangent[0], tangent[2], normal[0], normal[2]],
                 [w["origin"][0], w["origin"][1], w["u"][0], w["u"][1], w["normal"][0], w["normal"][1]])
        led.same(f"hall-spec HALL_WALLS {wid}: height = HALL_HEIGHT", Hh, seg[wid]["height"])
    led.same("hall-spec HALL_WALLS count", len(re.findall(walls_re, spec)), len(room["walls"]["segments"]))
    led.same("hall-spec HALL_HEIGHT = ceiling.height", Hh, room["ceiling"]["height"])
    block = re.search(r"HALL_ELEVATION = \{(.*?)\} as const", spec, re.S).group(1)
    elev = room["walls"]["elevation"]
    found = re.findall(r"(\w+): (-?[0-9.]+|HALL_HEIGHT)", block)
    for name, value in found:
        led.same(f"hall-spec HALL_ELEVATION.{name}", Hh if value == "HALL_HEIGHT" else float(value),
                 elev["levels"].get(name, elev["offsets"].get(name)))
    led.same("hall-spec HALL_ELEVATION count", len(found), len(elev["levels"]) + len(elev["offsets"]))
    window_u = lambda x: hl + centre[0] - x      # noqa: E731 - hall-spec windowU, same order of operations
    door_u = lambda x: hl - centre[0] + x        # noqa: E731 - hall-spec doorU
    kinds = {"arched-window": ["window", "semicircular"], "window": ["window", "square"], "door": ["door", "square"]}
    open_re = (r'\{ id: "([\w-]+)", kind: "([\w-]+)", wall: "(\w+)", centre: (windowU|doorU)\((-?[0-9.]+)\), '
               r"width: ([0-9.]+), sill: ([0-9.]+), head: ([0-9.]+) \}")
    for o in re.finditer(open_re, spec):
        oid, kind, wall, fn, x = o.group(1), o.group(2), o.group(3), o.group(4), float(o.group(5))
        c = openings[oid]
        led.same(f"hall-spec HALL_OPENINGS {oid}: centre = {fn}({x})", window_u(x) if fn == "windowU" else door_u(x),
                 roomlib.opening_centre(room, c, wmap))
        led.same(f"hall-spec HALL_OPENINGS {oid}: kind, wall, width, sill, head",
                 kinds[kind] + [wall, float(o.group(6)), float(o.group(7)), float(o.group(8))],
                 [c["kind"], c["headShape"], c["wall"], c["width"], c["sill"], c["head"]])
    led.same("hall-spec HALL_OPENINGS count", len(re.findall(open_re, spec)), len(room["openings"]))
    for const, target in (("HALL_DOME", dome), ("HALL_COFFERS", lattice)):
        block = re.search(rf"{const} = \{{(.*?)\}} as const", spec, re.S).group(1)
        for name, value in re.findall(r"(\w+): (-?[0-9.]+)", block):
            led.same(f"hall-spec {const}.{name}", float(value), target.get(name))
    rose = {"ROSE_X": 6.5 * lattice["pitch"], "ROSE_Z": 3 * lattice["rowPitch"]}
    fittings = {f["id"]: f for f in room["fittings"]}
    ch_re = (r'\{ id: "([\w-]+)", style: "([\w-]+)", position: \[([^\]]+)\], suspension: ([\w.]+), '
             r"bottom: ([0-9.]+), radius: ([0-9.]+), glowRadius: ([0-9.]+) \}")
    for c in re.finditer(ch_re, spec):
        f = fittings[c.group(1)]
        pos = []
        for part in c.group(3).split(","):
            part = part.strip()
            sign = -1 if part.startswith("-") else 1
            pos.append(sign * rose[part.lstrip("-")] if part.lstrip("-") in rose else float(part))
        susp = {"HALL_DOME.plateHeight": dome["plateHeight"], "HALL_HEIGHT": Hh}[c.group(4)]
        led.same(f"hall-spec HALL_CHANDELIERS {c.group(1)}: position", pos, f["position"])
        if "latticeCell" in f:
            led.same(f"  lattice cell of {c.group(1)}", pos[0::2], [f["latticeCell"][0] * lattice["pitch"], f["latticeCell"][1] * lattice["rowPitch"]])
        led.same(f"hall-spec HALL_CHANDELIERS {c.group(1)}: style, suspension, bottom, radius, glow",
                 [c.group(2), susp, float(c.group(5)), float(c.group(6)), float(c.group(7))],
                 [f["style"], f["suspension"], f["lowest"], f["radius"], f["glowRadius"]])
    led.same("hall-spec HALL_CHANDELIERS count", len(re.findall(ch_re, spec)), len(room["fittings"]))

    # --- wall-views.py ------------------------------------------------------
    wv = py_constants(os.path.join(gh, "wall-views.py"))
    wv_text = text(os.path.join(gh, "wall-views.py"))
    led.same("wall-views.py PPM, FLOOR, H0, H1", [wv["PPM"], wv["FLOOR"], wv["H0"], wv["H1"]],
             [views["ppm"], t["floorZ"]] + views["heightRange"])
    led.same("wall-views.py wall order", [alias.get(k, k) for k in wv["WALLS"]], views["order"])
    for name, w in wv["WALLS"].items():
        cw = wmap[alias.get(name, name)]
        led.same(f"wall-views.py {name}: start = survey.anchorE57", list(w["start"]), list(cw["anchorE57"]))
        led.same(f"wall-views.py {name}: u, normal, length", [list(w["u"]), list(w["normal"]), w["length"]],
                 [list(cw["uE57"]), list(cw["normalE57"]), cw["length"]])
        tiles = 4 if w["length"] > 15 else 2
        led.same(f"wall-views.py {name}: tiles; and ceil(length / tileMaxLength)", [tiles, tiles],
                 [cw["tiles"], math.ceil(cw["length"] / views["tileMaxLength"])])
        led.same(f"wall-views.py {name}: file name", name, cw["name"])
    m = re.search(r"\* (-?[0-9.]+)\n\s*ey = ", wv_text)
    nf = re.search(r"near=([0-9.]+), far=([0-9.]+), modes=\['(\w+)'\]", wv_text)
    led.same("wall-views.py eye inset, near, far, modes", [float(m.group(1)), float(nf.group(1)), float(nf.group(2)), [nf.group(3)]],
             [views["eyeInset"], views["near"], views["far"], views["modes"]])

    # --- projection ---------------------------------------------------------
    pj = py_constants(os.path.join(gh, "project.py"))
    pj_text = text(os.path.join(gh, "project.py"))
    led.same("project.py CHANDELIERS = occluders (centre, radius, Z span)",
             [[list(c), r, list(z)] for c, r, z in pj["CHANDELIERS"]],
             [[o["centreE57"], o["radius"], o["zE57"]] for o in room["occluders"]])
    m = re.search(r"def project\(points, normals, station_list=None, lod=8192, cos_min=([0-9.]+), p_cos=([0-9.]+), "
                  r"q_dist=([0-9.]+), max_dist=([0-9.]+)", pj_text)
    defaults = [float(g) for g in m.groups()]
    for surface in ("walls", "ceiling", "dome", "floor"):
        p = proj[surface]
        led.same(f"project.py default max_dist used by {surface}", defaults[3], p["maxDist"])
    led.same("project.py default cos_min, p_cos, q_dist = walls", defaults[:3], [proj["walls"]["cosMin"], proj["walls"]["pCos"], proj["walls"]["qDist"]])
    for surface in ("ceiling", "dome"):
        led.same(f"project-{surface}.py default p_cos, q_dist", defaults[1:3], [proj[surface]["pCos"], proj[surface]["qDist"]])
    max_index = int(re.search(r"def stations\(max_index=(\d+)\)", pj_text).group(1))
    sweeps = list(py_constants(os.path.join(gh, "fetch_inputs.py"))["GRAND_HALL_SWEEPS"])
    depth_max = int(re.search(r"slice\(5\)\) <= (\d+)", text(os.path.join(gh, "render-depth.mjs"))).group(1))
    station_numbers = [int(s["id"][5:]) for s in room["stations"]]
    led.same("project.py stations(max_index), render-depth.mjs <= N", [max_index, depth_max], [max(station_numbers)] * 2)
    led.same("fetch_inputs.py GRAND_HALL_SWEEPS = stations", sweeps, station_numbers)
    led.same("fetch_inputs.py panorama path and size", "equirect_8192.webp" in text(os.path.join(gh, "fetch_inputs.py")),
             room["source"]["panoramas"]["path"].endswith("equirect_8192.webp") and room["source"]["panoramas"]["size"] == 8192)
    led.same("project-ceiling.py cos_min",
             float(re.search(r"cos_min=([0-9.]+)", text(os.path.join(gh, "project-ceiling.py"))).group(1)), proj["ceiling"]["cosMin"])
    dome_text = text(os.path.join(gh, "project-dome.py"))
    pd = py_constants(os.path.join(gh, "project-dome.py"))
    led.same("project-dome.py cos_min", float(re.search(r"cos_min=([0-9.]+)", dome_text).group(1)), proj["dome"]["cosMin"])
    led.same("project-dome.py XC, YC, FLOOR", [pd["XC"], pd["YC"], pd["FLOOR"]], t["centre"] + [t["floorZ"]])
    led.same("project-dome.py DOME_C = dome.axisE57", list(pd["DOME_C"]), dome["axisE57"])
    led.same("project-dome.py profile constants",
             [pd["foot"], pd["sc"], pd["sr"], pd["band"], pd["crown_r"], pd["plate_r"], pd["plate_h"], pd["crown_h"], pd["ceiling"]],
             [dome["footRadius"], dome["sphereCentre"], dome["sphereRadius"], dome["bandTopRadius"], dome["crownRadius"],
              dome["plateRadius"], dome["plateHeight"], dome["crownHeight"], room["ceiling"]["height"]])
    off = re.search(r"'proj/dome-offset\.f32', '([0-9.]+)', '([0-9.]+)'", dome_text)
    led.same("project-dome.py W, H, surface offset, profile steps",
             [[pd["W"], pd["H"]], [float(off.group(1)), float(off.group(2))], int(re.search(r"\* i / (\d+)", dome_text).group(1))],
             [room["survey"]["domePhoto"]["size"], room["survey"]["domePhoto"]["surfaceOffset"], room["survey"]["domePhoto"]["profileSteps"]])
    pf = py_constants(os.path.join(gh, "project-floor.py"))
    m = re.search(r"cos_min=([0-9.]+), p_cos=([0-9.]+), q_dist=([0-9.]+), nadir=(\w+), glare=(\d+)", text(os.path.join(gh, "project-floor.py")))
    led.same("project-floor.py L, W, XC, YC, FLOOR, PPM", [pf["L"], pf["W"], pf["XC"], pf["YC"], pf["FLOOR"], pf["PPM"]],
             [wmap["window"]["length"], wmap["end"]["length"]] + t["centre"] + [t["floorZ"], room["survey"]["floorPhoto"]["ppm"]])
    led.same("project-floor.py cos_min, p_cos, q_dist, nadir, glare",
             [float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(4) == "True", int(m.group(5))],
             [proj["floor"]["cosMin"], proj["floor"]["pCos"], proj["floor"]["qDist"], proj["floor"]["nadir"], proj["floor"]["glare"]])

    # --- corners, windows, relief, atlas, floor -----------------------------
    fc = py_constants(os.path.join(gh, "fix-corners.py"))
    for name, (axis, plane, sign) in fc["PLANES"].items():
        cw = wmap[alias.get(name, name)]
        led.same(f"fix-corners.py PLANES {name} = the outline's face", [plane, sign], [cw["cornerE57"][axis], cw["normalE57"][axis]])
    wd = py_constants(os.path.join(gh, "wall-depth.py"))
    led.same("wall-depth.py PLANES = fix-corners.py PLANES", wd["PLANES"], fc["PLANES"])
    wr = py_constants(os.path.join(gh, "window-relief.py"))
    led.same("window-relief.py WALL_Y = the window wall's face", wr["WALL_Y"], wmap["window"]["cornerE57"][1])
    for oid, kind, c, width, sill, head in wr["OPENINGS"]:
        o = openings[oid]
        led.same(f"window-relief.py OPENINGS {oid}", [c, width, sill, head, kind == "arched-window"],
                 [roomlib.opening_centre(room, o, wmap), o["width"], o["sill"], o["head"], o["headShape"] == "semicircular"])
    led.same("window-relief.py TWIN = reveal.glassDepthFrom", wr["TWIN"],
             {o["id"]: o["reveal"]["glassDepthFrom"] for o in room["openings"] if "glassDepthFrom" in o.get("reveal", {})})
    m = re.search(r"sash = ([0-9.]+) if kind == 'arched-window' else half - ([0-9.]+)", text(os.path.join(gh, "window-relief.py")))
    for o in room["openings"]:
        if o["kind"] == "window":
            r = o["reveal"]
            src = ["sashHalfWidth", float(m.group(1))] if o["headShape"] == "semicircular" else ["sashInset", float(m.group(2))]
            led.same(f"window-relief.py sash rule for {o['id']}", src,
                     ["sashHalfWidth", r["sashHalfWidth"]] if "sashHalfWidth" in r else ["sashInset", r["sashInset"]])
    pa = py_constants(os.path.join(gh, "pack-atlas.py"))
    led.same("wall-depth.py PATCHES = pack-atlas.py PATCHES", wd["PATCHES"], pa["PATCHES"])
    resolved = []
    for e in room["edits"]:
        if e["type"] == "patch":
            u0, u1 = (roomlib.resolve_u(room, r, openings, wmap) for r in e["u"])
            arg = roomlib.resolve_shift(room, e["by"], openings, wmap) if e["mode"] == "shift" else e["about"]
            resolved.append([wmap[e["wall"]]["name"], u0, u1, e["v"][0], e["v"][1], e["mode"], arg])
            if e["applies"] != ["photo", "relief"]:
                resolved[-1].append("applies differs")
    led.same("pack-atlas.py PATCHES = patch edits, resolved", [list(p) for p in pa["PATCHES"]], resolved)
    recess = next(e for e in room["edits"] if e["type"] == "recess")
    wd_text = text(os.path.join(gh, "wall-depth.py"))
    m = re.search(r"px\(DOOR_MAIN - ([0-9.]+), 0\.0\).*?px\(DOOR_MAIN \+ ([0-9.]+), DOOR_HEAD\)\s*D\[r0:r1, c0:c1\] = (-?[0-9.]+)", wd_text, re.S)
    led.same("wall-depth.py main door recess: u0, u1, v0, v1, depth",
             [wd["DOOR_MAIN"] - float(m.group(1)), wd["DOOR_MAIN"] + float(m.group(2)), 0.0, wd["DOOR_HEAD"], -float(m.group(3))],
             [roomlib.resolve_u(room, recess["u"][0], openings, wmap), roomlib.resolve_u(room, recess["u"][1], openings, wmap),
              recess["v"][0], recess["v"][1], recess["depth"]])
    led.same("wall-depth.py TOP = wallViews top", wd["TOP"], views["heightRange"][1])
    led.same("wall-depth.py floor and ceiling holds", [float(x) for x in re.findall(r"TOP - ([0-9.]+)\) \* PPM", wd_text)],
             [rel["holdFloor"], rel["holdCeiling"]])
    led.same("wall-depth.py depth clip", [float(x) for x in re.search(r"np\.clip\(fill\(D\), (-?[0-9.]+), (-?[0-9.]+)\)", wd_text).groups()],
             rel["depthRange"])
    led.same("wall-depth.py PPM / 2 = relief ppm", wd["PPM"] / 2, rel["ppm"])
    rm = text(os.path.join(gh, "relief-mesh.mjs"))
    m = re.search(r"const V_MIN = (-?[0-9.]+), V_MAX = (-?[0-9.]+), D_MIN = (-?[0-9.]+), D_MAX = (-?[0-9.]+);", rm)
    led.same("relief-mesh.mjs V and D ranges", [float(g) for g in m.groups()], rel["vRange"] + rel["depthRange"])
    led.same("relief-mesh.mjs WALLS order, default error", [re.findall(r'\["(\w+)", "\w+"\]', rm), float(re.search(r"errArg \?\? ([0-9.]+)", rm).group(1))],
             [rel["order"], rel["simplifyError"]])
    led.same("pack-atlas.py SIZE, V_MIN, V_MAX", [pa["SIZE"], pa["V_MIN"], pa["V_MAX"]], [atlas["size"]] + atlas["vRange"])
    led.same("pack-atlas.py PPM = (SIZE / 2) / W", pa["PPM"], atlas["ppm"]["pixels"] / atlas["ppm"]["span"])
    led.same("pack-atlas.py ORIGIN", {alias.get(k, k): list(v) for k, v in pa["ORIGIN"].items()},
             {p["wall"]: [p["column"], p["row"] * pa["ROW"]] for p in atlas["placement"]})
    led.same("pack-atlas.py patch feather", int(re.search(r"feather=(\d+)", text(os.path.join(gh, "pack-atlas.py"))).group(1)), atlas["featherTexels"])
    ff = py_constants(os.path.join(gh, "flatten-floor.py"))
    ff_text = text(os.path.join(gh, "flatten-floor.py"))
    refill = room["survey"]["floorPhoto"]["refill"]
    led.same("flatten-floor.py DISCS (x, z, inner, outer)", [list(d) for d in ff["DISCS"]],
             [[e["centre"][0], e["centre"][1], refill["innerFraction"] * e["radius"], e["radius"]] for e in room["edits"] if e["type"] == "floor-refill"])
    led.same("flatten-floor.py board shift and ease",
             [float(re.search(r"round\(([0-9.]+) \* ppm\)", ff_text).group(1)), float(re.search(r"radius_deg'\] \+ ([0-9.]+)\)", ff_text).group(1))],
             [refill["shift"], refill["easeDeg"]])

    # --- the web modules beside hall-spec.ts --------------------------------
    site = room["site"]
    st = text(os.path.join(web, "hall-site.ts"))
    led.same("hall-site.ts observer, window bearing, pavement",
             [float(re.search(r"latitude: (-?[0-9.]+)", st).group(1)), float(re.search(r"longitude: (-?[0-9.]+)", st).group(1)),
              ts_number(st, "HALL_WINDOW_BEARING"), ts_number(st, "HALL_PAVEMENT_Y")],
             [site["observer"]["latitude"], site["observer"]["longitude"], site["minusZBearingTrue"], site["pavementY"]])
    sun = text(os.path.join(web, "hall-sun-times.ts"))
    block = re.search(r"REVEAL_LIMIT[^=]*= \{(.*?)\};", sun, re.S).group(1)
    led.same("hall-sun-times.ts REVEAL_LIMIT", {k: float(v) for k, v in re.findall(r'"([\w-]+)": (\d+)', block)},
             {o["id"]: o["reveal"]["sunLimitDeg"] for o in room["openings"] if o["kind"] == "window"})
    depth = float(re.search(r"REVEAL_DEPTH=([0-9.]+)", text(os.path.join(gh, "skyline", "final.py"))).group(1))
    led.same("skyline/final.py REVEAL_DEPTH = each window's reveal depth", [depth] * 5,
             [o["reveal"]["depth"] for o in room["openings"] if o["kind"] == "window"])
    led.same("hall-section.ts SECTION_THICKNESS = window wall thickness",
             ts_number(text(os.path.join(web, "hall-section.ts")), "SECTION_THICKNESS"), seg["window"]["thickness"])
    sk = text(os.path.join(gh, "skyline", "skyline.py"))
    led.same("skyline.py Z_OUT = window face - thickness (to 1 um)", float(re.search(r"Z_OUT = (-?[0-9.]+)", sk).group(1)),
             round(wmap["window"]["origin"][1] - seg["window"]["thickness"], 6))
    led.same("skyline.py PZN grid bearing, GRID_MINUS_TRUE",
             [float(re.search(r"PZN = ub\(([0-9.]+)\)", sk).group(1)), float(re.search(r"GRID_MINUS_TRUE = ([0-9.]+)", sk).group(1))],
             [site["minusZBearingGrid"], site["gridMinusTrueDeg"]])
    led.same("hall-site.ts HALL_WINDOW_BEARING = grid - convergence, to 0.1 deg", ts_number(st, "HALL_WINDOW_BEARING"),
             round(site["minusZBearingGrid"] - site["gridMinusTrueDeg"], 1))
    fl = text(os.path.join(web, "hall-floor.ts"))
    led.same("hall-floor.ts FLOOR_BOARD_WIDTH, FLOOR_SEAM", [ts_number(fl, "FLOOR_BOARD_WIDTH"), ts_number(fl, "FLOOR_SEAM")],
             [room["floor"]["boardWidth"], room["floor"]["seam"]])
    hw_ = text(os.path.join(web, "hall-walls.ts"))
    led.same("hall-walls.ts DOOR_RECESS, LEAF_PLANE", [ts_number(hw_, "DOOR_RECESS"), ts_number(hw_, "LEAF_PLANE")],
             [-recess["depth"], -recess["leafPlane"]])
    led.same("hall-walls.ts MODELLED_DOOR = the recess's opening", re.search(r'MODELLED_DOOR = "([\w-]+)"', hw_).group(1),
             recess["u"][0]["opening"])
    at = text(os.path.join(web, "hall-atlas.ts"))
    led.same("hall-atlas.ts WALL_ATLAS_SIZE, V_MIN, V_MAX",
             [ts_number(at, "WALL_ATLAS_SIZE"), ts_number(at, "WALL_ATLAS_V_MIN"), ts_number(at, "WALL_ATLAS_V_MAX")],
             [atlas["size"]] + atlas["vRange"])
    ph = text(os.path.join(web, "hall-photos.ts"))
    led.same("hall-photos.ts HALL_PHOTO_BASE, HALL_SURVEY_REVISION",
             ["packages/web/public" + re.search(r'HALL_PHOTO_BASE = "([^"]+)"', ph).group(1), int(ts_number(ph, "HALL_SURVEY_REVISION"))],
             [room["survey"]["publish"]["folder"], room["survey"]["publish"]["revision"]])
    return led.print()


def diagnostics(room):
    print("Diagnostics")
    plain = json.loads(json.dumps(room))
    for s in plain["walls"]["segments"]:
        s["survey"].pop("anchorE57", None)
    base, moved = roomlib.wall_views(room), roomlib.wall_views(plain)
    shift = max(math.hypot(a["eye"][0] - b["eye"][0], a["eye"][1] - b["eye"][1]) for a, b in zip(base, moved))
    same = roomlib.wall_views_bytes(plain) == roomlib.wall_views_bytes(room)
    print(f"  without the survey anchors (views from the outline's corners): {'identical' if same else 'different'} bytes, "
          f"views move up to {shift * 1000:.1f} mm")
    ruled = json.loads(json.dumps(room))
    for s in ruled["walls"]["segments"]:
        s["survey"].pop("tiles", None)
    same = roomlib.wall_views_bytes(ruled) == roomlib.wall_views_bytes(room)
    print(f"  without explicit tile counts (ceil(length / {room['survey']['wallViews']['tileMaxLength']} m)): "
          f"{'identical' if same else 'different'} bytes")


def main():
    ap = argparse.ArgumentParser(description="Prove grand-hall.room.json against the Grand Hall's sources.")
    ap.add_argument("--scratch", required=True, help="folder for the reruns' output")
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(HERE)), help="the worktree (default: this file's)")
    ap.add_argument("--room", default=os.path.join(HERE, "grand-hall.room.json"))
    args = ap.parse_args()
    os.makedirs(args.scratch, exist_ok=True)
    room = roomlib.load(args.room)
    ok = prove_views(room, args.repo, args.scratch)
    ok &= prove_values(room, args.repo)
    diagnostics(room)
    print("PROVED" if ok else "NOT PROVED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

"""Proves the config-driven build (build-room.py) makes the Grand Hall exactly as the old scripts
(tools/grand-hall-survey/build.sh) do.

  prove-build-identity.py --static grand-hall.room.json --manifest M     (or SURVEYED_ROOMS_MANIFEST)
      Without any build: every table the new steps derive from the config against the old
      scripts' literals (stations on the real manifest, occluders, normals, planes, lengths, tile
      counts, window openings and their order, twins, sash bounds, patches, the recess, the floor
      grid and its E57 mapping and the dome's arrays bit for bit, refill discs, atlas layout,
      relief job, projection arguments per surface, outputs), the views bytes, and the ledger.
  prove-build-identity.py OLD NEW [--published DIR] [--json report.json]
      Two work directories (old build.sh, new build-room.py; OLD may be a --digest file). Aborts
      unless the inputs (manifest, mesh, panoramas, mesh dump) match; then compares every file:
      .f32/.npy bit for bit (catching -0.0 and NaN payloads), .npz array by array, PNG and WebP
      by hash then by decoded pixels (encoder drift against content), GHR1 by hash then entry by
      entry, JSON by bytes then parsed. The depth maps are outputs here (the new driver renders
      them unless --reuse-depth): a file the new tree took from another tree (build/linked.json),
      or that is the same file in both trees, is reported LINKED, never identical. The old views
      (in the tools folder) are compared with the new views/. --published also checks each
      tree's published files against DIR.
  prove-build-identity.py --digest WORK > digests.json
      Per-file SHA-256 (and per-array dtype, shape and SHA-256 for npz), so two 3 GB trees need
      not both be kept.
  prove-build-identity.py --self-test SCRATCH
      Perturbs one element of each kind in a copy of a small tree; every one must be reported.

Exit status 0 only if every file was compared and is identical; 1 if anything differs or is
missing; 2 if everything compared is identical but some files were linked, not compared.
"""
import argparse
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import roomlib  # noqa: E402
from roombuild import atlas as atlas_step  # noqa: E402
from roombuild import legacy  # noqa: E402
from roombuild import publish as publish_step  # noqa: E402
from roombuild import relief as relief_step  # noqa: E402
from roombuild import surfaces, windows  # noqa: E402
from roombuild.context import Room  # noqa: E402

GH = legacy.SURVEY
MANIFEST_ENV = "SURVEYED_ROOMS_MANIFEST"   # the twin's manifest.json, for --static
ALIAS = {"fire": "fireplace"}
INPUTS = ("data/manifest.json", "data/dollhouse.glb", "data/pano8k/", "data/mesh/")
NEW_ONLY = ("room.json", "views/", "build/")


def load_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def bits(a):
    """An array's bytes, for bitwise equality (-0.0 and NaN payloads count)."""
    return np.ascontiguousarray(a).tobytes()


# =================================================================================================
# --static
# =================================================================================================

class Checks:
    def __init__(self):
        self.rows = []

    def same(self, label, old, new, equal=None):
        ok = bool(equal(old, new)) if equal else self._eq(old, new)
        self.rows.append((ok, label, old, new))
        return ok

    def true(self, label, ok, detail=""):
        self.rows.append((bool(ok), label, detail, detail))

    @staticmethod
    def _eq(a, b):
        if isinstance(a, np.ndarray) or isinstance(b, np.ndarray):
            a, b = np.asarray(a), np.asarray(b)
            return a.shape == b.shape and a.dtype == b.dtype and bits(a) == bits(b)
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            return len(a) == len(b) and all(Checks._eq(x, y) for x, y in zip(a, b))
        if isinstance(a, dict) and isinstance(b, dict):
            return a.keys() == b.keys() and all(Checks._eq(a[k], b[k]) for k in a)
        if isinstance(a, bool) or isinstance(b, bool):
            return type(a) is type(b) and a == b
        return a == b

    def print(self):
        for ok, label, old, new in self.rows:
            def short(v):
                if isinstance(v, np.ndarray):
                    return f"array {v.dtype} {v.shape} sha {sha256_bytes(bits(v))[:12]}"
                s = v if isinstance(v, str) else repr(v)
                return s if len(s) < 110 else s[:107] + "..."
            detail = short(old) if ok else f"old {short(old)} | new {short(new)}"
            print(f"  {'ok  ' if ok else 'DIFF'} {label:<66} {detail}")
        bad = sum(1 for r in self.rows if not r[0])
        print(f"  {len(self.rows)} checks, {bad} differ")
        return bad == 0


def old_dome_arrays():
    """project-dome.py's own statements up to its surface-offset call, executed as written."""
    path = os.path.join(GH, "project-dome.py")
    tree = ast.parse(text(path), path)
    body = []
    for node in tree.body:
        if isinstance(node, ast.Import) and any(a.name == "subprocess" for a in node.names):
            break
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if isinstance(node, ast.Expr) and not isinstance(node.value, ast.Constant):
            continue                                   # sys.path.insert(...)
        body.append(node)
    ns = {"np": np}
    exec(compile(ast.Module(body, []), path, "exec"), ns)  # noqa: S102 - the repo's own code
    return ns


def old_floor_grid(pf):
    """project-floor.py's grid statements with its constants."""
    L, W, XC, YC, FLOOR, PPM = pf["L"], pf["W"], pf["XC"], pf["YC"], pf["FLOOR"], pf["PPM"]
    w, h = int(round(L * PPM)), int(round(W * PPM))
    x = -L / 2 + (np.arange(w) + 0.5) / PPM
    z = W / 2 - (np.arange(h) + 0.5) / PPM
    Xp, Zp = np.meshgrid(x, z)
    pts = np.stack([XC - Xp, Zp + YC, np.full_like(Xp, FLOOR)], -1).reshape(-1, 3)
    return pts, w, h


def load_overhead_passes():
    from roombuild import overhead  # noqa: PLC0415
    return overhead.FILL_PASSES


def static(room_path, manifest_path):
    pg = load_path("prove_grand_hall", os.path.join(HERE, "prove-grand-hall.py"))
    const = lambda name: pg.py_constants(os.path.join(GH, name))  # noqa: E731
    room = Room(room_path, work=HERE)
    cfg, survey = room.cfg, room.survey
    c = Checks()
    print("Static proof (no build): config-derived tables against the old scripts' literals")
    if os.path.basename(manifest_path) != "manifest.json":
        raise SystemExit("--manifest must be a file named manifest.json (project.stations reads DATA/manifest.json)")

    # --- stations, occluders, projection arguments ---------------------------------------------
    ns = legacy.old_function(os.path.join(GH, "project.py"), ["stations"],
                             {"os": os, "json": json, "np": np, "DATA": os.path.dirname(os.path.abspath(manifest_path))})
    old_st, new_st = ns["stations"](), room.stations(manifest_path)
    c.same("project.stations() ids = config stations in manifest order", [s["id"] for s in old_st], [s["id"] for s in new_st])
    c.true("project.stations() t and gain, bit for bit", len(old_st) == len(new_st) and all(
        bits(a["t"]) == bits(b["t"]) and bits(a["gain"]) == bits(b["gain"]) for a, b in zip(old_st, new_st)), f"{len(new_st)} stations")
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    depth_ids = [n["id"] for n in manifest["nodes"] if int(n["id"][5:]) <= 48]
    c.same("render-depth.mjs nodes (<= 48) = build/stations.json in the manifest", depth_ids,
           [n["id"] for n in manifest["nodes"] if n["id"] in set(room.station_ids())])
    fi = const("fetch_inputs.py")
    c.same("fetch_inputs.py remote panorama paths", [f"tiles/scan_{i:03d}/equirect_8192.webp" for i in fi["GRAND_HALL_SWEEPS"]],
           [cfg["source"]["panoramas"]["path"].format(index=int(s[5:])) for s in room.station_ids()])
    c.same("fetch_inputs.py local panorama names", [f"data/pano8k/scan_{i:03d}_8192.webp" for i in fi["GRAND_HALL_SWEEPS"]],
           [f"data/pano8k/{s}_8192.webp" for s in room.station_ids()])
    pj = const("project.py")
    c.same("project.py CHANDELIERS = occluder tuples", pj["CHANDELIERS"], room.occluder_tuples())
    pj_text = text(os.path.join(GH, "project.py"))
    m = re.search(r"def project\(points, normals, station_list=None, lod=(\d+), cos_min=([0-9.]+), p_cos=([0-9.]+), "
                  r"q_dist=([0-9.]+), max_dist=([0-9.]+), report=False, robust=True, nadir=False, glare=0\)", pj_text)
    lod, cos_min, p_cos, q_dist, max_dist = int(m.group(1)), *[float(g) for g in m.groups()[1:]]
    base = dict(lod=lod, cos_min=cos_min, p_cos=p_cos, q_dist=q_dist, max_dist=max_dist)
    old_kw = {
        "walls": dict(base),
        "ceiling": dict(base, cos_min=float(re.search(r"cos_min=([0-9.]+)", text(os.path.join(GH, "project-ceiling.py"))).group(1))),
        "dome": dict(base, cos_min=float(re.search(r"cos_min=([0-9.]+)", text(os.path.join(GH, "project-dome.py"))).group(1))),
    }
    fm = re.search(r"cos_min=([0-9.]+), p_cos=([0-9.]+), q_dist=([0-9.]+), nadir=(\w+), glare=(\d+)", text(os.path.join(GH, "project-floor.py")))
    old_kw["floor"] = dict(base, cos_min=float(fm.group(1)), p_cos=float(fm.group(2)), q_dist=float(fm.group(3)),
                           nadir=fm.group(4) == "True", glare=int(fm.group(5)))
    for surface, kw in old_kw.items():
        c.same(f"project() keyword arguments for {surface}", kw, room.projection(surface))
    # --- walls: names, normals, planes, lengths, tiles -------------------------------------------
    pw, fc, wd, pa, wr = const("project-walls.py"), const("fix-corners.py"), const("wall-depth.py"), const("pack-atlas.py"), const("window-relief.py")
    c.same("wall order (build.sh project-walls, fix-corners, wall-depth)", ["window", "door", "end", "fire"], [w["name"] for w in room.order])
    views = roomlib.wall_views(cfg)
    for name in ("window", "door", "end", "fire"):
        w = room.by_name[name]
        c.same(f"project-walls.py NORMALS[{name}] as float array", np.array([pw["NORMALS"][name]], float), room.normal3(w))
        c.same(f"fix-corners.py NORMALS[{name}] as float array", np.array([fc["NORMALS"][name]], float), room.normal3(w))
        c.same(f"fix-corners.py PLANES[{name}] = (axis, plane, sign)", fc["PLANES"][name], room.aligned(w))
        c.same(f"wall-depth.py PLANES[{name}]", wd["PLANES"][name], room.aligned(w))
        old_len = fc["L"] if name in ("window", "door") else fc["W"]
        c.same(f"fix-corners/pack-atlas/wall-depth length of {name}", [old_len, pa["LENGTH"][name], wd["LENGTH"][name]], [w["length"]] * 3)
        tiles = [v["name"] for v in views if v["wall"] == name]
        c.same(f"pack-atlas.py tiles of {name}", [f"wall-{name}-{t}" for t in range(4 if pa["LENGTH"][name] > 15 else 2)], tiles)
    rng = np.random.default_rng(7)
    P = (rng.normal(size=(64, 64, 4)) * 5).astype(np.float32)
    P[0, 0, 1] = np.float32(wr["WALL_Y"])
    c.same("window-relief.py depth P[..., 1] - WALL_Y = room.depth (float32, bit for bit)",
           P[..., 1] - wr["WALL_Y"], room.depth(room.by_name["window"], P))
    for name in ("window", "door", "end", "fire"):
        axis, plane, sign = fc["PLANES"][name]
        c.same(f"fix-corners.py depth of {name} = room.depth (float32)", (P[..., axis] - plane) * sign, room.depth(room.by_name[name], P))
    # --- windows -------------------------------------------------------------------------------
    win = room.by_name["window"]
    new_open = [(o["id"], windows._kind(o), room.opening_centre(o), o["width"], o["sill"], o["head"])
                for o in room.openings_on(win) if o["kind"] == "window" and o["glazing"] != "none"]
    c.same("window-relief.py OPENINGS, in order", [tuple(o) for o in wr["OPENINGS"]], new_open)
    c.same("window-relief.py TWIN = reveal.glassDepthFrom", wr["TWIN"],
           {o["id"]: o["reveal"]["glassDepthFrom"] for o in room.openings_on(win) if "glassDepthFrom" in o.get("reveal", {})})
    old_sash = [0.55 if kind == "arched-window" else width / 2 - 0.1 for _, kind, _, width, _, _ in wr["OPENINGS"]]
    c.same("window-relief.py sash rule", old_sash, [windows._sash(room.openings[o[0]]) for o in new_open])
    c.same("window-relief.py SRC_PPM, SRC_TOP, RANGE", [wr["SRC_PPM"], wr["SRC_TOP"], wr["RANGE"]],
           [float(survey["wallViews"]["ppm"]), survey["wallViews"]["heightRange"][1], windows.RANGE])
    c.same("glazed walls (window-relief.py: the window wall only)", ["window"], [w["name"] for w in room.glazed_walls()])
    c.true("every glazed opening is clear (the colour test, old loop body)",
           all(o["glazing"] == "clear" for o in cfg["openings"] if o["kind"] == "window"))
    # --- patches, recess ---------------------------------------------------------------------------
    as_old = lambda ps: [(p[0]["name"], *p[1:]) for p in ps]  # noqa: E731
    c.same("pack-atlas.py PATCHES = photo patches", [tuple(p) for p in pa["PATCHES"]], as_old(room.patches("photo")))
    c.same("wall-depth.py PATCHES = relief patches", [tuple(p) for p in wd["PATCHES"]], as_old(room.patches("relief")))
    wd_text = text(os.path.join(GH, "wall-depth.py"))
    m = re.search(r"px\(DOOR_MAIN - ([0-9.]+), 0\.0\).*?px\(DOOR_MAIN \+ ([0-9.]+), DOOR_HEAD\)\s*D\[r0:r1, c0:c1\] = (-?[0-9.]+)", wd_text, re.S)
    c.same("wall-depth.py main door recess (wall, u0, u1, v0, v1, -value)",
           [("door", wd["DOOR_MAIN"] - float(m.group(1)), wd["DOOR_MAIN"] + float(m.group(2)), 0.0, wd["DOOR_HEAD"], -float(m.group(3)))],
           [(r[0]["name"], *r[1:]) for r in room.recesses("relief")])
    c.same("pack-atlas.py patch feather", int(re.search(r"feather=(\d+)", text(os.path.join(GH, "pack-atlas.py"))).group(1)),
           survey["atlas"]["featherTexels"])
    # --- relief ----------------------------------------------------------------------------------------
    c.same("wall-depth.py PPM, TOP = wallViews ppm, top", [wd["PPM"], wd["TOP"]], [float(survey["wallViews"]["ppm"]), survey["wallViews"]["heightRange"][1]])
    c.same("wall-depth.py holds", [float(x) for x in re.findall(r"TOP - ([0-9.]+)\) \* PPM", wd_text)],
           [survey["relief"]["holdFloor"], survey["relief"]["holdCeiling"]])
    c.same("wall-depth.py clip", [float(x) for x in re.search(r"np\.clip\(fill\(D\), (-?[0-9.]+), (-?[0-9.]+)\)", wd_text).groups()],
           survey["relief"]["depthRange"])
    c.same("wall-depth.py end band and clamp", [float(re.search(r"end = int\(([0-9.]+) \* PPM\)", wd_text).group(1)),
                                                [float(x) for x in re.search(r"np\.clip\(D\[:, :end\], (-?[0-9.]+), (-?[0-9.]+)\)", wd_text).groups()]],
           [relief_step.END_BAND, list(relief_step.END_CLAMP)])
    c.same("wall-depth.py CORNER_ZONE, INTRUSION", [wd["CORNER_ZONE"], wd["INTRUSION"]], [relief_step.CORNER_ZONE, relief_step.INTRUSION])
    c.same("relief json ppm, top: PPM / 2, TOP", [wd["PPM"] / 2, wd["TOP"]], [float(survey["wallViews"]["ppm"]) / 2, survey["wallViews"]["heightRange"][1]])
    rm = text(os.path.join(GH, "relief-mesh.mjs"))
    vr = [float(g) for g in re.search(r"const V_MIN = (-?[0-9.]+), V_MAX = (-?[0-9.]+), D_MIN = (-?[0-9.]+), D_MAX = (-?[0-9.]+);", rm).groups()]
    old_job = dict(out="proj/walls-relief.bin", error=float(re.search(r"errArg \?\? ([0-9.]+)", rm).group(1)),
                   entries=[dict(id=i, file=f"relief/{f}", u0=0, vRange=vr[:2], dRange=vr[2:])
                            for i, f in re.findall(r'\["(\w+)", "(\w+)"\]', rm)])
    c.same("relief-mesh.mjs WALLS, ranges, error, out = the walls' job", old_job, relief_step.walls_job(room))
    # --- floor ---------------------------------------------------------------------------------------
    pf = const("project-floor.py")
    old_pts, ow, oh = old_floor_grid(pf)
    new_pts, nw, nh, ppm = surfaces.floor_grid(room)
    c.same("project-floor.py grid size", [ow, oh, pf["PPM"]], [nw, nh, ppm])
    c.same("project-floor.py texel positions (E57, bit for bit)", old_pts, new_pts)
    XC, YC, FLOOR = pf["XC"], pf["YC"], pf["FLOOR"]
    old_patch = [(round(XC - s["t"][0], 3), round(s["t"][1] - YC, 3), round(s["t"][2] - FLOOR, 3)) for s in old_st]
    new_patch = []
    for s in new_st:
        x, y, z = roomlib.to_planner(cfg, *s["t"])
        new_patch.append((round(x, 3), round(z, 3), round(y, 3)))
    c.same("project-floor.py floor-patches.json x, z, height of every station", old_patch, new_patch)
    ff = const("flatten-floor.py")
    ff_text = text(os.path.join(GH, "flatten-floor.py"))
    refill = survey["floorPhoto"]["refill"]
    c.same("flatten-floor.py DISCS", [tuple(d) for d in ff["DISCS"]],
           [(e["centre"][0], e["centre"][1], refill["innerFraction"] * e["radius"], e["radius"]) for e in room.floor_refills()])
    c.same("flatten-floor.py board shift (x ppm), ease", [float(re.search(r"round\(([0-9.]+) \* ppm\)", ff_text).group(1)) * 120.0,
                                                           float(re.search(r"radius_deg'\] \+ ([0-9.]+)\)", ff_text).group(1))],
           [refill["shift"] * float(survey["floorPhoto"]["ppm"]), refill["easeDeg"]])
    x0, x1, z0, z1 = room.bbox()
    cols = np.arange(nw) + 0.5
    c.same("flatten-floor.py cols, rows (bit for bit)", [cols / 120.0 - ff["L"] / 2, ff["W"] / 2 - (np.arange(nh) + 0.5) / 120.0],
           [cols / 120.0 + x0, z1 - (np.arange(nh) + 0.5) / 120.0])
    c.true("outline is a rectangle (no floor mask); boards run x", room.is_rectangle() and cfg["floor"]["boardsRun"] == "x")
    # --- dome ------------------------------------------------------------------------------------------
    od = old_dome_arrays()
    pts, nrm, W, H, total = surfaces.dome_geometry(room, cfg["ceiling"]["domes"][0])
    c.same("project-dome.py W, H, arc", [od["W"], od["H"], od["total"]], [W, H, total])
    c.same("project-dome.py texel positions (bit for bit)", od["pts"], pts)
    c.same("project-dome.py texel normals (bit for bit)", od["nrm"], nrm)
    dome_text = text(os.path.join(GH, "project-dome.py"))
    off = re.search(r"'proj/dome-offset\.f32', '([0-9.]+)', '([0-9.]+)'", dome_text)
    c.same("project-dome.py surface-offset arguments", [off.group(1), off.group(2)], [repr(v) for v in survey["domePhoto"]["surfaceOffset"]])
    did = cfg["ceiling"]["domes"][0]["id"]
    c.same("project-dome.py file names", ["proj/dome.npz", "proj/dome.png", "proj/dome-texels.f32", "proj/dome-offset.f32", "proj/dome-offset.npy"],
           [f"proj/{did}{s}" for s in (".npz", ".png", "-texels.f32", "-offset.f32", "-offset.npy")])
    c.same("project-ceiling.py position file", re.search(r"'(out-walls/[\w-]+\.position\.f32)'", text(os.path.join(GH, "project-ceiling.py"))).group(1),
           f"out-walls/{roomlib.ceiling_view(cfg)['name']}.position.f32")
    # --- atlas -----------------------------------------------------------------------------------------
    lay = atlas_step.layout(room)
    c.same("pack-atlas.py SIZE, PPM, ROW, V_MIN, V_MAX", [pa["SIZE"], pa["SIZE"], pa["PPM"], pa["ROW"], pa["V_MIN"], pa["V_MAX"]],
           [lay["width"], lay["height"], lay["ppm"], lay["row"], *lay["vRange"]])
    c.same("pack-atlas.py ORIGIN and write order", [(ALIAS.get(k, k), *pa["ORIGIN"][k]) for k in ("window", "door", "end", "fire")],
           [(s["wall"]["id"], s["x"], s["y"]) for s in lay["strips"]])
    c.same("pack-atlas.py strip widths ceil(LENGTH * PPM)", [int(np.ceil(pa["LENGTH"][k] * pa["PPM"])) for k in ("window", "door", "end", "fire")],
           [s["w"] for s in lay["strips"]])
    c.same("pack-atlas.py fill passes, pack-overhead.py fill passes", [40, 200], [atlas_step.FILL_PASSES, load_overhead_passes()])
    # --- outputs -----------------------------------------------------------------------------------------
    build_sh = text(os.path.join(GH, "build.sh"))
    old_outputs = re.search(r"OUTPUTS=\(([^)]*)\)", build_sh, re.S).group(1).split()
    c.same("build.sh OUTPUTS = survey.outputs, in order", old_outputs, publish_step.output_files(room))
    sizes = dict(walls=[(pa["SIZE"], pa["SIZE"]), tuple(int(x) for x in re.search(r"out\.resize\(\((\d+), (\d+)\)", text(os.path.join(GH, "pack-atlas.py"))).groups())])
    po = re.findall(r"save\((ceiling|dome), f'\{out\}/[\w-]+\.webp', \((\d+), (\d+)\)\)", text(os.path.join(GH, "pack-overhead.py")))
    sizes["ceiling"] = [(int(a), int(b)) for k, a, b in po if k == "ceiling"]
    sizes["dome"] = [(int(a), int(b)) for k, a, b in po if k == "dome"]
    sizes["floor"] = [tuple(int(x) for x in s) for s in re.findall(r"\((\d+), (\d+)\)", re.search(r"for size in \[(.*?)\]:", text(os.path.join(GH, "pack-floor.py"))).group(1))]
    o = survey["outputs"]
    c.same("pack-*.py output sizes = survey.outputs sizes",
           sizes, dict(walls=[tuple(f["size"]) for f in o["walls"]], ceiling=[tuple(f["size"]) for f in o["ceiling"]],
                       dome=[tuple(f["size"]) for f in o["domes"]["dome"]], floor=[tuple(f["size"]) for f in o["floor"]]))
    c.same("survey.json published for the Grand Hall", None, o.get("manifest"))
    # --- views and ledger ----------------------------------------------------------------------------
    for name, data in (("views-walls.json", roomlib.wall_views_bytes(cfg)), ("views-ceiling.json", roomlib.ceiling_view_bytes(cfg))):
        with open(os.path.join(GH, name), "rb") as f:
            committed = f.read().replace(b"\r\n", b"\n")
        c.same(f"views/{name} = tools/grand-hall-survey/{name} (line ends normalised)", sha256_bytes(committed), sha256_bytes(data))
    c.same("ledger (no gate opened)", [], room.ledger())
    c.same("build problems", [], room.build_problems())
    return c.print()


# =================================================================================================
# Comparing two trees
# =================================================================================================

def walk(root):
    out = {}
    for dirpath, _, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            out[os.path.relpath(path, root).replace(os.sep, "/")] = path
    return out


def npz_arrays(path):
    with np.load(path) as z:
        return {k: z[k] for k in z.files}


def array_detail(a, b, depth_face=None):
    if a.shape != b.shape or a.dtype != b.dtype:
        return f"dtype/shape {a.dtype}{a.shape} vs {b.dtype}{b.shape}"
    av, bv = np.ascontiguousarray(a).reshape(-1), np.ascontiguousarray(b).reshape(-1)
    if av.dtype.kind == "f":
        ui = {2: np.uint16, 4: np.uint32, 8: np.uint64}[av.dtype.itemsize]
        diff = av.view(ui) != bv.view(ui)
    else:
        diff = av != bv
    n = int(diff.sum())
    if n == 0:
        return None
    first = int(np.argmax(diff))
    detail = f"{n} of {av.size} elements differ, first at {first}"
    if av.dtype.kind == "f":
        with np.errstate(invalid="ignore"):
            d = np.abs(av[diff].astype(np.float64) - bv[diff].astype(np.float64))
        finite = d[np.isfinite(d)]
        detail += f", max |delta| {float(finite.max()) if finite.size else 'nan'}"
        detail += f", array_equal(equal_nan) {np.array_equal(av, bv, equal_nan=True)}"
    if depth_face is not None:
        faces = sorted(set((np.nonzero(diff)[0] // depth_face).tolist()))
        detail += f", faces {faces}"
    return detail


def compare_file(rel, a, b):
    """None if identical, else a description. a, b are paths."""
    ext = os.path.splitext(rel)[1]
    if ext == ".f32":
        x, y = np.fromfile(a, np.float32), np.fromfile(b, np.float32)
        face = None
        if rel.startswith("data/depth"):
            size = int(round((x.size / 6) ** 0.5))
            face = size * size if size * size * 6 == x.size else None
        return array_detail(x, y, face)
    if ext == ".npy":
        return array_detail(np.load(a), np.load(b))
    if ext == ".npz":
        x, y = npz_arrays(a), npz_arrays(b)
        if list(x) != list(y):
            return f"keys {list(x)} vs {list(y)}"
        out = [f"{k}: {d}" for k in x if (d := array_detail(x[k], y[k]))]
        if out:
            return "; ".join(out)
        return None if sha256_file(a) == sha256_file(b) else "arrays identical, bytes differ (npz container)"
    if sha256_file(a) == sha256_file(b):
        return None
    if ext in (".png", ".webp"):
        x, y = np.asarray(Image.open(a)), np.asarray(Image.open(b))
        d = array_detail(x, y)
        return f"bytes differ; decoded pixels {'identical (encoder drift)' if d is None else 'differ: ' + d}"
    if ext == ".bin":
        ghr1 = load_path("ghr1_reader", os.path.join(HERE, "tests", "ghr1.py"))
        try:
            with open(a, "rb") as f:
                ea = ghr1.parse(f.read())
            with open(b, "rb") as f:
                eb = ghr1.parse(f.read())
        except ValueError as exc:
            return f"bytes differ; not both GHR1 ({exc})"
        parts = []
        if [e["id"] for e in ea] != [e["id"] for e in eb]:
            parts.append(f"ids {[e['id'] for e in ea]} vs {[e['id'] for e in eb]}")
        for x, y in zip(ea, eb):
            for key in ("ranges", "quantised", "indices"):
                d = array_detail(np.asarray(x[key]), np.asarray(y[key]))
                if d:
                    parts.append(f"{x['id']} {key}: {d}")
        return "bytes differ; " + ("; ".join(parts) if parts else "entries identical")
    if ext == ".json":
        try:
            with open(a, encoding="utf-8") as f:
                x = json.load(f)
            with open(b, encoding="utf-8") as f:
                y = json.load(f)
        except ValueError:
            return "bytes differ (not JSON)"
        return f"bytes differ; parsed {'identical' if x == y else 'differ: ' + first_json_diff(x, y)}"
    return "bytes differ"


def first_json_diff(a, b, path="$"):
    if type(a) is not type(b):
        return f"{path}: {a!r:.60} vs {b!r:.60}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{path}.{k} only on one side"
            if a[k] != b[k]:
                return first_json_diff(a[k], b[k], f"{path}.{k}")
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return first_json_diff(x, y, f"{path}[{i}]")
    return f"{path}: {a!r:.60} vs {b!r:.60}"


def digest_tree(root):
    out = {}
    for rel, path in sorted(walk(root).items()):
        entry = dict(bytes=os.path.getsize(path), sha256=sha256_file(path))
        if rel.endswith(".npz"):
            entry["arrays"] = {k: dict(dtype=str(v.dtype), shape=list(v.shape), sha256=sha256_bytes(bits(v)))
                               for k, v in npz_arrays(path).items()}
        out[rel] = entry
    return out


def is_input(rel):
    return any(rel == p or (p.endswith("/") and rel.startswith(p)) for p in INPUTS)


def compare_trees(old, new, published=None):
    """Rows (path, status, detail); status: identical | different | only-old | only-new | extra."""
    rows = []
    old_digest = None
    if os.path.isfile(old):
        with open(old, encoding="utf-8") as f:
            old_digest = json.load(f)
        old_files = {k: None for k in old_digest}
    else:
        old_files = walk(old)
    new_files = walk(new)
    linked = {}
    linked_path = os.path.join(new, "build", "linked.json")
    if os.path.exists(linked_path):
        with open(linked_path, encoding="utf-8") as f:
            linked = json.load(f)
    # Inputs must match before anything else means anything.
    for rel in sorted(k for k in set(old_files) | set(new_files) if is_input(k)):
        if rel not in old_files or rel not in new_files:
            rows.append((rel, "only-old" if rel in old_files else "only-new", "input"))
            continue
        a = old_digest[rel]["sha256"] if old_digest else sha256_file(old_files[rel])
        same = a == sha256_file(new_files[rel])
        rows.append((rel, "identical" if same else "different", "input"))
    if any(status != "identical" for _, status, kind in rows if kind == "input"):
        rows.append(("(inputs)", "different", "the two trees did not start from the same inputs: comparison aborted"))
        return rows
    # The old views live in the tools folder (CRLF on Windows); the new ones in views/.
    for name in ("views-walls.json", "views-ceiling.json"):
        rel = f"views/{name}"
        if rel in new_files:
            with open(os.path.join(GH, name), "rb") as f:
                a = f.read().replace(b"\r\n", b"\n")
            with open(new_files[rel], "rb") as f:
                b = f.read().replace(b"\r\n", b"\n")
            rows.append((rel, "identical" if a == b else "different", "against tools/grand-hall-survey/" + name))
    for rel in sorted(set(old_files) | set(new_files)):
        if is_input(rel):
            continue
        if rel not in old_files and any(rel == p or (p.endswith("/") and rel.startswith(p)) for p in NEW_ONLY):
            if not rel.startswith("views/"):
                rows.append((rel, "extra", "new-only bookkeeping, not compared"))
            continue
        if rel not in new_files:
            rows.append((rel, "only-old", ""))
            continue
        if rel not in old_files:
            rows.append((rel, "only-new", ""))
            continue
        if rel in linked:
            rows.append((rel, "linked", f"taken from {linked[rel].get('source')} ({linked[rel].get('how')}): not compared"))
            continue
        if not old_digest and os.path.samefile(old_files[rel], new_files[rel]):
            rows.append((rel, "linked", "the same file in both trees: not compared"))
            continue
        if old_digest:
            d = old_digest[rel]
            same = d["sha256"] == sha256_file(new_files[rel])
            detail = None if same else "sha256 differs"
            if not same and rel.endswith(".npz") and "arrays" in d:
                arrays = npz_arrays(new_files[rel])
                bad = [k for k, v in d["arrays"].items() if k not in arrays or v["sha256"] != sha256_bytes(bits(arrays[k]))]
                detail = f"arrays differ: {bad}" if bad else "arrays identical, bytes differ (npz container)"
        else:
            detail = compare_file(rel, old_files[rel], new_files[rel])
        rows.append((rel, "identical" if detail is None else "different", detail or ""))
    if published:
        for name in sorted(os.listdir(published)):
            target = sha256_file(os.path.join(published, name))
            for label, files, digest in (("old", old_files, old_digest), ("new", new_files, None)):
                rel = f"proj/{name}"
                if rel not in files:
                    rows.append((f"published {name} ({label})", f"only-{'new' if label == 'old' else 'old'}", "not built"))
                    continue
                have = digest[rel]["sha256"] if digest else sha256_file(files[rel])
                rows.append((f"published {name} ({label})", "identical" if have == target else "different",
                             "" if have == target else "differs from the published file"))
    return rows


def report(rows, json_path=None):
    """Prints the rows; returns the exit status (0 identical, 1 different, 2 identical where
    compared but some files linked)."""
    bad = [r for r in rows if r[1] not in ("identical", "extra", "linked")]
    linked = [r for r in rows if r[1] == "linked"]
    for rel, status, detail in rows:
        if status != "identical":
            print(f"  {status.upper():<10} {rel}  {detail}")
    counts = {}
    for _, status, _ in rows:
        counts[status] = counts.get(status, 0) + 1
    print("  " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items())))
    if json_path:
        with open(json_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump([dict(path=r, status=s, detail=d) for r, s, d in rows], f, indent=1)
    if bad:
        print(f"DIFFERENT ({len(bad)})")
        return 1
    if linked:
        print(f"IDENTICAL WHERE COMPARED; {len(linked)} files linked, not compared (not a proof for them)")
        return 2
    print("IDENTICAL")
    return 0


def report_quietly(rows):
    with contextlib.redirect_stdout(io.StringIO()):
        return report(rows)


# =================================================================================================
# --self-test
# =================================================================================================

def self_test(scratch):
    ghr1 = load_path("ghr1_writer", os.path.join(HERE, "tests", "ghr1.py"))
    base = os.path.join(scratch, "selftest")
    shutil.rmtree(base, ignore_errors=True)
    old = os.path.join(base, "old")
    rng = np.random.default_rng(11)
    files = {}

    def put(rel, data):
        path = os.path.join(old, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        files[rel] = path

    put("data/manifest.json", b'{"nodes": []}')
    put("data/pano8k/scan_000_8192.webp", b"panorama")
    put("data/depth1024/scan_000.f32", rng.random(6 * 4 * 4, dtype=np.float32).tobytes())
    put("out-walls/wall-end-0.position.f32", rng.random(64, dtype=np.float32).tobytes())
    buf = io.BytesIO(); np.save(buf, rng.random((8, 8)).astype(np.float32)); put("proj/window-layered.npy", buf.getvalue())
    buf = io.BytesIO(); np.savez_compressed(buf, rgb=rng.random((4, 4, 3)).astype(np.float32), valid=np.ones((4, 4), bool)); put("proj/wall-end-0.npz", buf.getvalue())
    img = (rng.random((8, 8, 3)) * 255).astype(np.uint8)
    buf = io.BytesIO(); Image.fromarray(img).save(buf, "PNG"); put("proj/ceiling.png", buf.getvalue())
    buf = io.BytesIO(); Image.fromarray(img).save(buf, "WEBP", lossless=True); put("proj/walls-4096.webp", buf.getvalue())
    put("proj/walls-relief.bin", ghr1.write([dict(id="end", ranges=[0, 1, 0, 1, -1, 1], quantised=[[0, 0, 0], [65535, 0, 0], [0, 65535, 0]], indices=[[0, 1, 2]])]))
    put("relief/end.json", b'{"width": 2, "ppm": 100.0}')
    new = os.path.join(base, "new")
    shutil.copytree(old, new)
    ok = True
    rows = compare_trees(old, new)
    if any(s not in ("identical", "extra") for _, s, _ in rows):
        print("self-test: an untouched copy is reported different"); ok = False

    def perturb(rel):
        path = os.path.join(new, rel)
        ext = os.path.splitext(rel)[1]
        if ext == ".f32":
            a = np.fromfile(path, np.float32)
            a[3] = np.nextafter(a[3], np.float32(2))
            a.tofile(path)
        elif ext == ".npy":
            a = np.load(path); a[2, 2] = np.nextafter(a[2, 2], np.float32(2)); np.save(path, a)
        elif ext == ".npz":
            z = npz_arrays(path); z["valid"][1, 1] = False
            with open(path, "wb") as f:
                np.savez_compressed(f, **z)
        elif ext in (".png", ".webp"):
            a = np.asarray(Image.open(path)).copy(); a[0, 0, 0] ^= 1
            Image.fromarray(a).save(path, "PNG" if ext == ".png" else "WEBP", **({} if ext == ".png" else {"lossless": True}))
        elif ext == ".bin":
            with open(path, "rb") as f:
                raw = bytearray(f.read())
            raw[8 + 48 + 2] ^= 1
            with open(path, "wb") as f:
                f.write(bytes(raw))
        else:
            with open(path, "rb") as f:
                raw = f.read().replace(b"100.0", b"100.5")
            with open(path, "wb") as f:
                f.write(raw)

    for rel in files:
        if is_input(rel):
            continue
        shutil.rmtree(new); shutil.copytree(old, new)
        perturb(rel)
        rows = compare_trees(old, new)
        hit = [r for r in rows if r[0] == rel and r[1] == "different"]
        others = [r for r in rows if r[0] != rel and r[1] not in ("identical", "extra")]
        status = "caught" if hit and not others else "MISSED"
        ok &= status == "caught"
        print(f"  {status:<7} {rel}  {hit[0][2] if hit else ''}")
    # A NaN payload and -0.0 are caught by the bitwise comparison.
    for label, value in (("-0.0", np.float32(-0.0)), ("NaN payload", np.array([0x7fc00001], np.uint32).view(np.float32)[0])):
        shutil.rmtree(new); shutil.copytree(old, new)
        rel = "out-walls/wall-end-0.position.f32"
        a = np.fromfile(os.path.join(old, rel), np.float32)
        b = a.copy(); a[5] = 0.0 if label == "-0.0" else np.float32("nan"); b[5] = value
        a.tofile(os.path.join(old, rel)); b.tofile(os.path.join(new, rel))
        hit = [r for r in compare_trees(old, new) if r[0] == rel and r[1] == "different"]
        ok &= bool(hit)
        print(f"  {'caught' if hit else 'MISSED':<7} {rel} ({label})  {hit[0][2] if hit else ''}")
    # A depth map the new tree took from the old one (build/linked.json, or the same file) is
    # reported linked, never identical, and the verdict says so (exit 2).
    shutil.rmtree(new); shutil.copytree(old, new)
    rel = "data/depth1024/scan_000.f32"
    os.remove(os.path.join(new, rel))
    try:
        os.link(os.path.join(old, rel), os.path.join(new, rel))
    except OSError:
        shutil.copyfile(os.path.join(old, rel), os.path.join(new, rel))
    os.makedirs(os.path.join(new, "build"), exist_ok=True)
    with open(os.path.join(new, "build", "linked.json"), "w", encoding="utf-8") as f:
        json.dump({rel: dict(source=old, how="hard link")}, f)
    rows = compare_trees(old, new)
    hit = [r for r in rows if r[0] == rel and r[1] == "linked"]
    others = [r for r in rows if r[0] != rel and r[1] not in ("identical", "extra")]
    caught = bool(hit) and not others and report_quietly(rows) == 2
    ok &= caught
    print(f"  {'caught' if caught else 'MISSED':<7} {rel} linked (build/linked.json): reported linked, exit 2")
    os.remove(os.path.join(new, "build", "linked.json"))
    if os.path.samefile(os.path.join(old, rel), os.path.join(new, rel)):
        hit = [r for r in compare_trees(old, new) if r[0] == rel and r[1] == "linked"]
        ok &= bool(hit)
        print(f"  {'caught' if hit else 'MISSED':<7} {rel} hard-linked with no record: {hit[0][2] if hit else ''}")
    # Inputs that differ abort the comparison.
    shutil.rmtree(new); shutil.copytree(old, new)
    with open(os.path.join(new, "data/manifest.json"), "wb") as f:
        f.write(b'{"nodes": [1]}')
    aborted = any(r[0] == "(inputs)" for r in compare_trees(old, new))
    ok &= aborted
    print(f"  {'caught' if aborted else 'MISSED':<7} differing inputs abort the comparison")
    print("SELF-TEST PASSED" if ok else "SELF-TEST FAILED")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("trees", nargs="*", help="OLD NEW work directories (OLD may be a --digest file)")
    ap.add_argument("--static", metavar="ROOM", help="prove a config's derived tables without a build")
    ap.add_argument("--manifest", default=os.environ.get(MANIFEST_ENV), help=f"the twin's manifest.json (for --static; default ${MANIFEST_ENV})")
    ap.add_argument("--digest", metavar="WORK", help="print per-file digests of a work directory")
    ap.add_argument("--self-test", metavar="SCRATCH", help="perturb a small tree and check every change is reported")
    ap.add_argument("--published", help="the published folder, compared with each tree's outputs")
    ap.add_argument("--json", help="write the comparison as JSON")
    args = ap.parse_args()
    if args.static:
        if not args.manifest:
            ap.error(f"--static needs the twin's manifest.json: --manifest or ${MANIFEST_ENV}")
        sys.exit(0 if static(args.static, args.manifest) else 1)
    if args.digest:
        json.dump(digest_tree(args.digest), sys.stdout, indent=1)
        sys.exit(0)
    if args.self_test:
        sys.exit(0 if self_test(args.self_test) else 1)
    if len(args.trees) != 2:
        ap.error("give OLD and NEW, or --static, --digest or --self-test")
    print(f"Comparing {args.trees[0]} (old) with {args.trees[1]} (new)")
    sys.exit(report(compare_trees(*args.trees, published=args.published), args.json))


if __name__ == "__main__":
    main()
